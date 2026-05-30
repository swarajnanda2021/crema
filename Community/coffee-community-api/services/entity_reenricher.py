"""Shared v2 re-enrichment helper for one product.

Used by:
  • POST /admin/products/{product_id}/re-enrich (synchronous single-product)
  • POST /admin/roasters/{slug}/bulk-reenrich (BG worker iterating products)

Both call `reenrich_one_product(db, product_row)`. The helper drives the
full v2 path: page_fetcher (Tier 2 + Playwright Tier 4) → optional
Shopify variant augmentation → entity_enricher.enrich_url → entity_upserter
.upsert_entity. Returns a ReenrichResult.

Design notes (2026-05-25):

  • The helper does NOT manage threading. The caller decides whether to
    block (sync route) or run in a BG worker (bulk route).

  • Pipeline context (set_pipeline_context) is stamped here so the LLM
    job queues with the correct roaster_slug. The caller doesn't have
    to remember.

  • An `existing_coffee_name` hint is seeded from the products row.
    Without it, Haiku returning null `coffee_name_clean` falls through
    the adapter fallback chain (title → og_title → 'Unknown coffee')
    and clobbers the catalog row with a placeholder. With the hint,
    the adapter preserves the catalog's last-known name. Critical for
    bulk re-enrichments where Haiku's null-return rate is non-zero.

  • Shopify variant augmentation is applied inline when the roaster's
    platform=shopify. The bulk runner does this via entity_discovery
    + augmenters loop; per-product re-enrich bypasses discovery to
    avoid re-crawling 100+ URLs per call, so the same merge happens
    here.

  • Tag-noise filter (bottle/can/cup/mug/tumbler/merch) drops
    roaster-side mis-tagging that confuses Haiku's is_coffee_bean gate
    (Project Kaapi ships tags="bottle, Cans" on real bean SKUs).
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from typing import Optional


@dataclass
class ReenrichResult:
    """Outcome of one re-enrichment attempt. Designed for log/aggregation
    by the bulk-reenrich BG worker. Does not raise — callers inspect the
    `outcome` enum + optional `gate_status` / `error`."""

    product_id: str
    outcome: str
    # 'updated' | 'inserted' | 'skipped_unchanged' | 'gated' |
    # 'failed_fetch' | 'failed_llm' | 'failed_validation' | 'no_url'
    gate_status: Optional[str] = None
    error: Optional[str] = None


_NOISE_TAG_TERMS = (
    "bottle", "can", "cans", "cup", "mug",
    "tumbler", "merch", "merchandise",
)

# Shopify ships a default placeholder image when a product has no
# uploaded image — URL pattern `cdn/shopifycloud/storefront/assets/
# no-image-NNNN-{hash}.gif`. Combined with variant.price=0 it's a
# sold-out / unconfigured-variant ghost. Blue Tokai's Araku Valley
# FPO trio (gosthani / manyatorna / vanmaya, 2026-05-25) surfaced
# the pattern: catalog showed them as enriched live products that
# don't click to anything on the consumer side.
_SHOPIFY_NO_IMAGE_MARKERS = (
    "/no-image-",
    "shopifycloud/storefront/assets/no-image",
)


def _preserve_status_on_failure(db, product_id: str) -> None:
    """Stamp enrichment_status='failed' on a re-enrich failure ONLY when the
    row has no prior GOOD enrichment to preserve (Class F, 2026-05-30).

    A row already 'enriched' / 'source_thin' is a displayable bean (name +
    price + image + roast). A transient fetch failure or a one-off
    validation miss on a RE-enrich must not downgrade it to 'failed' and
    strand it as failed+available=1 limbo — the consumer still sees a fine
    bean, only the status is wrong. So: preserve a good status; otherwise
    (pending / already-failed / never-enriched) record 'failed' as before."""
    row = db.execute(
        "SELECT enrichment_status FROM products WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    if row and row["enrichment_status"] in ("enriched", "source_thin"):
        return  # preserve — don't downgrade a good, displayable row
    db.execute(
        "UPDATE products SET enrichment_status = 'failed' WHERE product_id = ?",
        (product_id,),
    )
    db.commit()


def _is_shopify_placeholder_image(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    return any(marker in lower for marker in _SHOPIFY_NO_IMAGE_MARKERS)


def _maybe_apply_shopify_augmentation(
    db, roaster_slug: str, product_url: str, hints: dict
) -> None:
    """Fetch /products/{handle}.json and merge variant data into hints
    when the roaster is on Shopify. Best-effort: silent on any failure
    (network blip, 402 paywall, JSON parse, missing variants)."""
    platform_row = db.execute(
        "SELECT platform FROM roaster_sources WHERE website = ("
        "  SELECT website FROM roaster_profiles WHERE roaster_slug = ?"
        ")",
        (roaster_slug,),
    ).fetchone()
    platform = (
        (platform_row["platform"] if platform_row else "") or ""
    ).lower()
    if "shopify" not in platform or "/products/" not in product_url:
        return

    try:
        import requests as _requests
        from services.page_fetcher import FETCH_HEADERS, FETCH_TIMEOUT_S
        handle = product_url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
        shop_root = product_url.split("/products/")[0]
        resp = _requests.get(
            f"{shop_root}/products/{handle}.json",
            headers=FETCH_HEADERS,
            timeout=FETCH_TIMEOUT_S,
            allow_redirects=True,
        )
        if resp.status_code != 200:
            return
        sp = (resp.json() or {}).get("product") or {}
    except (Exception,):
        return

    variants = sp.get("variants") or []
    images = sp.get("images") or []
    first_var = variants[0] if variants else None
    first_img = images[0] if images else None

    # Ghost detection — Shopify variant priced 0 OR placeholder image
    # OR variant.available=false → not a live purchasable product.
    # Mark the row available=0 and DON'T ship the zero-price /
    # placeholder image (those would land in the catalog and surface
    # as un-clickable rows on the consumer browse). Blue Tokai's
    # Araku Valley FPO trio (2026-05-25) is the canonical case.
    is_ghost = False
    if isinstance(first_var, dict):
        try:
            v_price = float(first_var.get("price"))
        except (TypeError, ValueError):
            v_price = None
        v_available = first_var.get("available")
        if v_price == 0 or v_available is False:
            is_ghost = True
    if isinstance(first_img, dict):
        if _is_shopify_placeholder_image(
            first_img.get("src") or first_img.get("url") or ""
        ):
            is_ghost = True

    if is_ghost:
        hints["available"] = False

    # Always record clean platform-API hints, even when the variant
    # is marked ghost (variant.available=False). The ghost flag tells
    # us the product is unavailable RIGHT NOW; it doesn't mean the
    # price + image are wrong. Previously this block early-returned
    # on is_ghost — which silently dropped legit Shopify variant.price
    # + images[0].src for any product whose variant happened to be
    # out-of-stock at scrape time. Panduranga Grand Aroma + Savorworks
    # Phenom (2026-05-26) both landed price_inr=None / image_url=None
    # in the catalog despite clean .json — that was this bug. Refined
    # 2026-05-26 (F1): only the *junk* hints from a ghost variant
    # (price=0 sentinel, placeholder image) skip, not all hints.
    if not hints.get("image_url") and isinstance(first_img, dict):
        img_src = first_img.get("src") or first_img.get("url")
        if img_src and not _is_shopify_placeholder_image(img_src):
            hints["image_url"] = img_src

    if isinstance(first_var, dict):
        if not hints.get("price_inr"):
            try:
                p = float(first_var.get("price"))
            except (TypeError, ValueError):
                p = None
            # Skip the zero-price ghost sentinel — that's the
            # Shopify "unconfigured variant" pattern, not a real
            # price. A truly free product is implausible in
            # specialty coffee, so dropping 0 is safe.
            if p is not None and p > 0:
                hints["price_inr"] = p
        if not hints.get("weight_grams"):
            try:
                hints["weight_grams"] = int(
                    first_var.get("grams") or first_var.get("weight_grams")
                )
            except (TypeError, ValueError):
                pass

    if not hints.get("title"):
        hints["title"] = sp.get("title")
    if not hints.get("listing_description"):
        hints["listing_description"] = sp.get("body_html")
    if not hints.get("tags"):
        tags = sp.get("tags")
        raw_tags: list[str] = []
        if isinstance(tags, str):
            raw_tags = [t.strip() for t in tags.split(",") if t.strip()]
        elif isinstance(tags, list):
            raw_tags = [str(t).strip() for t in tags if str(t).strip()]
        hints["tags"] = [
            t for t in raw_tags
            if not any(noise in t.lower() for noise in _NOISE_TAG_TERMS)
        ]


def reenrich_one_product(db, product_row: dict) -> ReenrichResult:
    """Run v2 enrichment on one product row. Idempotent; does not raise.

    Args:
      db: an open sqlite3.Connection.
      product_row: dict with product_id + product_url + roaster_slug +
        coffee_name (used as the existing_coffee_name hint).

    Returns: ReenrichResult describing what happened. On real pipeline
    failures (not gate decisions), the products row's enrichment_status
    is updated to 'failed' before returning.
    """
    product_id = product_row.get("product_id") or ""
    product_url = product_row.get("product_url")
    roaster_slug = product_row.get("roaster_slug")
    existing_coffee_name = product_row.get("coffee_name")

    if not product_url:
        return ReenrichResult(
            product_id, "no_url", error="missing product_url"
        )
    if not roaster_slug:
        return ReenrichResult(
            product_id, "no_url", error="missing roaster_slug"
        )

    from services.llm_router import set_pipeline_context
    set_pipeline_context(roaster_slug=roaster_slug)

    from services.page_fetcher import fetch_page
    from services.entity_enricher import enrich_url
    from services.entity_upserter import upsert_entity

    page_text, hints = fetch_page(product_url, kind="product")

    _maybe_apply_shopify_augmentation(db, roaster_slug, product_url, hints)

    # Resolve roaster display name so we can detect (and skip) hints
    # that have been polluted with the brand. Vithai's lot-7 row's
    # coffee_name is currently "Vithai" — a prior bad re-enrich
    # corrupted it. If we feed "Vithai" back as existing_coffee_name,
    # Haiku echoes it via coffee_name_clean and the cycle continues
    # forever. Same for og:title on Wix UUID-shop URLs that emit the
    # brand. We strip these brand-looking hints below so Haiku falls
    # back to extracting from page text.
    roaster_name_row = db.execute(
        "SELECT name FROM roaster_profiles WHERE roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()
    roaster_name = (
        roaster_name_row["name"] if roaster_name_row else ""
    ) or ""
    roaster_name_l = roaster_name.lower().strip()

    def _looks_like_brand(value) -> bool:
        if not roaster_name_l or not value:
            return False
        v = str(value).lower().strip()
        if not v:
            return False
        # Equal, prefix/suffix, or full-substring match in either
        # direction — catches "Vithai" == "Vithai Coffee" and the
        # reverse.
        if v == roaster_name_l:
            return True
        if v in roaster_name_l and len(v) >= 4:
            return True
        if roaster_name_l in v and len(roaster_name_l) >= 4:
            return True
        return False

    # Seed existing_coffee_name — but only if it's neither the
    # "Unknown coffee" sentinel nor the roaster brand.
    if existing_coffee_name:
        cleaned = existing_coffee_name.strip()
        if (cleaned and cleaned != "Unknown coffee"
                and not _looks_like_brand(cleaned)):
            hints["existing_coffee_name"] = cleaned

    # Strip og:title if it's the brand — Wix UUID-shop pages tend to
    # emit the brand as og:title which then flows into the adapter's
    # fallback chain and overwrites the catalog with the brand.
    if _looks_like_brand(hints.get("og_title")):
        hints.pop("og_title", None)
    if _looks_like_brand(hints.get("title")):
        hints.pop("title", None)

    # Heuristic last-resort: the first non-empty, non-brand line of
    # the cleaned page text. Vithai's Playwright text starts with
    # "TN 2025 Lot-5\nLOT 5\nTasting\n..." — the second line "LOT 5"
    # is the lot label Haiku should pick up. Capped at 80 chars to
    # avoid landing an entire paragraph as a product name.
    if page_text:
        for line in page_text.splitlines():
            ln = (line or "").strip()
            if not ln or len(ln) > 80:
                continue
            if _looks_like_brand(ln):
                continue
            # Skip obvious non-name lines.
            if ln.lower() in (
                "tasting", "process", "varieties", "altitude",
                "roast", "farmer", "village", "region",
                "collective / farm", "quality bonus:",
                "add to cart", "qty", "select", "size", "grind",
            ):
                continue
            if ln.startswith("₹") or ln.startswith("Rs"):
                continue
            hints["page_first_line"] = ln
            break

    if not page_text:
        # Class F (2026-05-30): a TRANSIENT empty fetch (rate-limit / Tier-4
        # miss) must NOT downgrade a row that already enriched cleanly to
        # 'failed' — that left ~88 displayable beans stranded as
        # failed+available=1 (consumer sees a fine bean; the status is just
        # wrong). Only stamp 'failed' when there's no prior good enrichment
        # to preserve; otherwise leave the row's enriched/source_thin status
        # (and availability) untouched.
        _preserve_status_on_failure(db, product_id)
        return ReenrichResult(
            product_id, "failed_fetch",
            error="page fetch returned empty (Tier 2 + Tier 4)",
        )

    hint_row = db.execute(
        "SELECT enrichment_prompt_hint FROM roaster_profiles "
        "WHERE roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()
    addendum = (hint_row["enrichment_prompt_hint"] if hint_row else None) or None

    now_iso = (
        _dt.datetime.now(_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    try:
        entity, gate_status = enrich_url(
            kind="product",
            url=product_url,
            roaster_slug=roaster_slug,
            page_text=page_text,
            hints=hints,
            scraped_at=now_iso,
            system_addendum=addendum,
        )
    except Exception as e:
        return ReenrichResult(product_id, "failed_llm", error=str(e))

    if entity is None:
        # Gate decisions on existing valid rows are mostly false
        # positives (Project Kaapi: Shopify tags="bottle, Cans" trips
        # is_coffee_bean=false). Preserve existing row state.
        if gate_status and gate_status.startswith("gated_"):
            return ReenrichResult(
                product_id, "gated", gate_status=gate_status,
            )
        # Class F: same preserve rule — a validation miss on a re-enrich
        # must not strand a previously-good, displayable row as
        # failed+available=1. Only mark 'failed' if nothing good is there.
        _preserve_status_on_failure(db, product_id)
        return ReenrichResult(
            product_id, "failed_validation",
            gate_status=gate_status,
            error=f"enricher returned None ({gate_status})",
        )

    try:
        result = upsert_entity(db, entity)
    except Exception as e:
        return ReenrichResult(
            product_id, "failed_validation",
            error=f"upsert failed: {e}",
        )

    outcome = result.action if result.action in (
        "updated", "inserted", "skipped_unchanged",
    ) else "updated"
    return ReenrichResult(product_id, outcome)


__all__ = ["ReenrichResult", "reenrich_one_product"]
