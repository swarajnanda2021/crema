"""Write CanonicalProduct / CanonicalArticle into the catalog.

The provenance gate lives here. Rules (per AGENTIC_UTOPIA.md rule 4):

  • `admin_manual` rows are STICKY — never overwritten by a
    Haiku-provenance write unless the caller explicitly forces it.
    The admin's edits survive every refresh.
  • `bs4_fallback` writes land with `published=0` for articles
    (admin should review). For products there's no `published` flag;
    `enrichment_status='failed'` flags them for admin attention.
  • Owner-set columns (`wholesale_*`, `source='claimed'`) are
    coalesced from the live row so a roaster's edits survive an
    admin-approved refresh.

Also responsible for transitioning the matching enrichment_tasks row
to `state='enriched'` (success) or `state='failed'` (error), with
`extraction_provenance` stamped and `result_table` / `result_id`
linked back to the canonical row.
"""

from __future__ import annotations

import datetime as _dt
import html
import json
import re
from dataclasses import dataclass
from typing import Any, Literal, Optional
from urllib.parse import urlparse

from services.canonical_entity import (
    BaseEntity,
    CanonicalArticle,
    CanonicalProduct,
)


# coffee_name normalization — added 2026-05-25. Catches three classes
# of scraper-artifact junk that were surfacing on coffee cards:
#  • HTML entities ("&#8211;" → "–", "&amp;" → "&")
#  • Pipe-tail page-title leakage ("Foo Coffee | Site Name" → "Foo Coffee")
#  • Trailing weight suffixes ("Foo - 250g" → "Foo")
# Does NOT touch ALL-CAPS strings — some roasters (DEVAN'S, BROOT)
# market in all-caps deliberately and rewriting them would lose
# brand voice. Admin can override case via manual edit.
_NAME_WEIGHT_SUFFIX_RE = re.compile(
    r"\s*[-–—]?\s*\d+\s*(?:g|gm|gms|gram|grams|kg)\b\s*$",
    re.IGNORECASE,
)


def _normalize_coffee_name(name: Optional[str]) -> Optional[str]:
    """Strip scraper-artifact junk from coffee_name before persisting.
    Returns the cleaned name (possibly equal to input) or None when the
    input is None / empty after cleanup."""
    if not name:
        return name
    cleaned = html.unescape(name)
    if "|" in cleaned:
        cleaned = cleaned.split("|", 1)[0]
    cleaned = _NAME_WEIGHT_SUFFIX_RE.sub("", cleaned).strip()
    return cleaned or None


UpsertAction = Literal[
    "inserted", "updated", "skipped_unchanged",
    "gated_admin_manual", "rejected_invalid",
]


@dataclass
class UpsertResult:
    action: UpsertAction
    result_table: Optional[str]
    result_id: Optional[Any]
    note: Optional[str] = None


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    if not text:
        return "unknown"
    slug = _SLUG_NON_ALNUM.sub("-", text.lower()).strip("-")
    return slug or "unknown"


def _handle_from_url(url: Optional[str]) -> Optional[str]:
    """The product's STABLE handle = the last path segment of the URL
    (Shopify /products/<handle>, Woo /product/<handle>/, custom /<uuid>).
    Returns a slugified handle, or None when the URL has no usable path
    segment. This is unique per SKU even when the cleaned coffee_name is
    not (see `_product_id_for`)."""
    if not url:
        return None
    try:
        path = urlparse(url).path
    except Exception:
        return None
    seg = path.rstrip("/").rsplit("/", 1)[-1].strip()
    if not seg:
        return None
    slug = _slugify(seg)
    return slug if slug and slug != "unknown" else None


def _product_id_for(entity: CanonicalProduct) -> str:
    """Derive a STABLE, UNIQUE product_id. Prefer the URL handle over the
    cleaned coffee_name (2026-05-30, Class E).

    The cleaned coffee_name is LOSSY: Haiku's coffee_name_clean strips the
    roast suffix (' - <Roast> Roast'), so a roaster's 3 roast SKUs of the
    same coffee all clean to the SAME name and collide on one product_id —
    only 1 of 3 survives the insert. Sikkim Coffee shipped "Sikkim Coffee
    Medium / Dark / Medium-Dark Roast" (3 distinct handles, ₹750 each) and
    the catalog kept only 1. The URL handle (.../products/sikkim-coffee-
    dark-roast) stays distinct per SKU, so key off it. Existing rows are
    unaffected: upsert_entity matches the live row by product_url FIRST and
    reuses its stored product_id — this derivation only fires for a genuine
    new insert. Falls back to the cleaned-name slug when the URL has no
    usable handle (custom storefronts with opaque paths)."""
    handle = _handle_from_url(entity.url)
    if handle:
        return f"{entity.roaster_slug}_{handle}"
    return f"{entity.roaster_slug}_{_slugify(entity.coffee_name)}"


