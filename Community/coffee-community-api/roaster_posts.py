"""
Roaster Posts: articles / journal entries published by roaster accounts.

Each roaster account can post articles with:
  - title (required)
  - teaser: 300-char excerpt shown in the feed (required)
  - external_url: link to the full article (optional)
  - cover_image_url: hero image (optional)
  - published_at: ISO date string, defaults to now

Endpoints:
  POST   /api/roaster-posts                        — create (roaster accounts only)
  GET    /api/roasters/{slug}/posts                — list all posts for a roaster
  GET    /api/roasters/{slug}/posts/featured       — get up to 2 featured posts (public, max 2)
  PUT    /api/roaster-posts/{id}/feature           — toggle featured status (roaster only)
  DELETE /api/roaster-posts/{id}                   — delete own post (roaster only)
  GET    /api/posts-timeline                       — combined feed: tasting notes + roaster posts
"""

import datetime
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from database import get_db
from auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api", tags=["Roaster Posts"])


# ── Models ────────────────────────────────────────────────────────────────────

class RoasterPostRequest(BaseModel):
    title: str
    teaser: str
    external_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    published_at: Optional[str] = None  # ISO date string; defaults to now
    post_type: Optional[str] = "article"  # "article" or "note"
    location: Optional[str] = None       # for note posts
    images: Optional[list] = None        # list of image URLs (up to N)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_images(r) -> list:
    """Return images list: from images_json if present, else fallback to cover_image_url."""
    keys = r.keys() if hasattr(r, "keys") else []
    if "images_json" in keys and r["images_json"]:
        try:
            imgs = json.loads(r["images_json"])
            if isinstance(imgs, list) and imgs:
                return imgs
        except Exception:
            pass
    # Fallback: single cover image
    cover = r["cover_image_url"] if "cover_image_url" in keys else None
    return [cover] if cover else []


def _row_to_post(r) -> dict:
    return {
        "id": r["id"],
        "type": "roaster_post",
        "roaster_slug": r["roaster_slug"],
        "user_id": r["user_id"],
        "author_username": r["username"],
        "author_display_name": r["display_name"],
        "author_avatar_url": r["avatar_url"],
        "title": r["title"],
        "teaser": r["teaser"],
        "external_url": r["external_url"],
        "cover_image_url": r["cover_image_url"],
        "published_at": r["published_at"] or r["created_at"],
        "created_at": r["created_at"],
        "is_featured": bool(r["is_featured"]) if "is_featured" in r.keys() else False,
        "featured_order": r["featured_order"] if "featured_order" in r.keys() else None,
        "post_type": r["post_type"] if "post_type" in r.keys() else "article",
        "location": r["location"] if "location" in r.keys() else None,
        "images": _parse_images(r),
    }


_POST_SELECT = """
    SELECT rp.*, u.username, u.display_name, u.avatar_url
    FROM roaster_posts rp
    JOIN users u ON rp.user_id = u.id
"""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/roaster-posts", status_code=201)
def create_post(req: RoasterPostRequest, user=Depends(get_current_user)):
    """Create a roaster post. Only roaster accounts may post."""
    if user.get("account_type") != "roaster":
        raise HTTPException(403, "Only roaster accounts can create posts")

    roaster_slug = user.get("roaster_slug")
    if not roaster_slug:
        raise HTTPException(400, "Your account has no roaster_slug configured")

    if not req.title.strip():
        raise HTTPException(422, "title is required")

    teaser = req.teaser.strip()
    if not teaser:
        raise HTTPException(422, "teaser is required")
    if len(teaser) > 300:
        raise HTTPException(422, "teaser must be 300 characters or fewer")

    now = _now()
    published_at = (req.published_at or now).strip() or now

    db = get_db()
    try:
        post_type = req.post_type if req.post_type in ("article", "note") else "article"
        # Build images: use req.images if provided, else fall back to cover_image_url
        images = [u for u in (req.images or []) if u and u.strip()]
        images_json_str = json.dumps(images) if images else None
        # cover_image_url: first image for backward compat
        cover = images[0] if images else req.cover_image_url
        cursor = db.execute(
            """INSERT INTO roaster_posts
               (roaster_slug, user_id, title, teaser, external_url, cover_image_url,
                published_at, created_at, is_featured, featured_order, post_type, location, images_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)""",
            (roaster_slug, user["id"], req.title.strip(), teaser,
             req.external_url, cover, published_at, now,
             post_type, req.location, images_json_str),
        )
        db.commit()
        row = db.execute(
            _POST_SELECT + " WHERE rp.id = ?", (cursor.lastrowid,)
        ).fetchone()
        return _row_to_post(row)
    finally:
        db.close()


@router.get("/roasters/{slug}/posts/featured")
def get_featured_posts(slug: str):
    """Get up to 2 featured posts for a roaster (public). Ordered by featured_order."""
    db = get_db()
    try:
        rows = db.execute(
            _POST_SELECT + """
            WHERE rp.roaster_slug = ? AND rp.is_featured = 1
            ORDER BY rp.featured_order ASC
            LIMIT 2
            """,
            (slug,),
        ).fetchall()
        return {"featured_posts": [_row_to_post(r) for r in rows]}
    finally:
        db.close()


