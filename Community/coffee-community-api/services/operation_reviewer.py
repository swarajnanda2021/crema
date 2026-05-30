"""T1 deterministic rules for catalog operations.

Where `quality_reviewer.run_t1_product` reviews a row's output
fields, `run_t1_operation` reviews the OUTCOME SUMMARY of a
state-mutating operation. Catches anomalies that no row-level rule
can see — mass deletes, enrichment-rate drops, duplicate-enqueue
bursts, scrape silence.

Inputs:
  op = {
    'id': int,
    'kind': str,                  # 'dedupe', 'full_reenrich_roaster', etc.
    'target_slug': Optional[str],
    'params': dict,
    'summary': dict,              # counts: inserted, updated, deleted, ...
    'status': 'succeeded' | 'failed' | 'rolled_back',
    'error_message': Optional[str],
    'prior_summaries': list[dict] # last N prior runs of the same kind
                                  # (for trend detection)
  }

Output:
  ReviewBundle(target_table='catalog_operations', target_id=str(op_id),
               flags=[QualityFlag, ...])

All rules are PURE — no DB, no LLM. The caller in
`operation_qc.finish_operation_with_qc` does the persistence.

Bio-style fast-path: operation flags are deterministic facts about
counts. They go straight to verdict='confirmed' via
persist_flags(default_verdict='confirmed'), bypassing T2 Haiku
review. T3 (orchestrator) decides whether to rollback / accept /
investigate based on the lesson attached.
"""

from __future__ import annotations

from typing import Any, Optional

from services.quality_reviewer import QualityFlag, ReviewBundle


# Thresholds — tuned conservatively. T1 flags should fire when
# something is "worth a human look," not at every minor variance.
_MASS_DELETE_THRESHOLD_PCT = 30  # > N% of catalog rows deleted in one op
_MASS_DELETE_ABS_FLOOR = 20      # AND at least this many absolute rows
_ENRICHED_DROP_THRESHOLD_PCT = 20  # enriched count dropped > N% vs prior
_FAILED_RATE_THRESHOLD_PCT = 30  # failed / total > N%
_DUPLICATE_ENQUEUE_BURST = 3     # same kind enqueued > N times in 5 min
_DEDUPE_OVERSIZED_PCT = 25       # > N% of catalog consolidated in one op


# ── Helpers ────────────────────────────────────────────────────────────────


def _summary_int(op: dict[str, Any], *keys: str) -> int:
    """Read an integer from op['summary'][key]. Returns 0 if missing."""
    summary = op.get("summary") or {}
    for k in keys:
        if k in summary:
            try:
                return int(summary[k])
            except (TypeError, ValueError):
                return 0
    return 0


def _kind_in(op: dict[str, Any], *kinds: str) -> bool:
    return op.get("kind") in kinds


# ── Rules ──────────────────────────────────────────────────────────────────