_URL_SCHEME_RE = re.compile(r"^https?://", re.I)
_URL_WWW_RE = re.compile(r"^www\.", re.I)


def _url_match_variants(url: str) -> list:
    """All scheme / www / trailing-slash surface forms of a product URL.

    product_url is the STABLE identity across re-enrichments, but only
    if the existing-row match is surface-insensitive. The 2026-05-29
    re-enrich created duplicate rows (reserved-india `geisha-village-092`
    name-slug beside the stored `gesha-village-092` handle-slug;
    mokkafarms `100-arabica-whole-coffee-beans` beside `100-arabica`)
    purely because discovery hit the BARE-domain form
    (`mokkafarms.com/products/bean100ara`) while the row was stored under
    the `www.` form (`www.mokkafarms.com/products/bean100ara`) — same
    host+path, different surface. The exact-match (trailing-slash-tolerant
    only) lookup missed it and fell through to a name-derived product_id
    that had drifted from the stored id, so it INSERTed a dup.

    Enumerate {https,http} × {bare,www} × {with,without trailing slash}
    so the bare/www/scheme/slash form of an already-stored product
    always UPDATEs the live row in place. Path case is preserved (Shopify
    handles are lower-case at source; we don't risk a case-fold mismatch
    on the path)."""
    u = (url or "").strip()
    if not u:
        return []
    core = _URL_SCHEME_RE.sub("", u)
    core = _URL_WWW_RE.sub("", core).rstrip("/")
    if not core:
        return []
    out = set()
    for host_core in (core, "www." + core):
        for scheme in ("https://", "http://"):
            out.add(scheme + host_core)
            out.add(scheme + host_core + "/")
    return sorted(out)


def upsert_entity(
    db,
    entity: BaseEntity,
    *,
    task_id: Optional[int] = None,
    job_id: Optional[int] = None,
    force_admin_overwrite: bool = False,
) -> UpsertResult:
    """Write `entity` to its kind's table and update the matching
    enrichment_tasks row (if `task_id` provided)."""
    if isinstance(entity, CanonicalProduct):
        result = _upsert_product(
            db, entity, force_admin_overwrite=force_admin_overwrite,
        )
    elif isinstance(entity, CanonicalArticle):
        result = _upsert_article(
            db, entity, force_admin_overwrite=force_admin_overwrite,
        )
    else:
        return UpsertResult("rejected_invalid", None, None,
                            note=f"unknown entity type: {type(entity).__name__}")

    if task_id is not None:
        _mark_task_enriched(
            db, task_id=task_id,
            provenance=entity.extraction_provenance,
            result_table=result.result_table,
            result_id=result.result_id,
            job_id=job_id,
        )
    return result


def mark_task_failed(
    db, *, task_id: int, error: str, job_id: Optional[int] = None,
) -> None:
    """Caller invokes this when entity_enricher returned None."""
    db.execute(
        "UPDATE enrichment_tasks SET state = 'failed', "
        "state_changed_at = ?, last_error = ?, job_id = COALESCE(?, job_id) "
        "WHERE id = ?",
        (_now(), error[:500], job_id, task_id),
    )
    db.commit()


def mark_task_skipped(
    db, *, task_id: int, reason: str, job_id: Optional[int] = None,
) -> None:
    """Caller invokes this for gate rejections (non-bean, non-article,
    already-enriched skip-cheap path)."""
    db.execute(
        "UPDATE enrichment_tasks SET state = 'skipped', "
        "state_changed_at = ?, last_error = ?, job_id = COALESCE(?, job_id) "
        "WHERE id = ?",
        (_now(), reason[:500], job_id, task_id),
    )
    db.commit()


