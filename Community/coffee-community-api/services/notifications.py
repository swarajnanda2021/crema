"""
Notification service — creates notifications as side-effects of CRUD operations.

Called by the CRUD engine hooks system.
"""

from __future__ import annotations

import datetime


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def create_notification(
    db,
    user_id,
    notif_type,
    actor_id,
    *,
    post_id=None,
    comment_id=None,
    direct_thread_id=None,
    target_slug=None,
    subject=None,
):
    """Create a notification. Skips if actor == recipient."""
    if actor_id == user_id:
        return
    db.execute(
        "INSERT INTO notifications (user_id, type, actor_id, post_id, comment_id, "
        "direct_thread_id, target_slug, subject, read, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
        (user_id, notif_type, actor_id, post_id, comment_id,
         direct_thread_id, target_slug, subject, _now()),
    )


def run_hook(hook_name, db, *, resource_name=None, item=None, current_user=None, target_id=None, extra=None):
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
    elif hook_name == "notify_followers_catalog":
        # extra: { "slug": str, "kind": "roaster", "change": "product_added"|"product_removed", "subject": str }
        _handle_notify_followers_catalog(db, current_user, extra or {})
    elif hook_name == "sync_roaster_logo_to_user":
        _handle_sync_roaster_logo(db, item, current_user)
    elif hook_name == "sync_roaster_name_to_user":
        _handle_sync_roaster_name_to_user(db, item, current_user)
    elif hook_name == "notify_sourcing_story":
        _handle_notify_sourcing_story(db, item, current_user)
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
    """Comment notification — handles both top-level comments and replies.
    A reply (parent_id is set) notifies the parent comment's author with type='reply';
    a top-level comment notifies the post author with type='comment'."""
    if not item:
        return
    parent_id = item.get("parent_id")
    if parent_id:
        parent = db.execute(
            "SELECT user_id FROM post_comments WHERE id = ?", (parent_id,)
        ).fetchone()
        if parent and parent["user_id"] != user["id"]:
            create_notification(
                db, parent["user_id"], "reply", user["id"],
                post_id=item.get("post_id"), comment_id=item.get("id"),
            )
            db.commit()
        return
    row = db.execute("SELECT user_id FROM roaster_posts WHERE id = ?", (item["post_id"],)).fetchone()
    if row:
        create_notification(
            db, row["user_id"], "comment", user["id"],
            post_id=item["post_id"], comment_id=item.get("id"),
        )
        db.commit()


def _handle_notify_comment_like(db, comment_id, user):
    row = db.execute(
        "SELECT user_id, post_id FROM post_comments WHERE id = ?", (comment_id,)
    ).fetchone()
    if row:
        create_notification(
            db, row["user_id"], "comment_like", user["id"],
            post_id=row["post_id"], comment_id=comment_id,
        )
        db.commit()


def _handle_notify_follow(db, slug, user):
    """Follow notification — always notifies the followed user via target_slug.
    Roaster slugs and user_<id> slugs alike."""
    row = db.execute(
        "SELECT id FROM users WHERE roaster_slug = ?", (slug,)
    ).fetchone()
    if not row and slug.startswith("user_"):
        try:
            row = db.execute(
                "SELECT id FROM users WHERE id = ?", (int(slug[5:]),)
            ).fetchone()
        except (ValueError, TypeError):
            row = None
    if row:
        create_notification(db, row["id"], "follow", user["id"], target_slug=slug)
        db.commit()


def _handle_shelf_upsert(db, item, user):
    """When a shelf entry lands, fire `product_added` notifications to
    followers of the bean's roaster — Phase 1 §2.4-style fanout."""
    if not item:
        return
    product_id = item.get("product_id")
    if not product_id:
        return
    prow = db.execute(
        "SELECT roaster_slug, coffee_name FROM products WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    if not prow:
        return
    # Skip — shelf upsert isn't a public catalog event yet. Reserved for
    # future "your friends are drinking …" surfaces.


def _handle_sync_roaster_name_to_user(db, item, actor):
    """When a roaster_profile name changes, mirror it onto the owner's
    user.display_name so the navbar greeting stays accurate."""
    if not item:
        return
    name = item.get("name")
    slug = item.get("roaster_slug")
    if not name or not slug:
        return
    db.execute(
        "UPDATE users SET display_name = ? WHERE account_type = 'roaster' AND roaster_slug = ?",
        (name, slug),
    )
    db.commit()


def _handle_sync_roaster_logo(db, item, actor):
    """When a roaster_profile logo_url changes, mirror it onto the owner's
    user.avatar_url so the navbar avatar updates automatically."""
    if not item:
        return
    logo = item.get("logo_url")
    slug = item.get("roaster_slug")
    if not slug:
        return
    db.execute(
        "UPDATE users SET avatar_url = ? WHERE account_type = 'roaster' AND roaster_slug = ?",
        (logo, slug),
    )
    db.commit()


def _handle_notify_followers_catalog(db, actor, extra):
    """Fan out catalog-change notifications to every follower of the given
    roaster. `extra` shape:
       { "slug": "blue-tokai-coffee-roasters",
         "kind": "roaster",
         "change": "product_added"|"product_removed",
         "subject": "Gangecool Estate — Washed" }
    """
    slug = extra.get("slug")
    kind = extra.get("kind") or "roaster"
    change = extra.get("change")
    subject = extra.get("subject")
    if not slug:
        return

    rows = db.execute(
        "SELECT follower_user_id FROM follows WHERE roaster_slug = ?", (slug,)
    ).fetchall()
    actor_id = actor["id"] if actor else None
    target_slug = f"{kind}:{slug}"
    for r in rows:
        if actor_id and r["follower_user_id"] == actor_id:
            continue
        create_notification(
            db,
            r["follower_user_id"],
            change,
            actor_id or 0,
            target_slug=target_slug,
            subject=subject,
        )
    db.commit()


# ── Roaster-follower fanout for sourcing stories ────────────────────────────

def _roaster_follower_user_ids(db, slug):
    rows = db.execute(
        "SELECT follower_user_id FROM follows WHERE roaster_slug = ?",
        (slug,),
    ).fetchall()
    return [r["follower_user_id"] for r in rows]


def _handle_notify_sourcing_story(db, item, actor):
    """Fired from `roaster_posts` on_create. Only fans out for
    post_type='sourcing_story' — every other post_type is no-op so the
    hook can sit alongside notify_repost without an extra registry
    branch."""
    if not item:
        return
    if (item.get("post_type") or "") != "sourcing_story":
        return
    slug = item.get("roaster_slug")
    if not slug:
        return
    subject = (item.get("title") or item.get("teaser") or "a sourcing story").strip()
    if len(subject) > 80:
        subject = subject[:77] + "..."
    user_ids = _roaster_follower_user_ids(db, slug)
    actor_id = actor["id"] if actor else 0
    target_slug = f"roaster:{slug}"
    post_id = item.get("id")
    for uid in user_ids:
        if actor_id and uid == actor_id:
            continue
        create_notification(
            db, uid, "sourcing_story", actor_id,
            target_slug=target_slug, subject=subject, post_id=post_id,
        )
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
