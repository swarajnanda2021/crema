"""
Coffee Community API — FastAPI application.

Serves: community features (auth, shelves, tasting notes, clicks),
product catalog, roaster profiles, and a unified refresh endpoint
that runs the catalog discovery + product scraper in one go.

Run:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import os
import sys
import threading
import time
from queue import Queue, Empty

import uuid as _uuid

from fastapi import FastAPI, Header, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse
from database import init_db, get_db

# ── Path setup ────────────────────────────────────────────────────────────────

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRAPER_OUTPUT = os.path.join(_BASE, "Scraper", "output")
_CATALOG_OUTPUT = os.path.join(_BASE, "Scraper", "coffee-catalog", "output")
_CATALOG_PIPELINE = os.path.join(_BASE, "Scraper", "coffee-catalog", "pipeline")
_SCRAPER_DIR = os.path.join(_BASE, "Scraper", "scraper")

# Note: catalog pipeline and scraper both have a utils.py.
# We do NOT add them to sys.path globally — they're imported via
# importlib.util.spec_from_file_location in _run_full_refresh()
# to avoid name collisions.

from datetime import datetime
from auth import router as auth_router, get_current_user
from shelves import router as shelves_router
from tasting_notes import router as notes_router
from click_tracking import router as clicks_router
from dictionary import router as dictionary_router
from social import router as social_router
from roaster_posts import router as roaster_posts_router
from notifications import router as notifications_router, create_notification

app = FastAPI(
    title="Crema API",
    version="1.0",
    description="Community features + catalog refresh for Indian specialty coffee.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(auth_router)
app.include_router(shelves_router)
app.include_router(notes_router)
app.include_router(clicks_router)
app.include_router(dictionary_router)
app.include_router(social_router)
app.include_router(roaster_posts_router)
app.include_router(notifications_router)

# Initialize database on startup
init_db()

# Uploads directory for avatars
_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(_UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")

# Lock to prevent concurrent refreshes
_refresh_lock = threading.Lock()


# ── Static data endpoints ─────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"service": "Crema API", "docs": "/docs"}


# ── Link preview (Open Graph) ────────────────────────────────────────────────

_link_preview_cache: dict = {}

@app.get("/api/link-preview")
def link_preview(url: str):
    """Fetch Open Graph metadata (title, description, image) for a URL."""
    import urllib.request
    import re
    from urllib.parse import urlparse

    if not url or not url.startswith("http"):
        return {"title": "", "description": "", "image_url": "", "domain": ""}

    # Cache hit
    if url in _link_preview_cache:
        return _link_preview_cache[url]

    domain = urlparse(url).netloc.replace("www.", "")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; CremaBot/1.0)"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read(50_000).decode("utf-8", errors="ignore")

        def og(prop: str) -> str:
            m = re.search(rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
            if not m:
                m = re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{prop}["\']', html, re.I)
            return m.group(1) if m else ""

        title = og("title")
        if not title:
            m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
            title = m.group(1).strip() if m else ""

        image_url = og("image")

        # Favicon fallback chain if no og:image
        if not image_url:
            parsed = urlparse(url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            # 1. Try site's favicon.ico
            try:
                fav_req = urllib.request.Request(
                    f"{origin}/favicon.ico",
                    method="HEAD",
                    headers={"User-Agent": "Mozilla/5.0 (compatible; CremaBot/1.0)"},
                )
                with urllib.request.urlopen(fav_req, timeout=3) as fav_resp:
                    if fav_resp.status == 200:
                        image_url = f"{origin}/favicon.ico"
            except Exception:
                pass
            # 2. Google favicon API (always works)
            if not image_url:
                image_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"

        result = {
            "title": title,
            "description": og("description"),
            "image_url": image_url,
            "domain": domain,
        }
        _link_preview_cache[url] = result
        return result
    except Exception:
        # Even on total failure, return Google favicon
        image_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
        result = {"title": "", "description": "", "image_url": image_url, "domain": domain}
        _link_preview_cache[url] = result
        return result


@app.post("/api/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), authorization: str = Header(None)):
    """Upload an avatar image. Returns the URL to use in profile."""
    from auth import get_current_user
    user = get_current_user(authorization)

    # Validate file type
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        from fastapi import HTTPException
        raise HTTPException(400, "Only JPEG, PNG, WebP, and GIF images are accepted")

    # Save with unique filename
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    filename = f"{user['username']}_{_uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(_UPLOADS_DIR, filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Return a relative path — the frontend already knows the API base URL
    url = f"/uploads/{filename}"
    return {"avatar_url": url}


@app.post("/api/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    purpose: str = "general",
    authorization: str = Header(None),
):
    """Upload an image for any purpose (logo, hero, general). Returns the URL."""
    user = get_current_user(authorization)

    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        raise HTTPException(400, "Only JPEG, PNG, WebP, and GIF images are accepted")

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    safe_purpose = purpose.replace("/", "_").replace("..", "_")[:20]
    filename = f"{safe_purpose}_{user['username']}_{_uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(_UPLOADS_DIR, filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/{filename}"
    return {"url": url, "purpose": safe_purpose}


@app.get("/api/products")
def get_products():
    """Serve scraped products + manual products + corrections."""
    products = []

    # Scraped products — prefer LLM-enriched file if available
    for _fname in ("products_enriched.json", "products.json"):
        path = os.path.join(_SCRAPER_OUTPUT, _fname)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                products = json.load(f)
            break

    # Manual products (for Wix/JS sites)
    manual_path = os.path.join(_BASE, "Scraper", "input", "manual_products.json")
    if os.path.exists(manual_path):
        with open(manual_path, encoding="utf-8") as f:
            manual = json.load(f)
        existing_ids = {p["product_id"] for p in products}
        for mp in manual:
            if mp["product_id"] not in existing_ids:
                products.append(mp)

    # Apply product corrections (enrichment patches)
    corrections_path = os.path.join(_SCRAPER_OUTPUT, "product_corrections.json")
    if os.path.exists(corrections_path):
        with open(corrections_path, encoding="utf-8") as f:
            corrections = json.load(f)
        corrections_map = {c["product_id"]: c.get("corrections", {}) for c in corrections}
        for p in products:
            patch = corrections_map.get(p["product_id"])
            if patch:
                for field, value in patch.items():
                    if value is not None:
                        p[field] = value

    # Merge roaster-managed products from DB (newest first, prepended so they appear before scraped)
    db = get_db()
    try:
        rp_rows = db.execute("SELECT * FROM roaster_products WHERE available = 1 ORDER BY id DESC").fetchall()
        rp_products = []
        for row in rp_rows:
            r = dict(row)
            rp_products.append({
                "product_id": f"rp_{r['id']}",
                "roaster_slug": r["roaster_slug"],
                "roaster_name": r["roaster_slug"].replace("-", " ").title(),
                "coffee_name": r["coffee_name"],
                "roast_level": r.get("roast_level"),
                "tasting_notes": r.get("tasting_notes"),
                "origin": r.get("origin"),
                "process": r.get("process"),
                "varietal": r.get("varietal"),
                "altitude_masl": r.get("altitude_masl"),
                "bean_type": r.get("bean_type"),
                "flavor_notes": r.get("flavor_notes"),
                "weight_grams": r.get("weight_grams"),
                "price_inr": r.get("price_inr"),
                "image_url": r.get("image_url"),
                "product_url": r.get("product_url"),
                "description_raw": r.get("description_raw"),
                "available": True,
                "_source": "roaster_managed",
            })
        products = rp_products + products  # roaster-managed first

        # Filter out hidden products (roasters can persistently hide scraped products)
        hidden_rows = db.execute("SELECT product_id FROM hidden_products").fetchall()
        if hidden_rows:
            hidden_ids = {r["product_id"] for r in hidden_rows}
            products = [p for p in products if p["product_id"] not in hidden_ids]
    except Exception:
        pass
    finally:
        db.close()

    return products


@app.get("/api/roasters")
def get_roasters():
    from urllib.parse import urlparse

    catalog_roasters = []
    catalog_path = os.path.join(_CATALOG_OUTPUT, "verified_roasters_catalog.json")
    if os.path.exists(catalog_path):
        with open(catalog_path, encoding="utf-8") as f:
            data = json.load(f)
        catalog_roasters = data.get("roasters", [])

    catalog_by_domain = {}
    for r in catalog_roasters:
        if r.get("website"):
            try:
                domain = urlparse(r["website"]).hostname.replace("www.", "")
                catalog_by_domain[domain] = r
            except Exception:
                pass

    products_path = os.path.join(_SCRAPER_OUTPUT, "products.json")
    if not os.path.exists(products_path):
        return catalog_roasters

    with open(products_path, encoding="utf-8") as f:
        products = json.load(f)

    seen_domains = set()
    merged = []
    roaster_map = {}
    for p in products:
        slug = p.get("roaster_slug", "")
        if slug not in roaster_map:
            roaster_map[slug] = {
                "roaster_slug": slug,
                "name": p["roaster_name"],
                "city": p.get("roaster_city", ""),
                "state": p.get("roaster_state", ""),
                "lat": p.get("roaster_lat", 0),
                "lng": p.get("roaster_lng", 0),
                "website": p.get("roaster_website", ""),
                "coffee_count": 0,
            }
        roaster_map[slug]["coffee_count"] += 1

    for slug, base in roaster_map.items():
        domain = ""
        try:
            domain = urlparse(base["website"]).hostname.replace("www.", "")
        except Exception:
            pass
        catalog_match = catalog_by_domain.get(domain, {})
        merged.append({
            **base,
            "logo_url": catalog_match.get("logo_url"),
            "tagline": catalog_match.get("tagline"),
            "about_blurb": catalog_match.get("about_blurb"),
            "founding_year": catalog_match.get("founding_year"),
            "sourcing_regions": catalog_match.get("sourcing_regions"),
            "specialties": catalog_match.get("specialties"),
            "social_links": catalog_match.get("social_links"),
            "rating": catalog_match.get("rating"),
            "rating_count": catalog_match.get("rating_count"),
            "platform": catalog_match.get("platform"),
        })
        if domain:
            seen_domains.add(domain)

    for r in catalog_roasters:
        domain = ""
        try:
            domain = urlparse(r.get("website", "")).hostname.replace("www.", "")
        except Exception:
            pass
        if domain and domain not in seen_domains:
            r["coffee_count"] = 0
            merged.append(r)

    # Manual roasters (for Wix/JS sites we can't auto-discover)
    manual_path = os.path.join(_BASE, "Scraper", "input", "manual_roasters.json")
    if os.path.exists(manual_path):
        with open(manual_path, encoding="utf-8") as f:
            manual_roasters = json.load(f)
        for mr in manual_roasters:
            slug = mr.get("roaster_slug", "")
            if slug and not any(r.get("roaster_slug") == slug for r in merged):
                merged.append(mr)

    # Apply enrichment from crema-app/src/data/roasters.json (slug-matched, takes priority)
    enriched_path = os.path.join(_BASE, "crema-app", "src", "data", "roasters.json")
    if os.path.exists(enriched_path):
        with open(enriched_path, encoding="utf-8") as f:
            enriched_roasters = json.load(f)
        enriched_by_slug = {r["roaster_slug"]: r for r in enriched_roasters if r.get("roaster_slug")}
        _ENRICH_FIELDS = ["about_blurb", "tagline", "founding_year", "specialties",
                          "roast_focus", "sourcing_regions", "logo_url", "hero_image_url",
                          "coffee_image_urls", "social_links"]
        for r in merged:
            slug = r.get("roaster_slug", "")
            enrich = enriched_by_slug.get(slug)
            if enrich:
                for field in _ENRICH_FIELDS:
                    val = enrich.get(field)
                    if val:  # overwrite with enriched value if non-empty
                        r[field] = val
                # Apply clean display name override if present
                if enrich.get("roaster_name"):
                    r["name"] = enrich["roaster_name"]

    # Apply roaster corrections (enrichment patches)
    rc_path = os.path.join(_BASE, "Scraper", "input", "roaster_corrections.json")
    if os.path.exists(rc_path):
        with open(rc_path, encoding="utf-8") as f:
            roaster_corrections = json.load(f)
        rc_map = {c["roaster_slug"]: c.get("corrections", {}) for c in roaster_corrections}
        for r in merged:
            slug = r.get("roaster_slug", "")
            patch = rc_map.get(slug)
            if patch:
                for field, value in patch.items():
                    if value is not None and not r.get(field):
                        r[field] = value

    # Apply dedup rules (remove duplicate Google Places entries)
    dedup_path = os.path.join(_BASE, "Scraper", "input", "roaster_dedup.json")
    if os.path.exists(dedup_path):
        with open(dedup_path, encoding="utf-8") as f:
            dedup_rules = json.load(f)
        slugs_to_remove = set()
        for rule in dedup_rules:
            slugs_to_remove.update(rule.get("remove_slugs", []))
        if slugs_to_remove:
            merged = [r for r in merged if r.get("roaster_slug") not in slugs_to_remove]

    # Apply DB-stored roaster profile edits (highest priority — owner-edited data)
    db = get_db()
    try:
        db_profiles = db.execute("SELECT * FROM roaster_profiles").fetchall()
        db_map = {row["roaster_slug"]: dict(row) for row in db_profiles}
        _DB_FIELDS = ["about_blurb", "specialties", "website", "city", "logo_url", "hero_image_url", "hero_crop_x", "hero_crop_y", "hero_zoom"]
        for r in merged:
            slug = r.get("roaster_slug", "")
            db_prof = db_map.get(slug)
            if db_prof:
                for field in _DB_FIELDS:
                    val = db_prof.get(field)
                    if val is not None and val != "":
                        if field == "specialties":
                            try:
                                r[field] = json.loads(val)
                            except Exception:
                                r[field] = [s.strip() for s in val.split(",") if s.strip()]
                        else:
                            r[field] = val
    except Exception:
        pass
    finally:
        db.close()

    merged.sort(key=lambda r: r.get("name", ""))
    return merged


# ── Roaster profile update (owner only) ──────────────────────────────────────

from pydantic import BaseModel as _PydanticBase
from typing import Optional as _Opt, List as _List

class _RoasterProfileUpdate(_PydanticBase):
    about_blurb: _Opt[str] = None
    specialties: _Opt[_List[str]] = None
    website: _Opt[str] = None
    city: _Opt[str] = None
    logo_url: _Opt[str] = None
    hero_image_url: _Opt[str] = None
    hero_crop_x: _Opt[float] = None
    hero_crop_y: _Opt[float] = None
    hero_zoom: _Opt[float] = None

@app.put("/api/roasters/{slug}/profile")
def update_roaster_profile(slug: str, req: _RoasterProfileUpdate, user=Depends(get_current_user)):
    """Update roaster profile metadata. Only the roaster owner can edit."""
    if user.get("account_type") != "roaster" or user.get("roaster_slug") != slug:
        raise HTTPException(403, "Only the roaster owner can update this profile")

    now = datetime.utcnow().isoformat() + "Z"
    db = get_db()
    try:
        # Build upsert fields
        fields = {}
        if req.about_blurb is not None:
            fields["about_blurb"] = req.about_blurb
        if req.specialties is not None:
            fields["specialties"] = json.dumps(req.specialties)
        if req.website is not None:
            fields["website"] = req.website
        if req.city is not None:
            fields["city"] = req.city
        if req.logo_url is not None:
            fields["logo_url"] = req.logo_url
        if req.hero_image_url is not None:
            fields["hero_image_url"] = req.hero_image_url
        if req.hero_crop_x is not None:
            fields["hero_crop_x"] = max(0, min(100, req.hero_crop_x))
        if req.hero_crop_y is not None:
            fields["hero_crop_y"] = max(0, min(100, req.hero_crop_y))
        if req.hero_zoom is not None:
            fields["hero_zoom"] = max(1, min(5, req.hero_zoom))

        if not fields:
            raise HTTPException(400, "No fields to update")

        fields["updated_at"] = now
        fields["roaster_slug"] = slug

        # Upsert
        cols = ", ".join(fields.keys())
        placeholders = ", ".join(["?"] * len(fields))
        updates = ", ".join(f"{k} = excluded.{k}" for k in fields if k != "roaster_slug")
        db.execute(
            f"INSERT INTO roaster_profiles ({cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(roaster_slug) DO UPDATE SET {updates}",
            list(fields.values()),
        )
        db.commit()

        # Return the full profile row
        row = db.execute("SELECT * FROM roaster_profiles WHERE roaster_slug = ?", (slug,)).fetchone()
        result = dict(row)
        if result.get("specialties"):
            try:
                result["specialties"] = json.loads(result["specialties"])
            except Exception:
                result["specialties"] = []
        return result
    finally:
        db.close()


# ── Follow API ────────────────────────────────────────────────────────────────

@app.post("/api/roasters/{slug}/follow")
def toggle_follow(slug: str, user=Depends(get_current_user)):
    """Toggle follow status for a roaster. Returns new state."""
    db = get_db()
    try:
        now = datetime.utcnow().isoformat() + "Z"
        existing = db.execute(
            "SELECT id FROM follows WHERE follower_user_id = ? AND roaster_slug = ?",
            (user["id"], slug),
        ).fetchone()
        if existing:
            db.execute("DELETE FROM follows WHERE id = ?", (existing["id"],))
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
            return {"following": False, "follower_count": count}
        else:
            db.execute(
                "INSERT INTO follows (follower_user_id, roaster_slug, created_at) VALUES (?, ?, ?)",
                (user["id"], slug, now),
            )
            # Notify the followed user/roaster
            if slug.startswith("user_"):
                target_uid = int(slug.replace("user_", ""))
                create_notification(db, target_uid, "follow", user["id"])
            else:
                target_row = db.execute("SELECT id FROM users WHERE roaster_slug = ?", (slug,)).fetchone()
                if target_row:
                    create_notification(db, target_row["id"], "follow", user["id"])
            db.commit()
            count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
            return {"following": True, "follower_count": count}
    finally:
        db.close()

@app.get("/api/roasters/{slug}/followers")
def get_followers(slug: str):
    """Get follower count and list for a roaster."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT u.username, u.display_name, u.avatar_url, u.location, u.account_type, u.roaster_slug FROM follows f JOIN users u ON f.follower_user_id = u.id WHERE f.roaster_slug = ?",
            (slug,),
        ).fetchall()
        return {"follower_count": len(rows), "followers": [dict(r) for r in rows]}
    finally:
        db.close()

