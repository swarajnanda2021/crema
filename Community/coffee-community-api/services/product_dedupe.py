"""Catalog dedup tool — consolidate duplicate products into one
canonical row, re-point FKs from the dependent tables, delete the
sibling rows.

Three duplicate classes the bulk-enrich pipeline produces:

  A. Same product_url, multiple product_id rows. Fundamental dedup
     failure — usually from the upserter's URL lookup being added
     mid-stream (Bombay Island Breakfast Blend, 2026-05-25).

  B. URL-variant duplicates: same canonical product but the row
     URLs differ by host (www vs non-www), path prefix
     (/collections/all/ vs /), or trailing slash. D1 URL
     rediscovery heals one row's URL but the staging step creates
     a new row for the same canonical product in parallel.

  C. Different SKUs with normalized names collapsing to one
     coffee_name (Nandan Royale × 6 — six legitimate roast levels
     all named "Royale" after Haiku stripped the suffix). NOT a
     real duplicate; not handled here. The fix is to re-extract
     coffee_name with the variant preserved.

This module handles A + B. C is out of scope.

Strategy: pick a canonical row per group, fill its NULL enrichment
fields from the richest sibling, re-point FKs (shelf_entries,
tasting_notes, click_events, hidden_products, scrape_proposals,
brew_methods, ad_impressions, roaster_ad_placements, roaster_posts)
to the canonical, then delete the siblings.

Pure data layer — no LLM, no I/O. Caller persists.
"""

from __future__ import annotations

import re
from typing import Any, Optional


# Enrichment columns to consider for "richness scoring" + cross-row
# merging. Every column the upserter writes ends up here.
_ENRICHMENT_FIELDS: tuple[str, ...] = (
    "coffee_name", "roast_level", "roast_level_name", "tasting_notes",
    "origin", "origin_region", "process", "process_raw", "varietal",
    "altitude_masl", "bean_type", "flavor_notes", "weight_grams",
    "price_inr", "image_url", "description_raw", "producer",
    "brew_recommendation_json", "roaster_blurb",
    "varietal_canonical", "origin_estate_canonical",
    "bean_type_canonical", "roast_level_canonical",
    "process_canonical", "morphology",
)

# Tables that hold product_id FKs that need re-pointing during
# consolidation. order = "ones with UNIQUE constraints first"
# (those need DELETE-before-UPDATE to avoid uniqueness violations).
_FK_TABLES: tuple[str, ...] = (
    "shelf_entries",        # UNIQUE(user_id, product_id)
    "hidden_products",      # UNIQUE(roaster_slug, product_id)
    "click_events",         # no unique constraint
    "brew_methods",         # no unique constraint
    "ad_impressions",       # no unique constraint
    "roaster_ad_placements",  # no unique constraint
    "scrape_proposals",     # no unique constraint
)

# Tables whose UNIQUE constraint would collide if we re-point
# blindly. Map: table → tuple of other key columns.
_UNIQUE_FK_TABLES: dict[str, tuple[str, ...]] = {
    "shelf_entries": ("user_id",),
    "hidden_products": ("roaster_slug",),
}


# Preference / variant suffixes that roasters use to publish the same
# coffee as multiple SKUs. Strip during content-similarity grouping.
# Order matters — longest first so partials don't shadow specifics.
# Separator is flexible: dash, comma, or whitespace — Curious Life
# publishes both "Gachatha AA - Filter" and "Gachatha AA Espresso"
# (no dash).
_VAR_SEP = r"\s*[-,]?\s*"
_VARIANT_SUFFIX_RES: tuple = (
    re.compile(_VAR_SEP + r"whole\s+beans?\s+only\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"ground\s+coffee\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"medium\s*-\s*dark\s+roast\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"medium\s*-\s*light\s+roast\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"medium\s*-\s*dark\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"medium\s*-\s*light\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"(light|medium|dark)\s+roast\s*$", re.IGNORECASE),
    re.compile(_VAR_SEP + r"(espresso|filter|french\s+press|aeropress|moka)\s+roast\s*$",
               re.IGNORECASE),
    # Bare preference suffix without "Roast" — must be preceded by
    # at least 2 words (so "Espresso Blend" doesn't get stripped to
    # "Blend"). Implemented via `(?<=\w\s\w+)` lookbehind isn't
    # variable-length safe — instead handled in the caller below
    # (post-strip word-count check).
    re.compile(_VAR_SEP + r"(espresso|filter|french\s+press|aeropress|moka)\s*$",
               re.IGNORECASE),
    re.compile(_VAR_SEP + r"(kenya|rwanda|ethiopia|colombia|india|brazil|guatemala)\s*$",
               re.IGNORECASE),
)

