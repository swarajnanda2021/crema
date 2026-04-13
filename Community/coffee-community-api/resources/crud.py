"""
Generic CRUD engine — reads resource definitions from registry and executes
list / get / create / update / delete / toggle operations.

All SQL is generated from the registry. Business logic hooks (notifications,
validation) are dispatched via the hooks system.
"""

import json
import datetime
from fastapi import HTTPException

from resources.registry import get_resource, RESOURCES


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── SQL Builders ─────────────────────────────────────────────────────────────

def _build_select(res, current_user_id=None):
    """Build SELECT clause with joins, counts, and current-user flags."""
    table = res["table"]
    pk = res.get("pk", "id")
    cols = [f"t.*"]

    # Joins: eager-load related fields with alias prefix
    for j in res.get("joins", []):
        alias = j["alias"]
        for f in j["fields"]:
            cols.append(f'{alias}.{f} AS {alias}_{f}')

    # Counts: inline subqueries
    for c in res.get("counts", []):
        cols.append(f'(SELECT COUNT(*) FROM {c["table"]} WHERE {c["fk"]} = t.{pk}) AS {c["name"]}')

    # Scalar subqueries (e.g. roaster_city from roaster_profiles)
    for sf in res.get("subfields", []):
        cols.append(f'{sf["sql"]} AS {sf["name"]}')

    # Current-user flags (e.g. liked_by_me)
    for fl in res.get("flags", []):
        if current_user_id:
            cols.append(
                f'(SELECT 1 FROM {fl["table"]} WHERE {fl["fk"]} = t.{pk} '
                f'AND {fl["user_col"]} = {int(current_user_id)}) AS {fl["name"]}'
            )
        else:
            cols.append(f'0 AS {fl["name"]}')

    select = ", ".join(cols)
    frm = f"FROM {table} t"

    # JOIN clauses
    for j in res.get("joins", []):
        alias = j["alias"]
        frm += f"\n    JOIN users {alias} ON t.{j['on']} = {alias}.id"

    return f"SELECT {select}\n    {frm}"


def _row_to_dict(row, res):
    """Convert a sqlite3.Row to a dict, structuring joined fields as nested objects."""
    if row is None:
        return None
    d = dict(row)

    # Remove hidden fields
    for h in res.get("hidden", []):
        d.pop(h, None)

    # Structure joined fields as nested objects AND keep flat for backward compat
    for j in res.get("joins", []):
        alias = j["alias"]
        nested = {}
        for f in j["fields"]:
            key = f"{alias}_{f}"
            if key in d:
                nested[f] = d[key]  # keep flat key AND add to nested
        d[alias] = nested

    # Parse JSON fields
    for fname, fdef in res.get("fields", {}).items():
        if fdef.get("type") == "json" and fname in d and isinstance(d[fname], str):
            try:
                d[fname] = json.loads(d[fname])
            except (json.JSONDecodeError, TypeError):
                pass

    # Convert flag values to booleans
    for fl in res.get("flags", []):
        if fl["name"] in d:
            d[fl["name"]] = bool(d[fl["name"]])

    # Parse images_json → images (for posts)
    if "images_json" in d:
        raw = d.pop("images_json", None)
        images = []
        if raw:
            try:
                parsed = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(parsed, list):
                    images = parsed
            except (json.JSONDecodeError, TypeError):
                pass
        if not images and d.get("cover_image_url"):
            images = [d["cover_image_url"]]
        d["images"] = images

    return d


# ── Operations ───────────────────────────────────────────────────────────────

def list_resource(db, name, *, filters=None, limit=None, offset=0,
                  current_user_id=None, parent_id=None, order=None):
    """List resources with filtering, pagination, joins, counts."""
    res = get_resource(name)
    lim = limit or res.get("limit", 20)
    sql = _build_select(res, current_user_id)

    where_clauses = []
    params = []

    # Parent filter (e.g. post_id for comments)
    if parent_id is not None and "fk" in res:
        where_clauses.append(f"t.{res['fk']} = ?")
        params.append(parent_id)

    # Custom filters
    if filters:
        for k, v in filters.items():
            if k in res.get("fields", {}):
                where_clauses.append(f"t.{k} = ?")
                params.append(v)

    if where_clauses:
        sql += "\n    WHERE " + " AND ".join(where_clauses)

    # Count total before pagination
    count_sql = f"SELECT COUNT(*) as c FROM {res['table']} t"
    if where_clauses:
        count_sql += " WHERE " + " AND ".join(where_clauses)
    total = db.execute(count_sql, params).fetchone()["c"]

    # Order and paginate
    ord = order or res.get("order", f"{res.get('pk', 'id')} DESC")
    sql += f"\n    ORDER BY t.{ord}" if "." not in ord else f"\n    ORDER BY {ord}"
    sql += f"\n    LIMIT ? OFFSET ?"
    params.extend([lim, offset])

    rows = db.execute(sql, params).fetchall()
    items = [_row_to_dict(r, res) for r in rows]

    # Embed self-referencing objects (e.g. original_post for reposts)
    for embed in res.get("embeds", []):
        for item in items:
            fk_val = item.get(embed["self_fk"])
            if fk_val:
                embed_row = db.execute(
                    _build_select(res, current_user_id) + f" WHERE t.{res['pk']} = ?",
                    (fk_val,)
                ).fetchone()
                item[embed["name"]] = _row_to_dict(embed_row, res) if embed_row else None
            else:
                item[embed["name"]] = None

    # Group by field if specified (e.g. shelves grouped by shelf category)
    if res.get("group_by"):
        grouped = {}
        for item in items:
            key = item.get(res["group_by"], "other")
            grouped.setdefault(key, []).append(item)
        return grouped, total

    return items, total


