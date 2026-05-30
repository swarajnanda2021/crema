"""V2 enrichment orchestrator — the load-bearing piece.

For a (roaster, kinds) tuple:

    1. Discover URLs (product + article) via `entity_discovery`.
    2. For each URL: open an `enrichment_tasks` row.
    3. Skip-cheap if the canonical table already has an enriched row
       for the URL and `force_enrich=False`.
    4. Else fetch the page (`page_fetcher`), call Haiku
       (`entity_enricher.enrich_url`), upsert (`entity_upserter`).
    5. Compute coverage_pct per kind, regenerate site-quirk hints if
       stale or `regenerate_hint=True`, return summary.

This runner is operator-agnostic. The same call works for:

  * an admin UI button click (SDK path, blocks the FastAPI request)
  * an agent-driven sweep (queue path, llm_jobs drained by drainer
    subagents while this orchestrator polls)

The difference is invisible because `services/llm_router.call_llm`
routes based on `CREMA_AGENT_IDENTITY` automatically. See
AGENTIC_UTOPIA.md rule 1.

Replaces `services/scrape_runner.run_per_roaster_scrape` and
`services/article_scraper.run_article_scrape_job`'s per-roaster loop.
The legacy modules stay during cutover and are decommissioned in a
follow-up PR.
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

# Allow `python services/enrichment_runner.py ...` (the CLI form) by
# putting the api root on sys.path BEFORE the package imports resolve.
_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from services.canonical_entity import EntityKind
from services.entity_discovery import DiscoveredUrl, discover as discover_entities
from services.entity_enricher import enrich_url
from services.entity_upserter import (
    mark_task_failed,
    mark_task_skipped,
    upsert_entity,
)
from services.page_fetcher import fetch_page, head_check_url, is_dead_status


SITE_HINT_REGEN_AFTER_DAYS = 30


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class KindStats:
    enriched: int = 0
    updated: int = 0
    inserted: int = 0
    skipped_unchanged: int = 0
    skipped_already_enriched: int = 0
    pre_filter_excluded: int = 0     # Stage 1: URL/title exclusion (bundles, merch, equipment)
    no_bean_markers: int = 0          # Stage 2: page text lacked bean inclusion markers
    failed: int = 0
    gate_rejected: int = 0
    discovered: int = 0
    coverage_pct: float = 0.0


@dataclass
class RunResult:
    roaster_slug: str
    started_at: str = field(default_factory=_now)
    ended_at: Optional[str] = None
    kinds_requested: list[str] = field(default_factory=list)
    per_kind: dict[str, KindStats] = field(default_factory=dict)
    site_hint_status: dict[str, str] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def to_summary(self) -> dict[str, Any]:
        per_kind = {
            k: {
                "discovered": s.discovered,
                "enriched": s.enriched,
                "inserted": s.inserted,
                "updated": s.updated,
                "skipped_unchanged": s.skipped_unchanged,
                "skipped_already_enriched": s.skipped_already_enriched,
                "pre_filter_excluded": s.pre_filter_excluded,
                "no_bean_markers": s.no_bean_markers,
                "failed": s.failed,
                "gate_rejected": s.gate_rejected,
                "coverage_pct": round(s.coverage_pct, 1),
            }
            for k, s in self.per_kind.items()
        }
        return {
            "roaster_slug": self.roaster_slug,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "kinds": self.kinds_requested,
            "per_kind": per_kind,
            "site_hint_status": self.site_hint_status,
            "errors": self.errors,
        }


# ── Roaster lookup ────────────────────────────────────────────────────────


def _load_roaster_meta(db, roaster_slug: str) -> Optional[dict[str, Any]]:
    """Pull the metadata entity_discovery + entity_enricher need."""
    row = db.execute(
        "SELECT rp.roaster_slug, rp.website, rp.enrichment_prompt_hint, "
        "       rp.enrichment_prompt_hint_updated_at, "
        "       rp.article_enrichment_prompt_hint, "
        "       rp.article_enrichment_prompt_hint_updated_at, "
        "       rs.platform, rs.shop_url, rs.articles_index_url, "
        "       rs.articles_feed_kind, rs.articles_handles "
        "FROM roaster_profiles rp "
        "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
        "WHERE rp.roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


# ── Skip-cheap heuristics ──────────────────────────────────────────────────


def _augmenter_signals(augmented: dict) -> tuple[Optional[str], list, Optional[str]]:
    """Pull title / tags / product_type from whichever platform
    augmenter is attached to a DiscoveredUrl."""
    shopify = (augmented or {}).get("shopify_raw") or {}
    woo = (augmented or {}).get("woocommerce_raw") or {}
    raw = shopify or woo
    title = raw.get("title") or raw.get("name") or None
    tags = raw.get("tags") or []
    product_type = raw.get("product_type") or raw.get("type") or None
    return title, tags, product_type


def _strong_platform_bean_signal(augmented: dict, page_text: str = "") -> bool:
    """A thin-body product page is still a bean when the PLATFORM metadata
    says so — Stage-2 bypass for the storefront-chrome case (2026-05-30,
    lesson 83 / Class E). Sikkim Coffee's roast SKUs render ~800 chars of
    pure chrome (price / share / variant labels) and carry only 2 visible-
    text bean markers (< the 3-marker gate), so 2 of 3 roasts were silently
    skipped as 'no-bean-markers'. But the page is unambiguously coffee:
    product_type='Coffee' and the variant/grind options are named 'Whole
    Beans' / 'Grounded - Espresso' etc. Treat those as strong bean markers
    that bypass the visible-text threshold. Reads the platform augmentation
    first, then falls back to the cleaned page_text (the grind labels render
    in it) when discovery augmentation didn't attach a platform payload."""
    raw = (augmented or {}).get("shopify_raw") or (
        augmented or {}
    ).get("woocommerce_raw") or {}
    pt = raw.get("product_type") or raw.get("type") or ""
    if "coffee" in str(pt).lower():
        return True
    labels: list = []
    for v in (raw.get("variants") or []):
        if isinstance(v, dict):
            labels += [v.get("option1"), v.get("option2"), v.get("title")]
    for o in (raw.get("options") or []):
        if isinstance(o, dict):
            labels += (o.get("values") or [])
    blob = " ".join(str(x).lower() for x in labels if x)
    if not blob:
        # No platform payload attached — fall back to the cleaned page text,
        # where Shopify renders the grind-variant labels ("Whole Beans",
        # "Grounded - French Press"). Require BOTH a whole-bean term AND a
        # grind/ground term so a stray word can't trip it.
        blob = (page_text or "").lower()
        has_whole = "whole bean" in blob or "whole-bean" in blob
        has_grind = "grounded" in blob or "ground coffee" in blob
        return has_whole and has_grind
    return any(
        t in blob for t in ("whole bean", "whole-bean", "ground", "grounded")
    )


def _already_enriched(db, *, kind: EntityKind, url: str) -> bool:
    """DEPRECATED — kept for legacy callers / log compatibility.

    The `_already_enriched` short-circuit was a wrong cost
    optimization: it caused enrichment ops to skip Stage 2 (bean
    markers) and the Haiku call on any URL whose row was already
    `enriched`, which permanently grandfathered any bundle / merch /
    stale-URL row inserted before each filter rule tightened. The
    correct optimization is the diff gate at the refresh-op layer;
    enrichment ops always re-walk the full pipeline. Don't reach
    for this helper inside the runner."""
    if kind == "product":
        row = db.execute(
            "SELECT 1 FROM products WHERE product_url = ? "
            "  AND enrichment_status = 'enriched' LIMIT 1",
            (url,),
        ).fetchone()
    elif kind == "article":
        row = db.execute(
            "SELECT 1 FROM roaster_articles WHERE url = ? "
            "  AND enrichment_status = 'enriched' LIMIT 1",
            (url,),
        ).fetchone()
    else:
        return False
    return row is not None


