"""
Specific routes that must be registered BEFORE the catch-all resource routes.

These have fixed paths that would otherwise be shadowed by /{resource}/{id}.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from database import get_db
from resources.crud import list_resource, build_select, row_to_dict, resolve_embeds
from resources.registry import get_resource
from resources.envelope import ok
from services.auth import get_current_user, get_optional_user
from services.admin_stats import compute_traction

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
def followers_list(slug: str, authorization: str = Header(None)):
    db = get_db()
    try:
        count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
        # `u.id AS user_id` is load-bearing: the Crema client builds
        # the follow-toggle slug as `user_{user_id}` for user follows.
        # Without this, clients fell back to `user_undefined` and a
        # single follow mutated the state of every user-row at once.
        rows = db.execute(
            "SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, u.location, u.account_type, u.roaster_slug "
            "FROM follows f JOIN users u ON f.follower_user_id = u.id WHERE f.roaster_slug = ?",
            (slug,),
        ).fetchall()
        # `viewer_following` lets the consumer roaster page render the
        # "Follow / Following" CTA without a second `/follow-status/{slug}`
        # round-trip. Anonymous viewers always read false; the legacy
        # endpoint stays in place for callers that haven't migrated.
        viewer = get_optional_user(authorization)
        viewer_following = False
        if viewer:
            row = db.execute(
                "SELECT id FROM follows WHERE follower_user_id = ? AND roaster_slug = ?",
                (viewer["id"], slug),
            ).fetchone()
            viewer_following = bool(row)
        return ok({
            "follower_count": count,
            "followers": [dict(r) for r in rows],
            "viewer_following": viewer_following,
        }, resource="follows")
    finally:
        db.close()


@router.get("/my-recent-clicks")
def my_recent_clicks(limit: int = 12, user=Depends(get_current_user)):
    """Return the current user's most-recently-clicked products,
    deduplicated by product_id (most-recent click wins). Used by
    the composer's Tag-a-coffee slider's "Recent coffees" rail.

    `click_events` is `write_only: True` in the registry — clients
    can POST clicks but cannot LIST them. This endpoint is the
    /me-scoped read path, returning only the current user's own
    click history so private click data isn't exposed across users.
    """
    db = get_db()
    try:
        rows = db.execute(
            "SELECT product_id, MAX(clicked_at) AS last_clicked "
            "FROM click_events "
            "WHERE user_id = ? AND product_id IS NOT NULL "
            "GROUP BY product_id "
            "ORDER BY last_clicked DESC "
            "LIMIT ?",
            (user["id"], int(limit) if limit else 12),
        ).fetchall()
        return ok(
            [{"product_id": r["product_id"], "clicked_at": r["last_clicked"]} for r in rows],
            resource="click_events",
        )
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


# ── Roaster Journal — scraped articles ──────────────────────────────────────
# Articles are written by the article-scraper (services/article_scraper.py)
# and surface in the consumer Discover JOURNAL tab. The feed is public; the
# list endpoint excludes `body_html` so the chronological row payload stays
# small. The reader screen calls `/articles/{id}` for the full HTML body.
# Only published articles from published roasters surface to consumers — an
# unreviewed roaster (`roaster_profiles.published=0`) hides every article
# the scraper found, even if `roaster_articles.published=1`.
#
# These endpoints are kept in specific.py (rather than relying on the
# generic /api/articles auto-route) for two reasons:
#   • The publish gate joins to `roaster_profiles` on `roaster_slug` —
#     the auto-route's WHERE-builder doesn't know about cross-table
#     filters.
#   • The list payload trims `body_html` for size; the auto-route
#     would return `t.*` (~50 KB per row).
# We still pull the SELECT clause from the registry's build_select() so
# every list/read picks up like_count / comment_count / repost_count /
# liked_by_me / hidden_by_me / disliked_by_me + roaster_name +
# roaster_logo_url for free. The registry-driven path is the single
# source of truth for the column shape on a `roaster_articles` row;
# adding a new count or flag on the article resource lights up here
# automatically.

def _article_list_row(row, res):
    """Convert a sqlite3.Row from the article SELECT into the response
    dict. Trims body_html (kept on the row for the reader endpoint
    only) and converts flag/count cells through `row_to_dict` so the
    boolean coercion + JSON parsing matches the rest of the auto-routes.
    """
    item = row_to_dict(row, res)
    item.pop("body_html", None)
    return item


@router.get("/articles")
def list_articles(limit: int = 50, before: Optional[int] = None,
                   roaster_slug: Optional[str] = None,
                   authorization: str = Header(None)):
    """Chronological article feed (newest first) for Discover JOURNAL.
    `before=<id>` paginates — pass the smallest id from the previous page.
    `roaster_slug` is an optional filter (same endpoint backs the
    per-roaster strip if we add one later).

    Excludes `body_html`; the reader screen fetches that via
    `/articles/{id}` only when needed.
    """
    limit = max(1, min(int(limit or 50), 500))
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    res = get_resource("articles")
    select_sql = build_select(res, uid)

    where = ["t.published = 1", "rp.published = 1"]
    args: list = []
    if before is not None:
        where.append("t.id < ?")
        args.append(int(before))
    if roaster_slug:
        where.append("t.roaster_slug = ?")
        args.append(roaster_slug)
    where_sql = " AND ".join(where)

    sql = (
        f"{select_sql}\n"
        "    JOIN roaster_profiles rp ON rp.roaster_slug = t.roaster_slug\n"
        f"    WHERE {where_sql}\n"
        # Sort by published_at when present (the roaster's own date),
        # falling back to scraped_at so articles without a parsed
        # published_at still order sensibly. Tie-break on id DESC.
        "    ORDER BY COALESCE(t.published_at, t.scraped_at) DESC, t.id DESC\n"
        "    LIMIT ?"
    )

    db = get_db()
    try:
        rows = db.execute(sql, (*args, limit)).fetchall()
        items = [_article_list_row(r, res) for r in rows]
        return ok(items, resource="articles",
                  meta={"limit": limit, "count": len(items)})
    finally:
        db.close()


@router.get("/articles/{article_id}")
def get_article(article_id: int, authorization: str = Header(None)):
    """Full article including body_html. Powers the in-app reader.
    404 if the article is unpublished or its roaster is unreviewed —
    consumers shouldn't reach an article that wouldn't appear in the
    feed even with a deep link.
    """
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    res = get_resource("articles")
    select_sql = build_select(res, uid)
    sql = (
        f"{select_sql}\n"
        "    JOIN roaster_profiles rp ON rp.roaster_slug = t.roaster_slug\n"
        "    WHERE t.id = ? AND t.published = 1 AND rp.published = 1"
    )
    db = get_db()
    try:
        row = db.execute(sql, (article_id,)).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Article {article_id} not found")
        return ok(row_to_dict(row, res), resource="articles")
    finally:
        db.close()


@router.get("/roasters/{slug}/articles")
def roaster_articles(slug: str, limit: int = 20,
                      authorization: str = Header(None)):
    """Per-roaster article list — same shape as `/articles?roaster_slug=`
    but with a stable URL the roaster page can call without depending
    on query-arg conventions. No `before` cursor (the per-roaster list
    is small enough to render in one page)."""
    limit = max(1, min(int(limit or 20), 100))
    current_user = get_optional_user(authorization)
    uid = current_user["id"] if current_user else None
    res = get_resource("articles")
    select_sql = build_select(res, uid)
    sql = (
        f"{select_sql}\n"
        "    JOIN roaster_profiles rp ON rp.roaster_slug = t.roaster_slug\n"
        "    WHERE t.roaster_slug = ? AND t.published = 1 AND rp.published = 1\n"
        "    ORDER BY COALESCE(t.published_at, t.scraped_at) DESC, t.id DESC\n"
        "    LIMIT ?"
    )
    db = get_db()
    try:
        rows = db.execute(sql, (slug, limit)).fetchall()
        items = [_article_list_row(r, res) for r in rows]
        return ok(items, resource="articles",
                  meta={"roaster_slug": slug, "count": len(items)})
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
        # reflects the new image.
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
             body.get("image_url"), body.get("product_url"), body.get("description_raw"),
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


@router.put("/roasters/{slug}/products/{product_id}")
def update_roaster_product(slug: str, product_id: int, body: dict,
                            user=Depends(get_current_user)):
    """Roaster-owner UPDATE for an existing bean in their own catalog.
    Matches the POST/DELETE pair on the same path prefix. Frontend's
    `EditableCoffeeCard` (opened via pencil on an owned product) PUTs
    the full card payload here — without this route the tick save
    button silently 404'd via the resource catch-all."""
    from fastapi import HTTPException
    if user.get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")

    # Only accept columns that actually exist on roaster_products.
    # Guards against a stray frontend field nuking the row on insert.
    ALLOWED = {
        "coffee_name", "roast_level", "tasting_notes", "origin", "process",
        "varietal", "altitude_masl", "flavor_notes", "price_inr",
        "weight_grams", "product_url", "image_url", "image_crop_y",
        "bean_type", "description_raw",
    }
    updates = {k: v for k, v in (body or {}).items() if k in ALLOWED}
    if not updates:
        raise HTTPException(400, "No editable fields in body")

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM roaster_products WHERE id = ? AND roaster_slug = ?",
            (product_id, slug),
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Product not found")
        cols = list(updates.keys())
        set_clause = ", ".join(f"{c} = ?" for c in cols)
        params = [updates[c] for c in cols] + [product_id, slug]
        db.execute(
            f"UPDATE roaster_products SET {set_clause} WHERE id = ? AND roaster_slug = ?",
            tuple(params),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM roaster_products WHERE id = ? AND roaster_slug = ?",
            (product_id, slug),
        ).fetchone()
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
        # Coalesce NULL published_at to empty string before the sort —
        # `dict.get(k, default)` returns None when the key exists with
        # None value, and Python 3's `<` blows up on None < None.
        items.sort(key=lambda x: x.get("published_at") or "", reverse=True)
        paginated = items[offset: offset + limit]
        return ok(paginated, resource="posts", total=total, limit=limit, offset=offset)
    finally:
        db.close()



@router.get("/articles/search")
def articles_search(q: str = "", limit: int = 8):
    """Sitewide search across published articles from published
    roasters. Matches title, excerpt, and the JSON-encoded `tags`
    column (a substring match on the JSON-as-string suffices for
    the corpus size — small enough that LIKE is comfortable; if
    tag-search becomes hot, swap in FTS5).

    Off-topic articles (`is_about_coffee=0`, `published=0`) and
    articles from unreviewed roasters (`rp.published=0`) are
    excluded — same gating as the consumer JOURNAL feed.

    No auth — articles are public. Capped at 8 hits like the other
    SearchDropdown sections."""
    q = (q or "").strip()
    if len(q) < 1:
        return ok([], resource="roaster_articles")
    db = get_db()
    try:
        like = f"%{q.lower()}%"
        rows = db.execute(
            """
            SELECT a.id, a.roaster_slug, a.title, a.image_url,
                   a.word_count, a.published_at,
                   rp.name AS roaster_name,
                   rp.logo_url AS roaster_logo_url
              FROM roaster_articles a
              JOIN roaster_profiles rp ON rp.roaster_slug = a.roaster_slug
             WHERE a.published = 1
               AND rp.published = 1
               AND (
                    LOWER(a.title) LIKE ?
                 OR LOWER(a.excerpt) LIKE ?
                 OR LOWER(a.tags) LIKE ?
               )
             ORDER BY
                CASE WHEN LOWER(a.title) LIKE ? THEN 0
                     WHEN LOWER(a.tags)  LIKE ? THEN 1
                     ELSE 2 END,
                COALESCE(a.published_at, a.scraped_at) DESC,
                a.id DESC
             LIMIT ?
            """,
            (like, like, like, like, like,
             max(1, min(50, int(limit)))),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="roaster_articles",
                  total=len(rows))
    finally:
        db.close()


@router.get("/users/search")
def users_search(q: str = "", limit: int = 20):
    """User picker. Matches username or display_name case-insensitively,
    returns only regular user accounts (not roasters). Search is
    intentionally open — usernames are already public (/users/{username}
    pages render unauthenticated)."""
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


# ── Messages inbox (DM-only) ─────────────────────────────────────────────────
#
# The navbar Messages dropdown hits /my-threads which returns the user's
# direct-message threads ordered by most-recent activity.

@router.get("/my-threads")
def my_threads(user=Depends(get_current_user)):
    """Direct-message inbox for the current user. Each row carries a
    `kind: "direct_message"` discriminator (kept for client compatibility
    even though it's the only value)."""
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")

    db = get_db()
    try:
        uid = user["id"]
        results: list[dict] = []

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
            WHERE (dt.user_a_id = ? OR dt.user_b_id = ?)
              -- "Delete chat for me" filter — hide rows where the
              -- caller has stamped their deleted_at AND no newer
              -- activity has happened on the thread since (Gmail
              -- trash semantics: a new message reopens the thread).
              AND NOT (
                  dt.user_a_id = ? AND dt.user_a_deleted_at IS NOT NULL AND
                  (dt.updated_at IS NULL OR dt.updated_at <= dt.user_a_deleted_at)
              )
              AND NOT (
                  dt.user_b_id = ? AND dt.user_b_deleted_at IS NOT NULL AND
                  (dt.updated_at IS NULL OR dt.updated_at <= dt.user_b_deleted_at)
              )
            """,
            # 15 placeholders total: 8 CASE/subquery uses + 1 unread filter
            # + 2 unread scope CASEs + 2 WHERE-party terms + 2 deleted-at
            # filter terms.
            (uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid),
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


# ── Direct message threads ──────────────────────────────────────────────
#
# User ↔ user chat. Canonical pair ordering on the direct_threads row
# keeps uniqueness regardless of who initiated.

def _require_dm_party(db, thread_id: int, user):
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")
    row = db.execute(
        "SELECT id, user_a_id, user_b_id, pinned_message_id "
        "FROM direct_threads WHERE id = ?",
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


@router.post("/direct-threads/with-roaster/{slug}", status_code=201)
def open_direct_thread_with_roaster(slug: str, user=Depends(get_current_user)):
    """Open or re-use a direct thread with a roaster's owning user.
    The consumer roaster page (Discover → roaster slug) needs to DM
    the roaster, but `/direct-threads/with/{username}` resolves only
    by username — and the roaster's owning username isn't surfaced
    on the public roaster_profile fetch. This route resolves
    `roaster_slug → user_id` directly and reuses the same canonical-
    ordering / dedup logic as the username variant."""
    import datetime as _dt
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Authentication required")

    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM users WHERE roaster_slug = ? AND account_type = 'roaster'",
            (slug,),
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Roaster {slug} has no owner account")
        other_id = row["id"]
        if other_id == user["id"]:
            raise HTTPException(400, "You can't message your own roaster")

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


@router.get("/direct-threads/{thread_id}/thread")
def get_direct_thread(thread_id: int, user=Depends(get_current_user)):
    """Return the thread metadata (counterparty info) + message list.

    Filters out messages the calling user has soft-deleted via the
    long-press "Delete for you" action (per-side stamp on
    `direct_messages.deleted_for_user_{a|b}_at`). Surfaces the
    thread's `pinned_message_id` so the client can render the
    pinned-message banner. For replies, joins to the parent message
    and exposes its (id, body, sender display_name) so bubbles can
    render the in-bubble quote header without a second round-trip.
    """
    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        is_a = row["user_a_id"] == user["id"]
        deleted_col = "deleted_for_user_a_at" if is_a else "deleted_for_user_b_at"
        other_id = row["user_b_id"] if is_a else row["user_a_id"]
        other = db.execute(
            "SELECT id, username, display_name, avatar_url, "
            "avatar_crop_x, avatar_crop_y, avatar_zoom, account_type "
            "FROM users WHERE id = ?",
            (other_id,),
        ).fetchone()
        messages = db.execute(
            f"""SELECT m.id, m.thread_id, m.user_id, m.body, m.created_at,
                       m.reply_to_message_id, m.image_url,
                       u.username, u.display_name, u.avatar_url,
                       u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                       u.account_type,
                       p.body AS reply_to_body,
                       p.image_url AS reply_to_image_url,
                       pu.display_name AS reply_to_display_name,
                       pu.username AS reply_to_username
                FROM direct_messages m
                JOIN users u ON u.id = m.user_id
                LEFT JOIN direct_messages p ON p.id = m.reply_to_message_id
                LEFT JOIN users pu ON pu.id = p.user_id
                WHERE m.thread_id = ?
                  AND m.{deleted_col} IS NULL
                ORDER BY m.created_at ASC""",
            (thread_id,),
        ).fetchall()
        # Pinned-message snapshot — same shape as a message row so
        # the banner UI can render it identically without extra
        # joins on the client.
        pinned = None
        pin_id = row["pinned_message_id"] if "pinned_message_id" in row.keys() else None
        if pin_id:
            pinned_row = db.execute(
                """SELECT m.id, m.thread_id, m.user_id, m.body, m.created_at,
                          u.display_name, u.username
                   FROM direct_messages m JOIN users u ON u.id = m.user_id
                   WHERE m.id = ?""",
                (pin_id,),
            ).fetchone()
            if pinned_row:
                pinned = dict(pinned_row)
        return ok(
            {
                "thread": {
                    "id": thread_id,
                    "kind": "direct_message",
                    "other": dict(other) if other else None,
                    "pinned_message": pinned,
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
    reply_to_id = (body or {}).get("reply_to_message_id")
    image_url = (body or {}).get("image_url") or None
    # A message must have body OR image_url. Both is fine (caption +
    # photo); neither is a 400. Image-only messages send body="".
    if not text and not image_url:
        raise HTTPException(400, "body or image_url is required")
    if text and len(text) > 2000:
        raise HTTPException(400, "body too long (max 2000 chars)")

    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        # Validate reply_to_message_id — must belong to this thread.
        # Silently drop if the parent doesn't match (e.g. stale id
        # after a delete) rather than 400ing the send.
        if reply_to_id is not None:
            parent = db.execute(
                "SELECT id FROM direct_messages WHERE id = ? AND thread_id = ?",
                (int(reply_to_id), thread_id),
            ).fetchone()
            if not parent:
                reply_to_id = None
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = db.execute(
            "INSERT INTO direct_messages (thread_id, user_id, body, created_at, reply_to_message_id, image_url) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (thread_id, user["id"], text, now, reply_to_id, image_url),
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
                      m.reply_to_message_id, m.image_url,
                      u.username, u.display_name, u.avatar_url,
                      u.avatar_crop_x, u.avatar_crop_y, u.avatar_zoom,
                      u.account_type,
                      p.body AS reply_to_body,
                      p.image_url AS reply_to_image_url,
                      pu.display_name AS reply_to_display_name,
                      pu.username AS reply_to_username
               FROM direct_messages m
               JOIN users u ON u.id = m.user_id
               LEFT JOIN direct_messages p ON p.id = m.reply_to_message_id
               LEFT JOIN users pu ON pu.id = p.user_id
               WHERE m.id = ?""",
            (mid,),
        ).fetchone()
        return ok(dict(msg), resource="direct_messages")
    finally:
        db.close()


# ── DM long-press actions ──────────────────────────────────────────
# Per-message "Delete for you" / Pin / Report. Long-press menu in
# `<ThreadBody>` calls these.

@router.delete("/direct-messages/{message_id}")
def delete_direct_message_for_me(message_id: int,
                                  user=Depends(get_current_user)):
    """Soft-delete a single DM for the calling user only.

    Mirrors the per-thread delete semantics but at message
    granularity: stamps `deleted_for_user_{a|b}_at` for whichever
    side the caller belongs to. The other party still sees the
    message; the GET /thread endpoint filters by these stamps so the
    deleter never sees it again (one-way for the actor — matches
    WhatsApp "Delete for you").
    """
    import datetime as _dt
    from fastapi import HTTPException
    db = get_db()
    try:
        msg_row = db.execute(
            "SELECT id, thread_id FROM direct_messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if not msg_row:
            raise HTTPException(404, "Message not found")
        thread = _require_dm_party(db, msg_row["thread_id"], user)
        is_a = thread["user_a_id"] == user["id"]
        col = "deleted_for_user_a_at" if is_a else "deleted_for_user_b_at"
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            f"UPDATE direct_messages SET {col} = ? WHERE id = ?",
            (now, message_id),
        )
        db.commit()
        return ok({"id": message_id, "deleted_at": now},
                  resource="direct_messages")
    finally:
        db.close()


@router.post("/direct-threads/{thread_id}/pin")
def pin_direct_message(thread_id: int, body: dict,
                        user=Depends(get_current_user)):
    """Set or clear the thread's pinned message (visible to both
    parties; either side can override). Body: `{message_id: int|null}`.
    Passing null (or omitting message_id) clears the pin.

    The pinned message must belong to this thread; otherwise 400.
    """
    from fastapi import HTTPException
    new_id = (body or {}).get("message_id")
    db = get_db()
    try:
        _require_dm_party(db, thread_id, user)
        if new_id is not None:
            ok_msg = db.execute(
                "SELECT id FROM direct_messages WHERE id = ? AND thread_id = ?",
                (int(new_id), thread_id),
            ).fetchone()
            if not ok_msg:
                raise HTTPException(400, "message does not belong to this thread")
        db.execute(
            "UPDATE direct_threads SET pinned_message_id = ? WHERE id = ?",
            (new_id, thread_id),
        )
        db.commit()
        return ok({"thread_id": thread_id, "pinned_message_id": new_id},
                  resource="direct_threads")
    finally:
        db.close()


