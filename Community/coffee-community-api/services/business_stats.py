"""
Per-business analytics — the lightweight counterpart to
`services/admin_stats.py`. Powers the Analytics sub-tab inside
roaster profiles. Not for site-admin dashboards.

Phase 1 carries one subtab per business: roaster Audience. The
wholesale subtab + the entire café dashboard were dropped when cafés
were deferred to Phase N. When cafés re-enter, the surface will be
redesigned from scratch.

Hero question (see NORTH_STAR.md §1):
- Roaster: "Am I being seen / wanted?" → shelf saves + Buy clicks
  (catalog signals; the follows/posts feed metrics were retired).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, List, Dict, Optional

from services.admin_stats import _daily_series, _n, _f


# ── Generic helpers ────────────────────────────────────────────────

def _delta_pct(current: int, prior: int) -> Optional[float]:
    """Percent change from `prior` to `current`. None when prior is 0
    (indeterminate — the frontend renders these as a "new" badge
    rather than an arrow)."""
    if prior <= 0:
        return None
    return round((current - prior) / prior * 100.0, 1)


def _week_over_week(db, sql: str, params: tuple) -> Dict[str, Any]:
    """Run a single-row query that returns (this_week, prior_week)
    ints, return `{value, prior, delta_pct}`. The SQL is expected to
    use `datetime('now', '-7 days')` / `-14 days` boundary logic."""
    row = db.execute(sql, params).fetchone()
    this_week = _n(row["this_week"]) if row else 0
    prior = _n(row["prior_week"]) if row else 0
    return {
        "value": this_week,
        "prior": prior,
        "delta_pct": _delta_pct(this_week, prior),
    }


def _series_30d(db, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Run a daily-grouped query and align it to the trailing 30 days
    so the chart axis is always the same length, even when most days
    have zero events. Caller's SQL must `SELECT DATE(...) AS date,
    COUNT(*) AS count GROUP BY DATE(...)`."""
    return _daily_series(db, 30, sql, params)


# ── Roaster dashboard ─────────────────────────────────────────────

def _roaster_audience(db, roaster_slug: str) -> Dict[str, Any]:
    """Audience subtab — catalog-signal reach for a roaster.

    1. Shelf saves — how many people saved your beans (interest)
    2. Buy clicks — outbound Buy clicks on your beans (intent)
    3. Journal engagement — likes + comments on your articles
    """
    # Card 1 — total shelf-saves of this roaster's beans + new-this-week
    total_saves = _n(db.execute("""
        SELECT COUNT(*) AS c FROM shelf_entries s
        JOIN products p ON p.product_id = s.product_id
        WHERE p.roaster_slug = ?
    """, (roaster_slug,)).fetchone()["c"])

    saves_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN s.added_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN s.added_at >= datetime('now', '-14 days')
                   AND s.added_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM shelf_entries s
        JOIN products p ON p.product_id = s.product_id
        WHERE p.roaster_slug = ?
    """, (roaster_slug,))

    # Card 2 — Buy clicks on this roaster's beans, last 30 days + WoW
    clicks_month = _n(db.execute("""
        SELECT COUNT(*) AS c FROM click_events
        WHERE roaster_slug = ? AND clicked_at >= datetime('now', '-30 days')
    """, (roaster_slug,)).fetchone()["c"])

    clicks_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN clicked_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN clicked_at >= datetime('now', '-14 days')
                   AND clicked_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM click_events WHERE roaster_slug = ?
    """, (roaster_slug,))

    # Card 3 — journal engagement: likes + comments on this roaster's
    # articles. The like/comment rows carry no timestamp, so this is a
    # cumulative total (no week-over-week / series).
    article_engagement = _n(db.execute("""
        SELECT
          (SELECT COUNT(*) FROM article_likes al
             JOIN roaster_articles ra ON ra.id = al.article_id
             WHERE ra.roaster_slug = ?)
          +
          (SELECT COUNT(*) FROM article_comments ac
             JOIN roaster_articles ra2 ON ra2.id = ac.article_id
             WHERE ra2.roaster_slug = ?) AS c
    """, (roaster_slug, roaster_slug)).fetchone()["c"])

    saves_series = _series_30d(db, """
        SELECT DATE(s.added_at) AS date, COUNT(*) AS count
        FROM shelf_entries s
        JOIN products p ON p.product_id = s.product_id
        WHERE p.roaster_slug = ?
        GROUP BY DATE(s.added_at)
    """, (roaster_slug,))

    clicks_series = _series_30d(db, """
        SELECT DATE(clicked_at) AS date, COUNT(*) AS count
        FROM click_events WHERE roaster_slug = ?
        GROUP BY DATE(clicked_at)
    """, (roaster_slug,))

    return {
        "cards": [
            {
                "key": "shelf_saves",
                "label": "Shelf saves",
                "value": total_saves,
                "hint": f"+{saves_wow['value']} this week" if saves_wow["value"] else None,
                "delta_pct": saves_wow["delta_pct"],
                "info": "How many people have saved your beans to a shelf — the clearest signal of catalog interest. Saves grow when your beans are discoverable in search and your product pages are complete.",
                "charts": True,
            },
            {
                "key": "buy_clicks",
                "label": "Buy clicks (30d)",
                "value": clicks_month,
                "delta_pct": clicks_wow["delta_pct"],
                "info": "Outbound Buy clicks on your beans in the last 30 days — purchase intent. Every click is a consumer heading to your site to buy.",
                "charts": True,
            },
            {
                "key": "journal_engagement",
                "label": "Journal engagement",
                "value": article_engagement,
                "delta_pct": None,
                "info": "Likes + comments on your journal articles. Sourcing stories that explain the farm, the producer, and the process tend to earn the most.",
                "charts": False,
            },
        ],
        "series": {
            "shelf_saves": saves_series,
            "buy_clicks": clicks_series,
        },
        "hero_key": "shelf_saves",
    }


def compute_roaster_business(db, roaster_slug: str) -> Dict[str, Any]:
    """Assemble the full roaster analytics payload. Each section is
    independent — failures are isolated so a broken subtab can't
    bring the whole dashboard down."""
    out: Dict[str, Any] = {}
    for name, fn in (("audience", _roaster_audience),):
        try:
            out[name] = fn(db, roaster_slug)
        except Exception as exc:
            out[name] = {"error": str(exc), "cards": [], "series": {}}
    out["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return out
