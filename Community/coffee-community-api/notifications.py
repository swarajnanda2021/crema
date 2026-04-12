"""
Notifications API.

Endpoints:
  GET    /api/notifications              — list notifications for current user
  GET    /api/notifications/unread-count  — unread badge count
  POST   /api/notifications/read          — mark all as read
  POST   /api/notifications/{id}/read     — mark single as read
"""

import datetime
from fastapi import APIRouter, Depends
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def create_notification(db, user_id: int, notif_type: str, actor_id: int,
                        post_id: int = None, comment_id: int = None):
    """Insert a notification. Skips if actor == recipient (don't notify yourself)."""
    if actor_id == user_id:
        return
    db.execute(
        """INSERT INTO notifications (user_id, type, actor_id, post_id, comment_id, read, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)""",
        (user_id, notif_type, actor_id, post_id, comment_id, _now()),
    )


@router.get("")
def list_notifications(limit: int = 50, user=Depends(get_current_user)):
    """Get notifications for current user, newest first."""
    db = get_db()
    try:
        rows = db.execute(
            """SELECT n.*, u.username as actor_username, u.display_name as actor_display_name,
                      u.avatar_url as actor_avatar_url, u.avatar_crop_x as actor_crop_x,
                      u.avatar_crop_y as actor_crop_y, u.avatar_zoom as actor_zoom
               FROM notifications n
               JOIN users u ON n.actor_id = u.id
               WHERE n.user_id = ?
               ORDER BY n.created_at DESC
               LIMIT ?""",
            (user["id"], limit),
        ).fetchall()
        return {
            "notifications": [
                {
                    "id": r["id"],
                    "type": r["type"],
                    "actor_id": r["actor_id"],
                    "actor_username": r["actor_username"],
                    "actor_display_name": r["actor_display_name"],
                    "actor_avatar_url": r["actor_avatar_url"],
                    "actor_crop_x": r["actor_crop_x"],
                    "actor_crop_y": r["actor_crop_y"],
                    "actor_zoom": r["actor_zoom"],
                    "post_id": r["post_id"],
                    "comment_id": r["comment_id"],
                    "read": bool(r["read"]),
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        }
    finally:
        db.close()


@router.get("/unread-count")
def unread_count(user=Depends(get_current_user)):
    """Return number of unread notifications."""
    db = get_db()
    try:
        row = db.execute(
            "SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0",
            (user["id"],),
        ).fetchone()
        return {"count": row["c"]}
    finally:
        db.close()


@router.post("/read")
def mark_all_read(user=Depends(get_current_user)):
    """Mark all notifications as read for current user."""
    db = get_db()
    try:
        db.execute(
            "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0",
            (user["id"],),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/{notification_id}/read")
def mark_one_read(notification_id: int, user=Depends(get_current_user)):
    """Mark a single notification as read."""
    db = get_db()
    try:
        db.execute(
            "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
            (notification_id, user["id"]),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()