@app.get("/api/me/following")
def get_my_following(user=Depends(get_current_user)):
    """Return detailed list of who the current user follows (roasters + users)."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT roaster_slug FROM follows WHERE follower_user_id = ?",
            (user["id"],),
        ).fetchall()

        following = []
        for r in rows:
            slug = r["roaster_slug"]
            if slug.startswith("user_"):
                # User follow — look up by user ID
                uid = slug.replace("user_", "")
                u = db.execute(
                    "SELECT id, username, display_name, avatar_url, account_type, roaster_slug FROM users WHERE id = ?",
                    (uid,),
                ).fetchone()
                if u:
                    follower_count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
                    following.append({
                        "slug": slug,
                        "username": u["username"],
                        "display_name": u["display_name"],
                        "avatar_url": u["avatar_url"],
                        "account_type": u["account_type"],
                        "roaster_slug": u["roaster_slug"],
                        "follower_count": follower_count,
                        "is_roaster": False,
                    })
            else:
                # Roaster follow — look up roaster profile + user
                u = db.execute(
                    "SELECT id, username, display_name, avatar_url FROM users WHERE roaster_slug = ?",
                    (slug,),
                ).fetchone()
                follower_count = db.execute("SELECT COUNT(*) as c FROM follows WHERE roaster_slug = ?", (slug,)).fetchone()["c"]
                # Try roaster profile for logo
                rp = db.execute("SELECT logo_url FROM roaster_profiles WHERE roaster_slug = ?", (slug,)).fetchone()
                following.append({
                    "slug": slug,
                    "username": u["username"] if u else slug,
                    "display_name": u["display_name"] if u else slug.replace("-", " ").title(),
                    "avatar_url": (rp["logo_url"] if rp and rp["logo_url"] else u["avatar_url"]) if u else None,
                    "account_type": "roaster",
                    "roaster_slug": slug,
                    "follower_count": follower_count,
                    "is_roaster": True,
                })

        return {"following": following, "slugs": [r["roaster_slug"] for r in rows]}
    finally:
        db.close()

@app.get("/api/roasters/{slug}/follow-status")
def get_follow_status(slug: str, authorization: str = Header(None)):
    """Check if current user follows this roaster."""
    if not authorization:
        return {"following": False}
    try:
        user = get_current_user(authorization)
    except Exception:
        return {"following": False}
    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM follows WHERE follower_user_id = ? AND roaster_slug = ?",
            (user["id"], slug),
        ).fetchone()
        return {"following": bool(row)}
    finally:
        db.close()


# ── Roaster Product CRUD ─────────────────────────────────────────────────────

class _NewProduct(_PydanticBase):
    coffee_name: str
    roast_level: _Opt[str] = None
    tasting_notes: _Opt[str] = None
    origin: _Opt[str] = None
    process: _Opt[str] = None
    varietal: _Opt[str] = None
    altitude_masl: _Opt[int] = None
    bean_type: _Opt[str] = None
    flavor_notes: _Opt[str] = None
    weight_grams: _Opt[int] = None
    price_inr: _Opt[float] = None
    image_url: _Opt[str] = None
    product_url: _Opt[str] = None
    description_raw: _Opt[str] = None

@app.post("/api/roasters/{slug}/products", status_code=201)
def create_product(slug: str, req: _NewProduct, user=Depends(get_current_user)):
    """Create a new product listing for a roaster."""
    if user.get("account_type") != "roaster" or user.get("roaster_slug") != slug:
        raise HTTPException(403, "Only the roaster owner can add products")
    now = datetime.utcnow().isoformat() + "Z"
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO roaster_products
               (roaster_slug, user_id, coffee_name, roast_level, tasting_notes, origin,
                process, varietal, altitude_masl, bean_type, flavor_notes,
                weight_grams, price_inr, image_url, product_url, description_raw, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (slug, user["id"], req.coffee_name, req.roast_level, req.tasting_notes,
             req.origin, req.process, req.varietal, req.altitude_masl, req.bean_type,
             req.flavor_notes, req.weight_grams, req.price_inr, req.image_url,
             req.product_url, req.description_raw, now),
        )
        db.commit()
        row = db.execute("SELECT * FROM roaster_products WHERE id = ?", (cursor.lastrowid,)).fetchone()
        product = dict(row)
        # Normalise keys to match the frontend CoffeeCard expectations
        product["product_id"] = str(product["id"])
        product["roaster_slug"] = slug
        return product
    finally:
        db.close()

@app.delete("/api/roasters/{slug}/products/{product_id}")
def delete_product(slug: str, product_id: int, user=Depends(get_current_user)):
    """Delete a roaster product. Only the owner can delete."""
    if user.get("account_type") != "roaster" or user.get("roaster_slug") != slug:
        raise HTTPException(403, "Only the roaster owner can delete products")
    db = get_db()
    try:
        row = db.execute("SELECT id FROM roaster_products WHERE id = ? AND roaster_slug = ?", (product_id, slug)).fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        db.execute("DELETE FROM roaster_products WHERE id = ?", (product_id,))
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


class _HideProduct(_PydanticBase):
    product_id: str


@app.post("/api/roasters/{slug}/products/hide")
def hide_product(slug: str, req: _HideProduct, user=Depends(get_current_user)):
    """Persistently hide a scraped product from this roaster's listing."""
    if user.get("account_type") != "roaster" or user.get("roaster_slug") != slug:
        raise HTTPException(403, "Only the roaster owner can hide products")
    now = datetime.utcnow().isoformat() + "Z"
    db = get_db()
    try:
        db.execute(
            "INSERT OR IGNORE INTO hidden_products (roaster_slug, product_id, hidden_at) VALUES (?, ?, ?)",
            (slug, req.product_id, now),
        )
        db.commit()
        return {"hidden": True}
    finally:
        db.close()


