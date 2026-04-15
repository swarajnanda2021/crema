"""
Specific routes that must be registered BEFORE the catch-all resource routes.

These have fixed paths that would otherwise be shadowed by /{resource}/{id}.
"""

from fastapi import APIRouter, Depends, Header
from database import get_db
from resources.crud import list_resource, build_select, row_to_dict, resolve_embeds
from resources.registry import get_resource
from resources.envelope import ok
from services.auth import get_current_user, get_optional_user
from services.admin_stats import compute_traction
from services.qr_tokens import issue_qr_token, verify_qr_token

router = APIRouter(prefix="/api", tags=["Specific"])


# ── Admin traction dashboard (see services/admin_stats.py) ──────────────────

def _require_admin(user):
    """Gate the traction endpoint. Defense in depth — check the flag AND the
    canonical admin username. Only one row (the seeded "crema" account) should
    satisfy both; a compromised flag on another account still fails the slug
    match."""
    from fastapi import HTTPException
    if not user or user.get("is_admin") != 1 or user.get("username") != "crema":
        raise HTTPException(403, "Admin only")


@router.get("/stats/traction")
def stats_traction(user=Depends(get_current_user)):
    _require_admin(user)
    db = get_db()
    try:
        return ok(compute_traction(db), resource="traction")
    finally:
        db.close()


# ── Follow convenience ───────────────────────────────────────────────────────

@router.get("/follow-status/{slug}")
def follow_status(slug: str, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    if not current_user:
        return ok({"following": False}, resource="follows")
    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM follows WHERE follower_user_id = ? AND roaster_slug = ?",
            (current_user["id"], slug),
        ).fetchone()
        return ok({"following": bool(row)}, resource="follows")
    finally:
        db.close()


@router.get("/followers/{slug}")
def followers_list(slug: str):
    db = get_db()
    try:
        count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
        rows = db.execute(
            "SELECT u.username, u.display_name, u.avatar_url, u.location, u.account_type, u.roaster_slug "
            "FROM follows f JOIN users u ON f.follower_user_id = u.id WHERE f.roaster_slug = ?",
            (slug,),
        ).fetchall()
        return ok({"follower_count": count, "followers": [dict(r) for r in rows]}, resource="follows")
    finally:
        db.close()


@router.get("/my-following")
def my_following(user=Depends(get_current_user)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT f.roaster_slug as slug, f.created_at as followed_at FROM follows f "
            "WHERE f.follower_user_id = ? ORDER BY f.created_at DESC",
            (user["id"],),
        ).fetchall()
        following = []
        for r in rows:
            slug = r["slug"]
            if slug.startswith("user_"):
                uid = int(slug.replace("user_", ""))
                u = db.execute("SELECT username, display_name, avatar_url, account_type, roaster_slug FROM users WHERE id = ?", (uid,)).fetchone()
            else:
                u = db.execute("SELECT username, display_name, avatar_url, account_type, roaster_slug FROM users WHERE roaster_slug = ?", (slug,)).fetchone()
            if u:
                fc = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
                following.append({
                    "slug": slug, "username": u["username"], "display_name": u["display_name"],
                    "avatar_url": u["avatar_url"], "account_type": u["account_type"],
                    "roaster_slug": u["roaster_slug"], "follower_count": fc,
                    "is_roaster": u["account_type"] == "roaster",
                })
        slugs = [r["slug"] for r in rows]
        return ok({"following": following, "slugs": slugs}, resource="follows")
    finally:
        db.close()


# ── Notification convenience ─────────────────────────────────────────────────

@router.get("/notification-count")
def unread_count(user=Depends(get_current_user)):
    db = get_db()
    try:
        c = db.execute("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0", (user["id"],)).fetchone()["c"]
        return ok({"count": c}, resource="notifications")
    finally:
        db.close()


@router.post("/notifications-mark-read")
def mark_all_read(user=Depends(get_current_user)):
    db = get_db()
    try:
        db.execute("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", (user["id"],))
        db.commit()
        return ok({"ok": True}, resource="notifications")
    finally:
        db.close()