@router.post("/direct-message-reports", status_code=201)
def create_direct_message_report(body: dict,
                                  user=Depends(get_current_user)):
    """File a report against a DM. Mirrors `post_reports`: each tap
    creates a fresh row (no UNIQUE), so admins can count repeat
    reports from the same user. The reported message must be one
    the caller can see (i.e. they're a party to its thread).
    """
    import datetime as _dt
    from fastapi import HTTPException
    message_id = (body or {}).get("message_id")
    reason = (body or {}).get("reason") or None
    if message_id is None:
        raise HTTPException(400, "message_id is required")
    db = get_db()
    try:
        msg = db.execute(
            "SELECT id, thread_id FROM direct_messages WHERE id = ?",
            (int(message_id),),
        ).fetchone()
        if not msg:
            raise HTTPException(404, "message not found")
        _require_dm_party(db, msg["thread_id"], user)
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = db.execute(
            "INSERT INTO direct_message_reports "
            "(user_id, message_id, reason, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], int(message_id), reason, now),
        )
        db.commit()
        return ok({"id": cur.lastrowid, "message_id": int(message_id),
                   "reason": reason, "created_at": now},
                  resource="direct_message_reports")
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


@router.delete("/direct-threads/{thread_id}")
def delete_direct_thread_for_me(thread_id: int, user=Depends(get_current_user)):
    """Hide the thread from the current party's inbox.

    Stamps `user_{a|b}_deleted_at` for the calling user. The other party
    still sees the conversation; if they send a new message later, the
    thread's `updated_at` advances past the stamp and the thread
    reappears in this user's inbox (Gmail-trash + WhatsApp "Delete
    chat" hybrid). The `/my-threads` listing applies the filter so
    the thread stops appearing without touching `direct_messages`.

    Read state is cleared as well — when/if the thread reappears, any
    new messages from the other party should be marked unread again.
    """
    import datetime as _dt
    db = get_db()
    try:
        row = _require_dm_party(db, thread_id, user)
        is_a = row["user_a_id"] == user["id"]
        deleted_col = "user_a_deleted_at" if is_a else "user_b_deleted_at"
        read_col = "user_a_last_read_at" if is_a else "user_b_last_read_at"
        now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            f"UPDATE direct_threads SET {deleted_col} = ?, {read_col} = ? WHERE id = ?",
            (now, now, thread_id),
        )
        db.commit()
        return ok({"id": thread_id, "deleted_at": now},
                  resource="direct_threads")
    finally:
        db.close()


# ── Business analytics (roaster / café owners only) ─────────────────────────
# The counterpart to /stats/traction — but per-business, only the
# slug's owner can read it. Admin override intentional: the seeded
# "crema" account can read any business's dashboard, same shape as
# the traction dashboard read permission.

def _require_business_owner(user, *, kind: str, slug: str):
    """Owner or admin gate. `kind` must be 'roaster'."""
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Sign in required")
    is_admin = user.get("is_admin") == 1 and user.get("username") == "crema"
    owned = (user.get("account_type") == kind and user.get("roaster_slug") == slug)
    if not (owned or is_admin):
        raise HTTPException(403, f"Not the owner of this {kind}")


@router.get("/stats/business/roaster/{slug}")
def business_stats_roaster(slug: str, user=Depends(get_current_user)):
    _require_business_owner(user, kind="roaster", slug=slug)
    from services.business_stats import compute_roaster_business
    db = get_db()
    try:
        return ok(compute_roaster_business(db, slug), resource="business_stats")
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


# ── Catalog Ops admin endpoints (v0, local-only) ────────────────────────────
# These wrap two pieces of catalog infrastructure that already exist as
# standalone Python modules:
#   * The `Scraper/` directory — a multi-platform Shopify/WooCommerce/HTML
#     scraper with quality gates.
#   * `tag_resolver_test.py` (lifted into `services/sca_geolocator.py`) —
#     a Haiku-backed flavor-note → SCA-tree classifier.
# Each endpoint is gated through `_require_admin()` (defined above for the
# traction dashboard). Long-running work fans out to FastAPI
# `BackgroundTasks` so the request returns immediately with a job id;
# the admin tab polls `/api/jobs/{id}` (registry CRUD) for progress.
# Prod hardening (worker queue, restart safety, log persistence) is parked
# in LAUNCH_TODO §3.8.

from fastapi import BackgroundTasks, UploadFile, File, Form
from services import catalog_ops, sca_geolocator, scrape_runner, sync_runner


def _job_to_response(db, job_id: int) -> dict:
    """Return the same shape the frontend gets when polling
    `/api/jobs/{id}` so the run-trigger response and the polling response
    are interchangeable."""
    row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return {"id": job_id, "status": "queued"}
    out = dict(row)
    if out.get("result_summary"):
        try:
            out["result_summary"] = json.loads(out["result_summary"])
        except (json.JSONDecodeError, TypeError):
            pass
    return out


@router.post("/admin/scrape/run", status_code=202)
def admin_scrape_run(body: dict = None, background_tasks: BackgroundTasks = None,
                      user=Depends(get_current_user)):
    """Enqueue a scrape job and immediately return its id. The runner
    fires off the scraper subprocess in the background; the admin tab
    polls `/api/jobs/{id}` until status leaves 'running'.

    Body:
      `roaster_slug` (optional): scope to a single roaster's source —
        what the per-roaster Coffees-section CTA sends. When omitted,
        every scrapable `roaster_sources` row gets crawled (every
        row with `shop_url + platform` set; the `enabled` flag is
        no longer consulted — it has no UI to flip and was retired
        alongside the admin Enabled pill).
      `regenerate_prompt` (optional, default false): force regeneration
        of the per-roaster site prompt addendum after the run
        completes. Only meaningful when `roaster_slug` is set —
        bulk runs skip the meta-call entirely. The toggle on the
        roaster page sets this to true for one run, then auto-clears.
    """
    _require_admin(user)
    body = body or {}
    roaster_slug = (body.get("roaster_slug") or "").strip() or None
    regenerate_prompt = bool(body.get("regenerate_prompt"))
    db = get_db()
    try:
        try:
            job_id = catalog_ops.enqueue_job(db, "scrape", started_by=user["id"])
        except catalog_ops.JobConflict as e:
            from fastapi import HTTPException
            raise HTTPException(409, str(e), headers={"X-Live-Job-Id": str(e.live_job_id)})
        background_tasks.add_task(
            catalog_ops.run_scrape_job, job_id,
            roaster_slug=roaster_slug,
            regenerate_prompt=regenerate_prompt,
        )
        return ok(_job_to_response(db, job_id), resource="jobs")
    finally:
        db.close()


