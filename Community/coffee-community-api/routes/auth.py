"""
Auth routes — login, register, me, profile update, public user lookup.
"""

from fastapi import APIRouter, Depends
from services.auth import (
    register, login, get_current_user, get_me, update_profile, get_user_public,
)
from resources.envelope import ok

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register", status_code=201)
def route_register(body: dict):
    username = (body.get("username") or "").strip()
    display_name = (body.get("display_name") or "").strip()
    password = body.get("password") or ""
    if not username or not display_name or len(password) < 6:
        from fastapi import HTTPException
        raise HTTPException(422, "username, display_name required; password min 6 chars")
    result = register(username, display_name, password)
    return ok(result, resource="auth")


@router.post("/login")
def route_login(body: dict):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    result = login(username, password)
    return ok(result, resource="auth")


@router.get("/me")
def route_me(user=Depends(get_current_user)):
    return ok(get_me(user), resource="users")


@router.put("/profile")
def route_update_profile(body: dict, user=Depends(get_current_user)):
    updated = update_profile(user, body)
    return ok(updated, resource="users")


@router.get("/users/{username}")
def route_user_public(username: str):
    user_data = get_user_public(username)
    return ok(user_data, resource="users")
