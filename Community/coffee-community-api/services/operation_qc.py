"""Operation-level QC + snapshot layer for catalog ops.

This module is the load-bearing piece for "every state-mutating
operation is self-monitoring." Three responsibilities:

  1. **Outcome logging** — every catalog-mutating op (sync, dedupe,
     scrape, full_reenrich, onboard, standardize, …) records a row
     in `catalog_operations` with its params, status, and a
     summary_json carrying counts (inserted, updated, deleted,
     failed, gated). Lifecycle: start → running → finish (success or
     failure). The orchestrator can later query "what happened?" by
     reading this table.

  2. **Pre-mutation snapshots** — before any destructive write,
     callers register the affected rows via `snapshot_rows`. We
     copy the full row state into `catalog_snapshots` keyed by
     (operation_id, table_name, row_pk). After the op finishes, T3
     can call `rollback_operation` to restore from these snapshots
     in reverse order — table-grain, per-op rollback. Storage is
     ~10KB per typical operation (much cheaper than full SQLite
     file snapshots).

  3. **Post-completion QC dispatch** — after `log_operation_finish`,
     the caller (or an automatic hook in `finish_operation_with_qc`)
     runs T1 deterministic anomaly rules over the summary. Flags
     land in `quality_reviews` with `target_table='catalog_operations'`
     so the orchestrator's existing review queue surfaces operation
     anomalies alongside row-level ones.

Design constraints (locked 2026-05-27):
  - End-of-task only — no mid-flight gates, no per-row pause-and-ask.
    Operations run to completion; QC runs over the finished outcome.
  - Post-fact flag, never block — the manager (orchestrator) doesn't
    micromanage. Flags wait in the queue for the orchestrator's next
    visit. Haiku worker threads stay relaxed.
  - Table-grain snapshots — Option A from the design discussion.
    Precise (only what changed), cheap (~10KB/op), per-op-rollback
    independent of other ops.

Public API:

  start_operation(db, kind, *, target_slug=None, params=None,
                  started_by=None, parent_operation_id=None) -> int
      Create a 'running' catalog_operations row. Returns operation_id.

  snapshot_rows(db, operation_id, table_name, rows, *,
                mutation_kind='update') -> int
      Capture pre-mutation state. Pass a list of row dicts OR an
      iterable that yields them. Returns count snapshotted.

  finish_operation(db, operation_id, *, status='succeeded',
                   summary=None, error_message=None) -> None
      Flip the row to 'succeeded' / 'failed' with a summary dict
      and ISO finished_at.

  finish_operation_with_qc(db, operation_id, *, ...same as above...)
      Same as finish_operation but ALSO triggers run_t1_operation
      + persist_flags afterwards (best-effort, never blocks).

  rollback_operation(db, operation_id, *, reason='admin') -> dict
      Restore all snapshotted rows. INSERT-rolls-back become deletes,
      DELETE-rolls-back become re-inserts, UPDATE-rolls-back overwrite
      with the captured before-state. Flips the operation row to
      'rolled_back'. Idempotent — calling twice on a rolled-back op
      is a no-op.

All callers are expected to wrap their destructive operations like:

    op_id = start_operation(db, "dedupe", params={"strategy":"url"})
    try:
        # before deleting rows X, Y, Z:
        snapshot_rows(db, op_id, "products", rows_about_to_change,
                       mutation_kind="delete")
        # ... do the deletes ...
        finish_operation_with_qc(
            db, op_id, status="succeeded",
            summary={"rows_deleted": N, ...},
        )
    except Exception as e:
        finish_operation(db, op_id, status="failed",
                          error_message=str(e))
        raise
"""

from __future__ import annotations

import datetime as _dt
import json
from typing import Any, Iterable, Optional


