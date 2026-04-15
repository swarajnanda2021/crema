"""
CRUD Utopia — composite action, not a CRUD resource. Lives here because
it can't be declared: short-TTL identity tokens are a side channel used by
the scan endpoint (see routes/specific.py). See CRUD_UTOPIA.md at repo root.

QR identity tokens — short-lived UUIDs a user's app displays as a QR code
so café baristas (or any seller) can scan to verify identity. Same storage
pattern as sessions: UUID in a DB table with an expires_at timestamp.

Tokens are idempotent within the TTL: the DB row lives for 5 minutes, any
number of verifications within that window succeed. The client re-fetches
when nearing expiry (handled in the frontend hook).
"""

import datetime
import uuid

QR_TOKEN_TTL_SECONDS = 300  # 5 minutes


def issue_qr_token(db, user_id: int) -> dict:
    """Create a new QR token row for a user. Returns { token, expires_at }."""
    token = uuid.uuid4().hex
    now = datetime.datetime.utcnow()
    expires = now + datetime.timedelta(seconds=QR_TOKEN_TTL_SECONDS)
    now_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    exp_str = expires.strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute(
        "INSERT INTO qr_tokens (token, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now_str, exp_str),
    )
    db.commit()
    # Opportunistic cleanup of expired tokens to keep the table lean
    db.execute("DELETE FROM qr_tokens WHERE expires_at < ?", (now_str,))
    db.commit()
    return {"token": token, "expires_at": exp_str}


def verify_qr_token(db, token: str):
    """Resolve a QR token to a user row. Returns the user dict or None if
    invalid/expired. Does NOT create a stamp — callers decide whether to
    just preview the user or actually commit a stamp."""
    now_str = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    row = db.execute(
        "SELECT user_id FROM qr_tokens WHERE token = ? AND expires_at > ?",
        (token, now_str),
    ).fetchone()
    if not row:
        return None
    user_row = db.execute(
        "SELECT * FROM users WHERE id = ?", (row["user_id"],)
    ).fetchone()
    if not user_row:
        return None
    return dict(user_row)
