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
from services import catalog_ops, sca_geolocator, scrape_runner


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
                          user=Depends(get_current_user)):
    """List proposals — defaults to `pending` so the admin tab can show
    the approval queue. Pass `status=` (or empty string) to widen."""
    _require_admin(user)
    db = get_db()
    try:
        rows = catalog_ops.list_proposals(
            db, job_id=job_id, status=(status or None) if status != "" else None,
        )
        return ok(rows, resource="scrape_proposals", total=len(rows))
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


@router.post("/admin/roasters/{slug}/refresh-all", status_code=202)
def admin_refresh_roaster_all(
    slug: str,
    body: dict = None,
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """One-shot orchestrator: bio re-enrich (synchronous) → scrape job
    (background). Returns the freshly-saved profile + the queued
    scrape job's id so the per-roaster admin page can switch from
    "filling profile fields" to "polling catalog enrichment" without
    a second user click.

    Body:
      `regenerate_prompt` (optional): forwarded to the scrape job —
        same semantics as the existing /admin/scrape/run flag.

    Failure modes:
      - Bio enrich raises (no API key, Sonnet down, unreachable site)
        → bubbled up as the same 503/422 the underlying endpoint
        would produce, scrape job NOT enqueued. Admin gets a clean
        error with no half-applied state.
      - Scrape pre-flight fails (no shop_url / platform after enrich)
        → 422 with explicit message; bio enrich already saved.
    """
    _require_admin(user)
    body = body or {}
    regenerate_prompt = bool(body.get("regenerate_prompt"))

    # Step 1 — pull website, run bio enrich. Reuses the existing
    # admin_enrich_roaster handler so the COALESCE upsert + source
    # mirror logic stays in one place.
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
    finally:
        db.close()

    db = get_db()
    try:
        try:
            applied = _apply_roaster_enrichment(db, website)
        except roaster_enricher.RoasterEnricherError as e:
            from fastapi import HTTPException
            if "ANTHROPIC_API_KEY" in str(e) or "isn't installed" in str(e):
                raise HTTPException(503, str(e))
            raise HTTPException(422, str(e))
        from resources.crud import get_resource_by_id
        bio_data = get_resource_by_id(db, "roaster_profiles", applied["slug"],
                                        current_user_id=user["id"])
    finally:
        db.close()

    # Step 2 — re-fetch source so we know the freshly-mirrored
    # shop_url + platform (Sonnet just wrote them via the bio enrich).
    db = get_db()
    try:
        src_row = db.execute(
            "SELECT id, shop_url, platform FROM roaster_sources rs "
            "JOIN roaster_profiles rp ON rp.website = rs.website "
            "WHERE rp.roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not src_row or not src_row["shop_url"] or not src_row["platform"]:
            from fastapi import HTTPException
            raise HTTPException(
                422,
                "Bio enrichment finished but the catalog source is missing "
                "shop_url or platform. Set them manually, then run a scrape.",
            )

        # Step 3 — enqueue the scrape job. Same conflict + background-
        # task wiring as /admin/scrape/run.
        #
        # On JobConflict: bio enrichment already landed; surfacing a
        # 409 here would make the frontend treat the whole call as a
        # failure and bury the bio's partial-success signal. Instead
        # return 200 with `job=None` and a `scrape_blocked_by_job_id`
        # hint so the admin sees "Bio enriched. Catalog scrape queued
        # behind active job N — retry in a moment."
        scrape_blocked_by: Optional[int] = None
        try:
            job_id = catalog_ops.enqueue_job(db, "scrape", started_by=user["id"])
        except catalog_ops.JobConflict as e:
            scrape_blocked_by = e.live_job_id
            job_payload = None
        else:
            background_tasks.add_task(
                catalog_ops.run_scrape_job, job_id,
                roaster_slug=slug,
                regenerate_prompt=regenerate_prompt,
            )
            job_payload = _job_to_response(db, job_id)
    finally:
        db.close()

    return ok(
        {
            "profile": bio_data,
            "job": job_payload,
            "scrape_blocked_by_job_id": scrape_blocked_by,
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
