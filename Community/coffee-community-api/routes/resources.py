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
    if auth_req == "blocked":
        from fastapi import HTTPException
        raise HTTPException(403, f"{resource} cannot be listed via generic endpoint — use specific route")
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
    if res.get("auth", {}).get("read") == "blocked":
        from fastapi import HTTPException
        raise HTTPException(403, f"{resource} cannot be read via generic endpoint — use specific route")

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
    if auth_req == "blocked":
        from fastapi import HTTPException
        raise HTTPException(403, f"{resource} cannot be created via generic endpoint — use specific route")
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
        # Run on_update hooks (mirrors on_create dispatch)
        for hook in res.get("hooks", {}).get("on_update", []):
            run_hook(hook, db, resource_name=resource, item=item, current_user=user)
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
        # Capture the item BEFORE deleting so on_delete hooks have context
        # (drink name, slug, etc.). This mirrors the pattern used by the
        # roaster product delete endpoint in routes/specific.py.
        pre_item = None
        if res.get("hooks", {}).get("on_delete"):
            from resources.crud import get_resource_by_id
            try:
                pre_item = get_resource_by_id(
                    db, resource, id_val,
                    current_user_id=user["id"] if user else None,
                )
            except Exception:
                pre_item = None
        result = delete_resource(db, resource, id_val, current_user=user)
        for hook in res.get("hooks", {}).get("on_delete", []):
            run_hook(hook, db, resource_name=resource, item=pre_item, current_user=user)
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


# Convenience routes moved to routes/specific.py (registered before catch-all)