def _now() -> str:
    """ISO 8601 UTC, matching the existing _now_iso convention in
    routes/specific.py + services/* across the codebase."""
    return (
        _dt.datetime.now(_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


# ── Outcome logging ────────────────────────────────────────────────────────


def start_operation(
    db,
    kind: str,
    *,
    target_slug: Optional[str] = None,
    params: Optional[dict[str, Any]] = None,
    started_by: Optional[str] = None,
    parent_operation_id: Optional[int] = None,
) -> int:
    """Create a new catalog_operations row in state='running'.

    Args:
      kind: e.g. 'dedupe', 'full_reenrich_roaster', 'sync_tab2',
        'enrich_all', 'onboard_roaster', 'standardize', 'scrape',
        'article_scrape'. Free-form but use the canonical set so
        T1 rules can dispatch on kind.
      target_slug: when the op is scoped to one roaster.
      params: free-form dict — caller's input args. JSON-serialized.
      started_by: agent_identity or user_id string for audit trail.
      parent_operation_id: when this op is a child of a larger
        operation (e.g. sync_tab2 is a child of full_reenrich_roaster).

    Returns the operation_id (catalog_operations.id).
    """
    cur = db.execute(
        "INSERT INTO catalog_operations "
        "(kind, target_slug, params_json, started_at, status, "
        " started_by, parent_operation_id) "
        "VALUES (?, ?, ?, ?, 'running', ?, ?)",
        (
            kind,
            target_slug,
            json.dumps(params or {}, default=str),
            _now(),
            started_by,
            parent_operation_id,
        ),
    )
    db.commit()
    return cur.lastrowid


def finish_operation(
    db,
    operation_id: int,
    *,
    status: str = "succeeded",
    summary: Optional[dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> None:
    """Flip the operation row to a terminal state. Idempotent."""
    if status not in ("succeeded", "failed", "rolled_back"):
        raise ValueError(f"unsupported status: {status}")
    db.execute(
        "UPDATE catalog_operations SET "
        "  status = ?, finished_at = ?, summary_json = ?, "
        "  error_message = ? "
        "WHERE id = ?",
        (
            status,
            _now(),
            json.dumps(summary or {}, default=str),
            error_message,
            operation_id,
        ),
    )
    db.commit()


def finish_operation_with_qc(
    db,
    operation_id: int,
    *,
    status: str = "succeeded",
    summary: Optional[dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> dict[str, Any]:
    """Finish + immediately run T1 anomaly rules + persist flags.

    Wraps `finish_operation` with a best-effort post-completion QC
    pass. Returns a dict with the per-op review report:
      {'operation_id', 'flags_persisted': N, 'rules_fired': [...]}

    Never raises — QC failures are logged-and-swallowed so the
    operation completion path stays robust.
    """
    finish_operation(
        db, operation_id, status=status, summary=summary,
        error_message=error_message,
    )
    report: dict[str, Any] = {
        "operation_id": operation_id,
        "flags_persisted": 0,
        "rules_fired": [],
    }
    try:
        from services.quality_reviewer import persist_flags
        from services.operation_reviewer import run_t1_operation

        op_row = db.execute(
            "SELECT id, kind, target_slug, params_json, started_at, "
            "       finished_at, status, summary_json, error_message "
            "FROM catalog_operations WHERE id = ?",
            (operation_id,),
        ).fetchone()
        if not op_row:
            return report

        op_dict = dict(op_row)
        op_dict["params"] = _safe_json_load(op_dict.get("params_json"))
        op_dict["summary"] = _safe_json_load(op_dict.get("summary_json"))

        # T1 operation rules see the historical context: prior runs
        # of the same kind / same slug. Build a small lookback.
        prior = db.execute(
            "SELECT summary_json FROM catalog_operations "
            "WHERE kind = ? AND id < ? AND status = 'succeeded' "
            "ORDER BY id DESC LIMIT 5",
            (op_dict["kind"], operation_id),
        ).fetchall()
        op_dict["prior_summaries"] = [
            _safe_json_load(p[0]) for p in prior if p[0]
        ]

        bundle = run_t1_operation(op=op_dict)
        if bundle.flags:
            persist_flags(
                db, bundle, now_iso=_now(),
                default_verdict="confirmed",
            )
            report["flags_persisted"] = len(bundle.flags)
            report["rules_fired"] = [f.rule for f in bundle.flags]
    except Exception as e:
        # Best-effort — log a marker on the op row for visibility but
        # don't propagate.
        try:
            db.execute(
                "UPDATE catalog_operations SET "
                "  error_message = COALESCE(error_message, '') || "
                "    '\nqc_note: ' || ? "
                "WHERE id = ?",
                (
                    f"{type(e).__name__}: {str(e)[:200]}",
                    operation_id,
                ),
            )
            db.commit()
        except Exception:
            pass
    return report


def _safe_json_load(s: Optional[str]) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


# ── Snapshot capture ───────────────────────────────────────────────────────


def snapshot_rows(
    db,
    operation_id: int,
    table_name: str,
    rows: Iterable[dict[str, Any]],
    *,
    mutation_kind: str = "update",
) -> int:
    """Capture pre-mutation row state for later rollback.

    Args:
      operation_id: from start_operation()
      table_name: 'products' | 'roaster_articles' | 'roaster_profiles' |
                  'roaster_sources' | other catalog tables
      rows: iterable of row dicts (or sqlite3.Row — anything dict-like).
        MUST include the primary key column so rollback can locate
        the row to restore.
      mutation_kind: 'update' (default) | 'delete' | 'insert'
        - update: row exists pre-op, will be modified — rollback
                  overwrites with the captured before-state.
        - delete: row exists pre-op, will be removed — rollback
                  re-inserts.
        - insert: row does NOT exist pre-op, will be created —
                  rollback deletes by row_pk.

    Returns the count of snapshots written.
    """
    if mutation_kind not in ("update", "delete", "insert"):
        raise ValueError(f"unsupported mutation_kind: {mutation_kind}")
    pk_col = _primary_key_for_table(table_name)

    now = _now()
    count = 0
    for row in rows:
        # Normalize to dict (handle sqlite3.Row)
        if hasattr(row, "keys"):
            row_dict = {k: row[k] for k in row.keys()}
        else:
            row_dict = dict(row)
        pk_value = row_dict.get(pk_col)
        if pk_value is None:
            # Skip rows without a primary key — rollback can't
            # target them anyway.
            continue
        # For insert-snapshots, we only need the pk (the rollback is
        # a delete). For update/delete, we need the full row.
        snapshot_json = (
            json.dumps(row_dict, default=str)
            if mutation_kind != "insert"
            else None
        )
        db.execute(
            "INSERT INTO catalog_snapshots "
            "(operation_id, table_name, row_pk, row_json_before, "
            " mutation_kind, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                operation_id, table_name, str(pk_value),
                snapshot_json, mutation_kind, now,
            ),
        )
        count += 1
    db.commit()
    return count


_PRIMARY_KEYS: dict[str, str] = {
    "products": "product_id",
    "roaster_articles": "id",
    "roaster_profiles": "roaster_slug",
    "roaster_sources": "id",
    "shelf_entries": "id",
    "tasting_notes": "id",
    "click_events": "id",
    "hidden_products": "id",
    "scrape_proposals": "id",
    "enrichment_tasks": "id",
    "llm_jobs": "id",
    "jobs": "id",
}


def _primary_key_for_table(table_name: str) -> str:
    if table_name not in _PRIMARY_KEYS:
        raise ValueError(
            f"unknown table for snapshot: {table_name!r}. "
            f"Add it to _PRIMARY_KEYS in operation_qc.py."
        )
    return _PRIMARY_KEYS[table_name]


# ── Rollback ───────────────────────────────────────────────────────────────


def rollback_operation(
    db,
    operation_id: int,
    *,
    reason: str = "admin",
) -> dict[str, Any]:
    """Restore all snapshots for one operation. Reverses the
    mutations in reverse order (so dependent FK constraints unwind
    cleanly). Flips the operation row to status='rolled_back'.

    Idempotent: if the op is already rolled back, returns a no-op
    report.

    Returns: {'operation_id', 'rows_restored': N, 'rows_deleted': N,
              'tables_touched': [...]}
    """
    op_row = db.execute(
        "SELECT status FROM catalog_operations WHERE id = ?",
        (operation_id,),
    ).fetchone()
    if not op_row:
        raise ValueError(f"no such operation: {operation_id}")
    if op_row["status"] == "rolled_back":
        return {
            "operation_id": operation_id,
            "rows_restored": 0, "rows_deleted": 0,
            "tables_touched": [], "note": "already rolled back",
        }

    snapshots = db.execute(
        "SELECT id, table_name, row_pk, row_json_before, mutation_kind "
        "FROM catalog_snapshots "
        "WHERE operation_id = ? "
        "ORDER BY id DESC",
        (operation_id,),
    ).fetchall()

    report = {
        "operation_id": operation_id,
        "rows_restored": 0,
        "rows_deleted": 0,
        "tables_touched": set(),
        "reason": reason,
    }
    for snap in snapshots:
        table = snap["table_name"]
        pk_col = _primary_key_for_table(table)
        pk_value = snap["row_pk"]
        mk = snap["mutation_kind"]
        report["tables_touched"].add(table)

        if mk == "delete":
            # The op DELETED this row. Re-insert from snapshot.
            row_data = _safe_json_load(snap["row_json_before"]) or {}
            if not row_data:
                continue
            cols = ", ".join(row_data.keys())
            placeholders = ", ".join("?" for _ in row_data)
            try:
                db.execute(
                    f"INSERT OR REPLACE INTO {table} "
                    f"({cols}) VALUES ({placeholders})",
                    tuple(row_data.values()),
                )
                report["rows_restored"] += 1
            except Exception:
                continue
        elif mk == "update":
            # The op MUTATED this row. Restore the before-state.
            row_data = _safe_json_load(snap["row_json_before"]) or {}
            if not row_data:
                continue
            set_clause = ", ".join(
                f"{c} = ?" for c in row_data.keys() if c != pk_col
            )
            params = [
                row_data[c] for c in row_data.keys() if c != pk_col
            ] + [pk_value]
            if not set_clause:
                continue
            try:
                db.execute(
                    f"UPDATE {table} SET {set_clause} "
                    f"WHERE {pk_col} = ?",
                    tuple(params),
                )
                report["rows_restored"] += 1
            except Exception:
                continue
        elif mk == "insert":
            # The op INSERTED this row. Rollback = delete.
            try:
                db.execute(
                    f"DELETE FROM {table} WHERE {pk_col} = ?",
                    (pk_value,),
                )
                report["rows_deleted"] += 1
            except Exception:
                continue

    finish_operation(
        db, operation_id, status="rolled_back",
        summary={
            "rolled_back_by": reason,
            "rows_restored": report["rows_restored"],
            "rows_deleted": report["rows_deleted"],
            "tables_touched": sorted(report["tables_touched"]),
        },
    )
    report["tables_touched"] = sorted(report["tables_touched"])
    return report


__all__ = [
    "start_operation",
    "finish_operation",
    "finish_operation_with_qc",
    "snapshot_rows",
    "rollback_operation",
]