@router.post("/admin/scrape/sources", status_code=201)
def admin_add_roaster_source(body: dict, user=Depends(get_current_user)):
    """Add a new roaster source. The admin types (or pastes) a website
    URL; we do a best-effort `<title>` fetch to pre-fill the `name`
    column. Platform / city / state stay null until the admin edits."""
    _require_admin(user)
    website = (body or {}).get("website", "").strip()
    if not website:
        from fastapi import HTTPException
        raise HTTPException(422, "website is required")
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    name = (body or {}).get("name", "").strip()
    if not name:
        name = scrape_runner.fetch_roaster_title(website) or website
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM roaster_sources WHERE website = ?", (website,)
        ).fetchone()
        if existing:
            from fastapi import HTTPException
            raise HTTPException(409, "A source with this website already exists.")
        cur = db.execute(
            "INSERT INTO roaster_sources "
            "(name, website, shop_url, platform, city, state, enabled, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
            (
                name, website,
                (body or {}).get("shop_url"),
                (body or {}).get("platform"),
                (body or {}).get("city"),
                (body or {}).get("state"),
                _now_iso(),
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM roaster_sources WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return ok(dict(row), resource="roaster_sources")
    finally:
        db.close()


def _now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Catalog Ops v2 — Sync endpoints (Tab 1 onboarding + Tab 2 refresh) ──
#
# Crawl the roaster's website, write a CrawlSnapshot, stage agent
# work bundles. The actual Sonnet bio / Haiku product / Haiku article
# agent invocations are orchestrated separately (Claude session for
# now, scheduled routine eventually) so the endpoints are synchronous
# and bounded — no background_tasks needed.


@router.post("/admin/sync/{slug}", status_code=200)
def admin_sync(slug: str, body: dict = None,
                user=Depends(get_current_user)):
    """Run a sync for one roaster. Two modes:

      `tab1` (default for new/re-baseline) — full crawl, stage every
                                             entity as pending.
      `tab2` (default for steady-state)    — diff vs last snapshot,
                                             stage only changes.

    The crawl + snapshot itself is synchronous (~5-20s typical).
    Returns the summary dict — counts of bio/product/article pending
    bundles. The agent enrichment is a separate orchestrator step.
    """
    _require_admin(user)
    body = body or {}
    mode = (body.get("mode") or "tab1").strip().lower()
    if mode not in ("tab1", "tab2"):
        from fastapi import HTTPException
        raise HTTPException(400, "mode must be 'tab1' or 'tab2'")
    if mode == "tab1":
        summary = sync_runner.run_tab1_sync(slug)
    else:
        summary = sync_runner.run_tab2_sync(slug)
    if not summary.get("ok"):
        from fastapi import HTTPException
        raise HTTPException(400, summary.get("error", "sync failed"))
    return ok(summary, resource="sync")


@router.get("/admin/sync/{slug}/pending")
def admin_sync_pending(slug: str, user=Depends(get_current_user)):
    """List the pending agent bundles for a roaster. Returns
    `{bio: [filenames], product: [...], article: [...]}` so the
    orchestrator (or a future routine) knows what to enrich."""
    _require_admin(user)
    pending = sync_runner.get_pending(slug)
    return ok(pending, resource="sync_pending")


@router.get("/admin/sync/{slug}/snapshot")
def admin_sync_snapshot(slug: str, user=Depends(get_current_user)):
    """Return the current snapshot for a roaster + diff vs prev (if
    prev exists) + a breakdown of storefront vs in-catalog counts.

    The breakdown distinguishes:
      - storefront: total items the crawl saw on the website
      - in_catalog: items we already have as enriched rows (products
        table for coffees, roaster_articles for journals)
      - unknown: storefront - in_catalog; rows we'd evaluate via Haiku
        on the next enrichment pass
    That breakdown is what makes "135 products on the storefront" useful
    in the UI — it tells the admin that only 3 are actual beans and the
    other 132 are merch / gear / gift cards the catalog already ignores.
    """
    _require_admin(user)
    from services.sync_runner import _snapshot_get, _diff
    db = get_db()
    try:
        cur = _snapshot_get(db, slug, "current")
        prev = _snapshot_get(db, slug, "prev")
        if not cur:
            return ok({
                "slug": slug, "snapshot": None,
                "diff": None, "breakdown": None,
            }, resource="sync_snapshot")

        payload = cur["payload"]
        storefront_products = payload.get("products", []) or []
        storefront_articles = payload.get("articles", []) or []

        # Coffee breakdown — JOIN the snapshot product URLs/handles
        # against our `products` table. Snapshot product entries carry
        # `url` (always) and `handle` (Shopify). We match on URL first,
        # fall back to handle.
        product_urls = [p.get("url") for p in storefront_products if p.get("url")]
        in_catalog_product_urls: set[str] = set()
        if product_urls:
            placeholders = ",".join("?" for _ in product_urls)
            rows = db.execute(
                f"SELECT product_url FROM products "
                f"WHERE roaster_slug = ? AND product_url IN ({placeholders})",
                (slug, *product_urls),
            ).fetchall()
            in_catalog_product_urls = {r["product_url"] for r in rows}
        in_catalog_products = len(in_catalog_product_urls)
        storefront_products_total = len(storefront_products)
        unknown_products = max(0, storefront_products_total - in_catalog_products)

        # Journal breakdown — same shape against roaster_articles.url.
        article_urls = [a.get("url") for a in storefront_articles if a.get("url")]
        in_catalog_article_urls: set[str] = set()
        if article_urls:
            placeholders = ",".join("?" for _ in article_urls)
            rows = db.execute(
                f"SELECT url FROM roaster_articles "
                f"WHERE roaster_slug = ? AND url IN ({placeholders})",
                (slug, *article_urls),
            ).fetchall()
            in_catalog_article_urls = {r["url"] for r in rows}
        in_catalog_articles = len(in_catalog_article_urls)
        storefront_articles_total = len(storefront_articles)
        unknown_articles = max(0, storefront_articles_total - in_catalog_articles)

        return ok({
            "slug": slug,
            "snapshot": {
                "taken_at": cur["taken_at"],
                "summary": {
                    "platform":       payload.get("platform"),
                    "bio_len":        payload.get("bio", {}).get("len"),
                    "products_count": storefront_products_total,
                    "articles_count": storefront_articles_total,
                },
            },
            "breakdown": {
                "products": {
                    "storefront": storefront_products_total,
                    "in_catalog": in_catalog_products,
                    "unknown":    unknown_products,
                },
                "articles": {
                    "storefront": storefront_articles_total,
                    "in_catalog": in_catalog_articles,
                    "unknown":    unknown_articles,
                },
            },
            "diff": _diff(payload, prev["payload"] if prev else None),
        }, resource="sync_snapshot")
    finally:
        db.close()


@router.get("/admin/sync/all-status")
def admin_sync_all_status(user=Depends(get_current_user)):
    """Orchestrator dashboard payload: one row per published roaster with
    current snapshot age + diff counts vs prev snapshot. Single round-
    trip so the REFRESH CATALOG tab can render the whole roster with
    diff status without N per-roaster calls.

    Returns:
      { roasters: [
          { slug, name, city, state, platform,
            has_snapshot, last_sync, bio_chars,
            bio_changed,
            products_added, products_updated, products_removed,
            articles_added, articles_updated, articles_removed,
            article_hint_present },
          ...
      ] }
    """
    _require_admin(user)
    from services.sync_runner import _snapshot_get, _diff
    db = get_db()
    try:
        # Pull every published roaster + its source row in one go.
        rows = db.execute(
            "SELECT rp.roaster_slug, rp.name, rp.city, rp.state, "
            "       rp.article_enrichment_prompt_hint, "
            "       rs.platform "
            "FROM roaster_profiles rp "
            "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
            "WHERE rp.published = 1"
        ).fetchall()
        out = []
        for r in rows:
            slug = r["roaster_slug"]
            cur = _snapshot_get(db, slug, "current")
            prev = _snapshot_get(db, slug, "prev")
            entry = {
                "slug": slug,
                "name": r["name"],
                "city": r["city"],
                "state": r["state"],
                "platform": r["platform"],
                "article_hint_present": bool(r["article_enrichment_prompt_hint"]),
                "has_snapshot": cur is not None,
                "last_sync": cur["taken_at"] if cur else None,
                "bio_chars": 0,
                "bio_changed": False,
                "products_added": 0, "products_updated": 0, "products_removed": 0,
                "articles_added": 0, "articles_updated": 0, "articles_removed": 0,
            }
            if cur:
                payload = cur["payload"]
                entry["bio_chars"] = (payload.get("bio") or {}).get("len", 0)
                diff = _diff(payload, prev["payload"] if prev else None)
                entry["bio_changed"] = bool(diff.get("bio_changed"))
                entry["products_added"] = len(diff["products"]["added"])
                entry["products_updated"] = len(diff["products"]["updated"])
                entry["products_removed"] = len(diff["products"]["removed"])
                entry["articles_added"] = len(diff["articles"]["added"])
                entry["articles_updated"] = len(diff["articles"]["updated"])
                entry["articles_removed"] = len(diff["articles"]["removed"])
            out.append(entry)
        return ok({"roasters": out}, resource="sync_status")
    finally:
        db.close()


@router.post("/admin/sync-bulk", status_code=202)
def admin_sync_bulk(body: dict,
                     background_tasks: BackgroundTasks = None,
                     user=Depends(get_current_user)):
    """Bulk Tab-2 sync orchestrator. Body: { slugs: [...] }. For each
    slug, kicks off a background task that runs run_tab2_sync. Returns
    immediately with the list of slugs accepted. The caller polls
    GET /admin/sync/all-status to see diffs land."""
    _require_admin(user)
    body = body or {}
    slugs = body.get("slugs") or []
    if not isinstance(slugs, list) or not slugs:
        from fastapi import HTTPException
        raise HTTPException(422, "slugs[] is required")
    mode = (body.get("mode") or "tab2").strip().lower()
    if mode not in ("tab1", "tab2"):
        from fastapi import HTTPException
        raise HTTPException(400, "mode must be 'tab1' or 'tab2'")

    def _run(slug: str, m: str):
        try:
            if m == "tab1":
                sync_runner.run_tab1_sync(slug)
            else:
                sync_runner.run_tab2_sync(slug)
        except Exception:
            # Per-roaster failures don't poison the batch — the
            # orchestrator polls all-status to see what landed.
            pass

    for slug in slugs:
        background_tasks.add_task(_run, slug, mode)
    return ok({"accepted": len(slugs), "mode": mode, "slugs": slugs},
              resource="sync_bulk")


@router.post("/admin/roasters/refresh-all-bulk", status_code=202)
def admin_refresh_all_bulk(body: dict,
                            background_tasks: BackgroundTasks = None,
                            user=Depends(get_current_user)):
    """Bulk orchestrator wrapper around per-roaster refresh-all. For
    each slug, kicks off the SAME pipeline as POST /admin/roasters/
    {slug}/refresh-all — bio Sonnet enrich (synchronous per-slug) +
    catalog scrape job (background) + article scrape job (background).
    Returns immediately with the list of slugs accepted; the caller
    polls /api/jobs or /api/admin/sync/all-status for completion.

    Body:
      • slugs: list of roaster slugs to refresh (required)
      • regenerate_prompt: forwarded per-slug to refresh-all
      • regenerate_article_hint: forwarded per-slug to refresh-all

    Per-slug failures (no website, no shop_url, missing platform, etc.)
    don't poison the batch — they're swallowed and surfaced via the
    polled status endpoints. The agent-orchestrator's job is to look
    at the result, not to bubble exceptions through a sync HTTP call.
    """
    _require_admin(user)
    body = body or {}
    slugs = body.get("slugs") or []
    if not isinstance(slugs, list) or not slugs:
        from fastapi import HTTPException
        raise HTTPException(422, "slugs[] is required")
    regenerate_prompt = bool(body.get("regenerate_prompt"))
    regenerate_article_hint = bool(body.get("regenerate_article_hint"))

    # Use the new mutex-free orchestrator for every slug — each one
    # gets its own background task driving bio → per-roaster catalog
    # scrape (isolated workspace) → per-roaster article scrape. No
    # JobConflict possible; scrapes run concurrently.
    for slug in slugs:
        background_tasks.add_task(
            _orchestrate_refresh_all,
            slug=slug,
            regenerate_prompt=regenerate_prompt,
            regenerate_article_hint=regenerate_article_hint,
            user_id=user["id"],
        )
    return ok(
        {"accepted": len(slugs), "slugs": slugs,
         "regenerate_prompt": regenerate_prompt,
         "regenerate_article_hint": regenerate_article_hint},
        resource="refresh_all_bulk",
    )


# ── Sweep Activity dashboard ────────────────────────────────────────────────
# Retrospective + live view of recent roaster-refresh runs. Fuels the
# SWEEP ACTIVITY admin sub-tab so the operator can wake up tomorrow
# and understand what happened overnight without flipping through 96
# per-roaster pages.
#
# Read-only aggregate over five tables: `jobs`, `agent_runs`,
# `llm_jobs`, `scrape_proposals`, `roaster_profiles`. Each table is
# scanned in a single SQL pass and aggregated in Python so the whole
# endpoint completes in <500ms even with months of history.
#
# Time scope: rows with started_at/created_at >= `since` (default
# "now − 24h"). The default reflects the overnight-sweep operator
# pattern; pass an explicit ISO `since=` to widen or narrow.
#
# What "auto-approved" means: per the task spec, this is left at 0
# for now — the actual auto-approve runner identity wiring will land
# separately. Once a proposal carries the runner identity that wrote
# `applied_at` we'll bucket those out of the manual approvals.

@router.get("/admin/sweep-summary")
def admin_sweep_summary(since: Optional[str] = None,
                          user=Depends(get_current_user)):
    """Aggregate dashboard payload for the SWEEP ACTIVITY admin tab.

    Query params:
      • since (optional, ISO 8601) — time floor. Defaults to "now − 24h".

    Returns:
      {
        "since": iso,
        "now": iso,
        "totals": {
          "roasters_processed": int,
          "bios_refreshed": int,
          "products_enriched": int,
          "articles_enriched": int,
          "proposals_auto_approved": int,
          "proposals_held_for_review": int,
          "proposals_auto_rejected": int,
          "llm_calls": int,
          "run_time_seconds": float,
          "runs_in_flight": int,
        },
        "roasters": [
          {
            "slug": str,
            "name": str | null,
            "logo_url": str | null,
            "last_activity_at": iso,
            "status": "running" | "succeeded" | "failed" | "partial",
            "products_new": int,
            "products_updated": int,
            "products_missing_to_sold_out": int,
            "proposals_auto_approved": int,
            "proposals_held": int,
            "proposals_rejected": int,
            "llm_jobs": int,
            "errors_count": int,
            "first_error": str | null,
          },
          ...sorted by last_activity_at DESC
        ],
        "recent_failures": [
          { "slug": str | null, "message": str, "kind": str,
            "job_id": int, "at": iso },
          ...top 10
        ],
      }
    """
    _require_admin(user)

    import datetime as _dt
    now_dt = _dt.datetime.now(_dt.timezone.utc)
    if since:
        try:
            # Tolerate trailing Z + naive ISO. Treat naive as UTC.
            since_str = since.strip()
            if since_str.endswith("Z"):
                since_str = since_str[:-1] + "+00:00"
            since_dt = _dt.datetime.fromisoformat(since_str)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=_dt.timezone.utc)
        except (ValueError, TypeError):
            raise HTTPException(422, f"invalid since (ISO 8601 required): {since!r}")
    else:
        since_dt = now_dt - _dt.timedelta(hours=24)
    # SQLite stores ISO strings; format both as Z-suffixed UTC to match
    # the canonical `_now()` helper used by the rest of the codebase.
    since_iso = since_dt.astimezone(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
    now_iso = now_dt.isoformat().replace("+00:00", "Z")

    db = get_db()
    try:
        # ── Pull every published roaster's identity row in one query.
        # We need (slug, name, logo_url, hero_image_url) so the per-row
        # frontend can render via RoasterLogo. roaster_sources gives us
        # the website→slug map for `roaster_enrich` jobs (which carry
        # the website in result_summary, not the slug).
        roaster_rows = db.execute(
            "SELECT roaster_slug, name, logo_url, hero_image_url, website "
            "FROM roaster_profiles"
        ).fetchall()
        roaster_by_slug: dict = {}
        slug_by_website: dict = {}
        for r in roaster_rows:
            slug = r["roaster_slug"]
            roaster_by_slug[slug] = {
                "slug": slug,
                "name": r["name"],
                "logo_url": r["logo_url"] or r["hero_image_url"],
            }
            if r["website"]:
                slug_by_website[r["website"]] = slug

        def _empty_row(slug: str) -> dict:
            base = roaster_by_slug.get(slug)
            return {
                "slug": slug,
                "name": base["name"] if base else None,
                "logo_url": base["logo_url"] if base else None,
                "last_activity_at": None,
                "status": "succeeded",
                "products_new": 0,
                "products_updated": 0,
                "products_missing_to_sold_out": 0,
                "proposals_auto_approved": 0,
                "proposals_held": 0,
                "proposals_rejected": 0,
                "llm_jobs": 0,
                "errors_count": 0,
                "first_error": None,
                "bio_refreshed": False,
                "articles_enriched": 0,
                "products_enriched": 0,
            }

        per_roaster: dict = {}

        def _get_row(slug):
            if not slug:
                return None
            if slug not in per_roaster:
                per_roaster[slug] = _empty_row(slug)
            return per_roaster[slug]

        def _bump_last_activity(row, ts):
            if not ts:
                return
            cur = row.get("last_activity_at")
            if cur is None or ts > cur:
                row["last_activity_at"] = ts

        # ── Pass 1: jobs of kind scrape / article_scrape / roaster_enrich
        # since the window. The slug-of-record is one of:
        #   • For `roaster_enrich`: result_summary.slug (preferred) or
        #     website→slug (fallback).
        #   • For `scrape` / `article_scrape`: scope is per-slug when the
        #     job was kicked from a per-roaster CTA; for bulk runs the
        #     proposals + llm_jobs aggregation (passes 3+4 below) carry
        #     the per-roaster breakdown. For the top-level totals we
        #     still count the per-job wall time + status.
        # The result_summary JSON may include {slug, ...}; if not we
        # fall back to scanning current_target (display name) — but
        # current_target gets cleared on finish, so it's only useful
        # for live rows.
        runs_in_flight = 0
        total_run_seconds = 0.0
        recent_failures: list = []
        bios_refreshed = 0

        REFRESH_KINDS = ("scrape", "article_scrape", "roaster_enrich")
        placeholders = ",".join(["?"] * len(REFRESH_KINDS))
        job_rows = db.execute(
            f"SELECT id, kind, status, started_at, finished_at, created_at, "
            f"       result_summary, error_message, current_target "
            f"FROM jobs "
            f"WHERE kind IN ({placeholders}) "
            f"  AND COALESCE(started_at, created_at) >= ? "
            f"ORDER BY id DESC",
            tuple(list(REFRESH_KINDS) + [since_iso]),
        ).fetchall()

        for j in job_rows:
            status = j["status"]
            kind = j["kind"]
            started = j["started_at"] or j["created_at"]
            finished = j["finished_at"]
            summary_obj: dict = {}
            if j["result_summary"]:
                try:
                    summary_obj = json.loads(j["result_summary"]) or {}
                except (json.JSONDecodeError, TypeError):
                    summary_obj = {}

            # Aggregate the wall-time only for finished runs so a
            # never-finishing job doesn't skew the totals.
            if finished and started:
                try:
                    s_dt = _dt.datetime.fromisoformat(started.replace("Z", "+00:00"))
                    f_dt = _dt.datetime.fromisoformat(finished.replace("Z", "+00:00"))
                    total_run_seconds += max(0.0, (f_dt - s_dt).total_seconds())
                except (ValueError, TypeError):
                    pass

            if status in ("queued", "running"):
                runs_in_flight += 1

            # Resolve a slug-of-record where possible.
            slug = None
            sum_slug = summary_obj.get("slug") if isinstance(summary_obj, dict) else None
            sum_website = summary_obj.get("website") if isinstance(summary_obj, dict) else None
            if sum_slug:
                slug = sum_slug
            elif sum_website and sum_website in slug_by_website:
                slug = slug_by_website[sum_website]
            elif j["current_target"]:
                # Live banner label — may be the display name. Try to
                # resolve via case-insensitive name lookup.
                ct = j["current_target"]
                if ct in roaster_by_slug:
                    slug = ct
                else:
                    lower = ct.lower()
                    for s, info in roaster_by_slug.items():
                        if (info.get("name") or "").lower() == lower:
                            slug = s
                            break

            if slug:
                row = _get_row(slug)
                if row is None:
                    continue
                _bump_last_activity(row, finished or started)
                # Job-level status promotion: a roaster row's status is
                # the worst status seen across its jobs in the window.
                # Order: running > failed > partial > succeeded.
                if status in ("queued", "running"):
                    row["status"] = "running"
                elif status == "failed":
                    if row["status"] != "running":
                        row["status"] = "failed"
                elif status == "succeeded":
                    # Partial = succeeded but with errors[] / enrich
                    # failures inside result_summary.
                    has_errs = isinstance(summary_obj.get("errors"), list) and len(summary_obj["errors"]) > 0
                    enr_fail = summary_obj.get("enrichment_failures", 0) or summary_obj.get("enrich_failed", 0) or 0
                    if (has_errs or enr_fail > 0) and row["status"] not in ("running", "failed"):
                        row["status"] = "partial"

                # Pull common shape from scrape summaries.
                if kind == "scrape":
                    row["products_new"] += int(summary_obj.get("new_products_total") or 0)
                    row["products_updated"] += int(summary_obj.get("updated_total") or 0)
                    row["products_missing_to_sold_out"] += int(summary_obj.get("missing_total") or 0)
                elif kind == "article_scrape":
                    row["articles_enriched"] += int(summary_obj.get("enriched") or 0)
                elif kind == "roaster_enrich":
                    # Bio refresh = the enrich phase ran successfully (or
                    # is running). One per slug per refresh window.
                    if status != "failed":
                        row["bio_refreshed"] = True
                        bios_refreshed += 1

                # Capture per-roaster error context.
                if j["error_message"]:
                    row["errors_count"] += 1
                    if row["first_error"] is None:
                        row["first_error"] = j["error_message"]
                # Summary-embedded errors (per-article failures inside an
                # otherwise-succeeded run).
                sum_errs = summary_obj.get("errors") if isinstance(summary_obj, dict) else None
                if isinstance(sum_errs, list):
                    row["errors_count"] += len(sum_errs)
                    if row["first_error"] is None and sum_errs:
                        first = sum_errs[0]
                        if isinstance(first, dict):
                            row["first_error"] = first.get("message") or first.get("error")
                        elif isinstance(first, str):
                            row["first_error"] = first

            # Recent-failures list — top N by recency. Keep both the
            # job-level error_message and per-row summary errors.
            if j["error_message"]:
                recent_failures.append({
                    "slug": slug,
                    "message": j["error_message"],
                    "kind": kind,
                    "job_id": j["id"],
                    "at": finished or started,
                })
            sum_errs = summary_obj.get("errors") if isinstance(summary_obj, dict) else None
            if isinstance(sum_errs, list):
                for err in sum_errs[:5]:  # cap per-job spam
                    msg = None
                    err_slug = slug
                    if isinstance(err, dict):
                        msg = err.get("message") or err.get("error")
                        err_slug = err.get("slug") or slug
                    elif isinstance(err, str):
                        msg = err
                    if msg:
                        recent_failures.append({
                            "slug": err_slug,
                            "message": msg,
                            "kind": kind,
                            "job_id": j["id"],
                            "at": finished or started,
                        })

        # ── Pass 2: llm_jobs since the window. Count per-step per-slug.
        llm_rows = db.execute(
            "SELECT roaster_slug, step, status, created_at, completed_at "
            "FROM llm_jobs "
            "WHERE created_at >= ?",
            (since_iso,),
        ).fetchall()
        total_llm_calls = 0
        for lj in llm_rows:
            slug = lj["roaster_slug"]
            if not slug or slug == "unknown":
                continue
            total_llm_calls += 1
            row = _get_row(slug)
            if row is None:
                continue
            row["llm_jobs"] += 1
            _bump_last_activity(row, lj["completed_at"] or lj["created_at"])
            # Track per-product / per-article LLM work for the top-line
            # totals. We bucket on `step`:
            #   product_enrich / per_product → products_enriched
            #   article_enrich               → articles_enriched (only
            #     counted here if status=complete, otherwise the
            #     article_scrape pass already incremented it).
            step = (lj["step"] or "").strip()
            if step in ("product_enrich", "per_product", "enrich"):
                if lj["status"] == "complete":
                    row["products_enriched"] += 1

        # ── Pass 3: scrape_proposals since the window. Group by status
        # and join to products for the slug. Heuristic-rejected proposals
        # carry the slug in proposed_state_json so we parse that for the
        # rejected-bucket only.
        prop_rows = db.execute(
            "SELECT sp.product_id, sp.change_type, sp.status, sp.created_at, "
            "       sp.proposed_state_json, p.roaster_slug AS prod_slug "
            "FROM scrape_proposals sp "
            "LEFT JOIN products p ON p.product_id = sp.product_id "
            "WHERE sp.created_at >= ?",
            (since_iso,),
        ).fetchall()
        for pr in prop_rows:
            # Resolve slug — prefer the FK lookup, fall back to the
            # JSON payload (heuristic_reject rows where no products
            # row exists).
            slug = pr["prod_slug"]
            if not slug and pr["proposed_state_json"]:
                try:
                    payload = json.loads(pr["proposed_state_json"]) or {}
                    slug = payload.get("roaster_slug")
                except (json.JSONDecodeError, TypeError):
                    pass
            if not slug:
                continue
            row = _get_row(slug)
            if row is None:
                continue

            status = pr["status"]
            change_type = pr["change_type"]
            if change_type == "heuristic_reject" or status == "rejected":
                row["proposals_rejected"] += 1
            elif status == "pending":
                # Pending = held for human review. Once a proposal lands
                # as `applied`, it moves out of the queue — the held
                # bucket is for what's still waiting, not for what's
                # been approved. Auto-approved (when the runner identity
                # is wired) will land directly in `applied` AND increment
                # `proposals_auto_approved` separately.
                row["proposals_held"] += 1
            # 'applied' status: no per-roaster bump today. The auto-
            # approve split lands in a follow-up. See top-of-route
            # docstring.
            _bump_last_activity(row, pr["created_at"])

        # ── Pass 4: agent_runs since the window — used for the
        # "bios refreshed" + "auto-approved" totals once those land.
        # For now we count `crema_enrich_roaster` invocations as the
        # canonical bio-refresh signal IF the corresponding roaster_enrich
        # job already bumped it (avoid double-counting). When the
        # auto-approve runner identity is wired we'll filter for
        # `tool_name='crema_approve_proposals'` AND
        # `agent_identity LIKE 'claude-%'` here.
        # No-op for the moment; left as a comment for the follow-up.
        # (Endpoint intentionally idempotent without it.)

        # ── Totals
        products_enriched_total = sum(r["products_enriched"] for r in per_roaster.values())
        articles_enriched_total = sum(r["articles_enriched"] for r in per_roaster.values())
        proposals_held_total = sum(r["proposals_held"] for r in per_roaster.values())
        proposals_rejected_total = sum(r["proposals_rejected"] for r in per_roaster.values())

        # ── Sort & dedupe outputs.
        ordered_rows = sorted(
            per_roaster.values(),
            key=lambda r: r["last_activity_at"] or "",
            reverse=True,
        )

        # Trim recent_failures to top N by recency and dedupe by
        # (slug, message) so a single roaster spamming the same error
        # doesn't fill the list.
        seen = set()
        deduped_failures = []
        for f in sorted(recent_failures, key=lambda x: x.get("at") or "", reverse=True):
            key = (f.get("slug"), f.get("message"))
            if key in seen:
                continue
            seen.add(key)
            deduped_failures.append(f)
            if len(deduped_failures) >= 10:
                break

        return ok(
            {
                "since": since_iso,
                "now": now_iso,
                "totals": {
                    "roasters_processed": len(per_roaster),
                    "bios_refreshed": bios_refreshed,
                    "products_enriched": products_enriched_total,
                    "articles_enriched": articles_enriched_total,
                    # Auto-approve wiring is a follow-up (see top-of-route
                    # comment) — keep the field present and zero so the
                    # frontend can render without conditional plumbing.
                    "proposals_auto_approved": 0,
                    "proposals_held_for_review": proposals_held_total,
                    "proposals_auto_rejected": proposals_rejected_total,
                    "llm_calls": total_llm_calls,
                    "run_time_seconds": round(total_run_seconds, 1),
                    "runs_in_flight": runs_in_flight,
                },
                "roasters": ordered_rows,
                "recent_failures": deduped_failures,
            },
            resource="sweep_summary",
        )
    finally:
        db.close()


@router.post("/admin/agent-runs", status_code=201)
def admin_record_agent_run(body: dict, user=Depends(get_current_user)):
    """Append a row to `agent_runs`. Called by the MCP server (and
    future agent runners) to log every tool invocation. The MCP server
    inserts BEFORE calling the wrapped endpoint, then UPDATEs the row
    via PUT once the wrapped call finishes — so the log captures both
    started_at and finished_at.

    Body:
      • agent_identity: string (required) — e.g. `claude-sonnet-4-6@anthropic`
      • tool_name: string (required) — the MCP tool name
      • args_json: stringified JSON of input args
      • session_id: optional — groups related calls
      • prompt_hash / schema_hash: optional — for replay/drift detection
    """
    _require_admin(user)
    body = body or {}
    agent_identity = (body.get("agent_identity") or "").strip()
    tool_name = (body.get("tool_name") or "").strip()
    if not agent_identity or not tool_name:
        from fastapi import HTTPException
        raise HTTPException(422, "agent_identity and tool_name are required")
    db = get_db()
    try:
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
        cur = db.execute(
            "INSERT INTO agent_runs "
            "(session_id, agent_identity, operator_user_id, tool_name, "
            " args_json, started_at, prompt_hash, schema_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                body.get("session_id"),
                agent_identity,
                user["id"],
                tool_name,
                body.get("args_json"),
                now,
                body.get("prompt_hash"),
                body.get("schema_hash"),
            ),
        )
        db.commit()
        return ok({"id": cur.lastrowid, "started_at": now},
                  resource="agent_runs")
    finally:
        db.close()


@router.put("/admin/agent-runs/{run_id}")
def admin_finish_agent_run(run_id: int, body: dict,
                             user=Depends(get_current_user)):
    """Close out an agent_runs row with finished_at + result_summary +
    optional error. Called by the MCP server after the wrapped tool
    finishes."""
    _require_admin(user)
    body = body or {}
    db = get_db()
    try:
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
        db.execute(
            "UPDATE agent_runs SET finished_at = ?, "
            "result_summary = ?, error = ? WHERE id = ?",
            (now, body.get("result_summary"), body.get("error"), run_id),
        )
        db.commit()
        return ok({"id": run_id, "finished_at": now},
                  resource="agent_runs")
    finally:
        db.close()


@router.get("/admin/agent-runs")
def admin_list_agent_runs(limit: int = 100, agent_identity: str = None,
                            tool_name: str = None, session_id: str = None,
                            user=Depends(get_current_user)):
    """List recent agent runs. Filters: agent_identity, tool_name,
    session_id. Used by the future 'Agent activity' admin view +
    by agents that want to audit their own recent actions."""
    _require_admin(user)
    where = []
    params: list = []
    if agent_identity:
        where.append("agent_identity = ?"); params.append(agent_identity)
    if tool_name:
        where.append("tool_name = ?"); params.append(tool_name)
    if session_id:
        where.append("session_id = ?"); params.append(session_id)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(min(max(int(limit or 100), 1), 1000))
    db = get_db()
    try:
        rows = db.execute(
            f"SELECT * FROM agent_runs{where_sql} "
            f"ORDER BY started_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="agent_runs")
    finally:
        db.close()


# ── agent_summaries — explicit session-log for autonomous agents ───────────
# Each catalog-ops agent (drainer, orchestrator, auto-approve runner,
# hint-regen, etc.) calls `crema_log_agent_summary` once at exit. The
# row carries a free-text task_label, the agent's own 3-5-sentence
# summary, the outcome enum, and any free-form metrics it wants to
# stash. The UI's Activity Log tab digests this table. agent_runs is
# still the source-of-truth for individual MCP tool calls; this is
# the human-readable layer above it.


@router.post("/admin/agent-summaries", status_code=201)
def admin_log_agent_summary(body: dict, user=Depends(get_current_user)):
    """Append a row to `agent_summaries` — the daily-digest log.

    Body:
      • task_label (required, free text) — agent's own description of
        what it did. Examples: "Drain held-roaster re-enrich queue",
        "Auto-approve clean proposals after sweep", "Patch korebi
        bio_hint with Bourbon disambiguation".
      • summary (required, 3-5 sentences) — agent's narrative of what
        happened, in its own voice. Should mention scope (which
        roasters / how many jobs / what landed), key outcomes, any
        surprises.
      • outcome (optional enum) — 'success' | 'partial' | 'failed' |
        'aborted'. If omitted, treated as 'success'.
      • prompt_excerpt (optional) — first ~500 chars of the prompt the
        agent received. Useful for retro-debugging.
      • tool_calls_count (optional int) — how many MCP tool calls the
        agent made. Cheaper than aggregating agent_runs at read time.
      • scope_slugs (optional list[string]) — roaster slugs the agent
        touched. Stored as JSON array.
      • metrics (optional dict) — free-form counters. Examples:
        {"jobs_processed": 12, "approved": 9, "held": 3}.
      • started_at (optional ISO8601) — when the agent began. If
        omitted, defaults to roughly now.

    Returns: {id, ended_at}.
    """
    _require_admin(user)
    body = body or {}
    task_label = (body.get("task_label") or "").strip()
    summary = (body.get("summary") or "").strip()
    if not task_label or not summary:
        from fastapi import HTTPException
        raise HTTPException(422, "task_label and summary are required")

    outcome = (body.get("outcome") or "success").strip().lower()
    if outcome not in ("success", "partial", "failed", "aborted"):
        from fastapi import HTTPException
        raise HTTPException(
            422,
            f"outcome={outcome!r} must be one of "
            "success/partial/failed/aborted",
        )

    import datetime as _dt
    import json as _json
    now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
    scope_slugs_json = None
    sc = body.get("scope_slugs")
    if sc is not None:
        scope_slugs_json = _json.dumps(sc)
    metrics_json = None
    mt = body.get("metrics")
    if mt is not None:
        metrics_json = _json.dumps(mt)

    # Resolve agent_identity from the operator's session — that's the
    # MCP env's `CREMA_AGENT_IDENTITY` propagated through the bearer
    # token's session. The endpoint doesn't accept it from the body
    # to avoid spoofing.
    agent_identity = user.get("agent_identity") or user.get("display_name") or f"user:{user.get('id')}"

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO agent_summaries "
            "(agent_identity, task_label, prompt_excerpt, summary, outcome, "
            " tool_calls_count, scope_slugs, metrics, started_at, ended_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                agent_identity,
                task_label,
                body.get("prompt_excerpt"),
                summary,
                outcome,
                body.get("tool_calls_count"),
                scope_slugs_json,
                metrics_json,
                body.get("started_at") or now,
                now,
            ),
        )
        db.commit()
        return ok({"id": cur.lastrowid, "ended_at": now},
                  resource="agent_summaries")
    finally:
        db.close()