@app.get("/api/recommendations")
def get_recommendations(
    authorization: str = Header(None),
    source: str = "self",
    for_user: str = None,
    limit: int = 3,
):
    """
    Recommend coffees with novelty scoring.

    Params:
      source=self     → based on YOUR shelf (default, for /profile)
      source=community → based on what EVERYONE is drinking (for feed)
      source=user&for_user=manav → based on a specific user's shelf (for their profile)

    Every recommendation includes:
      _reason: why it's recommended
      _novel: true if YOU don't have this coffee on any shelf (new to you)
    """
    from auth import get_current_user
    user = get_current_user(authorization)
    import random

    db = get_db()
    try:
        # Always get the requesting user's shelf (for novelty check)
        my_rows = db.execute(
            "SELECT product_id FROM shelf_entries WHERE user_id = ?", (user["id"],)
        ).fetchall()
        my_shelf_ids = {r["product_id"] for r in my_rows}

        # Determine which shelf to base recommendations on
        if source == "community":
            # All users' currently_drinking
            source_rows = db.execute(
                "SELECT DISTINCT product_id FROM shelf_entries WHERE shelf = 'currently_drinking'"
            ).fetchall()
            source_ids = {r["product_id"] for r in source_rows}
        elif source == "user" and for_user:
            target = db.execute("SELECT id FROM users WHERE username = ?", (for_user,)).fetchone()
            if target:
                source_rows = db.execute(
                    "SELECT product_id FROM shelf_entries WHERE user_id = ?", (target["id"],)
                ).fetchall()
                source_ids = {r["product_id"] for r in source_rows}
            else:
                source_ids = set()
        else:
            source_ids = my_shelf_ids
    finally:
        db.close()

    all_products = get_products()
    if not all_products:
        return {"recommendations": []}

    if not source_ids:
        sample = random.sample(all_products, min(limit, len(all_products)))
        for p in sample:
            p["_reason"] = "Popular pick"
            p["_novel"] = p["product_id"] not in my_shelf_ids
        return {"recommendations": sample}

    # Collect attributes from the source shelf
    source_roasters = set()
    source_origins = set()
    source_processes = set()
    for p in all_products:
        if p["product_id"] in source_ids:
            if p.get("roaster_slug"):
                source_roasters.add(p["roaster_slug"])
            if p.get("origin"):
                source_origins.add(p["origin"])
            if p.get("process"):
                source_processes.add(p["process"])

    # Score products NOT on the source shelf
    scored = []
    for p in all_products:
        if p["product_id"] in source_ids:
            continue
        score = 0
        reasons = []
        if p.get("roaster_slug") in source_roasters:
            score += 2
            reasons.append(f"By {p.get('roaster_name', 'a roaster')}")
        if p.get("origin") and p["origin"] in source_origins:
            score += 1
            origin = p["origin"][:30] + "..." if len(p["origin"]) > 30 else p["origin"]
            reasons.append(f"From {origin}")
        if p.get("process") and p["process"] in source_processes:
            score += 1
            reasons.append(f"{p['process']} process")
        if score > 0:
            p["_reason"] = reasons[0]
            p["_score"] = score
            p["_novel"] = p["product_id"] not in my_shelf_ids
            scored.append(p)

    scored.sort(key=lambda x: -x.get("_score", 0))
    result = scored[:limit]

    if len(result) < limit:
        remaining = [p for p in all_products if p["product_id"] not in source_ids and p not in result]
        extra = random.sample(remaining, min(limit - len(result), len(remaining)))
        for p in extra:
            p["_reason"] = "Popular pick"
            p["_novel"] = p["product_id"] not in my_shelf_ids
        result.extend(extra)

    return {"recommendations": result}


