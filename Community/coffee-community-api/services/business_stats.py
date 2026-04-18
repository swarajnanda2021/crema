"""
Per-business analytics — the lightweight counterpart to
`services/admin_stats.py`. Powers the Analytics sub-tab inside
roaster and café profiles. Not for site-admin dashboards.

Design constraint: **fast insight, not deep data**. Every section
returns exactly three metric cards + their per-card daily series.
Cards render as chart selectors in the frontend — tap a card, the
line chart above re-plots that metric. Keeps the surface small and
non-overwhelming for business users without analyst teams.

Hero questions (see NORTH_STAR.md §1):
- Roaster: "Am I finding buyers?"  → wholesale + audience
- Café:    "Is my loyalty program working?" → loyalty + menu mentions
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
    """30-day daily series. Thin wrapper over admin_stats._daily_series
    so section functions can stay short."""
    return _daily_series(db, 30, sql, params)


# ── Roaster dashboard ─────────────────────────────────────────────

def _roaster_wholesale(db, roaster_slug: str) -> Dict[str, Any]:
    """Wholesale subtab — three cards answering 'am I finding buyers'.

    1. Inquiries this week (vs prior week) — hero
    2. Open inquiries (current) — action item; click routes to
       Messages Business tab
    3. Top bean cafés have been asking about (30d)
    """
    # Card 1 — inquiries this week + delta vs prior week
    wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN created_at >= datetime('now', '-14 days')
                   AND created_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM wholesale_inquiries WHERE roaster_slug = ?
    """, (roaster_slug,))

    # Card 2 — open inquiries (snapshot, no time comparison)
    open_row = db.execute(
        "SELECT COUNT(*) AS c FROM wholesale_inquiries WHERE roaster_slug = ? AND status = 'open'",
        (roaster_slug,),
    ).fetchone()
    open_count = _n(open_row["c"]) if open_row else 0

    # Card 3 — top bean asked about in the last 30 days
    top = db.execute("""
        SELECT product_id, COUNT(*) AS c FROM wholesale_inquiries
        WHERE roaster_slug = ? AND product_id IS NOT NULL
          AND created_at >= datetime('now', '-30 days')
        GROUP BY product_id ORDER BY c DESC LIMIT 1
    """, (roaster_slug,)).fetchone()

    top_product_id = top["product_id"] if top else None
    top_count = _n(top["c"]) if top else 0
    top_name = None
    if top_product_id is not None:
        p = db.execute(
            "SELECT coffee_name FROM products WHERE product_id = ? LIMIT 1",
            (top_product_id,),
        ).fetchone()
        if p:
            top_name = p["coffee_name"]

    # Series for each card
    inquiries_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM wholesale_inquiries WHERE roaster_slug = ?
        GROUP BY DATE(created_at)
    """, (roaster_slug,))

    open_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM wholesale_inquiries
        WHERE roaster_slug = ? AND status = 'open'
        GROUP BY DATE(created_at)
    """, (roaster_slug,))

    top_series: List[Dict[str, Any]] = []
    if top_product_id is not None:
        top_series = _series_30d(db, """
            SELECT DATE(created_at) AS date, COUNT(*) AS count
            FROM wholesale_inquiries
            WHERE roaster_slug = ? AND product_id = ?
            GROUP BY DATE(created_at)
        """, (roaster_slug, top_product_id))

    return {
        "cards": [
            {
                "key": "inquiries_week",
                "label": "Inquiries this week",
                "value": wow["value"],
                "delta_pct": wow["delta_pct"],
                "info": "How many cafés asked about your beans in the last 7 days. If this number stays at zero, post a sourcing story — the best wholesale leads come from story-driven reach.",
                "charts": True,
            },
            {
                "key": "open_inquiries",
                "label": "Open inquiries",
                "value": open_count,
                "hint": "waiting for your reply" if open_count > 0 else "all caught up",
                "info": "Inquiries a café has sent you that you haven't replied to or archived yet. Aim to reply within 24h — cafés often ask multiple roasters in parallel.",
                "charts": True,
                "tone": "negative" if open_count > 0 else "positive",
            },
            {
                "key": "top_bean",
                "label": "Top bean asked about",
                "value": top_name or "\u2014",
                "hint": f"{top_count} inquiries · 30d" if top_count else None,
                "info": "The product cafés have asked about most in the last month. Consider highlighting it in your sourcing stories and pinning it to your profile.",
                "charts": bool(top_product_id),
            },
        ],
        "series": {
            "inquiries_week": inquiries_series,
            "open_inquiries": open_series,
            "top_bean": top_series,
        },
        "hero_key": "inquiries_week",
    }