def _mark_task_enriched(
    db, *, task_id: int, provenance: str,
    result_table: Optional[str], result_id: Optional[Any],
    job_id: Optional[int] = None,
) -> None:
    db.execute(
        "UPDATE enrichment_tasks SET state = 'enriched', "
        "state_changed_at = ?, extraction_provenance = ?, "
        "result_table = ?, result_id = ?, "
        "job_id = COALESCE(?, job_id), last_error = NULL "
        "WHERE id = ?",
        (_now(), provenance, result_table,
         str(result_id) if result_id is not None else None,
         job_id, task_id),
    )
    db.commit()


# ── Products ───────────────────────────────────────────────────────────────


_PRODUCT_LIVE_COLS = (
    "product_id, roaster_slug, roaster_name, coffee_name, "
    "roast_level, tasting_notes, origin, process, varietal, "
    "altitude_masl, bean_type, flavor_notes, weight_grams, "
    "price_inr, image_url, product_url, description_raw, available, "
    "source, process_raw, producer, brew_recommendation_json, "
    "enrichment_status, roast_level_name, roaster_blurb, origin_region"
)


def _upsert_product(
    db,
    entity: CanonicalProduct,
    *,
    force_admin_overwrite: bool,
) -> UpsertResult:
    # Normalize coffee_name BEFORE pid derivation so product_id is
    # computed from the cleaned name. Without this the slug would
    # carry the original junk (e.g. "amrutha-varshini-naturals-coffee-
    # specialty-filter-coffee" with the pipe-tail) which would
    # downstream-corrupt links + caching keys.
    entity.coffee_name = _normalize_coffee_name(entity.coffee_name) or entity.coffee_name

    # Look up the existing row by product_url FIRST, then fall back to
    # derived product_id. Reason (2026-05-25): if Haiku returns null
    # coffee_name_clean and the adapter falls back to "Unknown coffee",
    # _product_id_for(entity) produces a slug like
    # `vithai-coffee_unknown-coffee` which doesn't match the original
    # row's pid — the upserter then INSERTs a duplicate instead of
    # UPDATEing the live row. URL is the stable identity across
    # re-enrichments; pid is only stable when Haiku reliably echoes
    # back a non-null coffee name.
    # Match tolerant of trailing-slash drift. WooCommerce permalinks
    # carry a trailing "/" (e.g. .../product/bourbon-bliss-coffee/) that
    # the sitemap / an older scrape stored without — an EXACT match then
    # misses the live row and INSERTs a duplicate whose name-derived
    # product_id has drifted ("Bourbon Bliss Coffee" → "Bourbon Bliss").
    # That was the 2026-05-29 re-enrich-duplication bug (Gachatha AA ×3,
    # Bourbon Bliss ×2). Match the URL with AND without the trailing
    # slash so a re-enrich UPDATEs the existing row in place.
    _variants = _url_match_variants(entity.url)
    if _variants:
        _ph = ",".join("?" * len(_variants))
        existing = db.execute(
            f"SELECT {_PRODUCT_LIVE_COLS} FROM products "
            f"WHERE product_url IN ({_ph}) LIMIT 1",
            _variants,
        ).fetchone()
    else:
        existing = None
    if existing is not None:
        pid = existing["product_id"]
    else:
        pid = _product_id_for(entity)
        existing = db.execute(
            f"SELECT {_PRODUCT_LIVE_COLS} FROM products WHERE product_id = ?",
            (pid,),
        ).fetchone()

    # admin_manual stickiness — we don't yet track provenance on
    # products directly; for now the proxy is source='claimed' OR an
    # explicit roaster-owned wholesale value. Treat those as
    # "owner-touched" and coalesce instead of overwriting.
    owner_touched = existing is not None and (
        (existing["source"] or "") in ("claimed", "manual")
    )
    if owner_touched and not force_admin_overwrite:
        # Still update the scraper-owned fields (price / availability /
        # image / enrichment) but preserve owner-set roast/process/origin/
        # tasting notes when admin filled those in manually.
        pass  # fall through to the COALESCE update below

    brew_json = (
        json.dumps(entity.brew_recommendation.model_dump())
        if entity.brew_recommendation is not None
        else None
    )
    flavor_json = (
        ",".join(entity.flavor_notes)
        if entity.flavor_notes
        else None
    )

    # Resolve roaster_name from the canonical roaster_profiles row
    # (added 2026-05-25 — fixes the global pathology where the upserter
    # was stuffing entity.roaster_slug into the roaster_name column
    # because CanonicalProduct has no roaster_name field. profiles.name
    # is the source of truth for display name; the products row carries
    # a denormalized copy so consumer reads don't need a JOIN).
    profile_name_row = db.execute(
        "SELECT name FROM roaster_profiles WHERE roaster_slug = ?",
        (entity.roaster_slug,),
    ).fetchone()
    roaster_name_canonical = (
        profile_name_row["name"] if profile_name_row and profile_name_row["name"]
        else entity.roaster_slug
    )

    now = _now()
    # Beans-only honesty (Class B, 2026-05-30): a product with no valid
    # price — 0 / null after COALESCE with any existing price — must NOT
    # render as buyable. Tie `available` to a positive FINAL price so a
    # re-enrich that comes back price-less can't resurrect available=1 at
    # ₹0 (Zenforest "First Blossom X Rum Barrel" / "La Vida Mango" were
    # OOS-at-source with price 0 yet shown buyable). Self-correcting: a
    # later enrich that recovers a real price flips it back available, and
    # a row that already has a stored price is never hidden (the COALESCE
    # in the UPDATE keeps the price, and _final_price reads it).
    _final_price = entity.price_inr or (
        existing["price_inr"] if existing is not None else None
    )
    _avail = 1 if (entity.available and _final_price) else 0
    if existing is None:
        db.execute(
            """
            INSERT INTO products (
                product_id, roaster_slug, roaster_name, coffee_name,
                roast_level, tasting_notes, origin, process, varietal,
                altitude_masl, bean_type, flavor_notes, weight_grams,
                price_inr, image_url, product_url, description_raw,
                available, source, process_raw, producer,
                brew_recommendation_json, enrichment_status,
                roast_level_name, roaster_blurb, origin_region,
                created_at, enriched_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, 'scraped', ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                pid, entity.roaster_slug, roaster_name_canonical,
                entity.coffee_name,
                entity.roast_level, entity.tasting_notes, entity.origin,
                None, entity.varietal,
                entity.altitude_masl, entity.bean_type, flavor_json,
                entity.weight_grams, entity.price_inr, entity.image_url,
                entity.url, entity.description_raw,
                _avail,
                entity.process_raw, entity.producer, brew_json,
                entity.enrichment_status,
                entity.roast_level_name, entity.roaster_blurb,
                entity.origin_region,
                now, now,
            ),
        )
        db.commit()
        return UpsertResult("inserted", "products", pid)

    # UPDATE path: also re-sync roaster_name from the canonical
    # profile so a re-enrich corrects any pre-existing drift. The
    # SQL backfill (2026-05-25) cleaned up 528 historical mismatches;
    # this UPDATE keeps the denorm honest going forward.
    # Preserve an existing meaningful coffee_name when the entity carries
    # the "Unknown coffee" last-resort placeholder. NULLIF treats that
    # exact string as NULL so COALESCE falls back to the existing row's
    # name — guards against re-enrich runs where Haiku returns null
    # coffee_name_clean AND the page lacks og:title (Vithai 2026-mix
    # 2026-05-25 surfaced this).
    # price_inr also uses NULLIF/COALESCE (2026-05-26 — Zenforest
    # regression): a 0 or NULL from a future extraction failure can
    # NEVER destroy an existing positive price. A legit price change
    # (₹890 → ₹950) still goes through because 950 ≠ 0; truly delisted
    # products keep their last-known price and the K3 sold-out
    # validator on CanonicalProduct flips `available=False` so the
    # consumer browse hides the row without losing the price history.
    db.execute(
        """
        UPDATE products SET
            roaster_name = ?,
            coffee_name = COALESCE(NULLIF(?, 'Unknown coffee'), coffee_name),
            roast_level = COALESCE(?, roast_level),
            tasting_notes = COALESCE(?, tasting_notes),
            origin = COALESCE(?, origin),
            varietal = COALESCE(?, varietal),
            altitude_masl = COALESCE(?, altitude_masl),
            bean_type = COALESCE(?, bean_type),
            flavor_notes = COALESCE(?, flavor_notes),
            weight_grams = COALESCE(?, weight_grams),
            price_inr = COALESCE(NULLIF(?, 0), price_inr),
            image_url = COALESCE(?, image_url),
            product_url = COALESCE(?, product_url),
            description_raw = COALESCE(?, description_raw),
            available = ?,
            process_raw = COALESCE(?, process_raw),
            producer = COALESCE(?, producer),
            brew_recommendation_json = COALESCE(?, brew_recommendation_json),
            enrichment_status = ?,
            roast_level_name = COALESCE(?, roast_level_name),
            roaster_blurb = COALESCE(?, roaster_blurb),
            origin_region = COALESCE(?, origin_region),
            source = COALESCE(source, 'scraped'),
            enriched_at = ?
        WHERE product_id = ?
        """,
        (
            roaster_name_canonical,
            entity.coffee_name,
            entity.roast_level, entity.tasting_notes, entity.origin,
            entity.varietal,
            entity.altitude_masl, entity.bean_type, flavor_json,
            entity.weight_grams, entity.price_inr, entity.image_url,
            entity.url, entity.description_raw,
            _avail,
            entity.process_raw, entity.producer, brew_json,
            entity.enrichment_status,
            entity.roast_level_name, entity.roaster_blurb,
            entity.origin_region,
            now,
            pid,
        ),
    )
    db.commit()
    return UpsertResult("updated", "products", pid)


# ── Articles ───────────────────────────────────────────────────────────────


def _upsert_article(
    db,
    entity: CanonicalArticle,
    *,
    force_admin_overwrite: bool,
) -> UpsertResult:
    url = entity.url.strip()
    if not url:
        return UpsertResult("rejected_invalid", None, None, note="empty url")
    title = entity.title.strip() or "(untitled)"

    existing = db.execute(
        "SELECT id, title, excerpt, image_url, body_html, "
        "       word_count, published_at, enrichment_status, "
        "       is_about_coffee, topic_category, tags, published "
        "FROM roaster_articles WHERE url = ?",
        (url,),
    ).fetchone()

    tags_json = json.dumps(entity.tags) if entity.tags else None
    coffee_int = 1 if entity.is_about_coffee else 0
    now = _now()

    if existing is None:
        if entity.extraction_provenance == "bs4_fallback":
            published_initial = 0
        else:
            published_initial = 1 if entity.published else 0
        db.execute(
            "INSERT INTO roaster_articles "
            "(roaster_slug, url, title, excerpt, image_url, body_html, "
            " word_count, published_at, scraped_at, published, "
            " enrichment_status, is_about_coffee, topic_category, tags) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entity.roaster_slug, url, title, entity.excerpt,
                entity.image_url, entity.body_html, entity.word_count,
                entity.published_at, now, published_initial,
                entity.enrichment_status, coffee_int,
                entity.topic_category, tags_json,
            ),
        )
        db.commit()
        new_id = db.execute(
            "SELECT id FROM roaster_articles WHERE url = ?", (url,)
        ).fetchone()
        return UpsertResult("inserted", "roaster_articles",
                            new_id["id"] if new_id else None)

    existing_tags = existing["tags"] or None
    changed = (
        (existing["title"] or "") != title or
        (existing["excerpt"] or "") != (entity.excerpt or "") or
        (existing["image_url"] or "") != (entity.image_url or "") or
        (existing["body_html"] or "") != (entity.body_html or "") or
        (existing["word_count"] or 0) != (entity.word_count or 0) or
        (existing["published_at"] or "") != (entity.published_at or "") or
        (existing["enrichment_status"] or "") != (entity.enrichment_status or "") or
        ((existing["is_about_coffee"] or 0) != coffee_int) or
        ((existing["topic_category"] or "") != (entity.topic_category or "")) or
        ((existing_tags or "") != (tags_json or ""))
    )
    if not changed:
        return UpsertResult("skipped_unchanged", "roaster_articles",
                            existing["id"])

    db.execute(
        "UPDATE roaster_articles SET "
        "  title = ?, excerpt = ?, image_url = ?, body_html = ?, "
        "  word_count = ?, published_at = COALESCE(?, published_at), "
        "  scraped_at = ?, enrichment_status = ?, "
        "  is_about_coffee = ?, topic_category = ?, tags = ? "
        "WHERE id = ?",
        (title, entity.excerpt, entity.image_url, entity.body_html,
         entity.word_count, entity.published_at, now,
         entity.enrichment_status, coffee_int,
         entity.topic_category, tags_json, existing["id"]),
    )
    db.commit()
    return UpsertResult("updated", "roaster_articles", existing["id"])


__all__ = [
    "UpsertResult",
    "upsert_entity",
    "mark_task_failed",
    "mark_task_skipped",
]