@app.get("/api/feed/timeline")
def get_feed_timeline(authorization: str = Header(None)):
    """
    Temporal feed: individual tasting notes sorted by time (newest first).
    Each entry includes like_count, comment_count, and liked_by_me.
    """
    from auth import get_current_user as _get_user
    db = get_db()
    try:
        current_user_id = None
        if authorization and authorization.startswith("Bearer "):
            try:
                u = _get_user(authorization)
                current_user_id = u["id"]
            except Exception:
                pass

        rows = db.execute("""
            SELECT tn.*, u.username, u.display_name, u.avatar_url, u.location,
                   (SELECT COUNT(*) FROM note_likes nl WHERE nl.note_id = tn.id) as like_count,
                   (SELECT COUNT(*) FROM note_comments nc WHERE nc.note_id = tn.id) as comment_count
            FROM tasting_notes tn
            JOIN users u ON tn.user_id = u.id
            ORDER BY tn.created_at DESC
            LIMIT 50
        """).fetchall()

        # Batch check which notes the current user liked
        liked_note_ids = set()
        if current_user_id:
            note_ids = [r["id"] for r in rows]
            if note_ids:
                placeholders = ",".join("?" * len(note_ids))
                liked_rows = db.execute(
                    f"SELECT note_id FROM note_likes WHERE user_id = ? AND note_id IN ({placeholders})",
                    [current_user_id] + note_ids
                ).fetchall()
                liked_note_ids = {r["note_id"] for r in liked_rows}

        timeline = []
        for r in rows:
            tags = json.loads(r["flavor_tags"]) if r["flavor_tags"] else None
            blend = json.loads(r["blend_components"]) if ("blend_components" in r.keys() and r["blend_components"]) else None
            timeline.append({
                "type": "tasting_note",
                "user": {
                    "username": r["username"],
                    "display_name": r["display_name"],
                    "avatar_url": r["avatar_url"] if "avatar_url" in r.keys() else None,
                    "location": r["location"] if "location" in r.keys() else None,
                },
                "product_id": r["product_id"],
                "like_count": r["like_count"],
                "comment_count": r["comment_count"],
                "liked_by_me": r["id"] in liked_note_ids,
                "note": {
                    "id": r["id"],
                    "user": {"username": r["username"], "display_name": r["display_name"]},
                    "acidity": r["acidity"], "body": r["body"],
                    "sweetness": r["sweetness"], "aftertaste": r["aftertaste"],
                    "flavor_tags": tags,
                    "brew_method": r["brew_method"], "drink_style": r["drink_style"],
                    "milk_type": r["milk_type"],
                    "dose_grams": r["dose_grams"], "yield_grams": r["yield_grams"],
                    "water_ml": r["water_ml"],
                    "extraction_time_secs": r["extraction_time_secs"],
                    "water_temp_celsius": r["water_temp_celsius"],
                    "grind_size": r["grind_size"], "brew_ratio": r["brew_ratio"],
                    "blend_components": blend,
                    "comment": r["comment"],
                    "created_at": r["created_at"], "updated_at": r["updated_at"],
                },
            })

        return {"timeline": timeline}
    finally:
        db.close()