def _roaster_audience(db, roaster_slug: str) -> Dict[str, Any]:
    """Audience subtab — three cards on reach.

    1. Followers (total, cumulative)
    2. Cafés following me (business-follower count — warm leads)
    3. Posts this month (volume of your megaphone)
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

    # Card 2 — café-account followers
    cafe_followers = _n(db.execute("""
        SELECT COUNT(*) AS c FROM follows f
        JOIN users u ON u.id = f.follower_user_id
        WHERE f.roaster_slug = ? AND u.account_type = 'cafe'
    """, (roaster_slug,)).fetchone()["c"])

    # Card 3 — posts published this month
    posts_month = _n(db.execute("""
        SELECT COUNT(*) AS c FROM roaster_posts
        WHERE roaster_slug = ? AND created_at >= datetime('now', '-30 days')
    """, (roaster_slug,)).fetchone()["c"])

    # Posts this week vs prior week for the delta
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

    cafe_followers_series = _series_30d(db, """
        SELECT DATE(f.created_at) AS date, COUNT(*) AS count
        FROM follows f
        JOIN users u ON u.id = f.follower_user_id
        WHERE f.roaster_slug = ? AND u.account_type = 'cafe'
        GROUP BY DATE(f.created_at)
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
                "key": "cafe_followers",
                "label": "Cafés following me",
                "value": cafe_followers,
                "hint": "warm wholesale leads" if cafe_followers else "no café followers yet",
                "info": "Cafés who follow you haven't inquired yet but are watching. A sourcing story or a wholesale-available bean usually nudges a few into real inquiries.",
                "charts": True,
                "tone": "positive" if cafe_followers > 0 else "default",
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
            "cafe_followers": cafe_followers_series,
            "posts_month": posts_series,
        },
        "hero_key": "followers",
    }


