"""
CRUD Utopia — composite read-only analytics. Lives here because the queries
span many tables and can't be expressed through the generic CRUD engine.
See CRUD_UTOPIA.md at repo root.

Admin traction metrics — six sections (engagement, commerce, loyalty,
network, retention, supply) computed in one pass and returned as a single
structured payload. The /api/stats/traction endpoint in routes/specific.py
gates access to the seeded "crema" admin account (is_admin=1).

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
    total_cafe_accounts = _n(
        db.execute(
            "SELECT COUNT(*) FROM users WHERE account_type = 'cafe'"
        ).fetchone()[0]
    )

    # Activity-based daily/weekly/monthly — a user is active if they've done
    # ANY of: tasting note, post, comment, like, shelf entry, or stamp.
    def _active_since(days: int) -> int:
        since = _days_ago(days)
        row = db.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT user_id FROM tasting_notes WHERE created_at > ?
                UNION
                SELECT user_id FROM roaster_posts WHERE created_at > ?
                UNION
                SELECT user_id FROM post_comments WHERE created_at > ?
                UNION
                SELECT user_id FROM post_likes WHERE created_at > ?
                UNION
                SELECT user_id FROM shelf_entries WHERE added_at > ?
                UNION
                SELECT user_id FROM stamps WHERE scanned_at > ?
            )
            """,
            (since, since, since, since, since, since),
        ).fetchone()
        return _n(row[0])

    dau = _active_since(1)
    wau = _active_since(7)
    mau = _active_since(30)

    # % of users with ≥1 tasting note
    writers = _n(
        db.execute(
            "SELECT COUNT(DISTINCT user_id) FROM tasting_notes"
        ).fetchone()[0]
    )
    writer_pct = round((writers / total_users * 100.0), 1) if total_users else 0.0

    # Tasting notes per active user — mean / median
    per_user = db.execute(
        """
        SELECT user_id, COUNT(*) AS c
        FROM tasting_notes
        GROUP BY user_id
        ORDER BY c
        """
    ).fetchall()
    counts = [r["c"] for r in per_user]
    mean_notes = round(sum(counts) / len(counts), 2) if counts else 0.0
    if counts:
        mid = len(counts) // 2
        median_notes = (
            counts[mid] if len(counts) % 2 else (counts[mid - 1] + counts[mid]) / 2
        )
    else:
        median_notes = 0

    # Posts per active user per week (last 30d)
    since_30 = _days_ago(30)
    posts_30 = _n(
        db.execute(
            "SELECT COUNT(*) FROM roaster_posts WHERE created_at > ?",
            (since_30,),
        ).fetchone()[0]
    )
    posters_30 = _n(
        db.execute(
            "SELECT COUNT(DISTINCT user_id) FROM roaster_posts WHERE created_at > ?",
            (since_30,),
        ).fetchone()[0]
    )
    # Convert 30-day volume → weekly average per active poster
    posts_per_active_user_per_week = (
        round(posts_30 / posters_30 / (30 / 7), 2) if posters_30 else 0.0
    )

    # Comments per post
    total_posts = _n(
        db.execute("SELECT COUNT(*) FROM roaster_posts").fetchone()[0]
    )
    total_comments = _n(
        db.execute("SELECT COUNT(*) FROM post_comments").fetchone()[0]
    )
    comments_per_post = (
        round(total_comments / total_posts, 2) if total_posts else 0.0
    )

    # Like distribution — posts bucketed by like count
    # 0, 1-5, 6-20, 21+
    like_dist_rows = db.execute(
        """
        SELECT CASE
            WHEN lc = 0 THEN '0'
            WHEN lc BETWEEN 1 AND 5 THEN '1-5'
            WHEN lc BETWEEN 6 AND 20 THEN '6-20'
            ELSE '21+'
        END AS bucket,
        COUNT(*) AS n
        FROM (
            SELECT p.id, COALESCE(l.c, 0) AS lc
            FROM roaster_posts p
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS c FROM post_likes GROUP BY post_id
            ) l ON l.post_id = p.id
        )
        GROUP BY bucket
        """
    ).fetchall()
    like_distribution = {r["bucket"]: _n(r["n"]) for r in like_dist_rows}
    for k in ("0", "1-5", "6-20", "21+"):
        like_distribution.setdefault(k, 0)

    # Reposts (repost_of_id not null) + repost rate
    reposts = _n(
        db.execute(
            "SELECT COUNT(*) FROM roaster_posts WHERE repost_of_id IS NOT NULL"
        ).fetchone()[0]
    )
    repost_rate = (
        round(reposts / total_posts * 100.0, 1) if total_posts else 0.0
    )

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
            SELECT DATE(created_at) AS date, user_id FROM tasting_notes
              WHERE DATE(created_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(created_at), user_id FROM roaster_posts
              WHERE DATE(created_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(created_at), user_id FROM post_comments
              WHERE DATE(created_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(created_at), user_id FROM post_likes
              WHERE DATE(created_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(added_at), user_id FROM shelf_entries
              WHERE DATE(added_at) >= DATE('now', '-29 days')
            UNION SELECT DATE(scanned_at), user_id FROM stamps
              WHERE DATE(scanned_at) >= DATE('now', '-29 days')
        ) GROUP BY date ORDER BY date
        """,
    )
    daily_posts = _daily_series(
        db,
        30,
        """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM roaster_posts
        WHERE DATE(created_at) >= DATE('now', '-29 days')
        GROUP BY date ORDER BY date
        """,
    )

    return {
        "total_users": total_users,
        "total_roasters": total_roasters,
        "total_cafe_accounts": total_cafe_accounts,
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
    users_rated = _n(
        db.execute("SELECT COUNT(DISTINCT user_id) FROM tasting_notes").fetchone()[0]
    )

    # Full funnel: users who clicked AND shelved AND rated the SAME product
    full_funnel = _n(
        db.execute(
            """
            SELECT COUNT(DISTINCT c.user_id)
            FROM click_events c
            JOIN shelf_entries s ON s.user_id = c.user_id AND s.product_id = c.product_id
            JOIN tasting_notes t ON t.user_id = c.user_id AND t.product_id = c.product_id
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


# ── Loyalty ──────────────────────────────────────────────────────────────────

def _loyalty(db) -> dict:
    total_stamps = _n(db.execute("SELECT COUNT(*) FROM stamps").fetchone()[0])
    stamps_7 = _n(
        db.execute(
            "SELECT COUNT(*) FROM stamps WHERE scanned_at > ?", (_days_ago(7),)
        ).fetchone()[0]
    )
    stamps_30 = _n(
        db.execute(
            "SELECT COUNT(*) FROM stamps WHERE scanned_at > ?", (_days_ago(30),)
        ).fetchone()[0]
    )
    stamps_90 = _n(
        db.execute(
            "SELECT COUNT(*) FROM stamps WHERE scanned_at > ?", (_days_ago(90),)
        ).fetchone()[0]
    )

    unique_stamped = _n(
        db.execute("SELECT COUNT(DISTINCT user_id) FROM stamps").fetchone()[0]
    )
    avg_stamps_per_user = (
        round(total_stamps / unique_stamped, 2) if unique_stamped else 0.0
    )

    # Average days between consecutive stamps at the same café
    # Use SQLite's julianday() for stable diff — window functions available SQLite 3.25+
    avg_interval_rows = db.execute(
        """
        SELECT AVG(julianday(scanned_at) - julianday(prev_at)) AS avg_days
        FROM (
            SELECT user_id, cafe_slug, scanned_at,
                LAG(scanned_at) OVER (
                    PARTITION BY user_id, cafe_slug ORDER BY scanned_at
                ) AS prev_at
            FROM stamps
        )
        WHERE prev_at IS NOT NULL
        """
    ).fetchone()
    avg_interval_days = round(_f(avg_interval_rows[0]), 2)

    # Users with 3+ stamps at any single café
    loyal_rows = db.execute(
        """
        SELECT COUNT(DISTINCT user_id) FROM (
            SELECT user_id, cafe_slug, COUNT(*) AS c
            FROM stamps GROUP BY user_id, cafe_slug HAVING c >= 3
        )
        """
    ).fetchone()
    loyal_cohort = _n(loyal_rows[0])

    # Rewards redeemed
    rewards_total = _n(
        db.execute("SELECT COUNT(*) FROM stamp_rewards").fetchone()[0]
    )
    # Reward conversion: users who EVER reached target vs users who stamped at all
    # Sum per user-café >= target
    reached_target = _n(
        db.execute(
            """
            SELECT COUNT(DISTINCT user_id) FROM (
                SELECT s.user_id, s.cafe_slug, COUNT(*) AS n, cp.stamp_target
                FROM stamps s JOIN cafe_profiles cp ON cp.cafe_slug = s.cafe_slug
                GROUP BY s.user_id, s.cafe_slug, cp.stamp_target
                HAVING n >= cp.stamp_target
            )
            """
        ).fetchone()[0]
    )
    reward_conversion_pct = (
        round(reached_target / unique_stamped * 100.0, 1)
        if unique_stamped
        else 0.0
    )

    # Top cafés by stamp volume
    top_rows = db.execute(
        """
        SELECT s.cafe_slug, cp.name, cp.city, COUNT(*) AS n
        FROM stamps s LEFT JOIN cafe_profiles cp ON cp.cafe_slug = s.cafe_slug
        GROUP BY s.cafe_slug
        ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    top_cafes = [
        {
            "cafe_slug": r["cafe_slug"],
            "name": r["name"] or r["cafe_slug"],
            "city": r["city"],
            "stamps": _n(r["n"]),
        }
        for r in top_rows
    ]

    daily_stamps = _daily_series(
        db,
        90,
        """
        SELECT DATE(scanned_at) AS date, COUNT(*) AS count
        FROM stamps
        WHERE DATE(scanned_at) >= DATE('now', '-89 days')
        GROUP BY date ORDER BY date
        """,
    )

    return {
        "total_stamps": total_stamps,
        "stamps_7d": stamps_7,
        "stamps_30d": stamps_30,
        "stamps_90d": stamps_90,
        "unique_stamped_users": unique_stamped,
        "avg_stamps_per_user": avg_stamps_per_user,
        "avg_days_between_stamps": avg_interval_days,
        "loyal_cohort_3_plus": loyal_cohort,
        "rewards_redeemed": rewards_total,
        "reward_conversion_pct": reward_conversion_pct,
        "top_cafes": top_cafes,
        "daily_stamps": daily_stamps,
    }


# ── Network ──────────────────────────────────────────────────────────────────

def _network(db) -> dict:
    total_follows = _n(db.execute("SELECT COUNT(*) FROM follows").fetchone()[0])
    unique_followers = _n(
        db.execute("SELECT COUNT(DISTINCT follower_user_id) FROM follows").fetchone()[0]
    )
    avg_follows_per_user = (
        round(total_follows / unique_followers, 2) if unique_followers else 0.0
    )

    # Top-followed roasters (slug doesn't start with user_ and target_type roaster-ish)
    top_roaster_rows = db.execute(
        """
        SELECT f.roaster_slug, COUNT(*) AS n,
            rp.name, rp.city
        FROM follows f
        LEFT JOIN roaster_profiles rp ON rp.roaster_slug = f.roaster_slug
        WHERE f.roaster_slug NOT LIKE 'user_%' AND f.roaster_slug NOT LIKE 'cafe_%'
        GROUP BY f.roaster_slug ORDER BY n DESC LIMIT 10
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

    # Top-followed cafés (explicit target_type=cafe OR slug prefix)
    top_cafe_rows = db.execute(
        """
        SELECT f.roaster_slug AS slug, COUNT(*) AS n,
            cp.name, cp.city
        FROM follows f
        LEFT JOIN cafe_profiles cp
            ON cp.cafe_slug = f.roaster_slug OR 'cafe_' || cp.cafe_slug = f.roaster_slug
        WHERE f.target_type = 'cafe' OR f.roaster_slug LIKE 'cafe_%'
        GROUP BY f.roaster_slug ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    top_cafes = [
        {
            "slug": r["slug"],
            "name": r["name"] or r["slug"],
            "city": r["city"],
            "followers": _n(r["n"]),
        }
        for r in top_cafe_rows
    ]

    # Reciprocal follows — user A follows user_B AND user B follows user_A
    reciprocal_rows = db.execute(
        """
        SELECT COUNT(*) FROM follows f1
        JOIN follows f2
          ON f2.follower_user_id = CAST(SUBSTR(f1.roaster_slug, 6) AS INTEGER)
         AND f1.follower_user_id = CAST(SUBSTR(f2.roaster_slug, 6) AS INTEGER)
        WHERE f1.roaster_slug LIKE 'user_%' AND f2.roaster_slug LIKE 'user_%'
        """
    ).fetchone()
    reciprocal_edges = _n(reciprocal_rows[0])
    reciprocal_pairs = reciprocal_edges // 2

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
        "top_cafes": top_cafes,
        "reciprocal_pairs": reciprocal_pairs,
        "shared_shelf_pairs_3_plus": shared_shelf_pairs,
    }


# ── Retention ────────────────────────────────────────────────────────────────

def _retention(db) -> dict:
    """
    Weekly signup cohorts with D1/D7/D30 retention. Activity = any of:
    tasting_note, post, comment, like, shelf_entry, or stamp.
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
            # Compute per-user window edges once in SQL for safety
            # Activity comes from any of the 6 tables.
            query = f"""
                SELECT COUNT(DISTINCT u.id) FROM users u WHERE u.id IN ({placeholders}) AND (
                    EXISTS (SELECT 1 FROM tasting_notes t WHERE t.user_id = u.id
                        AND t.created_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                             AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM roaster_posts p WHERE p.user_id = u.id
                        AND p.created_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                             AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM post_comments c WHERE c.user_id = u.id
                        AND c.created_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                             AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM post_likes pl WHERE pl.user_id = u.id
                        AND pl.created_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                             AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM shelf_entries s WHERE s.user_id = u.id
                        AND s.added_at BETWEEN datetime(u.created_at, '+{start_offset} days')
                                           AND datetime(u.created_at, '+{end_offset} days'))
                    OR EXISTS (SELECT 1 FROM stamps st WHERE st.user_id = u.id
                        AND st.scanned_at BETWEEN datetime(u.created_at, '+{start_offset} days')
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

    # Writer retention — users with ≥1 tasting note, then active post-first-note
    writer_cohort_rows = db.execute(
        "SELECT COUNT(DISTINCT user_id) FROM tasting_notes"
    ).fetchone()
    writer_total = _n(writer_cohort_rows[0])
    writer_returned_30 = _n(
        db.execute(
            """
            SELECT COUNT(DISTINCT t.user_id) FROM tasting_notes t
            WHERE EXISTS (
                SELECT 1 FROM tasting_notes t2
                WHERE t2.user_id = t.user_id AND t2.id <> t.id
                AND julianday(t2.created_at) - julianday(t.created_at) BETWEEN 0 AND 30
            )
            """
        ).fetchone()[0]
    )
    writer_retention_pct = (
        round(writer_returned_30 / writer_total * 100.0, 1)
        if writer_total
        else 0.0
    )

    # Stamp-cohort retention — days between first and second stamp (any café)
    stamp_gap_rows = db.execute(
        """
        SELECT AVG(gap) FROM (
            SELECT julianday(s2.scanned_at) - julianday(s1.scanned_at) AS gap
            FROM (
                SELECT user_id, cafe_slug, MIN(scanned_at) AS scanned_at
                FROM stamps GROUP BY user_id, cafe_slug
            ) s1
            JOIN stamps s2 ON s2.user_id = s1.user_id AND s2.cafe_slug = s1.cafe_slug
                AND s2.scanned_at > s1.scanned_at
            GROUP BY s1.user_id, s1.cafe_slug
            HAVING MIN(s2.scanned_at) = s2.scanned_at
        )
        """
    ).fetchone()
    avg_first_to_second_stamp_days = round(_f(stamp_gap_rows[0]), 2)

    return {
        "cohorts": cohorts,
        "writer_retention_30d_pct": writer_retention_pct,
        "writers_total": writer_total,
        "avg_first_to_second_stamp_days": avg_first_to_second_stamp_days,
    }


# ── Supply / Ecosystem ───────────────────────────────────────────────────────

def _supply(db) -> dict:
    roasters_total = _n(
        db.execute(
            "SELECT COUNT(DISTINCT roaster_slug) FROM roaster_profiles"
        ).fetchone()[0]
    )
    roasters_from_products = _n(
        db.execute(
            "SELECT COUNT(DISTINCT roaster_slug) FROM products WHERE available = 1"
        ).fetchone()[0]
    )
    # Union across the two (profiles + scraped/available)
    roasters_known = _n(
        db.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT roaster_slug FROM roaster_profiles
                UNION SELECT roaster_slug FROM products WHERE available = 1
            )
            """
        ).fetchone()[0]
    )
    roasters_with_posts = _n(
        db.execute(
            "SELECT COUNT(DISTINCT roaster_slug) FROM roaster_posts WHERE roaster_slug NOT LIKE 'user_%' AND roaster_slug NOT LIKE 'cafe_%'"
        ).fetchone()[0]
    )
    roasters_with_followers = _n(
        db.execute(
            "SELECT COUNT(DISTINCT roaster_slug) FROM follows WHERE roaster_slug NOT LIKE 'user_%' AND roaster_slug NOT LIKE 'cafe_%'"
        ).fetchone()[0]
    )

    products_total = _n(
        db.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    )
    products_available = _n(
        db.execute("SELECT COUNT(*) FROM products WHERE available = 1").fetchone()[0]
    )
    products_with_shelf = _n(
        db.execute(
            "SELECT COUNT(DISTINCT product_id) FROM shelf_entries"
        ).fetchone()[0]
    )
    products_with_note = _n(
        db.execute(
            "SELECT COUNT(DISTINCT product_id) FROM tasting_notes"
        ).fetchone()[0]
    )

    cafes_total = _n(
        db.execute("SELECT COUNT(*) FROM cafe_profiles").fetchone()[0]
    )
    cafes_stamps_enabled = _n(
        db.execute(
            "SELECT COUNT(*) FROM cafe_profiles WHERE stamps_enabled = 1"
        ).fetchone()[0]
    )
    cafes_with_stamps = _n(
        db.execute(
            "SELECT COUNT(DISTINCT cafe_slug) FROM stamps"
        ).fetchone()[0]
    )

    # Average menu items per café
    menu_rows = db.execute(
        "SELECT cafe_slug, COUNT(*) AS n FROM cafe_menu_items GROUP BY cafe_slug"
    ).fetchall()
    avg_menu_items = (
        round(sum(_n(r["n"]) for r in menu_rows) / cafes_total, 2)
        if cafes_total
        else 0.0
    )

    # Cafés sourcing from roasters in our catalog (non-null roaster_slug)
    cafes_using_catalog = _n(
        db.execute(
            "SELECT COUNT(DISTINCT cafe_slug) FROM cafe_menu_items WHERE roaster_slug IS NOT NULL AND roaster_slug != ''"
        ).fetchone()[0]
    )
    ecosystem_density_pct = (
        round(cafes_using_catalog / cafes_total * 100.0, 1)
        if cafes_total
        else 0.0
    )

    # Wholesale inquiries (Phase 1 §2.1) — the flagship Phase 1 B2B
    # metric. Counts how many cafés have reached out to roasters and how
    # those inquiries are being handled. Response rate = responded or
    # archived / total; a healthy ecosystem keeps inquiries moving.
    inquiries_total = _n(
        db.execute("SELECT COUNT(*) FROM wholesale_inquiries").fetchone()[0]
    )
    since_30 = _days_ago(30)
    inquiries_30d = _n(
        db.execute(
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE created_at > ?",
            (since_30,),
        ).fetchone()[0]
    )
    inquiries_open = _n(
        db.execute(
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE status = 'open'"
        ).fetchone()[0]
    )
    inquiries_responded = _n(
        db.execute(
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE status = 'responded'"
        ).fetchone()[0]
    )
    inquiries_archived = _n(
        db.execute(
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE status = 'archived'"
        ).fetchone()[0]
    )
    cafes_inquiring = _n(
        db.execute(
            "SELECT COUNT(DISTINCT cafe_slug) FROM wholesale_inquiries"
        ).fetchone()[0]
    )
    roasters_receiving = _n(
        db.execute(
            "SELECT COUNT(DISTINCT roaster_slug) FROM wholesale_inquiries"
        ).fetchone()[0]
    )
    inquiry_response_rate_pct = (
        round(
            (inquiries_responded + inquiries_archived)
            / inquiries_total * 100.0,
            1,
        )
        if inquiries_total
        else 0.0
    )

    # Business-stream notification volume (Phase 1 §2.4) — counts all
    # catalog-change / wholesale / stamp notifications fired in the last
    # 30 days. The higher this number relative to activity notifications,
    # the more the ecosystem is behaving like a B2B tool rather than a
    # pure social feed. Note: excluded from users' Activity tab; surfaced
    # to roaster + café accounts under their Business tab.
    business_types = (
        "product_added", "product_removed",
        "menu_added", "menu_removed", "menu_updated",
        "wholesale_inquiry", "stamp_awarded",
    )
    since_30 = _days_ago(30)
    q_marks = ",".join("?" * len(business_types))
    business_notifs_30d = _n(
        db.execute(
            f"SELECT COUNT(*) FROM notifications "
            f"WHERE type IN ({q_marks}) AND created_at > ?",
            (*business_types, since_30),
        ).fetchone()[0]
    )
    activity_notifs_30d = _n(
        db.execute(
            f"SELECT COUNT(*) FROM notifications "
            f"WHERE type NOT IN ({q_marks}) AND created_at > ?",
            (*business_types, since_30),
        ).fetchone()[0]
    )
    business_share_pct = (
        round(
            business_notifs_30d
            / (business_notifs_30d + activity_notifs_30d)
            * 100.0,
            1,
        )
        if (business_notifs_30d + activity_notifs_30d)
        else 0.0
    )

    # Procurement profile readiness (Phase 1 §2.6) — tracks how many café
    # owners have filled in at least one of the three procurement fields.
    # This is the leading indicator for §2.1 "Interested" inquiry conversion:
    # a café with no volume/note/openness signal is a poor lead for roasters.
    cafes_procurement_ready = _n(
        db.execute(
            """
            SELECT COUNT(*) FROM cafe_profiles
            WHERE monthly_volume_kg IS NOT NULL
               OR open_to_new_roasters = 1
               OR (procurement_note IS NOT NULL AND procurement_note != '')
            """
        ).fetchone()[0]
    )
    cafes_open_to_new = _n(
        db.execute(
            "SELECT COUNT(*) FROM cafe_profiles WHERE open_to_new_roasters = 1"
        ).fetchone()[0]
    )
    procurement_readiness_pct = (
        round(cafes_procurement_ready / cafes_total * 100.0, 1)
        if cafes_total
        else 0.0
    )

    return {
        "roasters_total": roasters_known,
        "roasters_with_profiles": roasters_total,
        "roasters_with_products": roasters_from_products,
        "roasters_with_posts": roasters_with_posts,
        "roasters_with_followers": roasters_with_followers,
        "products_total": products_total,
        "products_available": products_available,
        "products_with_shelf_entry": products_with_shelf,
        "products_with_tasting_note": products_with_note,
        "cafes_total": cafes_total,
        "cafes_stamps_enabled": cafes_stamps_enabled,
        "cafes_with_any_stamp": cafes_with_stamps,
        "avg_menu_items_per_cafe": avg_menu_items,
        "cafes_using_catalog_roasters": cafes_using_catalog,
        "ecosystem_density_pct": ecosystem_density_pct,
        "cafes_procurement_ready": cafes_procurement_ready,
        "cafes_open_to_new_roasters": cafes_open_to_new,
        "procurement_readiness_pct": procurement_readiness_pct,
        "business_notifs_30d": business_notifs_30d,
        "activity_notifs_30d": activity_notifs_30d,
        "business_share_pct": business_share_pct,
        "inquiries_total": inquiries_total,
        "inquiries_30d": inquiries_30d,
        "inquiries_open": inquiries_open,
        "inquiries_responded": inquiries_responded,
        "inquiries_archived": inquiries_archived,
        "inquiry_cafes_participating": cafes_inquiring,
        "inquiry_roasters_receiving": roasters_receiving,
        "inquiry_response_rate_pct": inquiry_response_rate_pct,
    }


# ── Composer ─────────────────────────────────────────────────────────────────

def compute_traction(db) -> dict:
    """Return the full traction payload. Each section is independent; failures
    in one shouldn't break the others, so each is wrapped to never raise."""
    sections: dict[str, Any] = {}
    for name, fn in (
        ("engagement", _engagement),
        ("commerce", _commerce),
        ("loyalty", _loyalty),
        ("network", _network),
        ("retention", _retention),
        ("supply", _supply),
    ):
        try:
            sections[name] = fn(db)
        except Exception as exc:
            sections[name] = {"error": str(exc)}
    sections["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return sections
