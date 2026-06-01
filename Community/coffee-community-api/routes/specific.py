"""
Specific routes that must be registered BEFORE the catch-all resource routes.

These have fixed paths that would otherwise be shadowed by /{resource}/{id}.
"""

import json
import os
import re
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
        # Decode HTML entities (`&amp;` → `&`, `&#39;` → `'`, etc.)
        # so link-preview titles read naturally. Both OG meta and
        # <title> can carry entity-encoded ampersands and apostrophes.
        if title:
            import html as _html
            title = _html.unescape(title)

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

@router.post("/roasters/{slug}/products", status_code=201)
def create_roaster_product(slug: str, body: dict, user=Depends(get_current_user)):
    from fastapi import HTTPException
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
            users.append({
                "username": r["username"], "display_name": r["display_name"],
                "avatar_url": r["avatar_url"], "location": r["location"],
                "shelf": r["shelf"], "added_at": r["added_at"],
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


@router.post("/admin/scrape/sources", status_code=202)
def admin_add_roaster_source(
    body: dict,
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """Onboard a roaster from a website URL.

    Async pattern (matches `/admin/roasters/enrich`):
      1. Inserts a `roaster_sources` row immediately if no source
         already exists for this website (so the URL is on file
         even if Sonnet enrichment fails downstream).
      2. Enqueues a `roaster_enrich` job in the `jobs` table.
      3. Adds a BackgroundTask that runs `_apply_roaster_enrichment`
         (Sonnet bio enrich → upsert into `roaster_profiles` +
         `roaster_sources`) AND chains a `scrape` job for the
         catalog automatically when shop_url + platform get picked.

    Returns 202 with `{source_id, job_id, status: "queued",
    website, source_created}`. The caller polls `/api/jobs/{job_id}`
    for completion; the result summary contains `{slug, name,
    website, scrape_job_id?}` once the bio enrich finishes. Under
    the Agent-fallback queue path (LLM_PROVIDER=claude_code_agent),
    the agent must drain the LLM queue via `crema_haiku_next_job`
    + `crema_haiku_submit` while polling, otherwise the BG task
    sits waiting for a drainer to handle the bio Sonnet call.

    Idempotent on website — re-onboarding the same URL won't
    409 and won't duplicate rows. The bio enrich upserts both
    tables in place, so this is the right call to repair orphan
    source rows left over from a prior incomplete attempt.
    """
    _require_admin(user)
    website = (body or {}).get("website", "").strip()
    if not website:
        from fastapi import HTTPException
        raise HTTPException(422, "website is required")
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    db = get_db()
    try:
        # Step 1 — make sure the source row exists, so the URL is on
        # file even if the BG enrichment trips.
        existing = db.execute(
            "SELECT id FROM roaster_sources WHERE website = ?", (website,)
        ).fetchone()
        if existing:
            source_id = existing["id"]
            source_created = False
        else:
            name = (body or {}).get("name", "").strip()
            if not name:
                name = scrape_runner.fetch_roaster_title(website) or website
            cur = db.execute(
                "INSERT INTO roaster_sources "
                "(name, website, shop_url, platform, city, state, "
                " enabled, added_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
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
            source_id = cur.lastrowid
            source_created = True

        # Step 2 — enqueue the bio + scrape job.
        try:
            job_id = catalog_ops.enqueue_job(
                db, "roaster_enrich", started_by=user["id"],
            )
        except catalog_ops.JobConflict as e:
            from fastapi import HTTPException
            raise HTTPException(
                409, str(e),
                headers={"X-Live-Job-Id": str(e.live_job_id)},
            )
        # Stash website in log_tail so the runner (which uses its
        # own DB connection in the BG thread) can pick it up.
        db.execute(
            "UPDATE jobs SET log_tail = ? WHERE id = ?",
            (json.dumps({"website": website}), job_id),
        )
        db.commit()
        background_tasks.add_task(
            catalog_ops.run_roaster_enrich_job,
            job_id, website=website,
        )

        return ok({
            "source_id": source_id,
            "source_created": source_created,
            "website": website,
            "job_id": job_id,
            "status": "queued",
        }, resource="roaster_sources")
    finally:
        db.close()


def _now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/admin/scrape/sources")
def admin_list_roaster_sources(
    enabled: Optional[bool] = None,
    has_profile: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
):
    """List `roaster_sources` rows for admin / orphan-detection.

    Filters:
      • enabled: true|false to narrow
      • has_profile: true → only sources with a linked profile;
                      false → orphan source rows (no profile yet)
      • search: substring match on name + website + shop_url
      • limit: cap on rows returned (default 200, max 1000)

    Joins `roaster_profiles` on website to surface `roaster_slug`
    + `published` per row. Sources without a matching profile show
    those fields as null — that's the orphan-detection signal.
    """
    _require_admin(user)
    limit = max(1, min(limit, 1000))
    db = get_db()
    try:
        clauses: list[str] = []
        params: list = []
        if enabled is not None:
            clauses.append("rs.enabled = ?")
            params.append(1 if enabled else 0)
        if search:
            clauses.append(
                "(rs.name LIKE ? OR rs.website LIKE ? OR rs.shop_url LIKE ?)"
            )
            wildcard = f"%{search}%"
            params.extend([wildcard, wildcard, wildcard])
        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""

        rows = db.execute(
            f"SELECT rs.*, rp.roaster_slug, rp.published "
            f"FROM roaster_sources rs "
            f"LEFT JOIN roaster_profiles rp ON rp.website = rs.website "
            f"{where_sql} "
            f"ORDER BY rs.added_at DESC "
            f"LIMIT ?",
            tuple(params) + (limit,),
        ).fetchall()

        result = [dict(r) for r in rows]
        if has_profile is True:
            result = [r for r in result if r.get("roaster_slug")]
        elif has_profile is False:
            result = [r for r in result if not r.get("roaster_slug")]

        return ok(result, resource="roaster_sources")
    finally:
        db.close()


@router.delete("/admin/scrape/sources/{source_id}", status_code=200)
def admin_delete_roaster_source(
    source_id: int, user=Depends(get_current_user),
):
    """Hard-delete a `roaster_sources` row by id.

    Use this to clean up orphan source rows from incomplete onboards.
    Does NOT touch `roaster_profiles` or `products` — the source is
    the scraper's entry point and removing it just disables BEANS-tab
    scraping for that website. If a linked profile exists, it stays
    intact (the profile lookup keys on website, not source-id).

    Returns `{deleted: 1, source_id, website, name}` on success or
    404 if no source matches the id.
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, name, website FROM roaster_sources WHERE id = ?",
            (source_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"No roaster_sources row with id={source_id}")
        db.execute("DELETE FROM roaster_sources WHERE id = ?", (source_id,))
        db.commit()
        return ok({
            "deleted": 1,
            "source_id": source_id,
            "website": row["website"],
            "name": row["name"],
        }, resource="roaster_sources")
    finally:
        db.close()


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
                # Surface scrape_status from the snapshot so the diff_sweep
                # caller can flag crawl failures (ok | empty_retry_confirmed |
                # failed_network | failed_http_* | failed_parse). Previously
                # hidden — making them visible closes the "silent failures"
                # gap (no_change_count was inflated by undetected crawl
                # failures, e.g. 'unknown slug' / Cloudflare blocks).
                entry["scrape_status"] = payload.get("scrape_status") or {}
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
    immediately with the list of slugs accepted + the list of
    unknown_slugs (slugs that have no `roaster_profiles` row to sync
    against — those are silently dropped from the BG task queue, but
    surfaced in the response so the caller knows). The caller polls
    GET /admin/sync/all-status to see diffs land.

    Slug validation (2026-05-24 fix): previously any string in the
    `slugs[]` array was accepted and counted in `scope_count`, even
    if it didn't exist in `roaster_profiles`. The runner would silently
    swallow the unknown-slug error, producing a false-positive
    "no_change_count" report. Now we look up each slug against
    `roaster_profiles` upfront and split into `accepted` (will run)
    vs `unknown_slugs` (won't run, surfaced to caller).
    """
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

    # Slug validation: keep only slugs that have a profile row.
    # roaster_profiles is the authoritative slug source — sync_runner
    # internally uses it to find the website + the previous snapshot.
    db = get_db()
    try:
        placeholders = ",".join("?" for _ in slugs)
        known_rows = db.execute(
            f"SELECT roaster_slug FROM roaster_profiles "
            f"WHERE roaster_slug IN ({placeholders})",
            tuple(slugs),
        ).fetchall()
        known = {r["roaster_slug"] for r in known_rows}
    finally:
        db.close()

    accepted = [s for s in slugs if s in known]
    unknown_slugs = [s for s in slugs if s not in known]

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

    for slug in accepted:
        background_tasks.add_task(_run, slug, mode)
    return ok({
        "accepted": len(accepted),
        "mode": mode,
        "slugs": accepted,
        "unknown_slugs": unknown_slugs,
    }, resource="sync_bulk")


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
    """Append a row to `agent_summaries` — the journal-style activity log.

    Per the journal directive (AGENTIC_UTOPIA.md): every entry is
    written by the orchestrator, in plain English, as a colleague-
    briefing — not a technical log dump. The admin UI renders this
    surface like the consumer JOURNAL: a card with title + excerpt,
    click to expand into a journal-style reader.

    Body:
      • task_label (required, free text) — short noun phrase that
        becomes the journal TITLE on the card. Examples:
        "Refreshed Caaraabi's catalog", "Drained held-roaster
        re-enrich queue", "Patched Bourbon disambiguation for korebi".
      • summary (required, 1-3 sentences) — the EXCERPT shown on the
        card. Frame as plain-English teaser of what happened. Keep
        under ~200 chars.
      • body_html (optional, the journal body) — long-form narrative
        as HTML. Allowed tags: h2, h3, p, ul/ol/li, blockquote,
        strong, em, a. Use to walk through the work in paragraphs +
        subheadings the way an article would. Renders via the same
        `htmlToBlocks` walker as consumer articles.
      • outcome (optional enum) — 'success' | 'partial' | 'failed' |
        'aborted'. Default 'success'. Drives the card's status badge.
      • prompt_excerpt (optional) — first ~500 chars of the originating
        prompt. Surfaces in the reader's metadata sidebar.
      • tool_calls_count (optional int) — surfaces in the meta row.
      • scope_slugs (optional list[string]) — roaster slugs touched.
        Render as roaster-name chips in the reader header.
      • metrics (optional dict) — free-form counters
        ({"jobs_processed": 12, "approved": 9}). Surface in meta.
      • started_at (optional ISO8601) — agent start time.

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

    body_html = body.get("body_html")
    if body_html is not None and not isinstance(body_html, str):
        from fastapi import HTTPException
        raise HTTPException(422, "body_html must be a string if provided")

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO agent_summaries "
            "(agent_identity, task_label, prompt_excerpt, summary, outcome, "
            " tool_calls_count, scope_slugs, metrics, started_at, ended_at, "
            " body_html) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                body_html,
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


# ── enrichment_tasks — v2 per-URL state machine ────────────────────────────
# Each row tracks one URL through the v2 pipeline: discovered →
# fetching → llm_pending → enriched | failed | skipped. The canonical
# data lives in `products` / `roaster_articles`; this table is the
# work spine.
#
# Surfaced via MCP `crema_list_enrichment_tasks` so an orchestrator can
# ask "which products are stuck pending?", "which roaster has the most
# failed enrichments?", "what got bs4_fallback'd and needs admin
# review?". Replaces the proposals-table observability of the v1
# workflow.


@router.get("/admin/enrichment-tasks")
def admin_list_enrichment_tasks(
    limit: int = 100,
    kind: Optional[str] = None,
    state: Optional[str] = None,
    roaster_slug: Optional[str] = None,
    extraction_provenance: Optional[str] = None,
    since: Optional[str] = None,
    user=Depends(get_current_user),
):
    """List v2 enrichment_tasks rows. All filters are optional.

    Params:
      • kind: 'product' | 'article'
      • state: 'discovered' | 'fetching' | 'llm_pending' | 'enriched' |
               'failed' | 'skipped'
      • roaster_slug: scope to one roaster
      • extraction_provenance: 'haiku' | 'haiku_site_hinted' |
                                'admin_manual' | 'bs4_fallback'
      • since: ISO8601 — only rows with state_changed_at >= since
      • limit: 1-1000, default 100
    """
    _require_admin(user)
    where = []
    params: list = []
    if kind:
        where.append("kind = ?"); params.append(kind)
    if state:
        where.append("state = ?"); params.append(state)
    if roaster_slug:
        where.append("roaster_slug = ?"); params.append(roaster_slug)
    if extraction_provenance:
        where.append("extraction_provenance = ?"); params.append(extraction_provenance)
    if since:
        where.append("state_changed_at >= ?"); params.append(since)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(min(max(int(limit or 100), 1), 1000))

    db = get_db()
    try:
        rows = db.execute(
            f"SELECT * FROM enrichment_tasks{where_sql} "
            f"ORDER BY state_changed_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        return ok([dict(r) for r in rows], resource="enrichment_tasks")
    finally:
        db.close()


@router.get("/admin/enrichment-tasks/breakdown")
def admin_enrichment_tasks_breakdown(
    roaster_slug: Optional[str] = None,
    since: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Aggregate per-state counts. Useful for a one-shot health check:
    'how many of my v2 tasks are stuck in failed?'.

    Returns: {by_state: {state: count}, by_kind: {kind: count},
              by_provenance: {provenance: count}, total: int}.
    """
    _require_admin(user)
    where = []
    params: list = []
    if roaster_slug:
        where.append("roaster_slug = ?"); params.append(roaster_slug)
    if since:
        where.append("state_changed_at >= ?"); params.append(since)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    db = get_db()
    try:
        by_state = {r["state"]: r["c"] for r in db.execute(
            f"SELECT state, COUNT(*) c FROM enrichment_tasks{where_sql} "
            f"GROUP BY state", tuple(params)
        ).fetchall()}
        by_kind = {r["kind"]: r["c"] for r in db.execute(
            f"SELECT kind, COUNT(*) c FROM enrichment_tasks{where_sql} "
            f"GROUP BY kind", tuple(params)
        ).fetchall()}
        by_prov = {r["p"] or "(unset)": r["c"] for r in db.execute(
            f"SELECT extraction_provenance p, COUNT(*) c FROM enrichment_tasks{where_sql} "
            f"GROUP BY extraction_provenance", tuple(params)
        ).fetchall()}
        total = sum(by_state.values())
        return ok({
            "by_state": by_state,
            "by_kind": by_kind,
            "by_provenance": by_prov,
            "total": total,
        }, resource="enrichment_tasks_breakdown")
    finally:
        db.close()


# ── Catalog quality audit (single-shot cosmetic-bug surface) ───────────────
# Replaces the prior session's habit of dumping 122k-char
# `crema_list_thin_products` payloads to investigate "what's broken
# on the consumer cards?". One structured report covering every
# cosmetic-bug class the v2 pipeline can leave behind:
#   - coffee_name junk (HTML entities, pipe-tails, trailing weight
#     suffix, ALL-CAPS strings)
#   - absurd prices (>100k INR for <500g — the Vithai 9-lakh class)
#   - missing image_url per roaster
#   - missing price_inr per roaster
#   - silent-empty (≥5 of 10 enrichment fields null) per roaster
#   - denorm name drift (products.roaster_name ≠ roaster_profiles.name)
# Per-category: top sample rows + totals + per-roaster rollup. Optional
# `slug` arg scopes everything to one roaster — useful for verifying
# a per-roaster re-enrich landed clean.


@router.get("/admin/catalog-quality-audit")
def admin_catalog_quality_audit(
    slug: Optional[str] = None,
    limit: int = 20,
    user=Depends(get_current_user),
):
    """Single-shot cosmetic-bug audit across the products + articles
    tables. Returns six counts + sample rows per category."""
    _require_admin(user)
    db = get_db()
    try:
        scope_clause = " AND p.roaster_slug = ?" if slug else ""
        scope_params: tuple = (slug,) if slug else ()

        # 1. coffee_name junk patterns.
        # HTML entities: '&#NNNN;' or '&amp;' / '&quot;' / etc.
        # Pipe-tail: contains ' | '.
        # Weight suffix: ends with " 250g" / " 1kg" / "- 500gm" etc.
        # ALL-CAPS: coffee_name is fully uppercase letters (≥3 chars).
        junk_html_rows = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name
            FROM products p
            WHERE (
                p.coffee_name LIKE '%&#%' OR
                p.coffee_name LIKE '%&amp;%' OR
                p.coffee_name LIKE '%&quot;%' OR
                p.coffee_name LIKE '%&lt;%' OR
                p.coffee_name LIKE '%&gt;%' OR
                p.coffee_name LIKE '%&nbsp;%'
            ){scope_clause}
            LIMIT ?
            """,
            (*scope_params, limit),
        ).fetchall()
        junk_html_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p WHERE (
                p.coffee_name LIKE '%&#%' OR
                p.coffee_name LIKE '%&amp;%' OR
                p.coffee_name LIKE '%&quot;%' OR
                p.coffee_name LIKE '%&lt;%' OR
                p.coffee_name LIKE '%&gt;%' OR
                p.coffee_name LIKE '%&nbsp;%'
            ){scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        junk_pipe_rows = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name
            FROM products p
            WHERE p.coffee_name LIKE '% | %'{scope_clause}
            LIMIT ?
            """,
            (*scope_params, limit),
        ).fetchall()
        junk_pipe_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.coffee_name LIKE '% | %'{scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # Weight-suffix detection in Python — SQLite LIKE can't match
        # the digit-then-unit pattern reliably. Pull candidates with
        # any trailing digit + g/kg, filter in Python.
        weight_re = re.compile(
            r"\s*[-–—]?\s*\d+\s*(?:g|gm|gms|gram|grams|kg)\s*$",
            re.IGNORECASE,
        )
        cand_rows = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name
            FROM products p
            WHERE p.coffee_name LIKE '%g'{scope_clause}
            """,
            scope_params,
        ).fetchall()
        junk_weight_matches = [
            dict(r) for r in cand_rows if weight_re.search(r["coffee_name"] or "")
        ]
        junk_weight_rows = junk_weight_matches[:limit]
        junk_weight_total = len(junk_weight_matches)

        # ALL-CAPS: pull candidates that have ANY uppercase letter and
        # filter to fully uppercase in Python.
        all_caps_cand = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name
            FROM products p
            WHERE p.coffee_name = UPPER(p.coffee_name)
              AND p.coffee_name GLOB '*[A-Z]*'
              AND length(p.coffee_name) >= 3{scope_clause}
            """,
            scope_params,
        ).fetchall()
        junk_allcaps_matches = [
            dict(r) for r in all_caps_cand
            if (r["coffee_name"] or "").upper() == (r["coffee_name"] or "")
            and any(ch.isalpha() for ch in (r["coffee_name"] or ""))
        ]
        junk_allcaps_rows = junk_allcaps_matches[:limit]
        junk_allcaps_total = len(junk_allcaps_matches)

        # 2. Absurd prices: >100k INR for products under 500g.
        absurd_rows = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name,
                   p.price_inr, p.weight_grams
            FROM products p
            WHERE p.price_inr IS NOT NULL
              AND p.price_inr > 100000
              AND (p.weight_grams IS NULL OR p.weight_grams < 500)
              {scope_clause}
            ORDER BY p.price_inr DESC
            LIMIT ?
            """,
            (*scope_params, limit),
        ).fetchall()
        absurd_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.price_inr IS NOT NULL
              AND p.price_inr > 100000
              AND (p.weight_grams IS NULL OR p.weight_grams < 500)
              {scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # 3. Missing image_url per roaster.
        missing_image_per_roaster = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.roaster_slug,
                       COUNT(*) c_missing,
                       (SELECT COUNT(*) FROM products p2
                          WHERE p2.roaster_slug = p.roaster_slug
                            {('AND p2.roaster_slug = ?' if slug else '')}
                       ) c_total
                FROM products p
                WHERE p.image_url IS NULL{scope_clause}
                GROUP BY p.roaster_slug
                ORDER BY c_missing DESC
                LIMIT ?
                """,
                (*(scope_params), *scope_params, limit),
            ).fetchall()
        ]
        missing_image_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.image_url IS NULL{scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # 4. Missing-or-zero price_inr per roaster. (Price = 0 is
        # almost always an extraction artifact for out-of-stock rows
        # where the page hides the price; treated the same as null
        # for audit purposes — Zenforest 'First Blossom X Rum Barrel'
        # + 'La Vida Mango' were the canonical examples that the
        # IS-NULL-only rule missed in the 2026-05-27 audit.)
        missing_price_per_roaster = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.roaster_slug, COUNT(*) c_missing
                FROM products p
                WHERE (p.price_inr IS NULL OR p.price_inr = 0){scope_clause}
                GROUP BY p.roaster_slug
                ORDER BY c_missing DESC
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]
        missing_price_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE (p.price_inr IS NULL OR p.price_inr = 0){scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # 5. Silent-empty: enrichment_status='enriched' with ≥5 of 10
        # enrichment fields null. The 10 fields mirror crema_list_thin_products.
        silent_empty_sql = f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name, (
                (CASE WHEN p.origin IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.varietal IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.process IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.process_raw IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.roast_level IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.tasting_notes IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.flavor_notes IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.altitude_masl IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.producer IS NULL THEN 1 ELSE 0 END) +
                (CASE WHEN p.roaster_blurb IS NULL THEN 1 ELSE 0 END)
            ) AS null_count
            FROM products p
            WHERE p.enrichment_status = 'enriched'{scope_clause}
        """
        silent_empty_rollup = [
            dict(r) for r in db.execute(
                f"""
                SELECT roaster_slug, COUNT(*) c FROM ({silent_empty_sql})
                WHERE null_count >= 5
                GROUP BY roaster_slug
                ORDER BY c DESC
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]
        silent_empty_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM ({silent_empty_sql})
            WHERE null_count >= 5
            """,
            scope_params,
        ).fetchone()["c"]

        # 6. Denorm name drift: products.roaster_name != roaster_profiles.name.
        drift_rows = db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug,
                   p.roaster_name AS row_name,
                   rp.name AS canonical_name
            FROM products p
            JOIN roaster_profiles rp ON rp.roaster_slug = p.roaster_slug
            WHERE rp.name IS NOT NULL
              AND p.roaster_name IS NOT NULL
              AND p.roaster_name != rp.name{scope_clause}
            LIMIT ?
            """,
            (*scope_params, limit),
        ).fetchall()
        drift_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            JOIN roaster_profiles rp ON rp.roaster_slug = p.roaster_slug
            WHERE rp.name IS NOT NULL
              AND p.roaster_name IS NOT NULL
              AND p.roaster_name != rp.name{scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # 7. Variant-mismatch suspicion. Row has a high price but
        # a tiny weight — almost certainly the scraper picked the
        # wrong variant's weight (e.g. a 20g sample) while keeping
        # the full-bag price. Coral Rum class corruption: stored
        # weight=20g + price=3799 on a URL whose live 200g variant
        # sells at ₹799. Threshold: price > ₹2000 AND weight < 100g.
        # `price_per_gram` is surfaced so the operator can separate a real
        # mis-pick (ABSURD ₹/g — Coral Rum was ~190) from a legit premium
        # micro-lot (sane ₹/g — reserved-india Gesha Village E-02 is a real
        # 90 g lot at ₹2200 = 24 ₹/g, single variant option1='90g' while
        # grams=1000 is just the shipping placeholder; _variant_bag_grams
        # already prefers the label, so its 90 g is correct, not a mismatch).
        # NOTE: no row is dropped (heuristic unchanged); the ₹/g column is
        # purely additive so neither real defects nor legit lots are hidden.
        variant_mismatch_rows = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.product_id, p.roaster_slug, p.coffee_name,
                       p.price_inr, p.weight_grams, p.enrichment_status,
                       ROUND(p.price_inr * 1.0 / NULLIF(p.weight_grams, 0), 1)
                           AS price_per_gram
                FROM products p
                WHERE p.price_inr > 2000
                  AND p.weight_grams IS NOT NULL
                  AND p.weight_grams < 100
                  AND p.available = 1
                  {scope_clause}
                ORDER BY (p.price_inr / NULLIF(p.weight_grams, 0)) DESC,
                         p.product_id
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]
        variant_mismatch_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.price_inr > 2000
              AND p.weight_grams IS NOT NULL
              AND p.weight_grams < 100
              AND p.available = 1
              {scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]

        # 8. Tracking the new audit-introduced enrichment states.
        # url_dead: HEAD-check returned 404 → row preserved but
        # available=0. filter_reject: current Stage 1 rules now
        # reject this row's title/URL → row preserved but
        # available=0. These rollups surface how much catalog
        # cleanup the retroactive sweeps did.
        url_dead_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.enrichment_status = 'url_dead'
              {scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]
        filter_reject_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.enrichment_status = 'filter_reject'
              {scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]
        # Failed enrichments STILL consumer-visible (Class F, 2026-05-30).
        # A re-enrich failure (empty fetch / validation) marks the row
        # 'failed' but leaves `available` untouched (entity_reenricher),
        # so a previously-visible bean lingers as failed+available=1 with
        # stale/partial data. Surface count + price so the operator (and a
        # regression gate) can tell a displayable bean that just needs a
        # re-enrich (has price) from a broken/non-bean (→ filter sweep).
        failed_available_total = db.execute(
            f"""
            SELECT COUNT(*) c FROM products p
            WHERE p.enrichment_status = 'failed' AND p.available = 1
              {scope_clause}
            """,
            scope_params,
        ).fetchone()["c"]
        failed_available_rows = [dict(r) for r in db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name,
                   p.price_inr, p.weight_grams
            FROM products p
            WHERE p.enrichment_status = 'failed' AND p.available = 1
              {scope_clause}
            ORDER BY p.product_id LIMIT 40
            """,
            scope_params,
        ).fetchall()]

        # Non-bean FORMAT rows still live in the catalog (available=1).
        # Crema is a whole-beans catalog — single-serve drip bags / brew
        # bags / sachets / capsules / pods / instant / RTD are out of
        # scope (grind is fine; format is not). Counts what the Stage-1
        # beans-only filter should reject; run crema_apply_filters_retro
        # to flip them to filter_reject. Three detectors mirror exactly
        # what the sweep + write-path guards enforce, so the audit and
        # the filter never drift apart:
        #   (a) is_non_bean_format(coffee_name)        — title marker
        #   (b) is_single_serve_by_economics(wt, ₹)    — economic signature
        #   (c) is_non_bean_format_desc(description)   — declaration marker
        # (b)+(c) added 2026-05-30 (Class A): the single-serve leaks whose
        # FORMAT marker never reached the cleaned coffee_name (odd-coffee
        # Brew Bag, dripface pocket brew, roast-coffee 5 g Easy Pour,
        # ninetytwo Pocket Pour) — they read as available=1 beans and the
        # ₹/g sort floats them to #1, yet the title-only counter scored
        # them 0. (c) uses the STRICT description set so a real bean whose
        # recipe mentions a "cold brew bag" (motley-brew) is never counted.
        from services.product_filters import (
            is_non_bean_format as _is_nbf,
            is_single_serve_by_economics as _is_sse,
            is_non_bean_format_desc as _is_nbfd,
            is_multi_coffee_bundle as _is_bundle,
        )
        _nbf_by_roaster: dict[str, int] = {}
        _nbf_samples: list[dict] = []
        # Multi-coffee BUNDLE counter (Class B, 2026-05-30) — gift box /
        # curated set / duo / combo of ≥2 distinct coffees. Same available=1
        # scan, so the audit measures both beans-only leak types the sweep +
        # write-path guards enforce (the goal's "no format/bundle available=1").
        _bundle_by_roaster: dict[str, int] = {}
        _bundle_samples: list[dict] = []
        for _r in db.execute(
            f"""
            SELECT p.product_id, p.roaster_slug, p.coffee_name,
                   p.weight_grams, p.price_inr, p.description_raw,
                   p.product_url, p.roaster_blurb, p.tasting_notes
            FROM products p
            WHERE p.available = 1{scope_clause}
            """,
            scope_params,
        ).fetchall():
            _why = None
            if _is_nbf(_r["coffee_name"]):
                _why = "title-marker"
            elif _is_sse(_r["weight_grams"], _r["price_inr"]):
                _why = (
                    f"economics:{_r['weight_grams']}g/{_r['price_inr']}inr"
                )
            elif _is_nbfd(_r["description_raw"]):
                _why = "description-marker"
            if _why is not None:
                _nbf_by_roaster[_r["roaster_slug"]] = (
                    _nbf_by_roaster.get(_r["roaster_slug"], 0) + 1
                )
                if len(_nbf_samples) < 25:
                    _nbf_samples.append({
                        "product_id": _r["product_id"],
                        "roaster_slug": _r["roaster_slug"],
                        "coffee_name": _r["coffee_name"],
                        "reason": _why,
                    })
            _bundle = _is_bundle(
                _r["coffee_name"], url=_r["product_url"],
                description=_r["description_raw"],
                blurb=_r["roaster_blurb"], tasting_notes=_r["tasting_notes"],
            )
            if _bundle:
                _bundle_by_roaster[_r["roaster_slug"]] = (
                    _bundle_by_roaster.get(_r["roaster_slug"], 0) + 1
                )
                if len(_bundle_samples) < 25:
                    _bundle_samples.append({
                        "product_id": _r["product_id"],
                        "roaster_slug": _r["roaster_slug"],
                        "coffee_name": _r["coffee_name"],
                        "reason": _bundle,
                    })
        non_bean_format_total = sum(_nbf_by_roaster.values())
        non_bean_format_top = sorted(
            ({"roaster_slug": k, "c": v} for k, v in _nbf_by_roaster.items()),
            key=lambda x: x["c"], reverse=True,
        )[:20]
        multi_coffee_bundle_total = sum(_bundle_by_roaster.values())
        multi_coffee_bundle_top = sorted(
            ({"roaster_slug": k, "c": v} for k, v in _bundle_by_roaster.items()),
            key=lambda x: x["c"], reverse=True,
        )[:20]

        cosmetic_total = (
            junk_html_total + junk_pipe_total + junk_weight_total
            + junk_allcaps_total + absurd_total + drift_total
        )

        # 7. Price extremes — high-to-low + low-to-high. Surfaces
        # equipment-priced-like-coffee outliers (a ₹19k row signals
        # something slipped Stage 1; a ₹50 row signals a missing-
        # variant-price or a one-shot sample / drip-bag). Each row
        # carries enriched_at so the operator knows how stale the
        # data is.
        top_high_priced = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.product_id, p.roaster_slug, p.coffee_name,
                       p.price_inr, p.weight_grams, p.image_url,
                       p.enrichment_status, p.enriched_at, p.created_at
                FROM products p
                WHERE p.price_inr IS NOT NULL
                  AND p.available = 1
                  {scope_clause}
                ORDER BY p.price_inr DESC, p.product_id
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]
        top_low_priced = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.product_id, p.roaster_slug, p.coffee_name,
                       p.price_inr, p.weight_grams, p.image_url,
                       p.enrichment_status, p.enriched_at, p.created_at
                FROM products p
                WHERE p.price_inr IS NOT NULL
                  AND p.price_inr > 0
                  AND p.available = 1
                  {scope_clause}
                ORDER BY p.price_inr ASC, p.product_id
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]

        # 8. Missing-image samples with version-tracking timestamps.
        # Lets the operator see WHEN the missing-image rows were last
        # enriched — if `enriched_at` is recent (post-image-extractor
        # fix), the row genuinely has no extractable image; if it's
        # stale (or NULL = pre-enriched_at column), a fresh re-enrich
        # may now populate it via the new extractor stack.
        missing_image_samples = [
            dict(r) for r in db.execute(
                f"""
                SELECT p.product_id, p.roaster_slug, p.coffee_name,
                       p.enrichment_status, p.enriched_at, p.created_at
                FROM products p
                WHERE p.image_url IS NULL{scope_clause}
                ORDER BY p.enriched_at IS NULL DESC, p.enriched_at ASC,
                         p.created_at ASC
                LIMIT ?
                """,
                (*scope_params, limit),
            ).fetchall()
        ]

        return ok({
            "scope": slug or "all",
            "cosmetic_bug_total": cosmetic_total,
            "price_extremes": {
                "top_high_priced": top_high_priced,
                "top_low_priced": top_low_priced,
                "note": (
                    "Sort the catalog the way a consumer sees it. "
                    "High-end outliers above ~₹3000 / 250g (~₹12k/kg) "
                    "almost always signal equipment or roaster-side "
                    "mis-tagging. Low-end below ~₹100 signals drip-"
                    "bags / single-serves slipping Stage 1 or "
                    "missing-variant price-augmentation."
                ),
            },
            "missing_image_with_timestamps": {
                "total": missing_image_total,
                "samples": missing_image_samples,
                "note": (
                    "enriched_at=NULL means the row predates the column "
                    "(was last touched by the v1 path or hasn't been "
                    "re-enriched via v2 since 2026-05-25). Recently-"
                    "enriched rows with image_url=NULL mean the new "
                    "extractor genuinely couldn't pick a product image "
                    "off the page — typically Wix sites that JS-render "
                    "the gallery in a way Playwright doesn't capture."
                ),
            },
            "coffee_name_junk": {
                "html_entities": {
                    "total": junk_html_total,
                    "samples": [dict(r) for r in junk_html_rows],
                },
                "pipe_tails": {
                    "total": junk_pipe_total,
                    "samples": [dict(r) for r in junk_pipe_rows],
                },
                "weight_suffixes": {
                    "total": junk_weight_total,
                    "samples": junk_weight_rows,
                },
                "all_caps": {
                    "total": junk_allcaps_total,
                    "samples": junk_allcaps_rows,
                    "note": (
                        "Some roasters (DEVAN'S, BROOT) market in ALL-CAPS "
                        "deliberately. Curation decision before mass-fix."
                    ),
                },
            },
            "absurd_prices": {
                "total": absurd_total,
                "criterion": "price_inr > 100k INR for weight_grams < 500g",
                "samples": [dict(r) for r in absurd_rows],
            },
            "missing_image_url": {
                "total": missing_image_total,
                "by_roaster_top": missing_image_per_roaster,
            },
            "missing_price_inr": {
                "total": missing_price_total,
                "by_roaster_top": missing_price_per_roaster,
            },
            "silent_empty": {
                "total": silent_empty_total,
                "criterion": "enrichment_status='enriched' AND ≥5 of 10 fields null",
                "by_roaster_top": silent_empty_rollup,
            },
            "denorm_name_drift": {
                "total": drift_total,
                "criterion": "products.roaster_name != roaster_profiles.name",
                "samples": [dict(r) for r in drift_rows],
            },
            "variant_mismatch_suspicion": {
                "total": variant_mismatch_total,
                "criterion": (
                    "price_inr > 2000 AND weight_grams < 100. Read the "
                    "per-row price_per_gram to triage: an ABSURD ₹/g (Coral "
                    "Rum was ~190) is a real mis-pick — the scraper paired a "
                    "tiny/wrong variant weight with the full-bag price. A SANE "
                    "₹/g in premium-micro-lot range (≲45; reserved-india "
                    "Gesha Village E-02 is a genuine 90 g lot at 24 ₹/g) is "
                    "legit, NOT a defect — _variant_bag_grams already prefers "
                    "the variant size label over the shipping `grams` field, "
                    "so the small weight is the real net weight."
                ),
                "samples": variant_mismatch_rows,
            },
            "url_dead_count": {
                "total": url_dead_total,
                "criterion": (
                    "enrichment_status='url_dead' — HEAD-check on the "
                    "product_url returned 404 during a re-enrich or "
                    "url-health audit. Row is preserved but available=0."
                ),
            },
            "filter_reject_count": {
                "total": filter_reject_total,
                "criterion": (
                    "enrichment_status='filter_reject' — the current "
                    "Stage 1 keyword filter rejected this row during a "
                    "re-enrich or retroactive sweep. Row preserved but "
                    "available=0."
                ),
            },
            "failed_available": {
                "total": failed_available_total,
                "criterion": (
                    "enrichment_status='failed' AND available=1 (Class F) — a "
                    "re-enrich failure left the row consumer-visible with "
                    "stale/partial data. A row WITH a price is a displayable "
                    "bean whose enrich hiccupped (re-enrich it; the "
                    "entity_reenricher fix now preserves the prior enriched "
                    "status instead of downgrading to failed). A row with no "
                    "price / non-bean name is broken (filter sweep / hide)."
                ),
                "samples": failed_available_rows,
            },
            "non_bean_format": {
                "total": non_bean_format_total,
                "criterion": (
                    "available=1 rows whose coffee_name is a single-serve / "
                    "non-bean FORMAT (drip bag / drip filter / brew bag / "
                    "sachet / capsule / pod / instant / RTD). Crema is a "
                    "whole-beans catalog — grind is fine, format is not. "
                    "These should be Stage-1 filtered; run "
                    "crema_apply_filters_retro to flip them to filter_reject."
                ),
                "by_roaster_top": non_bean_format_top,
                "samples": _nbf_samples,
            },
            "multi_coffee_bundle": {
                "total": multi_coffee_bundle_total,
                "criterion": (
                    "available=1 rows that are a MULTI-COFFEE BUNDLE — a gift "
                    "box / curated set / duo / combo / sampler of ≥2 distinct "
                    "coffees in separate bags (caarabi 'Light Roast Edit', "
                    "black-poetry 'Java Joy Box', zenforest 'X' duos). Coffee, "
                    "but not a single bean SKU, so out of scope. Detected via "
                    "is_multi_coffee_bundle (separation structure, not a bare "
                    "count, so a single-bag BLEND is never counted); run "
                    "crema_apply_filters_retro to flip them to filter_reject. "
                    "A collapsed-enrich combo with no bundle prose left "
                    "(93-degrees) is caught instead on the write path by the "
                    "model's distinct_coffee_count on the next re-enrich."
                ),
                "by_roaster_top": multi_coffee_bundle_top,
                "samples": _bundle_samples,
            },
        }, resource="catalog_quality_audit")
    finally:
        db.close()


@router.get("/admin/catalog-price-per-gram")
def admin_catalog_price_per_gram(
    slug: Optional[str] = None,
    band_pct: float = 10.0,
    limit: int = 25,
    user=Depends(get_current_user),
):
    """Price-per-gram distribution + outlier audit over consumer-visible
    beans (available=1). Built 2026-05-30 for pipeline hardening.

    The consumer sees a card with a price and a weight; ₹/g is the
    normalized 'how expensive is this bean really' axis that makes a
    250g bag and a 100g micro-lot comparable. The catalog's ₹/g is
    heavy-tailed (bulk 5kg bags at one end, 50g tasters / premium
    Geisha micro-lots at the other), so we flag by DECILE BANDS on the
    distribution (top/bottom `band_pct`%), not Tukey fences (which the
    skew makes useless — the lower fence goes negative).

    Returns three actionable buckets:
      • upper_band — top `band_pct`% ₹/g. 'Why so expensive per gram?'
        Mostly LEGITIMATE (Geisha, small-lot, barrel-aged) — verify,
        don't auto-fix. A blend/commodity landing here is the signal.
      • lower_band — bottom `band_pct`% ₹/g. 'Why so cheap per gram?'
        Drip-bag/sample/sachet that slipped Stage-1, a wrong-variant
        weight, or genuine commodity. The defect-rich bucket.
      • uncomputable — available=1 rows where ₹/g can't be computed
        (price_inr is null/0 OR weight_grams is null/0). These are the
        REAL extraction defects the card shows as ₹0 or weightless;
        split by which field is missing.

    Read-only; no mutation. Pair with crema_get_product_detail +
    fetch_shopify_product/fetch_page_text to root-cause each flag.
    """
    _require_admin(user)
    db = get_db()
    try:
        band = max(0.5, min(49.0, float(band_pct)))
        scope = " AND roaster_slug = ?" if slug else ""
        sp: tuple = (slug,) if slug else ()

        # Consumer-visible universe = available=1. Computable ₹/g needs
        # a positive price AND positive weight.
        computable = db.execute(
            f"""
            SELECT product_id, roaster_slug, coffee_name, price_inr,
                   weight_grams, enrichment_status,
                   (price_inr * 1.0 / weight_grams) AS ppg
            FROM products
            WHERE available = 1
              AND price_inr IS NOT NULL AND price_inr > 0
              AND weight_grams IS NOT NULL AND weight_grams > 0
              {scope}
            ORDER BY ppg
            """,
            sp,
        ).fetchall()
        rows = [dict(r) for r in computable]
        n = len(rows)

        def _pct(sorted_vals, frac):
            if not sorted_vals:
                return None
            i = frac * (len(sorted_vals) - 1)
            lo = int(i)
            hi = min(lo + 1, len(sorted_vals) - 1)
            return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)

        ppg_vals = [r["ppg"] for r in rows]
        frac = band / 100.0
        lo_cut = _pct(ppg_vals, frac) if n else None
        hi_cut = _pct(ppg_vals, 1 - frac) if n else None
        distribution = {
            "n_computable": n,
            "min": round(ppg_vals[0], 4) if n else None,
            "p10": round(_pct(ppg_vals, 0.10), 4) if n else None,
            "q1": round(_pct(ppg_vals, 0.25), 4) if n else None,
            "median": round(_pct(ppg_vals, 0.50), 4) if n else None,
            "q3": round(_pct(ppg_vals, 0.75), 4) if n else None,
            "p90": round(_pct(ppg_vals, 0.90), 4) if n else None,
            "max": round(ppg_vals[-1], 4) if n else None,
            "band_pct": band,
            "lower_band_cut": round(lo_cut, 4) if lo_cut is not None else None,
            "upper_band_cut": round(hi_cut, 4) if hi_cut is not None else None,
            "unit": "INR per gram",
        }

        def _fmt(r):
            return {
                "product_id": r["product_id"],
                "roaster_slug": r["roaster_slug"],
                "coffee_name": r["coffee_name"],
                "price_inr": r["price_inr"],
                "weight_grams": r["weight_grams"],
                "price_per_gram": round(r["ppg"], 4),
                "enrichment_status": r["enrichment_status"],
            }

        upper = [
            _fmt(r) for r in reversed(rows)
            if hi_cut is not None and r["ppg"] >= hi_cut
        ][:limit]
        lower = [
            _fmt(r) for r in rows
            if lo_cut is not None and r["ppg"] <= lo_cut
        ][:limit]

        # Uncomputable = consumer-visible but ₹/g can't be formed.
        uncomp_rows = db.execute(
            f"""
            SELECT product_id, roaster_slug, coffee_name, price_inr,
                   weight_grams, enrichment_status
            FROM products
            WHERE available = 1
              AND (price_inr IS NULL OR price_inr <= 0
                   OR weight_grams IS NULL OR weight_grams <= 0)
              {scope}
            """,
            sp,
        ).fetchall()
        missing_price = [
            dict(r) for r in uncomp_rows
            if r["price_inr"] is None or r["price_inr"] <= 0
        ]
        missing_weight = [
            dict(r) for r in uncomp_rows
            if (r["price_inr"] is not None and r["price_inr"] > 0)
            and (r["weight_grams"] is None or r["weight_grams"] <= 0)
        ]

        return ok({
            "scope": slug or "all",
            "distribution": distribution,
            "upper_band": {
                "criterion": (
                    f"top {band}% ₹/g (≥ {distribution['upper_band_cut']}). "
                    "'Why so expensive per gram?' — usually legitimate "
                    "(Geisha / small-lot / barrel-aged); a blend or "
                    "commodity here is the anomaly to check."
                ),
                "count": sum(
                    1 for r in rows
                    if hi_cut is not None and r["ppg"] >= hi_cut
                ),
                "samples": upper,
            },
            "lower_band": {
                "criterion": (
                    f"bottom {band}% ₹/g (≤ {distribution['lower_band_cut']}). "
                    "'Why so cheap per gram?' — drip-bag/sample/sachet that "
                    "slipped Stage-1, a wrong-variant weight, or genuine "
                    "commodity. Defect-rich bucket."
                ),
                "count": sum(
                    1 for r in rows
                    if lo_cut is not None and r["ppg"] <= lo_cut
                ),
                "samples": lower,
            },
            "uncomputable": {
                "criterion": (
                    "available=1 rows where ₹/g can't be computed — the "
                    "real consumer-facing defects (card shows ₹0 or no "
                    "weight). Split by missing field."
                ),
                "missing_price_count": len(missing_price),
                "missing_weight_count": len(missing_weight),
                "missing_price_samples": missing_price[:limit],
                "missing_weight_samples": missing_weight[:limit],
            },
        }, resource="catalog_price_per_gram")
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

# Drainer identity policy — added 2026-05-26 after the 2026-05-25
# full-sweep session used Opus to drain its own queue (~600 jobs at
# 6-10× the cost + 15 orphan requeues from Opus narrating instead of
# submitting). Drainers MUST be Haiku subagents per the canonical
# drainer template in catalog-ops memory; the server enforces it here
# so policy isn't lesson-based.
_DRAINER_REQUIRED_KEYWORD = "haiku"


def _require_haiku_drainer(agent_identity: str) -> None:
    """Reject any drainer claim/submit where agent_identity doesn't
    look like a Haiku subagent. The keyword match is permissive (any
    string containing 'haiku' case-insensitive — e.g.
    'claude-haiku-drainer-A', 'haiku-A', 'patient-haiku-mokkafarms')
    so operators have naming flexibility, but the orchestrator's
    default `user-N` fallback or self-drain identities like
    `claude-opus-4-7@...` get blocked outright."""
    from fastapi import HTTPException
    if _DRAINER_REQUIRED_KEYWORD not in (agent_identity or "").lower():
        raise HTTPException(
            403,
            f"Drainer agent_identity must contain "
            f"'{_DRAINER_REQUIRED_KEYWORD}' (case-insensitive). Got: "
            f"{agent_identity!r}. The catalog-ops LLM queue is "
            "Haiku-only by server policy — Opus/Sonnet orchestrators "
            "spawn Haiku subagents per the drainer template in "
            "catalog-ops memory rather than draining the queue "
            "themselves. The 2026-05-25 sweep proved why: Opus "
            "drainers cost 6-10× more per job + narrate instead of "
            "submitting structured output, causing orphan requeues.",
        )


# Stuck-claim reaper — see L1 / 2026-05-26. Default 300s TTL: a Haiku
# drainer's typical wall-clock for one job is 5-30s (page fetch + Haiku
# call + structured output processing). 5 minutes is generous slack
# above that floor, while staying well below llm_router._call_via_queue's
# 600s polling timeout so the reaped job has time to be claimed AND
# completed by a fresh drainer before the bulk worker gives up on it.
# Override via env when triaging (e.g. LLM_JOB_REAP_TTL_SECONDS=60 to
# force aggressive reap during a known-bad drainer run).
_LLM_JOB_REAP_TTL_S = int(os.environ.get("LLM_JOB_REAP_TTL_SECONDS", "300"))


def _reap_stuck_llm_jobs(db) -> list[int]:
    """Flip llm_jobs stuck in status='in_progress' for >TTL back to
    'pending' so the next drainer can claim them fresh. Returns the
    list of reaped job ids (for stderr logging).

    Called at the top of admin_llm_jobs_next — lazy reap-on-claim
    means the reaper only fires when a drainer is actually polling,
    which is exactly when a stuck claim is blocking real progress.
    No idle cost when the queue is quiet.

    Race-safety: the UPDATE is atomic in SQLite (single-statement
    write, WAL mode). If two drainers poll simultaneously and both
    try to reap the same row, SQLite serializes the writes — the
    second sees rowcount=0 for that row (already flipped by the
    first) and moves on. The captured `ids_before` list may
    over-report by the briefest of windows, but the actual UPDATE
    rowcount is the source of truth for logging.

    Bookkeeping: increments `reap_count` and stamps `last_reaped_at`
    on the row so /admin/llm-jobs/list shows the stuck-claim history
    persistently — operators can grep for `reap_count > 0` to find
    flaky drainer patterns without needing server-log access.
    """
    import datetime as _dt
    now_dt = _dt.datetime.now(_dt.timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    threshold_iso = (
        now_dt - _dt.timedelta(seconds=_LLM_JOB_REAP_TTL_S)
    ).isoformat().replace("+00:00", "Z")

    # Capture ids before the flip so we can log what we just freed.
    # ISO 8601 strings sort lexicographically — strict-less-than vs.
    # threshold_iso correctly identifies rows whose claimed_at is
    # older than `now - TTL`.
    stuck = db.execute(
        "SELECT id FROM llm_jobs "
        "WHERE status = 'in_progress' "
        "  AND claimed_at IS NOT NULL "
        "  AND claimed_at < ?",
        (threshold_iso,),
    ).fetchall()
    if not stuck:
        return []
    ids = [r["id"] for r in stuck]

    cur = db.execute(
        "UPDATE llm_jobs SET "
        "  status = 'pending', "
        "  claimed_at = NULL, "
        "  agent_identity = NULL, "
        "  response_payload = NULL, "
        "  error = NULL, "
        "  completed_at = NULL, "
        "  last_reaped_at = ?, "
        "  reap_count = COALESCE(reap_count, 0) + 1 "
        "WHERE status = 'in_progress' "
        "  AND claimed_at IS NOT NULL "
        "  AND claimed_at < ?",
        (now_iso, threshold_iso),
    )
    db.commit()

    if cur.rowcount > 0:
        # stderr so the line shows up in uvicorn output without
        # depending on the app's logging configuration. Operator
        # sees it live during a bulk pass; the persistent record
        # is on the rows themselves.
        import sys as _sys
        _sys.stderr.write(
            f"[llm-jobs-reaper] requeued {cur.rowcount} stuck claim(s) "
            f"older than {_LLM_JOB_REAP_TTL_S}s: {ids}\n"
        )
        _sys.stderr.flush()
    return ids


@router.post("/admin/llm-jobs/next")
def admin_llm_jobs_next(body: Optional[dict] = None,
                          user=Depends(get_current_user)):
    """Atomically claim the oldest pending llm_job. Optional filter
    fields: step (bio | bio_hint | journal_hint | article_enrich |
    product_enrich), roaster_slug. Returns the full job (incl.
    parsed tool_schema) or null if the queue is empty.

    The claim is atomic — concurrent agents racing for the same job
    only one wins, the loser sees status!=pending and we retry the
    next-oldest row.

    Identity policy: `agent_identity` must contain 'haiku' (case-
    insensitive). The orchestrator's default `user-N` fallback is
    rejected — drainers are Haiku subagents per the catalog-ops
    drainer template, never the orchestrator itself.

    Stuck-claim reaper (2026-05-26 L1): before claiming a fresh job,
    flip back to 'pending' any in_progress claims older than
    LLM_JOB_REAP_TTL_SECONDS (default 300s). This unblocks the
    bulk_reenrich pipeline when a Claude Agent drainer dies between
    /next (atomic claim) and /respond (submit). Without it, a dead
    drainer's claim stays in_progress forever and the bulk worker
    blocks indefinitely waiting for a response that never arrives."""
    _require_admin(user)
    body = body or {}
    step = (body.get("step") or "").strip() or None
    roaster_slug = (body.get("roaster_slug") or "").strip() or None
    agent_identity = (body.get("agent_identity") or "").strip()
    _require_haiku_drainer(agent_identity)

    db = get_db()
    try:
        _reap_stuck_llm_jobs(db)
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


def _apply_enrichment_job(db, *, job_id: int, apply_context_json: str,
                          output) -> dict:
    """Background applier — apply a drained product/article enrich job to
    its catalog table from the apply_context persisted on the job at
    enqueue time (services/llm_router._call_via_queue).

    Called from /respond so the apply is driven by the drainer's submit,
    NOT by the (possibly-timed-out) BG thread that enqueued the job. This
    is the fix for the silent-loss pathology: pre-2026-05-29 the upsert
    only ran inside the waiting thread, so a 600s timeout orphaned the
    completed job and the product never updated. Idempotent with the
    inline upsert in enrichment_runner.run_for_roaster (COALESCE writes).
    Records apply_error on the job instead of failing the submit — the
    LLM output is valid even if the apply hiccups; QC surfaces it.
    """
    import json as _json
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")

    def _mark(applied_ok: bool, err: Optional[str]) -> None:
        db.execute(
            "UPDATE llm_jobs SET applied_at = ?, apply_error = ? "
            "WHERE id = ?",
            (now, (None if applied_ok else (err or "")[:500]), job_id),
        )
        db.commit()

    try:
        ctx = _json.loads(apply_context_json) or {}
    except Exception as e:
        _mark(False, f"bad_apply_context:{e}")
        return {"applied": False, "error": "bad_apply_context"}

    # The MCP submit can stringify the output dict (ZodUnknown→string);
    # recover the intended object the same way _call_via_queue does.
    if isinstance(output, str):
        try:
            output = _json.loads(output)
        except Exception:
            pass

    kind = ctx.get("kind")
    url = ctx.get("url")
    slug = ctx.get("roaster_slug")
    task_id = ctx.get("task_id")
    try:
        from services.entity_enricher import build_entity_from_output
        from services.entity_upserter import (
            upsert_entity, mark_task_skipped, mark_task_failed,
        )
        entity, gate = build_entity_from_output(
            output, kind=kind, url=url, roaster_slug=slug,
            scraped_at=ctx.get("scraped_at") or now,
            provenance=ctx.get("provenance") or "haiku",
            hints=ctx.get("hints") or {},
        )
        if entity is not None:
            # job_id=None: `job_id` here is the llm_jobs id, but
            # enrichment_tasks.job_id is an FK to the jobs (scrape) table
            # (database.py:1475). Passing the llm_jobs id violated the FK
            # and rolled back the whole upsert (apply_error=FK constraint).
            # The task row already has its scrape job_id from _open_task;
            # _mark_task_enriched COALESCEs, so None preserves it.
            res = upsert_entity(db, entity, task_id=task_id, job_id=None)
            _mark(True, None)
            return {"applied": True, "action": res.action,
                    "result_id": (str(res.result_id)
                                  if res.result_id is not None else None)}
        if gate and gate.startswith("gated_"):
            # Haiku's own gate (not-a-bean / not-an-article). Mirror the
            # inline runner: route the task to skipped, not failed.
            if task_id is not None:
                mark_task_skipped(db, task_id=task_id,
                                  reason=f"applied_gate:{gate}",
                                  job_id=None)  # FK: see upsert note above
            _mark(True, None)
            return {"applied": True, "action": "gated", "gate": gate}
        # empty/validation build failure — record, don't crash the submit
        if task_id is not None:
            mark_task_failed(db, task_id=task_id,
                             error=f"apply_build:{gate}", job_id=None)
        _mark(False, f"build:{gate}")
        return {"applied": False, "error": gate}
    except Exception as e:
        msg = f"{type(e).__name__}:{str(e)[:300]}"
        try:
            if task_id is not None:
                from services.entity_upserter import mark_task_failed
                mark_task_failed(db, task_id=task_id,
                                 error=f"apply_exc:{msg}", job_id=None)
        except Exception:
            pass
        _mark(False, msg)
        return {"applied": False, "error": msg}


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
        # Identity policy: the claimer's agent_identity (stamped at
        # /next-time) must be a Haiku subagent. Belt-and-suspenders
        # check — even if a non-Haiku slipped past /next (it can't,
        # but defense in depth), /respond rejects.
        claim_row = db.execute(
            "SELECT agent_identity, status, step, apply_context_json, "
            "applied_at FROM llm_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if claim_row is None:
            from fastapi import HTTPException
            raise HTTPException(404, f"llm_job {job_id} not found")
        _require_haiku_drainer(claim_row["agent_identity"] or "")

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
        # ── Background applier ───────────────────────────────────────
        # If this is a product/article enrich job that carried an
        # apply_context, apply it NOW from the drainer's submit — so the
        # catalog row lands even if the BG thread that enqueued the job
        # already timed out (the silent-loss "huge activity, zero
        # result" bug). Idempotent with the inline upsert; an apply
        # hiccup is recorded on apply_error for QC and NEVER fails the
        # submit (the LLM output is still valid).
        apply_outcome = None
        if (status == "complete"
                and (claim_row["step"] or "") in (
                    "product_enrich", "article_enrich")
                and claim_row["apply_context_json"]
                and not claim_row["applied_at"]):
            apply_outcome = _apply_enrichment_job(
                db,
                job_id=job_id,
                apply_context_json=claim_row["apply_context_json"],
                output=output,
            )
        resp = {"id": job_id, "status": status, "completed_at": now}
        if apply_outcome is not None:
            resp["apply"] = apply_outcome
        return ok(resp, resource="llm_jobs")
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
            "created_at, claimed_at, completed_at, error, agent_identity, "
            "last_reaped_at, reap_count"
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
    # regenerate_exemplars defaults to True (2026-05-25) — the user
    # directive is that exemplars refresh every standardize run, so
    # the classifier never falls behind the latest house-style
    # examples in the catalog. Caller can opt out with an explicit
    # `{"regenerate_exemplars": false}` for tight debug loops.
    regenerate = bool(body.get("regenerate_exemplars", True))
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


@router.get("/admin/jobs/summary")
def admin_list_jobs_summary(
    kind: Optional[str] = None,
    status: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
):
    """Lean list of jobs — drops `log_tail` and `result_summary` so
    responses stay small even for 200+ jobs. Default registry CRUD
    on `/jobs` returns full rows including those two large columns,
    which blows the MCP truncation threshold (113 KB for 20 rows in
    the prior test).

    Filters:
      • kind: scrape | article_scrape | roaster_enrich | resolve_held
        | standardize | geolocate. Pass empty / null to widen.
      • status: queued | running | succeeded | failed | cancelled
      • since: ISO8601 — only jobs with started_at >= this value
      • limit: cap on rows (default 200, max 1000)

    Returns each job as: `{id, kind, status, started_by, started_at,
    finished_at, error_message, created_at}`. To inspect a single
    job's `log_tail` + `result_summary`, hit `/api/jobs/{id}` (full
    registry CRUD).
    """
    _require_admin(user)
    limit = max(1, min(limit, 1000))
    db = get_db()
    try:
        clauses: list[str] = []
        params: list = []
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if since:
            clauses.append("started_at >= ?")
            params.append(since)
        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        rows = db.execute(
            f"SELECT id, kind, status, started_by, started_at, "
            f"finished_at, error_message, created_at "
            f"FROM jobs {where_sql} "
            f"ORDER BY id DESC LIMIT ?",
            tuple(params) + (limit,),
        ).fetchall()
        return ok([dict(r) for r in rows],
                  resource="jobs", total=len(rows), summary=True)
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
                          summary: bool = False,
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
      • summary: when true, project each row down to lean fields only
        (id, job_id, product_id, change_type, status, created_at,
        roaster_slug, coffee_name, enrichment_status). Drops the full
        `proposed_state_json` + `prev_state_json` blobs. Lets an agent
        bucket 1000+ proposals inline without writing parsing scripts
        against saved files.
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

        if summary:
            import json as _json
            lean: list[dict] = []
            for r in rows:
                ps_raw = r.get("proposed_state_json")
                state = {}
                if ps_raw:
                    try:
                        state = _json.loads(ps_raw)
                    except Exception:
                        state = {}
                lean.append({
                    "id": r.get("id"),
                    "job_id": r.get("job_id"),
                    "product_id": r.get("product_id"),
                    "change_type": r.get("change_type"),
                    "status": r.get("status"),
                    "created_at": r.get("created_at"),
                    "roaster_slug": state.get("roaster_slug"),
                    "coffee_name": state.get("coffee_name"),
                    "enrichment_status": state.get("enrichment_status"),
                })
            return ok(lean, resource="scrape_proposals",
                      total=len(lean), summary=True)
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
    # params used for both the rollup query (no LIMIT) and the row query
    # (with LIMIT). The row query reuses params + appends limit.

    db = get_db()
    try:
        # ── Catalog-wide aggregations (do NOT bound by limit) ──
        # Rollups must reflect the full filter result so a tight
        # `limit` doesn't silently misrepresent the distribution.

        total_matching = db.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM products p
            LEFT JOIN roaster_profiles rp
                ON rp.roaster_slug = p.roaster_slug
            LEFT JOIN roaster_sources rs
                ON rs.website = rp.website
            {where_sql}
            """,
            tuple(params),
        ).fetchone()["c"]

        platform_rows = db.execute(
            f"""
            SELECT COALESCE(LOWER(rs.platform), 'unknown') AS platform,
                   COUNT(*) AS c
            FROM products p
            LEFT JOIN roaster_profiles rp
                ON rp.roaster_slug = p.roaster_slug
            LEFT JOIN roaster_sources rs
                ON rs.website = rp.website
            {where_sql}
            GROUP BY platform
            ORDER BY c DESC
            """,
            tuple(params),
        ).fetchall()

        roaster_rows = db.execute(
            f"""
            SELECT COALESCE(p.roaster_slug, 'unknown') AS roaster_slug,
                   COALESCE(LOWER(rs.platform), 'unknown') AS platform,
                   COUNT(*) AS c
            FROM products p
            LEFT JOIN roaster_profiles rp
                ON rp.roaster_slug = p.roaster_slug
            LEFT JOIN roaster_sources rs
                ON rs.website = rp.website
            {where_sql}
            GROUP BY p.roaster_slug, platform
            ORDER BY c DESC
            LIMIT 30
            """,
            tuple(params),
        ).fetchall()

        # by_null_field — for each of the 10 fields, count how many
        # of the matched products have it null. Tells the operator
        # WHICH fields are most often empty across the silent-empty
        # subset (altitude/producer almost always null; tasting/blurb
        # are the recoverable ones).
        null_field_counts: dict[str, int] = {}
        for f in _FIELDS:
            n = db.execute(
                f"""
                SELECT COUNT(*) AS c
                FROM products p
                LEFT JOIN roaster_profiles rp
                    ON rp.roaster_slug = p.roaster_slug
                LEFT JOIN roaster_sources rs
                    ON rs.website = rp.website
                {where_sql}
                AND (p.{f} IS NULL OR p.{f} = '')
                """,
                tuple(params),
            ).fetchone()["c"]
            null_field_counts[f] = n

        # ── Detail rows (bounded by limit) ──
        # Select all 10 nullable fields up-front to compute null_fields
        # without N+1 round-trips.
        sel_fields = ", ".join(f"p.{f}" for f in _FIELDS)
        row_params = list(params) + [limit]
        rows = db.execute(
            f"""
            SELECT p.product_id, p.coffee_name, p.roaster_slug,
                   p.enrichment_status, p.product_url, p.image_url,
                   p.created_at,
                   ({null_count_expr}) AS null_count,
                   COALESCE(LOWER(rs.platform), 'unknown') AS platform,
                   {sel_fields}
            FROM products p
            LEFT JOIN roaster_profiles rp
                ON rp.roaster_slug = p.roaster_slug
            LEFT JOIN roaster_sources rs
                ON rs.website = rp.website
            {where_sql}
            ORDER BY null_count DESC, p.roaster_slug, p.product_id
            LIMIT ?
            """,
            tuple(row_params),
        ).fetchall()

        out: list[dict] = []
        for r in rows:
            d = dict(r)
            null_fields = [f for f in _FIELDS if not d.get(f)]
            d["null_fields"] = null_fields
            # Strip the raw field values from the response — the
            # null_fields list carries the relevant signal and the raw
            # values bloat the payload.
            for f in _FIELDS:
                d.pop(f, None)
            out.append(d)

        rollups = {
            "by_platform": [
                {"platform": r["platform"], "count": r["c"]}
                for r in platform_rows
            ],
            "by_roaster": [
                {"roaster_slug": r["roaster_slug"],
                 "platform": r["platform"],
                 "count": r["c"]}
                for r in roaster_rows
            ],
            "by_null_field": [
                {"field": f, "count": null_field_counts[f],
                 "pct_of_matching": round(
                     100 * null_field_counts[f] / total_matching, 1
                 ) if total_matching else 0.0}
                for f in sorted(_FIELDS,
                                  key=lambda x: -null_field_counts[x])
            ],
        }

        return ok({
            "products": out,
            "total": total_matching,
            "returned": len(out),
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


# ── Per-tier debug fetchers (Tier 1-4 ladder, individually probeable) ──
#
# The dynamic extraction ladder lives in Scraper/enrich.py and runs as
# one fused pipeline during enrichment. These three routes expose each
# tier as a standalone diagnostic surface — an agent can probe one
# product without burning a full re-enrich cycle.
#
# Surfaced by MCP as:
#   crema_fetch_shopify_product → Tier 1 source (canonical /products/{handle}.json)
#   crema_fetch_page_text       → Tier 2-3 (JSON-LD + cleaned body text)
#   crema_render_page           → Tier 4 (Playwright headless render)
#
# Use case: Brown Gold (panduranga) landed empty post-reenrich because
# the page fetch timed out. Without these probes, the only way to
# distinguish "page unreachable" from "merchant copy is sparse" was to
# re-run enrichment and inspect the result. Now: hit fetch_page_text,
# get "" or short text in 5s, escalate to render_page only if needed.

_RENDER_SEMAPHORE = None  # initialised lazily; threading import is cheap


def _get_render_semaphore():
    global _RENDER_SEMAPHORE
    if _RENDER_SEMAPHORE is None:
        import threading
        _RENDER_SEMAPHORE = threading.Semaphore(3)
    return _RENDER_SEMAPHORE


@router.get("/admin/scrape/shopify-product")
def admin_fetch_shopify_product(handle: str,
                                  slug: Optional[str] = None,
                                  website: Optional[str] = None,
                                  user=Depends(get_current_user)):
    """Fetch one Shopify product's canonical JSON via /products/{handle}.json.

    Tier 1 probe — returns the full product (including body_html,
    variants, images, metafields if exposed). This is the same source
    the listing /products.json crawl pulls, but for one product.

    Resolves the storefront base from `slug` (roaster_sources lookup)
    or accepts an explicit `website` override.

    Returns: {body_html, title, handle, vendor, product_type, variants,
    images, raw} where raw is the full Shopify JSON for advanced
    inspection. Returns 404 if the product handle doesn't exist on the
    store (Shopify returns 404 in that case).
    """
    _require_admin(user)
    if not handle or not isinstance(handle, str):
        from fastapi import HTTPException
        raise HTTPException(422, "handle is required")
    base = None
    if website:
        base = website.rstrip("/")
    elif slug:
        db = get_db()
        try:
            row = db.execute(
                "SELECT rs.website FROM roaster_sources rs "
                "JOIN roaster_profiles rp ON rp.website = rs.website "
                "WHERE rp.roaster_slug = ?",
                (slug,),
            ).fetchone()
            if not row or not row["website"]:
                from fastapi import HTTPException
                raise HTTPException(404, f"No website on file for roaster {slug}")
            base = row["website"].rstrip("/")
        finally:
            db.close()
    else:
        from fastapi import HTTPException
        raise HTTPException(422, "Provide either slug or website")

    url = f"{base}/products/{handle}.json"
    try:
        import requests as _r
        resp = _r.get(
            url,
            headers={"User-Agent": "CremaCatalogBot/1.0"},
            timeout=15,
        )
    except (Exception,) as e:
        from fastapi import HTTPException
        raise HTTPException(502, f"Fetch failed: {type(e).__name__}: {e}")
    if resp.status_code == 404:
        from fastapi import HTTPException
        raise HTTPException(404, f"Shopify returned 404 for {url}")
    if resp.status_code != 200:
        from fastapi import HTTPException
        raise HTTPException(502, f"Shopify returned HTTP {resp.status_code}")
    try:
        data = resp.json()
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(502, "Shopify response was not valid JSON")
    product = data.get("product") if isinstance(data, dict) else None
    if not isinstance(product, dict):
        from fastapi import HTTPException
        raise HTTPException(502, "Response missing 'product' key")
    return ok({
        "url": url,
        "title": product.get("title"),
        "handle": product.get("handle"),
        "vendor": product.get("vendor"),
        "product_type": product.get("product_type"),
        "body_html": product.get("body_html"),
        "tags": product.get("tags"),
        "variants": product.get("variants"),
        "images": product.get("images"),
        "raw": product,
    }, resource="shopify_product")


@router.get("/admin/scrape/page-text")
def admin_fetch_page_text(url: str, user=Depends(get_current_user)):
    """Fetch a product detail page, run Tier 2-3 extraction, return text.

    Wraps `_fetch_product_page_text` from Scraper/enrich.py. Returns
    combined JSON-LD structured data + cleaned body text, capped at
    PAGE_TEXT_CAP chars. Wix URLs auto-route through the Wix hybrid
    fetcher (Playwright fallback built in there).

    Returns: {url, length, text} where text is the same string the
    ladder's Tier 2-3 step would feed to Haiku. Empty text indicates
    the fetch failed (timeout, 4xx, parse error) — distinguishing
    "page unreachable" from "merchant copy is sparse" requires
    inspecting the text length: 0 = unreachable, low (~hundreds) =
    sparse, high (thousands+) = rich.
    """
    _require_admin(user)
    if not url or not isinstance(url, str):
        from fastapi import HTTPException
        raise HTTPException(422, "url is required")
    if not url.startswith(("http://", "https://")):
        from fastapi import HTTPException
        raise HTTPException(422, "url must be http(s)")
    import sys
    from pathlib import Path
    SCRAPER_DIR = (
        Path(__file__).resolve().parent.parent.parent.parent / "Scraper"
    )
    if str(SCRAPER_DIR) not in sys.path:
        sys.path.insert(0, str(SCRAPER_DIR))
    try:
        import enrich as _enrich  # type: ignore
    except ImportError as e:
        from fastapi import HTTPException
        raise HTTPException(503, f"Couldn't import Scraper/enrich.py: {e}")
    try:
        text = _enrich._fetch_product_page_text(url)  # noqa: SLF001
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(502, f"Fetch error: {type(e).__name__}: {e}")
    return ok({
        "url": url,
        "length": len(text or ""),
        "text": text or "",
    }, resource="page_text")


@router.post("/admin/scrape/render-page")
def admin_render_page(body: dict = None, user=Depends(get_current_user)):
    """Render a page via headless Playwright, return the full HTML.

    Tier 4 of the ladder — bounded to 3 concurrent renders via a
    process-wide semaphore so a flood doesn't spawn ten Chromium
    instances. Use sparingly; this is the expensive escalation.

    Body: {"url": "https://..."}
    Returns: {url, length, html} where html is the post-DOM-settle
    rendered HTML (4s wait after DOMContentLoaded). Empty html
    indicates render failure (Playwright not installed, timeout,
    or the page hard-refused).
    """
    _require_admin(user)
    if not isinstance(body, dict):
        from fastapi import HTTPException
        raise HTTPException(422, "POST body must be JSON")
    url = body.get("url")
    if not url or not isinstance(url, str):
        from fastapi import HTTPException
        raise HTTPException(422, "url is required in body")
    if not url.startswith(("http://", "https://")):
        from fastapi import HTTPException
        raise HTTPException(422, "url must be http(s)")
    import sys
    from pathlib import Path
    SCRAPER_DIR = (
        Path(__file__).resolve().parent.parent.parent.parent / "Scraper"
    )
    if str(SCRAPER_DIR) not in sys.path:
        sys.path.insert(0, str(SCRAPER_DIR))
    try:
        import enrich as _enrich  # type: ignore
    except ImportError as e:
        from fastapi import HTTPException
        raise HTTPException(503, f"Couldn't import Scraper/enrich.py: {e}")
    sem = _get_render_semaphore()
    acquired = sem.acquire(timeout=120)
    if not acquired:
        from fastapi import HTTPException
        raise HTTPException(
            503,
            "Render slot busy after 120s — 3 concurrent renders already "
            "in flight. Retry shortly.",
        )
    try:
        html = _enrich._fetch_page_via_playwright(url)  # noqa: SLF001
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(502, f"Render error: {type(e).__name__}: {e}")
    finally:
        sem.release()
    return ok({
        "url": url,
        "length": len(html or ""),
        "html": html or "",
    }, resource="rendered_page")


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


# Enrichment fields produced by the LLM extraction pipeline. When a
# proposal's enrichment_status='failed', these fields contain either
# null OR regex-fallback garbage from the scraper (e.g. truncated
# "Ia – Chikmagalur; This Coffee Is A Single-Or…" instead of a clean
# origin). NEVER let that garbage land on the live row — null them
# out before applying.
_LLM_ENRICHMENT_FIELDS = (
    "origin", "varietal", "process", "process_raw",
    "altitude_masl", "tasting_notes", "flavor_notes",
    "producer", "roaster_blurb", "roast_level_name",
    "origin_region", "varietal_canonical", "bean_type",
    "brew_recommendation_json", "roast_level",
)


def _should_skip_failed_proposal(db, product_id: str) -> bool:
    """Decision rule for 'failed' enrichment proposals:

    If the live row already has enrichment_status='enriched', we MUST
    NOT downgrade it by applying a failed proposal. Today's failed
    scrape is by definition worse than yesterday's successful one —
    don't replace good data with the scraper's regex-fallback output.

    Returns True when the proposal should be SKIPPED entirely.
    """
    live_row = db.execute(
        "SELECT enrichment_status FROM products WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    if not live_row:
        return False  # New product — apply as source_thin
    return live_row["enrichment_status"] == "enriched"


def _apply_failed_as_thin(db, proposal_row) -> dict:
    """Apply a 'failed' enrichment proposal as a brand-new (or upgrade-
    from-thin) source_thin row. **Strips the LLM enrichment fields to
    null** — those contain regex-fallback garbage from the scraper and
    must never be presented as enriched data. Keeps the structural
    fields (coffee_name, product_url, price, image_url, weight_grams,
    available, bean_type when set by the scraper, etc.) untouched.

    Caller MUST have already checked _should_skip_failed_proposal —
    this function assumes the live row is NOT already enriched.

    Returns the dict that was applied.
    """
    state = json.loads(proposal_row["proposed_state_json"] or "{}")
    for k in _LLM_ENRICHMENT_FIELDS:
        state[k] = None
    state["enrichment_status"] = "source_thin"
    modified = dict(proposal_row)
    modified["proposed_state_json"] = json.dumps(state)
    scrape_runner.apply_proposal(db, modified)
    return state


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
            f"SELECT id, product_id, change_type, proposed_state_json "
            f"FROM scrape_proposals "
            f"WHERE {where_sql} ORDER BY id ASC",
            tuple(params),
        ).fetchall()

        approve_ids: list[int] = []
        reject_ids: list[int] = []
        thin_targets: list[dict] = []  # 'failed' enrich + no enriched live → apply as source_thin
        protected: list[dict] = []      # 'failed' enrich + live already enriched → SKIP, leave pending
        held: list[dict] = []            # strict_checks violations only
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
            # `enrichment_status` as the gate.
            es = state.get("enrichment_status")
            pid = r["product_id"]

            if es == "failed":
                # 3-branch decision rule (2026-05-22 rewrite, replacing
                # the broken COALESCE-merge attempt):
                #   1) Live row exists AND is enriched → SKIP. A failed
                #      proposal contains regex-fallback garbage from
                #      the scraper; never let that overwrite good
                #      enriched data. Leave the proposal pending so a
                #      future fresh scrape + enrichment can replace it.
                #   2) Live row is new/thin/failed → apply as source_thin,
                #      with LLM enrichment fields nulled (no garbage
                #      lands on the live row). UI renders "details
                #      unavailable".
                if _should_skip_failed_proposal(db, pid):
                    protected.append({
                        "id": r["id"],
                        "product_id": pid,
                        "coffee_name": state.get("coffee_name"),
                    })
                else:
                    thin_targets.append({
                        "id": r["id"],
                        "product_id": pid,
                        "coffee_name": state.get("coffee_name"),
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
                "applied_thin": len(thin_targets),
                "protected_from_downgrade": len(protected),
                "rejected": len(reject_ids),
                "held_for_review": len(held),
                "skipped": skipped,
                "dry_run": True,
                "strict_checks": strict_checks,
                "approved_ids": approve_ids,
                "thin_ids": [t["id"] for t in thin_targets],
                "protected_ids": [t["id"] for t in protected],
                "rejected_ids": reject_ids,
                "held": held,
                "thin": thin_targets,
                "protected": protected,
            }, resource="scrape_proposals")

        approved_summary = (catalog_ops.approve_proposals(db, approve_ids)
                              if approve_ids else {"applied": 0})
        rejected_summary = (catalog_ops.reject_proposals(db, reject_ids)
                              if reject_ids else {"rejected": 0})

        # Apply thin targets (failed enrichment + no enriched live row).
        # _apply_failed_as_thin nulls the LLM enrichment fields to avoid
        # presenting regex-fallback garbage as data; sets row's
        # enrichment_status='source_thin'.
        thin_applied = 0
        thin_skipped = 0
        from datetime import datetime as _dt
        now_iso = _dt.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        for t in thin_targets:
            row = db.execute(
                "SELECT * FROM scrape_proposals WHERE id = ?", (t["id"],),
            ).fetchone()
            if not row or row["status"] != "pending":
                thin_skipped += 1
                continue
            try:
                _apply_failed_as_thin(db, dict(row))
            except Exception:
                thin_skipped += 1
                continue
            db.execute(
                "UPDATE scrape_proposals SET status='applied', applied_at=? "
                "WHERE id=?",
                (now_iso, t["id"]),
            )
            thin_applied += 1
        db.commit()

        return ok({
            "approved": len(approve_ids),
            "applied_thin": thin_applied,
            "protected_from_downgrade": len(protected),
            "rejected": len(reject_ids),
            "held_for_review": len(held),
            "skipped": skipped,
            "thin_skipped": thin_skipped,
            "dry_run": False,
            "strict_checks": strict_checks,
            "approved_summary": approved_summary,
            "rejected_summary": rejected_summary,
            "held": held,
            "thin": thin_targets,
            "protected": protected,
        }, resource="scrape_proposals")
    finally:
        db.close()


@router.post("/admin/scrape/proposals/resolve-held")
def admin_resolve_held_proposals(
    body: Optional[dict] = None,
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """Resolve currently-held proposals (status='pending' that were held
    by the pre-2026-05-22 auto_approve policy or by strict_checks
    violations the operator wants cleared).

    Two modes:
      • `dry_run: true` (sync) — counts the held targets and returns
        immediately with no DB mutation. Cheap.
      • non-dry-run (ASYNC) — enqueues a `resolve_held` job and adds a
        BackgroundTask. Returns 202 with `{job_id, status: "queued"}`.
        The caller polls `/api/jobs/{job_id}` for completion; the
        result_summary contains the full disposition counts + detail
        list. This is the 2026-05-24 rewrite — the prior sync path
        timed out at the proxy because per-proposal re-enrichment
        runs Sonnet through the LLM queue, which can take 30s each
        for 50+ proposals.

    Per held proposal (BG runner):
      1. Re-run enrichment ONCE via product_enricher (one shot through
         the Tier 1-4 ladder — last chance to recover real data from a
         page that may have been transiently unreachable).
      2. If retry now produces enrichment_status='enriched', apply
         normally (overwrite path — the new data IS the latest correct
         extraction).
      3. If retry still fails, apply with safe merge (preserve any
         existing live-row enrichment fields, mark the resulting row
         as enrichment_status='source_thin').
      4. NEVER reject for lack of information. The policy: if a product
         is structurally legitimate (coffee bean, has URL, has name), it
         belongs in the catalog. Missing specs are a UI concern,
         signalled via enrichment_status='source_thin'.

    Body (all optional):
      • slug: scope to one roaster
      • limit: cap on proposals to process (default 50, max 200)
      • dry_run: count only, no DB mutation, sync response
    """
    _require_admin(user)
    body = body or {}
    scope_slug = (body.get("slug") or "").strip() or None
    dry_run = bool(body.get("dry_run"))
    limit = max(1, min(int(body.get("limit") or 50), 200))

    # Non-dry-run path delegates to BG task. We do a quick scope-count
    # under dry_run semantics first so the response carries "would
    # process N targets" — useful for the caller to know what they're
    # about to spend.
    if not dry_run:
        db = get_db()
        try:
            # Count targets the same way the runner will
            import json as _json
            where = ["status = 'pending'"]
            params: list = []
            if scope_slug:
                where.append("product_id LIKE ?")
                params.append(f"{scope_slug}_%")
            where_sql = " AND ".join(where)
            rows = db.execute(
                f"SELECT id, proposed_state_json FROM scrape_proposals "
                f"WHERE {where_sql} ORDER BY id ASC LIMIT ?",
                tuple(params) + (limit * 4,),
            ).fetchall()
            held_count = 0
            for r in rows:
                try:
                    s = _json.loads(r["proposed_state_json"] or "{}")
                except Exception:
                    continue
                if s.get("enrichment_status") == "failed":
                    held_count += 1
                    if held_count >= limit:
                        break

            try:
                # bypass_mutex=True — per-slug concurrent resolve_held
                # is safe (each run scopes its SELECT by slug) and
                # required for autonomy: serializing on the global
                # mutex tempted SDK shortcuts when caramelly +
                # project-kaapi resolves had to run back-to-back.
                # Each per-roaster run keeps its own visibility job
                # row + its own per-proposal apply transactions.
                job_id = catalog_ops.enqueue_job(
                    db, "resolve_held", started_by=user["id"],
                    bypass_mutex=True,
                )
            except catalog_ops.JobConflict as e:
                from fastapi import HTTPException
                raise HTTPException(
                    409, str(e),
                    headers={"X-Live-Job-Id": str(e.live_job_id)},
                )
            db.execute(
                "UPDATE jobs SET log_tail = ? WHERE id = ?",
                (json.dumps({
                    "scope_slug": scope_slug,
                    "limit": limit,
                    "held_count_at_enqueue": held_count,
                }), job_id),
            )
            db.commit()
            background_tasks.add_task(
                catalog_ops.run_resolve_held_job,
                job_id,
                scope_slug=scope_slug,
                limit=limit,
            )
            return ok({
                "job_id": job_id,
                "status": "queued",
                "held_count_at_enqueue": held_count,
                "scope_slug": scope_slug,
                "limit": limit,
            }, resource="scrape_proposals")
        finally:
            db.close()

    db = get_db()
    try:
        import json as _json
        # Find held proposals = status='pending' with proposed_state's
        # enrichment_status='failed'. Note: 'pending' proposals with
        # enrichment_status='enriched' that landed AFTER the auto_approve
        # run may also exist; resolve_held leaves them alone (the next
        # auto_approve will pick them up cleanly).
        where = ["status = 'pending'"]
        params: list = []
        if scope_slug:
            where.append("product_id LIKE ?")
            params.append(f"{scope_slug}_%")
        where_sql = " AND ".join(where)
        rows = db.execute(
            f"SELECT id, product_id, proposed_state_json "
            f"FROM scrape_proposals WHERE {where_sql} "
            f"ORDER BY id ASC LIMIT ?",
            tuple(params) + (limit * 4,),  # over-fetch; filter for 'failed' below
        ).fetchall()

        held_targets = []
        for r in rows:
            try:
                state = _json.loads(r["proposed_state_json"] or "{}")
            except Exception:
                continue
            if state.get("enrichment_status") == "failed":
                held_targets.append(dict(r))
                if len(held_targets) >= limit:
                    break

        if dry_run:
            return ok({
                "processed": 0,
                "would_process": len(held_targets),
                "dry_run": True,
                "targets": [
                    {"id": t["id"], "product_id": t["product_id"]}
                    for t in held_targets
                ],
            }, resource="scrape_proposals")

        succeeded_on_retry = 0
        applied_thin = 0
        skipped_live_enriched = 0
        errored = 0
        detail: list[dict] = []
        from datetime import datetime as _dt
        from services.llm_router import set_pipeline_context as _set_ctx

        for r in held_targets:
            try:
                state = _json.loads(r["proposed_state_json"] or "{}")
            except Exception:
                errored += 1
                detail.append({
                    "id": r["id"],
                    "product_id": r["product_id"],
                    "outcome": "errored",
                    "reason": "proposed_state_json could not be parsed",
                })
                continue
            # Stamp pipeline context so the queued llm_job has the right
            # roaster_slug (avoids the 'unknown' bug we just fixed).
            _set_ctx(roaster_slug=state.get("roaster_slug"))
            # v2 retry path (2026-05-26). Previously called the
            # retired v1 product_enricher.enrich_product which now
            # raises ProductEnricherError. Switch to the v2 helper:
            # look up the live products row by product_id, run it
            # through entity_reenricher.reenrich_one_product (which
            # fetches page, calls Haiku, upserts), and if the upsert
            # landed an enriched row, marker the proposal as resolved.
            enriched = None
            try:
                from services.entity_reenricher import reenrich_one_product
                live_row = db.execute(
                    "SELECT * FROM products WHERE product_id = ?",
                    (r["product_id"],),
                ).fetchone()
                if not live_row:
                    # No live row to v2-re-enrich; fall through to
                    # apply_thin/skip below (`enriched=None`).
                    pass
                else:
                    res = reenrich_one_product(db, dict(live_row))
                    if res.outcome in ("updated", "inserted"):
                        # Re-read the row — v2 wrote directly. We
                        # shape it like the v1 enricher's return so
                        # the merge-and-apply path below stays the
                        # same.
                        fresh = db.execute(
                            "SELECT * FROM products WHERE product_id = ?",
                            (r["product_id"],),
                        ).fetchone()
                        enriched = dict(fresh) if fresh else None
            except Exception as e:
                enriched = None
                detail.append({
                    "id": r["id"],
                    "product_id": r["product_id"],
                    "outcome": "retry_errored_apply_thin",
                    "reason": f"v2 retry: {type(e).__name__}: {e}",
                })

            now_iso = _dt.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

            if enriched and enriched.get("enrichment_status") == "enriched":
                # Retry success — apply with the freshly-enriched state.
                modified = dict(r)
                # Merge enriched into state so we don't drop scraped
                # fields (image_url, price, etc.) that product_enricher
                # may not have touched. Enriched values win.
                merged_state = dict(state)
                merged_state.update({k: v for k, v in enriched.items()
                                       if v is not None})
                modified["proposed_state_json"] = _json.dumps(merged_state)
                try:
                    scrape_runner.apply_proposal(db, modified)
                    db.execute(
                        "UPDATE scrape_proposals SET status='applied', "
                        "applied_at=? WHERE id=?",
                        (now_iso, r["id"]),
                    )
                    succeeded_on_retry += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "coffee_name": merged_state.get("coffee_name"),
                        "outcome": "succeeded_on_retry",
                    })
                except Exception as e:
                    errored += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "outcome": "errored",
                        "reason": f"apply failed: {type(e).__name__}: {e}",
                    })
            else:
                # Retry still failed (or product_enricher threw).
                # Apply 3-branch logic: skip if live is already enriched
                # (never downgrade); else apply as source_thin with
                # enrichment fields nulled out (no garbage on live).
                if _should_skip_failed_proposal(db, r["product_id"]):
                    skipped_live_enriched += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "coffee_name": state.get("coffee_name"),
                        "outcome": "skipped_live_enriched",
                        "reason": "live row already enriched; failed proposal would downgrade — leaving live data intact, proposal stays pending for future fresh enrichment",
                    })
                else:
                    try:
                        _apply_failed_as_thin(db, r)
                        db.execute(
                            "UPDATE scrape_proposals SET status='applied', "
                            "applied_at=? WHERE id=?",
                            (now_iso, r["id"]),
                        )
                        applied_thin += 1
                        detail.append({
                            "id": r["id"],
                            "product_id": r["product_id"],
                            "coffee_name": state.get("coffee_name"),
                            "outcome": "applied_thin",
                            "reason": "ladder exhausted + no enriched live; applied with enrichment fields nulled + source_thin status",
                        })
                    except Exception as e:
                        errored += 1
                        detail.append({
                            "id": r["id"],
                            "product_id": r["product_id"],
                            "outcome": "errored",
                            "reason": f"apply_failed_as_thin error: {type(e).__name__}: {e}",
                        })
            db.commit()

        return ok({
            "processed": len(held_targets),
            "succeeded_on_retry": succeeded_on_retry,
            "applied_thin": applied_thin,
            "skipped_live_enriched": skipped_live_enriched,
            "errored": errored,
            "dry_run": False,
            "detail": detail,
        }, resource="scrape_proposals")
    finally:
        db.close()


