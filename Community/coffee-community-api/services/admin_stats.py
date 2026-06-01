"""
CRUD Utopia — composite read-only analytics for the admin Site Analytics
dashboard. Lives here because the queries span many tables and can't be
expressed through the generic CRUD engine. See CRUD_UTOPIA.md at repo root.

Catalog-only launch dashboard — four sections, each a pure function
(db) -> {cards, tables, series} so the frontend can render generically:

  - catalog   — supply readiness: roasters, live/sold-out beans, data
                completeness, freshness, beans-per-roaster.
  - demand    — consumer intent: shelf saves + Buy clicks, top beans,
                clicks-by-source, the savers/clickers funnel.
  - roasters  — marketplace matching: roasters ranked by demand + the
                "cold" published roasters with zero saves/clicks.
  - audience  — growth: users, signups, DAU/WAU/MAU on catalog signals,
                returning users, article engagement.

The social-era sections (engagement/network/retention built on
posts/follows/tasting-notes) were retired with the catalog-only pivot.

All queries target the live app DB and return primitive JSON. The
/api/stats/traction endpoint gates access to the seeded "crema" admin.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any


def _n(val: Any, default: int = 0) -> int:
    """Coerce a SQL count/cell to int safely — None and empty → default."""
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _f(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _days_ago(days: int) -> str:
    return (_dt.datetime.utcnow() - _dt.timedelta(days=days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _daily_series(db, days: int, sql: str, params: tuple = ()) -> list:
    """Run a query that returns (date, count) rows grouped by date, then
    fill missing days with 0 so the chart has a continuous x-axis. Trims
    the leading zero window so a week-old project doesn't render 83 empty
    days on a 90-day chart. `sql` must return (date 'YYYY-MM-DD', count)."""
    rows = {r["date"]: _n(r["count"]) for r in db.execute(sql, params).fetchall()}
    series: list = []
    today = _dt.datetime.utcnow().date()
    for i in range(days - 1, -1, -1):
        d = (today - _dt.timedelta(days=i)).strftime("%Y-%m-%d")
        series.append({"date": d, "count": rows.get(d, 0)})
    if not any(pt["count"] > 0 for pt in series):
        return []
    first_nonzero = next(i for i, pt in enumerate(series) if pt["count"] > 0)
    start = max(0, first_nonzero - 1)
    return series[start:]


def _wow(db, sql: str, params: tuple = ()) -> dict:
    """SQL returns one row (this_week, prior_week). → {value, delta_pct}.
    delta_pct is None when prior is 0 (indeterminate; the frontend shows a
    'new' badge rather than an arrow)."""
    row = db.execute(sql, params).fetchone()
    this_w = _n(row["this_week"]) if row else 0
    prior = _n(row["prior_week"]) if row else 0
    delta = round((this_w - prior) / prior * 100.0, 1) if prior > 0 else None
    return {"value": this_w, "delta_pct": delta}


def _pct(db, sql: str, denom: int) -> float:
    c = _n(db.execute(sql).fetchone()[0])
    return round(c / denom * 100.0, 1) if denom else 0.0


# ── Catalog readiness ────────────────────────────────────────────────────────

def _catalog(db) -> dict:
    total = _n(db.execute("SELECT COUNT(*) FROM products").fetchone()[0])
    sold_out = _n(db.execute("SELECT COUNT(*) FROM products WHERE available = 0").fetchone()[0])
    live = total - sold_out
    pub_roasters = _n(db.execute(
        "SELECT COUNT(*) FROM roaster_profiles WHERE published = 1").fetchone()[0])
    total_roasters = _n(db.execute("SELECT COUNT(*) FROM roaster_profiles").fetchone()[0])

    img_pct = _pct(db, "SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND image_url != ''", total)
    price_pct = _pct(db, "SELECT COUNT(*) FROM products WHERE price_inr IS NOT NULL AND price_inr > 0", total)
    origin_pct = _pct(db, "SELECT COUNT(*) FROM products WHERE origin IS NOT NULL AND origin != ''", total)
    notes_pct = _pct(db, "SELECT COUNT(*) FROM products WHERE (tasting_notes IS NOT NULL AND tasting_notes != '') OR (flavor_notes IS NOT NULL AND flavor_notes != '')", total)

    complete_c = _n(db.execute("""
        SELECT COUNT(*) FROM products
        WHERE image_url IS NOT NULL AND image_url != ''
          AND price_inr IS NOT NULL AND price_inr > 0
          AND ((origin IS NOT NULL AND origin != '')
               OR (tasting_notes IS NOT NULL AND tasting_notes != ''))
    """).fetchone()[0])
    complete_pct = round(complete_c / total * 100.0, 1) if total else 0.0

    stale_30 = _n(db.execute(
        "SELECT COUNT(*) FROM products WHERE enriched_at IS NULL OR enriched_at < ?",
        (_days_ago(30),)).fetchone()[0])
    stale_14 = _n(db.execute(
        "SELECT COUNT(*) FROM products WHERE enriched_at IS NULL OR enriched_at < ?",
        (_days_ago(14),)).fetchone()[0])

    avg_per_roaster = round(total / pub_roasters, 1) if pub_roasters else 0.0

    daily_new = _daily_series(db, 90, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM products WHERE DATE(created_at) >= DATE('now', '-89 days')
        GROUP BY date ORDER BY date
    """)

    return {
        "cards": [
            {"key": "live_beans", "label": "Live beans", "value": live,
             "hint": f"{sold_out} sold out"},
            {"key": "total_beans", "label": "Total beans", "value": total,
             "series_key": "daily_new_beans"},
            {"key": "published_roasters", "label": "Published roasters",
             "value": pub_roasters, "hint": f"of {total_roasters} total"},
            {"key": "avg_beans_per_roaster", "label": "Avg beans / roaster",
             "value": avg_per_roaster},
            {"key": "complete_pct", "label": "Complete listings",
             "value": complete_pct, "suffix": "%", "hint": f"{complete_c} beans"},
            {"key": "stale_30d", "label": "Stale (30d+)", "value": stale_30,
             "hint": f"{stale_14} at 14d+"},
        ],
        "tables": [
            {"title": "Data completeness", "value_header": "Coverage",
             "rows": [
                 {"label": "Image", "value": f"{img_pct}%"},
                 {"label": "Price", "value": f"{price_pct}%"},
                 {"label": "Origin", "value": f"{origin_pct}%"},
                 {"label": "Tasting notes", "value": f"{notes_pct}%"},
             ]},
        ],
        "series": {"daily_new_beans": daily_new},
    }