def compute_roaster_business(db, roaster_slug: str) -> Dict[str, Any]:
    """Assemble the full roaster analytics payload. Each section is
    independent — failures are isolated so a broken subtab can't
    bring the whole dashboard down."""
    out: Dict[str, Any] = {}
    for name, fn in (("wholesale", _roaster_wholesale), ("audience", _roaster_audience)):
        try:
            out[name] = fn(db, roaster_slug)
        except Exception as exc:
            out[name] = {"error": str(exc), "cards": [], "series": {}}
    out["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


# ── Café dashboard ─────────────────────────────────────────────────

def _cafe_loyalty(db, cafe_slug: str) -> Dict[str, Any]:
    """Loyalty subtab — three cards on stamp-program health.

    1. Stamps this week (vs prior week) — hero
    2. Repeat-customer rate % — the sharp loyalty signal
    3. Top regular's stamp count (with their name as the hint)
    """
    # Card 1 — stamps this week
    stamps_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN scanned_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN scanned_at >= datetime('now', '-14 days')
                   AND scanned_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM stamps WHERE cafe_slug = ?
    """, (cafe_slug,))

    # Card 2 — repeat-customer rate (% of 30d stampers with ≥2 stamps)
    rr = db.execute("""
        WITH stampers AS (
          SELECT user_id, COUNT(*) AS n FROM stamps
          WHERE cafe_slug = ? AND scanned_at >= datetime('now', '-30 days')
          GROUP BY user_id
        )
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) AS repeats
        FROM stampers
    """, (cafe_slug,)).fetchone()

    total_stampers = _n(rr["total"]) if rr else 0
    repeat_count = _n(rr["repeats"]) if rr else 0
    repeat_pct = round(repeat_count / total_stampers * 100.0, 1) if total_stampers > 0 else 0.0

    # Card 3 — top regular (lifetime top stamper at this café)
    top = db.execute("""
        SELECT s.user_id, COUNT(*) AS c, u.display_name, u.username
        FROM stamps s JOIN users u ON u.id = s.user_id
        WHERE s.cafe_slug = ?
        GROUP BY s.user_id ORDER BY c DESC LIMIT 1
    """, (cafe_slug,)).fetchone()

    top_count = _n(top["c"]) if top else 0
    top_name = (top["display_name"] or top["username"]) if top else None

    stamps_series = _series_30d(db, """
        SELECT DATE(scanned_at) AS date, COUNT(*) AS count
        FROM stamps WHERE cafe_slug = ?
        GROUP BY DATE(scanned_at)
    """, (cafe_slug,))

    # Repeat-rate "series" — daily distinct-stamper count as a proxy.
    # True weekly repeat-rate isn't a clean daily signal; distinct
    # stampers per day answers "are people coming back?" on the same
    # axis and reads honestly.
    distinct_series = _series_30d(db, """
        SELECT DATE(scanned_at) AS date, COUNT(DISTINCT user_id) AS count
        FROM stamps WHERE cafe_slug = ?
        GROUP BY DATE(scanned_at)
    """, (cafe_slug,))

    # Top regular's own daily stamp history, if anyone has stamped.
    top_series: List[Dict[str, Any]] = []
    if top:
        top_series = _series_30d(db, """
            SELECT DATE(scanned_at) AS date, COUNT(*) AS count
            FROM stamps WHERE cafe_slug = ? AND user_id = ?
            GROUP BY DATE(scanned_at)
        """, (cafe_slug, top["user_id"]))

    return {
        "cards": [
            {
                "key": "stamps_week",
                "label": "Stamps this week",
                "value": stamps_wow["value"],
                "delta_pct": stamps_wow["delta_pct"],
                "info": "Stamps scanned at your counter in the last 7 days. If this is dropping, check the reward is still desirable — consider rotating it seasonally.",
                "charts": True,
            },
            {
                "key": "repeat_rate",
                "label": "Repeat-customer rate",
                "value": f"{repeat_pct}%",
                "hint": f"{repeat_count} of {total_stampers} (30d)" if total_stampers > 0 else "no data yet",
                "info": "Share of the last 30 days' stampers who came back at least once. Below 10% usually means your stamp target is too high — try dropping from 10 → 8.",
                "charts": True,
                "tone": "positive" if repeat_pct >= 30 else ("negative" if total_stampers > 0 and repeat_pct < 10 else "default"),
            },
            {
                "key": "top_regular",
                "label": "Top regular",
                "value": top_count,
                "hint": top_name or "no stampers yet",
                "info": "Your most-stamped customer, lifetime. Worth knowing by name — regulars are the engine of the loyalty program.",
                "charts": bool(top),
            },
        ],
        "series": {
            "stamps_week": stamps_series,
            "repeat_rate": distinct_series,
            "top_regular": top_series,
        },
        "hero_key": "stamps_week",
    }


def _cafe_menu(db, cafe_slug: str) -> Dict[str, Any]:
    """Menu-mentions subtab — three cards on customer engagement
    with your menu + a supply-diversity signal.

    1. Tasting notes about beans on your menu (30d)
    2. Posts tagged with this café
    3. Unique roasters on your menu (supply anxiety signal)
    """
    # Card 1 — tasting notes referencing any bean on our menu
    tn_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN tn.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN tn.created_at >= datetime('now', '-14 days')
                   AND tn.created_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM tasting_notes tn
        WHERE tn.product_id IN (
            SELECT product_id FROM cafe_menu_items
            WHERE cafe_slug = ? AND product_id IS NOT NULL
        )
    """, (cafe_slug,))

    # Card 2 — posts tagged with this café
    tagged_wow = _week_over_week(db, """
        SELECT
          SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN created_at >= datetime('now', '-14 days')
                   AND created_at <  datetime('now', '-7 days') THEN 1 ELSE 0 END) AS prior_week
        FROM roaster_posts WHERE cafe_slug = ?
    """, (cafe_slug,))

    # Card 3 — distinct roaster slugs on the current menu
    diversity_row = db.execute("""
        SELECT COUNT(DISTINCT roaster_slug) AS c
        FROM cafe_menu_items
        WHERE cafe_slug = ? AND roaster_slug IS NOT NULL AND roaster_slug != ''
    """, (cafe_slug,)).fetchone()
    diversity = _n(diversity_row["c"]) if diversity_row else 0

    menu_items_count = _n(db.execute("""
        SELECT COUNT(*) AS c FROM cafe_menu_items WHERE cafe_slug = ?
    """, (cafe_slug,)).fetchone()["c"])

    tn_series = _series_30d(db, """
        SELECT DATE(tn.created_at) AS date, COUNT(*) AS count
        FROM tasting_notes tn
        WHERE tn.product_id IN (
            SELECT product_id FROM cafe_menu_items
            WHERE cafe_slug = ? AND product_id IS NOT NULL
        )
        GROUP BY DATE(tn.created_at)
    """, (cafe_slug,))

    tagged_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM roaster_posts WHERE cafe_slug = ?
        GROUP BY DATE(created_at)
    """, (cafe_slug,))

    # Diversity is a snapshot — we chart it as menu-items-added-per-day
    # so tapping the card still shows a meaningful 30d context.
    diversity_series = _series_30d(db, """
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM cafe_menu_items WHERE cafe_slug = ?
        GROUP BY DATE(created_at)
    """, (cafe_slug,))

    # Tone: diversity < 2 with a real menu is a yellow flag per
    # NORTH_STAR supply-anxiety framing.
    diversity_tone = "default"
    if menu_items_count >= 3:
        diversity_tone = "negative" if diversity <= 1 else ("positive" if diversity >= 3 else "default")

    return {
        "cards": [
            {
                "key": "menu_tasting_notes",
                "label": "Tasting notes about your beans",
                "value": tn_wow["value"],
                "delta_pct": tn_wow["delta_pct"],
                "info": "Tasting notes customers have written about coffees on your menu (last 7 days). These are the warmest word-of-mouth — each one is a real cup someone logged.",
                "charts": True,
            },
            {
                "key": "posts_tagged",
                "label": "Posts tagged with this café",
                "value": tagged_wow["value"],
                "delta_pct": tagged_wow["delta_pct"],
                "info": "How many posts in the last 7 days tagged your café — via the heart chip in the composer. Shows up organically in followers' feeds.",
                "charts": True,
            },
            {
                "key": "menu_diversity",
                "label": "Unique roasters on menu",
                "value": diversity,
                "hint": "single-supplier risk" if diversity <= 1 and menu_items_count >= 3 else ("diverse supply" if diversity >= 3 else None),
                "info": "Distinct roasters you source from. Relying on one roaster leaves you exposed if their shipment is late or their allocation changes. Aim for at least 2 active suppliers.",
                "charts": True,
                "tone": diversity_tone,
            },
        ],
        "series": {
            "menu_tasting_notes": tn_series,
            "posts_tagged": tagged_series,
            "menu_diversity": diversity_series,
        },
        "hero_key": "menu_tasting_notes",
    }


def compute_cafe_business(db, cafe_slug: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, fn in (("loyalty", _cafe_loyalty), ("menu", _cafe_menu)):
        try:
            out[name] = fn(db, cafe_slug)
        except Exception as exc:
            out[name] = {"error": str(exc), "cards": [], "series": {}}
    out["generated_at"] = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return out
