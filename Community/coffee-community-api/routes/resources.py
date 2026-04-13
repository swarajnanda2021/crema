"""
Auto-generated CRUD routes from the resource registry.

Every resource gets: list, get, create, update, delete.
Toggle resources get: toggle.
Nested resources (comments on posts) get scoped list/create.
"""

from fastapi import APIRouter, Depends, Header, Query
from database import get_db
from resources.registry import RESOURCES, get_resource
from resources.crud import (
    list_resource, get_resource_by_id, create_resource,
    update_resource, delete_resource, toggle_resource,
)
from resources.envelope import ok, toggled
from services.auth import get_current_user, get_optional_user
from services.notifications import run_hook

router = APIRouter(prefix="/api", tags=["Resources"])


# ── Standard CRUD resources ──────────────────────────────────────────────────

# List
@router.get("/{resource}")
def resource_list(resource: str, limit: int = None, offset: int = 0,
                  authorization: str = Header(None)):
    res = get_resource(resource)
    if res.get("type") == "toggle" or res.get("write_only"):
        from fastapi import HTTPException
        raise HTTPException(404, "Not a listable resource")

    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None

    # Check auth
    auth_req = res.get("auth", {}).get("list")
    if auth_req == "self" and not current_user:
        from fastapi import HTTPException
        raise HTTPException(401, "Authentication required")

    db = get_db()
    try:
        # Build filters from query params
        from starlette.requests import Request
        filters = {}

        # Self-scoped resources (e.g. notifications): filter to current user
        if auth_req == "self" and current_user:
            filters[res.get("owner", "user_id")] = current_user["id"]

        data, total = list_resource(db, resource, filters=filters,
                                    limit=limit, offset=offset, current_user_id=uid)
        lim = limit or res.get("limit", 20)
        return ok(data, resource=resource, total=total, limit=lim, offset=offset)
    finally:
        db.close()


# List with filter (e.g. /api/posts?user_id=5 or /api/shelves?user_id=3)
@router.get("/{resource}/filter")
def resource_list_filtered(resource: str, limit: int = None, offset: int = 0,
                           user_id: int = None, product_id: str = None,
                           roaster_slug: str = None, post_type: str = None,
                           authorization: str = Header(None)):
    res = get_resource(resource)
    if res.get("type") == "toggle" or res.get("write_only"):
        from fastapi import HTTPException
        raise HTTPException(404, "Not a listable resource")

    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        filters = {}
        if user_id is not None:
            filters["user_id"] = user_id
        if product_id is not None:
            filters["product_id"] = product_id
        if roaster_slug is not None:
            filters["roaster_slug"] = roaster_slug
        if post_type is not None:
            filters["post_type"] = post_type

        data, total = list_resource(db, resource, filters=filters,
                                    limit=limit, offset=offset, current_user_id=uid)
        lim = limit or res.get("limit", 20)
        return ok(data, resource=resource, total=total, limit=lim, offset=offset)
    finally:
        db.close()


# Get by ID
@router.get("/{resource}/{id}")
def resource_get(resource: str, id: str, authorization: str = Header(None)):
    res = get_resource(resource)
    if res.get("type") == "toggle":
        from fastapi import HTTPException
        raise HTTPException(404, "Not a gettable resource")

    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None

    # Convert ID type
    pk_type = res.get("pk_type", "int")
    id_val = id if pk_type == "str" else int(id)

    db = get_db()
    try:
        item = get_resource_by_id(db, resource, id_val, current_user_id=uid)
        return ok(item, resource=resource)
    finally:
        db.close()


# Create
@router.post("/{resource}", status_code=201)
def resource_create(resource: str, body: dict, user=Depends(get_current_user)):
    res = get_resource(resource)
    auth_req = res.get("auth", {}).get("create")
    if auth_req == "required" and not user:
        from fastapi import HTTPException
        raise HTTPException(401, "Authentication required")

    db = get_db()
    try:
        item = create_resource(db, resource, body, current_user=user)

        # Run hooks
        for hook in res.get("hooks", {}).get("on_create", []):
            run_hook(hook, db, resource_name=resource, item=item, current_user=user)

        return ok(item, resource=resource)
    finally:
        db.close()


# Update
@router.put("/{resource}/{id}")
def resource_update(resource: str, id: str, body: dict, user=Depends(get_current_user)):
    res = get_resource(resource)
    pk_type = res.get("pk_type", "int")
    id_val = id if pk_type == "str" else int(id)

    db = get_db()
    try:
        item = update_resource(db, resource, id_val, body, current_user=user)
        return ok(item, resource=resource)
    finally:
        db.close()


# Delete
@router.delete("/{resource}/{id}")
def resource_delete(resource: str, id: str, user=Depends(get_current_user)):
    res = get_resource(resource)
    pk_type = res.get("pk_type", "int")
    id_val = id if pk_type == "str" else int(id)

    db = get_db()
    try:
        result = delete_resource(db, resource, id_val, current_user=user)
        return ok(result, resource=resource)
    finally:
        db.close()


# ── Toggle resources (likes, follows) ────────────────────────────────────────

@router.post("/{resource}/{target_id}/toggle")
def resource_toggle(resource: str, target_id: str, user=Depends(get_current_user)):
    res = get_resource(resource)
    if res.get("type") != "toggle":
        from fastapi import HTTPException
        raise HTTPException(400, f"{resource} is not a toggle resource")

    # Convert target_id type
    fk_type = res.get("fk_type", "int")
    tid = target_id if fk_type == "str" else int(target_id)

    db = get_db()
    try:
        state, count = toggle_resource(db, resource, tid, current_user=user)

        # Run hooks
        if state:
            for hook in res.get("hooks", {}).get("on_toggle_on", []):
                run_hook(hook, db, resource_name=resource, target_id=tid, current_user=user)

        return toggled(state, count, resource=resource)
    finally:
        db.close()