# ── Demand ───────────────────────────────────────────────────────────────────

def _demand(db) -> dict:
    total_saves = _n(db.execute("SELECT COUNT(*) FROM shelf_entries").fetchone()[0])
    total_clicks = _n(db.execute("SELECT COUNT(*) FROM click_events").fetchone()[0])

    saves_wow = _wow(db, """
        SELECT
          SUM(CASE WHEN added_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN added_at >= datetime('now', '-14 days')
                   AND added_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM shelf_entries
    """)
    clicks_wow = _wow(db, """
        SELECT
          SUM(CASE WHEN clicked_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN clicked_at >= datetime('now', '-14 days')
                   AND clicked_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM click_events
    """)

    total_users = _n(db.execute(
        "SELECT COUNT(*) FROM users WHERE account_type = 'user'").fetchone()[0])
    savers = _n(db.execute(
        "SELECT COUNT(DISTINCT user_id) FROM shelf_entries").fetchone()[0])
    clickers = _n(db.execute(
        "SELECT COUNT(DISTINCT user_id) FROM click_events WHERE user_id IS NOT NULL").fetchone()[0])

    top_saved = db.execute("""
        SELECT p.coffee_name, p.roaster_name, COUNT(*) AS c
        FROM shelf_entries s JOIN products p ON p.product_id = s.product_id
        GROUP BY s.product_id ORDER BY c DESC LIMIT 10
    """).fetchall()
    top_clicked = db.execute("""
        SELECT p.coffee_name, p.roaster_name, COUNT(*) AS c
        FROM click_events ce JOIN products p ON p.product_id = ce.product_id
        GROUP BY ce.product_id ORDER BY c DESC LIMIT 10
    """).fetchall()
    by_source = db.execute("""
        SELECT COALESCE(source_page, 'unknown') AS sp, COUNT(*) AS c
        FROM click_events GROUP BY sp ORDER BY c DESC
    """).fetchall()

    daily_saves = _daily_series(db, 30, """
        SELECT DATE(added_at) AS date, COUNT(*) AS count
        FROM shelf_entries WHERE DATE(added_at) >= DATE('now', '-29 days')
        GROUP BY date ORDER BY date
    """)
    daily_clicks = _daily_series(db, 30, """
        SELECT DATE(clicked_at) AS date, COUNT(*) AS count
        FROM click_events WHERE DATE(clicked_at) >= DATE('now', '-29 days')
        GROUP BY date ORDER BY date
    """)

    return {
        "cards": [
            {"key": "total_saves", "label": "Shelf saves", "value": total_saves,
             "delta_pct": saves_wow["delta_pct"],
             "hint": f"+{saves_wow['value']} this week" if saves_wow["value"] else None,
             "series_key": "daily_saves"},
            {"key": "total_clicks", "label": "Buy clicks", "value": total_clicks,
             "delta_pct": clicks_wow["delta_pct"],
             "hint": f"+{clicks_wow['value']} this week" if clicks_wow["value"] else None,
             "series_key": "daily_clicks"},
            {"key": "savers", "label": "Savers", "value": savers,
             "hint": f"of {total_users} users"},
            {"key": "clickers", "label": "Buy-clickers", "value": clickers,
             "hint": f"of {total_users} users"},
        ],
        "tables": [
            {"title": "Most-saved beans", "value_header": "Saves",
             "rows": [{"label": r["coffee_name"], "sub": r["roaster_name"], "value": _n(r["c"])} for r in top_saved]},
            {"title": "Most-clicked beans", "value_header": "Clicks",
             "rows": [{"label": r["coffee_name"], "sub": r["roaster_name"], "value": _n(r["c"])} for r in top_clicked]},
            {"title": "Buy clicks by page", "value_header": "Clicks",
             "rows": [{"label": r["sp"], "value": _n(r["c"])} for r in by_source]},
        ],
        "series": {"daily_saves": daily_saves, "daily_clicks": daily_clicks},
    }


