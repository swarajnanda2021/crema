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
    inquiry_id=None,
    direct_thread_id=None,
    target_slug=None,
    subject=None,
):
    """Create a notification. Skips if actor == recipient."""
    if actor_id == user_id:
        return
    db.execute(
        "INSERT INTO notifications (user_id, type, actor_id, post_id, comment_id, "
        "inquiry_id, direct_thread_id, target_slug, subject, read, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
        (user_id, notif_type, actor_id, post_id, comment_id, inquiry_id,
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
        # extra: { "slug": str, "kind": "roaster"|"cafe", "change": "product_added"|"product_removed"|"menu_added"|"menu_removed"|"menu_updated", "subject": str }
        _handle_notify_followers_catalog(db, current_user, extra or {})
    elif hook_name == "notify_menu_added":
        _handle_notify_menu_change(db, item, current_user, "menu_added")
    elif hook_name == "notify_menu_removed":
        _handle_notify_menu_change(db, item, current_user, "menu_removed")
    elif hook_name == "notify_menu_updated":
        _handle_notify_menu_change(db, item, current_user, "menu_updated")
    elif hook_name == "sync_cafe_logo_to_user":
        _handle_sync_entity_logo(db, item, current_user, "cafe")
    elif hook_name == "sync_roaster_logo_to_user":
        _handle_sync_entity_logo(db, item, current_user, "roaster")
    elif hook_name == "sync_roaster_name_to_user":
        _handle_sync_roaster_name_to_user(db, item, current_user)
    elif hook_name == "notify_wholesale_inquiry":
        _handle_notify_wholesale_inquiry(db, item, current_user)
    elif hook_name == "notify_wholesale_available":
        _handle_notify_wholesale_available(db, item, current_user)
    elif hook_name == "notify_sourcing_story":
        _handle_notify_sourcing_story(db, item, current_user)
    elif hook_name == "notify_menu_updated_business":
        _handle_notify_menu_updated_business(db, item, current_user)
    elif hook_name == "notify_loyalty_changed":
        _handle_notify_loyalty_changed(db, item, current_user)
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


def sync_roaster_name_to_user(db, slug: str, name: str | None) -> int:
    """Public helper for the bio enrich + re-enrich routes (which write
    SQL directly and bypass the registry hook dispatcher). Mirrors a
    `roaster_profiles.name` change onto every `users.display_name`
    where account_type='roaster' AND roaster_slug=slug.

    Returns the number of user rows touched (0 when no roaster account
    has claimed this slug yet — common for newly-enriched profiles
    with no signed-up owner). Caller commits.
    """
    if not slug or not name:
        return 0
    cur = db.execute(
        "UPDATE users SET display_name = ? "
        "WHERE account_type = 'roaster' AND roaster_slug = ?",
        (name, slug),
    )
    return cur.rowcount


def _handle_sync_roaster_name_to_user(db, item, actor):
    """Registry-hook entry point. Fires from `roaster_profiles.on_update`
    so admin edits via the page-level PUT (e.g. inline Name field on
    the roaster admin page) flow into the linked user row's
    display_name automatically. The bio enrich + re-enrich endpoints
    bypass the registry CRUD, so they call `sync_roaster_name_to_user`
    explicitly — both paths share the same SQL."""
    if not item:
        return
    slug = item.get("roaster_slug")
    name = item.get("name")
    sync_roaster_name_to_user(db, slug, name)
    db.commit()


def _handle_sync_entity_logo(db, item, actor, kind):
    """When a cafe_profile or roaster_profile logo_url changes, mirror it
    (and its crop/zoom parameters) onto the owner's user.avatar_* fields
    so the navbar avatar updates automatically. `kind` is 'cafe' or
    'roaster'."""
    if not item:
        return
    logo = item.get("logo_url")
    # Cafés have logo_crop_* (new); roasters currently reuse hero_crop_*
    # for their logo positioning since they don't have a separate logo crop.
    # Users with no matching owner account are silently skipped.
    if kind == "cafe":
        slug = item.get("cafe_slug")
        if not slug:
            return
        crop_x = item.get("logo_crop_x")
        crop_y = item.get("logo_crop_y")
        zoom = item.get("logo_zoom")
        db.execute(
            "UPDATE users SET avatar_url = ?, "
            "avatar_crop_x = COALESCE(?, avatar_crop_x), "
            "avatar_crop_y = COALESCE(?, avatar_crop_y), "
            "avatar_zoom = COALESCE(?, avatar_zoom) "
            "WHERE account_type = 'cafe' AND cafe_slug = ?",
            (logo, crop_x, crop_y, zoom, slug),
        )
    else:
        slug = item.get("roaster_slug")
        if not slug:
            return
        db.execute(
            "UPDATE users SET avatar_url = ? WHERE account_type = 'roaster' AND roaster_slug = ?",
            (logo, slug),
        )
    db.commit()


def _handle_notify_menu_change(db, item, actor, change):
    """Café menu_items CRUD hooks land here. Extracts cafe_slug + drink_name
    from the item and delegates to the generic follower fanout."""
    if not item:
        return
    slug = item.get("cafe_slug")
    subject = item.get("drink_name") or "a menu item"
    if not slug:
        return
    _handle_notify_followers_catalog(
        db, actor, {"slug": slug, "kind": "cafe", "change": change, "subject": subject}
    )


def _handle_notify_followers_catalog(db, actor, extra):
    """Fan out catalog-change notifications to every follower of the given
    roaster or café. `extra` shape:
       { "slug": "blue-tokai-coffee-roasters",
         "kind": "roaster"|"cafe",
         "change": "product_added"|"product_removed"|"menu_added"|"menu_removed"|"menu_updated",
         "subject": "Gangecool Estate — Washed" }
    """
    slug = extra.get("slug")
    kind = extra.get("kind")
    change = extra.get("change")
    subject = extra.get("subject")
    if not slug or not kind:
        return

    # follows.roaster_slug holds the target slug regardless of type
    # (target_type discriminates roaster vs cafe — old rows are implicitly
    # 'roaster' via the DEFAULT 'roaster').
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


def _handle_notify_wholesale_inquiry(db, item, actor):
    """Phase 1 §2.1 — notify every roaster-account user belonging to the
    target roaster_slug that a café has opened an inquiry. Subject carries
    the café name + (optionally) the product name so the Business-tab
    item reads meaningfully without opening the dropdown.

    target_slug uses the same 'cafe:<slug>' convention as catalog-change
    notifications (§2.4) so the existing deep-link path sends the
    roaster to the café profile, where §2.6 procurement fields render.
    """
    if not item:
        return
    cafe_slug = item.get("cafe_slug")
    roaster_slug = item.get("roaster_slug")
    if not cafe_slug or not roaster_slug:
        return

    cafe_row = db.execute(
        "SELECT name FROM cafe_profiles WHERE cafe_slug = ?", (cafe_slug,)
    ).fetchone()
    cafe_name = (cafe_row["name"] if cafe_row else None) or cafe_slug

    product_id = item.get("product_id")
    product_name = None
    if product_id:
        prod_row = db.execute(
            "SELECT coffee_name FROM products WHERE product_id = ?", (product_id,)
        ).fetchone()
        product_name = prod_row["coffee_name"] if prod_row else None

    subject = f"{cafe_name} · {product_name}" if product_name else cafe_name

    recipients = db.execute(
        "SELECT id FROM users WHERE account_type = 'roaster' AND roaster_slug = ?",
        (roaster_slug,),
    ).fetchall()
    actor_id = actor["id"] if actor else 0
    inquiry_id = item.get("id")
    for r in recipients:
        create_notification(
            db,
            r["id"],
            "wholesale_inquiry",
            actor_id,
            inquiry_id=inquiry_id,
            target_slug=f"cafe:{cafe_slug}",
            subject=subject,
        )
    db.commit()


# ── §2.20 cross-business follower fanout ────────────────────────────────────
# Catalog notifications today (`notify_followers_catalog`) hit every follower
# of a roaster/café regardless of the follower's account_type. §2.20 adds a
# narrower fanout for events that are only meaningful to *business* followers
# (cafés discovering a new wholesale supplier, roasters tracking another
# café's menu activity, etc.). Everything below filters the follow edges
# by `users.account_type IN ('roaster','cafe')` and lands in the recipient's
# Business tab via the BUSINESS_TYPES set on the frontend.

def _business_follower_user_ids(db, slug):
    rows = db.execute(
        "SELECT f.follower_user_id FROM follows f "
        "JOIN users u ON f.follower_user_id = u.id "
        "WHERE f.roaster_slug = ? AND u.account_type IN ('roaster','cafe')",
        (slug,),
    ).fetchall()
    return [r["follower_user_id"] for r in rows]


def _fanout_to_business_followers(db, slug, kind, change, subject, actor, *, post_id=None):
    """Generic fanout helper used by every §2.20 hook. `kind` discriminates
    the deep-link target (`roaster:<slug>` vs `cafe:<slug>`); `change` is
    the notification type string."""
    if not slug:
        return
    user_ids = _business_follower_user_ids(db, slug)
    actor_id = actor["id"] if actor else 0
    target_slug = f"{kind}:{slug}"
    for uid in user_ids:
        if actor_id and uid == actor_id:
            continue
        create_notification(
            db, uid, change, actor_id,
            target_slug=target_slug, subject=subject, post_id=post_id,
        )
    db.commit()


def _handle_notify_wholesale_available(db, item, actor):
    """Fired from `products` create/update and from the hand-rolled
    roaster_products POST/PUT in routes/specific.py. Notifies business
    followers when a bean is currently flagged wholesale-available.
    Over-fires on every save where the flag is on; the §2.20 spec
    accepts that — diff tracking would be required to fire only on the
    0→1 transition."""
    if not item:
        return
    if int(item.get("wholesale_available") or 0) != 1:
        return
    slug = item.get("roaster_slug")
    if not slug:
        return
    subject = item.get("coffee_name") or "a wholesale-available coffee"
    _fanout_to_business_followers(
        db, slug, "roaster", "wholesale_available", subject, actor,
    )


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
    _fanout_to_business_followers(
        db, slug, "roaster", "sourcing_story", subject, actor,
        post_id=item.get("id"),
    )


def _handle_notify_menu_updated_business(db, item, actor):
    """Fired alongside the existing `notify_menu_updated` hook on
    cafe_menu_items.on_update. The existing hook fans `menu_updated`
    to all followers (lands in Activity for consumers, Business for
    business followers via BUSINESS_TYPES). This hook adds a
    business-only `menu_updated_business` so the wording in the
    Business tab can speak to a B2B audience without polluting
    consumers' Activity feed."""
    if not item:
        return
    slug = item.get("cafe_slug")
    if not slug:
        return
    subject = item.get("drink_name") or "a menu item"
    _fanout_to_business_followers(
        db, slug, "cafe", "menu_updated_business", subject, actor,
    )


def _handle_notify_loyalty_changed(db, item, actor):
    """Fired from cafe_profiles on_update. Only fanned out when the
    café currently has loyalty enabled — silences disable events. Like
    wholesale_available, this over-fires on profile saves that don't
    touch the loyalty fields; diff tracking is the proper fix."""
    if not item:
        return
    if int(item.get("stamps_enabled") or 0) != 1:
        return
    slug = item.get("cafe_slug")
    if not slug:
        return
    subject = item.get("name") or slug
    _fanout_to_business_followers(
        db, slug, "cafe", "loyalty_changed", subject, actor,
    )


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