_VARIANT_SIZE_HINT_RE = __import__("re").compile(
    r"[-_](\d{1,4})\s*-?\s*(g|gm|gms|gram|grams|kg|kgs)\b",
    __import__("re").IGNORECASE,
)

# Match "Pack of 10", "10-pack", "10 pack", "Set of 5", "5 bags",
# "10 drip bags", "Box of 12", etc. The pack count is captured.
# Conservative: only matches N in [2, 50] so we don't accidentally
# parse a roast date like "Roasted on 22/05" as a pack count.
_PACK_COUNT_RE = __import__("re").compile(
    r"\b(?:"
    r"pack\s+of\s+(\d{1,2})"
    r"|set\s+of\s+(\d{1,2})"
    r"|box\s+of\s+(\d{1,2})"
    r"|(\d{1,2})[-\s]?pack\b"
    r"|(\d{1,2})\s+(?:drip\s+)?(?:bags|sachets|sticks|pods|capsules)\b"
    r")",
    __import__("re").IGNORECASE,
)


def _extract_pack_count(*titles: Optional[str]) -> Optional[int]:
    """Detect a pack count from any of the supplied titles. Returns
    N when the title encodes "Pack of N" / "N-pack" / "Set of N" /
    "N bags" patterns; None otherwise.

    Nandan's "Lil'More Pour Over- Light Roast (Pack of 10)" SKU
    stores per-bag grams (10g) in the Shopify variant — total bag
    weight should be 10 × 10g = 100g. Without this multiplier, the
    catalog row shows 10g and trips every "drip bag" suspicion
    audit.

    Only the FIRST match wins; multiple pack-of-N indicators in one
    title are treated as the same N.
    """
    for t in titles:
        if not t:
            continue
        m = _PACK_COUNT_RE.search(t.lower())
        if m is None:
            continue
        for grp in m.groups():
            if grp:
                try:
                    n = int(grp)
                except (TypeError, ValueError):
                    continue
                if 2 <= n <= 50:
                    return n
    return None


def _url_size_hint_grams(url: str) -> Optional[int]:
    """Extract a weight-in-grams hint from a Shopify-style URL handle
    suffix. `-1-kg` → 1000, `-250g` → 250, `-500gm` → 500. Returns
    None if no size suffix is present.

    Coral Rum's handle was `…coral-rum-coffee-alcohol-free-takaraa-1-kg`
    — the `-1-kg` tail is an authoritative hint that the catalog row
    was meant to represent the 1KG variant, not the smallest one.
    """
    if not url:
        return None
    from urllib.parse import urlparse
    try:
        handle = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    except Exception:
        handle = url
    matches = list(_VARIANT_SIZE_HINT_RE.finditer(handle))
    if not matches:
        return None
    val_str = matches[-1].group(1)
    unit = matches[-1].group(2).lower()
    try:
        val = int(val_str)
    except ValueError:
        return None
    if unit.startswith("kg"):
        return val * 1000
    return val


# Size token inside a free-text variant label ("40g", "250 g", "1kg",
# "1 Kg", "500gm"). Longest unit alternatives first so "1kg" matches
# "kg" not the bare "g". Used to recover bag size from variant
# `title` / `option1` when Shopify's `grams` field is the shipping
# weight rather than the bag size.
_LABEL_SIZE_RE = __import__("re").compile(
    r"(?<![\d.])(\d{1,4})\s*(kgs?|gms?|grams?|g)\b",
    __import__("re").IGNORECASE,
)


def _label_size_grams(label: Optional[str]) -> Optional[int]:
    """Parse a bag-size-in-grams from a variant label. Returns None
    when no size token is present."""
    if not label:
        return None
    m = _LABEL_SIZE_RE.search(label)
    if not m:
        return None
    try:
        val = int(m.group(1))
    except (TypeError, ValueError):
        return None
    return val * 1000 if m.group(2).lower().startswith("kg") else val


def _variant_bag_grams(v: dict) -> Optional[int]:
    """Bag size in grams for a Shopify variant. PREFERS parsing the
    variant `option1` / `title` ('40g', '1 Kg', '250 gm') over the
    raw `grams` field, because Shopify's `grams` is the *shipping*
    weight — unreliable as bag size. Reserved India reports
    grams=1000 for BOTH its 40g and 100g lots (kg weight unit), which
    blinded the old largest-grams sort; the label parse recovers the
    real 40g / 100g distinction. Falls back to the `grams` field only
    when neither label carries a size token. Returns None if nothing
    parseable / non-positive."""
    for label in (v.get("option1"), v.get("title")):
        g = _label_size_grams(label)
        if g is not None and g > 0:
            return g
    raw = v.get("grams") or v.get("weight_grams")
    try:
        g = int(raw)
    except (TypeError, ValueError):
        return None
    return g if g > 0 else None


# Below this bag size (grams), a variant is treated as a SAMPLE / taster
# SKU (Takaraa 20g, Caffinary 50g), not the retail unit — so it's skipped
# when a larger real bag exists. Genuine sub-floor micro-lots (Reserved's
# 40-90g gesha, where the small bag IS the only retail unit) are handled
# by the fallback in _pick_default_variant, not excluded.
SAMPLE_FLOOR_GRAMS = 100


def _pick_default_variant(
    variants: list, *, url: Optional[str] = None,
) -> Optional[dict]:
    """Pick the most representative variant from a Shopify variants
    array. Default Shopify ordering (variants[0]) silently picks the
    smallest/cheapest variant, which collapsed all the Takaraa /
    Caffinary multi-variant beans to their 20g / 50g sample SKU.

    Priority:
      1. If the URL handle encodes a size (e.g. `-1-kg`), pick the
         available variant whose grams match — the URL itself is
         the authoritative hint about which SKU the catalog row
         represents.
      2. Otherwise pick the available variant with the SMALLEST bag
         that clears SAMPLE_FLOOR_GRAMS — the retail ENTRY unit
         (kapi-kottai's 200g/₹999 over its 1kg/₹4620 bulk SKU). The
         floor skips 20g/50g taster SKUs so "smallest" never collapses
         to a sample.
      3. If NO variant clears the floor (genuine micro-lots — Reserved's
         40-90g gesha), pick the largest of those sub-floor bags.
      4. Fall back to variants[0] only as a last resort.

    Returns None if `variants` is empty or contains no dict entries.
    """
    if not variants:
        return None
    dict_pool = [v for v in variants if isinstance(v, dict)]
    if not dict_pool:
        return None
    available_pool = [
        v for v in dict_pool if v.get("available") is not False
    ]
    pool = available_pool or dict_pool

    hint = _url_size_hint_grams(url or "")
    if hint is not None:
        for v in pool:
            if _variant_bag_grams(v) == hint:
                return v

    # Retail ENTRY bag, not the bulk SKU. Among variants with a
    # parseable bag size, prefer the SMALLEST that clears the sample
    # floor. Kapi-kottai sells each coffee as 200g/₹999 AND 1kg/₹4620
    # (× grind), so the prior "largest bag" rule priced the catalog at
    # the ₹4620 1kg while the consumer-facing retail unit is the 200g
    # ₹999. The floor drops 20g/50g taster SKUs (Takaraa/Caffinary) so
    # the smallest *real* bag wins, not the sample. When NO variant
    # clears the floor — genuine micro-lots like Reserved's 40-90g
    # gesha, where the small bag IS the retail unit — fall back to the
    # largest sub-floor bag so we neither null out nor sample-trap them.
    # `_variant_bag_grams` parses the variant label first, so an
    # unreliable shipping-weight `grams` field (Reserved's uniform 1000)
    # can't distort the size. price + weight are taken from this same
    # picked variant downstream, so the choice is always coherent.
    sized = [
        (g, v)
        for v in pool
        if (g := _variant_bag_grams(v)) is not None and g > 0
    ]
    if sized:
        real_bags = [gv for gv in sized if gv[0] >= SAMPLE_FLOOR_GRAMS]
        if real_bags:
            return min(real_bags, key=lambda gv: gv[0])[1]
        return max(sized, key=lambda gv: gv[0])[1]
    return pool[0]