# ── Roasters / matching ──────────────────────────────────────────────────────

_ROASTER_DEMAND_SQL = """
    SELECT rp.roaster_slug, rp.name, rp.city,
      (SELECT COUNT(*) FROM shelf_entries s JOIN products p ON p.product_id = s.product_id
         WHERE p.roaster_slug = rp.roaster_slug) AS saves,
      (SELECT COUNT(*) FROM click_events ce WHERE ce.roaster_slug = rp.roaster_slug) AS clicks
    FROM roaster_profiles rp WHERE rp.published = 1
"""


def _roasters(db) -> dict:
    rows = db.execute(_ROASTER_DEMAND_SQL).fetchall()
    enriched = [
        {"slug": r["roaster_slug"], "name": r["name"] or r["roaster_slug"],
         "city": r["city"] or "—", "saves": _n(r["saves"]), "clicks": _n(r["clicks"])}
        for r in rows
    ]
    pub = len(enriched)
    cold = [r for r in enriched if r["saves"] == 0 and r["clicks"] == 0]
    ranked = sorted(enriched, key=lambda r: (r["saves"] + r["clicks"]), reverse=True)[:12]

    return {
        "cards": [
            {"key": "published_roasters", "label": "Published roasters", "value": pub},
            {"key": "roasters_with_demand", "label": "With demand",
             "value": pub - len(cold), "hint": "≥1 save or click"},
            {"key": "cold_roasters", "label": "Cold (no demand)",
             "value": len(cold), "hint": "promotion / SEO targets"},
        ],
        "tables": [
            {"title": "Top roasters by demand", "value_header": "Demand",
             "rows": [{"label": r["name"],
                       "sub": f'{r["city"]} · {r["saves"]} saves · {r["clicks"]} clicks',
                       "value": r["saves"] + r["clicks"]} for r in ranked]},
            {"title": "Cold roasters — no saves or clicks yet", "value_header": "",
             "rows": [{"label": r["name"], "sub": r["city"], "value": ""} for r in cold[:20]]},
        ],
        "series": {},
    }


# ── Audience / growth ────────────────────────────────────────────────────────

