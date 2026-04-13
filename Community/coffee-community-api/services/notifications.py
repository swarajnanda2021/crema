"""
Notification service — creates notifications as side-effects of CRUD operations.

Called by the CRUD engine hooks system.
"""

import datetime


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def create_notification(db, user_id, notif_type, actor_id, *, post_id=None, comment_id=None):
    """Create a notification. Skips if actor == recipient."""
    if actor_id == user_id:
        return
    db.execute(
        "INSERT INTO notifications (user_id, type, actor_id, post_id, comment_id, read, created_at) "
        "VALUES (?, ?, ?, ?, ?, 0, ?)",
        (user_id, notif_type, actor_id, post_id, comment_id, _now()),
    )


def run_hook(hook_name, db, *, resource_name=None, item=None, current_user=None, target_id=None):
    """Dispatch a named hook. Called by the CRUD engine after create/toggle operations."""
    if hook_name == "notify_repost":
        _handle_notify_repost(db, item, current_user)
    elif hook_name == "notify_like":
        _handle_notify_like(db, target_id, current_user)
    elif hook_name == "notify_comment":
        _handle_notify_comment(db, item, current_user)
    elif hook_name == "notify_comment_like":
        _handle_notify_comment_like(db, target_id, current_user)
    elif hook_name == "notify_follow":
        _handle_notify_follow(db, target_id, current_user)
    elif hook_name == "shelf_upsert":
        _handle_shelf_upsert(db, item, current_user)
    elif hook_name == "auto_create_post":
        _handle_auto_create_post(db, item, current_user)
    # validate_dictionary is handled inline in tasting_notes route


def _handle_notify_repost(db, item, user):
    if not item or not item.get("repost_of_id"):
        return
    orig = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (item["repost_of_id"],)).fetchone()
    if orig:
        create_notification(db, orig["user_id"], "repost", user["id"], post_id=item["repost_of_id"])
        db.commit()


def _handle_notify_like(db, post_id, user):
    row = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
    if row:
        create_notification(db, row["user_id"], "like", user["id"], post_id=post_id)
        db.commit()


def _handle_notify_comment(db, item, user):
    if not item:
        return
    parent_id = item.get("parent_id")
    post_id = item.get("post_id")
    comment_id = item.get("id")
    if parent_id:
        parent = db.execute("SELECT user_id FROM post_comments WHERE id = ?", (parent_id,)).fetchone()
        if parent:
            create_notification(db, parent["user_id"], "reply", user["id"], post_id=post_id, comment_id=comment_id)
            db.commit()
    else:
        post = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if post:
            create_notification(db, post["user_id"], "comment", user["id"], post_id=post_id, comment_id=comment_id)
            db.commit()


def _handle_notify_comment_like(db, comment_id, user):
    row = db.execute("SELECT user_id, post_id FROM post_comments WHERE id = ?", (comment_id,)).fetchone()
    if row:
        create_notification(db, row["user_id"], "comment_like", user["id"],
                           post_id=row["post_id"], comment_id=comment_id)
        db.commit()


def _handle_notify_follow(db, slug, user):
    if isinstance(slug, str) and slug.startswith("user_"):
        try:
            target_uid = int(slug.replace("user_", ""))
            create_notification(db, target_uid, "follow", user["id"])
        except ValueError:
            pass
    else:
        target = db.execute("SELECT id FROM users WHERE roaster_slug = ?", (slug,)).fetchone()
        if target:
            create_notification(db, target["id"], "follow", user["id"])
    db.commit()


def _handle_shelf_upsert(db, item, user):
    """If product already on a different shelf, move it instead of creating duplicate."""
    if not item:
        return
    existing = db.execute(
        "SELECT id, shelf FROM shelf_entries WHERE user_id = ? AND product_id = ? AND id != ?",
        (user["id"], item["product_id"], item["id"]),
    ).fetchone()
    if existing:
        db.execute("DELETE FROM shelf_entries WHERE id = ?", (existing["id"],))
        db.commit()


def _handle_auto_create_post(db, item, user):
    """When a tasting note is created, auto-create a post of type tasting_note."""
    if not item:
        return
    import json
    now = _now()
    slug = user.get("roaster_slug") or f"user_{user['id']}"
    title = f"Tasting Note"
    teaser = item.get("comment") or "Shared a tasting note"
    if len(teaser) > 300:
        teaser = teaser[:297] + "..."

    # Build a tasting note card as images_json
    card_data = {
        "type": "tasting_note",
        "product_id": item.get("product_id"),
        "acidity": item.get("acidity"),
        "body": item.get("body"),
        "sweetness": item.get("sweetness"),
        "aftertaste": item.get("aftertaste"),
    }

    db.execute(
        """INSERT INTO roaster_posts
           (roaster_slug, user_id, title, teaser, published_at, created_at,
            is_featured, post_type, images_json, tasting_note_id)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'tasting_note', ?, ?)""",
        (slug, user["id"], title, teaser, now, now, json.dumps([json.dumps(card_data)]), item["id"]),
    )
    db.commit()