@app.get("/api/feed")
def get_feed():
    """
    Community feed: all users' shelf entries + tasting notes, sorted by recency.
    Each feed item is a user's shelf grouped as an island (like their profile card).
    """
    db = get_db()
    try:
        # Get all users with profile data
        users = db.execute("SELECT * FROM users ORDER BY id").fetchall()

        feed = []
        for u in users:
            user_data = {
                "id": u["id"],
                "username": u["username"],
                "display_name": u["display_name"],
                "bio": u["bio"] if "bio" in u.keys() else None,
                "avatar_url": u["avatar_url"] if "avatar_url" in u.keys() else None,
                "location": u["location"] if "location" in u.keys() else None,
                "coffee_preference": u["coffee_preference"] if "coffee_preference" in u.keys() else None,
                "brewing_style": u["brewing_style"] if "brewing_style" in u.keys() else None,
            }

            # Get their shelves
            shelf_entries = db.execute(
                "SELECT * FROM shelf_entries WHERE user_id = ? ORDER BY moved_at DESC",
                (u["id"],)
            ).fetchall()

            shelves = {"currently_drinking": [], "drank": [], "want_to_try": []}
            for e in shelf_entries:
                note_count = db.execute(
                    "SELECT COUNT(*) as c FROM tasting_notes WHERE user_id = ? AND product_id = ?",
                    (u["id"], e["product_id"])
                ).fetchone()["c"]
                shelves[e["shelf"]].append({
                    "id": e["id"],
                    "product_id": e["product_id"],
                    "shelf": e["shelf"],
                    "added_at": e["added_at"],
                    "moved_at": e["moved_at"],
                    "tasting_note_count": note_count,
                })

            # Get their latest tasting notes
            notes = db.execute(
                "SELECT * FROM tasting_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
                (u["id"],)
            ).fetchall()

            recent_notes = []
            for n in notes:
                note_user = {"username": u["username"], "display_name": u["display_name"]}
                tags = json.loads(n["flavor_tags"]) if n["flavor_tags"] else None
                blend = json.loads(n["blend_components"]) if ("blend_components" in n.keys() and n["blend_components"]) else None
                recent_notes.append({
                    "id": n["id"],
                    "product_id": n["product_id"],
                    "user": note_user,
                    "acidity": n["acidity"], "body": n["body"],
                    "sweetness": n["sweetness"], "aftertaste": n["aftertaste"],
                    "flavor_tags": tags,
                    "brew_method": n["brew_method"], "drink_style": n["drink_style"],
                    "milk_type": n["milk_type"],
                    "dose_grams": n["dose_grams"], "yield_grams": n["yield_grams"],
                    "water_ml": n["water_ml"],
                    "extraction_time_secs": n["extraction_time_secs"],
                    "water_temp_celsius": n["water_temp_celsius"],
                    "grind_size": n["grind_size"], "brew_ratio": n["brew_ratio"],
                    "blend_components": blend,
                    "comment": n["comment"],
                    "created_at": n["created_at"], "updated_at": n["updated_at"],
                })

            # Only include users who have shelf entries
            total_entries = sum(len(v) for v in shelves.values())
            if total_entries > 0:
                feed.append({
                    "user": user_data,
                    "shelves": shelves,
                    "recent_notes": recent_notes,
                    "total_coffees": total_entries,
                    "latest_activity": shelf_entries[0]["moved_at"] if shelf_entries else None,
                })

        # Sort by latest activity
        feed.sort(key=lambda x: x.get("latest_activity") or "", reverse=True)
        return {"feed": feed}
    finally:
        db.close()