def _audience(db) -> dict:
    total_users = _n(db.execute(
        "SELECT COUNT(*) FROM users WHERE account_type = 'user'").fetchone()[0])
    new_7 = _n(db.execute(
        "SELECT COUNT(*) FROM users WHERE account_type = 'user' AND created_at >= ?",
        (_days_ago(7),)).fetchone()[0])
    new_30 = _n(db.execute(
        "SELECT COUNT(*) FROM users WHERE account_type = 'user' AND created_at >= ?",
        (_days_ago(30),)).fetchone()[0])

    def _active(days: int) -> int:
        since = _days_ago(days)
        return _n(db.execute("""
            SELECT COUNT(*) FROM (
                SELECT user_id FROM shelf_entries WHERE added_at > ?
                UNION
                SELECT user_id FROM click_events WHERE clicked_at > ? AND user_id IS NOT NULL
            )
        """, (since, since)).fetchone()[0])

    dau, wau, mau = _active(1), _active(7), _active(30)

    # Returning = users active on 2+ distinct days (shelf save or Buy click)
    returning = _n(db.execute("""
        SELECT COUNT(*) FROM (
            SELECT user_id FROM (
                SELECT user_id, DATE(added_at) AS d FROM shelf_entries
                UNION SELECT user_id, DATE(clicked_at) FROM click_events WHERE user_id IS NOT NULL
            ) GROUP BY user_id HAVING COUNT(DISTINCT d) >= 2
        )
    """).fetchone()[0])

    daily_signups = _daily_series(db, 90, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM users WHERE account_type = 'user'
          AND DATE(created_at) >= DATE('now', '-89 days')
        GROUP BY date ORDER BY date
    """)
    daily_active = _daily_series(db, 30, """
        SELECT date, COUNT(DISTINCT user_id) AS count FROM (
            SELECT DATE(added_at) AS date, user_id FROM shelf_entries
              WHERE DATE(added_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(clicked_at), user_id FROM click_events
              WHERE DATE(clicked_at) >= DATE('now', '-29 days') AND user_id IS NOT NULL
        ) GROUP BY date ORDER BY date
    """)

    articles_pub = _n(db.execute(
        "SELECT COUNT(*) FROM roaster_articles WHERE published = 1").fetchone()[0])
    likes = _n(db.execute("SELECT COUNT(*) FROM article_likes").fetchone()[0])
    comments = _n(db.execute("SELECT COUNT(*) FROM article_comments").fetchone()[0])

    return {
        "cards": [
            {"key": "total_users", "label": "Total users", "value": total_users,
             "series_key": "daily_signups"},
            {"key": "new_users_7d", "label": "New users (7d)", "value": new_7,
             "hint": f"{new_30} in 30d"},
            {"key": "dau", "label": "DAU", "value": dau,
             "hint": "saves + Buy clicks", "series_key": "daily_active"},
            {"key": "wau", "label": "WAU", "value": wau},
            {"key": "mau", "label": "MAU", "value": mau},
            {"key": "returning", "label": "Returning users", "value": returning,
             "hint": "active on 2+ days"},
        ],
        "tables": [
            {"title": "Journal engagement", "value_header": "",
             "rows": [
                 {"label": "Published articles", "value": articles_pub},
                 {"label": "Likes", "value": likes},
                 {"label": "Comments", "value": comments},
             ]},
        ],
        "series": {"daily_signups": daily_signups, "daily_active": daily_active},
    }


# ── Named-series dispatcher (drill-down charts) ───────────────────────────────

# Each key maps to SQL returning (date, count). Mirrors the `series_key`
# values the cards above carry, so the frontend can fetch a card's daily
# history without a separate mapping table.
_SERIES_DEFS: dict[str, str] = {
    "daily_new_beans": (
        "SELECT DATE(created_at) AS date, COUNT(*) AS count "
        "FROM products WHERE created_at IS NOT NULL GROUP BY DATE(created_at)"
    ),
    "daily_saves": (
        "SELECT DATE(added_at) AS date, COUNT(*) AS count "
        "FROM shelf_entries GROUP BY DATE(added_at)"
    ),
    "daily_clicks": (
        "SELECT DATE(clicked_at) AS date, COUNT(*) AS count "
        "FROM click_events GROUP BY DATE(clicked_at)"
    ),
    "daily_signups": (
        "SELECT DATE(created_at) AS date, COUNT(*) AS count "
        "FROM users WHERE account_type = 'user' AND created_at IS NOT NULL "
        "GROUP BY DATE(created_at)"
    ),
    "daily_active": (
        "SELECT DATE(t) AS date, COUNT(DISTINCT user_id) AS count FROM ("
        "  SELECT user_id, added_at AS t FROM shelf_entries "
        "  UNION ALL SELECT user_id, clicked_at AS t FROM click_events WHERE user_id IS NOT NULL "
        ") GROUP BY DATE(t)"
    ),
}


def build_series(db, key: str, days: int) -> list:
    """Daily series for a metric key, or [] for an unknown key (the
    frontend renders a 'no history yet' state on empty)."""
    sql = _SERIES_DEFS.get(key)
    if not sql:
        return []
    try:
        return _daily_series(db, days, sql)
    except Exception:
        return []


# ── Composer ─────────────────────────────────────────────────────────────────

def compute_traction(db) -> dict:
    """Full Site Analytics payload. Each section is independent — a failure
    in one is isolated so it can't blank the others."""
    sections: dict[str, Any] = {}
    for name, fn in (
        ("catalog", _catalog),
        ("demand", _demand),
        ("roasters", _roasters),
        ("audience", _audience),
    ):
        try:
            sections[name] = fn(db)
        except Exception as exc:
            sections[name] = {"error": str(exc), "cards": [], "tables": [], "series": {}}
    sections["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return sections
