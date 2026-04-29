"""
Recycle-bin / archive service. Every destructive delete across the
registry funnels through `capture()` before the row leaves its origin
table — the row is serialised as JSON into the `trash` table along
with the owning user id, so the bin UI can list "everything I've
deleted" categorically and restore one at a time.

Contract:
- Hard deletes on registry resources (via `resources/crud.py` and the
  hand-rolled routes in `routes/specific.py`) call `capture()` first.
- Toggle deletes (likes / follows) and telemetry (click events) are
  NOT captured — they aren't "deletes" in user language.
- Restore inserts the payload back into the origin table with the
  original primary key. If the PK is already taken (another row
  created in the meantime), restore fails with a 409.
"""

import json
import datetime
from typing import Optional, List, Dict, Any

from fastapi import HTTPException


# Map of entity_type → origin-table metadata. Used both for owner
# resolution (who does this trash row belong to) and for the restore
# INSERT. Adding a new entity here is all it takes to bring a new
# delete path into the bin.
ENTITY_MAP = {
    "posts":            {"table": "roaster_posts",  "pk": "id",        "owner_col": "user_id",    "owner_kind": "user"},
    "post_comments":    {"table": "post_comments",  "pk": "id",        "owner_col": "user_id",    "owner_kind": "user"},
    "tasting_notes":    {"table": "tasting_notes",  "pk": "id",        "owner_col": "user_id",    "owner_kind": "user"},
    "shelf_entries":    {"table": "shelf_entries",  "pk": "id",        "owner_col": "user_id",    "owner_kind": "user"},
    "brew_methods":     {"table": "brew_methods",   "pk": "id",        "owner_col": "roaster_slug","owner_kind": "roaster"},
    "roaster_products": {"table": "roaster_products","pk": "product_id","owner_col": "roaster_slug","owner_kind": "roaster"},
}


# ── Labels ──────────────────────────────────────────────────────────

def _label_for(entity_type: str, row: dict) -> str:
    """One-line human-readable label for the bin UI. Falls back to
    entity_type + pk when the row carries nothing friendlier."""
    if entity_type == "posts":
        return (row.get("title") or row.get("teaser") or "Post")[:80]
    if entity_type == "post_comments":
        return (row.get("comment") or "Comment")[:80]
    if entity_type == "tasting_notes":
        return f"Tasting note · {row.get('product_id', '')}"[:80]
    if entity_type == "shelf_entries":
        return f"Shelf · {row.get('product_id', '')}"[:80]
    if entity_type == "brew_methods":
        return f"{row.get('method', 'Brew method')} · {row.get('product_id', '')}"[:80]
    if entity_type == "roaster_products":
        return (row.get("coffee_name") or row.get("product_id") or "Product")[:80]
    return entity_type


# ── Owner resolution ────────────────────────────────────────────────

def _resolve_owner_user_id(db, entity_type: str, row: dict) -> int:
    """Resolve the user whose bin this row lives in."""
    meta = ENTITY_MAP.get(entity_type)
    if not meta:
        raise HTTPException(500, f"trash: unknown entity_type {entity_type!r}")
    col = meta["owner_col"]
    val = row.get(col)
    if val is None:
        raise HTTPException(500, f"trash: row missing owner column {col}")
    kind = meta["owner_kind"]
    if kind == "user":
        return int(val)
    if kind == "roaster":
        r = db.execute("SELECT id FROM users WHERE roaster_slug = ? LIMIT 1", (val,)).fetchone()
        if not r:
            raise HTTPException(500, f"trash: no user owns roaster_slug={val}")
        return int(r["id"])
    raise HTTPException(500, f"trash: unknown owner_kind {kind!r}")


# ── Capture ─────────────────────────────────────────────────────────

