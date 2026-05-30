"""URL health audit — HEAD-check every catalog product_url and flag
the persistently-dead ones as `url_dead`.

Why this exists: roasters retire SKUs (Takaraa `-takaraa-1-kg`
suffix dropped), replatform (ffox / libertario `/collections/` →
`/products/` migration), publish per-batch URLs that age out
(Caffinary `-roasted-on-DDMM` handles), or let their Shopify
subscription lapse (Forest Farmer — every product 402s). The catalog
accumulates zombies — rows whose URLs no longer resolve. The
re-enrich loop fix catches these going forward, but doesn't clean
the existing population. This sweep does.

Concurrent batched HEAD requests — 8-way parallelism by default.
Per-host throttle is implicit in concurrency cap (Shopify CDNs
don't rate-limit at this volume). Failure modes:
  • 404 / 410 / 402 → flip available=0 + enrichment_status='url_dead'
    (see page_fetcher.DEAD_HTTP_STATUSES — 402 is the Shopify
    subscription-suspended storefront, dead for our purposes).
  • 405 (Method Not Allowed) → falls back to GET inside
    `head_check_url`; if STILL 405 we treat it as transient.
  • Network error / timeout / 5xx → leave the row untouched
    (transient or local DNS). Sweep does NOT mutate on ambiguous
    failure — same principle as the enrich-runner dead-status patch.

Pure data layer — caller persists via catalog_operations.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from services.operation_qc import (
    start_operation,
    snapshot_rows,
    finish_operation,
)
from services.page_fetcher import head_check_url, is_dead_status


DEFAULT_CONCURRENCY = 8


def _candidate_rows(db, *, slug: Optional[str], limit: Optional[int]):
    sql = (
        "SELECT product_id, roaster_slug, coffee_name, product_url, "
        "       available, enrichment_status "
        "FROM products "
        "WHERE available = 1 "
        "  AND enrichment_status NOT IN ('url_dead') "
        "  AND product_url IS NOT NULL AND product_url != '' "
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


def _check_one(row: dict[str, Any]) -> dict[str, Any]:
    """Pure function: HEAD-check one row's URL, return status code +
    row metadata. No DB access — safe to run in a thread pool."""
    url = row.get("product_url") or ""
    status = head_check_url(url) if url else None
    return {
        "product_id": row.get("product_id"),
        "roaster_slug": row.get("roaster_slug"),
        "coffee_name": row.get("coffee_name"),
        "product_url": url,
        "http_status": status,
    }


def run_url_health_audit(
    db,
    *,
    dry_run: bool = True,
    slug: Optional[str] = None,
    limit: Optional[int] = None,
    concurrency: int = DEFAULT_CONCURRENCY,
    started_by: Optional[str] = None,
) -> dict[str, Any]:
    """HEAD-check every available catalog URL, flag the 404s.

    Returns a summary with per-roaster 404 counts and sample URLs.
    On `dry_run=False` (and matches present), persists via a
    catalog_operations row with snapshots for rollback.
    """
    rows = _candidate_rows(db, slug=slug, limit=limit)
    if not rows:
        return {
            "strategy": "url_health_audit",
            "scanned": 0,
            "dead": 0,
            "transient_failures": 0,
            "dry_run": dry_run,
            "slug": slug,
            "samples": [],
        }

    # Snapshot row dicts so the thread pool has all data it needs.
    row_dicts = [{k: r[k] for k in r.keys()} for r in rows]

    dead: list[dict[str, Any]] = []
    transient: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_check_one, r): r for r in row_dicts}
        for fut in as_completed(futures):
            try:
                result = fut.result(timeout=30)
            except Exception:
                continue
            status = result.get("http_status")
            if is_dead_status(status):
                # 404 / 410 / 402 — permanently gone (see
                # page_fetcher.DEAD_HTTP_STATUSES).
                dead.append(result)
            elif status is None or status >= 500:
                # Network error or 5xx — treat as transient, don't
                # mutate the row. Surface as observed-but-unactioned.
                transient.append(result)
            # 2xx / 3xx / other 4xx (401/403) → reachable, no action.

    # Per-roaster rollup for the dead bucket.
    by_roaster: dict[str, int] = {}
    for d in dead:
        s = d.get("roaster_slug") or "(unknown)"
        by_roaster[s] = by_roaster.get(s, 0) + 1
    by_roaster_top = sorted(
        ({"roaster_slug": k, "c_dead": v} for k, v in by_roaster.items()),
        key=lambda r: r["c_dead"], reverse=True,
    )[:20]

    summary = {
        "strategy": "url_health_audit",
        "scanned": len(rows),
        "dead": len(dead),
        "transient_failures": len(transient),
        "dry_run": dry_run,
        "slug": slug,
        "by_roaster_top": by_roaster_top,
        "samples": dead[:50],
        "transient_samples": transient[:20],
    }

    if dry_run or not dead:
        return summary

    operation_id = start_operation(
        db,
        kind="url_health_audit",
        target_slug=slug,
        params={"slug": slug, "limit": limit, "concurrency": concurrency},
        started_by=started_by,
    )

    # Snapshot rows BEFORE mutation.
    pre_mutation_rows = []
    for d in dead:
        existing = db.execute(
            "SELECT product_id, available, enrichment_status "
            "FROM products WHERE product_id = ?",
            (d["product_id"],),
        ).fetchone()
        if existing:
            pre_mutation_rows.append(dict(existing))
    snapshot_rows(
        db, operation_id, "products",
        pre_mutation_rows, mutation_kind="update",
    )

    affected = 0
    for d in dead:
        cur = db.execute(
            "UPDATE products SET available = 0, "
            "  enrichment_status = 'url_dead' "
            "WHERE product_id = ? AND enrichment_status != 'url_dead'",
            (d["product_id"],),
        )
        affected += cur.rowcount
    db.commit()

    finish_operation(
        db, operation_id, status="succeeded",
        summary={
            "scanned": len(rows),
            "dead": len(dead),
            "affected": affected,
            "transient_failures": len(transient),
            "samples": [d["product_id"] for d in dead[:20]],
        },
    )

    summary["affected"] = affected
    summary["operation_id"] = operation_id
    return summary


__all__ = ["run_url_health_audit"]