@router.get("/admin/agent-summaries")
def admin_list_agent_summaries(
    limit: int = 50,
    since: Optional[str] = None,
    agent_identity: Optional[str] = None,
    outcome: Optional[str] = None,
    user=Depends(get_current_user),
):
    """List recent agent summaries. Filters:
      • since: ISO8601 — only summaries with `ended_at >= since`.
      • agent_identity: scope to one agent.
      • outcome: filter by enum value.
      • limit: 1-1000, default 50.
    """
    _require_admin(user)
    where = []
    params: list = []
    if since:
        where.append("ended_at >= ?"); params.append(since)
    if agent_identity:
        where.append("agent_identity = ?"); params.append(agent_identity)
    if outcome:
        where.append("outcome = ?"); params.append(outcome)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(min(max(int(limit or 50), 1), 1000))

    import json as _json
    db = get_db()
    try:
        rows = db.execute(
            f"SELECT * FROM agent_summaries{where_sql} "
            f"ORDER BY ended_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            # Parse JSON fields for the UI's convenience.
            for k in ("scope_slugs", "metrics"):
                if d.get(k):
                    try: d[k] = _json.loads(d[k])
                    except Exception: pass
            out.append(d)
        return ok(out, resource="agent_summaries")
    finally:
        db.close()


# ── LLM-jobs queue (agent-fallback execution path) ─────────────────────────
# When the FastAPI runner is invoked by a Claude operator (env
# CREMA_AGENT_IDENTITY starts with "claude-" or LLM_PROVIDER=
# claude_code_agent), the enricher services enqueue rows here
# instead of calling the Anthropic SDK. Claude polls the queue via
# the MCP tools `crema_haiku_next_job` (which calls /next below) and
# `crema_haiku_submit` (which calls /{id}/respond), producing the
# structured output itself per CLAUDE.md's Haiku-validation hard
# rule. The awaiting enricher (services/llm_router._call_via_queue)
# picks up the response on the next poll tick.

@router.post("/admin/llm-jobs/next")
def admin_llm_jobs_next(body: Optional[dict] = None,
                          user=Depends(get_current_user)):
    """Atomically claim the oldest pending llm_job. Optional filter
    fields: step (bio | bio_hint | journal_hint | article_enrich |
    product_enrich), roaster_slug. Returns the full job (incl.
    parsed tool_schema) or null if the queue is empty.

    The claim is atomic — concurrent agents racing for the same job
    only one wins, the loser sees status!=pending and we retry the
    next-oldest row."""
    _require_admin(user)
    body = body or {}
    step = (body.get("step") or "").strip() or None
    roaster_slug = (body.get("roaster_slug") or "").strip() or None
    agent_identity = (body.get("agent_identity") or "").strip()
    if not agent_identity:
        agent_identity = f"user-{user['id']}"

    db = get_db()
    try:
        import datetime as _dt
        import json as _json
        for _attempt in range(8):  # bounded loop in case of races
            where = ["status = 'pending'"]
            params: list = []
            if step:
                where.append("step = ?"); params.append(step)
            if roaster_slug:
                where.append("roaster_slug = ?"); params.append(roaster_slug)
            where_sql = " AND ".join(where)
            row = db.execute(
                f"SELECT * FROM llm_jobs WHERE {where_sql} "
                f"ORDER BY created_at ASC LIMIT 1",
                tuple(params),
            ).fetchone()
            if row is None:
                return ok(None, resource="llm_jobs")
            now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
            cur = db.execute(
                "UPDATE llm_jobs SET status = 'in_progress', "
                "claimed_at = ?, agent_identity = ? "
                "WHERE id = ? AND status = 'pending'",
                (now, agent_identity, row["id"]),
            )
            db.commit()
            if cur.rowcount == 0:
                # Lost the race — try again
                continue
            # Re-fetch with claimed state
            row = db.execute(
                "SELECT * FROM llm_jobs WHERE id = ?", (row["id"],),
            ).fetchone()
            d = dict(row)
            schema_json = d.pop("tool_schema_json", None)
            try:
                d["tool_schema"] = _json.loads(schema_json) if schema_json else None
            except Exception:
                d["tool_schema"] = None
            return ok(d, resource="llm_jobs")
        return ok(None, resource="llm_jobs")
    finally:
        db.close()


@router.post("/admin/llm-jobs/{job_id}/respond")
def admin_llm_jobs_respond(job_id: int, body: dict,
                             user=Depends(get_current_user)):
    """Write response_payload for an in-flight llm_job. Marks it
    complete (or failed). The awaiting enricher
    (services/llm_router._call_via_queue) picks up the new state on
    its next poll tick.

    Body:
      • output: dict — the structured tool_use input the model
        produced. Required when status=complete.
      • status: 'complete' (default) or 'failed'
      • error: str — required when status=failed
    """
    _require_admin(user)
    body = body or {}
    status = (body.get("status") or "complete").strip()
    if status not in ("complete", "failed"):
        from fastapi import HTTPException
        raise HTTPException(422, "status must be 'complete' or 'failed'")
    output = body.get("output")
    error = body.get("error")
    if status == "complete" and output is None:
        from fastapi import HTTPException
        raise HTTPException(422,
            "output is required when status=complete")
    if status == "failed" and not error:
        from fastapi import HTTPException
        raise HTTPException(422,
            "error is required when status=failed")

    db = get_db()
    try:
        import datetime as _dt
        import json as _json
        now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
        payload_json = _json.dumps(output) if output is not None else None
        cur = db.execute(
            "UPDATE llm_jobs SET status = ?, response_payload = ?, "
            "error = ?, completed_at = ? "
            "WHERE id = ? AND status = 'in_progress'",
            (status, payload_json, error, now, job_id),
        )
        db.commit()
        if cur.rowcount == 0:
            row = db.execute(
                "SELECT status FROM llm_jobs WHERE id = ?", (job_id,),
            ).fetchone()
            from fastapi import HTTPException
            if row is None:
                raise HTTPException(404, f"llm_job {job_id} not found")
            raise HTTPException(409,
                f"llm_job {job_id} is {row['status']}, not in_progress")
        return ok({"id": job_id, "status": status,
                   "completed_at": now}, resource="llm_jobs")
    finally:
        db.close()


@router.get("/admin/llm-jobs")
def admin_list_llm_jobs(limit: int = 100, status: Optional[str] = None,
                          roaster_slug: Optional[str] = None,
                          step: Optional[str] = None,
                          include_payloads: bool = False,
                          user=Depends(get_current_user)):
    """List recent llm_jobs. Filters: status, roaster_slug, step.
    Useful for the orchestrator to see what's pending vs in_progress
    vs complete during a sweep.

    Set include_payloads=true to also return system_prompt,
    user_content, tool_schema_json, response_payload for each row —
    big response; use sparingly (eg. when debugging a specific
    failed step)."""
    _require_admin(user)
    where = []
    params: list = []
    if status:
        where.append("status = ?"); params.append(status)
    if roaster_slug:
        where.append("roaster_slug = ?"); params.append(roaster_slug)
    if step:
        where.append("step = ?"); params.append(step)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(min(max(int(limit or 100), 1), 1000))
    db = get_db()
    try:
        cols = (
            "id, roaster_slug, step, target_id, model, status, "
            "created_at, claimed_at, completed_at, error, agent_identity"
        )
        if include_payloads:
            cols += (", system_prompt, user_content, tool_schema_json, "
                     "response_payload, max_tokens, tool_name")
        rows = db.execute(
            f"SELECT {cols} FROM llm_jobs{where_sql} "
            f"ORDER BY created_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="llm_jobs")
    finally:
        db.close()


@router.post("/admin/standardize/run", status_code=202)
def admin_standardize_run(body: Optional[dict] = None,
                           background_tasks: BackgroundTasks = None,
                           user=Depends(get_current_user)):
    """Enqueue a Catalog Standardization job. The runner harvests every
    distinct catalog input across the SELECTED tasks, Haiku-classifies
    the unclassified ones, and writes results to address tables +
    denormalized product columns.

    Body:
      • regenerate_exemplars: bool — force-resample all selected tasks'
        exemplars before the call.
      • tasks: list[str] — subset of ("tasting", "origin", "varietal",
        "roast", "process"). Empty / omitted = run all five.
      • force_reclassify: bool — when true, every input string is fed
        to Haiku regardless of whether it already has an address row.
        Use when the prompt has been improved or the schema has changed
        and the existing classifications need to be refreshed. Default
        false (the run skips already-classified inputs to save tokens).
    """
    _require_admin(user)
    body = body or {}
    regenerate = bool(body.get("regenerate_exemplars"))
    force_reclassify = bool(body.get("force_reclassify"))
    tasks = body.get("tasks")
    if tasks is not None and not isinstance(tasks, list):
        raise HTTPException(400, "tasks must be an array of task names")
    db = get_db()
    try:
        try:
            job_id = catalog_ops.enqueue_job(db, "standardize", started_by=user["id"])
        except catalog_ops.JobConflict as e:
            raise HTTPException(409, str(e), headers={"X-Live-Job-Id": str(e.live_job_id)})
        background_tasks.add_task(
            catalog_ops.run_standardize_job, job_id,
            regenerate_exemplars=regenerate,
            tasks=tasks,
            force_reclassify=force_reclassify,
        )
        return ok(_job_to_response(db, job_id), resource="jobs")
    finally:
        db.close()


# ── Consumer SCA surfaces (no auth) ─────────────────────────────────────────
# The Discover BEANS Flavor lens needs two things from the standardization
# pipeline: the active SCA tree (so the chip-ladder / wheel knows what
# tier-1/2/3 nodes exist) and the tag→address map (so it can join product
# tasting tags onto tree nodes). Both are static enough to be served with
# no auth and cached on the client; the wheel re-fetches on focus only if
# its cache is empty.

@router.get("/sca/tree")
def public_sca_tree():
    """Return the active SCA flavor tree (3-tier dict). Falls back to the
    in-code CANONICAL_TREE if no active version is set in the DB. Used by
    the consumer Discover Flavor wheel."""
    db = get_db()
    try:
        return ok(sca_geolocator.get_active_tree(db), resource="sca_tree")
    finally:
        db.close()


@router.get("/sca/addresses")
def public_sca_addresses():
    """Return the tag→address map for every classified tag in
    `sca_addresses`. Shape mirrors the `tag_resolutions.json` fixture:
    `{ "<tag>": [t1, t2?, t3?] | null }`. `null` means the tag was
    classified as not-a-flavor (mouthfeel / vague marketing /
    cross-category compound). The frontend joins this against each
    product's `flavor_notes` + `tasting_notes` to derive per-product
    SCA addresses for the wheel filter."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT tag, address_t1, address_t2, address_t3, is_null "
            "FROM sca_addresses"
        ).fetchall()
        out: dict = {}
        for r in rows:
            if r["is_null"]:
                out[r["tag"]] = None
                continue
            addr = [x for x in (r["address_t1"], r["address_t2"], r["address_t3"]) if x]
            out[r["tag"]] = addr if addr else None
        return ok(out, resource="sca_addresses")
    finally:
        db.close()


@router.get("/admin/standardize/stats")
def admin_standardize_stats(user=Depends(get_current_user)):
    """3-way stats for the STANDARDIZATION sub-tab — drives the hero
    counts (N tags · M origins · K varietals to classify) plus per-task
    breakdowns (multi-estate / international / unknown / morphology)."""
    _require_admin(user)
    db = get_db()
    try:
        return ok(
            sca_geolocator.compute_standardize_stats(db),
            resource="standardize_stats",
        )
    finally:
        db.close()


@router.get("/admin/standardize/prompt")
def admin_standardize_prompt(user=Depends(get_current_user)):
    """Render the FIVE per-task Haiku system prompts verbatim. Read-only;
    the inspector modal on the STANDARDIZATION sub-tab opens this so
    the admin can see exactly what each task's call will send."""
    _require_admin(user)
    db = get_db()
    try:
        sca_tree = sca_geolocator.get_active_tree(db)
        variety_tree = sca_geolocator.load_variety_tree()
        # Reuse cached exemplars without forcing a refresh — the inspector
        # shows what's in flight, not a resample as a side effect.
        tag_exs = sca_geolocator.get_or_refresh_exemplars(db, "tasting", regenerate=False)
        origin_exs = sca_geolocator.get_or_refresh_exemplars(db, "origin", regenerate=False)
        varietal_exs = sca_geolocator.get_or_refresh_exemplars(db, "varietal", regenerate=False)
        roast_exs = sca_geolocator.get_or_refresh_exemplars(db, "roast", regenerate=False)
        process_exs = sca_geolocator.get_or_refresh_exemplars(db, "process", regenerate=False)
        tasting_prompt = sca_geolocator.build_tasting_prompt(sca_tree, tag_exs)
        origin_prompt = sca_geolocator.build_origin_prompt(origin_exs)
        varietal_prompt = sca_geolocator.build_varietal_prompt(variety_tree, varietal_exs)
        roast_prompt = sca_geolocator.build_roast_prompt(roast_exs)
        process_prompt = sca_geolocator.build_process_prompt(process_exs)
        return ok({
            "prompts": {
                "tasting": tasting_prompt,
                "origin": origin_prompt,
                "varietal": varietal_prompt,
                "roast": roast_prompt,
                "process": process_prompt,
            },
            "char_counts": {
                "tasting": len(tasting_prompt),
                "origin": len(origin_prompt),
                "varietal": len(varietal_prompt),
                "roast": len(roast_prompt),
                "process": len(process_prompt),
            },
            "exemplar_counts": {
                "tasting": len(tag_exs),
                "origin": len(origin_exs),
                "varietal": len(varietal_exs),
                "roast": len(roast_exs),
                "process": len(process_exs),
            },
        }, resource="standardize_prompt")
    finally:
        db.close()


@router.get("/admin/standardize/trees")
def admin_standardize_trees(user=Depends(get_current_user)):
    """Inspect the active reference trees. Both ship in code (the SCA
    tree as a Python constant, the variety tree as a seed JSON file) so
    they're not editable through the admin UI — the admin pastes / edits
    via a code change. This endpoint is read-only and used by the
    inspect-only modal on the STANDARDIZATION tab."""
    _require_admin(user)
    db = get_db()
    try:
        return ok({
            "sca_tree": sca_geolocator.get_active_tree(db),
            "variety_tree": sca_geolocator.load_variety_tree(),
        }, resource="standardize_trees")
    finally:
        db.close()


# ── Flavor schema management ────────────────────────────────────────────────
# Single-tier flavor schemas live in `sca_tree_versions`. Multiple schemas
# can coexist; one is `is_active=1`. Admin uploads new schemas + flips
# active via the Catalog Ops Schema Manager UI; the Discover wheel reads
# whichever is active via `GET /api/sca/tree`. Activating a schema makes
# the wheel render the new sectors immediately, but pre-existing
# `sca_addresses` rows are stale until the admin re-runs Standardization
# Tasting — UI surfaces a banner with the count of stale rows.

@router.get("/admin/flavor-schemas")
def admin_flavor_schemas_list(user=Depends(get_current_user)):
    """List every flavor schema in `sca_tree_versions`, newest-first.
    Drives the Schema Manager card list."""
    _require_admin(user)
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, uploaded_at, uploaded_by, tree_json, is_active, notes "
            "FROM sca_tree_versions ORDER BY id DESC"
        ).fetchall()
        out: list[dict] = []
        for r in rows:
            try:
                schema = json.loads(r["tree_json"])
            except (json.JSONDecodeError, TypeError):
                schema = None
            sectors = []
            label = None
            version = None
            kind = None
            if isinstance(schema, dict):
                kind = schema.get("kind")
                label = schema.get("label")
                version = schema.get("version")
                sectors = schema.get("sectors", []) if kind == "single_tier" else []
            out.append({
                "id": r["id"],
                "uploaded_at": r["uploaded_at"],
                "uploaded_by": r["uploaded_by"],
                "is_active": bool(r["is_active"]),
                "notes": r["notes"],
                "kind": kind,
                "version": version,
                "label": label,
                "sector_count": len(sectors),
                "sector_names": [s.get("name") for s in sectors if isinstance(s, dict)],
            })
        # Stale-address signal — count addresses keyed against branches
        # that no longer exist in the active schema. Drives the banner.
        active_row = next((r for r in out if r["is_active"]), None)
        stale_count = 0
        total_classified = 0
        if active_row:
            active_names = set(active_row["sector_names"] or [])
            counts = db.execute(
                "SELECT address_t1, COUNT(*) AS n FROM sca_addresses "
                "WHERE is_null = 0 GROUP BY address_t1"
            ).fetchall()
            for c in counts:
                total_classified += c["n"]
                if c["address_t1"] not in active_names:
                    stale_count += c["n"]
        return ok({
            "schemas": out,
            "active_id": active_row["id"] if active_row else None,
            "stale_address_count": stale_count,
            "classified_address_count": total_classified,
        }, resource="flavor_schemas")
    finally:
        db.close()


@router.post("/admin/flavor-schemas")
def admin_flavor_schemas_upload(payload: dict, user=Depends(get_current_user)):
    """Upload a new flavor schema. Body shape:
        { "tree_json": "<JSON string>", "notes": "...", "activate": false }
    The JSON string is parsed + validated; on success a new row lands in
    `sca_tree_versions`. If `activate` is true, the new row also gets
    `is_active=1` (and any prior active row is flipped off)."""
    _require_admin(user)
    raw = (payload or {}).get("tree_json")
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(400, "Missing tree_json (string).")
    try:
        schema = sca_geolocator.parse_tree_json(raw)
    except ValueError as e:
        raise HTTPException(400, f"Schema rejected: {e}")
    notes = (payload or {}).get("notes") or schema.get("notes") or ""
    activate = bool((payload or {}).get("activate"))
    db = get_db()
    try:
        if activate:
            db.execute("UPDATE sca_tree_versions SET is_active = 0 WHERE is_active = 1")
        cur = db.execute(
            "INSERT INTO sca_tree_versions "
            "(uploaded_at, uploaded_by, tree_json, is_active, notes) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                _now_iso(),
                user.get("user_id") if isinstance(user, dict) else None,
                json.dumps(schema),
                1 if activate else 0,
                notes,
            ),
        )
        db.commit()
        return ok({
            "id": cur.lastrowid,
            "version": schema.get("version"),
            "label": schema.get("label"),
            "is_active": activate,
            "sector_count": len(schema.get("sectors", [])),
        }, resource="flavor_schema")
    finally:
        db.close()


@router.post("/admin/flavor-schemas/{schema_id}/activate")
def admin_flavor_schemas_activate(schema_id: int, user=Depends(get_current_user)):
    """Make `schema_id` the active schema. Atomic: the prior active row
    flips to 0 and the named row flips to 1 inside one transaction. After
    activation, `sca_addresses` may be stale against the new schema —
    the response reports the stale count so the UI can prompt the admin
    to re-run Standardization Tasting."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, tree_json FROM sca_tree_versions WHERE id = ?",
            (schema_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, f"No flavor schema with id {schema_id}.")
        try:
            schema = json.loads(row["tree_json"])
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(500, "Stored schema row is not valid JSON.")
        db.execute("UPDATE sca_tree_versions SET is_active = 0 WHERE is_active = 1")
        db.execute("UPDATE sca_tree_versions SET is_active = 1 WHERE id = ?", (schema_id,))
        db.commit()
        # Stale-address count post-activation.
        active_names = {
            s.get("name") for s in (schema.get("sectors", []) or [])
            if isinstance(s, dict)
        }
        stale = db.execute(
            "SELECT COUNT(*) AS n FROM sca_addresses "
            "WHERE is_null = 0 AND address_t1 NOT IN "
            f"({','.join('?' * max(1, len(active_names)))})",
            tuple(active_names) if active_names else (None,),
        ).fetchone()
        return ok({
            "id": schema_id,
            "version": schema.get("version"),
            "stale_address_count": stale["n"] if stale else 0,
        }, resource="flavor_schema_activate")
    finally:
        db.close()


def _now_iso() -> str:
    """Local wrapper so the schema endpoints don't import catalog_ops just
    for `_now`. Same UTC isoformat shape."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.get("/admin/standardize/exemplars")
def admin_standardize_exemplars(user=Depends(get_current_user)):
    """Per-task exemplar status + cached content. Status fields drive
    the regen toggle (and the "Last sampled …" stamp on each task
    card); the `exemplars` list is what the standardization tab's
    per-card dropdown renders so ops can see the actual house-style
    examples Haiku is being primed with.

    Each row's `exemplars_json` is parsed inline so the client doesn't
    have to. Empty list when no row exists yet for a task."""
    _require_admin(user)
    db = get_db()
    try:
        rows = db.execute(
            "SELECT task, regenerate_next, generated_at, exemplars_json "
            "FROM standardize_exemplars"
        ).fetchall()
        out: dict = {}
        for r in rows:
            try:
                exemplars = json.loads(r["exemplars_json"]) if r["exemplars_json"] else []
            except (json.JSONDecodeError, TypeError):
                exemplars = []
            out[r["task"]] = {
                "regenerate_next": bool(r["regenerate_next"]),
                "generated_at": r["generated_at"],
                "exemplars": exemplars,
            }
        for task in ("tasting", "origin", "varietal", "roast", "process"):
            out.setdefault(task, {
                "regenerate_next": False,
                "generated_at": None,
                "exemplars": [],
            })
        return ok(out, resource="standardize_exemplars")
    finally:
        db.close()


@router.post("/admin/standardize/exemplars/regenerate")
def admin_standardize_exemplars_regen(body: Optional[dict] = None,
                                        user=Depends(get_current_user)):
    """Flip `regenerate_next` on one task (or all three) so the next
    standardization run resamples its exemplars. Mirrors the site-prompt-
    hint regen toggle on the per-roaster admin page.

    Body: { "task": "tasting" | "origin" | "varietal" | "all",
             "value": bool (default true) }
    """
    _require_admin(user)
    body = body or {}
    task = body.get("task") or "all"
    value = bool(body.get("value", True))
    if task not in ("tasting", "origin", "varietal", "roast", "process", "all"):
        from fastapi import HTTPException
        raise HTTPException(400, f"unknown task: {task!r}")
    db = get_db()
    try:
        targets = (
            ("tasting", "origin", "varietal", "roast", "process")
            if task == "all" else (task,)
        )
        for t in targets:
            sca_geolocator.set_regenerate_next(db, t, value)
        return ok({"updated": list(targets), "value": value},
                  resource="standardize_exemplars")
    finally:
        db.close()


@router.post("/admin/jobs/{job_id}/cancel")
def admin_cancel_job(job_id: int, user=Depends(get_current_user)):
    """Sticky-flag cancel. Sets `jobs.cancel_requested = 1`; the runner
    polls this at the top of every per-source iteration and exits
    cleanly with whatever it has already committed (`mark_finished`
    with `status='succeeded'` + `result_summary.cancelled = true`).

    Per-row commits in `upsert_article` mean every article persisted
    so far is a complete article — no half-scraped rows. The cancel is
    a clean checkpoint, not an abort.

    Idempotent: setting the flag on an already-finished job is a no-op
    (the runner doesn't re-read it once `mark_finished` has fired).
    Setting on a queued/running job that's already cancel-requested is
    also a no-op.
    """
    _require_admin(user)
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE jobs SET cancel_requested = 1 "
            "WHERE id = ? AND status IN ('queued', 'running')",
            (job_id,),
        )
        if cur.rowcount == 0:
            row = db.execute(
                "SELECT status FROM jobs WHERE id = ?", (job_id,),
            ).fetchone()
            if row is None:
                from fastapi import HTTPException
                raise HTTPException(404, f"Job {job_id} not found")
            # Job already in a terminal state — return 200 with a
            # noop body so the UI can refresh + collapse the banner
            # without thinking it failed.
            return ok({
                "job_id": job_id,
                "cancel_requested": 0,
                "noop": True,
                "current_status": row["status"],
            }, resource="jobs")
        db.commit()
        return ok({"job_id": job_id, "cancel_requested": 1}, resource="jobs")
    finally:
        db.close()


