"""
Auth service — login, register, session management, password hashing.

Extracted from the old auth.py monolith into a clean service.
"""

import uuid
import datetime
import passlib.hash as _passlib
from fastapi import Header, HTTPException

from database import get_db


# Use bcrypt via passlib
bcrypt = _passlib.bcrypt

SESSION_DURATION_DAYS = 30


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _user_to_dict(row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "bio": row["bio"] if "bio" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "location": row["location"] if "location" in keys else None,
        "coffee_preference": row["coffee_preference"] if "coffee_preference" in keys else None,
        "brewing_style": row["brewing_style"] if "brewing_style" in keys else None,
        "account_type": row["account_type"] if "account_type" in keys else "user",
        "roaster_slug": row["roaster_slug"] if "roaster_slug" in keys else None,
        "favorite_drink": row["favorite_drink"] if "favorite_drink" in keys else None,
        "favorite_cafe": row["favorite_cafe"] if "favorite_cafe" in keys else None,
        "avatar_crop_x": row["avatar_crop_x"] if "avatar_crop_x" in keys else 50,
        "avatar_crop_y": row["avatar_crop_y"] if "avatar_crop_y" in keys else 50,
        "avatar_zoom": row["avatar_zoom"] if "avatar_zoom" in keys else 1,
        "created_at": row["created_at"],
    }


def _create_session(db, user_id: int) -> str:
    token = str(uuid.uuid4())
    now = _now()
    expires = (
        datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_DURATION_DAYS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now, expires),
    )
    db.commit()
    return token


def register(username: str, display_name: str, password: str):
    db = get_db()
    try:
        existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(409, "Username already taken")
        hashed = bcrypt.hash(password)
        now = _now()
        cursor = db.execute(
            "INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (username, display_name, hashed, now),
        )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        token = _create_session(db, row["id"])
        return {"user": _user_to_dict(row), "token": token}
    finally:
        db.close()


def login(username: str, password: str):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not row or not bcrypt.verify(password, row["password_hash"]):
            raise HTTPException(401, "Invalid username or password")
        token = _create_session(db, row["id"])
        return {"user": _user_to_dict(row), "token": token}
    finally:
        db.close()


def get_current_user(authorization: str = Header(None)):
    """FastAPI dependency: extract user from Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization.split(" ", 1)[1]
    db = get_db()
    try:
        row = db.execute(
            "SELECT u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?",
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Invalid session")
        expires = db.execute("SELECT expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
        if expires:
            exp_dt = datetime.datetime.fromisoformat(expires["expires_at"].replace("Z", "+00:00"))
            if datetime.datetime.now(datetime.timezone.utc) > exp_dt:
                db.execute("DELETE FROM sessions WHERE token = ?", (token,))
                db.commit()
                raise HTTPException(401, "Session expired")
        return _user_to_dict(row)
    finally:
        db.close()


def get_optional_user(authorization: str = Header(None)):
    """Same as get_current_user but returns None instead of 401."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


def get_me(user):
    return user


def update_profile(user, data: dict):
    db = get_db()
    try:
        sets = []
        vals = []
        allowed = ["display_name", "bio", "avatar_url", "location", "coffee_preference",
                    "brewing_style", "favorite_drink", "favorite_cafe",
                    "avatar_crop_x", "avatar_crop_y", "avatar_zoom"]
        for key in allowed:
            if key in data and data[key] is not None:
                val = data[key]
                if key in ("avatar_crop_x", "avatar_crop_y"):
                    val = max(0, min(100, float(val)))
                elif key == "avatar_zoom":
                    val = max(1, min(5, float(val)))
                sets.append(f"{key} = ?")
                vals.append(val)
        if not sets:
            return user
        vals.append(user["id"])
        db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", vals)
        db.commit()
        row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return _user_to_dict(row)
    finally:
        db.close()


def get_user_public(username: str):
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, username, display_name, bio, avatar_url, location, "
            "coffee_preference, brewing_style, favorite_drink, favorite_cafe, "
            "avatar_crop_x, avatar_crop_y, avatar_zoom, "
            "account_type, roaster_slug, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        return dict(row)
    finally:
        db.close()