def _woo_price_inr(woo_raw: dict) -> Optional[float]:
    """Authoritative INR price from a WooCommerce Store API product.

    The Store API (`/wp-json/wc/store/v1/products`) exposes price under
    `prices` as integer minor-unit STRINGS — NOT a Shopify-style
    `variants[].price`:

        {"price":"82900","regular_price":"99900","sale_price":"82900",
         "currency_minor_unit":2}      →   ₹829.00 / ₹999.00

    So `_pick_default_variant` no-ops for WooCommerce (the payload has
    `variations` — ids only — not priced `variants`), and the price
    falls to Haiku's flaky page-text parse. When Haiku misses it the
    row lands price_inr NULL/0 — the Zenforest / Curious Life
    missing-price class. Read it directly here: prefer a positive
    active `price`, then `regular_price` (recovers the list price when
    a zero/sale current value would read as missing), then
    `sale_price`. Returns None only when nothing yields a positive
    value (a genuinely price-less / out-of-catalog product) — never a
    fabricated constant.
    """
    prices = (woo_raw or {}).get("prices") or {}
    try:
        minor = int(prices.get("currency_minor_unit"))
    except (TypeError, ValueError):
        minor = 2
    for key in ("price", "regular_price", "sale_price"):
        raw = prices.get(key)
        if raw in (None, ""):
            continue
        s = str(raw)
        try:
            # Store API gives integer minor-units ("82900"); the legacy
            # WP-REST shape gives major-unit decimals ("829.00"). A '.'
            # means it's already major units — don't re-scale it.
            val = (
                float(s)
                if "." in s
                else float(s) / (10 ** minor if minor and minor > 0 else 1)
            )
        except (TypeError, ValueError):
            continue
        if val > 0:
            return round(val, 2)
    return None


def _fetch_platform_raw_by_url(
    platform: Optional[str], url: str,
) -> tuple[Optional[str], dict]:
    """Per-URL platform-payload fallback for the scrape path.

    Discovery-time augmentation (`product_discovery`) attaches
    `shopify_raw` / `woocommerce_raw` keyed by canonical URL, then
    silently no-ops when that keying drifts (handle changed, a
    trailing `-1` suffix, `/products/` vs sitemap form). When it
    no-ops the v2 price/weight/image overrides never fire even though
    the platform API has the data — World of Coffee's Shopify drip
    bags came back price_inr=NULL while `/products/<handle>.json`
    carried price="180.00". The v2 *inline* reenrich path already
    recovers this via `entity_reenricher._maybe_apply_shopify_augmentation`;
    the full_reenrich SCRAPE path (this runner) had no equivalent —
    the documented inline-vs-subprocess divergence. Fetch the
    product's own canonical platform JSON so BOTH paths recover.

    Best-effort: short timeout, silent on any failure. Returns
    ("shopify_raw"|"woocommerce_raw", payload_dict) or (None, {}).
    """
    platform = (platform or "").lower()
    if "/products/" not in url and "/product/" not in url:
        return None, {}
    try:
        import requests as _requests
        from services.page_fetcher import FETCH_HEADERS, FETCH_TIMEOUT_S
    except Exception:
        return None, {}
    handle = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
    try:
        if "shopify" in platform and "/products/" in url:
            shop_root = url.split("/products/")[0]
            resp = _requests.get(
                f"{shop_root}/products/{handle}.json",
                headers=FETCH_HEADERS, timeout=FETCH_TIMEOUT_S,
                allow_redirects=True,
            )
            if resp.status_code == 200:
                prod = (resp.json() or {}).get("product") or {}
                if prod:
                    return "shopify_raw", prod
        elif "woo" in platform and "/product/" in url:
            site_root = url.split("/product/")[0]
            resp = _requests.get(
                f"{site_root}/wp-json/wc/store/v1/products",
                params={"slug": handle},
                headers=FETCH_HEADERS, timeout=FETCH_TIMEOUT_S,
                allow_redirects=True,
            )
            if resp.status_code == 200:
                arr = resp.json() or []
                if isinstance(arr, list) and arr:
                    return "woocommerce_raw", arr[0]
    except Exception:
        return None, {}
    return None, {}


def _normalize_platform_tags(raw: Any) -> list:
    """Normalize a platform `tags` payload to a flat list of strings.

    Shopify products.json gives `tags` as a comma-separated STRING
    ("Drip Bag" / "a, b, c"); WooCommerce Store API gives a LIST OF
    DICTS ([{"id":30,"name":"blend","slug":"blend",...}, ...]). The
    downstream `entity_enricher._build_product_user_content` does
    `", ".join(tags)`, which raises "sequence item 0: expected str
    instance, dict found" on the Woo shape. Collapse both into a clean
    list of tag-name strings so the join is always safe.
    """
    if not raw:
        return []
    if isinstance(raw, str):
        return [t.strip() for t in raw.split(",") if t.strip()]
    if isinstance(raw, list):
        out: list[str] = []
        for t in raw:
            if isinstance(t, str) and t.strip():
                out.append(t.strip())
            elif isinstance(t, dict):
                name = t.get("name") or t.get("title") or t.get("slug")
                if name:
                    out.append(str(name))
        return out
    return []


def _flag_existing_product_row(
    db, *, url: str, status: str, reason: str, log
) -> None:
    """Stage 1 / Stage 2 reject on a URL that already has a
    `products` row → flip `available=0` + `enrichment_status` to
    the reject reason. Field values (price, weight, name, etc.) are
    PRESERVED — only availability + status flip. This is the
    catalog-membership-revocation that the prior `_already_enriched`
    short-circuit was preventing.

    Idempotent — the WHERE clause skips rows already at this status,
    so repeated bulk-enrich runs don't keep rewriting the row.
    """
    cur = db.execute(
        "UPDATE products SET available = 0, enrichment_status = ? "
        "WHERE product_url = ? AND enrichment_status != ?",
        (status, url, status),
    )
    db.commit()
    if cur.rowcount > 0:
        log(f"  [flag-existing/{status}] {url}: {reason}")


# ── enrichment_tasks helpers ───────────────────────────────────────────────


import hashlib


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


