"""
Posts: universal post system for all users (roasters + buyers).

Post types: article, note, repost, tasting_note

Endpoints:
  POST   /api/roaster-posts                        — create post (any authenticated user)
  PUT    /api/roaster-posts/{id}                   — edit own post
  GET    /api/roasters/{slug}/posts                — list posts for a roaster/user
  PUT    /api/roaster-posts/{id}/pin               — toggle pinned (max 1)
  DELETE /api/roaster-posts/{id}                   — delete own post
  GET    /api/posts-timeline                       — combined feed
  GET    /api/users/{username}/posts               — list posts for a user
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

VALID_POST_TYPES = {"article", "note", "repost", "tasting_note"}
MAX_IMAGES_NON_ARTICLE = 6


class RoasterPostRequest(BaseModel):
    title: str
    teaser: str
    external_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    published_at: Optional[str] = None
    post_type: Optional[str] = "note"  # article | note | repost | tasting_note
    location: Optional[str] = None
    images: Optional[list] = None
    repost_of_id: Optional[int] = None
    repost_comment: Optional[str] = None
    tasting_note_id: Optional[int] = None


class PostUpdateRequest(BaseModel):
    title: Optional[str] = None
    teaser: Optional[str] = None
    external_url: Optional[str] = None
    location: Optional[str] = None
    images: Optional[list] = None


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


def _row_to_post(r, db=None) -> dict:
    keys = r.keys() if hasattr(r, "keys") else []
    repost_of_id = r["repost_of_id"] if "repost_of_id" in keys else None

    # Embed original post for reposts
    original_post = None
    if repost_of_id and db:
        try:
            orig_row = db.execute(
                _POST_SELECT + " WHERE rp.id = ?", (repost_of_id,)
            ).fetchone()
            if orig_row:
                original_post = _row_to_post(orig_row)  # no db = no recursion
        except Exception:
            pass

    # Like, comment, and repost counts
    post_id = r["id"]
    like_count = 0
    comment_count = 0
    repost_count = 0
    if db:
        try:
            like_count = db.execute("SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?", (post_id,)).fetchone()["c"]
            comment_count = db.execute("SELECT COUNT(*) as c FROM post_comments WHERE post_id = ?", (post_id,)).fetchone()["c"]
            repost_count = db.execute("SELECT COUNT(*) as c FROM roaster_posts WHERE repost_of_id = ?", (post_id,)).fetchone()["c"]
        except Exception:
            pass

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
        "updated_at": r["updated_at"] if "updated_at" in keys else None,
        "is_featured": bool(r["is_featured"]) if "is_featured" in keys else False,
        "featured_order": r["featured_order"] if "featured_order" in keys else None,
        "post_type": r["post_type"] if "post_type" in keys else "article",
        "location": r["location"] if "location" in keys else None,
        "images": _parse_images(r),
        "repost_of_id": repost_of_id,
        "repost_comment": r["repost_comment"] if "repost_comment" in keys else None,
        "original_post": original_post,
        "tasting_note_id": r["tasting_note_id"] if "tasting_note_id" in keys else None,
        "like_count": like_count,
        "comment_count": comment_count,
        "repost_count": repost_count,
    }


_POST_SELECT = """
    SELECT rp.*, u.username, u.display_name, u.avatar_url
    FROM roaster_posts rp
    JOIN users u ON rp.user_id = u.id