# Leading brew-method prefixes. Roasters publish ONE coffee as several
# SKUs, one per brew style, with the method bolted onto the FRONT of
# the name — Mokkafarms ships "Aero Press - 100% Pure Arabica", "Pour
# Over - 100% Pure Arabica", "Electric Drip - 100% Pure Arabica" as
# three rows for one coffee. The `_VARIANT_SUFFIX_RES` above only peel
# brew tags off the END; this peels the LEADING form. A separator
# (dash / pipe / colon / en/em-dash) is REQUIRED after the token, so
# structural names keep their first word — "Espresso Blend" / "Filter
# Coffee" (no separator) are left intact. The caller applies a
# ≥2-words-remaining guard on top, so we never reduce a name to a
# single word.
_LEADING_BREW_RE = re.compile(
    r"^\s*(?:"
    r"aero\s*press|pour[-\s]*over|electric\s*drip|cold\s*brew|"
    r"french\s*press|moka\s*pot|south\s*indian\s*filter|home\s*espresso|"
    r"hand\s*press|stovetop|turkish|drip|espresso|filter"
    r")\s*[-|:–—]\s+",
    re.IGNORECASE,
)


def _normalize_coffee_name(name: Optional[str]) -> str:
    """Canonicalize a product name for cross-variant matching.

    Strips leading brew-method prefixes AND trailing variant /
    preference / region suffixes. Two products that differ only by
    grind / brew preference / region descriptor collapse to the same
    key. Examples:
      'Gachatha AA' → 'gachatha aa'
      'Gachatha AA Espresso' → 'gachatha aa'
      'Gachatha AA Espresso Kenya' → 'gachatha aa'
      'Gachatha AA Filter, Kenya' → 'gachatha aa'
      'Gachatha AA - Filter Roast - Whole Beans Only' → 'gachatha aa'
      'Aero Press - 100% Pure Arabica' → '100% pure arabica'
      'Pour Over - 100% Pure Arabica' → '100% pure arabica'

    Curious Life publishes 6 SKUs for the same Gachatha (trailing
    brew tags); Mokkafarms publishes ~7 for the same coffee (leading
    brew tags). Both collapse here so content similarity (this
    normalizer + same price + same image) catches them.

    Safety: bare preference suffix strip (Espresso / Filter / etc.
    without "Roast") only applies when the remaining name has
    ≥ 2 words. The leading-prefix strip carries the same guard — it
    requires a separator after the brew token AND ≥ 2 words remaining,
    so "Espresso Blend" / "Filter Coffee" are never reduced.
    """
    if not name:
        return ""
    n = name.strip()
    # Strip leading brew-method prefixes ("Aero Press - 100% Pure
    # Arabica" → "100% Pure Arabica"). Iterative for stacked prefixes;
    # the ≥2-words guard keeps single-word coffee names intact.
    changed = True
    while changed:
        changed = False
        new = _LEADING_BREW_RE.sub("", n).strip()
        if new and new != n and len(new.split()) >= 2:
            n = new
            changed = True
    # Iteratively strip the longest-matching trailing variant suffix
    # until no more match. Lets us peel multiple stacked descriptors.
    changed = True
    while changed:
        changed = False
        for pat in _VARIANT_SUFFIX_RES:
            new = pat.sub("", n).strip()
            if not new or new == n:
                continue
            # Safety: bare preference suffix without "Roast" — only
            # strip when ≥ 2 words remain so we don't reduce "Espresso
            # Blend" → "Blend".
            pat_src = pat.pattern.lower()
            is_bare_pref = (
                "roast" not in pat_src
                and any(
                    kw in pat_src
                    for kw in ("espresso", "filter", "french", "aeropress", "moka")
                )
            )
            if is_bare_pref and len(new.split()) < 2:
                continue
            n = new
            changed = True
            break
    # Final normalization — lowercase + collapse whitespace + strip
    # trailing punctuation.
    n = re.sub(r"\s+", " ", n).lower()
    n = n.rstrip(",.-:; ").strip()
    return n


def _normalize_url(url: Optional[str]) -> str:
    """Canonicalize a product URL for cross-variant matching.

    Strips: scheme, www., /collections/all/ in path, trailing
    slashes. Used to match URL variants like:
      • https://bombayisland.com/products/x
      • https://www.bombayisland.com/products/x
      • https://www.bombayisland.com/collections/all/products/x
    All three collapse to: bombayisland.com/products/x
    """
    if not url:
        return ""
    u = url.lower().strip()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = u.replace("/collections/all/", "/")
    return u.rstrip("/")


