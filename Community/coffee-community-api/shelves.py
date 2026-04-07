"""
Shelf CRUD: add/move/remove coffees, list own shelves, view partner's shelves.
"""

import datetime
from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from auth import get_current_user
from models import ShelfAddRequest

router = APIRouter(prefix="/api/shelves", tags=["Shelves"])


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry_with_note_count(row, db, user_id):
    count = db.execute(
        "SELECT COUNT(*) as c FROM tasting_notes WHERE user_id = ? AND product_id = ?",
        (user_id, row["product_id"]),
    ).fetchone()["c"]
    return {
        "id": row["id"],
        "product_id": row["product_id"],
        "shelf": row["shelf"],
        "added_at": row["added_at"],
        "moved_at": row["moved_at"],
        "tasting_note_count": count,
    }


def _get_user_shelves(db, user_id):
    rows = db.execute(
        "SELECT * FROM shelf_entries WHERE user_id = ? ORDER BY moved_at DESC",
        (user_id,),
    ).fetchall()

    shelves = {
        "currently_drinking": [],
        "drank": [],
        "want_to_try": [],
    }
    for row in rows:
        entry = _entry_with_note_count(row, db, user_id)
        shelves[row["shelf"]].append(entry)

    return shelves


@router.get("")
def list_my_shelves(user=Depends(get_current_user)):
    db = get_db()
    try:
        return _get_user_shelves(db, user["id"])
    finally:
        db.close()


@router.get("/users/{username}")
def list_user_shelves(username: str, user=Depends(get_current_user)):
    db = get_db()
    try:
        target = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not target:
            raise HTTPException(404, "User not found")
        return _get_user_shelves(db, target["id"])
    finally:
        db.close()


@router.post("")
def add_to_shelf(req: ShelfAddRequest, user=Depends(get_current_user)):
    db = get_db()
    try:
        now = _now()
        existing = db.execute(
            "SELECT * FROM shelf_entries WHERE user_id = ? AND product_id = ?",
            (user["id"], req.product_id),
        ).fetchone()

        if existing:
            if existing["shelf"] == req.shelf:
                # Already on the same shelf — no-op
                return _entry_with_note_count(existing, db, user["id"])

            # Move to a different shelf
            db.execute(
                "UPDATE shelf_entries SET shelf = ?, moved_at = ? WHERE id = ?",
                (req.shelf, now, existing["id"]),
            )
            db.commit()
            row = db.execute(
                "SELECT * FROM shelf_entries WHERE id = ?", (existing["id"],)
            ).fetchone()
            return _entry_with_note_count(row, db, user["id"])

        # New entry
        cursor = db.execute(
            "INSERT INTO shelf_entries (user_id, product_id, shelf, added_at, moved_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], req.product_id, req.shelf, now, now),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM shelf_entries WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return _entry_with_note_count(row, db, user["id"])
    finally:
        db.close()


@router.delete("/{entry_id}", status_code=204)
def remove_from_shelf(entry_id: int, user=Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM shelf_entries WHERE id = ? AND user_id = ?",
            (entry_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Shelf entry not found")

        db.execute("DELETE FROM shelf_entries WHERE id = ?", (entry_id,))
        db.commit()
    finally:
        db.close()