@router.post("/notification-read/{nid}")
def mark_one_read(nid: int, user=Depends(get_current_user)):
    db = get_db()
    try:
        db.execute("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", (nid, user["id"]))
        db.commit()
        return ok({"ok": True}, resource="notifications")
    finally:
        db.close()


# ── User/Roaster posts ───────────────────────────────────────────────────────

@router.get("/users/{username}/posts")
def user_posts(username: str, limit: int = 20, offset: int = 0, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        user_row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user_row:
            from fastapi import HTTPException
            raise HTTPException(404, "User not found")
        items, total = list_resource(db, "posts", filters={"user_id": user_row["id"]},
                                     limit=limit, offset=offset, current_user_id=uid)
        return ok({"posts": items, "total": total}, resource="posts")
    finally:
        db.close()


@router.get("/users/{username}/likes")
def user_likes(username: str, limit: int = 20, offset: int = 0, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        user_row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user_row:
            from fastapi import HTTPException
            raise HTTPException(404, "User not found")
        total = db.execute(
            "SELECT COUNT(*) as c FROM post_likes WHERE user_id = ?",
            (user_row["id"],)
        ).fetchone()["c"]
        res_def = get_resource("posts")
        sql = build_select(res_def, uid)
        sql += ("\n    JOIN post_likes _pl ON t.id = _pl.post_id"
                "\n    WHERE _pl.user_id = ?"
                "\n    ORDER BY _pl.created_at DESC LIMIT ? OFFSET ?")
        rows = db.execute(sql, (user_row["id"], limit, offset)).fetchall()
        items = [row_to_dict(r, res_def) for r in rows]
        resolve_embeds(db, items, res_def, uid)
        return ok({"posts": items, "total": total}, resource="posts")
    finally:
        db.close()


@router.get("/users/{username}/comments")
def user_comments(username: str, limit: int = 20, offset: int = 0, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        user_row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user_row:
            from fastapi import HTTPException
            raise HTTPException(404, "User not found")
        items, total = list_resource(db, "post_comments", filters={"user_id": user_row["id"]},
                                     limit=limit, offset=offset, current_user_id=uid,
                                     order="created_at DESC")
        return ok({"comments": items, "total": total}, resource="post_comments")
    finally:
        db.close()


@router.get("/roasters/{slug}/posts")
def roaster_posts(slug: str, limit: int = 20, offset: int = 0, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        items, total = list_resource(db, "posts", filters={"roaster_slug": slug},
                                     limit=limit, offset=offset, current_user_id=uid)
        return ok({"posts": items, "total": total}, resource="posts")
    finally:
        db.close()


@router.get("/roasters/{slug}/posts/featured")
def featured_posts(slug: str):
    db = get_db()
    try:
        items, _ = list_resource(db, "posts", filters={"roaster_slug": slug, "is_featured": 1}, limit=2)
        return ok({"featured_posts": items}, resource="posts")
    finally:
        db.close()


# ── Roaster follow toggle (old path) ────────────────────────────────────────

@router.post("/roasters/{slug}/follow")
def toggle_follow(slug: str, user=Depends(get_current_user)):
    from resources.crud import toggle_resource
    from resources.envelope import toggled as toggled_env
    from services.notifications import run_hook
    db = get_db()
    try:
        state, count = toggle_resource(db, "follows", slug, current_user=user)
        if state:
            run_hook("notify_follow", db, target_id=slug, current_user=user)
        return ok({"following": state, "follower_count": count}, resource="follows")
    finally:
        db.close()


# ── Roaster profile update ──────────────────────────────────────────────────

@router.put("/roasters/{slug}/profile")
def update_roaster_profile(slug: str, body: dict, user=Depends(get_current_user)):
    from fastapi import HTTPException
    from services.notifications import run_hook
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        fields = ["about_blurb", "specialties", "website", "city", "logo_url",
                  "hero_image_url", "hero_crop_x", "hero_crop_y", "hero_zoom"]
        import json, datetime
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        sets = ["updated_at = ?"]
        vals = [now]
        for f in fields:
            if f in body:
                val = body[f]
                if f == "specialties" and isinstance(val, list):
                    val = json.dumps(val)
                sets.append(f"{f} = ?")
                vals.append(val)
        # Upsert
        existing = db.execute("SELECT roaster_slug FROM roaster_profiles WHERE roaster_slug = ?", (slug,)).fetchone()
        if existing:
            vals.append(slug)
            db.execute(f"UPDATE roaster_profiles SET {', '.join(sets)} WHERE roaster_slug = ?", vals)
        else:
            name = body.get("name", slug)
            db.execute(
                f"INSERT INTO roaster_profiles (roaster_slug, name, {', '.join(f for f in fields if f in body)}, updated_at) "
                f"VALUES (?, ?, {', '.join('?' for f in fields if f in body)}, ?)",
                [slug, name] + [json.dumps(body[f]) if f == "specialties" and isinstance(body.get(f), list) else body[f] for f in fields if f in body] + [now],
            )
        db.commit()
        row = db.execute("SELECT * FROM roaster_profiles WHERE roaster_slug = ?", (slug,)).fetchone()
        # Mirror the logo onto the owner's user.avatar_url so the navbar
        # reflects the new image (same convention as cafes).
        if row and "logo_url" in body:
            run_hook(
                "sync_roaster_logo_to_user", db, item=dict(row),
                current_user=user,
            )
        return ok(dict(row), resource="roaster_profiles")
    finally:
        db.close()


# ── Social compat (old paths) ────────────────────────────────────────────────

@router.put("/posts/{post_id}/pin")
def toggle_post_pin(post_id: int, user=Depends(get_current_user)):
    """Toggle pin on a post. Unpins any other pinned post by the same owner first."""
    db = get_db()
    try:
        post = db.execute("SELECT id, user_id, is_pinned FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            from fastapi import HTTPException
            raise HTTPException(404, "Post not found")
        if post["user_id"] != user["id"]:
            from fastapi import HTTPException
            raise HTTPException(403, "Not your post")
        new_pinned = 0 if post["is_pinned"] else 1
        if new_pinned:
            # Unpin any existing pinned post by this user
            db.execute("UPDATE roaster_posts SET is_pinned = 0 WHERE user_id = ? AND is_pinned = 1", (user["id"],))
        db.execute("UPDATE roaster_posts SET is_pinned = ? WHERE id = ?", (new_pinned, post_id))
        db.commit()
        return ok({"pinned": bool(new_pinned)}, resource="posts")
    finally:
        db.close()


@router.post("/posts/{post_id}/like")
def toggle_post_like(post_id: int, user=Depends(get_current_user)):
    from resources.crud import toggle_resource
    from services.notifications import run_hook
    db = get_db()
    try:
        state, count = toggle_resource(db, "post_likes", post_id, current_user=user)
        if state:
            run_hook("notify_like", db, target_id=post_id, current_user=user)
        return ok({"liked": state, "like_count": count}, resource="post_likes")
    finally:
        db.close()


@router.get("/posts/{post_id}/comments")
def get_post_comments(post_id: int, authorization: str = Header(None)):
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        items, total = list_resource(db, "post_comments", parent_id=post_id,
                                     limit=100, current_user_id=uid)
        return ok({"comments": items}, resource="post_comments")
    finally:
        db.close()


@router.post("/posts/{post_id}/comments", status_code=201)
def create_post_comment(post_id: int, body: dict, user=Depends(get_current_user)):
    from resources.crud import create_resource
    from services.notifications import run_hook
    body["post_id"] = post_id
    db = get_db()
    try:
        item = create_resource(db, "post_comments", body, current_user=user)
        run_hook("notify_comment", db, item=item, current_user=user)
        return ok(item, resource="post_comments")
    finally:
        db.close()


@router.post("/post-comments/{comment_id}/like")
def toggle_comment_like(comment_id: int, user=Depends(get_current_user)):
    from resources.crud import toggle_resource
    from services.notifications import run_hook
    db = get_db()
    try:
        state, count = toggle_resource(db, "comment_likes", comment_id, current_user=user)
        if state:
            run_hook("notify_comment_like", db, target_id=comment_id, current_user=user)
        return ok({"liked": state, "like_count": count}, resource="comment_likes")
    finally:
        db.close()


@router.put("/post-comments/{comment_id}")
def edit_comment(comment_id: int, body: dict, user=Depends(get_current_user)):
    from resources.crud import update_resource
    db = get_db()
    try:
        item = update_resource(db, "post_comments", comment_id, body, current_user=user)
        return ok(item, resource="post_comments")
    finally:
        db.close()


@router.delete("/post-comments/{comment_id}")
def delete_comment(comment_id: int, user=Depends(get_current_user)):
    from resources.crud import delete_resource
    db = get_db()
    try:
        result = delete_resource(db, "post_comments", comment_id, current_user=user)
        return ok(result, resource="post_comments")
    finally:
        db.close()


@router.post("/notes/{note_id}/like")
def toggle_note_like(note_id: int, user=Depends(get_current_user)):
    from resources.crud import toggle_resource
    db = get_db()
    try:
        state, count = toggle_resource(db, "note_likes", note_id, current_user=user)
        return ok({"liked": state, "like_count": count}, resource="note_likes")
    finally:
        db.close()


@router.get("/notes/{note_id}/comments")
def get_note_comments(note_id: int):
    db = get_db()
    try:
        items, total = list_resource(db, "note_comments", parent_id=note_id, limit=100)
        return ok({"comments": items}, resource="note_comments")
    finally:
        db.close()


@router.post("/notes/{note_id}/comments", status_code=201)
def create_note_comment(note_id: int, body: dict, user=Depends(get_current_user)):
    from resources.crud import create_resource
    body["note_id"] = note_id
    db = get_db()
    try:
        item = create_resource(db, "note_comments", body, current_user=user)
        return ok(item, resource="note_comments")
    finally:
        db.close()


# ── Roaster products ─────────────────────────────────────────────────────────

@router.post("/roasters/{slug}/products", status_code=201)
def create_roaster_product(slug: str, body: dict, user=Depends(get_current_user)):
    from fastapi import HTTPException
    from services.notifications import run_hook
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        import datetime
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            "INSERT INTO roaster_products (roaster_slug, user_id, coffee_name, roast_level, tasting_notes, "
            "origin, process, varietal, altitude_masl, bean_type, flavor_notes, weight_grams, price_inr, "
            "image_url, product_url, description_raw, available, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
            (slug, user["id"], body.get("coffee_name"), body.get("roast_level"), body.get("tasting_notes"),
             body.get("origin"), body.get("process"), body.get("varietal"), body.get("altitude_masl"),
             body.get("bean_type"), body.get("flavor_notes"), body.get("weight_grams"), body.get("price_inr"),
             body.get("image_url"), body.get("product_url"), body.get("description_raw"), now),
        )
        db.commit()
        row = db.execute("SELECT * FROM roaster_products WHERE id = ?", (db.execute("SELECT last_insert_rowid()").fetchone()[0],)).fetchone()
        # Fan out "new coffee" notification to roaster's followers.
        run_hook("notify_followers_catalog", db, current_user=user, extra={
            "slug": slug, "kind": "roaster", "change": "product_added",
            "subject": body.get("coffee_name") or "a new coffee",
        })
        return ok(dict(row), resource="roaster_products")
    finally:
        db.close()


@router.delete("/roasters/{slug}/products/{product_id}")
def delete_roaster_product(slug: str, product_id: int, user=Depends(get_current_user)):
    from fastapi import HTTPException
    from services.notifications import run_hook
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        # Capture the coffee name before deleting so the notification has
        # useful context for the follower.
        row = db.execute(
            "SELECT coffee_name FROM roaster_products WHERE id = ? AND roaster_slug = ?",
            (product_id, slug),
        ).fetchone()
        coffee_name = row["coffee_name"] if row else None
        db.execute("DELETE FROM roaster_products WHERE id = ? AND roaster_slug = ?", (product_id, slug))
        db.commit()
        run_hook("notify_followers_catalog", db, current_user=user, extra={
            "slug": slug, "kind": "roaster", "change": "product_removed",
            "subject": coffee_name or "a coffee",
        })
        return ok({"deleted": True}, resource="roaster_products")
    finally:
        db.close()


@router.post("/roasters/{slug}/products/hide")
def hide_product(slug: str, body: dict, user=Depends(get_current_user)):
    from fastapi import HTTPException
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        import datetime
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute("INSERT OR IGNORE INTO hidden_products (roaster_slug, product_id, hidden_at) VALUES (?,?,?)",
                   (slug, body.get("product_id"), now))
        db.commit()
        return ok({"hidden": True}, resource="hidden_products")
    finally:
        db.close()


# ── Posts timeline (old format compat) ───────────────────────────────────────

@router.get("/posts-timeline")
def posts_timeline_compat(limit: int = 30, offset: int = 0, authorization: str = Header(None)):
    """Old-format timeline that returns {items: [...]}."""
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        items, total = list_resource(db, "posts", limit=limit, offset=offset, current_user_id=uid)
        return ok({"items": items, "total": total}, resource="posts")
    finally:
        db.close()


# ── Product popularity + users ────────────────────────────────────────────────

@router.get("/products/popularity")
def product_popularity():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT product_id, COUNT(DISTINCT user_id) as user_count FROM shelf_entries GROUP BY product_id"
        ).fetchall()
        return ok({r["product_id"]: r["user_count"] for r in rows}, resource="products")
    finally:
        db.close()


@router.get("/products/{product_id}/users")
def product_users(product_id: str):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT se.shelf, se.added_at, u.username, u.display_name, u.avatar_url, u.location "
            "FROM shelf_entries se JOIN users u ON se.user_id = u.id WHERE se.product_id = ?",
            (product_id,),
        ).fetchall()
        users = []
        for r in rows:
            notes = db.execute(
                "SELECT * FROM tasting_notes WHERE user_id = (SELECT id FROM users WHERE username = ?) AND product_id = ?",
                (r["username"], product_id),
            ).fetchall()
            users.append({
                "username": r["username"], "display_name": r["display_name"],
                "avatar_url": r["avatar_url"], "location": r["location"],
                "shelf": r["shelf"], "added_at": r["added_at"],
                "notes": [dict(n) for n in notes],
            })
        return ok({"product_id": product_id, "users": users}, resource="products")
    finally:
        db.close()


# ── Roasters list (merged from DB + catalog) ─────────────────────────────────

@router.get("/roasters")
def list_roasters():
    """Return all roasters from roaster_profiles + products table."""
    db = get_db()
    try:
        # Get roasters from profiles table
        profiles = db.execute("SELECT * FROM roaster_profiles").fetchall()
        profile_map = {r["roaster_slug"]: dict(r) for r in profiles}

        # Get roasters from products table (unique slugs)
        product_roasters = db.execute(
            "SELECT DISTINCT roaster_slug, roaster_name FROM products WHERE available = 1"
        ).fetchall()

        # Merge: profiles take priority, fill in from products
        roasters = []
        seen = set()
        for slug, data in profile_map.items():
            seen.add(slug)
            roasters.append(data)
        for r in product_roasters:
            if r["roaster_slug"] not in seen:
                seen.add(r["roaster_slug"])
                roasters.append({"roaster_slug": r["roaster_slug"], "name": r["roaster_name"]})

        # Also load from bundled roasters.json for enrichment
        import os, json
        _BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        roasters_json = os.path.join(_BASE, "crema-app", "src", "data", "roasters.json")
        if os.path.exists(roasters_json):
            with open(roasters_json) as f:
                enriched = json.load(f)
            enriched_map = {r.get("roaster_slug"): r for r in enriched if r.get("roaster_slug")}
            for roaster in roasters:
                slug = roaster.get("roaster_slug")
                if slug in enriched_map:
                    e = enriched_map[slug]
                    for key in ["city", "state", "website", "logo_url", "about_blurb", "founding_year",
                                "sourcing_regions", "specialties", "social_links", "lat", "lng"]:
                        if key in e and not roaster.get(key):
                            roaster[key] = e[key]

        return ok(roasters, resource="roasters")
    finally:
        db.close()


# ── Feed timeline ────────────────────────────────────────────────────────────

@router.get("/feed-timeline")
def feed_timeline(limit: int = 30, offset: int = 0, authorization: str = Header(None)):
    """Combined posts feed, sorted by date."""
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        items, total = list_resource(db, "posts", limit=200, offset=0, current_user_id=uid)
        items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
        paginated = items[offset: offset + limit]
        return ok(paginated, resource="posts", total=total, limit=limit, offset=offset)
    finally:
        db.close()


# ── Café composite endpoints (see CRUD_UTOPIA.md) ────────────────────────────


@router.post("/me/qr-token")
def my_qr_token(user=Depends(get_current_user)):
    """Issue a short-lived QR token for the current user's identity card.
    Only regular users get QR tokens (sellers scan, they don't get scanned)."""
    if user.get("account_type") != "user":
        from fastapi import HTTPException
        raise HTTPException(403, "Only users can generate QR tokens")
    db = get_db()
    try:
        payload = issue_qr_token(db, user["id"])
        return ok(payload, resource="qr_token")
    finally:
        db.close()


@router.post("/qr-token/resolve")
def qr_token_resolve(body: dict, user=Depends(get_current_user)):
    """Decode a scanned QR token into a user preview WITHOUT creating a
    stamp. The café owner's client calls this right after the camera
    decodes a QR; the owner then taps the circular stamp button to commit
    the actual stamp via /cafes/{slug}/stamp.
    """
    from fastapi import HTTPException
    if user.get("account_type") != "cafe":
        raise HTTPException(403, "Only café owners can resolve QR tokens")
    token = (body or {}).get("qr_token")
    if not token:
        raise HTTPException(422, "qr_token is required")
    db = get_db()
    try:
        resolved = verify_qr_token(db, token)
        if not resolved:
            raise HTTPException(400, "Invalid or expired QR token")
        if resolved.get("account_type") != "user":
            raise HTTPException(400, "Only user accounts can be stamped")
        return ok({
            "user_id": resolved["id"],
            "username": resolved.get("username"),
            "display_name": resolved.get("display_name"),
            "avatar_url": resolved.get("avatar_url"),
            "avatar_crop_x": resolved.get("avatar_crop_x"),
            "avatar_crop_y": resolved.get("avatar_crop_y"),
            "avatar_zoom": resolved.get("avatar_zoom"),
            "location": resolved.get("location"),
        }, resource="qr_token_resolved")
    finally:
        db.close()


@router.get("/users/search")
def users_search(q: str = "", limit: int = 20):
    """Café-owner-facing user picker. Matches username or display_name
    case-insensitively, returns only regular user accounts (not roasters /
    cafés). The caller is authenticated at the enclosing action (stamp);
    search itself is intentionally open because usernames are already
    public (/users/{username} pages render unauthenticated).
    """
    q = (q or "").strip()
    if len(q) < 1:
        return ok([], resource="users")
    db = get_db()
    try:
        like = f"%{q.lower()}%"
        rows = db.execute(
            """
            SELECT id, username, display_name, avatar_url,
                avatar_crop_x, avatar_crop_y, avatar_zoom, location
            FROM users
            WHERE account_type = 'user'
              AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
            ORDER BY
                CASE WHEN LOWER(username) = ? THEN 0
                     WHEN LOWER(username) LIKE ? THEN 1
                     WHEN LOWER(display_name) LIKE ? THEN 2
                     ELSE 3 END,
                display_name
            LIMIT ?
            """,
            (like, like, q.lower(), f"{q.lower()}%", f"{q.lower()}%", max(1, min(50, int(limit)))),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="users", total=len(rows))
    finally:
        db.close()


@router.post("/cafes/{slug}/stamp")
def cafe_stamp(slug: str, body: dict, user=Depends(get_current_user)):
    """Café owner directly stamps a user by id. No QR token — the owner
    searches the user by name, confirms on the avatar card, and taps the
    stamp button. Rate limit: max 1 stamp per user per café per 24h."""
    from fastapi import HTTPException
    import datetime as _dt

    # Verify caller is the owner of this café
    if user.get("account_type") != "cafe" or user.get("cafe_slug") != slug:
        raise HTTPException(403, "Only the café owner can award stamps at this café")

    target_user_id = body.get("user_id")
    if not target_user_id:
        raise HTTPException(422, "user_id is required")
    try:
        target_user_id = int(target_user_id)
    except (TypeError, ValueError):
        raise HTTPException(422, "user_id must be an integer")

    db = get_db()
    try:
        stamped_user = db.execute(
            "SELECT id, username, display_name, avatar_url, account_type "
            "FROM users WHERE id = ?",
            (target_user_id,),
        ).fetchone()
        if not stamped_user:
            raise HTTPException(404, "User not found")
        if stamped_user["account_type"] != "user":
            raise HTTPException(400, "Only user accounts can receive stamps")

        # Rate limit check — 24h window
        yesterday = (_dt.datetime.utcnow() - _dt.timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        recent = db.execute(
            "SELECT id FROM stamps WHERE user_id = ? AND cafe_slug = ? AND scanned_at > ? LIMIT 1",
            (stamped_user["id"], slug, yesterday),
        ).fetchone()
        if recent:
            raise HTTPException(429, "Already stamped this user within the last 24 hours")

        # Fetch café config
        cafe = db.execute(
            "SELECT stamp_target, name FROM cafe_profiles WHERE cafe_slug = ?", (slug,)
        ).fetchone()
        if not cafe:
            raise HTTPException(404, "Café not found")

        # Insert stamp
        now_str = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            "INSERT INTO stamps (user_id, cafe_slug, scanned_at) VALUES (?, ?, ?)",
            (stamped_user["id"], slug, now_str),
        )
        db.commit()

        # Compute progress (total stamps minus consumed stamps)
        total_stamps = db.execute(
            "SELECT COUNT(*) as c FROM stamps WHERE user_id = ? AND cafe_slug = ?",
            (stamped_user["id"], slug),
        ).fetchone()["c"]
        rewards = db.execute(
            "SELECT COUNT(*) as c FROM stamp_rewards WHERE user_id = ? AND cafe_slug = ?",
            (stamped_user["id"], slug),
        ).fetchone()["c"]
        target = cafe["stamp_target"]
        progress = total_stamps - (rewards * target)
        reward_earned = progress >= target

        return ok({
            "user_id": stamped_user["id"],
            "display_name": stamped_user["display_name"],
            "username": stamped_user["username"],
            "avatar_url": stamped_user["avatar_url"],
            "stamps_progress": progress,
            "stamp_target": target,
            "reward_earned": reward_earned,
            "total_stamps_ever": total_stamps,
            "rewards_ever": rewards,
        }, resource="stamp")
    finally:
        db.close()


@router.post("/cafes/{slug}/redeem")
def cafe_redeem(slug: str, body: dict, user=Depends(get_current_user)):
    """Café owner redeems a user's reward. Creates a stamp_rewards row."""
    from fastapi import HTTPException
    import datetime as _dt

    if user.get("account_type") != "cafe" or user.get("cafe_slug") != slug:
        raise HTTPException(403, "Only the café owner can redeem rewards")

    target_user_id = body.get("user_id")
    if not target_user_id:
        raise HTTPException(422, "user_id is required")

    db = get_db()
    try:
        cafe = db.execute(
            "SELECT stamp_target FROM cafe_profiles WHERE cafe_slug = ?", (slug,)
        ).fetchone()
        if not cafe:
            raise HTTPException(404, "Café not found")

        target = cafe["stamp_target"]

        # Verify the user actually has enough stamps to redeem
        total_stamps = db.execute(
            "SELECT COUNT(*) as c FROM stamps WHERE user_id = ? AND cafe_slug = ?",
            (target_user_id, slug),
        ).fetchone()["c"]
        rewards = db.execute(
            "SELECT COUNT(*) as c FROM stamp_rewards WHERE user_id = ? AND cafe_slug = ?",
            (target_user_id, slug),
        ).fetchone()["c"]
        progress = total_stamps - (rewards * target)
        if progress < target:
            raise HTTPException(400, f"Not enough stamps: {progress}/{target}")

        now_str = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            "INSERT INTO stamp_rewards (user_id, cafe_slug, stamps_used, redeemed_at) VALUES (?, ?, ?, ?)",
            (target_user_id, slug, target, now_str),
        )
        db.commit()

        return ok({
            "user_id": target_user_id,
            "cafe_slug": slug,
            "stamps_used": target,
            "redeemed_at": now_str,
        }, resource="stamp_reward")
    finally:
        db.close()


@router.get("/cafes/popularity")
def cafes_popularity():
    """Unique visitor count per café, mirrors /products/popularity pattern."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT cafe_slug, COUNT(DISTINCT user_id) AS visitors FROM stamps GROUP BY cafe_slug"
        ).fetchall()
        return ok({r["cafe_slug"]: r["visitors"] for r in rows}, resource="cafe_popularity")
    finally:
        db.close()


@router.get("/users/{username}/stamp-book")
def user_stamp_book(username: str, authorization: str = Header(None)):
    """Return every café the user has been stamped at, with progress.
    Mirrors the shelf pattern — semi-public: list is visible, QR is own-only."""
    from fastapi import HTTPException
    db = get_db()
    try:
        user_row = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not user_row:
            raise HTTPException(404, "User not found")
        uid = user_row["id"]

        rows = db.execute("""
            SELECT
                cp.cafe_slug,
                cp.name,
                cp.logo_url,
                cp.city,
                cp.state,
                cp.stamp_target,
                cp.stamp_reward,
                (SELECT COUNT(*) FROM stamps s WHERE s.user_id = ? AND s.cafe_slug = cp.cafe_slug) AS total_stamps,
                (SELECT COUNT(*) FROM stamp_rewards sr WHERE sr.user_id = ? AND sr.cafe_slug = cp.cafe_slug) AS rewards_redeemed,
                (SELECT MAX(scanned_at) FROM stamps s WHERE s.user_id = ? AND s.cafe_slug = cp.cafe_slug) AS last_visit
            FROM cafe_profiles cp
            WHERE EXISTS (SELECT 1 FROM stamps s WHERE s.user_id = ? AND s.cafe_slug = cp.cafe_slug)
            ORDER BY last_visit DESC
        """, (uid, uid, uid, uid)).fetchall()

        entries = []
        for r in rows:
            target = r["stamp_target"] or 10
            total = r["total_stamps"]
            redeemed = r["rewards_redeemed"]
            progress = total - (redeemed * target)
            entries.append({
                "cafe_slug": r["cafe_slug"],
                "name": r["name"],
                "logo_url": r["logo_url"],
                "city": r["city"],
                "state": r["state"],
                "stamp_target": target,
                "stamp_reward": r["stamp_reward"],
                "progress": progress,
                "total_stamps": total,
                "rewards_redeemed": redeemed,
                "last_visit": r["last_visit"],
            })

        return ok(entries, resource="stamp_book", total=len(entries))
    finally:
        db.close()
