"""
Click tracking: log outbound roaster clicks, aggregate stats.
"""

import datetime
from fastapi import APIRouter, Depends, Header
from database import get_db
from auth import get_current_user, get_optional_user
from models import ClickRequest

router = APIRouter(prefix="/api/clicks", tags=["Click Tracking"])


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


@router.post("", status_code=201)
def log_click(req: ClickRequest, user=Depends(get_optional_user)):
    """Log an outbound click. Auth is optional — tracks anonymous clicks too."""
    db = get_db()
    try:
        db.execute(
            "INSERT INTO click_events (user_id, product_id, roaster_slug, source_page, clicked_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"] if user else None, req.product_id, req.roaster_slug, req.source_page, _now()),
        )
        db.commit()
        return {"tracked": True}
    finally:
        db.close()


@router.get("/stats")
def click_stats(user=Depends(get_current_user)):
    """Aggregate click statistics."""
    db = get_db()
    try:
        total = db.execute("SELECT COUNT(*) as c FROM click_events").fetchone()["c"]

        by_roaster = [
            {"roaster_slug": r["roaster_slug"], "clicks": r["c"]}
            for r in db.execute(
                "SELECT roaster_slug, COUNT(*) as c FROM click_events GROUP BY roaster_slug ORDER BY c DESC"
            ).fetchall()
        ]

        by_product = [
            {"product_id": r["product_id"], "roaster_slug": r["roaster_slug"], "clicks": r["c"]}
            for r in db.execute(
                "SELECT product_id, roaster_slug, COUNT(*) as c FROM click_events GROUP BY product_id ORDER BY c DESC LIMIT 20"
            ).fetchall()
        ]

        by_source = [
            {"source_page": r["source_page"], "count": r["c"]}
            for r in db.execute(
                "SELECT source_page, COUNT(*) as c FROM click_events GROUP BY source_page ORDER BY c DESC"
            ).fetchall()
        ]

        return {
            "total_clicks": total,
            "by_roaster": by_roaster,
            "by_product": by_product,
            "by_source": by_source,
        }
    finally:
        db.close()