@router.get("/admin/jobs/{job_id}/log")
def admin_job_log(job_id: int, user=Depends(get_current_user)):
    """Return the captured log tail for a single job. The full row is
    available via `/api/jobs/{id}` (registry CRUD) — this endpoint is a
    convenience for the modal that opens when the admin taps a job
    history row."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, kind, status, log_tail, error_message FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Job {job_id} not found")
        return ok(dict(row), resource="jobs")
    finally:
        db.close()


# ── Scrape proposals: approve / reject / undo / sold-out ────────────────────
# Every scrape now stages its diff into `scrape_proposals` and waits for
# the admin to approve. These endpoints are the approval surface — none
# of them touch the products table without the admin saying so.

@router.get("/admin/scrape/proposals")
def admin_list_proposals(job_id: int = None, status: str = "pending",
                          roaster_slug: Optional[str] = None,
                          limit: int = 500,
                          user=Depends(get_current_user)):
    """List proposals — defaults to `pending` so the admin tab can show
    the approval queue.

    Filters:
      • job_id: exact job_id match
      • status: 'pending' (default) | 'applied' | 'rejected' | 'reverted'.
        Pass empty string to widen to all statuses.
      • roaster_slug: filter to one roaster via product_id LIKE 'slug_%'.
        Crucial for per-roaster proposal review — without this the MCP
        client had to fetch all and filter client-side, which broke on
        truncation for large catalogs.
      • limit: cap on rows returned. Default 500; bump for bulk
        operations. Caps the payload so a queue of thousands doesn't
        bring the response over MCP truncation thresholds.
    """
    _require_admin(user)
    db = get_db()
    try:
        rows = catalog_ops.list_proposals(
            db, job_id=job_id, status=(status or None) if status != "" else None,
        )
        # Apply roaster_slug filter post-hoc since catalog_ops.list_proposals
        # doesn't accept it. product_id has the shape '<slug>_<handle>'.
        if roaster_slug:
            prefix = f"{roaster_slug}_"
            rows = [r for r in rows if (r.get("product_id") or "").startswith(prefix)]
        # Cap the row count.
        limit = max(1, min(int(limit or 500), 5000))
        rows = rows[:limit]
        return ok(rows, resource="scrape_proposals", total=len(rows))
    finally:
        db.close()


@router.get("/admin/catalog/stats")
def admin_catalog_stats(roaster_slug: Optional[str] = None,
                         user=Depends(get_current_user)):
    """Aggregate catalog state — counts of products by enrichment_status.

    Without this, the MCP client had to reach into SQLite directly to
    answer 'where is the catalog at right now' — which broke the
    MCP-only discipline (provider-portability suffers if the operator
    has to use direct SQL).

    Optional `roaster_slug` scopes the stats to one roaster.

    Returns:
        {
          total: int, enriched: int, failed: int, null_or_other: int,
          by_status: { <status>: <count>, ... },
          available: { yes: int, no: int },
          sources: int,
        }
    """
    _require_admin(user)
    db = get_db()
    try:
        where = []
        params: list = []
        if roaster_slug:
            where.append("roaster_slug = ?")
            params.append(roaster_slug)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        # Total + per-status counts.
        rows = db.execute(
            f"SELECT COALESCE(enrichment_status, '_null') AS status, "
            f"COUNT(*) AS c FROM products{where_sql} GROUP BY status",
            tuple(params),
        ).fetchall()
        by_status: dict[str, int] = {r["status"]: r["c"] for r in rows}
        total = sum(by_status.values())
        enriched = by_status.get("enriched", 0)
        failed = by_status.get("failed", 0)
        null_or_other = sum(
            c for k, c in by_status.items()
            if k not in ("enriched", "failed")
        )

        # Availability.
        avail_rows = db.execute(
            f"SELECT available, COUNT(*) AS c FROM products{where_sql} "
            f"GROUP BY available",
            tuple(params),
        ).fetchall()
        avail = {bool(r["available"]): r["c"] for r in avail_rows}
        available = {
            "yes": avail.get(True, 0),
            "no":  avail.get(False, 0),
        }

        # Distinct roaster sources represented.
        sources = db.execute(
            f"SELECT COUNT(DISTINCT roaster_slug) AS c FROM products{where_sql}",
            tuple(params),
        ).fetchone()["c"]

        return ok({
            "total": total,
            "enriched": enriched,
            "failed": failed,
            "null_or_other": null_or_other,
            "by_status": by_status,
            "available": available,
            "sources": sources,
            "scope": ("roaster:" + roaster_slug) if roaster_slug else "all",
        }, resource="catalog_stats")
    finally:
        db.close()


@router.get("/admin/catalog/thin-products")
def admin_list_thin_products(slug: Optional[str] = None,
                              min_null_count: int = 5,
                              status: Optional[str] = None,
                              limit: int = 200,
                              user=Depends(get_current_user)):
    """Find products with thin information content.

    A product is "thin" when N+ of its 10 enrichment fields are null:
      origin, varietal, process, process_raw, roast_level, tasting_notes,
      flavor_notes, altitude_masl, producer, roaster_blurb.

    These are the silent-empty subset — proposals landed with
    `enrichment_status='enriched'` but the resulting row has no
    meaningful content because Haiku had nothing to work with (the
    page text was boilerplate, body_html was sparse, scraper missed
    the canonical source).

    Without this tool, agents would bypass MCP to SQL the count
    directly — that's the gap this closes (per the MCP-purity rule).

    Params:
      • slug: scope to one roaster
      • min_null_count: threshold for "thin" (default 5; 6+ flags
        majority-null products; 8+ flags catastrophically empty)
      • status: filter by enrichment_status (default: any). Use
        'enriched' to find SILENT empties; 'failed' to find loud
        empties (same as crema_proposal_breakdown surfaces).
      • limit: cap on rows (default 200).

    Returns: per-product detail with null_count, null_fields[],
    platform (joined from roaster_sources), enrichment_status.
    """
    _require_admin(user)
    min_null_count = max(0, min(int(min_null_count or 5), 10))
    limit = max(1, min(int(limit or 200), 1000))

    # The 10 fields whose nullness we measure.
    _FIELDS = [
        "origin", "varietal", "process", "process_raw", "roast_level",
        "tasting_notes", "flavor_notes", "altitude_masl",
        "producer", "roaster_blurb",
    ]
    null_count_expr = " + ".join(
        f"(CASE WHEN p.{f} IS NULL OR p.{f} = '' THEN 1 ELSE 0 END)"
        for f in _FIELDS
    )

    where = [f"({null_count_expr}) >= ?"]
    params: list = [min_null_count]
    if slug:
        where.append("p.roaster_slug = ?")
        params.append(slug)
    if status:
        where.append("p.enrichment_status = ?")
        params.append(status)
    where_sql = " WHERE " + " AND ".join(where)
    params.append(limit)

    db = get_db()
    try:
        rows = db.execute(
            f"""
            SELECT p.product_id, p.coffee_name, p.roaster_slug,
                   p.enrichment_status, p.product_url, p.image_url,
                   p.created_at,
                   ({null_count_expr}) AS null_count,
                   rs.platform AS platform
            FROM products p
            LEFT JOIN roaster_profiles rp
                ON rp.roaster_slug = p.roaster_slug
            LEFT JOIN roaster_sources rs
                ON rs.website = rp.website
            {where_sql}
            ORDER BY null_count DESC, p.roaster_slug, p.product_id
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

        out: list[dict] = []
        for r in rows:
            d = dict(r)
            # Compute the per-row null_fields list — useful for the
            # operator to see WHICH fields are missing, not just how
            # many. Re-fetch the row's actual field values for the
            # boolean check (cheap since we're already in memory).
            full = db.execute(
                "SELECT origin, varietal, process, process_raw, "
                "roast_level, tasting_notes, flavor_notes, "
                "altitude_masl, producer, roaster_blurb "
                "FROM products WHERE product_id = ?",
                (d["product_id"],),
            ).fetchone()
            null_fields = [
                f for f in _FIELDS
                if not full[f]  # null OR empty string
            ]
            d["null_fields"] = null_fields
            out.append(d)

        # Per-platform + per-roaster rollups for quick pattern read.
        platform_buckets: dict[str, int] = {}
        roaster_buckets: dict[str, int] = {}
        for d in out:
            plat = (d.get("platform") or "unknown").lower()
            platform_buckets[plat] = platform_buckets.get(plat, 0) + 1
            slug_key = d.get("roaster_slug") or "unknown"
            roaster_buckets[slug_key] = roaster_buckets.get(slug_key, 0) + 1
        rollups = {
            "by_platform": [
                {"platform": k, "count": v}
                for k, v in sorted(platform_buckets.items(),
                                     key=lambda x: -x[1])
            ],
            "by_roaster": [
                {"roaster_slug": k, "count": v}
                for k, v in sorted(roaster_buckets.items(),
                                     key=lambda x: -x[1])[:30]
            ],
        }

        return ok({
            "products": out,
            "total": len(out),
            "filter": {
                "slug": slug,
                "status": status,
                "min_null_count": min_null_count,
                "fields_checked": _FIELDS,
            },
            "rollups": rollups,
        }, resource="thin_products")
    finally:
        db.close()


@router.get("/admin/scrape/proposals/breakdown")
def admin_proposal_breakdown(group_by: str = "roaster_slug",
                              status: str = "pending",
                              change_type: Optional[str] = None,
                              enrichment_filter: Optional[str] = None,
                              user=Depends(get_current_user)):
    """Aggregate counts over scrape_proposals.

    Without this, the MCP client had to dump all proposals and group
    client-side via Python+SQLite — which broke MCP-only discipline
    and crashed on truncation for queues > ~80 rows.

    Params:
      • group_by: 'roaster_slug' | 'change_type' | 'enrichment_status' | 'status'
        — what to group by. Default 'roaster_slug'.
      • status: filter to this proposal status (default 'pending').
        Empty string = all statuses.
      • change_type: optional filter — 'insert' | 'update' | 'mark_sold_out' |
        'restore_available'. Empty/null = all.
      • enrichment_filter: optional filter on the embedded
        enrichment_status in proposed_state_json. Values:
        'enriched' | 'failed' | 'null'. Empty/null = all.

    Returns: { group_by, total, buckets: [{key, count}, ...] }
    """
    _require_admin(user)
    if group_by not in (
        "roaster_slug", "change_type", "enrichment_status", "status",
    ):
        raise HTTPException(
            400,
            "group_by must be one of roaster_slug | change_type | "
            "enrichment_status | status",
        )
    db = get_db()
    try:
        where = []
        params: list = []
        if status:
            where.append("status = ?"); params.append(status)
        if change_type:
            where.append("change_type = ?"); params.append(change_type)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        rows = db.execute(
            f"SELECT id, product_id, change_type, status, proposed_state_json "
            f"FROM scrape_proposals{where_sql}",
            tuple(params),
        ).fetchall()

        # If enrichment_filter is set, drop rows whose proposed_state's
        # enrichment_status doesn't match. We can't push this filter to
        # SQL cleanly because proposed_state_json is opaque JSON.
        if enrichment_filter or group_by == "enrichment_status":
            import json as _json
            buckets: dict[str, int] = {}
            for r in rows:
                try:
                    st = _json.loads(r["proposed_state_json"] or "{}")
                except (TypeError, ValueError):
                    st = {}
                es = st.get("enrichment_status") or "null"
                if enrichment_filter and es != enrichment_filter:
                    continue
                if group_by == "enrichment_status":
                    key = es
                elif group_by == "roaster_slug":
                    pid = r["product_id"] or ""
                    key = (st.get("roaster_slug")
                           or (pid.split("_", 1)[0] if "_" in pid else "unknown"))
                elif group_by == "change_type":
                    key = r["change_type"] or "unknown"
                else:  # status
                    key = r["status"] or "unknown"
                buckets[key] = buckets.get(key, 0) + 1
        else:
            buckets = {}
            for r in rows:
                if group_by == "roaster_slug":
                    pid = r["product_id"] or ""
                    key = pid.split("_", 1)[0] if "_" in pid else "unknown"
                elif group_by == "change_type":
                    key = r["change_type"] or "unknown"
                else:  # status
                    key = r["status"] or "unknown"
                buckets[key] = buckets.get(key, 0) + 1

        bucket_list = sorted(
            ({"key": k, "count": v} for k, v in buckets.items()),
            key=lambda x: -x["count"],
        )
        return ok({
            "group_by": group_by,
            "filter": {
                "status": status or None,
                "change_type": change_type,
                "enrichment_filter": enrichment_filter,
            },
            "total": sum(buckets.values()),
            "buckets": bucket_list,
        }, resource="proposal_breakdown")
    finally:
        db.close()


@router.get("/admin/roasters/freshness")
def admin_freshness_report(user=Depends(get_current_user)):
    """Per-roaster freshness — last_scraped_at + age buckets.

    Without this, the MCP client had to query roaster_sources via SQL
    to answer 'how stale is the catalog?'. This endpoint surfaces the
    same data through the MCP boundary.

    Returns:
        {
          summary: { fresh_le_1d, stale_gt_1d, stale_gt_7d, never_scraped },
          roasters: [
            { slug, name, last_scraped_at, age_days, bucket }, ...
          ],
        }
    """
    _require_admin(user)
    import datetime as _dt
    db = get_db()
    try:
        rows = db.execute(
            """
            SELECT rp.roaster_slug AS slug,
                   rp.name AS name,
                   rs.last_scraped_at AS last_scraped_at
            FROM roaster_profiles rp
            LEFT JOIN roaster_sources rs ON rs.website = rp.website
            WHERE rp.published = 1
            """
        ).fetchall()

        now = _dt.datetime.now(_dt.timezone.utc)
        summary = {
            "fresh_le_1d": 0,
            "stale_gt_1d": 0,
            "stale_gt_7d": 0,
            "never_scraped": 0,
        }
        out_rows: list[dict] = []
        for r in rows:
            ts = r["last_scraped_at"]
            age_days = None
            bucket = "never_scraped"
            if ts:
                try:
                    d = _dt.datetime.fromisoformat(
                        ts.replace("Z", "+00:00")
                    ).astimezone(_dt.timezone.utc)
                    age_days = (now - d).days
                    if age_days <= 1:
                        bucket = "fresh_le_1d"
                    elif age_days <= 7:
                        bucket = "stale_gt_1d"
                    else:
                        bucket = "stale_gt_7d"
                except (ValueError, AttributeError):
                    bucket = "never_scraped"
            summary[bucket] += 1
            out_rows.append({
                "slug": r["slug"],
                "name": r["name"],
                "last_scraped_at": ts,
                "age_days": age_days,
                "bucket": bucket,
            })
        # Sort: never_scraped first, then stale_gt_7d, stale_gt_1d, fresh.
        bucket_order = {
            "never_scraped": 0,
            "stale_gt_7d":   1,
            "stale_gt_1d":   2,
            "fresh_le_1d":   3,
        }
        out_rows.sort(key=lambda r: (
            bucket_order.get(r["bucket"], 9),
            -(r["age_days"] or 0),
        ))
        return ok({
            "summary": summary,
            "roasters": out_rows,
        }, resource="freshness_report")
    finally:
        db.close()


@router.post("/admin/scrape/proposals/approve")
def admin_approve_proposals(body: dict, user=Depends(get_current_user)):
    """Approve one or more proposals. Body: { ids: int[] }."""
    _require_admin(user)
    ids = (body or {}).get("ids") or []
    if not isinstance(ids, list) or not ids:
        from fastapi import HTTPException
        raise HTTPException(422, "ids[] is required")
    db = get_db()
    try:
        return ok(catalog_ops.approve_proposals(db, ids), resource="scrape_proposals")
    finally:
        db.close()


@router.post("/admin/scrape/proposals/reject")
def admin_reject_proposals(body: dict, user=Depends(get_current_user)):
    """Reject (discard) one or more pending proposals. Body: { ids: int[] }."""
    _require_admin(user)
    ids = (body or {}).get("ids") or []
    if not isinstance(ids, list) or not ids:
        from fastapi import HTTPException
        raise HTTPException(422, "ids[] is required")
    db = get_db()
    try:
        return ok(catalog_ops.reject_proposals(db, ids), resource="scrape_proposals")
    finally:
        db.close()


# Completeness-check rules — fixed list, applied to every proposal that
# has `is_coffee_bean=true` to decide approve-vs-hold-for-review.
#
# Each rule is a callable `(state, name_lower, process_lower) -> reason or None`.
# If a rule returns a string reason, the proposal is HELD; if all rules
# return None, the proposal is APPROVED.
#
# These rules encode the actual data bugs we've observed during sweeps:
#   • Haiku conflating species (Arabica/Robusta) with varietal cultivar.
#   • Haiku tagging barrel-aging spirits (Bourbon/Whiskey/Rum) as varietal.
#   • Missing required fields like roast_level, weight_grams, coffee_name.
#   • Empty roaster_blurb after the prompt-patch fallback was added.

_SPECIES_TERMS = {"arabica", "robusta", "liberica", "excelsa", "blend"}
_BARREL_SPIRITS = {"bourbon", "whiskey", "whisky", "rum", "wine", "agave"}
_BARREL_KEYWORDS = ("barrel", "barrel-aged", "barrel aged", "aged in",
                     "cask", "casked")
_VALID_ROAST_LEVELS = {
    "Light", "Medium-Light", "Medium", "Medium-Dark", "Dark", "Espresso",
}


def _str_or_empty(v) -> str:
    """Defensive coercion — Haiku occasionally outputs ints/floats where
    strings are expected (e.g. roast_level=2 instead of 'Medium'). Treat
    non-strings as empty so downstream `.strip()` / membership checks
    don't crash. The schema-violation itself is flagged separately so
    the proposal is held for review."""
    if v is None:
        return ""
    return str(v) if not isinstance(v, str) else v


def _completeness_violations(state: dict) -> list[str]:
    """Return a list of human-readable violation reasons. Empty list = passes."""
    reasons: list[str] = []
    # Detect schema-type violations up front (Haiku occasionally outputs
    # an int where a string-enum is required, etc.) — these are held
    # for review regardless of the downstream checks.
    raw_roast_level = state.get("roast_level")
    if raw_roast_level is not None and not isinstance(raw_roast_level, str):
        reasons.append(
            f"roast_level={raw_roast_level!r} has type "
            f"{type(raw_roast_level).__name__!r} (must be a string from the enum)"
        )

    name = _str_or_empty(state.get("coffee_name")).strip()
    name_lower = name.lower()
    varietal = _str_or_empty(state.get("varietal")).strip()
    varietal_lower = varietal.lower()
    process_raw = _str_or_empty(state.get("process_raw")).strip()
    process_raw_lower = process_raw.lower()
    process = _str_or_empty(state.get("process")).strip()
    bean_type = state.get("bean_type")
    roast_level = _str_or_empty(state.get("roast_level")).strip()
    blurb = _str_or_empty(state.get("roaster_blurb")).strip()
    flavor_notes = state.get("flavor_notes") or []
    tasting_notes = _str_or_empty(state.get("tasting_notes")).strip()
    weight_grams = state.get("weight_grams")
    price_inr = state.get("price_inr")

    # Required identity fields ────────────────────────────────────────────
    if not name:
        reasons.append("coffee_name is empty")
    if not roast_level or roast_level == "Unknown":
        reasons.append(f"roast_level={roast_level!r} (not in the valid enum)")
    elif roast_level not in _VALID_ROAST_LEVELS:
        reasons.append(f"roast_level={roast_level!r} (not in valid enum)")
    if weight_grams is None or (isinstance(weight_grams, (int, float))
                                  and weight_grams <= 0):
        reasons.append(f"weight_grams={weight_grams!r} (must be > 0)")
    if price_inr is None or (isinstance(price_inr, (int, float))
                              and price_inr <= 0):
        reasons.append(f"price_inr={price_inr!r} (must be > 0)")

    # Varietal sanity ─────────────────────────────────────────────────────
    if varietal:
        # Split by common delimiters to validate each token individually.
        tokens = [t.strip().lower()
                  for t in varietal.replace("+", ",").split(",")
                  if t.strip()]
        # Species names in varietal field
        species_in_varietal = [t for t in tokens if t in _SPECIES_TERMS]
        if species_in_varietal:
            reasons.append(
                f"varietal={varietal!r} contains species name(s) "
                f"{species_in_varietal!r} — species belongs in bean_type"
            )
        # Barrel-spirit in varietal when product is barrel-aged
        is_barrel_context = (
            any(k in name_lower for k in _BARREL_KEYWORDS)
            or any(k in process_raw_lower for k in _BARREL_KEYWORDS)
            or any(k in process.lower() for k in _BARREL_KEYWORDS)
        )
        spirits_in_varietal = [t for t in tokens if t in _BARREL_SPIRITS]
        if is_barrel_context and spirits_in_varietal:
            reasons.append(
                f"varietal={varietal!r} contains barrel-spirit(s) "
                f"{spirits_in_varietal!r} with barrel-aging context — "
                f"spirits belong in process_raw, not varietal"
            )

    # Bean type sanity ────────────────────────────────────────────────────
    if bean_type and bean_type not in (
        "Arabica", "Robusta", "Liberica", "Excelsa", "Blend",
    ):
        reasons.append(
            f"bean_type={bean_type!r} (must be one of "
            f"Arabica/Robusta/Liberica/Excelsa/Blend or null)"
        )

    # Narrative / blurb ───────────────────────────────────────────────────
    if not blurb:
        reasons.append("roaster_blurb is empty/null")

    # Flavor info ─────────────────────────────────────────────────────────
    if not flavor_notes and not tasting_notes:
        reasons.append("no flavor_notes AND no tasting_notes (page yielded no flavor info)")

    return reasons