def _open_task(
    db,
    *,
    kind: EntityKind,
    url: str,
    roaster_slug: str,
    job_id: Optional[int],
) -> int:
    """Insert or revive an enrichment_tasks row, return its id."""
    existing = db.execute(
        "SELECT id FROM enrichment_tasks WHERE url = ? AND kind = ?",
        (url, kind),
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE enrichment_tasks SET state = 'discovered', "
            "  state_changed_at = ?, job_id = COALESCE(?, job_id), "
            "  last_error = NULL "
            "WHERE id = ?",
            (_now(), job_id, existing["id"]),
        )
        db.commit()
        return existing["id"]
    cur = db.execute(
        "INSERT INTO enrichment_tasks "
        "  (kind, url, url_hash, roaster_slug, state, state_changed_at, "
        "   job_id, created_at) "
        "VALUES (?, ?, ?, ?, 'discovered', ?, ?, ?)",
        (kind, url, _url_hash(url), roaster_slug, _now(), job_id, _now()),
    )
    db.commit()
    return cur.lastrowid


def _set_task_state(db, task_id: int, state: str) -> None:
    db.execute(
        "UPDATE enrichment_tasks SET state = ?, state_changed_at = ? "
        "WHERE id = ?",
        (state, _now(), task_id),
    )
    db.commit()


# ── Site-hint regeneration ─────────────────────────────────────────────────


def _hint_is_stale(updated_at: Optional[str]) -> bool:
    if not updated_at:
        return True
    try:
        ts = _dt.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return True
    age = _dt.datetime.now(_dt.timezone.utc) - ts
    return age.days >= SITE_HINT_REGEN_AFTER_DAYS


def _extracted_for_product_meta(entity) -> dict[str, Any]:
    """Compact extracted-fields dict for the meta-prompt sample."""
    return {
        "coffee_name": entity.coffee_name,
        "origin": entity.origin,
        "altitude_masl": entity.altitude_masl,
        "roast_level": entity.roast_level,
        "roast_level_name": entity.roast_level_name,
        "process_raw": entity.process_raw,
        "tasting_notes": entity.tasting_notes,
        "varietal": entity.varietal,
        "bean_type": entity.bean_type,
        "weight_grams": entity.weight_grams,
        "producer": entity.producer,
    }


def _extracted_for_article_meta(entity) -> dict[str, Any]:
    return {
        "title": entity.title,
        "excerpt": entity.excerpt,
        "topic_category": entity.topic_category,
        "tags": entity.tags,
        "published_at": entity.published_at,
        "word_count": entity.word_count,
        "is_about_coffee": entity.is_about_coffee,
    }