def _t1_op_mass_delete(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Operation deleted > N% of a roaster's (or the catalog's) rows.
    Catches: refresh that wipes a roaster after a 503, dedupe that
    over-collapses, sync that misreads a replatform as "all removed."
    """
    deleted = _summary_int(op, "rows_deleted", "products_removed", "deleted")
    if deleted < _MASS_DELETE_ABS_FLOOR:
        return None

    # Try to compute % against the population the op was scoped to.
    # When target_slug is set, scope is one roaster's products.
    # Otherwise, scope is catalog-wide.
    prior = op.get("prior_summaries") or []
    last_total = None
    for p in prior:
        if not isinstance(p, dict):
            continue
        for k in ("products_total", "total", "rows_total", "scoped_total"):
            if k in p:
                try:
                    last_total = int(p[k])
                    break
                except (TypeError, ValueError):
                    pass
        if last_total is not None:
            break

    pct_str = ""
    if last_total and last_total > 0:
        pct = (deleted / last_total) * 100
        if pct < _MASS_DELETE_THRESHOLD_PCT:
            return None
        pct_str = f" ({pct:.0f}% of {last_total} prior rows)"

    return QualityFlag(
        tier=1, rule="op_mass_delete", field=None,
        evidence=(
            f"Operation kind={op.get('kind')!r} deleted {deleted} "
            f"rows{pct_str}. Verify this isn't a transient scrape "
            "failure or an over-aggressive dedupe."
        ),
        flagged_value=str(deleted),
    )


def _t1_op_enriched_count_dropped(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Total enriched count dropped meaningfully vs the prior run.
    Catches: bulk re-enrich that nuked rows it should have kept.
    """
    if not _kind_in(op, "enrich_all", "full_reenrich_roaster", "bulk_reenrich_roaster"):
        return None

    summary = op.get("summary") or {}
    current = None
    for k in ("enriched_total", "total_enriched", "enriched"):
        if k in summary:
            try:
                current = int(summary[k]); break
            except (TypeError, ValueError):
                pass
    if current is None:
        return None

    prior = op.get("prior_summaries") or []
    prior_enriched: Optional[int] = None
    for p in prior:
        if not isinstance(p, dict):
            continue
        for k in ("enriched_total", "total_enriched", "enriched"):
            if k in p:
                try:
                    prior_enriched = int(p[k]); break
                except (TypeError, ValueError):
                    pass
        if prior_enriched is not None:
            break

    if prior_enriched is None or prior_enriched == 0:
        return None
    if current >= prior_enriched:
        return None
    drop_pct = ((prior_enriched - current) / prior_enriched) * 100
    if drop_pct < _ENRICHED_DROP_THRESHOLD_PCT:
        return None

    return QualityFlag(
        tier=1, rule="op_enriched_count_dropped", field=None,
        evidence=(
            f"Enriched count fell {drop_pct:.0f}% — was {prior_enriched}, "
            f"now {current}. Bulk re-enrich shouldn't shrink the catalog; "
            "investigate whether rows were incorrectly deleted, marked "
            "failed, or fell out of the enrichment-eligible set."
        ),
        flagged_value=f"prior={prior_enriched} now={current}",
    )


def _t1_op_failed_rate_high(op: dict[str, Any]) -> Optional[QualityFlag]:
    """High failure rate on a per-roaster enrichment run. Catches:
    scraper broke for this storefront, Cloudflare blocking us, etc."""
    if not _kind_in(op, "full_reenrich_roaster", "scrape_one_roaster",
                    "enrich_roaster"):
        return None
    summary = op.get("summary") or {}
    failed = _summary_int(op, "failed", "rows_failed", "errors")
    succeeded = _summary_int(op, "enriched", "succeeded", "inserted", "updated")
    total = failed + succeeded
    if total < 5:
        return None  # too few to draw a conclusion
    fail_pct = (failed / total) * 100
    if fail_pct < _FAILED_RATE_THRESHOLD_PCT:
        return None
    return QualityFlag(
        tier=1, rule="op_failed_rate_high", field=None,
        evidence=(
            f"Operation kind={op.get('kind')!r} failed "
            f"{failed}/{total} ({fail_pct:.0f}%). Storefront may "
            "be down, Cloudflare blocking, or scraper degraded."
        ),
        flagged_value=f"{failed}/{total}",
    )