def _row_score(row: dict[str, Any]) -> int:
    """Enrichment richness = count of non-null/non-empty enrichment
    fields. Used to pick the canonical row from a duplicate group."""
    return sum(
        1 for f in _ENRICHMENT_FIELDS
        if row.get(f) not in (None, "", [])
    )


def _pick_canonical(
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Pick the canonical row + return the siblings to merge-and-delete.

    Selection criteria (in priority):
      1. Highest enrichment score (richer wins).
      2. Most recent enriched_at (when scores tie).
      3. Lexicographically smallest product_id (deterministic tie).
    """
    if not rows:
        raise ValueError("no rows to pick from")
    best = rows[0]
    best_score = _row_score(best)
    best_enriched = best.get("enriched_at") or ""
    for r in rows[1:]:
        s = _row_score(r)
        e = r.get("enriched_at") or ""
        if s > best_score:
            best, best_score, best_enriched = r, s, e
        elif s == best_score:
            if e > best_enriched:
                best, best_enriched = r, e
            elif e == best_enriched and r["product_id"] < best["product_id"]:
                best = r
    siblings = [r for r in rows if r["product_id"] != best["product_id"]]
    return best, siblings


def find_duplicate_groups(
    db,
    *,
    strategy: str = "url_normalized",
    slug: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Return duplicate groups under the chosen strategy.

    strategy:
      'url_exact'         — exact product_url match.
      'url_normalized'    — match after stripping scheme/www/
                            collections/all/trailing-slash. Catches
                            Class A AND Class B duplicates.
      'content_similarity'— match by (roaster_slug, normalized
                            coffee_name, price_inr, image_url).
                            Catches Class D: same coffee published
                            as multiple SKUs differing only by
                            grind / brew preference / region tag
                            (Curious Life Gachatha × 6, Nandan
                            Espresso × 5).
    """
    if strategy not in ("url_exact", "url_normalized", "content_similarity"):
        raise ValueError(f"unsupported strategy: {strategy}")

    if strategy == "content_similarity":
        return _find_content_similarity_groups(db, slug=slug)

    sql = (
        "SELECT product_id, product_url, roaster_slug "
        "FROM products "
        "WHERE product_url IS NOT NULL AND product_url != '' "
    )
    params: list = []
    if slug:
        sql += "AND roaster_slug = ? "
        params.append(slug)

    rows = db.execute(sql, tuple(params)).fetchall()

    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        key_url = (
            _normalize_url(r["product_url"])
            if strategy == "url_normalized"
            else r["product_url"]
        )
        if not key_url:
            continue
        # Bucket by (roaster_slug, key_url) so cross-roaster
        # URL collisions (rare but possible if storefronts cross-link)
        # don't accidentally merge unrelated rows.
        key = (r["roaster_slug"] or "", key_url)
        buckets.setdefault(key, []).append({
            "product_id": r["product_id"],
            "product_url": r["product_url"],
        })

    groups: list[dict[str, Any]] = []
    for (slug_key, url_key), pids in buckets.items():
        if len(pids) < 2:
            continue
        groups.append({
            "roaster_slug": slug_key,
            "normalized_url": url_key,
            "count": len(pids),
            "product_ids": [p["product_id"] for p in pids],
            "url_variants": sorted({p["product_url"] for p in pids}),
        })
    # Sort by count descending so the worst groups surface first
    groups.sort(key=lambda g: (-g["count"], g["roaster_slug"], g["normalized_url"]))
    return groups


def _find_content_similarity_groups(
    db,
    *,
    slug: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Content-similarity grouping.

    Key = (roaster_slug, normalized_coffee_name, price_inr, image_url).
    Requires non-null price_inr + non-null image_url to participate —
    these are the strong signals that two SKUs really are the same
    coffee. (Same name + same price + same image = same coffee
    published as multiple grind/brew preference SKUs.)

    Conservative: products with null price OR null image are skipped
    (we can't confirm they're the same without those signals).
    """
    sql = (
        "SELECT product_id, product_url, roaster_slug, coffee_name, "
        "       price_inr, image_url "
        "FROM products "
        "WHERE coffee_name IS NOT NULL AND coffee_name != '' "
        "  AND price_inr IS NOT NULL AND price_inr > 0 "
        "  AND image_url IS NOT NULL AND image_url != '' "
    )
    params: list = []
    if slug:
        sql += "AND roaster_slug = ? "
        params.append(slug)
    rows = db.execute(sql, tuple(params)).fetchall()

    buckets: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        norm_name = _normalize_coffee_name(r["coffee_name"])
        if not norm_name:
            continue
        key = (
            r["roaster_slug"] or "",
            norm_name,
            round(float(r["price_inr"]), 2),
            r["image_url"],
        )
        buckets.setdefault(key, []).append({
            "product_id": r["product_id"],
            "product_url": r["product_url"],
            "coffee_name": r["coffee_name"],
            "price_inr": r["price_inr"],
            "image_url": r["image_url"],
        })

    groups: list[dict[str, Any]] = []
    for (slug_key, norm_name, price, image), pids in buckets.items():
        if len(pids) < 2:
            continue
        groups.append({
            "roaster_slug": slug_key,
            "normalized_coffee_name": norm_name,
            "price_inr": price,
            "image_url": image,
            # Use normalized_url field name for compatibility with
            # the rest of the dedup machinery — `consolidate_group`
            # reads it for the operation summary.
            "normalized_url": (
                f"content::{norm_name}::{price}::{image[:40]}"
            ),
            "count": len(pids),
            "product_ids": [p["product_id"] for p in pids],
            "url_variants": sorted({p["product_url"] for p in pids}),
            "name_variants": sorted({p["coffee_name"] for p in pids}),
        })
    groups.sort(
        key=lambda g: (
            -g["count"], g["roaster_slug"], g["normalized_coffee_name"],
        ),
    )
    return groups


def _merge_field_values(
    canonical: dict[str, Any],
    siblings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build an UPDATE dict for enrichment fields where canonical is
    null but at least one sibling has a value. Prefers the richest
    sibling's value first."""
    sibs_sorted = sorted(siblings, key=lambda s: -_row_score(s))
    updates: dict[str, Any] = {}
    for field in _ENRICHMENT_FIELDS:
        cv = canonical.get(field)
        if cv not in (None, "", []):
            continue
        for s in sibs_sorted:
            v = s.get(field)
            if v not in (None, "", []):
                updates[field] = v
                break
    return updates


def _repoint_fks(
    db,
    *,
    canonical_pid: str,
    sibling_pids: list[str],
) -> dict[str, int]:
    """For each dependent table, re-point sibling_pid rows to
    canonical_pid. Tables with UNIQUE constraints (shelf_entries,
    hidden_products) need a DELETE-first step to avoid uniqueness
    violations — if user A has the SAME bean on shelf under both
    dup1 and dup2, re-pointing dup2 → dup1 would collide; instead
    delete dup2's row (canonical's already there).
    """
    counts: dict[str, int] = {}
    if not sibling_pids:
        return counts

    placeholders = ",".join("?" for _ in sibling_pids)

    for table in _FK_TABLES:
        # Handle UNIQUE-constrained tables: delete sibling rows that
        # would collide with canonical's existing entries.
        if table in _UNIQUE_FK_TABLES:
            other_cols = _UNIQUE_FK_TABLES[table]
            for spid in sibling_pids:
                sel = (
                    f"SELECT {', '.join(other_cols)} FROM {table} "
                    f"WHERE product_id = ?"
                )
                col_clause = " AND ".join(
                    f"{c} = ?" for c in other_cols
                )
                conflict_rows = db.execute(sel, (canonical_pid,)).fetchall()
                for cr in conflict_rows:
                    delete_params = (
                        tuple(cr[c] for c in other_cols) + (spid,)
                    )
                    db.execute(
                        f"DELETE FROM {table} "
                        f"WHERE {col_clause} AND product_id = ?",
                        delete_params,
                    )

        cur = db.execute(
            f"UPDATE {table} SET product_id = ? "
            f"WHERE product_id IN ({placeholders})",
            [canonical_pid] + sibling_pids,
        )
        counts[table] = cur.rowcount
    return counts


def consolidate_group(
    db,
    *,
    group: dict[str, Any],
    dry_run: bool = True,
    operation_id: Optional[int] = None,
) -> dict[str, Any]:
    """Consolidate one duplicate group. Returns a per-group report.

    Live mode (dry_run=False) snapshots the canonical (pre-merge state)
    and each sibling (pre-delete state) into catalog_snapshots tagged
    with operation_id. Enables `rollback_operation(op_id)` to restore
    the entire dedupe.
    """
    pid_list = group["product_ids"]
    placeholders = ",".join("?" for _ in pid_list)
    rows = [
        dict(r) for r in db.execute(
            f"SELECT * FROM products WHERE product_id IN ({placeholders})",
            pid_list,
        ).fetchall()
    ]
    if len(rows) < 2:
        return {
            "skipped": "fewer than 2 rows resolved (group is stale)",
            "group": group,
        }

    canonical, siblings = _pick_canonical(rows)
    sibling_pids = [s["product_id"] for s in siblings]
    merge_updates = _merge_field_values(canonical, siblings)

    report = {
        "roaster_slug": group["roaster_slug"],
        "normalized_url": group["normalized_url"],
        "url_variants": group["url_variants"],
        "canonical_product_id": canonical["product_id"],
        "canonical_url": canonical.get("product_url"),
        "canonical_score": _row_score(canonical),
        "sibling_product_ids": sibling_pids,
        "fields_to_merge": list(merge_updates.keys()),
        "rows_kept": 1,
        "rows_deleted": len(siblings),
    }

    if dry_run:
        report["dry_run"] = True
        return report

    # Snapshot pre-mutation state for rollback support
    if operation_id is not None:
        from services.operation_qc import snapshot_rows
        # Canonical: about to be UPDATEd (if merge_updates) — store
        # its pre-merge state so rollback can restore it.
        if merge_updates:
            snapshot_rows(
                db, operation_id, "products", [canonical],
                mutation_kind="update",
            )
        # Siblings: about to be DELETEd — snapshot for re-insert
        # on rollback.
        snapshot_rows(
            db, operation_id, "products", siblings,
            mutation_kind="delete",
        )

    # Live mode: merge → repoint → delete → commit
    if merge_updates:
        cols = ", ".join(f"{k} = ?" for k in merge_updates.keys())
        params = list(merge_updates.values()) + [canonical["product_id"]]
        db.execute(
            f"UPDATE products SET {cols} WHERE product_id = ?",
            params,
        )

    fk_counts = _repoint_fks(
        db, canonical_pid=canonical["product_id"],
        sibling_pids=sibling_pids,
    )

    cur = db.execute(
        f"DELETE FROM products "
        f"WHERE product_id IN ({','.join('?' for _ in sibling_pids)})",
        sibling_pids,
    )
    report["rows_deleted"] = cur.rowcount

    # If sibling rows held the canonical's product_url (i.e. one of
    # the siblings had the "more canonical" URL form), copy it onto
    # the canonical. The lexicographically simpler URL (no
    # /collections/all/, with www) is usually preferable.
    # Skipped for now — left as a manual review step.

    db.commit()

    report["fk_repointed"] = fk_counts
    return report


def run_dedupe_sweep(
    db,
    *,
    strategy: str = "url_normalized",
    slug: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = True,
    started_by: Optional[str] = None,
) -> dict[str, Any]:
    """Find duplicate groups + consolidate each. Returns a summary.

    Defaults to dry_run=True. Always preview before committing.

    Live runs (dry_run=False) log a `catalog_operations` row,
    snapshot every row that gets deleted, and run T1 anomaly
    checks (op_dedupe_oversized, op_mass_delete) post-completion.
    Dry runs skip operation logging — they don't mutate state.
    """
    groups = find_duplicate_groups(db, strategy=strategy, slug=slug)
    if limit is not None:
        groups = groups[:limit]

    # Live operations get the QC + snapshot wrapper.
    op_id: Optional[int] = None
    if not dry_run:
        from services.operation_qc import (
            start_operation, finish_operation_with_qc, finish_operation,
        )
        op_id = start_operation(
            db, kind="dedupe",
            target_slug=slug,
            params={"strategy": strategy, "limit": limit},
            started_by=started_by,
        )

    summary = {
        "operation_id": op_id,
        "strategy": strategy,
        "slug": slug,
        "dry_run": dry_run,
        "groups_found": len(groups),
        "groups_consolidated": 0,
        "rows_kept": 0,
        "rows_deleted": 0,
        "details": [],
    }
    try:
        for g in groups:
            result = consolidate_group(
                db, group=g, dry_run=dry_run, operation_id=op_id,
            )
            summary["details"].append(result)
            if "skipped" in result:
                continue
            summary["groups_consolidated"] += 1
            summary["rows_kept"] += result.get("rows_kept", 0)
            summary["rows_deleted"] += result.get("rows_deleted", 0)
    except Exception as e:
        if op_id is not None:
            from services.operation_qc import finish_operation
            finish_operation(
                db, op_id, status="failed", summary=summary,
                error_message=f"{type(e).__name__}: {str(e)[:200]}",
            )
        raise

    if op_id is not None:
        from services.operation_qc import finish_operation_with_qc
        qc_report = finish_operation_with_qc(
            db, op_id, status="succeeded", summary=summary,
        )
        summary["qc_report"] = qc_report
    return summary


__all__ = [
    "find_duplicate_groups",
    "consolidate_group",
    "run_dedupe_sweep",
]
