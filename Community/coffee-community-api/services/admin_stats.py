"""
CRUD Utopia — composite read-only analytics. Lives here because the queries
span many tables and can't be expressed through the generic CRUD engine.
See CRUD_UTOPIA.md at repo root.

Admin traction metrics — four sections (engagement, commerce, network,
retention) computed in one pass and returned as a single structured
payload. The /api/stats/traction endpoint in routes/specific.py gates
access to the seeded "crema" admin account (is_admin=1).

All queries target the live app DB. Every helper returns primitive JSON
(ints, floats, lists of dicts) — no ORM layer, no SQL constructed from
user input. Each section is a pure function (db) -> dict.
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
    fill in missing days with 0 so the chart has a continuous x-axis.

    The window is then trimmed so the returned series starts one day
    before the first non-zero datapoint (or at the requested window edge,
    whichever is later). This prevents charts from displaying a long
    stretch of pre-project zeros — if the project is a week old, a
    90-day chart shouldn't show 83 days of empty dates.

    `sql` must return rows shaped (date TEXT 'YYYY-MM-DD', count INTEGER).
    """
    rows = {r["date"]: _n(r["count"]) for r in db.execute(sql, params).fetchall()}
    series: list = []
    today = _dt.datetime.utcnow().date()
    for i in range(days - 1, -1, -1):
        d = (today - _dt.timedelta(days=i)).strftime("%Y-%m-%d")
        series.append({"date": d, "count": rows.get(d, 0)})

    # If the whole window is empty, return an empty series — the chart
    # renders a "no data yet" state, which is honest.
    if not any(pt["count"] > 0 for pt in series):
        return []

    # Otherwise, trim leading zero-days but keep one day of breathing room
    # before the first real value so the line doesn't start mid-spike.
    first_nonzero = next(i for i, pt in enumerate(series) if pt["count"] > 0)
    start = max(0, first_nonzero - 1)
    return series[start:]


# ── Engagement ───────────────────────────────────────────────────────────────