@router.post("/admin/scrape/proposals/auto-approve")
def admin_auto_approve_proposals(body: Optional[dict] = None,
                                   user=Depends(get_current_user)):
    """Apply an auto-approval policy across all pending proposals with
    completeness checks layered on top of the is_coffee_bean filter.

    Three-way outcome per proposal:
      • **approve** — `is_coffee_bean=true` AND all completeness checks
        pass. Applied to live `products` row via catalog_ops.approve.
      • **reject** — `is_coffee_bean=false` (workshop/merch/equipment).
        Discards the proposal; live row untouched.
      • **hold_for_review** — `is_coffee_bean=true` BUT one or more
        completeness checks failed (varietal contains a species name,
        roast_level missing, blurb empty, etc.). The proposal stays
        `pending` for the admin to review per-card. The response body
        returns `held: [{id, reasons: [...]}, ...]` so the operator
        knows what to fix.

    `skipped` covers proposals where `is_coffee_bean` is missing/null —
    those can't be classified.

    Body (all optional):
      • slug: scope to one roaster
      • since: ISO8601 lower bound on `created_at`
      • dry_run: count only, don't mutate
      • strict_checks: bool (default True) — when False, falls back to
        the original is_coffee_bean-only policy (legacy mode)

    Returns: {approved, rejected, held_for_review, skipped, dry_run,
              held: [{id, coffee_name, reasons}, ...]}

    Completeness checks (when strict_checks=True):
      • Required: coffee_name, roast_level (valid enum), weight_grams>0,
        price_inr>0, roaster_blurb non-empty.
      • Either flavor_notes (array) OR tasting_notes (string) must be
        populated — empty both means Haiku found nothing usable.
      • varietal must not contain species names (Arabica/Robusta/etc.) —
        those belong in bean_type. Multi-value varietals (e.g.
        'Catuai + Bourbon') are validated token-by-token.
      • varietal must not contain barrel-spirit names (Bourbon/Whiskey/
        Rum/Wine/Agave) when the product is barrel-aged. Barrel context
        is detected via 'barrel'/'cask'/'aged in' in coffee_name,
        process_raw, or process.
      • bean_type must be a valid species enum value or null.
    """
    _require_admin(user)
    body = body or {}
    scope_slug = (body.get("slug") or "").strip() or None
    since = (body.get("since") or "").strip() or None
    dry_run = bool(body.get("dry_run"))
    strict_checks = body.get("strict_checks")
    if strict_checks is None:
        # Default to PERMISSIVE: approve everything Haiku enriched.
        # The completeness checks were deplatforming too many coffees
        # — perfect-info schema completeness isn't worth the cost of
        # leaving the catalog half-empty. Operator can opt-in to the
        # strict policy via {strict_checks: true}.
        strict_checks = False

    db = get_db()
    try:
        import json as _json
        where = ["status = 'pending'"]
        params: list = []
        if scope_slug:
            where.append("product_id LIKE ?")
            params.append(f"{scope_slug}_%")
        if since:
            where.append("created_at >= ?")
            params.append(since)
        where_sql = " AND ".join(where)
        rows = db.execute(
            f"SELECT id, proposed_state_json FROM scrape_proposals "
            f"WHERE {where_sql} ORDER BY id ASC",
            tuple(params),
        ).fetchall()

        approve_ids: list[int] = []
        reject_ids: list[int] = []
        held: list[dict] = []
        skipped = 0

        for r in rows:
            try:
                state = _json.loads(r["proposed_state_json"] or "{}")
            except Exception:
                skipped += 1
                continue
            # Non-coffee products are already auto-rejected at scrape time
            # (they land directly in status='rejected', not pending), so
            # pending proposals are implicitly "coffee beans". Use
            # `enrichment_status` as the gate instead — that's what's
            # actually stored on proposed_state_json.
            es = state.get("enrichment_status")
            if es == "failed":
                # Haiku enrichment failed — fields are null. Hold for
                # re-enrich; don't apply null overwrites to live rows.
                held.append({
                    "id": r["id"],
                    "coffee_name": state.get("coffee_name"),
                    "reasons": ["enrichment_status='failed' (Haiku run errored — re-enrich first)"],
                })
                continue
            if es != "enriched":
                # 'deferred' / null / something else — can't classify
                skipped += 1
                continue
            # enrichment_status='enriched' → run completeness checks
            if strict_checks:
                violations = _completeness_violations(state)
                if violations:
                    held.append({
                        "id": r["id"],
                        "coffee_name": state.get("coffee_name"),
                        "reasons": violations,
                    })
                    continue
            approve_ids.append(r["id"])

        if dry_run:
            return ok({
                "approved": len(approve_ids),
                "rejected": len(reject_ids),
                "held_for_review": len(held),
                "skipped": skipped,
                "dry_run": True,
                "strict_checks": strict_checks,
                "approved_ids": approve_ids,
                "rejected_ids": reject_ids,
                "held": held,
            }, resource="scrape_proposals")

        approved_summary = (catalog_ops.approve_proposals(db, approve_ids)
                              if approve_ids else {"applied": 0})
        rejected_summary = (catalog_ops.reject_proposals(db, reject_ids)
                              if reject_ids else {"rejected": 0})
        return ok({
            "approved": len(approve_ids),
            "rejected": len(reject_ids),
            "held_for_review": len(held),
            "skipped": skipped,
            "dry_run": False,
            "strict_checks": strict_checks,
            "approved_summary": approved_summary,
            "rejected_summary": rejected_summary,
            "held": held,
        }, resource="scrape_proposals")
    finally:
        db.close()


@router.post("/admin/scrape/jobs/{job_id}/undo")
def admin_undo_job(job_id: int, user=Depends(get_current_user)):
    """Reverse every applied proposal from a scrape (or manual sold-out)
    job. Inserts get deleted (only if `source='scraped'` — roaster-claimed
    rows survive); updates / restores replay the captured `prev_state`;
    mark-sold-out flips `available=1`.

    Backfilled prior-job proposals lack a `prev_state` for updates, so
    those entries are skipped and reported in the response."""
    _require_admin(user)
    db = get_db()
    try:
        return ok(catalog_ops.undo_job(db, job_id), resource="jobs")
    finally:
        db.close()


@router.post("/admin/products/{product_id}/sold-out")
def admin_mark_product_sold_out(product_id: str, user=Depends(get_current_user)):
    """Manually flip a product to `available=0`. Logged as a proposal
    against a synthetic `manual_sold_out` job so the change is undoable
    via the same job-undo path as a scrape."""
    _require_admin(user)
    db = get_db()
    try:
        return ok(
            catalog_ops.mark_product_sold_out(db, product_id, started_by=user["id"]),
            resource="products",
        )
    finally:
        db.close()


# ── Tab 1 (ROASTERS): single-URL enrichment + publish toggle + delete ───────
# `enrich_roaster_from_url` synthesizes a profile via Sonnet; the response
# upserts into `roaster_profiles` (with `published=0` so the admin reviews
# before pushing it to Discover) and creates the matching `roaster_sources`
# row so Tab 2's scraper picks it up automatically.

from services import roaster_enricher  # noqa: E402


def _apply_roaster_enrichment(db, website: str) -> dict:
    """Synchronously fetch homepage + about-page, run Sonnet, upsert
    into roaster_profiles + roaster_sources. Used by both the async
    `/admin/roasters/enrich` job runner (background) and the legacy
    sync callers (`/admin/roasters/{slug}/re-enrich`,
    `/admin/roasters/{slug}/refresh-all`) so the upsert + COALESCE
    semantics stay in one place.

    Returns: `{slug, name, website}` for callers that just need the
    slug to refetch the registry shape themselves.

    Raises: `roaster_enricher.RoasterEnricherError` on Sonnet / fetch /
    SDK failure. Caller decides how to map (HTTPException for sync
    request handlers; mark_finished(failed) for the BackgroundTask
    runner).
    """
    result = roaster_enricher.enrich_roaster_from_url(website)
    profile = result["profile"]
    source = result["source"]

    now = _now_iso()

    # Look up by WEBSITE first — Sonnet may produce a slightly
    # different canonical name on re-enrich ("Bili Hu Coffee" →
    # "Bili Hu Coffee Roasters") which would slugify to a NEW
    # slug and orphan the 19 products in `products` that point at
    # the original slug. By matching on `website` we always reuse
    # the existing slug, so re-enrich is in-place and idempotent.
    existing_by_website = db.execute(
        "SELECT roaster_slug FROM roaster_profiles WHERE website = ?",
        (profile["website"],),
    ).fetchone()
    if existing_by_website:
        slug = existing_by_website["roaster_slug"]
    else:
        slug = profile["roaster_slug"]

    existing = db.execute(
        "SELECT roaster_slug FROM roaster_profiles WHERE roaster_slug = ?",
        (slug,),
    ).fetchone()

    specialties_json = json.dumps(profile.get("specialties") or [])
    if existing:
        # COALESCE pattern: any field Sonnet returned `None` keeps
        # whatever was already on the row. Non-null Sonnet values
        # win. Re-enrich is therefore safe — admin's manual edits
        # to city / state / etc. survive an inconclusive re-run.
        db.execute(
            "UPDATE roaster_profiles SET "
            " name = COALESCE(?, name), "
            " about_blurb = COALESCE(?, about_blurb), "
            " tagline = COALESCE(?, tagline), "
            " specialties = COALESCE(?, specialties), "
            " city = COALESCE(?, city), "
            " state = COALESCE(?, state), "
            " instagram_handle = COALESCE(?, instagram_handle), "
            " contact_email = COALESCE(?, contact_email), "
            " website = COALESCE(?, website), "
            " logo_url = COALESCE(?, logo_url), "
            " hero_image_url = COALESCE(?, hero_image_url), "
            " updated_at = ? "
            "WHERE roaster_slug = ?",
            (
                profile.get("name"),
                profile.get("about_blurb") or None,
                profile.get("tagline"),
                specialties_json if profile.get("specialties") else None,
                profile.get("city"),
                profile.get("state"),
                profile.get("instagram_handle"),
                profile.get("contact_email"),
                profile.get("website"),
                profile.get("logo_url"),
                profile.get("hero_image_url"),
                now,
                slug,
            ),
        )
    else:
        db.execute(
            "INSERT INTO roaster_profiles "
            "(roaster_slug, name, about_blurb, tagline, specialties, "
            " website, city, state, instagram_handle, contact_email, "
            " logo_url, hero_image_url, hero_crop_x, hero_crop_y, "
            " hero_zoom, published, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 50, 50, 1, 0, ?)",
            (
                slug, profile.get("name"), profile.get("about_blurb"),
                profile.get("tagline"), specialties_json,
                profile.get("website"), profile.get("city"),
                profile.get("state"), profile.get("instagram_handle"),
                profile.get("contact_email"),
                profile.get("logo_url"),
                profile.get("hero_image_url"),
                now,
            ),
        )

    # Sync the canonical name onto the linked user account's
    # display_name so feed posts show "Blue Tokai Coffee Roasters"
    # instead of the slug "blue-tokai-coffee-roasters". Bypasses
    # the registry hook because this endpoint writes SQL directly;
    # both code paths (this enrich + the registry PUT to
    # /api/roaster_profiles/{slug}) share the same helper.
    if profile.get("name"):
        from services.notifications import sync_roaster_name_to_user
        sync_roaster_name_to_user(db, slug, profile["name"])

    # Mirror onto `roaster_sources` so BEANS-tab scraping is ready
    # to go without manual data entry. Sonnet picked the
    # specialty-beans URL; we store it as `shop_url`. `enabled`
    # stays 0 — admin verifies the URL is right before turning the
    # scraper on.
    existing_src = db.execute(
        "SELECT id, shop_url, platform FROM roaster_sources WHERE website = ?",
        (profile["website"],),
    ).fetchone()
    if not existing_src:
        db.execute(
            "INSERT INTO roaster_sources "
            "(name, website, shop_url, platform, city, state, enabled, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (
                profile.get("name") or slug,
                profile["website"],
                source.get("shop_url"),
                source.get("platform"),
                profile.get("city"),
                profile.get("state"),
                now,
            ),
        )
    else:
        # COALESCE here too — admin edits to shop_url / platform
        # win over an inconclusive re-enrich.
        db.execute(
            "UPDATE roaster_sources SET "
            " shop_url = COALESCE(?, shop_url), "
            " platform = COALESCE(?, platform), "
            " city = COALESCE(?, city), "
            " state = COALESCE(?, state) "
            "WHERE id = ?",
            (
                source.get("shop_url"),
                source.get("platform"),
                profile.get("city"),
                profile.get("state"),
                existing_src["id"],
            ),
        )
    db.commit()

    return {
        "slug": slug,
        "name": profile.get("name"),
        "website": profile.get("website"),
    }


@router.post("/admin/roasters/enrich", status_code=202)
def admin_enrich_roaster(body: dict,
                          background_tasks: BackgroundTasks = None,
                          user=Depends(get_current_user)):
    """Async single-URL enrichment. Body: { website }. Returns
    `{ job_id, status: 'queued' }` immediately; the BackgroundTask
    runs Sonnet + the upsert and writes the result into the `jobs`
    row. The Roasters & Beans admin panel polls `/api/jobs/{id}` for
    completion and routes to /admin/roaster/{slug} on success.

    Was synchronous up to commit `bf485c2`; switched to the jobs
    pipeline so flipping admin sub-tabs (or app reload) doesn't lose
    the enrichment — the orphan-recovery boot pass + jobs polling
    pattern already handle reattach.
    """
    _require_admin(user)
    website = (body or {}).get("website", "").strip()
    if not website:
        from fastapi import HTTPException
        raise HTTPException(422, "website is required")

    db = get_db()
    try:
        try:
            job_id = catalog_ops.enqueue_job(db, "roaster_enrich",
                                               started_by=user["id"])
        except catalog_ops.JobConflict as e:
            from fastapi import HTTPException
            raise HTTPException(
                409, str(e), headers={"X-Live-Job-Id": str(e.live_job_id)},
            )
        # Stash the website on the job row so the runner can pick it
        # up on its own connection (BackgroundTasks fire after the
        # request-scoped `db` is closed). Re-uses log_tail because we
        # don't have a dedicated payload column and adding one means a
        # migration; the runner clears it before writing real progress.
        db.execute(
            "UPDATE jobs SET log_tail = ? WHERE id = ?",
            (json.dumps({"website": website}), job_id),
        )
        db.commit()
        background_tasks.add_task(
            catalog_ops.run_roaster_enrich_job, job_id, website=website,
        )
        return ok(
            {"job_id": job_id, "status": "queued"},
            resource="roaster_enrich_job",
        )
    finally:
        db.close()