def _t1_op_zero_discovered(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Scrape returned ZERO products for a roaster that had > 5 last
    time. Suggests storefront down or scraper broken."""
    if not _kind_in(op, "sync_tab2", "sync_tab1", "scrape_one_roaster"):
        return None
    current_discovered = _summary_int(
        op, "products_discovered", "discovered", "storefront_products",
        "products_pending",
    )
    if current_discovered > 0:
        return None
    prior = op.get("prior_summaries") or []
    prior_discovered: Optional[int] = None
    for p in prior:
        if not isinstance(p, dict):
            continue
        for k in ("products_discovered", "discovered",
                  "storefront_products", "products_pending"):
            if k in p:
                try:
                    prior_discovered = int(p[k]); break
                except (TypeError, ValueError):
                    pass
        if prior_discovered is not None:
            break
    if prior_discovered is None or prior_discovered < 5:
        return None
    return QualityFlag(
        tier=1, rule="op_zero_discovered_storefront_alive", field=None,
        evidence=(
            f"Operation returned ZERO discovered products, but the "
            f"previous run found {prior_discovered}. Storefront down, "
            "Cloudflare gate, or scraper regression."
        ),
        flagged_value="0",
    )


def _t1_op_dedupe_oversized(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Dedupe consolidated > N% of catalog in one go. May indicate
    URL normalization over-collapsed (treating distinct products as
    duplicates)."""
    if op.get("kind") != "dedupe":
        return None
    deleted = _summary_int(op, "rows_deleted", "siblings_deleted")
    if deleted < 50:
        return None
    # Approximate "catalog size" — best available signal is whatever
    # the caller put in summary, or the rows_kept + rows_deleted.
    kept = _summary_int(op, "rows_kept", "canonicals_kept")
    total = kept + deleted
    if total == 0:
        return None
    pct = (deleted / total) * 100
    if pct < _DEDUPE_OVERSIZED_PCT:
        return None
    return QualityFlag(
        tier=1, rule="op_dedupe_oversized", field=None,
        evidence=(
            f"Dedupe consolidated {deleted}/{total} rows "
            f"({pct:.0f}%). May indicate URL normalization is "
            "treating distinct products as duplicates — review "
            "the canonical choices before accepting."
        ),
        flagged_value=f"{deleted}/{total}",
    )


def _t1_op_status_failed(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Operation finished with status='failed'. Always a flag."""
    if op.get("status") != "failed":
        return None
    return QualityFlag(
        tier=1, rule="op_status_failed", field=None,
        evidence=(
            f"Operation kind={op.get('kind')!r} terminated in "
            f"status='failed': {(op.get('error_message') or 'no error message')[:200]}"
        ),
        flagged_value=op.get("error_message") or "failed",
    )


def _t1_op_duplicate_enqueue_burst(op: dict[str, Any]) -> Optional[QualityFlag]:
    """Same kind enqueued many times rapidly. Stale flag in prior
    sessions: the standardize lock fix was meant to prevent this;
    if we see it again it's a regression."""
    # Burst detection needs the prior_summaries count for "same kind"
    # — but we get them via the explicit-since-last-N lookback in
    # finish_operation_with_qc. The prior_summaries IS that lookback.
    # If we see >= _DUPLICATE_ENQUEUE_BURST priors within 5 minutes
    # of THIS op's started_at, flag.
    if op.get("kind") != "standardize":
        return None  # Only standardize cares about this today
    prior = op.get("prior_summaries") or []
    if len(prior) < _DUPLICATE_ENQUEUE_BURST:
        return None
    return QualityFlag(
        tier=1, rule="op_duplicate_enqueue_burst", field=None,
        evidence=(
            f"Standardize fired {len(prior)+1} times in the recent "
            "window. Lock/dedupe mechanism may be regressing — verify "
            "_wait_and_standardize lock + follow-up flag are working."
        ),
        flagged_value=str(len(prior) + 1),
    )


# ── Public entry point ─────────────────────────────────────────────────────


def run_t1_operation(*, op: dict[str, Any]) -> ReviewBundle:
    """Run all T1 operation rules against a finished catalog_operations
    row. Returns a ReviewBundle keyed on target_table='catalog_operations'
    and target_id=str(operation_id).
    """
    flags: list[QualityFlag] = []
    if f := _t1_op_status_failed(op):
        flags.append(f)
    if f := _t1_op_mass_delete(op):
        flags.append(f)
    if f := _t1_op_enriched_count_dropped(op):
        flags.append(f)
    if f := _t1_op_failed_rate_high(op):
        flags.append(f)
    if f := _t1_op_zero_discovered(op):
        flags.append(f)
    if f := _t1_op_dedupe_oversized(op):
        flags.append(f)
    if f := _t1_op_duplicate_enqueue_burst(op):
        flags.append(f)
    return ReviewBundle(
        target_table="catalog_operations",
        target_id=str(op.get("id") or "0"),
        flags=flags,
    )


__all__ = ["run_t1_operation"]
