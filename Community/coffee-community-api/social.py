"""
Social interactions: likes and comments on tasting notes.
"""

import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, Header
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Social"])


# ── Likes ────────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/like")
def toggle_like(note_id: int, user=Depends(get_current_user)):
    """Toggle like on a tasting note. Returns new like state."""
    db = get_db()
    try:
        # Verify note exists
        note = db.execute("SELECT id FROM tasting_notes WHERE id = ?", (note_id,)).fetchone()
        if not note:
            raise HTTPException(404, "Note not found")

        existing = db.execute(
            "SELECT id FROM note_likes WHERE user_id = ? AND note_id = ?",
            (user["id"], note_id)
        ).fetchone()

        if existing:
            db.execute("DELETE FROM note_likes WHERE id = ?", (existing["id"],))
            db.commit()
            liked = False
        else:
            now = datetime.datetime.utcnow().isoformat()
            db.execute(
                "INSERT INTO note_likes (user_id, note_id, created_at) VALUES (?, ?, ?)",
                (user["id"], note_id, now)
            )
            db.commit()
            liked = True

        count = db.execute(
            "SELECT COUNT(*) as c FROM note_likes WHERE note_id = ?", (note_id,)
        ).fetchone()["c"]

        return {"liked": liked, "like_count": count}
    finally:
        db.close()


@router.get("/notes/{note_id}/likes")
def get_likes(note_id: int, authorization: str = Header(None)):
    """Get like count and whether current user liked."""
    from auth import get_current_user as _get_user
    db = get_db()
    try:
        count = db.execute(
            "SELECT COUNT(*) as c FROM note_likes WHERE note_id = ?", (note_id,)
        ).fetchone()["c"]

        liked_by_me = False
        if authorization and authorization.startswith("Bearer "):
            try:
                user = _get_user(authorization)
                row = db.execute(
                    "SELECT id FROM note_likes WHERE user_id = ? AND note_id = ?",
                    (user["id"], note_id)
                ).fetchone()
                liked_by_me = row is not None
            except Exception:
                pass

        return {"like_count": count, "liked_by_me": liked_by_me}
    finally:
        db.close()


@router.get("/users/{username}/likes")
def get_user_likes(username: str, authorization: str = Header(None)):
    """Get all notes a user has liked, newest first."""
    db = get_db()
    try:
        target = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not target:
            raise HTTPException(404, "User not found")

        rows = db.execute("""
            SELECT nl.created_at as liked_at, tn.*, u.username, u.display_name, u.avatar_url
            FROM note_likes nl
            JOIN tasting_notes tn ON nl.note_id = tn.id
            JOIN users u ON tn.user_id = u.id
            WHERE nl.user_id = ?
            ORDER BY nl.created_at DESC
            LIMIT 50
        """, (target["id"],)).fetchall()

        likes = []
        for r in rows:
            tags = json.loads(r["flavor_tags"]) if r["flavor_tags"] else None
            likes.append({
                "liked_at": r["liked_at"],
                "note_id": r["id"],
                "product_id": r["product_id"],
                "note_author": {"username": r["username"], "display_name": r["display_name"], "avatar_url": r["avatar_url"]},
                "comment": r["comment"],
                "flavor_tags": tags,
                "created_at": r["created_at"],
            })
        return {"likes": likes}
    finally:
        db.close()


# ── Comments ─────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/comments")
def create_comment(note_id: int, body: dict, user=Depends(get_current_user)):
    """Create a comment on a tasting note."""
    comment_text = (body.get("comment") or "").strip()
    if not comment_text:
        raise HTTPException(422, "Comment text is required")

    db = get_db()
    try:
        note = db.execute("SELECT id FROM tasting_notes WHERE id = ?", (note_id,)).fetchone()
        if not note:
            raise HTTPException(404, "Note not found")

        now = datetime.datetime.utcnow().isoformat()
        cursor = db.execute(
            "INSERT INTO note_comments (user_id, note_id, comment, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], note_id, comment_text, now)
        )
        db.commit()

        return {
            "id": cursor.lastrowid,
            "user": {"username": user["username"], "display_name": user["display_name"]},
            "comment": comment_text,
            "created_at": now,
        }
    finally:
        db.close()


@router.get("/notes/{note_id}/comments")
def get_comments(note_id: int):
    """List comments for a tasting note, oldest first."""
    db = get_db()
    try:
        rows = db.execute("""
            SELECT nc.*, u.username, u.display_name, u.avatar_url
            FROM note_comments nc
            JOIN users u ON nc.user_id = u.id
            WHERE nc.note_id = ?
            ORDER BY nc.created_at ASC
        """, (note_id,)).fetchall()

        comments = [{
            "id": r["id"],
            "user": {"username": r["username"], "display_name": r["display_name"], "avatar_url": r["avatar_url"]},
            "comment": r["comment"],
            "created_at": r["created_at"],
        } for r in rows]

        return {"comments": comments}
    finally:
        db.close()


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user=Depends(get_current_user)):
    """Delete own comment."""
    db = get_db()
    try:
        row = db.execute("SELECT * FROM note_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Comment not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your comment")
        db.execute("DELETE FROM note_comments WHERE id = ?", (comment_id,))
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


@router.get("/users/{username}/comments")
def get_user_comments(username: str):
    """Get all comments by a user, newest first."""
    db = get_db()
    try:
        target = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not target:
            raise HTTPException(404, "User not found")

        rows = db.execute("""
            SELECT nc.*, tn.product_id, tn.comment as note_comment,
                   u.username as note_author_username, u.display_name as note_author_name
            FROM note_comments nc
            JOIN tasting_notes tn ON nc.note_id = tn.id
            JOIN users u ON tn.user_id = u.id
            WHERE nc.user_id = ?
            ORDER BY nc.created_at DESC
            LIMIT 50
        """, (target["id"],)).fetchall()

        comments = [{
            "id": r["id"],
            "comment": r["comment"],
            "created_at": r["created_at"],
            "note_id": r["note_id"],
            "product_id": r["product_id"],
            "note_author": {"username": r["note_author_username"], "display_name": r["note_author_name"]},
        } for r in rows]

        return {"comments": comments}
    finally:
        db.close()