def _engagement(db) -> dict:
    total_users = _n(
        db.execute(
            "SELECT COUNT(*) FROM users WHERE account_type = 'user'"
        ).fetchone()[0]
    )
    total_roasters = _n(
        db.execute(
            "SELECT COUNT(*) FROM users WHERE account_type = 'roaster'"
        ).fetchone()[0]
    )

    # Activity-based daily/weekly/monthly — a user is active if they've done
    # ANY of: tasting note, post, comment, like, or shelf entry.
    def _active_since(days: int) -> int:
        since = _days_ago(days)
        row = db.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT user_id FROM shelf_entries WHERE added_at > ?
                UNION
                SELECT user_id FROM click_events
                  WHERE clicked_at > ? AND user_id IS NOT NULL
            )
            """,
            (since, since),
        ).fetchone()
        return _n(row[0])

    dau = _active_since(1)
    wau = _active_since(7)
    mau = _active_since(30)

    # Feed engagement (tasting notes, posts, comments, likes, reposts) was
    # retired in the catalog-only pivot — these are zeroed so the cards
    # render an empty state instead of crashing on the dropped tables.
    writers = 0
    writer_pct = 0.0
    mean_notes = 0.0
    median_notes = 0
    posts_per_active_user_per_week = 0.0
    total_posts = 0
    total_comments = 0
    comments_per_post = 0.0
    like_distribution = {"0": 0, "1-5": 0, "6-20": 0, "21+": 0}
    reposts = 0
    repost_rate = 0.0

    # Time series — signups per day (90d) and active users per day (30d).
    # Active = any action on that calendar day (UTC).
    daily_signups = _daily_series(
        db,
        90,
        """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM users WHERE account_type = 'user'
          AND DATE(created_at) >= DATE('now', '-89 days')
        GROUP BY date ORDER BY date
        """,
    )
    daily_active_users = _daily_series(
        db,
        30,
        """
        SELECT date, COUNT(DISTINCT user_id) AS count FROM (
            SELECT DATE(added_at) AS date, user_id FROM shelf_entries
              WHERE DATE(added_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(clicked_at), user_id FROM click_events
              WHERE DATE(clicked_at) >= DATE('now', '-29 days')
                AND user_id IS NOT NULL
        ) GROUP BY date ORDER BY date
        """,
    )
    daily_posts: list = []  # feed retired in the catalog-only pivot

    return {
        "total_users": total_users,
        "total_roasters": total_roasters,
        "dau": dau,
        "wau": wau,
        "mau": mau,
        "writers": writers,
        "writer_pct": writer_pct,
        "mean_notes_per_writer": mean_notes,
        "median_notes_per_writer": median_notes,
        "posts_per_active_user_per_week": posts_per_active_user_per_week,
        "total_posts": total_posts,
        "total_comments": total_comments,
        "comments_per_post": comments_per_post,
        "like_distribution": like_distribution,
        "total_reposts": reposts,
        "repost_rate_pct": repost_rate,
        "daily_signups": daily_signups,
        "daily_active_users": daily_active_users,
        "daily_posts": daily_posts,
    }


# ── Commerce ─────────────────────────────────────────────────────────────────

def _commerce(db) -> dict:
    total_clicks = _n(
        db.execute("SELECT COUNT(*) FROM click_events").fetchone()[0]
    )

    # Monthly trend — last 6 months (by YYYY-MM)
    # SQLite: substr(clicked_at, 1, 7) gives YYYY-MM
    since_180 = _days_ago(180)
    month_rows = db.execute(
        """
        SELECT substr(clicked_at, 1, 7) AS month, COUNT(*) AS n
        FROM click_events
        WHERE clicked_at > ?
        GROUP BY month
        ORDER BY month
        """,
        (since_180,),
    ).fetchall()
    monthly_clicks = [
        {"month": r["month"], "clicks": _n(r["n"])} for r in month_rows
    ]

    # Clicks by source_page
    source_rows = db.execute(
        """
        SELECT source_page, COUNT(*) AS n
        FROM click_events
        GROUP BY source_page
        ORDER BY n DESC
        """
    ).fetchall()
    clicks_by_source = [
        {"source_page": r["source_page"] or "unknown", "clicks": _n(r["n"])}
        for r in source_rows
    ]

    # Top-clicked products (top 20, joined to products for name)
    top_rows = db.execute(
        """
        SELECT c.product_id, c.roaster_slug, COUNT(*) AS n,
               p.coffee_name, p.roaster_name
        FROM click_events c
        LEFT JOIN products p ON p.product_id = c.product_id
        GROUP BY c.product_id
        ORDER BY n DESC
        LIMIT 20
        """
    ).fetchall()
    top_products = [
        {
            "product_id": r["product_id"],
            "roaster_slug": r["roaster_slug"],
            "coffee_name": r["coffee_name"],
            "roaster_name": r["roaster_name"],
            "clicks": _n(r["n"]),
        }
        for r in top_rows
    ]

    # Funnel — users who: clicked, shelved, rated
    users_clicked = _n(
        db.execute(
            "SELECT COUNT(DISTINCT user_id) FROM click_events WHERE user_id IS NOT NULL"
        ).fetchone()[0]
    )
    users_shelved = _n(
        db.execute("SELECT COUNT(DISTINCT user_id) FROM shelf_entries").fetchone()[0]
    )
    # "Rated" (tasting notes) retired with the tasting journal.
    users_rated = 0

    # Full funnel: users who clicked AND shelved the SAME product (the
    # rating leg is gone with the tasting journal).
    full_funnel = _n(
        db.execute(
            """
            SELECT COUNT(DISTINCT c.user_id)
            FROM click_events c
            JOIN shelf_entries s ON s.user_id = c.user_id AND s.product_id = c.product_id
            WHERE c.user_id IS NOT NULL
            """
        ).fetchone()[0]
    )

    daily_clicks = _daily_series(
        db,
        30,
        """
        SELECT DATE(clicked_at) AS date, COUNT(*) AS count
        FROM click_events
        WHERE DATE(clicked_at) >= DATE('now', '-29 days')
        GROUP BY date ORDER BY date
        """,
    )

    return {
        "total_clicks": total_clicks,
        "monthly_clicks": monthly_clicks,
        "daily_clicks": daily_clicks,
        "clicks_by_source": clicks_by_source,
        "top_products": top_products,
        "funnel": {
            "clicked": users_clicked,
            "shelved": users_shelved,
            "rated": users_rated,
            "full_funnel": full_funnel,
        },
    }


# ── Network ──────────────────────────────────────────────────────────────────

def _network(db) -> dict:
    # Follows retired in the catalog-only pivot — the network section now
    # runs on catalog signals (shelf overlap + roasters ranked by saves).
    total_follows = 0
    unique_followers = 0
    avg_follows_per_user = 0.0
    reciprocal_pairs = 0

    # Top roasters by shelf-saves of their products — the catalog signal
    # that replaces follower counts. (`followers` key retained for
    # frontend compat; the value is now shelf-saves.)
    top_roaster_rows = db.execute(
        """
        SELECT p.roaster_slug AS roaster_slug, COUNT(*) AS n,
            rp.name, rp.city
        FROM shelf_entries s
        JOIN products p ON p.product_id = s.product_id
        LEFT JOIN roaster_profiles rp ON rp.roaster_slug = p.roaster_slug
        WHERE p.roaster_slug IS NOT NULL
        GROUP BY p.roaster_slug ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    top_roasters = [
        {
            "slug": r["roaster_slug"],
            "name": r["name"] or r["roaster_slug"],
            "city": r["city"],
            "followers": _n(r["n"]),
        }
        for r in top_roaster_rows
    ]

    # Shelf-connection graph: pairs of users who share ≥3 products
    shared_shelf_pairs = _n(
        db.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT s1.user_id AS a, s2.user_id AS b, COUNT(*) AS shared
                FROM shelf_entries s1
                JOIN shelf_entries s2
                  ON s1.product_id = s2.product_id AND s1.user_id < s2.user_id
                GROUP BY s1.user_id, s2.user_id HAVING shared >= 3
            )
            """
        ).fetchone()[0]
    )

    return {
        "total_follows": total_follows,
        "unique_followers": unique_followers,
        "avg_follows_per_user": avg_follows_per_user,
        "top_roasters": top_roasters,
        "reciprocal_pairs": reciprocal_pairs,
        "shared_shelf_pairs_3_plus": shared_shelf_pairs,
    }


# ── Retention ────────────────────────────────────────────────────────────────

def _retention(db) -> dict:
    """
    Weekly signup cohorts with D1/D7/D30 retention. Activity = a shelf
    save or a Buy click (catalog signals; feed activity was retired).
    """
    cohorts: list[dict] = []

    # All user rows (up to 12 most-recent signup weeks for the cohort table)
    weeks = db.execute(
        """
        SELECT strftime('%Y-%W', created_at) AS wk, MIN(created_at) AS wk_start,
               COUNT(*) AS signups
        FROM users WHERE account_type = 'user'
        GROUP BY wk ORDER BY wk DESC LIMIT 12
        """
    ).fetchall()

    for w in weeks:
        wk = w["wk"]
        wk_start = w["wk_start"]
        # Collect user IDs in that cohort
        user_ids = [
            r[0]
            for r in db.execute(
                "SELECT id FROM users WHERE account_type = 'user' "
                "AND strftime('%Y-%W', created_at) = ?",
                (wk,),
            ).fetchall()
        ]
        signups = len(user_ids)

        def _active_in_window(start_offset: int, end_offset: int) -> int:
            """Users active within [start, end) days of cohort start."""
            if not user_ids:
                return 0
            placeholders = ",".join("?" * len(user_ids))
            params = list(user_ids)
            # Compute per-user window edges once in SQL for safety.
            # Activity = shelf saves + Buy clicks (catalog signals).
            query = f"""
                SELECT COUNT(DISTINCT u.id) FROM users u WHERE u.id IN ({placeholders}) AND (
                    EXISTS (SELECT 1 FROM shelf_entries s WHERE s.user_id = u.id
                        AND s.added_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                           AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM click_events ce WHERE ce.user_id = u.id
                        AND ce.clicked_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                              AND datetime(u.created_at, '+{end_offset} days'))
                )
            """
            return _n(db.execute(query, params).fetchone()[0])

        d1 = _active_in_window(0, 1)
        d7 = _active_in_window(0, 7)
        d30 = _active_in_window(0, 30)

        cohorts.append({
            "week": wk,
            "week_start": wk_start[:10] if wk_start else None,
            "signups": signups,
            "d1": d1,
            "d7": d7,
            "d30": d30,
            "d1_pct": round(d1 / signups * 100.0, 1) if signups else 0.0,
            "d7_pct": round(d7 / signups * 100.0, 1) if signups else 0.0,
            "d30_pct": round(d30 / signups * 100.0, 1) if signups else 0.0,
        })

    # Writer retention retired with the tasting journal.
    writer_total = 0
    writer_retention_pct = 0.0

    return {
        "cohorts": cohorts,
        "writer_retention_30d_pct": writer_retention_pct,
        "writers_total": writer_total,
    }


# ── Named-series dispatcher (§2.18 drill-down) ───────────────────────────────

# Each entry maps a metric key to a SQL snippet that returns (date, count)
# rows grouped by UTC day. `_daily_series` fills gaps with zero and trims
# the leading zero window. Keys mirror the identifiers returned by
# `compute_traction` so the frontend can route straight off a card's data
# key without an extra mapping table.
_SERIES_DEFS: dict[str, str] = {
    # ── Engagement ──────────────────────────────────────────────────
    "daily_signups": (
        "SELECT DATE(created_at) AS date, COUNT(*) AS count "
        "FROM users WHERE account_type = 'user' AND created_at IS NOT NULL "
        "GROUP BY DATE(created_at)"
    ),
    # DAU on catalog signals — shelf saves + Buy clicks (the feed
    # activity tables were retired in the catalog-only pivot).
    "dau": (
        "SELECT DATE(t) AS date, COUNT(DISTINCT user_id) AS count FROM ("
        "  SELECT user_id, added_at AS t FROM shelf_entries "
        "  UNION ALL SELECT user_id, clicked_at AS t FROM click_events "
        "    WHERE user_id IS NOT NULL "
        ") GROUP BY DATE(t)"
    ),
    "daily_shelf_saves": (
        "SELECT DATE(added_at) AS date, COUNT(*) AS count "
        "FROM shelf_entries GROUP BY DATE(added_at)"
    ),
    # ── Commerce ────────────────────────────────────────────────────
    "daily_clicks": (
        "SELECT DATE(clicked_at) AS date, COUNT(*) AS count "
        "FROM click_events GROUP BY DATE(clicked_at)"
    ),
    "total_clicks": (
        "SELECT DATE(clicked_at) AS date, COUNT(*) AS count "
        "FROM click_events GROUP BY DATE(clicked_at)"
    ),
    "brew_methods_total": (
        "SELECT DATE(created_at) AS date, COUNT(*) AS count "
        "FROM brew_methods GROUP BY DATE(created_at)"
    ),
}


def build_series(db, key: str, days: int) -> list:
    """Return a daily series for the given metric key, or an empty
    list if the key isn't known. The frontend renders an "Daily
    history not yet captured for this metric" state on empty."""
    sql = _SERIES_DEFS.get(key)
    if not sql:
        return []
    try:
        return _daily_series(db, days, sql)
    except Exception:
        return []


# ── Composer ─────────────────────────────────────────────────────────────────

def compute_traction(db) -> dict:
    """Return the full traction payload. Each section is independent; failures
    in one shouldn't break the others, so each is wrapped to never raise."""
    sections: dict[str, Any] = {}
    for name, fn in (
        ("engagement", _engagement),
        ("commerce", _commerce),
        ("network", _network),
        ("retention", _retention),
    ):
        try:
            sections[name] = fn(db)
        except Exception as exc:
            sections[name] = {"error": str(exc)}
    sections["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return sections
