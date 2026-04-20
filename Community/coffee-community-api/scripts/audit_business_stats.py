"""
Business analytics health check — run against the live DB to verify
every card's value agrees with raw SQL. Use when the dashboard
looks wrong to prove whether the bug is in the service layer, the
data itself, or an unrelated path (e.g. stale cache, wrong account
gate).

Usage:
    cd Community/coffee-community-api
    python3 scripts/audit_business_stats.py          # defaults: nada-coffee + brightside-mandrem
    python3 scripts/audit_business_stats.py <roaster_slug> <cafe_slug>

Exit code is non-zero if any metric drifts from raw SQL, so this is
CI-friendly.
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import get_db
from services.business_stats import compute_roaster_business, compute_cafe_business


def count(db, sql: str, params: tuple = ()) -> int:
    return int(db.execute(sql, params).fetchone()[0] or 0)


def raw_roaster(db, slug: str) -> dict:
    return {
        "inquiries_week": count(
            db,
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE roaster_slug=? "
            "AND created_at >= datetime('now', '-7 days')",
            (slug,),
        ),
        "open_inquiries": count(
            db,
            "SELECT COUNT(*) FROM wholesale_inquiries WHERE roaster_slug=? "
            "AND status='open'",
            (slug,),
        ),
        "top_bean_30d": db.execute(
            """
            SELECT p.coffee_name, COUNT(*) c
              FROM wholesale_inquiries wi
              LEFT JOIN products p ON p.product_id = wi.product_id
             WHERE wi.roaster_slug=? AND wi.product_id IS NOT NULL
               AND wi.created_at >= datetime('now','-30 days')
             GROUP BY wi.product_id ORDER BY c DESC LIMIT 1
            """,
            (slug,),
        ).fetchone(),
        "followers": count(db, "SELECT COUNT(*) FROM follows WHERE roaster_slug=?", (slug,)),
        "cafe_followers": count(
            db,
            """SELECT COUNT(*) FROM follows f
                 JOIN users u ON u.id=f.follower_user_id
                WHERE f.roaster_slug=? AND u.account_type='cafe'""",
            (slug,),
        ),
        "posts_month": count(
            db,
            "SELECT COUNT(*) FROM roaster_posts WHERE roaster_slug=? "
            "AND created_at >= datetime('now','-30 days')",
            (slug,),
        ),
    }


def raw_cafe(db, slug: str) -> dict:
    stampers = db.execute(
        """SELECT user_id, COUNT(*) n FROM stamps
            WHERE cafe_slug=? AND scanned_at >= datetime('now','-30 days')
            GROUP BY user_id""",
        (slug,),
    ).fetchall()
    total = len(stampers)
    repeats = sum(1 for r in stampers if int(r[1]) >= 2)
    rr = round(repeats / total * 100, 1) if total else 0.0
    top = db.execute(
        """SELECT u.display_name, COUNT(*) c FROM stamps s
             JOIN users u ON u.id=s.user_id
            WHERE s.cafe_slug=? GROUP BY s.user_id ORDER BY c DESC LIMIT 1""",
        (slug,),
    ).fetchone()
    return {
        "stamps_week": count(
            db,
            "SELECT COUNT(*) FROM stamps WHERE cafe_slug=? "
            "AND scanned_at >= datetime('now','-7 days')",
            (slug,),
        ),
        "repeat_rate_pct": rr,
        "top_regular": (top[0] if top else None, int(top[1]) if top else 0),
        "menu_tn_week": count(
            db,
            """SELECT COUNT(*) FROM tasting_notes
                WHERE product_id IN (
                    SELECT product_id FROM cafe_menu_items
                     WHERE cafe_slug=? AND product_id IS NOT NULL
                )
                  AND created_at >= datetime('now','-7 days')""",
            (slug,),
        ),
        "posts_tagged_week": count(
            db,
            "SELECT COUNT(*) FROM roaster_posts WHERE cafe_slug=? "
            "AND created_at >= datetime('now','-7 days')",
            (slug,),
        ),
        "menu_diversity": count(
            db,
            """SELECT COUNT(DISTINCT roaster_slug) FROM cafe_menu_items
                WHERE cafe_slug=? AND roaster_slug IS NOT NULL AND roaster_slug!=''""",
            (slug,),
        ),
    }


def card_value(section_payload: dict, section: str, key: str):
    cards = {c["key"]: c for c in section_payload.get(section, {}).get("cards", [])}
    c = cards.get(key, {})
    return c.get("value"), c.get("hint")


def audit_roaster(db, slug: str) -> int:
    raw = raw_roaster(db, slug)
    svc = compute_roaster_business(db, slug)
    mismatches = 0

    def check(label, raw_val, svc_val):
        nonlocal mismatches
        ok = raw_val == svc_val
        marker = "  ✓" if ok else "  ✗"
        print(f"{marker}  {label:28s} raw={raw_val!r:30s} service={svc_val!r}")
        if not ok:
            mismatches += 1

    print(f"\n{'=' * 70}\nROASTER: {slug}\n{'=' * 70}")
    print("--- wholesale ---")
    check("inquiries_week", raw["inquiries_week"], card_value(svc, "wholesale", "inquiries_week")[0])
    check("open_inquiries", raw["open_inquiries"], card_value(svc, "wholesale", "open_inquiries")[0])
    top_raw = raw["top_bean_30d"]
    top_svc, _hint = card_value(svc, "wholesale", "top_bean")
    expected_top = top_raw[0] if top_raw else "\u2014"
    check("top_bean name", expected_top, top_svc)

    print("\n--- audience ---")
    check("followers", raw["followers"], card_value(svc, "audience", "followers")[0])
    check("cafe_followers", raw["cafe_followers"], card_value(svc, "audience", "cafe_followers")[0])
    check("posts_month", raw["posts_month"], card_value(svc, "audience", "posts_month")[0])

    return mismatches


def audit_cafe(db, slug: str) -> int:
    raw = raw_cafe(db, slug)
    svc = compute_cafe_business(db, slug)
    mismatches = 0

    def check(label, raw_val, svc_val):
        nonlocal mismatches
        ok = raw_val == svc_val
        marker = "  ✓" if ok else "  ✗"
        print(f"{marker}  {label:28s} raw={raw_val!r:30s} service={svc_val!r}")
        if not ok:
            mismatches += 1

    print(f"\n{'=' * 70}\nCAFÉ: {slug}\n{'=' * 70}")
    print("--- loyalty ---")
    check("stamps_week", raw["stamps_week"], card_value(svc, "loyalty", "stamps_week")[0])
    check("repeat_rate %", f"{raw['repeat_rate_pct']}%", card_value(svc, "loyalty", "repeat_rate")[0])
    tr_name, tr_cnt = raw["top_regular"]
    top_val, top_hint = card_value(svc, "loyalty", "top_regular")
    check("top_regular count", tr_cnt, top_val)

    print("\n--- menu ---")
    check("menu_tn_week", raw["menu_tn_week"], card_value(svc, "menu", "menu_tasting_notes")[0])
    check("posts_tagged_week", raw["posts_tagged_week"], card_value(svc, "menu", "posts_tagged")[0])
    check("menu_diversity", raw["menu_diversity"], card_value(svc, "menu", "menu_diversity")[0])

    return mismatches


def main():
    roaster_slug = sys.argv[1] if len(sys.argv) > 1 else "nada-coffee"
    cafe_slug = sys.argv[2] if len(sys.argv) > 2 else "brightside-mandrem"

    db = get_db()
    try:
        total = 0
        total += audit_roaster(db, roaster_slug)
        total += audit_cafe(db, cafe_slug)
        print(f"\n{'=' * 70}")
        if total == 0:
            print(f"OK — every metric agrees with raw SQL.")
            return 0
        else:
            print(f"FAIL — {total} metric(s) drifted from raw SQL.")
            return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
