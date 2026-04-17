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


# ── Link preview ────────────────────────────────────────────────────────────
# Lives here (not main.py) so the router registration fires BEFORE
# resources_router's `/{resource}` catch-all would otherwise swallow
# `/api/link-preview` as `resource="link-preview"` and 500.

_link_preview_cache: dict = {}


@router.get("/link-preview")
def link_preview(url: str = ""):
    """Fetch Open Graph metadata for a URL. Used by the composer to
    turn a pasted URL into an article card. Failures fall through to
    a domain-favicon fallback so the composer never ends up stuck
    with no preview."""
    import re as _re
    import urllib.request
    from urllib.parse import urlparse

    if not url or not url.startswith("http"):
        return ok({"title": "", "description": "", "image_url": "", "domain": ""}, resource="link_preview")

    if url in _link_preview_cache:
        return ok(_link_preview_cache[url], resource="link_preview")

    domain = urlparse(url).netloc.replace("www.", "")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; CremaBot/1.0)"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read(50_000).decode("utf-8", errors="ignore")

        def og(prop: str) -> str:
            m = _re.search(rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']+)["\']', html, _re.I)
            if not m:
                m = _re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{prop}["\']', html, _re.I)
            return m.group(1) if m else ""

        title = og("title")
        if not title:
            m = _re.search(r"<title[^>]*>([^<]+)</title>", html, _re.I)
            title = m.group(1).strip() if m else ""

        image_url = og("image")
        if not image_url:
            image_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"

        result = {"title": title, "description": og("description"), "image_url": image_url, "domain": domain}
        _link_preview_cache[url] = result
        return ok(result, resource="link_preview")
    except Exception:
        image_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
        result = {"title": "", "description": "", "image_url": image_url, "domain": domain}
        _link_preview_cache[url] = result
        return ok(result, resource="link_preview")


@router.get("/stats/traction")
def stats_traction(user=Depends(get_current_user)):
    _require_admin(user)
    db = get_db()
    try:
        return ok(compute_traction(db), resource="traction")
    finally:
        db.close()


@router.get("/stats/series")
def stats_series(key: str, range: str = "30d", user=Depends(get_current_user)):
    """Daily time-series for a single admin metric.

    §2.18 drill-down — every card in `TractionDashboard` opens a
    modal that fetches one named series from here. Dispatch by key;
    each series is a plain SQL snippet that returns
    (date, count) rows, fed through the shared `_daily_series`
    helper so leading zeros are trimmed and the window is filled.

    The key naming mirrors the `snake_case` identifiers returned by
    `compute_traction` (e.g. `daily_signups`, `dau`), so the frontend
    can route without a separate mapping table.
    """
    from services.admin_stats import build_series
    _require_admin(user)
    try:
        days = int(range.rstrip("d")) if range.endswith("d") else 30
    except ValueError:
        days = 30
    db = get_db()
    try:
        series = build_series(db, key, max(1, min(365, days)))
        return ok(series, resource="series", key=key, range=f"{days}d")
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
            "image_url, product_url, description_raw, available, "
            "wholesale_available, wholesale_minimum_kg, wholesale_note, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)",
            (slug, user["id"], body.get("coffee_name"), body.get("roast_level"), body.get("tasting_notes"),
             body.get("origin"), body.get("process"), body.get("varietal"), body.get("altitude_masl"),
             body.get("bean_type"), body.get("flavor_notes"), body.get("weight_grams"), body.get("price_inr"),
             body.get("image_url"), body.get("product_url"), body.get("description_raw"),
             1 if body.get("wholesale_available") else 0,
             body.get("wholesale_minimum_kg"),
             body.get("wholesale_note"),
             now),
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
    from services import trash as _trash
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        # Full-row snapshot before DELETE — feeds both the
        # notification copy and the recycle-bin capture so the
        # roaster can undo a misfire from their ProfileDropdown bin.
        row = db.execute(
            "SELECT * FROM roaster_products WHERE id = ? AND roaster_slug = ?",
            (product_id, slug),
        ).fetchone()
        coffee_name = row["coffee_name"] if row else None
        if row:
            _trash.capture(
                db,
                entity_type="roaster_products",
                entity_id=product_id,
                row=dict(row),
                deleted_by_user_id=user["id"],
            )
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


@router.get("/products/{product_id}/posts")
def product_posts(product_id: str, authorization: str = Header(None)):
    """Posts that reference this product via tasting_note.

    Returns full envelope-wrapped `Post` objects (with `author`, counts,
    `liked_by_me` flag) so the frontend can render them through the
    shared `PostCard` component — no custom-shaped rendering for
    tasting-notes-on-shelf. Used by `PopularityModal` to replace the
    earlier bespoke tasting-note display.
    """
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    db = get_db()
    try:
        # Collect every tasting-note row for this product, then the
        # roaster_posts that wrap them. Two small lookups beats a
        # join-heavy one and keeps the logic obvious.
        tn_rows = db.execute(
            "SELECT id FROM tasting_notes WHERE product_id = ?",
            (product_id,),
        ).fetchall()
        tn_ids = [r["id"] for r in tn_rows]
        if not tn_ids:
            return ok([], resource="posts", total=0)
        placeholders = ",".join(["?"] * len(tn_ids))
        post_id_rows = db.execute(
            f"SELECT id FROM roaster_posts WHERE tasting_note_id IN ({placeholders})",
            tn_ids,
        ).fetchall()
        post_ids = {r["id"] for r in post_id_rows}
        if not post_ids:
            return ok([], resource="posts", total=0)
        # Run posts through the registry's list_resource so author +
        # counts + liked_by_me come back fully populated, then filter
        # to the matched set. Limit=500 caps the worst-case fan-out
        # but real distributions are tiny (N shelf-writers per bean).
        all_posts, _total = list_resource(db, "posts", limit=500, offset=0, current_user_id=uid)
        matched = [p for p in all_posts if p["id"] in post_ids]
        matched.sort(key=lambda p: p.get("published_at", ""), reverse=True)
        return ok(matched, resource="posts", total=len(matched))
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


# ── Favorite café "like" ────────────────────────────────────────────────────
#
# One per user, scarce. Distinct from follows (plural, casual). Stored
# as a single FK on users.favorite_cafe_slug; switching cafés just
# overwrites the column. The café-side "love_count" is the primary
# cult-status signal — computed server-side on every read via the
# registry's counts declaration.

@router.post("/cafes/{slug}/like")
def toggle_cafe_like(slug: str, user=Depends(get_current_user)):
    """Toggle the current user's favorite café. If they already love
    this café, clears the field (unlike). Otherwise sets it, replacing
    whatever café they previously loved (one love per user).
    Returns the new like state + current love_count in one round-trip
    so the UI can update both in-place without re-fetching."""
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    # Only regular users can "love" a café — roaster + café accounts
    # don't have a personal favorite in the product sense. We allow
    # the column to be set for any account_type, but don't surface
    # the UI for business accounts.
    db = get_db()
    try:
        exists = db.execute(
            "SELECT 1 FROM cafe_profiles WHERE cafe_slug = ?", (slug,),
        ).fetchone()
        if not exists:
            raise HTTPException(404, f"Café {slug} not found")
        current = db.execute(
            "SELECT favorite_cafe_slug FROM users WHERE id = ?", (user["id"],),
        ).fetchone()
        already_loved = (current and current["favorite_cafe_slug"] == slug)
        if already_loved:
            db.execute(
                "UPDATE users SET favorite_cafe_slug = NULL WHERE id = ?",
                (user["id"],),
            )
            liked = False
        else:
            db.execute(
                "UPDATE users SET favorite_cafe_slug = ? WHERE id = ?",
                (slug, user["id"]),
            )
            liked = True
        db.commit()
        love_count = db.execute(
            "SELECT COUNT(*) AS n FROM users WHERE favorite_cafe_slug = ?", (slug,),
        ).fetchone()["n"]
        return ok({"liked": liked, "love_count": love_count},
                  resource="cafe_love")
    finally:
        db.close()


@router.get("/cafes/{slug}/regulars")
def cafe_regulars(slug: str):
    """List users who have this café set as their favorite (aka
    regulars). Public — the signal is meant to be visible, same as
    follower lists. Returns enough per-user info for the modal row to
    render (avatar + crop + display name + username)."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, username, display_name, avatar_url, "
            "avatar_crop_x, avatar_crop_y, avatar_zoom "
            "FROM users WHERE favorite_cafe_slug = ? "
            "ORDER BY display_name ASC",
            (slug,),
        ).fetchall()
        items = [dict(r) for r in rows]
        return ok(items, resource="cafe_regulars", total=len(items))
    finally:
        db.close()


@router.get("/cafes/{slug}/love")
def cafe_love_status(slug: str, authorization: str = Header(None)):
    """Read-only status + count. Anonymous callers only get the count;
    authenticated callers also get whether *they* love this café."""
    user = get_optional_user(authorization)
    db = get_db()
    try:
        row = db.execute(
            "SELECT COUNT(*) AS n FROM users WHERE favorite_cafe_slug = ?", (slug,),
        ).fetchone()
        love_count = row["n"] if row else 0
        liked = False
        if user:
            me = db.execute(
                "SELECT favorite_cafe_slug FROM users WHERE id = ?", (user["id"],),
            ).fetchone()
            liked = bool(me and me["favorite_cafe_slug"] == slug)
        return ok({"liked": liked, "love_count": love_count},
                  resource="cafe_love")
    finally:
        db.close()


# ── Wholesale inquiries (Phase 1 §2.1) ──────────────────────────────────────
#
# The generic list endpoint can't safely list wholesale_inquiries: a café
# should see only their sent inquiries, a roaster should see only inquiries
# targeted at their own roaster_slug. Exposing /api/wholesale_inquiries with
# query filters would let anyone pass roaster_slug=X and read someone else's
# leads. These two endpoints do the scoping server-side.

@router.get("/my-wholesale-inquiries")
def my_wholesale_inquiries(user=Depends(get_current_user)):
    """Inquiries relevant to the current account.
    - Café account → inquiries this café has sent (as sender).
    - Roaster account → inquiries targeting this roaster (as recipient).
    - Regular user → empty list (no inquiries belong to them).
    The response stream is identical to the generic list payload so the
    frontend can reuse the same row renderer for both perspectives; the
    perspective field tells the UI which tab context it's in.
    """
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")

    account_type = user.get("account_type")
    db = get_db()
    try:
        res = get_resource("wholesale_inquiries")
        select = build_select(res, current_user_id=user["id"])

        if account_type == "cafe" and user.get("cafe_slug"):
            where_col, where_val = "cafe_slug", user["cafe_slug"]
            perspective = "sent"
        elif account_type == "roaster" and user.get("roaster_slug"):
            where_col, where_val = "roaster_slug", user["roaster_slug"]
            perspective = "received"
        else:
            return ok([], resource="wholesale_inquiries", total=0,
                      limit=100, offset=0, perspective="none")

        order = res.get("order", "created_at DESC")
        sql = f"{select}\n    WHERE t.{where_col} = ?\n    ORDER BY {order}\n    LIMIT 100"
        rows = db.execute(sql, (where_val,)).fetchall()
        items = [row_to_dict(r, res) for r in rows]
        return ok(items, resource="wholesale_inquiries",
                  total=len(items), limit=100, offset=0,
                  perspective=perspective)
    finally:
        db.close()


# ── Inquiry thread (short-form chat between café + roaster) ─────────────
#
# Both parties authenticated against the same inquiry. Ownership check:
# the current user must be either the café that opened the inquiry or a
# roaster user on the target roaster_slug. Regular users get 403.

def _require_inquiry_party(db, inquiry_id: int, user):
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    row = db.execute(
        "SELECT id, cafe_slug, roaster_slug FROM wholesale_inquiries WHERE id = ?",
        (inquiry_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Inquiry not found")
    is_cafe = user.get("account_type") == "cafe" and user.get("cafe_slug") == row["cafe_slug"]
    is_roaster = user.get("account_type") == "roaster" and user.get("roaster_slug") == row["roaster_slug"]
    if not (is_cafe or is_roaster):
        raise HTTPException(403, "Not a party to this inquiry")
    return row


@router.get("/wholesale-inquiries/{inquiry_id}/thread")
def get_inquiry_thread(inquiry_id: int, user=Depends(get_current_user)):
    """Return the inquiry record (with café context) plus the message
    list, ordered oldest→newest. One round-trip powers the entire
    inquiry-thread modal."""
    from resources.crud import get_resource_by_id
    db = get_db()
    try:
        _require_inquiry_party(db, inquiry_id, user)
        inquiry = get_resource_by_id(
            db, "wholesale_inquiries", inquiry_id, current_user_id=user["id"],
        )
        rows = db.execute(
            """SELECT m.id, m.inquiry_id, m.user_id, m.body, m.created_at,
                      u.username, u.display_name, u.avatar_url,
                      u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                      u.account_type
               FROM inquiry_messages m
               JOIN users u ON u.id = m.user_id
               WHERE m.inquiry_id = ?
               ORDER BY m.created_at ASC""",
            (inquiry_id,),
        ).fetchall()
        messages = [dict(r) for r in rows]
        return ok({"inquiry": inquiry, "messages": messages},
                  resource="wholesale_inquiry_thread")
    finally:
        db.close()


@router.post("/wholesale-inquiries/{inquiry_id}/messages", status_code=201)
def post_inquiry_message(inquiry_id: int, body: dict,
                         user=Depends(get_current_user)):
    """Add a message to the thread. Notifies the *other* party so the
    thread surfaces in their Business tab."""
    from fastapi import HTTPException
    from services.notifications import create_notification
    import datetime as _dt

    text = (body or {}).get("body", "").strip()
    if not text:
        raise HTTPException(400, "body is required")
    if len(text) > 2000:
        raise HTTPException(400, "body too long (max 2000 chars)")

    db = get_db()
    try:
        row = _require_inquiry_party(db, inquiry_id, user)
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = db.execute(
            "INSERT INTO inquiry_messages (inquiry_id, user_id, body, created_at) "
            "VALUES (?, ?, ?, ?)",
            (inquiry_id, user["id"], text, now),
        )
        mid = cur.lastrowid
        # Touch the parent inquiry so updated_at reflects last activity.
        db.execute(
            "UPDATE wholesale_inquiries SET updated_at = ? WHERE id = ?",
            (now, inquiry_id),
        )

        # Fan-out notification to the other party. If the sender is a
        # café, recipients are every roaster-account user on that slug.
        # If the sender is a roaster, recipient is the café-owner user
        # tied to the inquiry's cafe_slug.
        snippet = text if len(text) <= 60 else text[:57] + "…"
        if user.get("account_type") == "cafe":
            recipients = db.execute(
                "SELECT id FROM users WHERE account_type = 'roaster' AND roaster_slug = ?",
                (row["roaster_slug"],),
            ).fetchall()
        else:
            recipients = db.execute(
                "SELECT id FROM users WHERE account_type = 'cafe' AND cafe_slug = ?",
                (row["cafe_slug"],),
            ).fetchall()
        for r in recipients:
            if r["id"] == user["id"]:
                continue
            # Reuses the create_notification helper from services.
            db.execute(
                "INSERT INTO notifications (user_id, type, actor_id, inquiry_id, "
                "target_slug, subject, read, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                (
                    r["id"], "inquiry_reply", user["id"], inquiry_id,
                    f"cafe:{row['cafe_slug']}", snippet, now,
                ),
            )
        db.commit()

        # Return the freshly inserted row in the same shape the thread
        # endpoint returns so the client can append without re-fetching.
        msg = db.execute(
            """SELECT m.id, m.inquiry_id, m.user_id, m.body, m.created_at,
                      u.username, u.display_name, u.avatar_url,
                      u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                      u.account_type
               FROM inquiry_messages m JOIN users u ON u.id = m.user_id
               WHERE m.id = ?""",
            (mid,),
        ).fetchone()
        return ok(dict(msg), resource="inquiry_messages")
    finally:
        db.close()


# ── Messages inbox (unified: wholesale inquiries + direct messages) ─────────
#
# The navbar Messages dropdown hits /my-threads which returns both
# kinds in one ordered-by-activity list. /my-inquiry-threads stays
# for any call-site that explicitly wants only inquiries.

@router.get("/my-threads")
def my_threads(user=Depends(get_current_user)):
    """Unified inbox: wholesale inquiries + direct message threads the
    current user is a party to. Each row carries a `kind` discriminator
    the client uses to route taps to the right thread-view. Ordered by
    most-recent activity across both kinds."""
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")

    db = get_db()
    try:
        uid = user["id"]
        account_type = user.get("account_type")
        results: list[dict] = []

        # ── Wholesale inquiries (café + roaster accounts only) ──────────
        if account_type == "cafe" and user.get("cafe_slug"):
            where_col, where_val = "cafe_slug", user["cafe_slug"]
            last_read_col = "cafe_last_read_at"
        elif account_type == "roaster" and user.get("roaster_slug"):
            where_col, where_val = "roaster_slug", user["roaster_slug"]
            last_read_col = "roaster_last_read_at"
        else:
            where_col = where_val = last_read_col = None

        if where_col:
            inquiry_rows = db.execute(
                f"""
                SELECT
                    wi.id AS inquiry_id,
                    wi.cafe_slug, wi.roaster_slug,
                    wi.product_id, wi.note AS inquiry_note,
                    wi.status, wi.created_at AS opened_at,
                    wi.{last_read_col} AS last_read_at,
                    (SELECT cp.name FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_name,
                    (SELECT cp.logo_url FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_url,
                    (SELECT cp.logo_crop_x FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_crop_x,
                    (SELECT cp.logo_crop_y FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_crop_y,
                    (SELECT cp.logo_zoom   FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_zoom,
                    (SELECT rp.name FROM roaster_profiles rp WHERE rp.roaster_slug = wi.roaster_slug) AS roaster_name,
                    (SELECT rp.logo_url FROM roaster_profiles rp WHERE rp.roaster_slug = wi.roaster_slug) AS roaster_logo_url,
                    (SELECT p.coffee_name FROM products p WHERE p.product_id = wi.product_id) AS product_name,
                    (SELECT m.body FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                    (SELECT m.created_at FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
                    (SELECT m.user_id FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_user_id,
                    (SELECT COUNT(*) FROM inquiry_messages m
                        WHERE m.inquiry_id = wi.id
                          AND m.user_id != ?
                          AND (wi.{last_read_col} IS NULL OR m.created_at > wi.{last_read_col})
                    ) AS unread_count
                FROM wholesale_inquiries wi
                WHERE wi.{where_col} = ?
                """,
                (uid, where_val),
            ).fetchall()
            for r in inquiry_rows:
                d = dict(r)
                d["kind"] = "wholesale_inquiry"
                d["sort_at"] = d.get("last_message_at") or d.get("opened_at")
                results.append(d)

        # ── Direct message threads (any account type) ───────────────────
        dm_rows = db.execute(
            """
            SELECT
                dt.id AS thread_id,
                dt.user_a_id, dt.user_b_id,
                dt.created_at AS opened_at,
                dt.updated_at,
                CASE WHEN dt.user_a_id = ? THEN dt.user_a_last_read_at ELSE dt.user_b_last_read_at END AS last_read_at,
                CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END AS other_user_id,
                (SELECT u.username       FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_username,
                (SELECT u.display_name   FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_display_name,
                (SELECT u.avatar_url     FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_avatar_url,
                (SELECT u.avatar_crop_x  FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_avatar_crop_x,
                (SELECT u.avatar_crop_y  FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_avatar_crop_y,
                (SELECT u.avatar_zoom    FROM users u WHERE u.id = CASE WHEN dt.user_a_id = ? THEN dt.user_b_id ELSE dt.user_a_id END) AS other_avatar_zoom,
                (SELECT m.body       FROM direct_messages m WHERE m.thread_id = dt.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                (SELECT m.created_at FROM direct_messages m WHERE m.thread_id = dt.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
                (SELECT m.user_id    FROM direct_messages m WHERE m.thread_id = dt.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_user_id,
                (SELECT COUNT(*) FROM direct_messages m
                    WHERE m.thread_id = dt.id
                      AND m.user_id != ?
                      AND (
                          (dt.user_a_id = ? AND (dt.user_a_last_read_at IS NULL OR m.created_at > dt.user_a_last_read_at)) OR
                          (dt.user_b_id = ? AND (dt.user_b_last_read_at IS NULL OR m.created_at > dt.user_b_last_read_at))
                      )
                ) AS unread_count
            FROM direct_threads dt
            WHERE dt.user_a_id = ? OR dt.user_b_id = ?
            """,
            # 13 placeholders total: 8 CASE/subquery uses + 1 unread filter
            # + 2 unread scope CASEs + 2 WHERE terms. Count verified by
            # sqlite3.ProgrammingError when off-by-one.
            (uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid),
        ).fetchall()
        for r in dm_rows:
            d = dict(r)
            d["kind"] = "direct_message"
            d["sort_at"] = d.get("last_message_at") or d.get("opened_at")
            results.append(d)

        # Sort newest-activity first across both kinds.
        results.sort(key=lambda d: d.get("sort_at") or "", reverse=True)
        total_unread = sum(int(t.get("unread_count") or 0) for t in results)
        return ok(results, resource="threads",
                  total=len(results), total_unread=total_unread)
    finally:
        db.close()


@router.get("/my-inquiry-threads")
def my_inquiry_threads(user=Depends(get_current_user)):
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    account_type = user.get("account_type")
    db = get_db()
    try:
        if account_type == "cafe" and user.get("cafe_slug"):
            where_col, where_val = "cafe_slug", user["cafe_slug"]
            last_read_col = "cafe_last_read_at"
        elif account_type == "roaster" and user.get("roaster_slug"):
            where_col, where_val = "roaster_slug", user["roaster_slug"]
            last_read_col = "roaster_last_read_at"
        else:
            return ok([], resource="inquiry_threads", total=0)

        # One query: inquiry + counterparty display fields + latest
        # message preview + a per-thread unread count scoped to
        # messages authored by the other party after last_read.
        rows = db.execute(
            f"""
            SELECT
                wi.id AS inquiry_id,
                wi.cafe_slug, wi.roaster_slug,
                wi.product_id, wi.note AS inquiry_note,
                wi.status, wi.created_at AS opened_at,
                wi.{last_read_col} AS last_read_at,
                (SELECT cp.name FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_name,
                (SELECT cp.logo_url FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_url,
                (SELECT cp.logo_crop_x FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_crop_x,
                (SELECT cp.logo_crop_y FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_crop_y,
                (SELECT cp.logo_zoom   FROM cafe_profiles cp WHERE cp.cafe_slug = wi.cafe_slug) AS cafe_logo_zoom,
                (SELECT rp.name FROM roaster_profiles rp WHERE rp.roaster_slug = wi.roaster_slug) AS roaster_name,
                (SELECT rp.logo_url FROM roaster_profiles rp WHERE rp.roaster_slug = wi.roaster_slug) AS roaster_logo_url,
                (SELECT p.coffee_name FROM products p WHERE p.product_id = wi.product_id) AS product_name,
                (SELECT m.body FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                (SELECT m.created_at FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
                (SELECT m.user_id FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_user_id,
                (SELECT COUNT(*) FROM inquiry_messages m
                    WHERE m.inquiry_id = wi.id
                      AND m.user_id != ?
                      AND (wi.{last_read_col} IS NULL OR m.created_at > wi.{last_read_col})
                ) AS unread_count
            FROM wholesale_inquiries wi
            WHERE wi.{where_col} = ?
            ORDER BY COALESCE(
                (SELECT m.created_at FROM inquiry_messages m WHERE m.inquiry_id = wi.id ORDER BY m.created_at DESC LIMIT 1),
                wi.created_at
            ) DESC
            LIMIT 100
            """,
            (user["id"], where_val),
        ).fetchall()

        threads = [dict(r) for r in rows]
        total_unread = sum(int(t.get("unread_count") or 0) for t in threads)
        return ok(threads, resource="inquiry_threads",
                  total=len(threads), total_unread=total_unread,
                  perspective="cafe" if account_type == "cafe" else "roaster")
    finally:
        db.close()


@router.post("/wholesale-inquiries/{inquiry_id}/read")
def mark_inquiry_read(inquiry_id: int, user=Depends(get_current_user)):
    """Stamp the current party's last_read_at so new messages from the
    other side no longer count as unread in the inbox. Safe to call
    multiple times."""
    import datetime as _dt
    db = get_db()
    try:
        row = _require_inquiry_party(db, inquiry_id, user)
        col = "cafe_last_read_at" if user.get("account_type") == "cafe" else "roaster_last_read_at"
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            f"UPDATE wholesale_inquiries SET {col} = ? WHERE id = ?",
            (now, inquiry_id),
        )
        db.commit()
        return ok({"id": inquiry_id, "last_read_at": now},
                  resource="wholesale_inquiries")
    finally:
        db.close()


# ── Direct message threads ──────────────────────────────────────────────
#
# User ↔ user chat. Same ergonomics as inquiry threads but without any
# business context strip. Canonical pair ordering on the direct_threads
# row keeps uniqueness regardless of who initiated.

def _require_dm_party(db, thread_id: int, user):
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    row = db.execute(
        "SELECT id, user_a_id, user_b_id FROM direct_threads WHERE id = ?",
        (thread_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Thread not found")
    uid = user["id"]
    if uid != row["user_a_id"] and uid != row["user_b_id"]:
        raise HTTPException(403, "Not a party to this thread")
    return row


@router.post("/direct-threads/with/{username}", status_code=201)
def open_direct_thread(username: str, user=Depends(get_current_user)):
    """Open or re-use a direct thread with another user. Returns the
    thread id so the caller can immediately show the conversation.
    Canonical ordering (smaller user_id = user_a) means (A, B) and
    (B, A) always hit the same row."""
    import datetime as _dt
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    row = db_scoped_other_user(username)
    if not row:
        raise HTTPException(404, f"User {username} not found")
    other_id = row["id"]
    if other_id == user["id"]:
        raise HTTPException(400, "You can't message yourself")

    db = get_db()
    try:
        user_a, user_b = sorted([user["id"], other_id])
        existing = db.execute(
            "SELECT id FROM direct_threads WHERE user_a_id = ? AND user_b_id = ?",
            (user_a, user_b),
        ).fetchone()
        if existing:
            return ok({"thread_id": existing["id"], "created": False},
                      resource="direct_threads")
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = db.execute(
            "INSERT INTO direct_threads (user_a_id, user_b_id, created_at) "
            "VALUES (?, ?, ?)",
            (user_a, user_b, now),
        )
        db.commit()
        return ok({"thread_id": cur.lastrowid, "created": True},
                  resource="direct_threads")
    finally:
        db.close()


def db_scoped_other_user(username: str):
    """Small helper so open_direct_thread stays readable. Separate db
    connection because the caller also needs one."""
    from database import get_db as _get_db
    conn = _get_db()
    try:
        return conn.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    finally:
        conn.close()


@router.get("/direct-threads/{thread_id}/thread")
def get_direct_thread(thread_id: int, user=Depends(get_current_user)):
    """Return the thread metadata (counterparty info) + message list."""
    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        other_id = row["user_b_id"] if row["user_a_id"] == user["id"] else row["user_a_id"]
        other = db.execute(
            "SELECT id, username, display_name, avatar_url, "
            "avatar_crop_x, avatar_crop_y, avatar_zoom, account_type "
            "FROM users WHERE id = ?",
            (other_id,),
        ).fetchone()
        messages = db.execute(
            """SELECT m.id, m.thread_id, m.user_id, m.body, m.created_at,
                      u.username, u.display_name, u.avatar_url,
                      u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                      u.account_type
               FROM direct_messages m
               JOIN users u ON u.id = m.user_id
               WHERE m.thread_id = ?
               ORDER BY m.created_at ASC""",
            (thread_id,),
        ).fetchall()
        return ok(
            {
                "thread": {
                    "id": thread_id,
                    "kind": "direct_message",
                    "other": dict(other) if other else None,
                },
                "messages": [dict(r) for r in messages],
            },
            resource="direct_thread",
        )
    finally:
        db.close()


@router.post("/direct-threads/{thread_id}/messages", status_code=201)
def post_direct_message(thread_id: int, body: dict,
                        user=Depends(get_current_user)):
    """Send a DM. Notifies the other party so it lands in their
    Activity tab (DMs are social, not business)."""
    import datetime as _dt
    from fastapi import HTTPException
    from services.notifications import create_notification

    text = (body or {}).get("body", "").strip()
    if not text:
        raise HTTPException(400, "body is required")
    if len(text) > 2000:
        raise HTTPException(400, "body too long (max 2000 chars)")

    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = db.execute(
            "INSERT INTO direct_messages (thread_id, user_id, body, created_at) "
            "VALUES (?, ?, ?, ?)",
            (thread_id, user["id"], text, now),
        )
        mid = cur.lastrowid
        db.execute(
            "UPDATE direct_threads SET updated_at = ? WHERE id = ?",
            (now, thread_id),
        )

        # Notify the other party. DMs fire `direct_message` type —
        # frontend categorization (notificationCategory) keeps these
        # in the Activity tab since they're personal, not business.
        other_id = row["user_b_id"] if row["user_a_id"] == user["id"] else row["user_a_id"]
        snippet = text if len(text) <= 60 else text[:57] + "…"
        create_notification(
            db,
            other_id,
            "direct_message",
            user["id"],
            direct_thread_id=thread_id,
            subject=snippet,
        )
        db.commit()

        msg = db.execute(
            """SELECT m.id, m.thread_id, m.user_id, m.body, m.created_at,
                      u.username, u.display_name, u.avatar_url,
                      u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                      u.account_type
               FROM direct_messages m JOIN users u ON u.id = m.user_id
               WHERE m.id = ?""",
            (mid,),
        ).fetchone()
        return ok(dict(msg), resource="direct_messages")
    finally:
        db.close()


@router.post("/direct-threads/{thread_id}/read")
def mark_direct_thread_read(thread_id: int, user=Depends(get_current_user)):
    """Stamp the current party's last_read_at on the thread."""
    import datetime as _dt
    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        col = "user_a_last_read_at" if row["user_a_id"] == user["id"] else "user_b_last_read_at"
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            f"UPDATE direct_threads SET {col} = ? WHERE id = ?",
            (now, thread_id),
        )
        db.commit()
        return ok({"id": thread_id, "last_read_at": now},
                  resource="direct_threads")
    finally:
        db.close()


@router.post("/wholesale-inquiries/{inquiry_id}/respond")
def respond_to_inquiry(inquiry_id: int, body: dict,
                       user=Depends(get_current_user)):
    """Roaster-side status change. body.status ∈ {'responded','archived'}.
    Only the inquiry's roaster can transition state; the café side uses the
    generic PUT to edit note/product_id before the roaster acts.
    """
    from fastapi import HTTPException
    if not user or user.get("account_type") != "roaster":
        raise HTTPException(403, "Roasters only")

    new_status = (body or {}).get("status")
    if new_status not in ("responded", "archived", "open"):
        raise HTTPException(400, "status must be open, responded, or archived")

    db = get_db()
    try:
        row = db.execute(
            "SELECT id, roaster_slug FROM wholesale_inquiries WHERE id = ?",
            (inquiry_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Inquiry not found")
        if row["roaster_slug"] != user.get("roaster_slug"):
            raise HTTPException(403, "Not your inquiry to respond to")

        import datetime as _dt
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            "UPDATE wholesale_inquiries SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, inquiry_id),
        )
        db.commit()
        return ok({"id": inquiry_id, "status": new_status, "updated_at": now},
                  resource="wholesale_inquiries")
    finally:
        db.close()


# ── Recycle bin / trash ─────────────────────────────────────────────────────
# Every hard delete across the registry funnels through
# `services/trash.py`. These endpoints surface the bin to the user:
# list what they've deleted, restore an entry, or purge it forever.

@router.get("/trash")
def list_trash(user=Depends(get_current_user)):
    from services import trash as _trash
    db = get_db()
    try:
        return ok(_trash.list_for_user(db, user["id"]), resource="trash")
    finally:
        db.close()


@router.post("/trash/{trash_id}/restore")
def restore_trash(trash_id: int, user=Depends(get_current_user)):
    from services import trash as _trash
    db = get_db()
    try:
        return ok(_trash.restore(db, trash_id, current_user=user), resource="trash")
    finally:
        db.close()


@router.delete("/trash/{trash_id}")
def purge_trash(trash_id: int, user=Depends(get_current_user)):
    from services import trash as _trash
    db = get_db()
    try:
        return ok(_trash.purge(db, trash_id, current_user=user), resource="trash")
    finally:
        db.close()


@router.delete("/trash")
def empty_trash(user=Depends(get_current_user)):
    from services import trash as _trash
    db = get_db()
    try:
        return ok(_trash.purge_all(db, current_user=user), resource="trash")
    finally:
        db.close()