def capture(db, *, entity_type: str, entity_id, row: dict, deleted_by_user_id: int) -> int:
    """Insert a snapshot of `row` into the trash table. Returns the
    new trash row id. Caller is responsible for the DELETE FROM on
    the origin table immediately after — we stay out of that so the
    caller keeps its existing ownership checks and hook dispatch."""
    if entity_type not in ENTITY_MAP:
        # Unknown entities silently skip capture — better to leak a
        # delete than crash the delete flow.
        return 0
    try:
        owner_user_id = _resolve_owner_user_id(db, entity_type, row)
    except HTTPException:
        # If we can't resolve the owner we skip the trash capture
        # rather than blocking the delete. Likelier than not it means
        # a seed row with no account behind it.
        return 0
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = json.dumps(row, default=str)
    cur = db.execute(
        """INSERT INTO trash
           (owner_user_id, entity_type, entity_id, payload_json, label, deleted_at, deleted_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (owner_user_id, entity_type, str(entity_id), payload, _label_for(entity_type, row), now, deleted_by_user_id),
    )
    db.commit()
    return cur.lastrowid


def fetch_row_before_delete(db, entity_type: str, entity_id) -> Optional[Dict[str, Any]]:
    """Convenience helper — SELECT the row about to be deleted so the
    caller can pass it to `capture()`. Returns a plain dict or None."""
    meta = ENTITY_MAP.get(entity_type)
    if not meta:
        return None
    row = db.execute(f"SELECT * FROM {meta['table']} WHERE {meta['pk']} = ?", (entity_id,)).fetchone()
    if not row:
        return None
    return dict(row)


# ── List / restore / purge ──────────────────────────────────────────

def list_for_user(db, user_id: int) -> List[Dict[str, Any]]:
    """Return every trash entry owned by `user_id`, newest first.
    Grouping is done on the frontend via the entity_type column."""
    rows = db.execute(
        "SELECT * FROM trash WHERE owner_user_id = ? ORDER BY deleted_at DESC",
        (user_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d.pop("payload_json"))
        except Exception:
            d["payload"] = {}
        out.append(d)
    return out


def _trash_row(db, trash_id: int):
    r = db.execute("SELECT * FROM trash WHERE id = ?", (trash_id,)).fetchone()
    return dict(r) if r else None


def restore(db, trash_id: int, *, current_user) -> dict:
    """Pop a trash entry and re-insert into its origin table. Owner
    must match the signed-in user. Returns the restored row."""
    entry = _trash_row(db, trash_id)
    if not entry:
        raise HTTPException(404, "Trash entry not found")
    if entry["owner_user_id"] != current_user["id"]:
        raise HTTPException(403, "Not your trash")
    meta = ENTITY_MAP.get(entry["entity_type"])
    if not meta:
        raise HTTPException(500, f"trash: unknown entity_type {entry['entity_type']!r}")
    payload = json.loads(entry["payload_json"])
    table = meta["table"]
    pk = meta["pk"]
    # Primary-key conflict guard — if something else re-used the
    # original pk while this row was in the bin, refuse to restore
    # rather than silently overwrite.
    existing = db.execute(f"SELECT 1 FROM {table} WHERE {pk} = ?", (payload.get(pk),)).fetchone()
    if existing:
        raise HTTPException(409, f"A {entry['entity_type']} with that id already exists — cannot restore")
    cols = list(payload.keys())
    placeholders = ",".join(["?"] * len(cols))
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
    db.execute(sql, tuple(payload.get(c) for c in cols))
    db.execute("DELETE FROM trash WHERE id = ?", (trash_id,))
    db.commit()
    return {"restored": True, "entity_type": entry["entity_type"], "entity_id": entry["entity_id"]}


def purge(db, trash_id: int, *, current_user) -> dict:
    """Permanent delete — removes the trash entry itself. No undo."""
    entry = _trash_row(db, trash_id)
    if not entry:
        raise HTTPException(404, "Trash entry not found")
    if entry["owner_user_id"] != current_user["id"]:
        raise HTTPException(403, "Not your trash")
    db.execute("DELETE FROM trash WHERE id = ?", (trash_id,))
    db.commit()
    return {"purged": True}


def purge_all(db, *, current_user) -> dict:
    """Empty the bin for the current user."""
    cur = db.execute("DELETE FROM trash WHERE owner_user_id = ?", (current_user["id"],))
    db.commit()
    return {"purged": cur.rowcount}
