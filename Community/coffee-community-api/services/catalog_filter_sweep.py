"""Retroactive beans-only Stage 1 filter sweep — apply the current
membership checks to every catalog row and flag the rows current rules
would reject.

Why this exists: every catalog row stamps the filter-rule set in
effect at insertion time. When the rules tighten (new keywords
added, "tasting set" / "blend duo" / "drip kit" / etc.), older rows
become grandfathered — they don't appear in any enrichment task's
state='skipped' bucket because they were inserted before the rule
existed. This sweep closes the loop: walk every available product,
re-apply the current beans-only checks, flip the matches to
`available=0, enrichment_status='filter_reject'`. Field values (price,
weight, name, image) are preserved — only the membership flag flips.

Three checks run per row, mirroring the write-path enforcement so a
sweep and a full re-enrich reach the same verdict:
  1. `is_url_excluded` — URL/title keyword exclusion (the original).
  2. `is_single_serve_by_economics` — single-serve FORMAT by its
     economic signature (weight ≤ 15 g AND ≥ 15 ₹/g); the text-
     invisible case whose marker never reached the coffee_name or slug
     (Class A, 2026-05-30 — roast-coffee "Monsoon Malabar" 5 g).
  3. `is_non_bean_format_desc` on the stored description — single-serve
     product-declaration prose ("single-serve drip bag" / "pocket brew"
     / "tear the filter bag") the title lost on a prior enrich
     (ninetytwo "Riverside Estate" Pocket Pour, dripface). Strict: it
     omits recipe-tool nouns ("cold brew bag") that a real bean's
     brewing recipe mentions (motley-brew), so no real bean is rejected.
  4. `is_multi_coffee_bundle` on name + blurb + tasting_notes +
     description + URL — multi-coffee bundles (gift box / curated set /
     duo / combo of ≥2 distinct coffees: caarabi "Light Roast Edit",
     black-poetry "Java Joy Box", zenforest "Bourbon Bliss X Rum
     Barrel"). Keys on separation structure ("includes/set of/pairing
     of N coffees", "100g x N", "experience duo"), NOT a bare count, so
     a single-bag BLEND ("a blend of two coffees") is never rejected.

Pure data layer — caller persists via `start_operation` /
`finish_operation_with_qc`.
"""

from __future__ import annotations

from typing import Any, Optional

from services.operation_qc import (
    start_operation,
    snapshot_rows,
    finish_operation,
)
from services.product_filters import (
    is_url_excluded,
    is_single_serve_by_economics,
    is_non_bean_format_desc,
    is_multi_coffee_bundle,
)


def _now() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _candidate_rows(db, *, slug: Optional[str], limit: Optional[int]):
    """Pick the rows that haven't already been filter-rejected /
    flagged url_dead. We don't re-evaluate rows that prior sweeps
    already culled (they're stuck at available=0 anyway)."""
    sql = (
        "SELECT product_id, roaster_slug, coffee_name, product_url, "
        "       description_raw, weight_grams, price_inr, "
        "       roaster_blurb, tasting_notes, "
        "       available, enrichment_status "
        "FROM products "
        "WHERE available = 1 "
        "  AND enrichment_status NOT IN ('filter_reject', 'url_dead') "
    )
    params: list = []
    if slug:
        sql += " AND roaster_slug = ? "
        params.append(slug)
    sql += " ORDER BY product_id "
    if limit is not None:
        sql += " LIMIT ? "
        params.append(int(limit))
    return db.execute(sql, params).fetchall()


