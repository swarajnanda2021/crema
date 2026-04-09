"""
Roaster Posts: articles / journal entries published by roaster accounts.

Each roaster account can post articles with:
  - title (required)
  - teaser: 300-char excerpt shown in the feed (required)
  - external_url: link to the full article (optional)
  - cover_image_url: hero image (optional)
  - published_at: ISO date string, defaults to now

Endpoints:
  POST   /api/roaster-posts                  — create (roaster accounts only)
  GET    /api/roasters/{slug}/posts           — list posts for a roaster
  DELETE /api/roaster-posts/{id}             — delete own post
  GET    /api/feed                            — combined feed (notes + roaster posts)
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


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
        cursor = db.execute(
            """INSERT INTO roaster_posts
               (roaster_slug, user_id, title, teaser, external_url, cover_image_url, published_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (roaster_slug, user["id"], req.title.strip(), teaser,
             req.external_url, req.cover_image_url, published_at, now),
        )
        db.commit()
        row = db.execute(
            _POST_SELECT + " WHERE rp.id = ?", (cursor.lastrowid,)
        ).fetchone()
        return _row_to_post(row)
    finally:
        db.close()


@router.get("/roasters/{slug}/posts")
def get_roaster_posts(slug: str, limit: int = 20, offset: int = 0):
    """List posts for a specific roaster, newest first."""
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


@router.get("/feed")
def get_feed(limit: int = 30, offset: int = 0, user=Depends(get_optional_user)):
    """
    Combined activity feed.
    Returns a mix of tasting_note and roaster_post items, sorted newest first.
    """
    db = get_db()
    try:
        # Tasting notes
        notes_rows = db.execute("""
            SELECT tn.id, tn.product_id, tn.comment, tn.flavor_tags,
                   tn.brew_method, tn.drink_style,
                   tn.acidity, tn.body, tn.sweetness, tn.aftertaste,
                   tn.created_at,
                   u.username, u.display_name, u.avatar_url
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

        # Strip internal sort_key
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
