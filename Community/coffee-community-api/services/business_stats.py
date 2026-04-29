"""
Per-business analytics — the lightweight counterpart to
`services/admin_stats.py`. Powers the Analytics sub-tab inside
roaster profiles. Not for site-admin dashboards.

Phase 1 carries one subtab per business: roaster Audience. The
wholesale subtab + the entire café dashboard were dropped when cafés
were deferred to Phase N. When cafés re-enter, the surface will be
redesigned from scratch.

Hero question (see NORTH_STAR.md §1):
- Roaster: "Am I being seen?" → followers + posts this month
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
    return _daily_series(db, sql, params, days=30)


# ── Roaster dashboard ─────────────────────────────────────────────

def _roaster_audience(db, roaster_slug: str) -> Dict[str, Any]:
    """Audience subtab — two cards on reach.

    1. Followers (total, cumulative)
    2. Posts this month (volume of your megaphone)
    """
    # Card 1 — total followers + new-this-week delta
    total_followers = _n(db.execute(
        "SELECT COUNT(*) AS c FROM follows WHERE roaster_slug = ?",
        (roaster_slug,),
    ).fetchone()["c"])

    wow_new = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN created_at >= datetime('now', '-14 days')
                   AND created_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM follows WHERE roaster_slug = ?
    """, (roaster_slug,))

    # Card 2 — posts published this month
    posts_month = _n(db.execute("""
        SELECT COUNT(*) AS c FROM roaster_posts
        WHERE roaster_slug = ? AND created_at >= datetime('now', '-30 days')
    """, (roaster_slug,)).fetchone()["c"])

    posts_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN created_at >= datetime('now', '-14 days')
                   AND created_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM roaster_posts WHERE roaster_slug = ?
    """, (roaster_slug,))

    followers_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM follows WHERE roaster_slug = ?
        GROUP BY DATE(created_at)
    """, (roaster_slug,))

    posts_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM roaster_posts WHERE roaster_slug = ?
        GROUP BY DATE(created_at)
    """, (roaster_slug,))

    return {
        "cards": [
            {
                "key": "followers",
                "label": "Followers",
                "value": total_followers,
                "hint": f"+{wow_new['value']} this week" if wow_new["value"] else None,
                "delta_pct": wow_new["delta_pct"],
                "info": "Total people following your roaster profile. Growth usually comes from sourcing stories and tasting-note mentions — showing up in the feed matters more than posting frequency.",
                "charts": True,
            },
            {
                "key": "posts_month",
                "label": "Posts this month",
                "value": posts_month,
                "delta_pct": posts_wow["delta_pct"],
                "info": "Posts you've published in the last 30 days. Too few and you fade from the feed; too many and consumers scroll past. 1-3 posts a week is the sweet spot.",
                "charts": True,
            },
        ],
        "series": {
            "followers": followers_series,
            "posts_month": posts_series,
        },
        "hero_key": "followers",
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