def run_filter_sweep(
    db,
    *,
    dry_run: bool = True,
    slug: Optional[str] = None,
    limit: Optional[int] = None,
    started_by: Optional[str] = None,
) -> dict[str, Any]:
    """Walk catalog rows, apply current Stage 1 filter, flag the
    matches. Returns a summary; persists via catalog_operations
    when dry_run=False.
    """
    rows = _candidate_rows(db, slug=slug, limit=limit)
    matches: list[dict[str, Any]] = []
    for row in rows:
        coffee_name = row["coffee_name"] or ""
        product_url = row["product_url"] or ""
        # Stage-1 URL/title exclusion (the original sweep behaviour).
        excluded, reason = is_url_excluded(product_url, title=coffee_name)
        # Class A (2026-05-30) — two beans-only checks the URL/title pass
        # can't make, because the format marker never reaches the cleaned
        # coffee_name OR the URL slug:
        #   (a) economic single-serve signature (weight ≤ 15 g AND ≥ 15
        #       ₹/g) — the text-invisible case (roast-coffee "Monsoon
        #       Malabar", 5 g, slug 'ep-monsoon-malabar', no description).
        #   (b) single-serve brewing-instruction prose in the stored
        #       description ("pocket brew" / "tear the filter bag" /
        #       "immerse a bag") — odd-coffee Brew Bag, dripface pocket
        #       brew, whose titles lost the marker on a prior enrich.
        # Both mirror the write-path guards (canonical_entity
        # _single_serve_format_economics + enrichment_runner Stage-2a), so
        # a retro sweep and a full re-enrich converge on the same verdict.
        if not excluded and is_single_serve_by_economics(
            row["weight_grams"], row["price_inr"]
        ):
            excluded = True
            reason = (
                f"exclude:single-serve-economics="
                f"{row['weight_grams']}g/{row['price_inr']}inr"
            )
        if not excluded:
            fmt = is_non_bean_format_desc(row["description_raw"])
            if fmt:
                excluded = True
                reason = f"exclude:non-bean-format-desc={fmt!r}"
        # Class B (2026-05-30) — multi-coffee BUNDLE (gift box / curated set
        # / duo / combo of ≥2 distinct coffees). is_coffee_bean lets them
        # through (they ARE coffee); deterministic detector flips them. Reads
        # the enriched prose (blurb + tasting_notes + description) because the
        # bundle marker often survives only there after the title was cleaned
        # (black-poetry "Java Joy Box", description_raw NULL, blurb "a curated
        # gift box featuring three distinct coffees").
        if not excluded:
            bundle = is_multi_coffee_bundle(
                row["coffee_name"], url=product_url,
                description=row["description_raw"],
                blurb=row["roaster_blurb"], tasting_notes=row["tasting_notes"],
            )
            if bundle:
                excluded = True
                reason = f"exclude:{bundle}"
        if not excluded:
            continue
        matches.append({
            "product_id": row["product_id"],
            "roaster_slug": row["roaster_slug"],
            "coffee_name": coffee_name,
            "product_url": product_url,
            "filter_reason": reason,
        })

    summary = {
        "strategy": "stage1_retroactive",
        "scanned": len(rows),
        "matched": len(matches),
        "dry_run": dry_run,
        "slug": slug,
        "samples": matches[:50],
    }

    if dry_run or not matches:
        return summary

    operation_id = start_operation(
        db,
        kind="filter_retro_sweep",
        target_slug=slug,
        params={"slug": slug, "limit": limit},
        started_by=started_by,
    )

    # Snapshot rows BEFORE mutation (preserve available + status
    # for rollback). We only need product_id + available +
    # enrichment_status since only those flip; field values are
    # preserved on the row.
    pre_mutation_rows = []
    for m in matches:
        existing = db.execute(
            "SELECT product_id, available, enrichment_status "
            "FROM products WHERE product_id = ?",
            (m["product_id"],),
        ).fetchone()
        if existing:
            pre_mutation_rows.append(dict(existing))
    snapshot_rows(
        db, operation_id, "products",
        pre_mutation_rows, mutation_kind="update",
    )

    # Apply mutation.
    affected = 0
    for m in matches:
        cur = db.execute(
            "UPDATE products SET available = 0, "
            "  enrichment_status = 'filter_reject' "
            "WHERE product_id = ? AND enrichment_status != 'filter_reject'",
            (m["product_id"],),
        )
        affected += cur.rowcount
    db.commit()

    finish_operation(
        db, operation_id, status="succeeded",
        summary={
            "scanned": len(rows),
            "matched": len(matches),
            "affected": affected,
            "samples": [m["product_id"] for m in matches[:20]],
        },
    )

    summary["affected"] = affected
    summary["operation_id"] = operation_id
    return summary


__all__ = ["run_filter_sweep"]