@router.get("/roasters/{slug}/posts")
def get_roaster_posts(slug: str, limit: int = 20, offset: int = 0):
    """List all posts for a specific roaster, newest first."""
    db = get_db()
    try:
        rows = db.execute(
            _POST_SELECT + " WHERE rp.roaster_slug = ? ORDER BY rp.published_at DESC LIMIT ? OFFSET ?",
            (slug, limit, offset),
        ).fetchall()
        total = db.execute(
            "SELECT COUNT(*) as c FROM roaster_posts WHERE roaster_slug = ?", (slug,)
        ).fetchone()["c"]
        return {"posts": [_row_to_post(r) for r in rows], "total": total}
    finally:
        db.close()


@router.put("/roaster-posts/{post_id}/feature")
def toggle_feature(post_id: int, user=Depends(get_current_user)):
    """
    Toggle featured status for a roaster post.
    - If not featured: feature it (assign next available slot 1 or 2).
    - If featured: unfeature it.
    - Max 2 featured posts per roaster.
    """
    if user.get("account_type") != "roaster":
        raise HTTPException(403, "Only roaster accounts can feature posts")

    roaster_slug = user.get("roaster_slug")
    db = get_db()
    try:
        row = db.execute("SELECT * FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your post")

        if row["is_featured"]:
            # Unfeature it
            db.execute(
                "UPDATE roaster_posts SET is_featured = 0, featured_order = NULL WHERE id = ?",
                (post_id,)
            )
            db.commit()
            return {"featured": False, "featured_order": None}
        else:
            # Check current featured count
            featured = db.execute(
                "SELECT featured_order FROM roaster_posts WHERE roaster_slug = ? AND is_featured = 1 ORDER BY featured_order ASC",
                (roaster_slug,)
            ).fetchall()
            used_orders = {r["featured_order"] for r in featured if r["featured_order"]}
            if len(used_orders) >= 2:
                raise HTTPException(400, "You can only feature 2 posts. Unfeature one first.")
            # Pick the next available slot (1 or 2)
            next_order = next(s for s in (1, 2) if s not in used_orders)
            db.execute(
                "UPDATE roaster_posts SET is_featured = 1, featured_order = ? WHERE id = ?",
                (next_order, post_id)
            )
            db.commit()
            return {"featured": True, "featured_order": next_order}
    finally:
        db.close()


@router.delete("/roaster-posts/{post_id}")
def delete_post(post_id: int, user=Depends(get_current_user)):
    """Delete a roaster post. Only the author may delete."""
    db = get_db()
    try:
        row = db.execute("SELECT * FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your post")
        db.execute("DELETE FROM roaster_posts WHERE id = ?", (post_id,))
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


@router.get("/posts-timeline")
def get_posts_timeline(limit: int = 30, offset: int = 0, user=Depends(get_optional_user)):
    """
    Combined activity feed: tasting notes + roaster posts, sorted newest first.
    Used by the HOME feed tab.
    """
    db = get_db()
    try:
        # Tasting notes
        notes_rows = db.execute("""
            SELECT tn.id, tn.product_id, tn.comment, tn.flavor_tags,
                   tn.brew_method, tn.drink_style,
                   tn.acidity, tn.body, tn.sweetness, tn.aftertaste,
                   tn.created_at,
                   u.username, u.display_name, u.avatar_url, u.location
            FROM tasting_notes tn
            JOIN users u ON tn.user_id = u.id
            ORDER BY tn.created_at DESC
            LIMIT 200
        """).fetchall()

        notes_items = []
        for r in notes_rows:
            tags = json.loads(r["flavor_tags"]) if r["flavor_tags"] else None
            notes_items.append({
                "type": "tasting_note",
                "id": r["id"],
                "product_id": r["product_id"],
                "comment": r["comment"],
                "flavor_tags": tags,
                "brew_method": r["brew_method"],
                "drink_style": r["drink_style"],
                "acidity": r["acidity"],
                "body": r["body"],
                "sweetness": r["sweetness"],
                "aftertaste": r["aftertaste"],
                "author": {
                    "username": r["username"],
                    "display_name": r["display_name"],
                    "avatar_url": r["avatar_url"],
                    "location": r["location"],
                },
                "created_at": r["created_at"],
                "sort_key": r["created_at"],
            })

        # Roaster posts
        posts_rows = db.execute(
            _POST_SELECT + " ORDER BY rp.published_at DESC LIMIT 200"
        ).fetchall()

        posts_items = []
        for r in posts_rows:
            item = _row_to_post(r)
            item["sort_key"] = item["published_at"]
            posts_items.append(item)

        # Merge and sort
        combined = notes_items + posts_items
        combined.sort(key=lambda x: x["sort_key"], reverse=True)

        # Paginate
        paginated = combined[offset: offset + limit]
        for item in paginated:
            item.pop("sort_key", None)

        return {
            "items": paginated,
            "total": len(combined),
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()