@router.post("/admin/roasters/{slug}/re-enrich")
def admin_re_enrich_roaster(slug: str, user=Depends(get_current_user)):
    """Re-run enrichment against the existing website. Overwrites
    about_blurb / specialties / logo / hero. Admin can edit the profile
    afterwards if Sonnet got something wrong.

    This endpoint stays synchronous because the per-roaster admin page
    expects a populated profile in the response body (it re-renders
    fields inline). The list-page hero CTA has its own async-job
    endpoint above (`/admin/roasters/enrich`).
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT website FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row or not row["website"]:
            from fastapi import HTTPException
            raise HTTPException(404, f"No website on file for roaster {slug}")
        website = row["website"]

        try:
            applied = _apply_roaster_enrichment(db, website)
        except roaster_enricher.RoasterEnricherError as e:
            from fastapi import HTTPException
            if "ANTHROPIC_API_KEY" in str(e) or "isn't installed" in str(e):
                raise HTTPException(503, str(e))
            raise HTTPException(422, str(e))

        from resources.crud import get_resource_by_id
        full = get_resource_by_id(db, "roaster_profiles", applied["slug"],
                                    current_user_id=user["id"])
        return ok(full, resource="roaster_profiles")
    finally:
        db.close()


_ORCHESTRATOR_LOG = "/tmp/crema_orchestrator.log"


def _orch_log(slug: str, msg: str) -> None:
    """Print to stdout AND append to a tail-able file so MCP-only
    diagnosis is possible without raw DB access."""
    line = f"{_now_iso()} [refresh-all/{slug}] {msg}"
    print(line, flush=True)
    try:
        with open(_ORCHESTRATOR_LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass  # best-effort logging — never block the pipeline


def _orchestrate_refresh_all(
    *,
    slug: str,
    regenerate_prompt: bool,
    regenerate_article_hint: bool,
    user_id: int,
):
    """Background-task version of the refresh-all pipeline.

    Under LLM_PROVIDER=claude_code_agent (Claude operator path),
    each `call_llm()` inside the bio/scrape/article enrichers
    enqueues a row in `llm_jobs` and blocks the worker thread until
    the consumer (Claude via crema_haiku_next_job + submit) answers.
    Running this on the request thread caused the HTTP client to
    time out at ~5 min (Node fetch headersTimeout) while the route
    was still polling. Wrapping in background_tasks lets the MCP
    request return 202 immediately while the pipeline drives
    bio → bio_hint → scrape (per-product) → article scrape
    (per-article) → journal_hint sequentially in the background.

    Errors are logged but not re-raised — there's no caller to
    re-raise to once we're in BG. Failures show up in:
      - `llm_jobs.status='failed'` for per-LLM-step failures
      - the `jobs` table (catalog_ops.run_scrape_job /
        run_article_scrape_job) for scrape-level failures
    """
    from services.llm_router import set_pipeline_context
    # Stamp the contextvar so every downstream call_llm sees the
    # right slug on its enqueued row (avoids "unknown" labels).
    set_pipeline_context(roaster_slug=slug)
    _orch_log(slug, "orchestrator START")

    # Step 1 — pull website
    db = get_db()
    try:
        row = db.execute(
            "SELECT website FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row or not row["website"]:
            _orch_log(slug, "no website on file — bailing")
            return
        website = row["website"]
        _orch_log(slug, f"step1 website resolved: {website}")
    finally:
        db.close()

    # Step 2 — bio enrich (best-effort; non-fatal).
    #
    # Bio enrich pulls homepage + about-page text and runs a Haiku call
    # to produce roaster_profile fields. For Wix sites with anti-bot
    # walls (729-Grams, etc.), the homepage fetch sometimes fails even
    # with the Playwright fallback — but the per-product catalog scrape
    # in step 4 is INDEPENDENT and uses a different scrape path
    # (`Scraper/scraper/main.py` subprocess). Per-product enrichment +
    # image-OCR can proceed without the bio. So treat bio failure as a
    # log-and-continue rather than an orchestrator abort.
    db = get_db()
    try:
        try:
            _orch_log(slug, "step2 calling _apply_roaster_enrichment …")
            applied = _apply_roaster_enrichment(db, website)
            _orch_log(slug, f"step2 bio enrich complete — slug={applied.get('slug')}")
        except roaster_enricher.RoasterEnricherError as e:
            _orch_log(slug, f"step2 BIO ENRICH FAILED (RoasterEnricherError): {e}")
            _orch_log(slug, "step2 continuing past bio failure — scrape step 4 doesn't depend on bio")
        except Exception as e:
            _orch_log(slug, f"step2 BIO ENRICH FAILED (unexpected {type(e).__name__}): {e}")
            _orch_log(slug, "step2 continuing past bio failure — scrape step 4 doesn't depend on bio")
    finally:
        db.close()

    # Step 3 — pre-flight check for scrape (shop_url + platform)
    db = get_db()
    try:
        src_row = db.execute(
            "SELECT id, shop_url, platform FROM roaster_sources rs "
            "JOIN roaster_profiles rp ON rp.website = rs.website "
            "WHERE rp.roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not src_row:
            _orch_log(slug, "step3 PRE-FLIGHT FAILED — no roaster_sources row after enrich")
            return
        if not src_row["shop_url"] or not src_row["platform"]:
            _orch_log(slug, f"step3 PRE-FLIGHT FAILED — shop_url={src_row['shop_url']!r}, "
                            f"platform={src_row['platform']!r} after enrich")
            return
        _orch_log(slug, f"step3 pre-flight OK — shop_url={src_row['shop_url']!r}, "
                        f"platform={src_row['platform']!r}")

        # Step 4 — kick the per-roaster scrape + article scrape threads.
        # These use the new mutex-free runners (catalog_ops.scrape_one_roaster
        # + article_scrape_one_roaster) which isolate each scrape's
        # subprocess to /tmp/crema-scrape/{slug}-{ts}/, so multiple
        # roasters can refresh concurrently without colliding on the
        # legacy global Scraper/input + Scraper/output files. The
        # visibility jobs row is still written (with bypass_mutex=True)
        # so the admin's "Recent Enrichment Runs" panel keeps working
        # and scrape_proposals.job_id FK stays valid.
        import threading

        threading.Thread(
            target=catalog_ops.scrape_one_roaster,
            kwargs={
                "roaster_slug": slug,
                "user_id": user_id,
                "regenerate_prompt": regenerate_prompt,
            },
            daemon=True,
        ).start()
        _orch_log(slug, "step4 scrape thread dispatched (per-roaster workspace, no mutex)")

        threading.Thread(
            target=catalog_ops.article_scrape_one_roaster,
            kwargs={
                "roaster_slug": slug,
                "user_id": user_id,
                "regenerate_article_hint": regenerate_article_hint,
            },
            daemon=True,
        ).start()
        _orch_log(slug, "step4 article scrape thread dispatched (no mutex)")
        _orch_log(slug, "orchestrator DONE — both scrape threads running concurrently")
    finally:
        db.close()


@router.post("/admin/roasters/{slug}/refresh-all", status_code=202)
def admin_refresh_roaster_all(
    slug: str,
    body: dict = None,
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """One-shot orchestrator: bio enrich + scrape job + article
    scrape, ALL in a single background pipeline. Returns 202
    immediately with the slug + queued flag so the client doesn't
    block on long-running LLM calls (especially under the
    Agent-fallback queue path, where each call_llm blocks a worker
    thread until Claude responds via crema_haiku_submit).

    Body:
      • regenerate_prompt: forwarded to the scrape job
      • regenerate_article_hint: forwarded to the article scrape job

    Failures land in:
      • llm_jobs.status='failed' for per-LLM-step failures
      • the `jobs` table for scrape-level failures
      • FastAPI stdout for orchestration-level failures

    Poll for progress via crema_list_llm_jobs + crema_list_jobs."""
    _require_admin(user)
    body = body or {}
    regenerate_prompt = bool(body.get("regenerate_prompt"))
    regenerate_article_hint = bool(body.get("regenerate_article_hint"))

    # Pre-flight: confirm the roaster + website exist before we
    # spend any compute. Cheap DB lookup.
    db = get_db()
    try:
        row = db.execute(
            "SELECT website FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row or not row["website"]:
            from fastapi import HTTPException
            raise HTTPException(404, f"No website on file for roaster {slug}")
    finally:
        db.close()

    # Kick the orchestration into a background task and return
    # immediately. The task drives bio → scrape → article scrape
    # sequentially; each call_llm under queue mode blocks its own
    # thread until Claude submits the response.
    background_tasks.add_task(
        _orchestrate_refresh_all,
        slug=slug,
        regenerate_prompt=regenerate_prompt,
        regenerate_article_hint=regenerate_article_hint,
        user_id=user["id"],
    )

    return ok(
        {
            "slug": slug,
            "queued": True,
            "regenerate_prompt": regenerate_prompt,
            "regenerate_article_hint": regenerate_article_hint,
            "message": "Refresh queued. Poll crema_list_llm_jobs "
                       "(or crema_list_jobs for scrape-level progress).",
        },
        resource="roaster_refresh",
    )


@router.post("/admin/roasters/{slug}/publish")
def admin_publish_roaster(slug: str, body: dict = None,
                            user=Depends(get_current_user)):
    """Toggle the Discover-visibility flag. Body: { published: 0 | 1 }."""
    _require_admin(user)
    if body is None:
        body = {}
    desired = body.get("published")
    if desired not in (0, 1):
        from fastapi import HTTPException
        raise HTTPException(422, "published must be 0 or 1")
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE roaster_profiles SET published = ?, updated_at = ? "
            "WHERE roaster_slug = ?",
            (desired, _now_iso(), slug),
        )
        db.commit()
        if cur.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        return ok({"roaster_slug": slug, "published": desired},
                    resource="roaster_profiles")
    finally:
        db.close()


@router.put("/admin/roasters/{slug}/scrape-settings")
def admin_update_scrape_settings(slug: str, body: dict,
                                   user=Depends(get_current_user)):
    """Update the scrape-side fields on the `roaster_sources` row that
    matches this roaster's website. Body accepts `{ shop_url, platform,
    enabled }`; absent keys are left untouched. Returns the updated
    source row.

    The drawer in Tab 1 ROASTERS uses this so the admin can fill in
    `shop_url` + `platform` + flip `enabled` to 1 without leaving the
    profile context — that's what unlocks the roaster for BEANS-tab
    scraping."""
    _require_admin(user)
    db = get_db()
    try:
        prof = db.execute(
            "SELECT roaster_slug, name, website, city, state "
            "FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not prof or not prof["website"]:
            from fastapi import HTTPException
            raise HTTPException(404, f"No website on file for roaster {slug}")

        # The 121 originally-seeded roasters carry a profile row but no
        # matching source row. Auto-create on first save so the admin
        # can fill in `shop_url` / `platform` / flip `enabled` without
        # bouncing through a separate "create source" call. New rows
        # land at `enabled=0` — scraping only turns on when the admin
        # explicitly toggles the pill in the page header.
        src = db.execute(
            "SELECT id FROM roaster_sources WHERE website = ?",
            (prof["website"],),
        ).fetchone()
        if not src:
            import datetime
            now_iso = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            db.execute(
                "INSERT INTO roaster_sources "
                "(name, website, city, state, enabled, added_at) "
                "VALUES (?, ?, ?, ?, 0, ?)",
                (
                    prof["name"] or slug,
                    prof["website"],
                    prof["city"],
                    prof["state"],
                    now_iso,
                ),
            )
            db.commit()
            src = db.execute(
                "SELECT id FROM roaster_sources WHERE website = ?",
                (prof["website"],),
            ).fetchone()

        sets = []
        params = []
        for key in ("shop_url", "platform", "enabled"):
            if key in body:
                sets.append(f"{key} = ?")
                params.append(body[key])
        if not sets:
            from fastapi import HTTPException
            raise HTTPException(422, "No valid fields to update")
        params.append(src["id"])
        db.execute(
            f"UPDATE roaster_sources SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM roaster_sources WHERE id = ?", (src["id"],)
        ).fetchone()
        return ok(dict(row), resource="roaster_sources")
    finally:
        db.close()


@router.post("/admin/products/{product_id}/re-enrich")
def admin_re_enrich_product(product_id: str, user=Depends(get_current_user)):
    """Re-run Sonnet enrichment against an existing products row,
    overwrite the four enrichment columns (process_raw, producer,
    brew_recommendation_json, enrichment_status) plus the LLM-curated
    fields (coffee_name, origin, varietal, bean_type, …).

    Used by the Library view in Tab 3 + by the per-card "Needs
    re-enrichment" affordance for rows where Sonnet failed during the
    scrape's initial pass.
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM products WHERE product_id = ?", (product_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Product {product_id} not found")
        product = dict(row)
        try:
            from services import product_enricher
            merged = product_enricher.enrich_product(product)
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(503, f"Enrichment failed: {e}")
        if merged is None:
            db.execute(
                "UPDATE products SET enrichment_status = 'failed' "
                "WHERE product_id = ?",
                (product_id,),
            )
            db.commit()
            from fastapi import HTTPException
            raise HTTPException(502, "Sonnet returned no result; row marked failed")

        brew = merged.get("brew_recommendation")
        brew_json = json.dumps(brew) if isinstance(brew, dict) else None
        flavor = merged.get("flavor_notes")
        flavor_json = json.dumps(flavor) if isinstance(flavor, list) else flavor
        db.execute(
            """
            UPDATE products SET
                coffee_name = COALESCE(?, coffee_name),
                roast_level = COALESCE(?, roast_level),
                tasting_notes = COALESCE(?, tasting_notes),
                origin = COALESCE(?, origin),
                process = COALESCE(?, process),
                varietal = COALESCE(?, varietal),
                altitude_masl = COALESCE(?, altitude_masl),
                bean_type = COALESCE(?, bean_type),
                flavor_notes = COALESCE(?, flavor_notes),
                process_raw = ?,
                producer = ?,
                brew_recommendation_json = ?,
                enrichment_status = 'enriched'
            WHERE product_id = ?
            """,
            (
                merged.get("coffee_name_clean") or merged.get("coffee_name"),
                merged.get("roast_level"),
                merged.get("tasting_notes"),
                merged.get("origin"),
                merged.get("process"),
                merged.get("varietal"),
                merged.get("altitude_masl"),
                merged.get("bean_type"),
                flavor_json,
                merged.get("process_raw"),
                merged.get("producer"),
                brew_json,
                product_id,
            ),
        )
        db.commit()
        updated = db.execute(
            "SELECT * FROM products WHERE product_id = ?", (product_id,),
        ).fetchone()
        return ok(dict(updated), resource="products")
    finally:
        db.close()


@router.delete("/admin/roasters/{slug}")
def admin_delete_roaster(slug: str, user=Depends(get_current_user)):
    """Remove the profile + cascade source row. Existing products with
    this `roaster_slug` stay in `products` (catalog data isn't
    destroyed). Before deleting we append a row to `deleted_roasters`
    so the admin can find the original website later — re-enrichment
    from the same URL recreates the profile if the deletion was a
    mistake."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT roaster_slug, name, website, city, state "
            "FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        # Log first so the audit row survives even if the DELETE step
        # below trips a constraint and we have to abort.
        import datetime
        now_iso = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        db.execute(
            "INSERT INTO deleted_roasters "
            "(roaster_slug, name, website, city, state, deleted_at, deleted_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                row["roaster_slug"],
                row["name"],
                row["website"],
                row["city"],
                row["state"],
                now_iso,
                user["id"],
            ),
        )
        db.execute("DELETE FROM roaster_profiles WHERE roaster_slug = ?", (slug,))
        if row["website"]:
            db.execute(
                "DELETE FROM roaster_sources WHERE website = ?",
                (row["website"],),
            )
        db.commit()
        return ok({"deleted": slug}, resource="roaster_profiles")
    finally:
        db.close()


# ── Admin: Roaster Journal ──────────────────────────────────────────────────
# Per-roaster + bulk article scrape endpoints. Mirrors the
# /admin/scrape/run + /admin/roasters/{slug}/refresh-all wiring (enqueue
# job → BackgroundTasks → run_article_scrape_job in catalog_ops). The
# job runner discovers the roaster's blog feed (Atom/RSS/sitemap/HTML),
# fetches each article, extracts metadata + body via bs4 + og:, and
# upserts into `roaster_articles` (idempotent on `url`).


@router.post("/admin/articles/scrape-all", status_code=202)
def admin_scrape_articles_all(body: dict = None,
                                background_tasks: BackgroundTasks = None,
                                user=Depends(get_current_user)):
    """Bulk article scrape across every published roaster, or a
    multi-select subset.
    Same conflict + BackgroundTasks pattern as /admin/scrape/run.

    Body:
      `force_enrich` (optional, default false): re-run Haiku
        enrichment for every article, even ones already marked
        enrichment_status='enriched'. Use after a prompt change or
        when the admin notices systemic body-extraction issues.
      `roaster_slugs` (optional, list[str]): scope the scrape to
        these slugs only. Empty/absent = every published roaster.
        The Layer-C2 multi-select sticky CTA posts this.
      `regenerate_article_hint` (optional, default false): force
        per-roaster site-quirk hint regeneration for every roaster
        touched in this run, even if a cached hint exists.
    """
    _require_admin(user)
    body = body or {}
    force_enrich = bool(body.get("force_enrich"))
    raw_slugs = body.get("roaster_slugs") or []
    if not isinstance(raw_slugs, list):
        from fastapi import HTTPException
        raise HTTPException(422, "roaster_slugs must be a list of strings")
    roaster_slugs = [str(s).strip() for s in raw_slugs if str(s).strip()] or None
    regenerate_hint = bool(body.get("regenerate_article_hint"))
    db = get_db()
    try:
        try:
            job_id = catalog_ops.enqueue_job(
                db, "article_scrape", started_by=user["id"],
            )
        except catalog_ops.JobConflict as e:
            from fastapi import HTTPException
            raise HTTPException(
                409, str(e), headers={"X-Live-Job-Id": str(e.live_job_id)},
            )
        background_tasks.add_task(
            catalog_ops.run_article_scrape_job, job_id,
            roaster_slug=None, roaster_slugs=roaster_slugs,
            force_enrich=force_enrich,
            regenerate_article_hint=regenerate_hint,
        )
        return ok(_job_to_response(db, job_id), resource="jobs")
    finally:
        db.close()


@router.post("/admin/roasters/{slug}/scrape-articles", status_code=202)
def admin_scrape_articles_one(slug: str, body: dict = None,
                                background_tasks: BackgroundTasks = None,
                                user=Depends(get_current_user)):
    """Per-roaster article scrape — what the per-roaster admin page's
    "Refresh articles" button posts. Same job kind as the bulk endpoint
    so both share the active-job gate (only one article_scrape can be
    in flight at a time).

    Body:
      `force_enrich` (optional, default false): re-run Haiku for every
        article, even already-enriched ones.
      `regenerate_article_hint` (optional, default false): force
        site-quirk hint regeneration for this roaster, even if a
        cached hint exists.
    """
    _require_admin(user)
    body = body or {}
    force_enrich = bool(body.get("force_enrich"))
    regenerate_hint = bool(body.get("regenerate_article_hint"))
    db = get_db()
    try:
        prof = db.execute(
            "SELECT roaster_slug, website FROM roaster_profiles "
            "WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not prof:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        try:
            job_id = catalog_ops.enqueue_job(
                db, "article_scrape", started_by=user["id"],
            )
        except catalog_ops.JobConflict as e:
            from fastapi import HTTPException
            raise HTTPException(
                409, str(e), headers={"X-Live-Job-Id": str(e.live_job_id)},
            )
        background_tasks.add_task(
            catalog_ops.run_article_scrape_job, job_id,
            roaster_slug=slug, force_enrich=force_enrich,
            regenerate_article_hint=regenerate_hint,
        )
        return ok(_job_to_response(db, job_id), resource="jobs")
    finally:
        db.close()


@router.get("/admin/roasters/{slug}/article-hint")
def admin_get_article_hint(slug: str, user=Depends(get_current_user)):
    """Return the per-roaster article-extraction site-quirk hint +
    its updated_at stamp + the perpetual force-regenerate flag. Used
    by the admin Journals inline-expand row's hint card. Returns 404
    if the roaster doesn't exist; the hint text being null is a
    normal response shape (no hint generated yet — first scrape will
    create one)."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT roaster_slug, name, "
            "  article_enrichment_prompt_hint, "
            "  article_enrichment_prompt_hint_updated_at, "
            "  article_hint_force_regenerate "
            "FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        return ok({
            "roaster_slug": row["roaster_slug"],
            "roaster_name": row["name"],
            "article_enrichment_prompt_hint":
                row["article_enrichment_prompt_hint"],
            "article_enrichment_prompt_hint_updated_at":
                row["article_enrichment_prompt_hint_updated_at"],
            "article_hint_force_regenerate":
                int(row["article_hint_force_regenerate"] or 0),
        }, resource="roaster_profiles")
    finally:
        db.close()


@router.post("/admin/roasters/{slug}/article-hint/regenerate-flag")
def admin_set_article_hint_regen_flag(slug: str, body: dict = None,
                                         user=Depends(get_current_user)):
    """Toggle the perpetual `article_hint_force_regenerate` flag on a
    roaster. While set to 1, every `article_scrape` pass for this
    roaster regenerates the site-quirk hint via the Sonnet meta-call
    (~$0.03 per regen). The flag never auto-clears — admins flip it
    back off when satisfied with the hint.

    Body: `{ "enabled": 0 | 1 | true | false }`.
    """
    _require_admin(user)
    body = body or {}
    raw = body.get("enabled")
    enabled = 1 if raw in (1, True, "1", "true") else 0
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE roaster_profiles "
            "SET article_hint_force_regenerate = ? "
            "WHERE roaster_slug = ?",
            (enabled, slug),
        )
        if cur.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        db.commit()
        return ok(
            {"roaster_slug": slug,
             "article_hint_force_regenerate": enabled},
            resource="roaster_profiles",
        )
    finally:
        db.close()


@router.get("/admin/roasters/{slug}/diff-hint")
def admin_get_diff_hint(slug: str, user=Depends(get_current_user)):
    """Return the per-roaster diff-interpretation hint + updated_at.
    Used by the Refresh Catalog tab's per-roaster page (admin/refresh/[slug])
    so the admin can read what the LLM will use to interpret storefront
    diffs (e.g. "ignore gift-card SKUs", "this roaster archives via
    available=false").

    The hint is admin-written (not Sonnet-generated like bio + article
    hints) since the diff interpretation is a roaster-specific filter,
    not a content-extraction quirk."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT roaster_slug, name, "
            "  diff_prompt_hint, diff_prompt_hint_updated_at "
            "FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        return ok({
            "roaster_slug": row["roaster_slug"],
            "roaster_name": row["name"],
            "diff_prompt_hint": row["diff_prompt_hint"],
            "diff_prompt_hint_updated_at": row["diff_prompt_hint_updated_at"],
        }, resource="roaster_profiles")
    finally:
        db.close()


@router.put("/admin/roasters/{slug}/diff-hint")
def admin_set_diff_hint(slug: str, body: dict = None,
                          user=Depends(get_current_user)):
    """Save the per-roaster diff-interpretation hint. Body:
    `{ "hint": "free-text hint, may be empty to clear" }`.

    Stamps the updated_at to now. The hint is plain text — the LLM
    consumes it as a system addendum when interpreting the snapshot
    diff during a Tab 2 refresh."""
    _require_admin(user)
    body = body or {}
    raw = body.get("hint")
    hint = raw.strip() if isinstance(raw, str) else None
    if hint == "":
        hint = None
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE roaster_profiles "
            "SET diff_prompt_hint = ?, "
            "    diff_prompt_hint_updated_at = ? "
            "WHERE roaster_slug = ?",
            (hint, _now_iso(), slug),
        )
        if cur.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")
        db.commit()
        row = db.execute(
            "SELECT diff_prompt_hint, diff_prompt_hint_updated_at "
            "FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        return ok({
            "roaster_slug": slug,
            "diff_prompt_hint": row["diff_prompt_hint"],
            "diff_prompt_hint_updated_at":
                row["diff_prompt_hint_updated_at"],
        }, resource="roaster_profiles")
    finally:
        db.close()


@router.get("/admin/articles")
def admin_list_articles(roaster_slug: Optional[str] = None,
                          limit: int = 100, offset: int = 0,
                          include_hidden: int = 1,
                          user=Depends(get_current_user)):
    """List articles for the admin sub-tab. Includes `published=0`
    rows by default (admin needs to see hidden ones to un-hide); pass
    `include_hidden=0` to mirror the consumer-side filter. No
    rp.published filter — admin sees articles even from unreviewed
    roasters."""
    _require_admin(user)
    limit = max(1, min(int(limit or 100), 500))
    offset = max(0, int(offset or 0))
    where = ["1=1"]
    args: list = []
    if roaster_slug:
        where.append("a.roaster_slug = ?")
        args.append(roaster_slug)
    if not include_hidden:
        where.append("a.published = 1")
    where_sql = " AND ".join(where)
    db = get_db()
    try:
        rows = db.execute(
            f"SELECT a.id, a.roaster_slug, a.url, a.title, a.excerpt, "
            "a.image_url, a.word_count, a.published_at, a.scraped_at, "
            "a.published, a.enrichment_status, a.is_about_coffee, "
            "a.topic_category, a.tags, rp.name AS roaster_name, "
            "rp.logo_url AS roaster_logo_url "
            "FROM roaster_articles a "
            "LEFT JOIN roaster_profiles rp ON rp.roaster_slug = a.roaster_slug "
            f"WHERE {where_sql} "
            "ORDER BY COALESCE(a.published_at, a.scraped_at) DESC, a.id DESC "
            "LIMIT ? OFFSET ?",
            (*args, limit, offset),
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) AS c FROM roaster_articles a WHERE {where_sql}",
            args,
        ).fetchone()["c"]
        return ok([_hydrate_article_row(dict(r)) for r in rows],
                  resource="roaster_articles",
                  meta={"total": total, "limit": limit, "offset": offset})
    finally:
        db.close()


def _hydrate_article_row(row: dict) -> dict:
    """Decode the JSON `tags` column into a real list so the admin
    UI doesn't have to JSON.parse on each row. Empty / unparseable
    tags become an empty array — never null — so the frontend can
    render `tags.map(...)` without an undefined check."""
    raw = row.get("tags")
    if raw:
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, list):
                row["tags"] = [
                    str(t) for t in decoded if isinstance(t, str)
                ]
            else:
                row["tags"] = []
        except (TypeError, ValueError):
            row["tags"] = []
    else:
        row["tags"] = []
    return row


@router.post("/admin/articles/{article_id}/publish")
def admin_toggle_article_published(article_id: int, body: dict = None,
                                      user=Depends(get_current_user)):
    """Toggle the consumer-visibility flag. Body: { published: 0 | 1 }."""
    _require_admin(user)
    if body is None:
        body = {}
    desired = body.get("published")
    if desired not in (0, 1):
        from fastapi import HTTPException
        raise HTTPException(422, "published must be 0 or 1")
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE roaster_articles SET published = ? WHERE id = ?",
            (desired, article_id),
        )
        db.commit()
        if cur.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(404, f"Article {article_id} not found")
        return ok({"id": article_id, "published": desired},
                    resource="roaster_articles")
    finally:
        db.close()


@router.delete("/admin/articles/{article_id}")
def admin_delete_article(article_id: int, user=Depends(get_current_user)):
    """Hard-delete an article. Re-scraping the roaster will re-insert
    if the URL still resolves (URL is the dedup key) — so use this for
    truly stale entries, not for hiding."""
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT roaster_slug FROM roaster_articles WHERE id = ?",
            (article_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Article {article_id} not found")
        slug = row["roaster_slug"]
        db.execute("DELETE FROM roaster_articles WHERE id = ?", (article_id,))
        # Refresh the denormalized articles_count on the source row so
        # the admin Roasters & Beans list doesn't drift from reality.
        new_count = db.execute(
            "SELECT COUNT(*) AS c FROM roaster_articles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()["c"]
        db.execute(
            "UPDATE roaster_sources rs SET articles_count = ? "
            "WHERE rs.website IN ("
            "  SELECT website FROM roaster_profiles WHERE roaster_slug = ?"
            ")",
            (new_count, slug),
        )
        db.commit()
        return ok({"deleted": article_id}, resource="roaster_articles")
    finally:
        db.close()


# ── Ad placement suggestions ─────────────────────────────────────────────────
#
# Owner-only — the roaster sees Crema's suggested in-article coffee
# placements for their JOURNAL surface. Two-column layout client-side:
# left = article title, right = compact coffee card per matched coffee.
# Below the threshold, an article shows with empty suggestions.
#
# The GET response is the EFFECTIVE state — auto-suggestions reconciled
# with persisted owner edits (kept-auto / removed-auto / added-manual).
# The PUT writes the delta. The public counterpart at
# `/articles/{id}/placements` runs the same merge for consumer readers.

@router.get("/roasters/{slug}/ads/journal")
def ads_journal_suggestions(slug: str, user=Depends(get_current_user)):
    from services.ad_placements import suggest_journal_placements
    if (user or {}).get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    db = get_db()
    try:
        results = suggest_journal_placements(slug, db)
        return ok(results, resource="ad_placements")
    finally:
        db.close()


@router.put("/roasters/{slug}/ads/journal/{article_id}")
def ads_journal_save(
    slug: str,
    article_id: int,
    body: dict,
    user=Depends(get_current_user),
):
    """Save the roaster's chosen product set for one article. Body
    shape: `{ "product_ids": ["sku-abc", "sku-def", ...] }` — the
    full effective list AFTER the edit, in display order. The service
    layer diffs against auto-suggestions + the current persisted
    state and writes the minimum delta.

    Validation deliberately stays light:
      • the (user, roaster_slug) gate is the owner check
      • product_ids beyond the roaster's catalog get filtered inside
        `apply_placement_delta` (they fall out of the join silently)
      • an article belonging to a different roaster returns []
    """
    from services.ad_placements import apply_placement_delta
    if (user or {}).get("roaster_slug") != slug:
        raise HTTPException(403, "Not your roaster")
    product_ids = body.get("product_ids") or []
    if not isinstance(product_ids, list):
        raise HTTPException(400, "product_ids must be a list")
    # Defensive type-check — accept only string ids so a stray int
    # doesn't poison the table.
    product_ids = [pid for pid in product_ids if isinstance(pid, str) and pid]
    db = get_db()
    try:
        effective = apply_placement_delta(slug, article_id, product_ids, db)
        return ok(
            {"article_id": article_id, "placements": effective},
            resource="ad_placements",
        )
    finally:
        db.close()


@router.get("/articles/{article_id}/placements")
def article_placements(article_id: int):
    """Public reader endpoint — returns placements bucketed by
    source so the reader can render one carousel per bucket with the
    appropriate label. Each entry: `{product_id, source, roaster_slug}`
    where `source` is one of 'inline' (article body links to this
    product's product_url), 'auto' (Crema's scorer matched it), or
    'manual' (the roaster picked it). No auth — article reading is
    anonymous and the placement set is editorial, not private.
    """
    from services.ad_placements import effective_placements_for_article
    db = get_db()
    try:
        entries = effective_placements_for_article(article_id, db)
        return ok(entries, resource="article_placements")
    finally:
        db.close()


# ── Ad impressions (P1 attribution) ──────────────────────────────────────────
#
# One impression = one render of a placement to a viewer. Per-session
# unique on (session, article, product, source), so a user scrolling
# past the same placement twice within a tab session counts once
# (the right "unique impressions" reading roasters + investors care
# about). A new session (tab close + reopen, app restart, sessionStorage
# clear) gets fresh impressions — that's the reach-over-time number.
#
# Anonymous viewers count too (user_id NULL with session_id only) so
# the analytics surface can pitch "look at the traffic we generate
# even before login."

@router.post("/ad_impressions")
def post_ad_impression(body: dict, user=Depends(get_optional_user)):
    """Record one impression. Idempotent — same (session, article,
    product, source) collapses to one row via UNIQUE constraint;
    repeat POSTs silently succeed. Returns the impression id so the
    client can correlate with a subsequent click if needed.

    Body shape:
      {
        "session_id": "<uuid-from-client>",
        "article_id": 1006,
        "product_id": "black-baza-coffee_potter-wasp",
        "placement_source": "inline" | "auto" | "manual",
        "roaster_slug": "black-baza-coffee"
      }
    """
    import datetime as _dt
    session_id = (body.get("session_id") or "").strip()
    article_id = body.get("article_id")
    product_id = (body.get("product_id") or "").strip()
    placement_source = (body.get("placement_source") or "").strip()
    roaster_slug = (body.get("roaster_slug") or "").strip()
    if not session_id or not isinstance(article_id, int) or not product_id \
            or placement_source not in {"inline", "auto", "manual"} \
            or not roaster_slug:
        raise HTTPException(400, "missing or invalid impression fields")
    now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    db = get_db()
    try:
        # INSERT OR IGNORE — UNIQUE constraint handles dedup. If the
        # row already exists, lastrowid is 0 and we look up the
        # existing id so the client gets a consistent response.
        cur = db.execute(
            """INSERT OR IGNORE INTO ad_impressions
               (user_id, session_id, article_id, product_id, roaster_slug,
                placement_source, seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                (user or {}).get("id"),
                session_id,
                article_id,
                product_id,
                roaster_slug,
                placement_source,
                now,
            ),
        )
        db.commit()
        impression_id = cur.lastrowid
        if not impression_id:
            row = db.execute(
                """SELECT id FROM ad_impressions
                   WHERE session_id = ? AND article_id = ? AND product_id = ?
                     AND placement_source = ?""",
                (session_id, article_id, product_id, placement_source),
            ).fetchone()
            impression_id = row["id"] if row else None
        return ok(
            {"id": impression_id, "deduped": cur.lastrowid == 0},
            resource="ad_impressions",
        )
    finally:
        db.close()


# ── Phase 2 MCP — inspect / debug / requeue endpoints ──────────────────────
# Backing routes for the catalog-ops MCP server's investigative tools:
#   crema_get_product_detail        →  GET    /admin/products/{product_id}
#   crema_delete_product            →  DELETE /admin/products/{product_id}
#   crema_get_raw_snapshot          →  GET    /admin/sync/{slug}/raw-snapshot
#   crema_get_llm_job_detail        →  GET    /admin/llm-jobs/{job_id}
#   crema_requeue_llm_job           →  POST   /admin/llm-jobs/{job_id}/requeue
#   crema_list_scrape_runs          →  GET    /admin/scrape-runs
#   crema_test_source_url           →  POST   /admin/sources/test
#
# All admin-gated. None call Anthropic — they're read/diagnostic surfaces
# for an agent operator to self-diagnose without screen-sharing the admin
# UI to a human.


@router.get("/admin/products/{product_id}")
def admin_get_product_detail(product_id: str,
                              user=Depends(get_current_user)):
    """Full products row + the most recent scrape_proposals row that
    touched it (any status). Used by the agent for per-coffee debugging —
    when an enrichment looks wrong or a field is missing, this is the
    entry point.

    Response: { product: {<full row>}, latest_proposal: {<proposal>} | null }
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM products WHERE product_id = ?", (product_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Product {product_id} not found")
        prop = db.execute(
            "SELECT id, job_id, change_type, status, created_at, "
            "applied_at, rejected_at, reverted_at, proposed_state_json "
            "FROM scrape_proposals WHERE product_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (product_id,),
        ).fetchone()
        return ok({
            "product": dict(row),
            "latest_proposal": dict(prop) if prop else None,
        }, resource="products")
    finally:
        db.close()


@router.delete("/admin/products/{product_id}")
def admin_delete_product(product_id: str,
                          user=Depends(get_current_user)):
    """Hard-delete one products row. User-side tables (shelf,
    tasting_notes) hold product_id references that go stale; those rows
    don't cascade — leave that as agent / admin responsibility.

    For 'hide from Discover but keep history', use
    /admin/products/{id}/sold-out instead. This endpoint is for truly
    broken / mis-scraped rows.
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT product_id FROM products WHERE product_id = ?",
            (product_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Product {product_id} not found")
        db.execute(
            "DELETE FROM products WHERE product_id = ?", (product_id,),
        )
        db.commit()
        return ok({"deleted": product_id}, resource="products")
    finally:
        db.close()


@router.get("/admin/sync/{slug}/raw-snapshot")
def admin_get_raw_snapshot(slug: str,
                            user=Depends(get_current_user)):
    """Return the raw scrape snapshot payload (parsed from
    crawl_snapshots.payload_json) for a roaster. This is the storefront
    capture BEFORE any diff/join enrichment. Used by the agent when
    GET /admin/sync/{slug}/snapshot's `unknown` count is high and the
    question is 'what did the crawler actually see?'.

    Returns the full parsed payload — products, articles, bio, platform,
    detected signatures. Response can be large.
    """
    _require_admin(user)
    db = get_db()
    try:
        cur = db.execute(
            "SELECT taken_at, payload_json FROM crawl_snapshots "
            "WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not cur:
            return ok({
                "slug": slug, "taken_at": None, "payload": None,
            }, resource="raw_snapshot")
        try:
            payload = json.loads(cur["payload_json"])
        except (json.JSONDecodeError, TypeError):
            payload = None
        return ok({
            "slug": slug,
            "taken_at": cur["taken_at"],
            "payload": payload,
        }, resource="raw_snapshot")
    finally:
        db.close()


@router.get("/admin/llm-jobs/{job_id}")
def admin_get_llm_job_detail(job_id: int,
                              user=Depends(get_current_user)):
    """Return the full llm_jobs row INCLUDING payloads (system_prompt,
    user_content, tool_schema_json, response_payload). Used to debug a
    specific job — failed (why? error column + last response_payload
    snapshot) or complete (what did the model produce?).

    Big response by design: payloads are kilobytes of text each.
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, roaster_slug, step, target_id, parent_run_id, "
            "model, system_prompt, tool_name, tool_schema_json, "
            "user_content, max_tokens, status, response_payload, "
            "error, agent_identity, created_at, claimed_at, completed_at "
            "FROM llm_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"llm_job {job_id} not found")
        return ok(dict(row), resource="llm_jobs")
    finally:
        db.close()


@router.post("/admin/llm-jobs/{job_id}/requeue")
def admin_requeue_llm_job(job_id: int,
                            user=Depends(get_current_user)):
    """Flip an in_progress or failed llm_job back to status='pending'.
    Clears claimed_at, agent_identity, response_payload, error,
    completed_at so crema_haiku_next_job can claim it fresh.

    Use when a job is stuck in_progress (drainer died mid-task) or when
    a failed job's failure was transient. NOTE: if the parent enrichment
    pipeline died, no one's polling for the response — the requeue
    succeeds but the eventual output goes nowhere. Use
    crema_get_llm_job_detail to read the response in that case.

    409 if the job is already pending or complete (those can't be
    requeued — pending is already-queued, complete should stay complete
    so we don't waste tokens on a re-do).
    """
    _require_admin(user)
    db = get_db()
    try:
        cur = db.execute(
            "UPDATE llm_jobs SET status = 'pending', claimed_at = NULL, "
            "agent_identity = NULL, response_payload = NULL, error = NULL, "
            "completed_at = NULL "
            "WHERE id = ? AND status IN ('in_progress', 'failed')",
            (job_id,),
        )
        db.commit()
        if cur.rowcount == 0:
            row = db.execute(
                "SELECT status FROM llm_jobs WHERE id = ?", (job_id,),
            ).fetchone()
            from fastapi import HTTPException
            if row is None:
                raise HTTPException(404, f"llm_job {job_id} not found")
            raise HTTPException(
                409, f"llm_job {job_id} is {row['status']}, cannot requeue",
            )
        return ok({"id": job_id, "status": "pending"}, resource="llm_jobs")
    finally:
        db.close()


@router.get("/admin/scrape-runs")
def admin_list_scrape_runs(roaster_slug: Optional[str] = None,
                            kind: Optional[str] = None,
                            limit: int = 50,
                            user=Depends(get_current_user)):
    """List recent scrape / article_scrape / manual_sold_out jobs with
    proposal-count summaries per job. Joins jobs → scrape_proposals
    (by job_id) → optionally filters via product_id LIKE 'slug_%' when
    roaster_slug is given.

    Returns rows of: id, kind, status, started_at, finished_at,
    started_by, error_message, result_summary, proposals_total,
    proposals_pending, proposals_applied, proposals_rejected.

    Used for 'show me scrape history for X' without manually joining
    jobs + scrape_proposals.
    """
    _require_admin(user)
    limit = max(1, min(int(limit or 50), 500))
    db = get_db()
    try:
        where = []
        params: list = []
        if kind:
            where.append("j.kind = ?")
            params.append(kind)
        if roaster_slug:
            where.append(
                "j.id IN (SELECT DISTINCT job_id FROM scrape_proposals "
                "WHERE product_id LIKE ?)"
            )
            params.append(f"{roaster_slug}_%")
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        params.append(limit)
        rows = db.execute(
            f"""
            SELECT j.id, j.kind, j.status, j.started_at, j.finished_at,
                   j.started_by, j.error_message, j.result_summary,
                   COUNT(p.id) AS proposals_total,
                   SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END)
                       AS proposals_pending,
                   SUM(CASE WHEN p.status = 'applied' THEN 1 ELSE 0 END)
                       AS proposals_applied,
                   SUM(CASE WHEN p.status = 'rejected' THEN 1 ELSE 0 END)
                       AS proposals_rejected
            FROM jobs j
            LEFT JOIN scrape_proposals p ON p.job_id = j.id
            {where_sql}
            GROUP BY j.id
            ORDER BY j.created_at DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="scrape_runs")
    finally:
        db.close()


@router.post("/admin/sources/test")
def admin_test_source_url(body: dict, user=Depends(get_current_user)):
    """Probe a URL for reachability + content metadata before onboarding.
    Body: { url: string }. Returns:
      { url, normalized_url, final_url, status, content_type,
        html_title, elapsed_ms, error? }

    10s timeout, GET (not HEAD) so SPA shells still return a meaningful
    HTML body for title extraction. Used as a pre-onboarding sanity check
    so the agent doesn't crema_onboard_roaster with a 404'ing URL.
    """
    _require_admin(user)
    raw = (body or {}).get("url", "").strip()
    if not raw:
        from fastapi import HTTPException
        raise HTTPException(422, "url is required")
    normalized = raw if raw.startswith(("http://", "https://")) else "https://" + raw
    import time
    import requests
    from bs4 import BeautifulSoup
    started = time.time()
    out: dict = {"url": raw, "normalized_url": normalized}
    try:
        resp = requests.get(
            normalized,
            timeout=10,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; CremaCatalogOps/1.0)",
            },
            allow_redirects=True,
        )
        out["status"] = resp.status_code
        out["final_url"] = resp.url
        out["content_type"] = resp.headers.get("Content-Type", "")
        out["elapsed_ms"] = int((time.time() - started) * 1000)
        if "text/html" in (out["content_type"] or "").lower():
            soup = BeautifulSoup(resp.text, "html.parser")
            title = soup.find("title")
            out["html_title"] = title.get_text(strip=True) if title else None
        else:
            out["html_title"] = None
    except requests.exceptions.RequestException as e:
        out["status"] = None
        out["error"] = str(e)
        out["elapsed_ms"] = int((time.time() - started) * 1000)
    return ok(out, resource="source_test")


# ── Agent action log + memory (the working journal) ────────────────────────
#
# Two surfaces:
#  - agent_actions: timestamped per-phase log within a session. Granularity
#    is intentionally coarser than agent_runs — one entry per meaningful
#    decision (10–20 per session), with a `reasoning` field where the agent
#    explains WHY. Human-readable activity timeline.
#  - agent_memory: durable lessons across sessions. Future agents read this
#    at session start to inherit institutional knowledge.


@router.post("/admin/agent-actions", status_code=201)
def admin_log_agent_action(body: dict, user=Depends(get_current_user)):
    """Log one agent action. Body:
      • session_id: required.
      • agent_identity: required (e.g. "crema-catalog-ops@claude-opus-4-7").
      • action: short label — what the agent did (e.g. "diff_sweep" or
        "enrich_all on 10 stale roasters").
      • reasoning: agent's own prose explaining WHY this action was taken
        (e.g. "Diff sweep showed 14 stale, 10 non-Wix actionable. These
        had real product/article deltas worth processing.").
      • metadata: optional dict — slugs touched, counts, anything
        structured.
    """
    _require_admin(user)
    body = body or {}
    session_id = (body.get("session_id") or "").strip()
    agent_identity = (body.get("agent_identity") or "").strip()
    action = (body.get("action") or "").strip()
    reasoning = (body.get("reasoning") or "").strip()
    if not all([session_id, agent_identity, action, reasoning]):
        raise HTTPException(
            422, "session_id, agent_identity, action, reasoning are required"
        )
    metadata = body.get("metadata")
    metadata_json = json.dumps(metadata) if metadata is not None else None
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO agent_actions (session_id, agent_identity, "
            "action, reasoning, metadata_json) VALUES (?, ?, ?, ?, ?)",
            (session_id, agent_identity, action, reasoning, metadata_json),
        )
        db.commit()
        return ok({"id": cur.lastrowid}, resource="agent_actions")
    finally:
        db.close()


@router.get("/admin/agent-actions")
def admin_list_agent_actions(session_id: Optional[str] = None,
                              agent_identity: Optional[str] = None,
                              since: Optional[str] = None,
                              limit: int = 100,
                              user=Depends(get_current_user)):
    """List agent actions in chronological order (oldest first within a
    session, so reading top-down reconstructs the session's timeline)."""
    _require_admin(user)
    where = []
    params: list = []
    if session_id:
        where.append("session_id = ?"); params.append(session_id)
    if agent_identity:
        where.append("agent_identity = ?"); params.append(agent_identity)
    if since:
        where.append("ts >= ?"); params.append(since)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    limit = max(1, min(int(limit or 100), 1000))
    params.append(limit)
    order = "ts ASC" if session_id else "ts DESC"
    db = get_db()
    try:
        rows = db.execute(
            f"SELECT id, session_id, agent_identity, ts, action, "
            f"reasoning, metadata_json "
            f"FROM agent_actions{where_sql} "
            f"ORDER BY {order} LIMIT ?",
            tuple(params),
        ).fetchall()
        out: list[dict] = []
        for r in rows:
            d = dict(r)
            if d.get("metadata_json"):
                try:
                    d["metadata"] = json.loads(d["metadata_json"])
                except (TypeError, ValueError):
                    d["metadata"] = None
                d.pop("metadata_json", None)
            out.append(d)
        return ok(out, resource="agent_actions", total=len(out))
    finally:
        db.close()


@router.post("/admin/agent-memory", status_code=201)
def admin_log_agent_memory(body: dict, user=Depends(get_current_user)):
    """Log a durable lesson. Body:
      • scope: required — domain bucket (e.g. "catalog-ops",
        "scrape-noise", "wix-routing", "drainer-discipline").
      • lesson: required — short actionable takeaway (one or two
        sentences). Future agents can read this at session start.
      • tags: optional list of strings — finer slicing within scope.
      • source_session_id: optional — link to the session where the
        lesson was learned.
      • source_summary_id: optional FK to agent_summaries(id).
    """
    _require_admin(user)
    body = body or {}
    scope = (body.get("scope") or "").strip()
    lesson = (body.get("lesson") or "").strip()
    if not scope or not lesson:
        raise HTTPException(422, "scope + lesson are required")
    tags = body.get("tags")
    if tags is not None and not isinstance(tags, list):
        raise HTTPException(422, "tags must be a list of strings")
    tags_json = json.dumps(tags) if tags else None
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO agent_memory (scope, lesson, tags_json, "
            "source_session_id, source_summary_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                scope, lesson, tags_json,
                body.get("source_session_id"),
                body.get("source_summary_id"),
            ),
        )
        db.commit()
        return ok({"id": cur.lastrowid, "scope": scope},
                  resource="agent_memory")
    finally:
        db.close()


@router.get("/admin/agent-memory")
def admin_list_agent_memory(scope: Optional[str] = None,
                              tag: Optional[str] = None,
                              limit: int = 50,
                              user=Depends(get_current_user)):
    """List agent memory entries. Optional filters: scope, tag. Bumps
    `reference_count` + `last_referenced_at` on each returned row so
    the operator can later see which lessons are actually load-bearing.
    """
    _require_admin(user)
    where = []
    params: list = []
    if scope:
        where.append("scope = ?"); params.append(scope)
    if tag:
        # Cheap substring match on the JSON array — works because
        # tags are quoted strings inside a flat array (no nested
        # structures with the same substring).
        where.append("tags_json LIKE ?"); params.append(f'%"{tag}"%')
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    limit = max(1, min(int(limit or 50), 500))
    params.append(limit)
    db = get_db()
    try:
        rows = db.execute(
            f"SELECT id, scope, lesson, tags_json, source_session_id, "
            f"source_summary_id, created_at, last_referenced_at, "
            f"reference_count "
            f"FROM agent_memory{where_sql} "
            f"ORDER BY created_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        ids = [r["id"] for r in rows]
        out: list[dict] = []
        for r in rows:
            d = dict(r)
            if d.get("tags_json"):
                try:
                    d["tags"] = json.loads(d["tags_json"])
                except (TypeError, ValueError):
                    d["tags"] = []
            else:
                d["tags"] = []
            d.pop("tags_json", None)
            out.append(d)
        # Bump reference counters in a single statement so the next
        # operator can see which lessons are still in use.
        if ids:
            placeholders = ",".join("?" * len(ids))
            db.execute(
                f"UPDATE agent_memory SET reference_count = reference_count + 1, "
                f"last_referenced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
                f"WHERE id IN ({placeholders})",
                tuple(ids),
            )
            db.commit()
        return ok(out, resource="agent_memory", total=len(out))
    finally:
        db.close()