@router.post("/admin/scrape/proposals/revert-applied-since")
def admin_revert_proposals_applied_since(body: dict = None,
                                            user=Depends(get_current_user)):
    """Revert every proposal applied at-or-after a given timestamp.

    For each matching `status='applied'` row: replay prev_state_json
    onto the products table (or DELETE if it was an insert), flip the
    proposal back to `status='pending'`, clear `applied_at`. Restores
    the live row to its pre-apply state. Inserts without a captured
    prev_state are best-effort deleted only if the row is still
    `source='scraped'`.

    Use case: a buggy auto_approve run applied bad proposals to good
    rows; this undoes the damage so a fresh re-enrichment can produce
    correct data.

    Body:
      • applied_at_after: ISO8601 timestamp (required). All proposals
        with `applied_at >= this_value` are candidates.
      • slug: optional roaster slug filter (matches product_id prefix).
      • dry_run: list candidates without mutating.
      • limit: cap on rows (default 1000, max 5000).

    Returns: {reverted, skipped, detail: [{id, product_id, change_type,
      outcome}]}
    """
    _require_admin(user)
    body = body or {}
    applied_at_after = (body.get("applied_at_after") or "").strip()
    if not applied_at_after:
        raise HTTPException(422, "applied_at_after (ISO8601) is required")
    scope_slug = (body.get("slug") or "").strip() or None
    dry_run = bool(body.get("dry_run"))
    limit = max(1, min(int(body.get("limit") or 1000), 5000))

    db = get_db()
    try:
        where = ["status = 'applied'", "applied_at >= ?"]
        params: list = [applied_at_after]
        if scope_slug:
            where.append("product_id LIKE ?")
            params.append(f"{scope_slug}_%")
        rows = db.execute(
            f"SELECT id, product_id, change_type, prev_state_json, "
            f"proposed_state_json, applied_at "
            f"FROM scrape_proposals WHERE {' AND '.join(where)} "
            f"ORDER BY applied_at ASC, id ASC LIMIT ?",
            tuple(params) + (limit,),
        ).fetchall()

        if dry_run:
            return ok({
                "would_revert": len(rows),
                "dry_run": True,
                "targets": [
                    {
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "change_type": r["change_type"],
                        "applied_at": r["applied_at"],
                    }
                    for r in rows
                ],
            }, resource="scrape_proposals")

        reverted = 0
        skipped = 0
        detail: list[dict] = []
        from datetime import datetime as _dt
        now_iso = _dt.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        for r in rows:
            prop = dict(r)
            try:
                scrape_runner.revert_proposal(db, prop)
                db.execute(
                    "UPDATE scrape_proposals "
                    "SET status='pending', applied_at=NULL "
                    "WHERE id=?",
                    (prop["id"],),
                )
                reverted += 1
                detail.append({
                    "id": prop["id"],
                    "product_id": prop["product_id"],
                    "change_type": prop["change_type"],
                    "outcome": "reverted",
                })
            except Exception as e:
                skipped += 1
                detail.append({
                    "id": prop["id"],
                    "product_id": prop["product_id"],
                    "change_type": prop["change_type"],
                    "outcome": "skipped",
                    "reason": f"{type(e).__name__}: {e}",
                })
        db.commit()
        return ok({
            "reverted": reverted,
            "skipped": skipped,
            "dry_run": False,
            "applied_at_after": applied_at_after,
            "detail": detail[:50],  # cap response size
            "detail_truncated": len(detail) > 50,
            "total_processed": len(rows),
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


@router.post("/admin/products/{product_id}/set-available")
def admin_set_product_available(product_id: str, body: dict,
                                user=Depends(get_current_user)):
    """Manually set `products.available` to 1 or 0. Logged as a
    `catalog_operations` row (kind='manual_set_available') with a
    pre-mutation snapshot so it's undoable via
    crema_rollback_catalog_operation. The companion to
    /sold-out (which only sets available=0) — this can also UN-HIDE an
    in-stock bean (available=1) without a full re-enrich.

    Body: { available: bool } (or 0/1)."""
    _require_admin(user)
    body = body or {}
    if "available" not in body:
        from fastapi import HTTPException
        raise HTTPException(422, "body must include 'available' (bool)")
    available = bool(body.get("available"))
    db = get_db()
    try:
        return ok(
            catalog_ops.set_product_available(
                db, product_id, available, started_by=user["id"],
            ),
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
        # Capture the existing name before the UPDATE so we know
        # whether the canonical name actually changed (and need to
        # propagate to products.roaster_name).
        old_canonical_name = existing["name"] if "name" in existing.keys() else None
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
        # Bio-update name propagation (added 2026-05-26). When the
        # canonical roaster_profiles.name changes via bio enrichment,
        # propagate to products.roaster_name for every row of this
        # roaster. Without this, the v2 upserter only restamps
        # products.roaster_name when a row is INSERTed or UPDATEd —
        # rows untouched by the current sweep keep the OLD canonical,
        # producing denorm_drift. The 2026-05-25 sweep surfaced 149
        # drifted rows (Black Baza, Subko, Corridor Seven, Sleepy
        # Owl, 7000 Steps class) — all explained by this timing gap.
        new_name = profile.get("name")
        if new_name and new_name != old_canonical_name:
            db.execute(
                "UPDATE products SET roaster_name = ? "
                "WHERE roaster_slug = ?",
                (new_name, slug),
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
    # Bio-as-discovery (2026-05-27): JSON-serialize the three URL
    # lists for storage. Always update on every bio enrich — these
    # are ephemeral facts about the homepage as it exists right now,
    # NOT operator-curated config, so anti-fallback discipline
    # doesn't apply.
    discovered_products_json = json.dumps(
        source.get("discovered_product_urls") or []
    )
    discovered_articles_json = json.dumps(
        source.get("discovered_article_urls") or []
    )
    discovered_collections_json = json.dumps(
        source.get("discovered_collection_urls") or []
    )
    if not existing_src:
        db.execute(
            "INSERT INTO roaster_sources "
            "(name, website, shop_url, platform, city, state, enabled, "
            " added_at, discovered_product_urls, discovered_article_urls, "
            " discovered_collection_urls, bio_discovery_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
            (
                profile.get("name") or slug,
                profile["website"],
                source.get("shop_url"),
                source.get("platform"),
                profile.get("city"),
                profile.get("state"),
                now,
                discovered_products_json,
                discovered_articles_json,
                discovered_collections_json,
                now,
            ),
        )
    else:
        # NO COALESCE on shop_url / platform / city / state —
        # re-enrichment does not modify scrape config (anti-fallback
        # discipline per CRUD_UTOPIA; admin owns those via explicit
        # crema_update_scrape_settings calls).
        #
        # BUT: discovered_*_urls + bio_discovery_at ARE ephemeral
        # homepage facts that should always refresh — they're the
        # input to bio T1+T2's URL-drift detection, and stale lists
        # would mask real catalog/website drift.
        db.execute(
            "UPDATE roaster_sources SET "
            "  discovered_product_urls = ?, "
            "  discovered_article_urls = ?, "
            "  discovered_collection_urls = ?, "
            "  bio_discovery_at = ? "
            "WHERE website = ?",
            (
                discovered_products_json,
                discovered_articles_json,
                discovered_collections_json,
                now,
                profile["website"],
            ),
        )
    db.commit()

    # Bio quality review (2026-05-27): run T1 deterministic
    # heuristics over the bio output + discovered link graph
    # against the catalog. Flags persist as 'confirmed' directly
    # (bio rules are deterministic — no T2 Haiku review needed).
    # Best-effort: never let QR failures block the enrichment.
    try:
        from services import quality_reviewer as qr
        # Re-read the upserted profile + source rows so we pass the
        # post-write state to QR (matches what consumers see).
        profile_row = db.execute(
            "SELECT * FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        source_row = db.execute(
            "SELECT * FROM roaster_sources WHERE website = ?",
            (profile["website"],),
        ).fetchone()
        catalog_urls = [
            r["product_url"] for r in db.execute(
                "SELECT product_url FROM products "
                "WHERE roaster_slug = ? AND product_url IS NOT NULL "
                "AND product_url != ''",
                (slug,),
            ).fetchall()
        ]
        if profile_row and source_row:
            bundle = qr.run_t1_bio(
                roaster_slug=slug,
                profile=dict(profile_row),
                source=dict(source_row),
                catalog_product_urls=catalog_urls,
            )
            qr.persist_flags(
                db, bundle, now_iso=now, default_verdict="confirmed",
            )
    except Exception as e:
        # Bio QR is best-effort; never fail the bio enrich itself.
        print(f"bio quality review note ({slug}): {type(e).__name__}: {e}")

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

        # Stamp pipeline context so any downstream call_llm queues with
        # the correct roaster_slug. Mirrors _orchestrate_refresh_all.
        from services.llm_router import set_pipeline_context
        set_pipeline_context(roaster_slug=slug)

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


# ── Context-rot mitigation (2026-05-27) ──────────────────────────────────
#
# Tools return `next_steps` arrays that structurally encode the
# orchestrator's follow-on workflow IN THE WORKING MEMORY at decision
# time. This replaces "the cheat-sheet said to do X next" (slow memory,
# easily lost to context rot after 100 tool calls) with "the previous
# tool response told you to do X next" (working memory, present at the
# exact moment the orchestrator picks the next action).


def _next_step(tool: str, args: dict, why: str) -> dict:
    """One entry in a tool response's next_steps array. The
    orchestrator reads these as a structured directive in working
    memory rather than from documentation in slow memory."""
    return {"tool": tool, "args": args, "why": why}

# Standardize-run serialization (2026-05-26 fix). During a catalog-wide
# refresh sweep, every per-roaster _orchestrate_refresh_all spawns a
# _wait_and_standardize thread which calls catalog_ops.run_standardize_job
# directly (in-process). Without coordination, 106 threads run the
# classifier on overlapping unclassified slices in parallel — drainers
# see "duplicate input batches", Haiku tokens get spent N times on the
# same rows, and last-write-wins races make exemplar regeneration
# non-deterministic.
#
# The lock allows at most ONE standardize run at a time. Threads that
# can't acquire set the follow-up flag; the in-flight runner re-fires
# (looping once more) so trailing data still gets classified before
# returning. Bounded: the loop exits when no new follow-up was flagged
# during the most recent run.
import threading as _threading_for_std
_STANDARDIZE_RUN_LOCK = _threading_for_std.Lock()
_STANDARDIZE_FOLLOWUP_NEEDED = _threading_for_std.Event()


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
    parent_operation_id: Optional[int] = None,
    force_enrich: bool = False,
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
    #
    # HEAD-OF-LINE FIX (2026-05-30): bio's `call_llm` BLOCKS the worker
    # thread until a drainer answers (up to 600s, ×2 for the bio+hint
    # pair). On a re-enrich the `roaster_sources` row already exists, so
    # the scrape (step 4) does NOT need bio to have run — yet the old
    # ordering ran bio inline FIRST, stalling product enrichment by 10+
    # minutes whenever no drainer was on the bio queue (gb-roasters op
    # 2262: scrape thread didn't dispatch until 11 min after sync, by
    # which point the operator had given up polling). So: when a valid
    # sources row already exists, we run bio in its OWN daemon thread
    # (still best-effort) and let step 4 dispatch immediately. Only when
    # the sources row is MISSING (true first-time onboarding, where bio
    # is what CREATES it) do we run bio inline-first and re-check.
    def _run_bio(reason: str):
        bdb = get_db()
        try:
            _orch_log(slug, f"step2 bio enrich ({reason}) …")
            applied = _apply_roaster_enrichment(bdb, website)
            _orch_log(slug, f"step2 bio enrich complete — slug={applied.get('slug')}")
        except roaster_enricher.RoasterEnricherError as e:
            _orch_log(slug, f"step2 BIO ENRICH FAILED (RoasterEnricherError): {e}")
        except Exception as e:
            _orch_log(slug, f"step2 BIO ENRICH FAILED (unexpected {type(e).__name__}): {e}")
        finally:
            bdb.close()

    import threading

    # Does a usable sources row already exist? If so, scrape can start
    # without waiting on bio.
    db = get_db()
    try:
        src_row = db.execute(
            "SELECT id, shop_url, platform FROM roaster_sources rs "
            "JOIN roaster_profiles rp ON rp.website = rs.website "
            "WHERE rp.roaster_slug = ?",
            (slug,),
        ).fetchone()
    finally:
        db.close()

    sources_ready = bool(
        src_row and src_row["shop_url"] and src_row["platform"]
    )

    if sources_ready:
        # Re-enrich path: bio is non-blocking background; scrape proceeds.
        threading.Thread(
            target=_run_bio, args=("background, sources already present",),
            daemon=True,
        ).start()
        _orch_log(
            slug,
            "step2 bio dispatched as non-blocking thread "
            "(sources row present — scrape won't wait on bio)",
        )
    else:
        # First-time onboarding: bio CREATES the sources row, so it must
        # run inline before the scrape preflight can pass.
        _orch_log(slug, "step2 no usable sources row — running bio inline first")
        _run_bio("inline, needed to create sources row")

    # Step 3 — pre-flight check for scrape (shop_url + platform).
    # Re-read (bio may have just created/updated the sources row on the
    # onboarding path).
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

        scrape_thread = threading.Thread(
            target=catalog_ops.scrape_one_roaster,
            kwargs={
                "roaster_slug": slug,
                "user_id": user_id,
                "regenerate_prompt": regenerate_prompt,
                "parent_operation_id": parent_operation_id,
                "force_enrich": force_enrich,
            },
            daemon=True,
        )
        scrape_thread.start()
        _orch_log(slug, "step4 scrape thread dispatched (per-roaster workspace, no mutex)")

        article_thread = threading.Thread(
            target=catalog_ops.article_scrape_one_roaster,
            kwargs={
                "roaster_slug": slug,
                "user_id": user_id,
                "regenerate_article_hint": regenerate_article_hint,
                "parent_operation_id": parent_operation_id,
            },
            daemon=True,
        )
        article_thread.start()
        _orch_log(slug, "step4 article scrape thread dispatched (no mutex)")

        # Step 5 — chain a catalog-wide standardize run after both
        # scrape threads complete (added 2026-05-25 per user
        # directive: every refresh MUST trigger standardization with
        # exemplar refresh so the controlled vocabularies stay in
        # sync with the catalog). Runs in its own daemon thread so
        # the orchestrator returns immediately; the standardize run
        # waits for both scrape threads, enqueues a `standardize`
        # jobs row, and invokes the runner in-process. If standardize
        # has nothing to classify (no new inputs since last run), the
        # runner short-circuits with a cheap "nothing to classify"
        # exit — costs zero Haiku tokens.
        def _wait_and_standardize():
            scrape_thread.join()
            article_thread.join()
            _orch_log(
                slug, "step5 scrape + article threads complete; "
                "checking standardize lock"
            )

            # Serialize across the whole process (2026-05-26 fix).
            # If another _wait_and_standardize is already running, set
            # the follow-up flag and return — the in-flight runner
            # will re-fire to catch our data.
            if not _STANDARDIZE_RUN_LOCK.acquire(blocking=False):
                _STANDARDIZE_FOLLOWUP_NEEDED.set()
                _orch_log(
                    slug,
                    "step5 standardize already running — flagged "
                    "follow-up, exiting (in-flight runner will "
                    "re-fire to pick up our scrape's classifications)"
                )
                return

            try:
                # Loop: run standardize, then check if any other
                # caller flagged a follow-up while we were running.
                # If yes, run again (bounded — the loop exits when
                # no new follow-up flag was set during the most
                # recent iteration).
                iteration = 0
                while True:
                    iteration += 1
                    # Clear the flag BEFORE running so any caller
                    # that arrives during our run can re-set it.
                    _STANDARDIZE_FOLLOWUP_NEEDED.clear()

                    inner_db = get_db()
                    try:
                        try:
                            std_job_id = catalog_ops.enqueue_job(
                                inner_db, "standardize",
                                started_by=user_id, bypass_mutex=True,
                            )
                        except Exception as e:
                            _orch_log(
                                slug,
                                f"step5 enqueue standardize FAILED "
                                f"(iter={iteration}): "
                                f"{type(e).__name__}: {e}"
                            )
                            return
                    finally:
                        inner_db.close()

                    try:
                        catalog_ops.run_standardize_job(
                            std_job_id, regenerate_exemplars=True,
                        )
                        _orch_log(
                            slug,
                            f"step5 standardize complete (iter={iteration}, "
                            f"job={std_job_id})"
                        )
                    except Exception as e:
                        _orch_log(
                            slug,
                            f"step5 standardize FAILED (iter={iteration}, "
                            f"job={std_job_id}): "
                            f"{type(e).__name__}: {e}"
                        )
                        return

                    if not _STANDARDIZE_FOLLOWUP_NEEDED.is_set():
                        _orch_log(
                            slug,
                            f"step5 no follow-up flagged — exiting "
                            f"(total iterations: {iteration})"
                        )
                        break
                    _orch_log(
                        slug,
                        f"step5 follow-up flag set during iter={iteration} "
                        "— re-running to catch trailing data"
                    )
            finally:
                _STANDARDIZE_RUN_LOCK.release()

        threading.Thread(
            target=_wait_and_standardize, daemon=True,
        ).start()
        _orch_log(slug, "step5 standardize hook dispatched (awaits step4 threads)")
        _orch_log(slug, "orchestrator DONE — scrape + article + chained standardize")
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

    fired_at = _now_iso()
    return ok(
        {
            "slug": slug,
            "queued": True,
            "regenerate_prompt": regenerate_prompt,
            "regenerate_article_hint": regenerate_article_hint,
            "fired_at": fired_at,
            "message": "Refresh queued. Poll crema_list_llm_jobs "
                       "(or crema_list_jobs for scrape-level progress).",
            "next_steps": [
                _next_step(
                    "crema_list_jobs",
                    {"kind": "scrape", "status": "running", "limit": 5},
                    "verify the BG scrape worker is running. Wait "
                    "for status='succeeded' on this slug's job "
                    "before triaging.",
                ),
                _next_step(
                    "crema_list_quality_reviews",
                    {"target_table": "roaster_profiles",
                     "verdict": "confirmed", "roaster_slug": slug,
                     "limit": 10},
                    "bio T1 findings for this roaster (URL drift, "
                    "specialties punt, etc.). Catches Nandan-class "
                    "issues at the source.",
                ),
                _next_step(
                    "crema_run_quality_review_sweep",
                    {"target_table": "products", "slug": slug},
                    "retroactively drain T1 product flags for this "
                    "roaster's catalog after the refresh lands.",
                ),
            ],
        },
        resource="roaster_refresh",
    )


def _orchestrate_full_reenrich(
    *,
    slug: str,
    sync_mode: str,
    regenerate_prompt: bool,
    regenerate_article_hint: bool,
    user_id: int,
    force_enrich: bool = False,
):
    """Sequential pipeline: sync → bio + scrape (with hint regen) +
    article scrape (with article-hint regen) + standardize.

    Prepends the sync step that refresh-all skipped. Without sync,
    replatformed roasters (Nandan → www.nandancoffee.com on
    2026-05-26) keep stale URLs in the catalog because the scrape
    runs against whatever sources row was already there. With sync,
    the snapshot detects the move and the diff downstream gets the
    refreshed product URLs.

    Errors in sync are logged but non-fatal — the rest of the
    pipeline can still produce useful work against the existing
    sources row.

    Op-QC wrapper (2026-05-27): creates a PARENT catalog_operations
    row that the child ops (sync_tab2, run_scrape, run_article_scrape,
    standardize) chain under via parent_operation_id. The parent
    finishes when refresh-all dispatches; downstream children
    complete on their own and chain into the parent's audit trail.
    """
    from services.operation_qc import (
        start_operation, finish_operation_with_qc, finish_operation,
    )
    from database import get_db as _get_db
    qc_db = _get_db()
    parent_op_id = None
    try:
        parent_op_id = start_operation(
            qc_db, kind="full_reenrich_roaster", target_slug=slug,
            params={
                "sync_mode": sync_mode,
                "regenerate_prompt": regenerate_prompt,
                "regenerate_article_hint": regenerate_article_hint,
            },
            started_by=str(user_id) if user_id is not None else None,
        )
    finally:
        qc_db.close()

    _orch_log(
        slug,
        f"full-reenrich START (op_id={parent_op_id}, "
        f"sync_mode={sync_mode}, regenerate_prompt={regenerate_prompt}, "
        f"regenerate_article_hint={regenerate_article_hint})",
    )
    try:
        from services import sync_runner
        if sync_mode == "tab1":
            summary = sync_runner.run_tab1_sync(
                slug, parent_operation_id=parent_op_id,
            )
        else:
            summary = sync_runner.run_tab2_sync(
                slug, parent_operation_id=parent_op_id,
            )
        if summary.get("ok"):
            _orch_log(
                slug,
                f"step0 sync OK — products="
                f"{summary.get('product_count', '?')} "
                f"articles={summary.get('article_count', '?')}",
            )
        else:
            _orch_log(
                slug,
                f"step0 sync FAILED — {summary.get('error', '?')!r}; "
                "continuing past sync failure (scrape can still run "
                "against the existing sources row)",
            )
    except Exception as e:
        _orch_log(
            slug,
            f"step0 sync EXCEPTION ({type(e).__name__}: {e}); continuing",
        )

    # Chain the existing refresh-all pipeline (bio + scrape + article
    # scrape + standardize). refresh-all dispatches its own BG threads,
    # so this returns once those are launched.
    _orchestrate_refresh_all(
        slug=slug,
        regenerate_prompt=regenerate_prompt,
        regenerate_article_hint=regenerate_article_hint,
        user_id=user_id,
        parent_operation_id=parent_op_id,
        force_enrich=force_enrich,
    )
    _orch_log(slug, "full-reenrich DONE — refresh-all dispatched")

    # Finish parent op now that dispatch is complete. Children
    # (sync_tab2, scrape, article_scrape, standardize) continue in
    # their own threads; they record under parent_op_id but the
    # parent op's lifecycle ends at dispatch. T1 op rules on the
    # parent run against the dispatch-time summary; the children
    # have their own T1 rules that fire as they complete.
    qc_db = _get_db()
    try:
        finish_operation_with_qc(
            qc_db, parent_op_id, status="succeeded",
            summary={
                "dispatched": True,
                "sync_mode": sync_mode,
                "note": "Children (sync, scrape, article_scrape, "
                        "standardize) record under parent_operation_id "
                        "and complete independently.",
            },
        )
    finally:
        qc_db.close()


@router.post("/admin/roasters/{slug}/full-reenrich", status_code=202)
def admin_full_reenrich_roaster(
    slug: str,
    body: dict = None,
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """Atomic full re-enrichment for one roaster: sync → bio +
    products + articles (with hint regen) + standardize. ONE call,
    sequential pipeline in the background.

    This is the "bulk enrich" verb. Before this route landed
    (2026-05-26), the orchestrator's CLAUDE.md mapped "bulk enrich"
    to crema_bulk_reenrich_roaster — which only re-enriches existing
    products. That path skips sync (so stale URLs from replatformed
    sites linger), skips hint regeneration (so old per-roaster quirk
    hints persist), and skips bio + article enrichment entirely.
    This route runs the full pipeline.

    Body:
      • mode: 'tab1' | 'tab2' (default 'tab2') — sync mode. tab1 is
        a full crawl (use for new/re-baseline); tab2 is a diff-only
        sync (steady-state — the right default).
      • regenerate_prompt: default True — regenerate the per-roaster
        product-enrichment hint as part of the scrape.
      • regenerate_article_hint: default True — same for articles.

    Returns 202 with the slug + queued flag. Poll
    crema_list_llm_jobs / crema_list_jobs for per-step progress.
    """
    _require_admin(user)
    body = body or {}
    sync_mode = (body.get("mode") or "tab2").strip().lower()
    if sync_mode not in ("tab1", "tab2"):
        from fastapi import HTTPException
        raise HTTPException(400, "mode must be 'tab1' or 'tab2'")
    regenerate_prompt = bool(body.get("regenerate_prompt", True))
    regenerate_article_hint = bool(body.get("regenerate_article_hint", True))
    force_enrich = bool(body.get("force_enrich", False))

    db = get_db()
    try:
        row = db.execute(
            "SELECT website FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not row or not row["website"]:
            from fastapi import HTTPException
            raise HTTPException(
                404, f"No website on file for roaster {slug}",
            )
    finally:
        db.close()

    background_tasks.add_task(
        _orchestrate_full_reenrich,
        slug=slug,
        sync_mode=sync_mode,
        regenerate_prompt=regenerate_prompt,
        regenerate_article_hint=regenerate_article_hint,
        user_id=user["id"],
        force_enrich=force_enrich,
    )

    fired_at = _now_iso()
    return ok({
        "slug": slug,
        "queued": True,
        "sync_mode": sync_mode,
        "regenerate_prompt": regenerate_prompt,
        "regenerate_article_hint": regenerate_article_hint,
        "force_enrich": force_enrich,
        "fired_at": fired_at,
        "message": (
            "Full re-enrich queued (sync → bio + products + articles "
            "with hint regeneration + standardize). Poll "
            "crema_list_llm_jobs / crema_list_jobs."
        ),
        "next_steps": [
            _next_step(
                "crema_list_jobs",
                {"kind": "scrape", "status": "running", "limit": 30},
                "verify the BG scrape worker is running. Wait until "
                "it succeeded before triaging — children fire as the "
                "sweep completes.",
            ),
            _next_step(
                "crema_list_catalog_operations",
                {"kind": "full_reenrich_roaster", "target_slug": slug,
                 "since": fired_at, "limit": 5},
                "audit THIS sweep (parent op + sync_tab2 + scrape + "
                "article_scrape + standardize children). Confirm "
                "status='succeeded' on the parent before moving on.",
            ),
            _next_step(
                "crema_list_quality_reviews",
                {"target_table": "catalog_operations",
                 "verdict": "confirmed", "limit": 50},
                "T1 anomaly flags against the operations themselves: "
                "mass_delete, failed_rate_high, zero_discovered, "
                "duplicate_enqueue_burst. These are the structural "
                "concerns from the sweep.",
            ),
            _next_step(
                "crema_list_quality_reviews",
                {"target_table": "roaster_profiles",
                 "verdict": "confirmed", "roaster_slug": slug, "limit": 20},
                "T1 bio findings for THIS roaster: URL drift, "
                "homepage-vs-catalog mismatch, generic specialties.",
            ),
            _next_step(
                "crema_run_quality_review_sweep",
                {"target_table": "products", "slug": slug},
                "retroactively drain T1 product flags that didn't "
                "get T2-reviewed during the live sweep (drainer "
                "coverage gap). Fires Haiku — spawn drainers first.",
            ),
        ],
    }, resource="roaster_full_reenrich")


@router.get("/admin/quality-reviews")
def admin_list_quality_reviews(
    target_table: Optional[str] = None,
    verdict: Optional[str] = None,
    tier: Optional[int] = None,
    roaster_slug: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
):
    """List rows in the quality_reviews table for orchestrator triage.

    Filters:
      • target_table: 'products' | 'roaster_articles'
      • verdict: 'pending' | 'confirmed' | 'cleared' | 'overridden'
      • tier: 1 | 2 | 3
      • roaster_slug: scope to one roaster (JOINs products /
        roaster_articles for the slug)

    Default usage: GET /admin/quality-reviews?verdict=confirmed to
    surface the T2-confirmed-hallucination queue ready for T3 Opus
    override.
    """
    _require_admin(user)
    if limit < 1 or limit > 500:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..500")
    if target_table and target_table not in ("products", "roaster_articles", "roaster_profiles"):
        from fastapi import HTTPException
        raise HTTPException(400, "target_table must be products, roaster_articles, or roaster_profiles")
    if verdict and verdict not in ("pending", "confirmed", "cleared", "overridden"):
        from fastapi import HTTPException
        raise HTTPException(400, "invalid verdict")
    if tier and tier not in (1, 2, 3):
        from fastapi import HTTPException
        raise HTTPException(400, "tier must be 1, 2, or 3")

    where = []
    params: list = []
    if target_table:
        where.append("qr.target_table = ?")
        params.append(target_table)
    if verdict:
        where.append("qr.verdict = ?")
        params.append(verdict)
    if tier is not None:
        where.append("qr.tier = ?")
        params.append(tier)
    if roaster_slug:
        # Join through target table to filter by slug
        where.append(
            "((qr.target_table = 'products' AND EXISTS (SELECT 1 FROM products p "
            "  WHERE p.product_id = qr.target_id AND p.roaster_slug = ?)) "
            "OR (qr.target_table = 'roaster_articles' AND EXISTS (SELECT 1 FROM "
            "  roaster_articles ra WHERE ra.id = CAST(qr.target_id AS INTEGER) "
            "  AND ra.roaster_slug = ?)))"
        )
        params.extend([roaster_slug, roaster_slug])

    sql = "SELECT * FROM quality_reviews qr"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY qr.created_at DESC, qr.id DESC LIMIT ?"
    params.append(limit)

    db = get_db()
    try:
        rows = db.execute(sql, tuple(params)).fetchall()
        # Per-status rollup for convenience
        rollup = {}
        for r in db.execute(
            "SELECT verdict, tier, COUNT(*) as c FROM quality_reviews "
            "GROUP BY verdict, tier"
        ).fetchall():
            rollup[f"{r['verdict']}_t{r['tier']}"] = r["c"]
        return ok({
            "rows": [dict(r) for r in rows],
            "returned": len(rows),
            "filters": {
                "target_table": target_table, "verdict": verdict,
                "tier": tier, "roaster_slug": roaster_slug,
            },
            "rollup": rollup,
        }, resource="quality_reviews")
    finally:
        db.close()


@router.post("/admin/quality-reviews/prepare-t3", status_code=200)
def admin_prepare_t3_review(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Return T3 context bundles for the orchestrator to reason over.

    T3 is ORCHESTRATOR-FIRED — the caller of this MCP tool (Claude
    Code session) reads the bundles, decides what to correct, and
    submits the corrections via /admin/quality-reviews/apply-t3.
    No LLM call happens here — this route is pure data shaping.

    Why this pattern: T3 is the "smarter than Haiku" review layer.
    Routing T3 through the call_llm queue puts a Haiku drainer on
    the job, defeating the purpose. Calling the SDK from the
    backend burns credits the operator reserves for human-fired
    work. The orchestrator (this Claude Code session, running on
    the subscription path) IS the smarter tier — let it do the
    reasoning directly.

    Body:
      • target_table: 'products' | 'roaster_articles' (required)
      • target_id: scope to one row (optional)
      • roaster_slug: scope to one roaster (optional)
      • limit: max bundles to return (default 10, max 50)

    Returns: { bundles: [{target_id, entity, roaster_name,
      description_raw, confirmed_flags}, ...] }
    """
    _require_admin(user)
    body = body or {}
    target_table = body.get("target_table")
    if target_table not in ("products", "roaster_articles", "roaster_profiles"):
        from fastapi import HTTPException
        raise HTTPException(
            400, "target_table must be products, roaster_articles, or roaster_profiles",
        )
    target_id = body.get("target_id")
    roaster_slug = body.get("roaster_slug")
    limit = int(body.get("limit") or 10)
    if limit < 1 or limit > 50:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..50")

    from services.quality_reviewer import prepare_t3_review_batch
    db = get_db()
    try:
        bundles = prepare_t3_review_batch(
            db, target_table=target_table, target_id=target_id,
            roaster_slug=roaster_slug, limit=limit,
        )
        # Encode the structural next step: for each bundle, the
        # orchestrator must reason + call apply_t3_correction. We
        # surface ONE template next_step (per first bundle) — the
        # orchestrator iterates the rest itself.
        next_steps = []
        if bundles:
            sample = bundles[0]
            next_steps.append(_next_step(
                "crema_apply_t3_correction",
                {
                    "target_table": target_table,
                    "target_id": sample["target_id"],
                    "corrections": [
                        {
                            "field": "<field>",
                            "corrected_value": "<value or null to clear>",
                            "reasoning": "<page-text citation>",
                        }
                    ],
                    "lesson": "<what the original enricher got wrong + "
                              "what rule would have caught it>",
                },
                f"reason over each of the {len(bundles)} bundles "
                "above (read entity + confirmed_flags + roaster_name + "
                "description_raw), then call apply_t3_correction "
                "PER TARGET with corrections + lesson. The lesson is "
                "what makes T3 worth it — without lessons, the "
                "continuous-hardening loop doesn't close.",
            ))
        else:
            next_steps.append(_next_step(
                "crema_list_quality_reviews",
                {"target_table": target_table, "limit": 20},
                "no confirmed flags to T3 right now. Verify the "
                "review queue is empty for this scope.",
            ))
        return ok({
            "target_table": target_table,
            "bundles": bundles,
            "bundle_count": len(bundles),
            "next_steps": next_steps,
        }, resource="quality_review_t3_prepare")
    finally:
        db.close()


@router.post("/admin/quality-reviews/apply-t3", status_code=200)
def admin_apply_t3_correction(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Apply the orchestrator's T3 corrections to one target row.

    Body:
      • target_table: 'products' | 'roaster_articles' (required)
      • target_id: target row id (required)
      • corrections: [{field, corrected_value, reasoning}, ...]
        — field must be in the allowlist; corrected_value can be
        a string or null (null clears the field)
      • lesson: string capturing what the original enricher got
        wrong + what rule would have caught it. Persisted to
        every overridden quality_reviews row for the
        continuous-hardening loop.

    Returns: { applied: N, skipped: N }
    """
    _require_admin(user)
    body = body or {}
    target_table = body.get("target_table")
    if target_table not in ("products", "roaster_articles", "roaster_profiles"):
        from fastapi import HTTPException
        raise HTTPException(
            400, "target_table must be products, roaster_articles, or roaster_profiles",
        )
    target_id = body.get("target_id")
    if not target_id:
        from fastapi import HTTPException
        raise HTTPException(400, "target_id is required")
    corrections = body.get("corrections") or []
    lesson = body.get("lesson") or ""
    if not corrections:
        from fastapi import HTTPException
        raise HTTPException(400, "corrections list is required and non-empty")
    if not lesson:
        from fastapi import HTTPException
        raise HTTPException(
            400,
            "lesson is required — even a one-liner. T3's value is "
            "the lesson, not just the correction.",
        )

    from services.quality_reviewer import apply_t3_corrections
    db = get_db()
    try:
        counts = apply_t3_corrections(
            db, target_table=target_table, target_id=target_id,
            corrections=corrections, lesson=lesson, now_iso=_now_iso(),
        )
        return ok({
            "target_table": target_table,
            "target_id": target_id,
            "applied": counts["applied"],
            "skipped": counts["skipped"],
            "lesson": lesson,
        }, resource="quality_review_t3_apply")
    finally:
        db.close()


@router.get("/admin/catalog-operations")
def admin_list_catalog_operations(
    kind: Optional[str] = None,
    status: Optional[str] = None,
    target_slug: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 50,
    user=Depends(get_current_user),
):
    """List rows from catalog_operations — the audit trail of every
    state-mutating catalog op.

    Filters:
      • kind: 'dedupe' | 'delete_product' | 'full_reenrich_roaster' | ...
      • status: 'running' | 'succeeded' | 'failed' | 'rolled_back'
      • target_slug: scope to one roaster
      • since: ISO timestamp; only ops started_at >= since
      • limit: max rows. Default 50, max 500.

    Returns the rows + a parsed summary_json + a roll-up of counts by
    status. Use to triage what's happened recently or to find an
    operation to roll back.
    """
    _require_admin(user)
    if limit < 1 or limit > 500:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..500")
    where = []
    params: list = []
    if kind:
        where.append("kind = ?"); params.append(kind)
    if status:
        if status not in ("running", "succeeded", "failed", "rolled_back"):
            from fastapi import HTTPException
            raise HTTPException(400, "invalid status")
        where.append("status = ?"); params.append(status)
    if target_slug:
        where.append("target_slug = ?"); params.append(target_slug)
    if since:
        where.append("started_at >= ?"); params.append(since)
    sql = "SELECT * FROM catalog_operations"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    db = get_db()
    try:
        rows = db.execute(sql, tuple(params)).fetchall()
        result_rows = []
        for r in rows:
            d = dict(r)
            # Parse JSON columns for easier downstream consumption
            for col in ("params_json", "summary_json"):
                if d.get(col):
                    try:
                        d[col[:-5]] = json.loads(d[col])
                    except (ValueError, TypeError):
                        d[col[:-5]] = None
            result_rows.append(d)
        rollup = {}
        for r in db.execute(
            "SELECT status, COUNT(*) as c FROM catalog_operations "
            "GROUP BY status"
        ).fetchall():
            rollup[r["status"]] = r["c"]
        return ok({
            "rows": result_rows,
            "returned": len(result_rows),
            "rollup": rollup,
        }, resource="catalog_operations")
    finally:
        db.close()


@router.post("/admin/catalog-operations/{operation_id}/rollback")
def admin_rollback_catalog_operation(
    operation_id: int,
    body: dict = None,
    user=Depends(get_current_user),
):
    """Roll back a catalog operation by restoring all snapshotted
    rows. Idempotent — re-running on an already-rolled-back op is a
    no-op.

    Body:
      • reason: free-form note recorded on the operation row.

    Returns: { operation_id, rows_restored, rows_deleted,
               tables_touched }
    """
    _require_admin(user)
    body = body or {}
    reason = body.get("reason") or f"admin:{user.get('id')}"
    from services.operation_qc import rollback_operation
    db = get_db()
    try:
        result = rollback_operation(db, operation_id, reason=reason)
        return ok(result, resource="catalog_operation_rollback")
    finally:
        db.close()


@router.post("/admin/products/dedupe", status_code=200)
def admin_dedupe_products(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Consolidate duplicate products in the catalog.

    Finds groups by URL (exact or normalized after stripping
    scheme/www/collections-all/trailing-slash), picks a canonical
    row (richest enrichment, most recent enriched_at, lexicographic
    tie-break), merges null fields from siblings, re-points FKs in
    shelf_entries / click_events / hidden_products / brew_methods /
    ad_impressions / roaster_ad_placements / scrape_proposals, then
    deletes the sibling rows.

    Body:
      • strategy: 'url_exact' | 'url_normalized' (default
        'url_normalized' — catches both Class A and Class B from
        the 2026-05-26 audit).
      • slug: scope to one roaster (optional).
      • limit: cap on groups to consolidate per call (optional).
      • dry_run: default true. Preview before committing.

    Returns a summary with per-group details. Tables with UNIQUE
    constraints (shelf_entries on user_id+product_id, hidden_products
    on roaster_slug+product_id) get conflicting sibling rows deleted
    before the UPDATE re-points the rest.
    """
    _require_admin(user)
    body = body or {}
    strategy = body.get("strategy") or "url_normalized"
    if strategy not in ("url_exact", "url_normalized", "content_similarity"):
        from fastapi import HTTPException
        raise HTTPException(
            400,
            "strategy must be url_exact, url_normalized, or content_similarity",
        )
    slug = body.get("slug")
    raw_limit = body.get("limit")
    limit = int(raw_limit) if raw_limit is not None else None
    if limit is not None and (limit < 1 or limit > 5000):
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..5000")
    dry_run = bool(body.get("dry_run", True))

    from services.product_dedupe import run_dedupe_sweep
    db = get_db()
    try:
        result = run_dedupe_sweep(
            db, strategy=strategy, slug=slug, limit=limit,
            dry_run=dry_run,
        )
        # Structurally encode the follow-on workflow. Dry-run vs live
        # have different next steps — dry should review the preview,
        # live should audit the catalog_operations row + verify.
        if dry_run:
            result["next_steps"] = [
                _next_step(
                    "crema_dedupe_products",
                    {"strategy": strategy, "slug": slug,
                     "limit": limit, "dry_run": False},
                    "the preview above shows what WOULD merge. If it "
                    "looks correct (canonical picks are right, "
                    "sibling deletions are real dupes), re-fire with "
                    "dry_run=false to apply.",
                ),
            ]
        else:
            op_id = result.get("operation_id")
            result["next_steps"] = [
                _next_step(
                    "crema_list_catalog_operations",
                    {"kind": "dedupe", "limit": 3},
                    "audit this dedupe op. Look for op_dedupe_oversized "
                    "or op_mass_delete T1 flags — if either fired, "
                    "the merges may have over-collapsed.",
                ),
                _next_step(
                    "crema_list_quality_reviews",
                    {"target_table": "catalog_operations",
                     "verdict": "confirmed", "limit": 10},
                    "T1 op-level anomalies. Roll back via "
                    "crema_rollback_catalog_operation if a flag "
                    "indicates over-aggressive consolidation.",
                ),
                *(
                    [_next_step(
                        "crema_rollback_catalog_operation",
                        {"operation_id": op_id,
                         "reason": "<fill in if dedupe was wrong>"},
                        "ONLY IF the audit shows this dedupe was "
                        "wrong. Restores every merged sibling + "
                        "reverts canonical field-merges.",
                    )] if op_id else []
                ),
            ]
        return ok(result, resource="products_dedupe")
    finally:
        db.close()


@router.post("/admin/catalog/filter-retro-sweep", status_code=200)
def admin_catalog_filter_retro_sweep(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Retroactive Stage 1 filter sweep — re-apply current
    `is_url_excluded` to every available catalog row and flip the
    matches to `available=0, enrichment_status='filter_reject'`.
    Field values (price, weight, name, image) preserved.

    Closes the grandfathering loop: rows inserted before filter
    rules tightened (e.g. "tasting set", "blend duo", "drip kit"
    added after the initial seed) are now caught.

    Body:
      • slug: scope to one roaster (optional).
      • limit: cap on rows scanned (optional, default = all).
      • dry_run: default true. Always preview first.

    Live runs log a `catalog_operations` row with snapshots so
    rollback restores `available + enrichment_status` exactly.
    Field values are not touched (no rollback needed for those).
    """
    _require_admin(user)
    body = body or {}
    slug = body.get("slug")
    raw_limit = body.get("limit")
    limit = int(raw_limit) if raw_limit is not None else None
    if limit is not None and (limit < 1 or limit > 50000):
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..50000")
    dry_run = bool(body.get("dry_run", True))

    from services.catalog_filter_sweep import run_filter_sweep
    db = get_db()
    try:
        result = run_filter_sweep(
            db, dry_run=dry_run, slug=slug, limit=limit,
        )
        if dry_run:
            result["next_steps"] = [
                _next_step(
                    "crema_apply_filters_retro",
                    {"slug": slug, "limit": limit, "dry_run": False},
                    "the preview shows which rows would flip to "
                    "filter_reject. If the matches look correct, "
                    "re-fire with dry_run=false to apply.",
                ),
            ]
        else:
            op_id = result.get("operation_id")
            result["next_steps"] = [
                *(
                    [_next_step(
                        "crema_list_catalog_operations",
                        {"kind": "filter_retro_sweep", "limit": 3},
                        "audit the sweep op. If the affected count "
                        "looks too high, roll back via "
                        "crema_rollback_catalog_operation.",
                    )] if op_id else []
                ),
                _next_step(
                    "crema_catalog_quality_audit",
                    {},
                    "re-audit the catalog to confirm the bundle "
                    "cluster is gone.",
                ),
            ]
        return ok(result, resource="catalog_filter_sweep")
    finally:
        db.close()


@router.post("/admin/catalog/url-health-audit", status_code=200)
def admin_catalog_url_health_audit(
    body: dict = None,
    user=Depends(get_current_user),
):
    """URL health audit — HEAD-check every available product_url and
    flip persistent 404s to `available=0, enrichment_status='url_dead'`.

    Closes stale-URL accumulation: roasters retire SKUs (Takaraa
    `-takaraa-1-kg`), replatform (ffox/libertario), or publish
    per-batch URLs that age out (Caffinary `-roasted-on-DDMM`).

    Body:
      • slug: scope to one roaster (optional).
      • limit: cap on rows scanned (optional, default = all).
      • concurrency: parallel HEAD requests (default 8).
      • dry_run: default true. Always preview first.

    Live runs log a `catalog_operations` row with snapshots so
    rollback restores `available + enrichment_status`.

    Cost: one HEAD per row. At default 8-way parallelism, a 1500-row
    catalog completes in ~3-5 minutes. Network errors and 5xx are
    treated as transient — only 404 flips the row.
    """
    _require_admin(user)
    body = body or {}
    slug = body.get("slug")
    raw_limit = body.get("limit")
    limit = int(raw_limit) if raw_limit is not None else None
    if limit is not None and (limit < 1 or limit > 50000):
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..50000")
    raw_concurrency = body.get("concurrency")
    concurrency = int(raw_concurrency) if raw_concurrency else 8
    if concurrency < 1 or concurrency > 32:
        from fastapi import HTTPException
        raise HTTPException(400, "concurrency must be 1..32")
    dry_run = bool(body.get("dry_run", True))

    from services.catalog_url_health import run_url_health_audit
    db = get_db()
    try:
        result = run_url_health_audit(
            db, dry_run=dry_run, slug=slug, limit=limit,
            concurrency=concurrency,
        )
        if dry_run:
            result["next_steps"] = [
                _next_step(
                    "crema_url_health_audit",
                    {"slug": slug, "limit": limit, "dry_run": False},
                    "preview shows the 404'd URLs. If they're truly "
                    "dead (not transient), re-fire with dry_run=false "
                    "to flip them to url_dead.",
                ),
            ]
        else:
            op_id = result.get("operation_id")
            result["next_steps"] = [
                *(
                    [_next_step(
                        "crema_list_catalog_operations",
                        {"kind": "url_health_audit", "limit": 3},
                        "audit the sweep. Rollback via "
                        "crema_rollback_catalog_operation if needed.",
                    )] if op_id else []
                ),
                _next_step(
                    "crema_full_reenrich_roaster",
                    {"slug": "<affected roaster slug>"},
                    "for any roaster with significant url_dead count, "
                    "fire a full re-enrich to rediscover live URLs "
                    "and rebuild that roaster's catalog from scratch.",
                ),
            ]
        return ok(result, resource="catalog_url_health")
    finally:
        db.close()


@router.post("/admin/quality-reviews/run-sweep", status_code=200)
def admin_run_quality_review_sweep(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Run T1 (and optionally T2) retroactively across already-enriched
    rows. Closes the coverage gap when bulk enrichment ran through the
    subprocess scrape path (catalog_ops.scrape_one_roaster), which
    bypasses the inline T1+T2 wiring in enrichment_runner.

    Use after a bulk re-enrich sweep completes. Idempotent at the row
    level — re-running on the same rows wipes pending flags and
    re-evaluates (cleared/confirmed/overridden flags stay as history).

    Body:
      • target_table: 'products' | 'roaster_articles' (default 'products')
      • slug: scope to one roaster (optional)
      • since: ISO timestamp; only rows enriched_at >= since (optional)
      • limit: cap on rows scanned (optional)
      • run_t2: default true. False = T1 only (faster, no LLM spend).
      • skip_already_reviewed: default true. Set false to force re-scan
        of rows that already have a quality_reviews entry.

    Cost: T1 is free. T2 runs Haiku per T1-flagged row via the
    standard call_llm queue (drainers must be active to make progress).
    """
    _require_admin(user)
    body = body or {}
    target_table = body.get("target_table") or "products"
    if target_table not in ("products", "roaster_articles", "roaster_profiles"):
        from fastapi import HTTPException
        raise HTTPException(
            400, "target_table must be products, roaster_articles, or roaster_profiles",
        )
    slug = body.get("slug")
    since = body.get("since")
    raw_limit = body.get("limit")
    limit = int(raw_limit) if raw_limit is not None else None
    if limit is not None and (limit < 1 or limit > 10000):
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1..10000")
    run_t2 = bool(body.get("run_t2", True))
    skip_already_reviewed = bool(body.get("skip_already_reviewed", True))

    from services.quality_reviewer import run_retroactive_sweep
    db = get_db()
    try:
        result = run_retroactive_sweep(
            db, target_table=target_table, slug=slug, since=since,
            limit=limit, run_t2=run_t2,
            skip_already_reviewed=skip_already_reviewed,
        )
        # Next-step structural directives based on what the sweep found
        confirmed = int(result.get("t2_confirmed") or 0)
        flagged = int(result.get("rows_flagged_by_t1") or 0)
        ns: list[dict] = []
        if confirmed > 0:
            ns.append(_next_step(
                "crema_list_quality_reviews",
                {"target_table": target_table,
                 "verdict": "confirmed", "limit": 50},
                f"T2 confirmed {confirmed} flag(s) as real hallucinations. "
                "Review them, then escalate to T3 if you want orchestrator "
                "corrections.",
            ))
            ns.append(_next_step(
                "crema_prepare_t3_review",
                {"target_table": target_table, "limit": 10},
                "fetch context bundles for the confirmed flags so YOU "
                "(the orchestrator) can reason over each and emit "
                "corrections via crema_apply_t3_correction.",
            ))
        if flagged == 0:
            ns.append(_next_step(
                "crema_list_quality_reviews",
                {"target_table": target_table, "limit": 20},
                "sweep found no new flags. Verify previously-flagged "
                "rows are still in the expected states.",
            ))
        result["next_steps"] = ns
        return ok(result, resource="quality_review_sweep")
    finally:
        db.close()


@router.post("/admin/quality-reviews/{review_id}/resolve")
def admin_resolve_quality_review(
    review_id: int,
    body: dict = None,
    user=Depends(get_current_user),
):
    """Manually resolve one quality_reviews row.

    Body:
      • verdict: 'cleared' | 'confirmed' | 'overridden' (required)
      • corrected_value: optional, only for 'overridden'
      • lesson: optional, only for 'overridden'

    Use when the admin (human) makes the call instead of T2/T3.
    Common: clear a T1 false-positive that T2 missed, or override
    a row directly without invoking Opus.
    """
    _require_admin(user)
    body = body or {}
    verdict = body.get("verdict")
    if verdict not in ("cleared", "confirmed", "overridden"):
        from fastapi import HTTPException
        raise HTTPException(
            400, "verdict must be cleared|confirmed|overridden",
        )
    corrected_value = body.get("corrected_value")
    lesson = body.get("lesson")
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM quality_reviews WHERE id = ?", (review_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"quality_review {review_id} not found")
        db.execute(
            "UPDATE quality_reviews SET verdict = ?, "
            "  corrected_value = ?, lesson = ?, "
            "  resolved_at = ?, resolved_by = 'admin' "
            "WHERE id = ?",
            (
                verdict,
                str(corrected_value) if corrected_value is not None else None,
                lesson, _now_iso(), review_id,
            ),
        )
        db.commit()
        updated = db.execute(
            "SELECT * FROM quality_reviews WHERE id = ?", (review_id,),
        ).fetchone()
        return ok(dict(updated), resource="quality_reviews")
    finally:
        db.close()


@router.post("/admin/enrichment-tasks/reap-stuck", status_code=200)
def admin_reap_stuck_enrichment_tasks(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Reap enrichment_tasks rows stuck at state='llm_pending'.

    Sister to the L1 stuck-claim reaper (which heals llm_jobs.in_progress
    claims after 300s) but operates on the higher-level enrichment_tasks
    state machine. The L1 reaper handles drainer early-exit; this one
    handles the case where the BG enrichment worker itself dies between
    flipping state to llm_pending (enrichment_runner.py:578) and the
    subsequent transition to enriched/failed/skipped.

    The 2026-05-26 post-bulk-sweep audit surfaced 21 such stuck rows.
    Most have llm_job_id=null (worker crashed BEFORE call_llm enqueued
    the LLM job — the new try/except around enrich_url should prevent
    this going forward, but the reaper is still needed for SIGKILL-class
    failures the try/except can't intercept).

    Body:
      • older_than_minutes: int (default 5). Only reap rows stuck for
        at least this long.
      • dry_run: bool (default false). Preview the reap without writing.

    Rule:
      • Tasks where result_table + result_id are set AND the target row
        exists → flip to 'enriched' (state-machine straggler)
      • Else → flip to 'failed' with last_error='reaped:stuck_llm_pending_Nm'
    """
    _require_admin(user)
    body = body or {}
    older_than_minutes = int(body.get("older_than_minutes") or 5)
    dry_run = bool(body.get("dry_run", False))
    if older_than_minutes < 1:
        from fastapi import HTTPException
        raise HTTPException(400, "older_than_minutes must be >= 1")

    from services.enrichment_runner import reap_stuck_llm_pending
    db = get_db()
    try:
        result = reap_stuck_llm_pending(
            db,
            older_than_minutes=older_than_minutes,
            dry_run=dry_run,
        )
    finally:
        db.close()
    return ok(result, resource="enrichment_tasks_reap")


@router.post("/admin/catalog-operations/reap-stuck", status_code=200)
def admin_reap_stuck_catalog_operations(
    body: dict = None,
    user=Depends(get_current_user),
):
    """Reap catalog_operations rows stuck at status='running'.

    Sister to /admin/enrichment-tasks/reap-stuck (which heals the lower-
    level state machine). This one operates on the catalog_operations
    audit table — the parent rows that wrap full_reenrich_roaster,
    sync_tab*, standardize, scrape_one_roaster, etc.

    Background: the parent-op-finalization bug (deferred fix) leaves
    parent rows at status='running' even after all child work completed.
    Symptom: bulk runs accumulate phantom "running" rows; the rollup
    misreports active work; future bulk operations see a noisy baseline.

    Body:
      • older_than_minutes: int (default 30). Only reap rows stuck for
        at least this long. Conservative default because legitimate
        long-running ops (full_reenrich_roaster on a 50-product
        roaster) can take 10+ minutes.
      • dry_run: bool (default false). Preview the reap without writing.

    Rule:
      • status='running' AND started_at < now - older_than_minutes
        → flip status='failed', set finished_at=now, write
        error_message='stale_marker_reaped: ...' for audit trail.

    Returns counts + the reaped rows so the caller can spot any
    surprising entries (e.g. an op that's been stuck for days
    against expectation).
    """
    _require_admin(user)
    body = body or {}
    older_than_minutes = int(body.get("older_than_minutes") or 30)
    dry_run = bool(body.get("dry_run", False))
    if older_than_minutes < 1:
        from fastapi import HTTPException
        raise HTTPException(400, "older_than_minutes must be >= 1")

    db = get_db()
    try:
        # Find candidates first (same predicate either way).
        # Comparison via julianday() because `started_at` is stored
        # as ISO-with-T-and-Z (`2026-05-28T13:10:31.357657Z`) while
        # `datetime('now', '-Nmin')` returns space-separated no-zone
        # (`2026-05-28 13:28:55`). A string compare on those formats
        # puts the `T` (ASCII 0x54) ahead of the space (ASCII 0x20)
        # at position 11, so every row reads as "newer than cutoff"
        # and the predicate matches zero rows. julianday() coerces
        # both sides to numeric days-since-epoch, format-agnostic.
        # Threshold expressed in days: minutes / (24 * 60).
        threshold_days = float(older_than_minutes) / (24.0 * 60.0)
        candidates = db.execute(
            "SELECT id, kind, target_slug, started_at, "
            "  CAST((julianday('now') - julianday(started_at)) "
            "       * 24 * 60 AS INTEGER) AS age_minutes "
            "FROM catalog_operations "
            "WHERE status = 'running' "
            "  AND julianday('now') - julianday(started_at) > ? "
            "ORDER BY started_at",
            (threshold_days,),
        ).fetchall()
        reaped_rows = [dict(r) for r in candidates]

        if not dry_run and reaped_rows:
            reason = (
                f"stale_marker_reaped: status=running for "
                f">{older_than_minutes}min with no finalization; "
                f"parent-op-finalization residue."
            )
            db.execute(
                "UPDATE catalog_operations "
                "SET status = 'failed', "
                "    finished_at = ?, "
                "    error_message = ? "
                "WHERE status = 'running' "
                "  AND julianday('now') - julianday(started_at) > ?",
                (_now_iso(), reason, threshold_days),
            )
            db.commit()

        # Per-kind rollup for the response.
        by_kind: dict[str, int] = {}
        for r in reaped_rows:
            by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1

        return ok(
            {
                "dry_run": dry_run,
                "older_than_minutes": older_than_minutes,
                "reaped_count": len(reaped_rows),
                "by_kind": by_kind,
                "reaped_rows": reaped_rows,
            },
            resource="catalog_operations_reap",
        )
    finally:
        db.close()


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
    """Force re-enrichment of one product through the v2 pipeline.

    Pulls the product_url + roaster_slug from the existing row, fetches
    the source page (with the Playwright Tier 4 fallback that clears
    Cloudflare / JS-render walls + clicks Wix variant dropdowns), runs
    the Haiku v2 enricher, and upserts through the canonical
    entity_upserter.

    The route is a thin wrapper around
    `services.entity_reenricher.reenrich_one_product` so the bulk
    `/admin/roasters/{slug}/bulk-reenrich` worker shares the same path.

    Note on blocking: the call is synchronous and waits for the LLM
    queue (drainer subagents chase the job). With drainers running
    typical wall is 30-60s per product; without drainers the route
    will hang up to llm_router's timeout. The HTTP client may give
    up earlier but the work continues server-side — re-poll the
    products row to check final state.
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

        from services.entity_reenricher import reenrich_one_product
        result = reenrich_one_product(db, product)

        if result.outcome == "no_url":
            from fastapi import HTTPException
            raise HTTPException(422, result.error or "missing url/slug")
        if result.outcome == "failed_fetch":
            from fastapi import HTTPException
            raise HTTPException(502, result.error or "page fetch failed")
        if result.outcome == "gated":
            from fastapi import HTTPException
            raise HTTPException(
                422,
                f"Haiku gated this product out ({result.gate_status}); "
                "existing row preserved.",
            )
        if result.outcome == "failed_llm":
            from fastapi import HTTPException
            raise HTTPException(503, f"Enrichment failed: {result.error}")
        if result.outcome == "failed_validation":
            from fastapi import HTTPException
            raise HTTPException(
                502,
                result.error or "enricher returned no result",
            )

        updated = db.execute(
            "SELECT * FROM products WHERE product_id = ?", (product_id,),
        ).fetchone()
        return ok(dict(updated), resource="products")
    finally:
        db.close()


@router.post("/admin/roasters/{slug}/bulk-reenrich")
def admin_bulk_reenrich_roaster(
    slug: str,
    body: Optional[dict] = None,
    user=Depends(get_current_user),
):
    """Fire-and-forget bulk re-enrich for every product of a roaster.

    Iterates products of the roaster in a BG thread, calling the
    shared v2 helper for each. Returns a jobs row ID immediately so
    the operator can track progress via crema_list_jobs +
    crema_get_scrape_run_log.

    Body:
      only_status: 'failed' | 'enriched' | 'pre_v2' | None
        - 'failed' → only rows where enrichment_status='failed'
        - 'enriched' → only enrichment_status='enriched' (silent-empty
          sweep target)
        - 'pre_v2' → only rows with enriched_at IS NULL (never touched
          by v2 — the most common target after the 2026-05-25 stack)
        - omit → every product in the roaster

    The BG thread blocks on the LLM queue per-product. Drainer
    subagents must be running to make progress. Spawn 3-5 drainers
    before kicking off a roaster with 20+ products.
    """
    _require_admin(user)
    body = body or {}
    only_status = body.get("only_status")
    db = get_db()
    try:
        prof = db.execute(
            "SELECT roaster_slug, name FROM roaster_profiles WHERE roaster_slug = ?",
            (slug,),
        ).fetchone()
        if not prof:
            from fastapi import HTTPException
            raise HTTPException(404, f"Roaster {slug} not found")

        sql = "SELECT * FROM products WHERE roaster_slug = ?"
        params: list = [slug]
        if only_status == "failed":
            sql += " AND enrichment_status = 'failed'"
        elif only_status == "enriched":
            sql += " AND enrichment_status = 'enriched'"
        elif only_status == "pre_v2":
            sql += " AND enriched_at IS NULL"
        sql += " ORDER BY product_id"
        rows = db.execute(sql, tuple(params)).fetchall()
        product_ids = [r["product_id"] for r in rows]

        if not product_ids:
            return ok({
                "slug": slug,
                "job_id": None,
                "product_count": 0,
                "only_status": only_status,
                "note": "no products matched the filter",
            }, resource="bulk_reenrich")

        # Track via the existing jobs table.
        now_iso = _now_iso()
        cur = db.execute(
            "INSERT INTO jobs (kind, status, started_by, created_at) "
            "VALUES (?, 'queued', ?, ?)",
            ("bulk_reenrich", user["id"], now_iso),
        )
        job_id = cur.lastrowid
        db.commit()
    finally:
        db.close()

    # Spawn BG thread. Each iteration opens its own db handle.
    import threading
    threading.Thread(
        target=_bulk_reenrich_worker,
        args=(job_id, slug, product_ids, only_status),
        daemon=True,
    ).start()

    return ok({
        "slug": slug,
        "job_id": job_id,
        "product_count": len(product_ids),
        "only_status": only_status,
        "note": (
            "BG worker started — poll crema_list_jobs (kind=bulk_reenrich) "
            "for progress. Each product blocks on the LLM queue until a "
            "drainer submits, so spawn drainers in parallel for any "
            "roaster with 10+ products."
        ),
    }, resource="bulk_reenrich")


# Throttle: cap concurrent in-flight bulk_reenrich workers at 8.
# 2026-05-26 bulk run spawned 106 parallel workers (one per published
# roaster) → cascading SQLite "unable to open database file" lock
# contention → ~80 products landed with outcome=failed_llm. 8 is the
# empirical safe ceiling for the current single-file SQLite setup;
# raise only after switching to WAL with higher concurrent-writer
# tolerance or splitting catalog state into roaster-scoped shards.
#
# Workers that exceed the cap stay status='queued' (route already set
# it that way) until they acquire — observable via crema_list_jobs.
# Lazy-init mirrors the pattern at _RENDER_SEMAPHORE further up the
# file so `threading` stays out of import-time hot path.
_BULK_REENRICH_SEMAPHORE = None


def _get_bulk_reenrich_semaphore():
    global _BULK_REENRICH_SEMAPHORE
    if _BULK_REENRICH_SEMAPHORE is None:
        import threading
        _BULK_REENRICH_SEMAPHORE = threading.Semaphore(8)
    return _BULK_REENRICH_SEMAPHORE


def _bulk_reenrich_worker(
    job_id: int,
    slug: str,
    product_ids: list,
    only_status,
) -> None:
    """BG worker iterating products and invoking the shared v2 helper.
    Updates the jobs row with progress as it goes."""
    from services.entity_reenricher import reenrich_one_product
    from database import get_db as _get_db

    # Block on the module-level semaphore before doing any work. The
    # jobs row stays status='queued' (route sets that on insert) until
    # this acquire fires — so queue depth is visible to the operator
    # without extra bookkeeping.
    with _get_bulk_reenrich_semaphore():
        _bulk_reenrich_worker_inner(
            job_id, slug, product_ids, only_status,
            reenrich_one_product, _get_db,
        )


def _bulk_reenrich_worker_inner(
    job_id: int,
    slug: str,
    product_ids: list,
    only_status,
    reenrich_one_product,
    _get_db,
) -> None:
    """Operative body of the bulk_reenrich worker, factored so the
    semaphore wrapper stays a clean two-liner."""
    db = _get_db()
    counts = {
        "updated": 0, "inserted": 0, "skipped_unchanged": 0,
        "gated": 0, "failed_fetch": 0, "failed_llm": 0,
        "failed_validation": 0, "no_url": 0,
    }
    log_lines: list[str] = []
    try:
        db.execute(
            "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
            (_now_iso(), job_id),
        )
        db.commit()
        for idx, pid in enumerate(product_ids, start=1):
            # Re-fetch each row so the latest catalog state seeds the
            # existing_coffee_name hint.
            row = db.execute(
                "SELECT * FROM products WHERE product_id = ?", (pid,),
            ).fetchone()
            if not row:
                counts["no_url"] += 1
                continue
            res = reenrich_one_product(db, dict(row))
            counts[res.outcome] = counts.get(res.outcome, 0) + 1
            log_lines.append(
                f"[{idx}/{len(product_ids)}] {pid} → {res.outcome}"
                + (f" ({res.gate_status})" if res.gate_status else "")
                + (f" {res.error}" if res.error else "")
            )
            # Heartbeat every 5 products.
            if idx % 5 == 0 or idx == len(product_ids):
                db.execute(
                    "UPDATE jobs SET log_tail = ?, current_target = ? "
                    "WHERE id = ?",
                    ("\n".join(log_lines[-30:]),
                     f"{idx}/{len(product_ids)}", job_id),
                )
                db.commit()
        # Final status
        db.execute(
            "UPDATE jobs SET status = 'succeeded', finished_at = ?, "
            "log_tail = ?, result_summary = ? WHERE id = ?",
            (
                _now_iso(),
                "\n".join(log_lines[-100:]),
                json.dumps({
                    "slug": slug,
                    "only_status": only_status,
                    "product_count": len(product_ids),
                    "outcomes": counts,
                }),
                job_id,
            ),
        )
        db.commit()
    except Exception as e:
        db.execute(
            "UPDATE jobs SET status = 'failed', finished_at = ?, "
            "error_message = ?, log_tail = ? WHERE id = ?",
            (_now_iso(), str(e)[:500],
             "\n".join(log_lines[-100:]), job_id),
        )
        db.commit()
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
            "a.topic_category, a.tags, "
            "a.editorial_score, a.editorial_score_components, "
            "a.editorial_scored_at, "
            "rp.name AS roaster_name, "
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
    """Decode the JSON `tags` and `editorial_score_components` columns
    into real Python types so the admin UI doesn't have to JSON.parse
    on each row.

    Empty / unparseable tags become an empty array — never null — so
    the frontend can render `tags.map(...)` without an undefined check.

    `editorial_score_components` (M2, 2026-05-26) decodes to a dict
    with the 5-component score breakdown + raw counts + Haiku
    rationales. Stays None when the article hasn't been graded yet
    so the UI can show a "Not yet graded" affordance distinct from a
    legitimately zero-scored article.
    """
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

    components_raw = row.get("editorial_score_components")
    if components_raw:
        try:
            decoded = json.loads(components_raw)
            row["editorial_score_components"] = decoded if isinstance(decoded, dict) else None
        except (TypeError, ValueError):
            row["editorial_score_components"] = None
    else:
        row["editorial_score_components"] = None

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


@router.post("/admin/articles/grade-batch")
def admin_articles_grade_batch(
    body: Optional[dict] = None,
    user=Depends(get_current_user),
):
    """Fire-and-forget editorial grading for a batch of articles.
    M2 (2026-05-26) — composes editorial_score from 3 mechanical
    sub-scores (image richness, product cross-links, internal article
    cross-links) and 2 Haiku-rated sub-scores (prose quality, sourcing
    specificity). See services/article_grader.py for the rubric.

    Body:
      slug: roaster_slug — scope to one roaster's articles. Omit for
        catalog-wide.
      only_unscored: bool (default true). When true, skips articles
        that already have a non-null editorial_score. Set false to
        re-grade everything (after a rubric change).
      limit: int (default 500, max 5000). Caps the batch size so a
        catalog-wide grade can be checkpointed across multiple calls.

    Returns a jobs row ID — poll crema_list_jobs (kind=grade_articles)
    for progress + log_tail. The BG worker blocks on the LLM queue
    per article (one Haiku call each), so spawn 3-5 drainers in
    parallel for any batch with 20+ articles.
    """
    _require_admin(user)
    body = body or {}
    slug = (body.get("slug") or "").strip() or None
    only_unscored = bool(body.get("only_unscored", True))
    limit = max(1, min(int(body.get("limit") or 500), 5000))

    db = get_db()
    try:
        where = ["body_html IS NOT NULL", "body_html != ''"]
        params: list = []
        if slug:
            prof = db.execute(
                "SELECT roaster_slug FROM roaster_profiles WHERE roaster_slug = ?",
                (slug,),
            ).fetchone()
            if not prof:
                from fastapi import HTTPException
                raise HTTPException(404, f"Roaster {slug} not found")
            where.append("roaster_slug = ?")
            params.append(slug)
        if only_unscored:
            where.append("editorial_score IS NULL")
        # Skip articles already gated as non-coffee — they're never
        # going to be featured, and grading them burns tokens that
        # produce a score the consumer surface will never read.
        where.append("(is_about_coffee = 1 OR is_about_coffee IS NULL)")
        where_sql = " AND ".join(where)
        rows = db.execute(
            f"SELECT id FROM roaster_articles WHERE {where_sql} "
            "ORDER BY id LIMIT ?",
            (*params, limit),
        ).fetchall()
        article_ids = [r["id"] for r in rows]

        if not article_ids:
            return ok({
                "slug": slug,
                "job_id": None,
                "article_count": 0,
                "only_unscored": only_unscored,
                "note": "no articles matched the filter",
            }, resource="grade_articles")

        now_iso = _now_iso()
        cur = db.execute(
            "INSERT INTO jobs (kind, status, started_by, created_at) "
            "VALUES (?, 'queued', ?, ?)",
            ("grade_articles", user["id"], now_iso),
        )
        job_id = cur.lastrowid
        db.commit()
    finally:
        db.close()

    import threading
    threading.Thread(
        target=_grade_articles_worker,
        args=(job_id, slug, article_ids, only_unscored),
        daemon=True,
    ).start()

    return ok({
        "slug": slug,
        "job_id": job_id,
        "article_count": len(article_ids),
        "only_unscored": only_unscored,
        "note": (
            "BG worker started — poll crema_list_jobs (kind=grade_articles) "
            "for progress. Each article blocks on the LLM queue for one "
            "Haiku scoring call (~3-5s), so spawn drainers in parallel "
            "for any batch with 20+ articles."
        ),
    }, resource="grade_articles")


def _grade_articles_worker(
    job_id: int,
    slug: Optional[str],
    article_ids: list,
    only_unscored: bool,
) -> None:
    """BG worker iterating articles and invoking the grader. Updates
    the jobs row with progress + log_tail as it goes. Each iteration
    opens its own db handle."""
    from services.article_grader import grade_one_article
    from database import get_db as _get_db
    from services.llm_router import set_pipeline_context
    db = _get_db()
    counts = {"graded": 0, "skipped": 0, "failed": 0}
    log_lines: list[str] = []
    try:
        db.execute(
            "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
            (_now_iso(), job_id),
        )
        db.commit()
        total = len(article_ids)
        for idx, aid in enumerate(article_ids, start=1):
            row = db.execute(
                "SELECT id, roaster_slug, url, title, body_html, topic_category "
                "FROM roaster_articles WHERE id = ?",
                (aid,),
            ).fetchone()
            if row is None:
                counts["skipped"] += 1
                log_lines.append(f"[{idx}/{total}] article {aid} → vanished")
                continue
            # Stamp roaster_slug on the contextvar so the queued
            # llm_jobs row gets slug-tagged (drainer filtering works).
            set_pipeline_context(roaster_slug=row["roaster_slug"])
            db.execute(
                "UPDATE jobs SET log_tail = ? WHERE id = ?",
                ("\n".join(log_lines[-50:] + [
                    f"[{idx}/{total}] article {aid} → grading…",
                ]), job_id),
            )
            db.commit()
            try:
                result = grade_one_article(db, row)
            except Exception as e:
                counts["failed"] += 1
                log_lines.append(
                    f"[{idx}/{total}] article {aid} → failed ({e!r})"
                )
                continue
            if result is None:
                counts["failed"] += 1
                log_lines.append(
                    f"[{idx}/{total}] article {aid} → failed "
                    "(no Haiku response or empty body)"
                )
            else:
                counts["graded"] += 1
                log_lines.append(
                    f"[{idx}/{total}] article {aid} → "
                    f"score={result.get('aggregate')}"
                )
            db.execute(
                "UPDATE jobs SET log_tail = ? WHERE id = ?",
                ("\n".join(log_lines[-50:]), job_id),
            )
            db.commit()

        db.execute(
            "UPDATE jobs SET status = 'succeeded', finished_at = ?, "
            "result_summary = ?, log_tail = ? "
            "WHERE id = ?",
            (
                _now_iso(),
                json.dumps({
                    "slug": slug,
                    "only_unscored": only_unscored,
                    "article_count": len(article_ids),
                    "outcomes": counts,
                }),
                "\n".join(log_lines[-50:]),
                job_id,
            ),
        )
        db.commit()
    except Exception as e:
        try:
            db.execute(
                "UPDATE jobs SET status = 'failed', finished_at = ?, "
                "error_message = ? WHERE id = ?",
                (_now_iso(), str(e)[:500], job_id),
            )
            db.commit()
        except Exception:
            pass
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

    Snapshotted + logged via the operation-QC layer — every delete
    is reversible via crema_rollback_operation. T1 doesn't typically
    flag single-row deletes, but they participate in the same
    catalog_operations history so admin can audit later.
    """
    _require_admin(user)
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM products WHERE product_id = ?",
            (product_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, f"Product {product_id} not found")

        from services.operation_qc import (
            start_operation, snapshot_rows, finish_operation_with_qc,
            finish_operation,
        )
        op_id = start_operation(
            db, kind="delete_product",
            target_slug=row["roaster_slug"] if "roaster_slug" in row.keys() else None,
            params={"product_id": product_id},
            started_by=str(user.get("id") if user else None),
        )
        try:
            snapshot_rows(
                db, op_id, "products", [dict(row)],
                mutation_kind="delete",
            )
            db.execute(
                "DELETE FROM products WHERE product_id = ?", (product_id,),
            )
            db.commit()
            finish_operation_with_qc(
                db, op_id, status="succeeded",
                summary={"rows_deleted": 1, "product_id": product_id},
            )
        except Exception as e:
            finish_operation(
                db, op_id, status="failed",
                error_message=f"{type(e).__name__}: {str(e)[:200]}",
            )
            raise
        return ok({"deleted": product_id, "operation_id": op_id},
                  resource="products")
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


@router.post("/admin/llm-jobs/delete")
def admin_delete_llm_jobs(body: dict, user=Depends(get_current_user)):
    """Hard-delete llm_jobs queue items — single or bulk.

    `llm_jobs` is the operational work queue, not a catalog entity:
    rows are ephemeral tickets, so a hard-delete is the right
    semantics (no soft-delete / catalog_snapshots — those are for
    products/roasters/articles). Use to clear orphaned pending jobs
    whose parent scrape died, or to drop a single bad ticket.

    Body (all optional; id/filter clauses are ANDed into one match set):
      • job_id (int)       — delete one specific ticket
      • ids (int[])        — delete an explicit list of tickets
      • status (str)       — bulk by status (pending|in_progress|failed|complete)
      • roaster_slug (str) — bulk by roaster
      • step (str)         — bulk by step
      • all (bool)         — REQUIRED to run a filterless whole-queue wipe
      • dry_run (bool)     — return matched count + sample WITHOUT deleting

    A call with no id/filter and all != true is refused (422) so the
    whole queue can't be wiped by accident. Returns
    {dry_run, matched, deleted, sample}.
    """
    _require_admin(user)
    body = body or {}
    clauses: list = []
    params: list = []

    if body.get("job_id") is not None:
        clauses.append("id = ?"); params.append(int(body["job_id"]))

    ids = body.get("ids")
    if ids:
        if not isinstance(ids, list):
            raise HTTPException(422, "ids must be a list of integers")
        try:
            id_ints = [int(x) for x in ids]
        except (TypeError, ValueError):
            raise HTTPException(422, "ids must be a list of integers")
        if id_ints:
            clauses.append(f"id IN ({','.join('?' for _ in id_ints)})")
            params.extend(id_ints)

    for col in ("status", "roaster_slug", "step"):
        val = body.get(col)
        if val:
            clauses.append(f"{col} = ?"); params.append(val)

    delete_all = bool(body.get("all"))
    if not clauses and not delete_all:
        raise HTTPException(
            422,
            "refused: provide job_id / ids / status / roaster_slug / step, "
            "or pass all=true to clear the entire queue",
        )

    where_sql = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    dry_run = bool(body.get("dry_run"))
    db = get_db()
    try:
        matched = db.execute(
            f"SELECT COUNT(*) AS c FROM llm_jobs{where_sql}", tuple(params),
        ).fetchone()["c"]
        sample = [
            dict(r) for r in db.execute(
                f"SELECT id, roaster_slug, step, status FROM llm_jobs"
                f"{where_sql} ORDER BY id DESC LIMIT 10",
                tuple(params),
            ).fetchall()
        ]
        if dry_run:
            return ok({"dry_run": True, "matched": matched, "deleted": 0,
                       "sample": sample}, resource="llm_jobs")
        db.execute(f"DELETE FROM llm_jobs{where_sql}", tuple(params))
        db.commit()
        return ok({"dry_run": False, "matched": matched, "deleted": matched,
                   "sample": sample}, resource="llm_jobs")
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
      • severity: optional — 'info' (default), 'warn', or 'error'.
        Used by server-side bulk operations to highlight crawl failures,
        drainer-fallback events, etc. Agent UIs render warn/error
        entries prominently so the agent can scan its journal for
        issues without parsing every reasoning prose.
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
    severity = (body.get("severity") or "info").strip().lower()
    if severity not in ("info", "warn", "error"):
        raise HTTPException(
            422, f"severity must be one of info|warn|error (got {severity!r})"
        )
    metadata = body.get("metadata")
    metadata_json = json.dumps(metadata) if metadata is not None else None
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO agent_actions (session_id, agent_identity, "
            "action, reasoning, metadata_json, severity) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, agent_identity, action, reasoning, metadata_json,
             severity),
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
            f"reasoning, metadata_json, severity "
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


@router.get("/admin/runbook")
def admin_get_runbook(
    verb: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Return the full runbook OR a specific section by verb slug.

    The runbook lives at `agent-catalog-ops/RUNBOOK.md` outside the
    auto-loaded path so it doesn't burn the orchestrator's session-
    start context budget. Fetched on demand via this route.

    `verb`: optional slug ('bulk_enrich', 'dedupe', 'rollback', etc.).
    When provided, returns just the matching section (by markdown
    header substring match). When omitted, returns the full doc plus
    a list of available sections.
    """
    _require_admin(user)
    import os as _os
    # The runbook lives in the agent-catalog-ops folder at the repo
    # root. Walk up from the API folder to find it.
    api_dir = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    repo_root = _os.path.dirname(_os.path.dirname(api_dir))
    runbook_path = _os.path.join(repo_root, "agent-catalog-ops", "RUNBOOK.md")
    if not _os.path.exists(runbook_path):
        from fastapi import HTTPException
        raise HTTPException(
            500, f"runbook not found at {runbook_path}",
        )
    with open(runbook_path) as f:
        full_text = f.read()

    # Index sections by markdown ## headers
    import re as _re
    section_starts = [
        (m.start(), m.group(1).strip())
        for m in _re.finditer(r"^##\s+(.+)$", full_text, _re.MULTILINE)
    ]
    sections = []
    for i, (pos, title) in enumerate(section_starts):
        end = section_starts[i + 1][0] if i + 1 < len(section_starts) else len(full_text)
        sections.append({
            "title": title,
            "slug": _re.sub(r"[^a-z0-9_]+", "_", title.lower()).strip("_"),
            "content": full_text[pos:end].strip(),
        })

    if verb:
        # Match verb slug against section slugs / titles. Substring
        # match keeps it forgiving (orchestrator can pass partial verb).
        verb_lower = verb.lower()
        matches = [
            s for s in sections
            if verb_lower in s["slug"] or verb_lower in s["title"].lower()
        ]
        if not matches:
            return ok({
                "verb": verb,
                "matched": False,
                "available_slugs": [s["slug"] for s in sections],
                "note": (
                    f"No section matched verb {verb!r}. Available slugs "
                    f"listed above; try one of those."
                ),
            }, resource="runbook")
        return ok({
            "verb": verb,
            "matched": True,
            "section_count": len(matches),
            "sections": matches,
        }, resource="runbook")

    # No verb — return the full doc + TOC of available slugs
    return ok({
        "verb": None,
        "full_text": full_text,
        "byte_size": len(full_text),
        "available_slugs": [s["slug"] for s in sections],
    }, resource="runbook")


@router.get("/admin/agent-memory/search")
def admin_search_agent_memory(
    query: str,
    scope: Optional[str] = None,
    tag: Optional[str] = None,
    k: int = 3,
    user=Depends(get_current_user),
):
    """Search agent_memory for the top-k most relevant lessons by
    lexical overlap with `query`. Replaces the bulk crema_get_agent_memory
    dump pattern for the common case of "find a lesson about X".

    Scoring (no LLM): term-frequency overlap between query words and
    lesson text + scope + tags. Ranks by descending score; returns
    top-k. Bumps reference_count on every returned row.

    Context-rot mitigation (2026-05-27): the orchestrator's
    session-start context shouldn't carry the full memory dump.
    Instead, when the orchestrator hits an unfamiliar verb or
    pattern, it can fire this with a 3-5 word query and get the
    relevant lessons back — much smaller working-memory cost than
    front-loading 50KB of memory.
    """
    _require_admin(user)
    if not query or not query.strip():
        from fastapi import HTTPException
        raise HTTPException(400, "query is required")
    k = max(1, min(int(k or 3), 20))

    # Pull candidate rows (scope/tag pre-filter trims the search
    # space cheaply before lexical scoring).
    where = []
    params: list = []
    if scope:
        where.append("scope = ?"); params.append(scope)
    if tag:
        where.append("tags_json LIKE ?"); params.append(f'%"{tag}"%')
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    db = get_db()
    try:
        rows = db.execute(
            f"SELECT id, scope, lesson, tags_json, source_session_id, "
            f"source_summary_id, created_at, last_referenced_at, "
            f"reference_count "
            f"FROM agent_memory{where_sql} "
            f"ORDER BY created_at DESC LIMIT 500",
            tuple(params),
        ).fetchall()

        # Score: count of query-term hits in lesson + scope + tags.
        # Lowercase substring match — sufficient for short queries.
        import re as _re
        q_terms = [
            t for t in _re.split(r"\s+", query.lower().strip())
            if t and len(t) >= 2
        ]
        if not q_terms:
            return ok([], resource="agent_memory_search", total=0)

        scored: list[tuple[int, dict]] = []
        for r in rows:
            d = dict(r)
            haystack = (
                (d.get("lesson") or "").lower() + " " +
                (d.get("scope") or "").lower() + " " +
                (d.get("tags_json") or "").lower()
            )
            score = sum(1 for term in q_terms if term in haystack)
            if score == 0:
                continue
            # Boost: bonus if the query term appears in scope/tags
            # (scope/tag matches are stronger signal than body match).
            scope_l = (d.get("scope") or "").lower()
            tags_l = (d.get("tags_json") or "").lower()
            for term in q_terms:
                if term in scope_l:
                    score += 2
                if term in tags_l:
                    score += 1
            if d.get("tags_json"):
                try:
                    d["tags"] = json.loads(d["tags_json"])
                except (TypeError, ValueError):
                    d["tags"] = []
            else:
                d["tags"] = []
            d.pop("tags_json", None)
            d["relevance_score"] = score
            scored.append((score, d))

        scored.sort(key=lambda x: (-x[0], -x[1]["id"]))
        top = [d for _, d in scored[:k]]

        # Bump reference counters on what we returned.
        if top:
            ids = [d["id"] for d in top]
            placeholders = ",".join("?" * len(ids))
            db.execute(
                f"UPDATE agent_memory SET reference_count = reference_count + 1, "
                f"last_referenced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
                f"WHERE id IN ({placeholders})",
                tuple(ids),
            )
            db.commit()

        return ok(top, resource="agent_memory_search", total=len(top),
                  query=query, candidates_scored=len(scored))
    finally:
        db.close()