@app.get("/api/products/popularity")
def get_product_popularity():
    """Return count of users per product."""
    db = get_db()
    try:
        rows = db.execute("""
            SELECT product_id, COUNT(DISTINCT user_id) as user_count
            FROM shelf_entries
            GROUP BY product_id
            ORDER BY user_count DESC
        """).fetchall()
        return {r["product_id"]: r["user_count"] for r in rows}
    finally:
        db.close()


@app.get("/api/products/{product_id}/users")
def get_product_users(product_id: str):
    """Return users who have this product on their shelf, with their notes."""
    db = get_db()
    try:
        # Get all shelf entries for this product
        entries = db.execute("""
            SELECT se.shelf, se.added_at, u.username, u.display_name, u.avatar_url, u.location
            FROM shelf_entries se
            JOIN users u ON se.user_id = u.id
            WHERE se.product_id = ?
            ORDER BY se.moved_at DESC
        """, (product_id,)).fetchall()

        # Get all tasting notes for this product
        notes = db.execute("""
            SELECT tn.*, u.username, u.display_name, u.avatar_url
            FROM tasting_notes tn
            JOIN users u ON tn.user_id = u.id
            WHERE tn.product_id = ?
            ORDER BY tn.created_at DESC
        """, (product_id,)).fetchall()

        users = []
        for e in entries:
            user_notes = []
            for n in notes:
                if n["username"] == e["username"]:
                    tags = json.loads(n["flavor_tags"]) if n["flavor_tags"] else None
                    blend = json.loads(n["blend_components"]) if ("blend_components" in n.keys() and n["blend_components"]) else None
                    user_notes.append({
                        "id": n["id"],
                        "user": {"username": n["username"], "display_name": n["display_name"]},
                        "acidity": n["acidity"], "body": n["body"],
                        "sweetness": n["sweetness"], "aftertaste": n["aftertaste"],
                        "flavor_tags": tags,
                        "brew_method": n["brew_method"], "drink_style": n["drink_style"],
                        "milk_type": n["milk_type"],
                        "dose_grams": n["dose_grams"], "yield_grams": n["yield_grams"],
                        "water_ml": n["water_ml"],
                        "extraction_time_secs": n["extraction_time_secs"],
                        "water_temp_celsius": n["water_temp_celsius"],
                        "grind_size": n["grind_size"], "brew_ratio": n["brew_ratio"],
                        "blend_components": blend,
                        "comment": n["comment"],
                        "created_at": n["created_at"], "updated_at": n["updated_at"],
                    })
            users.append({
                "username": e["username"],
                "display_name": e["display_name"],
                "avatar_url": e["avatar_url"] if "avatar_url" in e.keys() else None,
                "location": e["location"] if "location" in e.keys() else None,
                "shelf": e["shelf"],
                "added_at": e["added_at"],
                "notes": user_notes,
            })

        return {"product_id": product_id, "users": users}
    finally:
        db.close()


