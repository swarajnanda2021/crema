"""
Tasting note CRUD with dictionary validation.
Supports full brew recipe: method, drink style, milk, dose, yield, time, temp, grind, ratio.
"""

import json
import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from database import get_db
from auth import get_current_user
from models import TastingNoteCreate, TastingNoteUpdate
from dictionary import (
    validate_flavor_tags, validate_brew_method,
    validate_drink_style, validate_milk_type, validate_grind_size,
)

router = APIRouter(prefix="/api/tasting-notes", tags=["Tasting Notes"])

# All recipe fields (DB column names)
_RECIPE_FIELDS = [
    "brew_method", "drink_style", "milk_type",
    "dose_grams", "yield_grams", "water_ml",
    "extraction_time_secs", "water_temp_celsius",
    "grind_size", "brew_ratio",
]

_TASTING_FIELDS = ["acidity", "body", "sweetness", "aftertaste"]

_ALL_FIELDS = _TASTING_FIELDS + ["flavor_tags"] + _RECIPE_FIELDS + ["comment"]


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _note_to_dict(row, db):
    user = db.execute(
        "SELECT username, display_name FROM users WHERE id = ?", (row["user_id"],)
    ).fetchone()
    tags = json.loads(row["flavor_tags"]) if row["flavor_tags"] else None

    return {
        "id": row["id"],
        "user": {
            "username": user["username"],
            "display_name": user["display_name"],
        },
        # Tasting
        "acidity": row["acidity"],
        "body": row["body"],
        "sweetness": row["sweetness"],
        "aftertaste": row["aftertaste"],
        "flavor_tags": tags,
        # Recipe
        "brew_method": row["brew_method"],
        "drink_style": row["drink_style"],
        "milk_type": row["milk_type"],
        "dose_grams": row["dose_grams"],
        "yield_grams": row["yield_grams"],
        "water_ml": row["water_ml"],
        "extraction_time_secs": row["extraction_time_secs"],
        "water_temp_celsius": row["water_temp_celsius"],
        "grind_size": row["grind_size"],
        "brew_ratio": row["brew_ratio"],
        # Blend
        "blend_components": json.loads(row["blend_components"]) if ("blend_components" in row.keys() and row["blend_components"]) else None,
        # Meta
        "comment": row["comment"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _validate_note(req):
    """Validate all dictionary-backed fields."""
    if req.flavor_tags:
        invalid = validate_flavor_tags(req.flavor_tags)
        if invalid:
            raise HTTPException(422, f"Invalid flavor tags: {', '.join(invalid)}")

    if req.brew_method and not validate_brew_method(req.brew_method):
        raise HTTPException(422, f"Unknown brew method: {req.brew_method}")

    if req.drink_style and not validate_drink_style(req.drink_style):
        raise HTTPException(422, f"Unknown drink style: {req.drink_style}")

    if req.milk_type and not validate_milk_type(req.milk_type):
        raise HTTPException(422, f"Unknown milk type: {req.milk_type}")

    if req.grind_size and not validate_grind_size(req.grind_size):
        raise HTTPException(422, f"Unknown grind size: {req.grind_size}")

    # Validate blend components
    if hasattr(req, "blend_components") and req.blend_components:
        total = sum(c.percentage for c in req.blend_components)
        if total != 100:
            raise HTTPException(422, f"Blend percentages must sum to 100 (got {total})")

    # At least one field must be non-null
    has_content = any([
        req.acidity, req.body, req.sweetness, req.aftertaste,
        req.flavor_tags, req.brew_method, req.drink_style,
        req.milk_type, req.dose_grams, req.yield_grams,
        req.water_ml, req.extraction_time_secs, req.water_temp_celsius,
        req.grind_size, req.brew_ratio, req.comment,
        hasattr(req, "blend_components") and req.blend_components,
    ])
    if not has_content:
        raise HTTPException(422, "At least one field must be provided")


@router.get("")
def list_notes(product_id: str = Query(None), user=Depends(get_current_user)):
    db = get_db()
    try:
        if product_id:
            rows = db.execute(
                "SELECT * FROM tasting_notes WHERE product_id = ? ORDER BY created_at DESC",
                (product_id,),
            ).fetchall()
            return {
                "product_id": product_id,
                "notes": [_note_to_dict(r, db) for r in rows],
            }
        else:
            raise HTTPException(400, "product_id query parameter required")
    finally:
        db.close()


@router.get("/mine")
def list_my_notes(user=Depends(get_current_user)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM tasting_notes WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        return [_note_to_dict(r, db) for r in rows]
    finally:
        db.close()


@router.post("", status_code=201)
def create_note(req: TastingNoteCreate, user=Depends(get_current_user)):
    _validate_note(req)

    db = get_db()
    try:
        now = _now()
        tags_json = json.dumps(req.flavor_tags) if req.flavor_tags else None
        blend_json = json.dumps([c.dict() for c in req.blend_components]) if req.blend_components else None

        cursor = db.execute(
            """INSERT INTO tasting_notes
            (user_id, product_id,
             acidity, body, sweetness, aftertaste, flavor_tags,
             brew_method, drink_style, milk_type,
             dose_grams, yield_grams, water_ml,
             extraction_time_secs, water_temp_celsius,
             grind_size, brew_ratio,
             blend_components,
             comment, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user["id"], req.product_id,
                req.acidity, req.body, req.sweetness, req.aftertaste, tags_json,
                req.brew_method, req.drink_style, req.milk_type,
                req.dose_grams, req.yield_grams, req.water_ml,
                req.extraction_time_secs, req.water_temp_celsius,
                req.grind_size, req.brew_ratio,
                blend_json,
                req.comment, now, now,
            ),
        )
        db.commit()
        note_id = cursor.lastrowid

        # Auto-create a post for the timeline
        roaster_slug = user.get("roaster_slug") or f"user_{user['id']}"
        teaser = req.comment or "Posted a tasting note"
        db.execute(
            """INSERT INTO roaster_posts
               (roaster_slug, user_id, title, teaser, post_type, tasting_note_id, created_at)
               VALUES (?, ?, ?, ?, 'tasting_note', ?, ?)""",
            (roaster_slug, user["id"], f"Tasting note", teaser[:300], note_id, now),
        )
        db.commit()

        row = db.execute(
            "SELECT * FROM tasting_notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _note_to_dict(row, db)
    finally:
        db.close()


@router.put("/{note_id}")
def update_note(note_id: int, req: TastingNoteUpdate, user=Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM tasting_notes WHERE id = ?", (note_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Note not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Cannot edit another user's note")

        # Validate dictionary fields
        if req.flavor_tags:
            invalid = validate_flavor_tags(req.flavor_tags)
            if invalid:
                raise HTTPException(422, f"Invalid flavor tags: {', '.join(invalid)}")
        if req.brew_method and not validate_brew_method(req.brew_method):
            raise HTTPException(422, f"Unknown brew method: {req.brew_method}")
        if req.drink_style and not validate_drink_style(req.drink_style):
            raise HTTPException(422, f"Unknown drink style: {req.drink_style}")
        if req.milk_type and not validate_milk_type(req.milk_type):
            raise HTTPException(422, f"Unknown milk type: {req.milk_type}")
        if req.grind_size and not validate_grind_size(req.grind_size):
            raise HTTPException(422, f"Unknown grind size: {req.grind_size}")

        now = _now()
        tags_json = json.dumps(req.flavor_tags) if req.flavor_tags else row["flavor_tags"]

        def _val(field):
            v = getattr(req, field)
            return v if v is not None else row[field]

        db.execute(
            """UPDATE tasting_notes SET
            acidity = ?, body = ?, sweetness = ?, aftertaste = ?,
            flavor_tags = ?,
            brew_method = ?, drink_style = ?, milk_type = ?,
            dose_grams = ?, yield_grams = ?, water_ml = ?,
            extraction_time_secs = ?, water_temp_celsius = ?,
            grind_size = ?, brew_ratio = ?,
            comment = ?, updated_at = ?
            WHERE id = ?""",
            (
                _val("acidity"), _val("body"), _val("sweetness"), _val("aftertaste"),
                tags_json,
                _val("brew_method"), _val("drink_style"), _val("milk_type"),
                _val("dose_grams"), _val("yield_grams"), _val("water_ml"),
                _val("extraction_time_secs"), _val("water_temp_celsius"),
                _val("grind_size"), _val("brew_ratio"),
                _val("comment"), now,
                note_id,
            ),
        )
        db.commit()

        updated = db.execute("SELECT * FROM tasting_notes WHERE id = ?", (note_id,)).fetchone()
        return _note_to_dict(updated, db)
    finally:
        db.close()


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, user=Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM tasting_notes WHERE id = ?", (note_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Note not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Cannot delete another user's note")
        db.execute("DELETE FROM tasting_notes WHERE id = ?", (note_id,))
        db.commit()
    finally:
        db.close()