"""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/roaster-posts", status_code=201)
def create_post(req: RoasterPostRequest, user=Depends(get_current_user)):
    """Create a post. Any authenticated user can post."""
    # Use roaster_slug if available, otherwise synthetic user slug
    roaster_slug = user.get("roaster_slug") or f"user_{user['id']}"

    teaser = req.teaser.strip()
    if not teaser:
        raise HTTPException(422, "teaser is required")
    if len(teaser) > 300:
        raise HTTPException(422, "teaser must be 300 characters or fewer")

    post_type = req.post_type if req.post_type in VALID_POST_TYPES else "note"

    title = (req.title or "").strip()
    if post_type == "article" and not title:
        raise HTTPException(422, "title is required for article posts")
    if not title:
        title = teaser[:60]

    # Image limit for non-article posts
    images = [u for u in (req.images or []) if u and u.strip()]
    if post_type != "article" and len(images) > MAX_IMAGES_NON_ARTICLE:
        raise HTTPException(422, f"Maximum {MAX_IMAGES_NON_ARTICLE} images allowed")

    # Repost validation
    repost_of_id = None
    repost_comment = None
    if post_type == "repost":
        if not req.repost_of_id:
            raise HTTPException(422, "repost_of_id is required for reposts")
        repost_of_id = req.repost_of_id
        repost_comment = req.repost_comment

    now = _now()
    published_at = (req.published_at or now).strip() or now
    images_json_str = json.dumps(images) if images else None
    cover = images[0] if images else req.cover_image_url

    db = get_db()
    try:
        # Validate repost target exists
        if repost_of_id:
            orig = db.execute("SELECT id FROM roaster_posts WHERE id = ?", (repost_of_id,)).fetchone()
            if not orig:
                raise HTTPException(404, "Original post not found for repost")

        cursor = db.execute(
            """INSERT INTO roaster_posts
               (roaster_slug, user_id, title, teaser, external_url, cover_image_url,
                published_at, created_at, is_featured, featured_order, post_type, location,
                images_json, repost_of_id, repost_comment, tasting_note_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, NULL)""",
            (roaster_slug, user["id"], title, teaser,
             req.external_url, cover, published_at, now,
             post_type, req.location, images_json_str,
             repost_of_id, repost_comment, req.tasting_note_id),
        )
        db.commit()
        row = db.execute(
            _POST_SELECT + " WHERE rp.id = ?", (cursor.lastrowid,)
        ).fetchone()
        return _row_to_post(row, db)
    finally:
        db.close()


@router.put("/roaster-posts/{post_id}")
def update_post(post_id: int, req: PostUpdateRequest, user=Depends(get_current_user)):
    """Edit an existing post. Only the author can edit."""
    db = get_db()
    try:
        row = db.execute("SELECT * FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your post")

        # Merge: use new value if provided, else keep existing
        title = req.title.strip() if req.title is not None else row["title"]
        teaser = req.teaser.strip() if req.teaser is not None else row["teaser"]
        external_url = req.external_url if req.external_url is not None else row["external_url"]
        location = req.location if req.location is not None else row["location"]

        if teaser and len(teaser) > 300:
            raise HTTPException(422, "teaser must be 300 characters or fewer")

        # Images
        if req.images is not None:
            images = [u for u in req.images if u and u.strip()]
            post_type = row["post_type"] if "post_type" in row.keys() else "article"
            if post_type != "article" and len(images) > MAX_IMAGES_NON_ARTICLE:
                raise HTTPException(422, f"Maximum {MAX_IMAGES_NON_ARTICLE} images allowed")
            images_json_str = json.dumps(images) if images else None
            cover = images[0] if images else None
        else:
            images_json_str = row["images_json"] if "images_json" in row.keys() else None
            cover = row["cover_image_url"]

        db.execute(
            """UPDATE roaster_posts SET title=?, teaser=?, external_url=?, location=?,
               images_json=?, cover_image_url=?, updated_at=? WHERE id=?""",
            (title, teaser, external_url, location, images_json_str, cover, _now(), post_id),
        )
        db.commit()
        updated = db.execute(_POST_SELECT + " WHERE rp.id = ?", (post_id,)).fetchone()
        return _row_to_post(updated, db)
    finally:
        db.close()


@router.get("/users/{username}/posts")
def get_user_posts(username: str, limit: int = 20, offset: int = 0):
    """List all posts by a specific user, newest first."""
    db = get_db()
    try:
        user_row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user_row:
            raise HTTPException(404, "User not found")
        rows = db.execute(
            _POST_SELECT + " WHERE rp.user_id = ? ORDER BY rp.published_at DESC LIMIT ? OFFSET ?",
            (user_row["id"], limit, offset),
        ).fetchall()
        total = db.execute(
            "SELECT COUNT(*) as c FROM roaster_posts WHERE user_id = ?", (user_row["id"],)
        ).fetchone()["c"]
        return {"posts": [_row_to_post(r, db) for r in rows], "total": total}
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
        return {"featured_posts": [_row_to_post(r, db) for r in rows]}
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
        return {"posts": [_row_to_post(r, db) for r in rows], "total": total}
    finally:
        db.close()


@router.put("/roaster-posts/{post_id}/pin")
def toggle_pin(post_id: int, user=Depends(get_current_user)):
    """
    Toggle pinned status for a roaster post.
    Only 1 post can be pinned at a time — pinning a new one unpins the old.
    """
    roaster_slug = user.get("roaster_slug") or f"user_{user['id']}"
    db = get_db()
    try:
        row = db.execute("SELECT * FROM roaster_posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not your post")

        if row["is_featured"]:
            # Unpin it
            db.execute(
                "UPDATE roaster_posts SET is_featured = 0, featured_order = NULL WHERE id = ?",
                (post_id,),
            )
            db.commit()
            return {"pinned": False}
        else:
            # Unpin any currently pinned post for this roaster
            db.execute(
                "UPDATE roaster_posts SET is_featured = 0, featured_order = NULL WHERE roaster_slug = ? AND is_featured = 1",
                (roaster_slug,),
            )
            # Pin this one
            db.execute(
                "UPDATE roaster_posts SET is_featured = 1, featured_order = 1 WHERE id = ?",
                (post_id,),
            )
            db.commit()
            return {"pinned": True}
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
        # Tasting notes that DON'T have a corresponding roaster_post yet
        # (migrated ones already exist as roaster_posts with tasting_note_id set)
        notes_rows = db.execute("""
            SELECT tn.id, tn.product_id, tn.comment, tn.flavor_tags,
                   tn.brew_method, tn.drink_style,
                   tn.acidity, tn.body, tn.sweetness, tn.aftertaste,
                   tn.created_at,
                   u.username, u.display_name, u.avatar_url, u.location
            FROM tasting_notes tn
            JOIN users u ON tn.user_id = u.id
            WHERE tn.id NOT IN (
                SELECT tasting_note_id FROM roaster_posts
                WHERE tasting_note_id IS NOT NULL
            )
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

        # All posts (articles, notes, reposts, tasting_note posts)
        posts_rows = db.execute(
            _POST_SELECT + " ORDER BY rp.published_at DESC LIMIT 200"
        ).fetchall()

        posts_items = []
        for r in posts_rows:
            item = _row_to_post(r, db)
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