def get_resource_by_id(db, name, id_val, *, current_user_id=None):
    """Get a single resource by primary key."""
    res = get_resource(name)
    pk = res.get("pk", "id")
    sql = _build_select(res, current_user_id) + f"\n    WHERE t.{pk} = ?"
    row = db.execute(sql, (id_val,)).fetchone()
    if not row:
        raise HTTPException(404, f"{name} not found")
    item = _row_to_dict(row, res)

    # Embeds
    for embed in res.get("embeds", []):
        fk_val = item.get(embed["self_fk"])
        if fk_val:
            embed_row = db.execute(
                _build_select(res, current_user_id) + f" WHERE t.{res['pk']} = ?",
                (fk_val,)
            ).fetchone()
            item[embed["name"]] = _row_to_dict(embed_row, res) if embed_row else None
        else:
            item[embed["name"]] = None

    return item


def create_resource(db, name, data, *, current_user=None):
    """Create a new resource. Auto-fills read-only/auto fields."""
    res = get_resource(name)
    now = _now()
    fields = res.get("fields", {})
    row_data = {}

    for fname, fdef in fields.items():
        if fdef.get("ro") and fdef.get("auto"):
            # Auto-fill
            auto = fdef["auto"]
            if auto == "current_user" and current_user:
                row_data[fname] = current_user["id"]
            elif auto == "user_slug" and current_user:
                row_data[fname] = current_user.get("roaster_slug") or f"user_{current_user['id']}"
            elif auto == "now":
                row_data[fname] = now
            elif auto == "current_user_optional":
                row_data[fname] = current_user["id"] if current_user else None
        elif fdef.get("auto") == "now" and fname not in data:
            row_data[fname] = now
        elif fdef.get("auto") == "user_slug" and fname not in data and current_user:
            row_data[fname] = current_user.get("roaster_slug") or f"user_{current_user['id']}"
        elif fname in data:
            val = data[fname]
            if fdef.get("type") == "json" and not isinstance(val, str):
                val = json.dumps(val) if val is not None else None
            row_data[fname] = val
        elif "default" in fdef:
            row_data[fname] = fdef["default"]

    cols = list(row_data.keys())
    placeholders = ", ".join(["?"] * len(cols))
    col_str = ", ".join(cols)
    vals = [row_data[c] for c in cols]

    cursor = db.execute(
        f"INSERT INTO {res['table']} ({col_str}) VALUES ({placeholders})", vals
    )
    db.commit()

    pk = res.get("pk", "id")
    pk_val = cursor.lastrowid if res.get("pk_type") != "str" else row_data.get(pk)
    return get_resource_by_id(db, name, pk_val, current_user_id=current_user["id"] if current_user else None)


def update_resource(db, name, id_val, data, *, current_user=None):
    """Update an existing resource. Only updates provided fields."""
    res = get_resource(name)
    pk = res.get("pk", "id")
    fields = res.get("fields", {})

    # Ownership check
    if res.get("owner") and current_user:
        owner_col = res["owner"]
        row = db.execute(f"SELECT {owner_col} FROM {res['table']} WHERE {pk} = ?", (id_val,)).fetchone()
        if not row:
            raise HTTPException(404, f"{name} not found")
        if row[owner_col] != current_user["id"]:
            raise HTTPException(403, "Not authorized")

    sets = []
    vals = []
    for fname, val in data.items():
        if fname in fields and not fields[fname].get("ro"):
            if fields[fname].get("type") == "json" and not isinstance(val, str):
                val = json.dumps(val) if val is not None else None
            sets.append(f"{fname} = ?")
            vals.append(val)

    if not sets:
        raise HTTPException(422, "No valid fields to update")

    # Auto-update updated_at if field exists
    if "updated_at" in fields:
        sets.append("updated_at = ?")
        vals.append(_now())

    vals.append(id_val)
    db.execute(f"UPDATE {res['table']} SET {', '.join(sets)} WHERE {pk} = ?", vals)
    db.commit()

    return get_resource_by_id(db, name, id_val, current_user_id=current_user["id"] if current_user else None)


def delete_resource(db, name, id_val, *, current_user=None):
    """Delete a resource by primary key with ownership check."""
    res = get_resource(name)
    pk = res.get("pk", "id")

    if res.get("owner") and current_user:
        owner_col = res["owner"]
        row = db.execute(f"SELECT {owner_col} FROM {res['table']} WHERE {pk} = ?", (id_val,)).fetchone()
        if not row:
            raise HTTPException(404, f"{name} not found")
        if row[owner_col] != current_user["id"]:
            raise HTTPException(403, "Not authorized")

    db.execute(f"DELETE FROM {res['table']} WHERE {pk} = ?", (id_val,))
    db.commit()
    return {"deleted": True}


def toggle_resource(db, name, target_id, *, current_user):
    """Toggle a sub-resource (like/follow). Returns toggled state + count."""
    res = get_resource(name)
    fk = res["fk"]
    user_col = res["user_col"]
    table = res["table"]
    now = _now()

    existing = db.execute(
        f"SELECT id FROM {table} WHERE {user_col} = ? AND {fk} = ?",
        (current_user["id"], target_id),
    ).fetchone()

    if existing:
        db.execute(f"DELETE FROM {table} WHERE id = ?", (existing["id"],))
        db.commit()
        count = db.execute(f"SELECT COUNT(*) as c FROM {table} WHERE {fk} = ?", (target_id,)).fetchone()["c"]
        return False, count
    else:
        db.execute(
            f"INSERT INTO {table} ({user_col}, {fk}, created_at) VALUES (?, ?, ?)",
            (current_user["id"], target_id, now),
        )
        db.commit()
        count = db.execute(f"SELECT COUNT(*) as c FROM {table} WHERE {fk} = ?", (target_id,)).fetchone()["c"]
        return True, count