# ── Unified refresh endpoint ──────────────────────────────────────────────────

def _load_api_key():
    """Load Google Places API key from env or .env file."""
    key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if key:
        return key
    env_path = os.path.join(_BASE, "Scraper", "coffee-catalog", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("GOOGLE_PLACES_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return None


def _run_full_refresh(queue):
    """
    Run catalog discovery + product scraper sequentially.
    Pushes events to the queue for SSE streaming.
    """
    t_start = time.time()

    # Helper: capture print() output and forward as SSE log events
    import io

    class _QueueWriter(io.TextIOBase):
        def __init__(self, q, phase):
            self.q = q
            self.phase = phase
        def write(self, text):
            text = text.strip()
            if text:
                self.q.put({"event": "log", "data": {
                    "phase": self.phase, "message": text,
                }})
            return len(text)

    try:
        # ── Phase 1: Catalog Discovery ────────────────────────────────
        api_key = _load_api_key()

        if api_key:
            queue.put({"event": "phase", "data": {
                "phase": "discovery", "status": "running",
                "detail": "Searching Google Places + seed list...",
            }})

            # Import catalog pipeline modules via file path (avoid utils.py collision)
            import importlib.util

            def _load_module(name, directory):
                spec = importlib.util.spec_from_file_location(name, os.path.join(directory, f"{name}.py"))
                mod = importlib.util.module_from_spec(spec)
                # Temporarily add the directory to sys.path for the module's own imports
                _old_path = sys.path[:]
                sys.path.insert(0, directory)
                try:
                    spec.loader.exec_module(mod)
                finally:
                    sys.path[:] = _old_path
                return mod

            discovery_mod = _load_module("discovery", _CATALOG_PIPELINE)
            os.makedirs(_CATALOG_OUTPUT, exist_ok=True)
            _old_stdout = sys.stdout
            sys.stdout = _QueueWriter(queue, "discovery")
            try:
                candidates = discovery_mod.run_discovery(api_key)
            finally:
                sys.stdout = _old_stdout

            with open(os.path.join(_CATALOG_OUTPUT, "discovery.json"), "w", encoding="utf-8") as f:
                json.dump(candidates, f, ensure_ascii=False, indent=2)

            queue.put({"event": "phase", "data": {
                "phase": "discovery", "status": "done",
                "candidates": len(candidates),
            }})

            # ── Phase 2: Verification ─────────────────────────────────
            queue.put({"event": "phase", "data": {
                "phase": "verification", "status": "running",
                "detail": f"Verifying {len(candidates)} candidates...",
            }})

            verification_mod = _load_module("verification", _CATALOG_PIPELINE)
            sys.stdout = _QueueWriter(queue, "verification")
            try:
                verifications, verified_count, dropped_count = verification_mod.run_verification(candidates)
            finally:
                sys.stdout = _old_stdout

            with open(os.path.join(_CATALOG_OUTPUT, "verification.json"), "w", encoding="utf-8") as f:
                json.dump(verifications, f, ensure_ascii=False, indent=2)

            queue.put({"event": "phase", "data": {
                "phase": "verification", "status": "done",
                "verified": verified_count, "dropped": dropped_count,
            }})

            # ── Phase 3: Enrichment ───────────────────────────────────
            queue.put({"event": "phase", "data": {
                "phase": "enrichment", "status": "running",
                "detail": f"Enriching {verified_count} roaster profiles...",
            }})

            enrichment_mod = _load_module("enrichment", _CATALOG_PIPELINE)
            sys.stdout = _QueueWriter(queue, "enrichment")
            try:
                enrichments = enrichment_mod.run_enrichment(candidates, verifications)
            finally:
                sys.stdout = _old_stdout

            with open(os.path.join(_CATALOG_OUTPUT, "enrichment.json"), "w", encoding="utf-8") as f:
                json.dump(enrichments, f, ensure_ascii=False, indent=2)

            queue.put({"event": "phase", "data": {
                "phase": "enrichment", "status": "done",
                "enriched": len(enrichments),
            }})

            # ── Phase 4: Assembly ─────────────────────────────────────
            assembler_mod = _load_module("assembler", _CATALOG_PIPELINE)
            import datetime

            verified_list, dropped_list, summary = assembler_mod.assemble_catalog(
                candidates, verifications, enrichments
            )

            catalog = {
                "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "pipeline_version": "1.0",
                "criteria": "Google Places + seeds + website verification",
                "summary": summary,
                "roasters": verified_list,
                "dropped": dropped_list,
            }

            with open(os.path.join(_CATALOG_OUTPUT, "verified_roasters_catalog.json"), "w", encoding="utf-8") as f:
                json.dump(catalog, f, ensure_ascii=False, indent=2)

            # Also write scraper-compatible input
            scraper_input = [
                {
                    "name": r["name"], "city": r["city"], "state": r["state"],
                    "lat": r["lat"], "lng": r["lng"],
                    "website": r["website"], "shop_url": r["shop_url"],
                    "platform": r["platform"],
                }
                for r in verified_list
            ]

            # Merge with existing scraper input (preserve manually-added roasters)
            existing_path = os.path.join(_BASE, "Scraper", "input", "verified_roasters_catalog.json")
            if os.path.exists(existing_path):
                from urllib.parse import urlparse
                with open(existing_path) as f:
                    existing = json.load(f)
                new_domains = set()
                for r in scraper_input:
                    try:
                        new_domains.add(urlparse(r["website"]).hostname.replace("www.", ""))
                    except Exception:
                        pass
                for r in existing:
                    try:
                        domain = urlparse(r["website"]).hostname.replace("www.", "")
                        if domain not in new_domains:
                            scraper_input.append(r)
                    except Exception:
                        pass

            with open(existing_path, "w", encoding="utf-8") as f:
                json.dump(scraper_input, f, ensure_ascii=False, indent=2)

            queue.put({"event": "phase", "data": {
                "phase": "assembly", "status": "done",
                "roasters": len(verified_list),
                "total_in_scraper_input": len(scraper_input),
            }})

        else:
            queue.put({"event": "phase", "data": {
                "phase": "discovery", "status": "skipped",
                "detail": "No GOOGLE_PLACES_API_KEY — using existing catalog",
            }})

        # ── Phase 5: Product Scraping ─────────────────────────────────
        queue.put({"event": "phase", "data": {
            "phase": "scraping", "status": "running",
            "detail": "Scraping coffee beans from all roasters...",
        }})

        # Import and run scraper — it needs its dir on sys.path for the
        # entire duration (its thread pool workers import sibling modules).
        # Must also purge cached catalog pipeline modules that share names
        # (utils, filters, etc.) so the scraper gets its own versions.
        import importlib.util as _ilu

        # Remove catalog pipeline from path, add scraper dir
        sys.path = [p for p in sys.path if _CATALOG_PIPELINE not in p]
        if _SCRAPER_DIR not in sys.path:
            sys.path.insert(0, _SCRAPER_DIR)

        # Purge any cached modules from the catalog pipeline that collide
        # with scraper module names (utils, filters, etc.)
        for mod_name in list(sys.modules.keys()):
            mod = sys.modules[mod_name]
            if hasattr(mod, "__file__") and mod.__file__ and _CATALOG_PIPELINE in str(mod.__file__):
                del sys.modules[mod_name]

        _spec = _ilu.spec_from_file_location("scraper_main", os.path.join(_SCRAPER_DIR, "main.py"))
        _scraper_mod = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_scraper_mod)
        _scraper_gen = _scraper_mod.scrape_all_generator

        total_products = 0
        total_roasters_done = 0

        for event in _scraper_gen():
            if event["event"] == "roaster_done":
                total_roasters_done += 1
                total_products += event["data"].get("coffees_found", 0)
                queue.put({
                    "event": "roaster_done",
                    "data": {
                        "index": total_roasters_done,
                        "total": event["data"]["total"],
                        "roaster": event["data"]["roaster"],
                        "coffees_found": event["data"]["coffees_found"],
                    },
                })
            elif event["event"] == "roaster_failed":
                total_roasters_done += 1
                queue.put({
                    "event": "roaster_failed",
                    "data": {
                        "index": total_roasters_done,
                        "total": event["data"]["total"],
                        "roaster": event["data"]["roaster"],
                        "error": event["data"].get("error", ""),
                    },
                })
            elif event["event"] == "scrape_complete":
                pass  # We'll send our own complete event

        queue.put({"event": "phase", "data": {
            "phase": "scraping", "status": "done",
            "products": total_products,
        }})

        # ── Done ──────────────────────────────────────────────────────
        elapsed = round(time.time() - t_start, 1)
        queue.put({"event": "complete", "data": {
            "products": total_products,
            "roasters_scraped": total_roasters_done,
            "duration_seconds": elapsed,
        }})

    except Exception as exc:
        queue.put({"event": "error", "data": {"error": str(exc)[:500]}})

    finally:
        queue.put(None)  # Sentinel
        _refresh_lock.release()


@app.get("/api/refresh")
async def refresh_all():
    """
    SSE endpoint: runs catalog discovery + product scraper end-to-end.
    Streams progress events as each phase completes.
    """
    if not _refresh_lock.acquire(blocking=False):
        async def already_running():
            yield {"event": "error", "data": json.dumps({"error": "Refresh already in progress"})}
        return EventSourceResponse(already_running())

    queue = Queue()
    thread = threading.Thread(target=_run_full_refresh, args=(queue,), daemon=True)
    thread.start()

    async def event_stream():
        while True:
            try:
                event = await asyncio.get_event_loop().run_in_executor(
                    None, queue.get, True, 1.0
                )
            except Empty:
                continue
            if event is None:
                break
            yield {
                "event": event["event"],
                "data": json.dumps(event["data"]),
            }

    return EventSourceResponse(event_stream())
