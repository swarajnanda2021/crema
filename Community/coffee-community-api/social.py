"""
Social interactions: likes and comments on tasting notes.
"""

import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, Header
from database import get_db
from auth import get_current_user
from notifications import create_notification

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


# ══════════════════════════════════════════════════════════════════════════════
# Post-level social interactions (likes + comments on roaster_posts)
# ══════════════════════════════════════════════════════════════════════════════

def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


@router.post("/posts/{post_id}/like")
def toggle_post_like(post_id: int, user=Depends(get_current_user)):
    """Toggle like on a post."""
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM post_likes WHERE user_id = ? AND post_id = ?",
            (user["id"], post_id),
        ).fetchone()
        if existing:
            db.execute("DELETE FROM post_likes WHERE id = ?", (existing["id"],))
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?", (post_id,)).fetchone()["c"]
            return {"liked": False, "like_count": count}
        else:
            db.execute(
                "INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?, ?, ?)",
                (user["id"], post_id, _now()),
            )
            # Notify post author
            post_row = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
            if post_row:
                create_notification(db, post_row["user_id"], "like", user["id"], post_id=post_id)
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?", (post_id,)).fetchone()["c"]
            return {"liked": True, "like_count": count}
    finally:
        db.close()


@router.get("/posts/{post_id}/comments")
def get_post_comments(post_id: int, authorization: str = Header(None)):
    """Get comments on a post with like counts."""
    current_user = None
    if authorization:
        try:
            current_user = get_current_user(authorization)
        except Exception:
            pass

    db = get_db()
    try:
        rows = db.execute("""
            SELECT pc.id, pc.comment, pc.created_at, pc.updated_at,
                   pc.user_id, pc.parent_id,
                   u.username, u.display_name, u.avatar_url
            FROM post_comments pc
            JOIN users u ON pc.user_id = u.id
            WHERE pc.post_id = ?
            ORDER BY pc.created_at ASC
        """, (post_id,)).fetchall()

        comments = []
        for r in rows:
            keys = r.keys() if hasattr(r, "keys") else []
            like_count = db.execute(
                "SELECT COUNT(*) as c FROM comment_likes WHERE comment_id = ?", (r["id"],)
            ).fetchone()["c"]
            liked_by_me = False
            if current_user:
                liked_by_me = bool(db.execute(
                    "SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?",
                    (current_user["id"], r["id"]),
                ).fetchone())
            comments.append({
                "id": r["id"],
                "comment": r["comment"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"] if "updated_at" in keys else None,
                "parent_id": r["parent_id"] if "parent_id" in keys else None,
                "user": {
                    "id": r["user_id"],
                    "username": r["username"],
                    "display_name": r["display_name"],
                    "avatar_url": r["avatar_url"],
                },
                "like_count": like_count,
                "liked_by_me": liked_by_me,
            })

        return {"comments": comments}
    finally:
        db.close()


@router.post("/posts/{post_id}/comments")
def create_post_comment(post_id: int, body: dict, user=Depends(get_current_user)):
    """Create a comment on a post."""
    comment = (body.get("comment") or "").strip()
    if not comment:
        raise HTTPException(422, "comment is required")

    parent_id = body.get("parent_id")

    db = get_db()
    try:
        now = _now()
        cursor = db.execute(
            "INSERT INTO post_comments (user_id, post_id, comment, created_at, parent_id) VALUES (?, ?, ?, ?, ?)",
            (user["id"], post_id, comment, now, parent_id),
        )
        new_id = cursor.lastrowid
        # Notify post author (for top-level comments)
        if not parent_id:
            post_row = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
            if post_row:
                create_notification(db, post_row["user_id"], "comment", user["id"], post_id=post_id, comment_id=new_id)
        else:
            # Notify parent comment author (for replies)
            parent_row = db.execute("SELECT user_id FROM post_comments WHERE id = ?", (parent_id,)).fetchone()
            if parent_row and parent_row["user_id"] != user["id"]:
                create_notification(db, parent_row["user_id"], "reply", user["id"], post_id=post_id, comment_id=new_id)
        db.commit()
        return {
            "id": new_id,
            "comment": comment,
            "created_at": now,
            "parent_id": parent_id,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user.get("display_name"),
                "avatar_url": user.get("avatar_url"),
            },
            "like_count": 0,
            "liked_by_me": False,
        }
    finally:
        db.close()


@router.put("/post-comments/{comment_id}")
def edit_post_comment(comment_id: int, body: dict, user=Depends(get_current_user)):
    """Edit own comment."""
    comment = (body.get("comment") or "").strip()
    if not comment:
        raise HTTPException(422, "comment is required")

    db = get_db()
    try:
        row = db.execute("SELECT * FROM post_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Comment not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your comment")

        db.execute(
            "UPDATE post_comments SET comment = ?, updated_at = ? WHERE id = ?",
            (comment, _now(), comment_id),
        )
        db.commit()
        return {"id": comment_id, "comment": comment, "updated_at": _now()}
    finally:
        db.close()


@router.delete("/post-comments/{comment_id}")
def delete_post_comment(comment_id: int, user=Depends(get_current_user)):
    """Delete own comment."""
    db = get_db()
    try:
        row = db.execute("SELECT * FROM post_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Comment not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your comment")
        db.execute("DELETE FROM post_comments WHERE id = ?", (comment_id,))
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


@router.post("/post-comments/{comment_id}/like")
def toggle_comment_like(comment_id: int, user=Depends(get_current_user)):
    """Toggle like on a comment."""
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?",
            (user["id"], comment_id),
        ).fetchone()
        if existing:
            db.execute("DELETE FROM comment_likes WHERE id = ?", (existing["id"],))
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM comment_likes WHERE comment_id = ?", (comment_id,)).fetchone()["c"]
            return {"liked": False, "like_count": count}
        else:
            db.execute(
                "INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES (?, ?, ?)",
                (user["id"], comment_id, _now()),
            )
            # Notify comment author
            comment_row = db.execute("SELECT user_id, post_id FROM post_comments WHERE id = ?", (comment_id,)).fetchone()
            if comment_row:
                create_notification(db, comment_row["user_id"], "comment_like", user["id"],
                                   post_id=comment_row["post_id"], comment_id=comment_id)
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM comment_likes WHERE comment_id = ?", (comment_id,)).fetchone()["c"]
            return {"liked": True, "like_count": count}
    finally:
        db.close()
