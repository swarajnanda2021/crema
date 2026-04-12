"""
Authentication: register, login, session tokens.
"""

import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, Header
import bcrypt as _bcrypt
from models import ProfileUpdateRequest


class _BcryptCompat:
    """Thin wrapper around the bcrypt library, replacing passlib."""
    @staticmethod
    def hash(password: str) -> str:
        return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()

    @staticmethod
    def verify(password: str, hashed: str) -> bool:
        return _bcrypt.checkpw(password.encode(), hashed.encode())


bcrypt = _BcryptCompat()
from database import get_db
from models import RegisterRequest, LoginRequest, AuthResponse, UserResponse

router = APIRouter(prefix="/api/auth", tags=["Auth"])

SESSION_DURATION_DAYS = 30


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


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
        "created_at": row["created_at"],
    }


# ── Dependency: get current user from Authorization header ────────────────────

def get_current_user(authorization: str = Header(None)):
    """
    FastAPI dependency. Extracts and validates the Bearer token.
    Returns user dict or raises 401.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid authorization header")

    token = authorization.split(" ", 1)[1]
    db = get_db()
    try:
        row = db.execute(
            """
            SELECT u.*, s.expires_at
            FROM sessions s JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()

        if not row:
            raise HTTPException(401, "Invalid session token")

        # Check expiry
        expires = datetime.datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        if datetime.datetime.now(datetime.timezone.utc) > expires:
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            db.commit()
            raise HTTPException(401, "Session expired")

        return _user_to_dict(row)
    finally:
        db.close()


def get_optional_user(authorization: str = Header(None)):
    """Same as get_current_user but returns None instead of raising 401."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", status_code=201)
def register(req: RegisterRequest):
    db = get_db()
    try:
        # Check uniqueness
        existing = db.execute(
            "SELECT id FROM users WHERE username = ?", (req.username,)
        ).fetchone()
        if existing:
            raise HTTPException(409, "Username already taken")

        now = _now()
        password_hash = bcrypt.hash(req.password)
        cursor = db.execute(
            "INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (req.username, req.display_name, password_hash, now),
        )
        db.commit()
        user_id = cursor.lastrowid

        token = _create_session(db, user_id)

        user = {
            "id": user_id,
            "username": req.username,
            "display_name": req.display_name,
            "created_at": now,
        }
        return {"user": user, "token": token}
    finally:
        db.close()


@router.post("/login")
def login(req: LoginRequest):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM users WHERE username = ?", (req.username,)
        ).fetchone()
        if not row or not bcrypt.verify(req.password, row["password_hash"]):
            raise HTTPException(401, "Invalid username or password")

        token = _create_session(db, row["id"])
        return {"user": _user_to_dict(row), "token": token}
    finally:
        db.close()


@router.get("/me")
def me(user=Depends(get_current_user)):
    return user


@router.put("/profile")
def update_profile(req: ProfileUpdateRequest, user=Depends(get_current_user)):
    db = get_db()
    try:
        updates = {}
        if req.display_name is not None:
            updates["display_name"] = req.display_name
        if req.bio is not None:
            updates["bio"] = req.bio
        if req.avatar_url is not None:
            updates["avatar_url"] = req.avatar_url
        if req.location is not None:
            updates["location"] = req.location
        if req.coffee_preference is not None:
            updates["coffee_preference"] = req.coffee_preference
        if req.brewing_style is not None:
            updates["brewing_style"] = req.brewing_style
        if req.favorite_drink is not None:
            updates["favorite_drink"] = req.favorite_drink
        if req.favorite_cafe is not None:
            updates["favorite_cafe"] = req.favorite_cafe

        if not updates:
            raise HTTPException(422, "No fields to update")

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [user["id"]]
        db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
        db.commit()

        row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return _user_to_dict(row)
    finally:
        db.close()