# ── Nested resource list/create (e.g. /api/posts/42/post_comments) ───────────

@router.get("/{parent_resource}/{parent_id}/{child_resource}")
def nested_list(parent_resource: str, parent_id: str, child_resource: str,
                limit: int = None, offset: int = 0,
                authorization: str = Header(None)):
    child_res = get_resource(child_resource)
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None

    # Convert parent ID
    parent_def = get_resource(parent_resource)
    pk_type = parent_def.get("pk_type", "int")
    pid = parent_id if pk_type == "str" else int(parent_id)

    db = get_db()
    try:
        data, total = list_resource(db, child_resource, parent_id=pid,
                                    limit=limit, offset=offset, current_user_id=uid)
        lim = limit or child_res.get("limit", 50)
        return ok(data, resource=child_resource, total=total, limit=lim, offset=offset)
    finally:
        db.close()


@router.post("/{parent_resource}/{parent_id}/{child_resource}", status_code=201)
def nested_create(parent_resource: str, parent_id: str, child_resource: str,
                  body: dict, user=Depends(get_current_user)):
    child_res = get_resource(child_resource)
    parent_def = get_resource(parent_resource)
    pk_type = parent_def.get("pk_type", "int")
    pid = parent_id if pk_type == "str" else int(parent_id)

    # Inject parent FK into body
    fk = child_res.get("fk")
    if fk:
        body[fk] = pid

    db = get_db()
    try:
        item = create_resource(db, child_resource, body, current_user=user)

        # Run hooks
        for hook in child_res.get("hooks", {}).get("on_create", []):
            run_hook(hook, db, resource_name=child_resource, item=item, current_user=user)

        return ok(item, resource=child_resource)
    finally:
        db.close()


# ── Convenience: follow status check ─────────────────────────────────────────

@router.get("/follows/{slug}/status")
def follow_status(slug: str, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    if not current_user:
        return ok({"following": False}, resource="follows")
    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM follows WHERE follower_user_id = ? AND roaster_slug = ?",
            (current_user["id"], slug),
        ).fetchone()
        return ok({"following": bool(row)}, resource="follows")
    finally:
        db.close()


# ── Convenience: followers list with count ───────────────────────────────────

@router.get("/follows/{slug}/followers")
def followers_list(slug: str):
    db = get_db()
    try:
        count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
        rows = db.execute(
            "SELECT u.username, u.display_name, u.avatar_url, u.location, u.account_type, u.roaster_slug "
            "FROM follows f JOIN users u ON f.follower_user_id = u.id WHERE f.roaster_slug = ?",
            (slug,),
        ).fetchall()
        return ok({"follower_count": count, "followers": [dict(r) for r in rows]}, resource="follows")
    finally:
        db.close()


# ── Convenience: user's following list ───────────────────────────────────────

@router.get("/me/following")
def my_following(user=Depends(get_current_user)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT f.roaster_slug as slug, f.created_at as followed_at FROM follows f "
            "WHERE f.follower_user_id = ? ORDER BY f.created_at DESC",
            (user["id"],),
        ).fetchall()
        following = []
        for r in rows:
            slug = r["slug"]
            # Try to resolve user info
            if slug.startswith("user_"):
                uid = int(slug.replace("user_", ""))
                u = db.execute("SELECT username, display_name, avatar_url, account_type, roaster_slug FROM users WHERE id = ?", (uid,)).fetchone()
            else:
                u = db.execute("SELECT username, display_name, avatar_url, account_type, roaster_slug FROM users WHERE roaster_slug = ?", (slug,)).fetchone()
            if u:
                fc = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
                following.append({
                    "slug": slug, "username": u["username"], "display_name": u["display_name"],
                    "avatar_url": u["avatar_url"], "account_type": u["account_type"],
                    "roaster_slug": u["roaster_slug"], "follower_count": fc,
                    "is_roaster": u["account_type"] == "roaster",
                })
        slugs = [r["slug"] for r in rows]
        return ok({"following": following, "slugs": slugs}, resource="follows")
    finally:
        db.close()


# ── Convenience: notification unread count + mark read ───────────────────────

@router.get("/notifications/unread-count")
def unread_count(user=Depends(get_current_user)):
    db = get_db()
    try:
        c = db.execute("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0", (user["id"],)).fetchone()["c"]
        return ok({"count": c}, resource="notifications")
    finally:
        db.close()


@router.post("/notifications/read")
def mark_all_read(user=Depends(get_current_user)):
    db = get_db()
    try:
        db.execute("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", (user["id"],))
        db.commit()
        return ok({"ok": True}, resource="notifications")
    finally:
        db.close()


@router.post("/notifications/{nid}/read")
def mark_one_read(nid: int, user=Depends(get_current_user)):
    db = get_db()
    try:
        db.execute("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", (nid, user["id"]))
        db.commit()
        return ok({"ok": True}, resource="notifications")
    finally:
        db.close()


# ── Feed: combined timeline ──────────────────────────────────────────────────

@router.get("/feed/timeline")
def feed_timeline(limit: int = 30, offset: int = 0, authorization: str = Header(None)):
    """Combined posts + tasting notes feed, sorted by date."""
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        # Use the posts resource list (includes tasting_note posts)
        items, total = list_resource(db, "posts", limit=200, offset=0, current_user_id=uid)
        # Sort by published_at desc, paginate
        items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
        paginated = items[offset: offset + limit]
        return ok(paginated, resource="posts", total=total, limit=limit, offset=offset)
    finally:
        db.close()