def _maybe_regenerate_product_hint(
    db,
    *,
    roaster_slug: str,
    roaster_name: str,
    force: bool,
    product_samples: list[dict[str, Any]],
    status: dict[str, str],
    log,
) -> None:
    meta = db.execute(
        "SELECT enrichment_prompt_hint, enrichment_prompt_hint_updated_at "
        "FROM roaster_profiles WHERE roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()
    if meta is None:
        status["product"] = "no_profile"
        return
    has_hint = bool((meta["enrichment_prompt_hint"] or "").strip())
    stale = _hint_is_stale(meta["enrichment_prompt_hint_updated_at"])
    if not force and has_hint and not stale:
        status["product"] = "cached"
        return
    if not product_samples:
        status["product"] = "no_pattern"
        return
    try:
        from services import site_prompt_generator
        picked = site_prompt_generator.pick_samples(product_samples)
        if not picked:
            status["product"] = "no_pattern"
            return
        addendum = site_prompt_generator.generate_site_prompt_hint(
            roaster_name=roaster_name or roaster_slug,
            samples=picked,
        )
    except Exception as e:
        log(f"  [hint/product] {roaster_slug}: {e}")
        status["product"] = "failed"
        return

    if addendum is None:
        status["product"] = "failed"
        return
    if addendum == "":
        status["product"] = "no_pattern"
        return
    now = _now()
    db.execute(
        "UPDATE roaster_profiles "
        "SET enrichment_prompt_hint = ?, "
        "    enrichment_prompt_hint_updated_at = ?, "
        "    updated_at = ? "
        "WHERE roaster_slug = ?",
        (addendum, now, now, roaster_slug),
    )
    db.commit()
    status["product"] = "regenerated" if has_hint else "generated"


def _maybe_regenerate_article_hint(
    db,
    *,
    roaster_slug: str,
    roaster_name: str,
    force: bool,
    article_samples: list[dict[str, Any]],
    status: dict[str, str],
    log,
) -> None:
    meta = db.execute(
        "SELECT article_enrichment_prompt_hint, "
        "       article_enrichment_prompt_hint_updated_at "
        "FROM roaster_profiles WHERE roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()
    if meta is None:
        status["article"] = "no_profile"
        return
    has_hint = bool((meta["article_enrichment_prompt_hint"] or "").strip())
    stale = _hint_is_stale(meta["article_enrichment_prompt_hint_updated_at"])
    if not force and has_hint and not stale:
        status["article"] = "cached"
        return
    if not article_samples:
        status["article"] = "no_pattern"
        return
    try:
        from services import article_site_prompt_generator
        picked = article_site_prompt_generator.pick_samples(article_samples)
        if not picked:
            status["article"] = "no_pattern"
            return
        addendum = article_site_prompt_generator.generate_article_site_prompt_hint(
            roaster_name=roaster_name or roaster_slug,
            samples=picked,
        )
    except Exception as e:
        log(f"  [hint/article] {roaster_slug}: {e}")
        status["article"] = "failed"
        return

    if addendum is None:
        status["article"] = "failed"
        return
    if addendum == "":
        status["article"] = "no_pattern"
        return
    now = _now()
    db.execute(
        "UPDATE roaster_profiles "
        "SET article_enrichment_prompt_hint = ?, "
        "    article_enrichment_prompt_hint_updated_at = ?, "
        "    updated_at = ? "
        "WHERE roaster_slug = ?",
        (addendum, now, now, roaster_slug),
    )
    db.commit()
    status["article"] = "regenerated" if has_hint else "generated"


# ── Main entry point ───────────────────────────────────────────────────────


def run_for_roaster(
    db,
    roaster_slug: str,
    *,
    kinds: Iterable[EntityKind] = ("product", "article"),
    force_enrich: bool = False,
    regenerate_hint: bool = False,
    job_id: Optional[int] = None,
    parent_run_id: Optional[int] = None,
    log: Optional[Callable[[str], None]] = None,
) -> RunResult:
    """Run v2 enrichment for one roaster across the requested kinds.

    Returns a `RunResult` with per-kind counts + coverage_pct + site
    hint status. Errors are collected per-URL — one failure doesn't
    abort the rest.
    """
    log = log or (lambda _msg: None)
    kinds = tuple(kinds)
    result = RunResult(roaster_slug=roaster_slug, kinds_requested=list(kinds))

    meta = _load_roaster_meta(db, roaster_slug)
    if meta is None:
        result.errors.append(f"no roaster profile for {roaster_slug!r}")
        result.ended_at = _now()
        return result

    # Per-kind site hints. Loaded once at the start of the run so every
    # enrich_url call gets the addendum without an extra DB hit.
    product_hint = meta.get("enrichment_prompt_hint") or None
    article_hint = meta.get("article_enrichment_prompt_hint") or None

    # Sample collectors for the post-run hint regeneration. Each entry is
    # `{product_url|url, page_text, extracted}` — the shape both site
    # hint generators' `pick_samples` consumes.
    product_meta_samples: list[dict[str, Any]] = []
    article_meta_samples: list[dict[str, Any]] = []

    log(f"discovering URLs for {roaster_slug} (kinds={list(kinds)})")
    disco = discover_entities(meta, kinds=kinds, log=log)
    for k in kinds:
        result.per_kind[k] = KindStats(
            discovered=disco.per_kind_breakdown.get(k, 0)
        )
    for err in disco.errors:
        result.errors.append(f"discover: {err}")
    log(
        "  discovered: "
        + ", ".join(f"{k}={n}" for k, n in disco.per_kind_breakdown.items())
    )

    # Two-stage filter for products: URL/title exclusion (Stage 1,
    # pre-fetch, zero-cost) THEN page-text inclusion (Stage 2, post-
    # fetch, no-LLM cost) per the user's directive: "exclusion-only
    # is unbounded; bean markers in the page bound the problem."
    from services.product_filters import (
        is_url_excluded as _stage1_excluded,
        has_bean_markers as _stage2_bean_markers,
        is_non_bean_format_text as _stage2_format_text,
    )

    # Enrich each URL.
    for d in disco.urls:
        stats = result.per_kind[d.kind]

        # ── Stage 1: URL/title exclusion. No task row, no fetch,
        # no LLM. Catches merch / equipment / bundles / samplers /
        # capsules / subscriptions / RTD / etc.
        if d.kind == "product":
            aug_title, aug_tags, aug_type = _augmenter_signals(d.augmented or {})
            excluded, reason = _stage1_excluded(
                d.url, title=aug_title, tags=aug_tags, product_type=aug_type,
            )
            if excluded:
                stats.pre_filter_excluded += 1
                log(f"  [stage1/{d.kind}] {d.url}: {reason}")
                # If an existing `products` row matches this URL, flip
                # it to `available=0, enrichment_status='filter_reject'`.
                # Stage 1 rejected today; the row should not be in the
                # catalog. (Filter rules may have tightened since the
                # row was first inserted — the prior `_already_enriched`
                # short-circuit permanently grandfathered such rows.)
                _flag_existing_product_row(
                    db, url=d.url, status="filter_reject",
                    reason=reason, log=log,
                )
                continue

        task_id = _open_task(
            db, kind=d.kind, url=d.url, roaster_slug=d.roaster_slug,
            job_id=job_id,
        )

        # NOTE: the `_already_enriched` short-circuit that used to live
        # here was removed (2026-05-27). It conflated catalog membership
        # (Stage 1/2) with Haiku cost — and the cost-skip side-effect
        # bypassed Stage 1/2 too. Enrichment ops now always re-walk the
        # full pipeline; the refresh-layer diff gate is what decides
        # whether to invoke enrichment at all. See the runbook entry on
        # the "stale URL / grandfathered bundle" audit.

        _set_task_state(db, task_id, "fetching")
        page_text, hints = fetch_page(d.url, kind=d.kind)
        # Retry transient empties with exponential backoff. A force
        # re-enrich of a large catalog fires fetches back-to-back; the
        # source can rate-limit (empty body / HEAD network_error) after a
        # burst, which PREVIOUSLY failed every subsequent product and left
        # them un-re-enriched — the mokkafarms 85-URL force run self-DoS'd,
        # leaving silent_empty stuck at 12 even though the source_thin fix
        # was correct. Back off so the throttle window passes and the fetch
        # recovers. Products only; and never when the URL is a hard-dead
        # status (404/410/402 = genuinely gone — not a throttle, don't wait).
        if not page_text and d.kind == "product":
            import time as _time
            for _backoff in (4, 12, 30):
                if is_dead_status(head_check_url(d.url)):
                    break  # genuinely gone, not throttled — don't retry
                _time.sleep(_backoff)
                page_text, hints = fetch_page(d.url, kind=d.kind)
                if page_text:
                    log(
                        f"  [retry-ok/{d.kind}] {d.url}: recovered after "
                        f"{_backoff}s backoff (source throttle)"
                    )
                    break
        if not page_text:
            # Distinguish a permanent dead status (catalog row should
            # be flagged `url_dead`) from a transient failure (row
            # preserved as-is). HEAD-check the URL — 404/410/402 mean
            # the resource is gone for good (see DEAD_HTTP_STATUSES;
            # 402 is the Shopify subscription-suspended storefront).
            # Any other response code (or network error) is treated as
            # transient and leaves the row untouched.
            status_code = None
            if d.kind == "product":
                status_code = head_check_url(d.url)
            if is_dead_status(status_code):
                stats.failed += 1
                mark_task_failed(
                    db, task_id=task_id,
                    error=f"page fetch returned empty (HEAD={status_code})",
                    job_id=job_id,
                )
                log(f"  [dead/{d.kind}] {d.url}: HEAD={status_code}")
                # Flag the existing `products` row (if any) as
                # url_dead. Field values are preserved — only
                # availability + status flip. Coral-Rum class
                # corruption (weight rewritten on 404'd URL) is
                # avoided because `_flag_existing_product_row`
                # only touches `available` + `enrichment_status`.
                _flag_existing_product_row(
                    db, url=d.url, status="url_dead",
                    reason=f"HEAD={status_code}", log=log,
                )
            else:
                stats.failed += 1
                mark_task_failed(
                    db, task_id=task_id,
                    error=(
                        f"page fetch returned empty"
                        f" (HEAD={status_code or 'network_error'})"
                    ),
                    job_id=job_id,
                )
                log(
                    f"  [fail/{d.kind}] {d.url}: fetch empty "
                    f"(HEAD={status_code or 'network_error'})"
                )
                # Existing row preserved — transient failure or
                # ambiguous response, do not flip availability.
            continue

        # ── Stage 2a: non-bean FORMAT rejection on body text. Beans-only
        # scope — single-serve drip-bag / pour-over-sachet / brew-bag
        # FORMATS are out (grind is fine, format is not). Stage 1 checks
        # the title/URL/slug; this catches formats whose marker survives
        # only in body prose (ARAKU "Pocket Brew" → "10 single-serve drip
        # bag sachets" in the body, title just "Pocket Brew - Selection").
        # Run BEFORE the bean-marker gate so a format page that
        # legitimately carries bean markers (it describes the coffee
        # inside the sachets) is excluded rather than enriched as a bean.
        if d.kind == "product":
            fmt = _stage2_format_text(page_text)
            if fmt:
                stats.pre_filter_excluded += 1
                mark_task_skipped(
                    db, task_id=task_id,
                    reason=f"non-bean-format-text={fmt!r}",
                    job_id=job_id,
                )
                log(f"  [stage2-format/{d.kind}] {d.url}: format={fmt!r}")
                _flag_existing_product_row(
                    db, url=d.url, status="filter_reject",
                    reason=f"non-bean-format-text={fmt!r}", log=log,
                )
                continue

        # ── Stage 2: page-text bean-marker inclusion check for
        # products. After fetch, before Haiku. If the page lacks
        # ≥3 total markers across ≥2 categories (roast/process/
        # origin/varietal/shape), it's not a bean — skip without
        # invoking the LLM. This is the inclusion gate that bounds
        # the otherwise-infinite "not a bean" universe.
        if d.kind == "product":
            passes, report = _stage2_bean_markers(page_text)
            # Platform-metadata bypass (2026-05-30, lesson 83 / Class E):
            # a thin storefront-chrome page (Sikkim's ~800-char roast SKUs)
            # carries < 3 visible-text markers but is unambiguously coffee
            # by product_type='Coffee' / 'Whole Beans' / 'Grounded' variant
            # labels. Without this, 2 of Sikkim's 3 roasts were silently
            # dropped as 'no-bean-markers' and never created a row.
            if not passes and _strong_platform_bean_signal(
                d.augmented or {}, page_text
            ):
                passes = True
                log(
                    f"  [stage2-bypass/{d.kind}] {d.url}: "
                    "platform bean signal (product_type/grind variant)"
                )
            if not passes:
                stats.no_bean_markers += 1
                total = sum(report.values())
                cats = sum(1 for v in report.values() if v > 0)
                mark_task_skipped(
                    db, task_id=task_id,
                    reason=f"no-bean-markers: total={total} cats={cats}",
                    job_id=job_id,
                )
                log(
                    f"  [stage2/{d.kind}] {d.url}: "
                    f"no bean markers (total={total} cats={cats})"
                )
                # If an existing `products` row matches this URL,
                # flip it to `available=0, enrichment_status=
                # 'filter_reject'`. Stage 2 rejected the page text
                # today — either the page no longer carries bean
                # markers (SKU replaced) or the URL serves a non-
                # bean page now (catalog-cleanup case).
                _flag_existing_product_row(
                    db, url=d.url, status="filter_reject",
                    reason=f"no-bean-markers: total={total} cats={cats}",
                    log=log,
                )
                continue

        # Merge per-URL augmentation from discovery (Shopify variants,
        # Atom feed stub) into the page-fetched hints. The augmenter
        # attaches raw platform payloads under `shopify_raw` /
        # `woocommerce_raw`; flatten the bits the enricher actually
        # reads (variants, tags, title, listing description, price)
        # to the top level so `entity_enricher._build_product_user_content`
        # finds them by name.
        merged_hints = {**hints, **(d.augmented or {})}
        shopify_raw = (d.augmented or {}).get("shopify_raw") or {}
        woo_raw = (d.augmented or {}).get("woocommerce_raw") or {}
        platform_raw = shopify_raw or woo_raw
        # Per-URL platform fallback: discovery-time augmentation keys
        # platform payloads by canonical URL and silently no-ops when
        # that keying drifts, leaving price/weight/image to Haiku alone.
        # Fetch the product's own canonical platform JSON when the
        # augmentation missed so this scrape path recovers the same
        # platform price the v2 inline path does. (See
        # _fetch_platform_raw_by_url for the inline-vs-scrape rationale.)
        if d.kind == "product" and not platform_raw:
            _pkey, _praw = _fetch_platform_raw_by_url(
                meta.get("platform"), d.url,
            )
            if _pkey == "shopify_raw":
                shopify_raw = _praw
            elif _pkey == "woocommerce_raw":
                woo_raw = _praw
            platform_raw = shopify_raw or woo_raw
            if _praw:
                log(
                    f"  [augment-fallback/{_pkey}] {d.url}: "
                    "recovered platform payload"
                )
        if d.kind == "product" and platform_raw:
            if not merged_hints.get("variants"):
                merged_hints["variants"] = platform_raw.get("variants") or []
            if not merged_hints.get("tags"):
                # Normalize Shopify comma-string tags AND WooCommerce
                # list-of-dicts tags to a flat list of strings — the
                # Woo dict shape otherwise crashes the downstream
                # `", ".join(tags)` in entity_enricher.
                merged_hints["tags"] = _normalize_platform_tags(
                    platform_raw.get("tags")
                )
            if not merged_hints.get("title"):
                merged_hints["title"] = (
                    platform_raw.get("title") or platform_raw.get("name")
                )
            if not merged_hints.get("listing_description"):
                merged_hints["listing_description"] = (
                    platform_raw.get("body_html")
                    or platform_raw.get("description")
                )
            # Platform image as the authoritative fallback when
            # page_fetcher's product-image picker missed (some Shopify
            # themes JS-render the gallery so the static HTML has no
            # <img> at all — but products.json carries images[0].src).
            if not merged_hints.get("image_url"):
                images = platform_raw.get("images") or []
                first_img = images[0] if images else None
                if isinstance(first_img, dict):
                    merged_hints["image_url"] = (
                        first_img.get("src") or first_img.get("url")
                    )
                elif isinstance(first_img, str):
                    merged_hints["image_url"] = first_img
            # Platform price + weight from the picked variant. The
            # platform API is the dependable canonical; Haiku's
            # page-text parse is the fallback (it concatenates /
            # mis-parses — Vithai's ₹900200g symptom). When variants
            # exist we take BOTH price and weight from the SAME chosen
            # variant and let them OVERRIDE Haiku, so we never pair
            # Haiku's small-sticker weight with a large variant's price
            # (Takaraa's ₹2899-with-20g impossible-combination class).
            # Previously this whole block was gated on Haiku having
            # missed the price — so once Haiku read any sticker value
            # the variant override never fired and the mismatch stuck.
            #
            # `_pick_default_variant` picks the URL-handle-hinted
            # variant first (Coral Rum's `-1-kg` → 1000g variant),
            # then the largest bag size, then variants[0]. The prior
            # variants[0] behavior collapsed multi-variant beans to
            # their smallest SKU (Caffinary 50g sachets, Takaraa 20g
            # tasters showing up as full-bag prices).
            variants = platform_raw.get("variants") or []
            picked_var = _pick_default_variant(variants, url=d.url)
            if isinstance(picked_var, dict):
                raw_price = picked_var.get("price")
                if raw_price is not None:
                    try:
                        merged_hints["price_inr"] = float(raw_price)
                    except (TypeError, ValueError):
                        pass
                weight = _variant_bag_grams(picked_var)
                if weight is not None:
                    # "Pack of N" multiplier — Nandan Lil'More Pour
                    # Over Pack of 10 reports per-bag grams; total bag
                    # weight = N × per-bag. Detect via product title
                    # OR variant title.
                    pack_n = _extract_pack_count(
                        merged_hints.get("title"),
                        picked_var.get("title"),
                        platform_raw.get("title"),
                    )
                    if pack_n is not None:
                        weight = weight * pack_n
                        merged_hints["pack_count"] = pack_n
                    merged_hints["weight_grams"] = weight

            # WooCommerce price: the picker above no-ops for Woo (no
            # priced `variants`), so read the Store API `prices` block
            # directly as an authoritative override whenever we don't
            # already hold a positive price. Image / title / listing
            # already flow through the platform_raw block above (Woo
            # carries `images[].src` + `name` + `description`). Weight
            # for Woo stays with the page-text parse (it lives in the
            # product description, not `prices`).
            if woo_raw:
                try:
                    _cur = float(merged_hints.get("price_inr") or 0)
                except (TypeError, ValueError):
                    _cur = 0.0
                if _cur <= 0:
                    woo_price = _woo_price_inr(woo_raw)
                    if woo_price is not None:
                        merged_hints["price_inr"] = woo_price

            # Availability from platform stock data. The page text rarely
            # says "sold out" — the buy button is just disabled — so a
            # text-only enrich leaves a sold-out coffee showing as buyable
            # (entity_enricher defaults available=True). Derive it from the
            # canonical platform signal instead: Shopify marks each variant
            # `available`; WooCommerce carries product-level `is_in_stock` /
            # `is_purchasable`. Flip to False ONLY on an explicit
            # out-of-stock signal (never a missing/None field) so we never
            # hide a live product. (Curious Life "Shyira Rwanda Espresso",
            # priced ₹1780 with a disabled buy button, was the trigger.)
            #
            # PLATFORM-GATED, EXPLICIT-SIGNAL-ONLY (hardened 2026-05-30).
            # This block ONLY runs for Shopify (variant.available) and
            # WooCommerce (is_in_stock / is_purchasable) — the two
            # platforms that expose a STRUCTURED stock field. For
            # Magento / custom / Wix there is no structured stock field,
            # so we must NEVER infer out-of-stock from the absence of a
            # signal: a thin/failed fetch on those platforms must leave
            # `available` at its incoming default (True) rather than
            # hiding a live, in-stock bean. (Ainmane Magento
            # "Robusta of Coorg", live page "₹350 / In stock", was the
            # trigger — its catalog row must stay available=1 through a
            # re-enrich.) The page-text "sold out" path is handled
            # separately by the CanonicalProduct._no_price_means_sold_out
            # validator, which ALSO requires a positive signal
            # (sold_out_signal=True) AND a null/zero price before it
            # flips — so neither path can hide a priced, structured-
            # stock-less product.
            if shopify_raw:
                _vs = [
                    v for v in (shopify_raw.get("variants") or [])
                    if isinstance(v, dict)
                ]
                # Require BOTH a non-empty variant list AND every variant
                # explicitly available is False. An empty/None variant
                # list is "no signal" → don't touch availability.
                if _vs and all(v.get("available") is False for v in _vs):
                    merged_hints["available"] = False
            elif woo_raw:
                if (
                    woo_raw.get("is_in_stock") is False
                    or woo_raw.get("is_purchasable") is False
                ):
                    merged_hints["available"] = False
            # else: Magento / custom / Wix → NO structured stock field;
            # leave `available` untouched (never infer OOS from absence).

        # URL size-hint weight fallback. When no platform variant supplied a
        # bag size, a size token in the product URL handle (Takaraa encodes
        # ".../...-takaraa-1-kg", others "-250g"/"-500gm") is an authoritative
        # weight. The adapter is hints-first for weight, so this prevents
        # Haiku's per-serving/sample mis-read (e.g. "20g") from landing as the
        # bag size — the Coral Rum ₹3799/20g variant_mismatch class.
        if d.kind == "product" and not merged_hints.get("weight_grams"):
            _u_g = _url_size_hint_grams(d.url)
            if _u_g:
                merged_hints["weight_grams"] = _u_g

        _set_task_state(db, task_id, "llm_pending")
        addendum = product_hint if d.kind == "product" else article_hint
        try:
            entity, gate_status = enrich_url(
                kind=d.kind,
                url=d.url,
                roaster_slug=d.roaster_slug,
                page_text=page_text,
                hints=merged_hints,
                scraped_at=_now(),
                system_addendum=addendum,
                parent_run_id=parent_run_id,
                task_id=task_id,
            )
        except Exception as e:
            # 2026-05-26 stuck-llm_pending fix: an uncaught exception
            # from enrich_url (e.g. SDK timeout, model unavailable,
            # JSON parse fail on Haiku output, validation error from
            # Pydantic) was leaving the task stuck at llm_pending
            # forever — the post-sweep audit surfaced 16 such tasks
            # with llm_job_id=null (never reached the LLM enqueue
            # step at all). Flipping to failed here preserves the
            # state machine invariant: every llm_pending row
            # eventually transitions to enriched / failed / skipped.
            stats.failed += 1
            mark_task_failed(
                db, task_id=task_id,
                error=f"enrich_url:{type(e).__name__}: {str(e)[:200]}",
                job_id=job_id,
            )
            log(f"  [fail/{d.kind}] {d.url}: enrich_url crashed — {e}")
            continue

        if entity is None:
            # Distinguish a successful gate decision ("this isn't a
            # bean / article") from a transient pipeline failure.
            # Gate decisions land as state=skipped (same bucket as
            # Stage 1+2 rejections — quiet, cheap). LLM / validation
            # failures land as state=failed so the operator sees them
            # in the triage tail.
            if gate_status and gate_status.startswith("gated_"):
                stats.gate_rejected += 1
                mark_task_skipped(
                    db, task_id=task_id,
                    reason=f"gated_out_haiku:{gate_status}",
                    job_id=job_id,
                )
            else:
                stats.failed += 1
                mark_task_failed(
                    db, task_id=task_id,
                    error=f"enricher:{gate_status or 'unknown'}",
                    job_id=job_id,
                )
                log(f"  [fail/{d.kind}] {d.url}: enricher:{gate_status}")
            continue

        try:
            upsert = upsert_entity(
                db, entity, task_id=task_id, job_id=job_id,
            )
        except Exception as e:
            stats.failed += 1
            mark_task_failed(
                db, task_id=task_id, error=f"upsert: {e}",
                job_id=job_id,
            )
            log(f"  [fail/{d.kind}] {d.url}: upsert {e}")
            continue

        stats.enriched += 1
        if upsert.action == "inserted":
            stats.inserted += 1
        elif upsert.action == "updated":
            stats.updated += 1
        elif upsert.action == "skipped_unchanged":
            stats.skipped_unchanged += 1
        log(f"  [{upsert.action}/{d.kind}] {d.url}")

        # ── Quality reviewer T1 + T2 (2026-05-26) ─────────────────
        # Trust-but-verify pass: after every successful enrichment,
        # run deterministic heuristics (T1) over the upserted row.
        # If T1 flags anything, fire a Haiku adversarial reviewer
        # (T2) to confirm or clear. Resulting verdicts persist in
        # the `quality_reviews` table for the orchestrator to triage
        # (T3 Opus override is orchestrator-fired only — see
        # crema_run_quality_review_t3).
        try:
            _run_quality_review(
                db, entity=entity, page_text=page_text,
                kind=d.kind, target_id=upsert.result_id,
                roaster_slug=d.roaster_slug, log=log,
            )
        except Exception as e:
            # Quality review is best-effort — never let it block
            # the enrichment pipeline. Failures get logged for
            # observability but don't fail the row.
            log(f"  [quality_review/{d.kind}] {d.url}: WARN {type(e).__name__}: {e}")

        # Stash a meta-sample for the post-run hint regen.
        if d.kind == "product":
            product_meta_samples.append({
                "product_url": d.url,
                "page_text": page_text,
                "extracted": _extracted_for_product_meta(entity),
            })
        else:
            article_meta_samples.append({
                "url": d.url,
                "page_text": page_text,
                "extracted": _extracted_for_article_meta(entity),
            })

    # Coverage = enriched / discovered. Skipped-already-enriched counts
    # as enriched for coverage purposes (the data is there).
    for k in kinds:
        s = result.per_kind[k]
        if s.discovered > 0:
            s.coverage_pct = (
                100.0 * (s.enriched + s.skipped_already_enriched) / s.discovered
            )
        else:
            s.coverage_pct = 0.0

    # Site-hint regeneration AFTER the per-URL loop so the samples
    # picked include this run's freshly-enriched rows. Roaster name
    # for the meta-prompt comes from a user account, or falls back to
    # the slug.
    name_row = db.execute(
        "SELECT display_name FROM users WHERE roaster_slug = ? "
        "  AND account_type = 'roaster' LIMIT 1",
        (roaster_slug,),
    ).fetchone()
    roaster_name = (name_row["display_name"] if name_row else None) or roaster_slug

    if "product" in kinds:
        _maybe_regenerate_product_hint(
            db,
            roaster_slug=roaster_slug,
            roaster_name=roaster_name,
            force=regenerate_hint,
            product_samples=product_meta_samples,
            status=result.site_hint_status,
            log=log,
        )
    if "article" in kinds:
        _maybe_regenerate_article_hint(
            db,
            roaster_slug=roaster_slug,
            roaster_name=roaster_name,
            force=regenerate_hint,
            article_samples=article_meta_samples,
            status=result.site_hint_status,
            log=log,
        )

    result.ended_at = _now()
    return result


# ── Quality reviewer integration ───────────────────────────────────────────


def _entity_to_dict_for_review(entity) -> dict:
    """Project a CanonicalProduct/CanonicalArticle into a flat dict
    the quality_reviewer module can consume."""
    if entity is None:
        return {}
    if hasattr(entity, "model_dump"):
        return entity.model_dump(exclude_none=False)
    return dict(entity)


def _run_quality_review(
    db, *, entity, page_text: str, kind: str, target_id: Optional[str],
    roaster_slug: str, log,
) -> None:
    """Run T1 + T2 for one freshly-upserted entity. Best-effort.

    T1 is free (deterministic). T2 fires only if T1 flagged anything.
    T3 is NOT triggered here — that's orchestrator-fired via the
    crema_run_quality_review_t3 MCP tool so Opus spend stays
    deliberate.
    """
    if not target_id:
        return
    from services import quality_reviewer as qr

    entity_dict = _entity_to_dict_for_review(entity)

    if kind == "product":
        # Resolve roaster_name for the brand-as-name heuristic.
        rn_row = db.execute(
            "SELECT name FROM roaster_profiles WHERE roaster_slug = ?",
            (roaster_slug,),
        ).fetchone()
        roaster_name = (rn_row["name"] if rn_row else "") or roaster_slug
        bundle = qr.run_t1_product(
            entity=entity_dict, page_text=page_text or "",
            roaster_name=roaster_name, product_id=str(target_id),
        )
    elif kind == "article":
        bundle = qr.run_t1_article(
            entity=entity_dict, page_text=page_text or "",
            article_id=str(target_id),
        )
    else:
        return

    now_iso = _now()
    qr.persist_flags(db, bundle, now_iso=now_iso)
    if not bundle.flags:
        return  # clean row; no T2 needed

    log(
        f"  [quality_review/{kind}] {target_id}: "
        f"T1 flagged {len(bundle.flags)} ({[f.rule for f in bundle.flags]})"
    )

    # T2 — Haiku adversarial reviewer
    description_raw = (
        entity_dict.get("description_raw") if kind == "product" else None
    )
    try:
        verdicts = qr.run_t2_review(
            entity=entity_dict, page_text=page_text or "",
            description_raw=description_raw, flags=bundle.flags,
            roaster_slug=roaster_slug, target_id=str(target_id),
        )
    except Exception as e:
        log(
            f"  [quality_review/{kind}] {target_id}: "
            f"T2 review FAILED {type(e).__name__}: {e} — "
            "leaving T1 flags as 'pending'"
        )
        return
    if not verdicts:
        log(
            f"  [quality_review/{kind}] {target_id}: "
            "T2 returned no verdicts — leaving T1 flags as 'pending'"
        )
        return
    counts = qr.persist_t2_verdicts(
        db, target_table=bundle.target_table, target_id=str(target_id),
        verdicts=verdicts, now_iso=now_iso,
    )
    log(
        f"  [quality_review/{kind}] {target_id}: "
        f"T2 verdicts confirmed={counts['confirmed']} "
        f"cleared={counts['cleared']} unsure={counts['unsure']}"
    )


# ── Stuck-task reaper ──────────────────────────────────────────────────────


def reap_stuck_llm_pending(
    db,
    *,
    older_than_minutes: int = 5,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Reap enrichment_tasks rows stuck at state='llm_pending' beyond
    `older_than_minutes`.

    Why this exists: when the BG enrichment worker dies mid-execution
    (process restart, OOM, unhandled exception from the LLM SDK
    pre-fix), tasks set to llm_pending at line 578 of run_for_roaster
    never transition to enriched/failed/skipped. The post-bulk-sweep
    audit on 2026-05-26 surfaced 21 such tasks. The try/except added
    to enrich_url prevents new leaks; this function heals the existing
    ones AND any future stragglers that survive an unrecoverable
    crash (e.g. SIGKILL between the state flip and the try block).

    Reaping rule:
      • If result_table + result_id are set AND that row exists in
        the target table → the upsert DID succeed; flip state to
        'enriched' (state-machine straggler).
      • Else → the enrichment didn't complete; flip state to 'failed'
        with last_error='reaped:stuck_llm_pending_<minutes>m'.

    Safe to run repeatedly — idempotent. dry_run=True reports what
    WOULD be reaped without writing.
    """
    import datetime as _dt
    cutoff = (
        _dt.datetime.now(_dt.timezone.utc)
        - _dt.timedelta(minutes=older_than_minutes)
    ).isoformat().replace("+00:00", "Z")

    stuck_rows = db.execute(
        "SELECT id, kind, url, roaster_slug, result_table, result_id, "
        "       state_changed_at "
        "FROM enrichment_tasks "
        "WHERE state = 'llm_pending' AND state_changed_at < ? "
        "ORDER BY state_changed_at",
        (cutoff,),
    ).fetchall()

    advanced_to_enriched: list[dict[str, Any]] = []
    advanced_to_failed: list[dict[str, Any]] = []

    for row in stuck_rows:
        task_id = row["id"]
        result_table = row["result_table"]
        result_id = row["result_id"]

        target_exists = False
        if result_table in ("products", "roaster_articles") and result_id:
            id_col = (
                "product_id" if result_table == "products" else "id"
            )
            target_row = db.execute(
                f"SELECT 1 FROM {result_table} WHERE {id_col} = ? LIMIT 1",
                (result_id,),
            ).fetchone()
            target_exists = target_row is not None

        record = {
            "task_id": task_id,
            "kind": row["kind"],
            "url": row["url"],
            "roaster_slug": row["roaster_slug"],
            "stuck_since": row["state_changed_at"],
        }
        if target_exists:
            advanced_to_enriched.append(record)
        else:
            advanced_to_failed.append(record)

    if not dry_run:
        for r in advanced_to_enriched:
            db.execute(
                "UPDATE enrichment_tasks SET state = 'enriched', "
                "  state_changed_at = ?, last_error = NULL "
                "WHERE id = ?",
                (_now(), r["task_id"]),
            )
        for r in advanced_to_failed:
            db.execute(
                "UPDATE enrichment_tasks SET state = 'failed', "
                "  state_changed_at = ?, "
                "  last_error = ? "
                "WHERE id = ?",
                (_now(),
                 f"reaped:stuck_llm_pending_{older_than_minutes}m",
                 r["task_id"]),
            )
        db.commit()

    return {
        "dry_run": dry_run,
        "older_than_minutes": older_than_minutes,
        "cutoff": cutoff,
        "stuck_count": len(stuck_rows),
        "advanced_to_enriched": advanced_to_enriched,
        "advanced_to_failed": advanced_to_failed,
    }


# ── CLI for manual testing ────────────────────────────────────────────────


def _cli() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Run v2 enrichment for one roaster.")
    ap.add_argument("slug", help="roaster_slug")
    ap.add_argument("--kind", action="append",
                    choices=["product", "article"], default=None,
                    help="Restrict to one kind (default: both)")
    ap.add_argument("--force-enrich", action="store_true")
    ap.add_argument("--regenerate-hint", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from database import get_db

    kinds = tuple(args.kind) if args.kind else ("product", "article")
    db = get_db()
    try:
        result = run_for_roaster(
            db, args.slug,
            kinds=kinds,
            force_enrich=args.force_enrich,
            regenerate_hint=args.regenerate_hint,
            log=lambda m: print(m),
        )
    finally:
        db.close()

    print()
    print(json.dumps(result.to_summary(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_cli())


__all__ = ["RunResult", "KindStats", "run_for_roaster"]
