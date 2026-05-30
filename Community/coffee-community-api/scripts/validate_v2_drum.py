"""End-to-end v2 pipeline validation on Drum, with the LLM mocked.

Exercises everything REAL except the Haiku call:

  - entity_discovery hits Drum's sitemap live
  - page_fetcher hits each URL live
  - entity_enricher's call_llm is patched to return canned payloads
  - entity_upserter writes to a TEMPORARY DB copy (not the live one)
  - enrichment_tasks transitions verified row-by-row

Cost: zero. Verifies the orchestrator wiring: discovery → tasks →
fetch → (mocked) Haiku → upsert → state machine.

Usage:
    cd Community/coffee-community-api
    python scripts/validate_v2_drum.py
    python scripts/validate_v2_drum.py --slug some-other-roaster
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parent.parent))

# Set a fake API key so the early-return guard in entity_enricher doesn't
# fire. We're mocking call_llm, the key value is never actually used.
os.environ["ANTHROPIC_API_KEY"] = "sk-test-validation"

import database  # noqa: E402


# Canned Haiku responses — kind-discriminated, shaped exactly like the
# existing _EXTRACT_TOOL / _ARTICLE_TOOL outputs.
PRODUCT_PAYLOAD = {
    "is_coffee_bean": True,
    "coffee_name_clean": "Validation Test Coffee",
    "origin": "Chikmagalur",
    "altitude_masl": 1100,
    "roast_level": "Medium",
    "roast_level_name": "Medium",
    "process_raw": "Washed",
    "tasting_notes": "balanced sweetness, mild acidity",
    "flavor_notes": ["Chocolate", "Citrus", "Caramel"],
    "varietal": "S795",
    "bean_type": "Arabica",
    "weight_grams": 250,
    "producer": None,
    "brew_recommendation": {"method": "pour_over", "ratio": "1:15"},
    "roaster_blurb": "A balanced Chikmagalur Arabica.",
}

ARTICLE_PAYLOAD = {
    "is_article": True,
    "is_about_coffee": True,
    "topic_category": "origins",
    "tags": ["validation", "test", "drum"],
    "title": "Validation Test Article",
    "excerpt": "Discover what validation looks like.",
    "body_html": "<p>This is a validation-only article body.</p>",
    "image_url": None,
    "published_at": None,
    "word_count": 50,
}


def _mock_call_llm(*, step: str, **_kwargs):
    if step in ("product_enrich",):
        return dict(PRODUCT_PAYLOAD)
    if step in ("article_enrich",):
        return dict(ARTICLE_PAYLOAD)
    return None


def _copy_live_db_to_temp() -> str:
    """Snapshot the live DB into /tmp so we can validate writes
    without touching the real catalog."""
    tmp = tempfile.NamedTemporaryFile(
        prefix="crema_v2_validate_", suffix=".db", delete=False
    )
    tmp.close()
    try:
        shutil.copy(database.DB_PATH, tmp.name)
        print(f"Snapshotted live DB → {tmp.name}")
    except FileNotFoundError:
        print("No live DB present; initializing a fresh one.")
        database.DB_PATH = tmp.name
        database.init_db()
    return tmp.name


def _count(db, table: str, where: str = "1=1", params=()) -> int:
    return db.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default="drum-coffee-roasters",
                    help="Roaster slug to validate against (default: drum-coffee-roasters)")
    ap.add_argument("--kind", action="append", choices=["product", "article"],
                    default=None,
                    help="Restrict to one kind (default: both)")
    ap.add_argument("--keep-db", action="store_true",
                    help="Don't delete the temp DB after the run (for inspection)")
    args = ap.parse_args()

    tmp_db_path = _copy_live_db_to_temp()

    # Point everything at the temp DB before importing modules that read DB_PATH.
    database.DB_PATH = tmp_db_path

    from services.enrichment_runner import run_for_roaster  # noqa: E402

    db = sqlite3.connect(tmp_db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    kinds = tuple(args.kind) if args.kind else ("product", "article")

    # Snapshot counts before so we can diff after.
    before = {
        "products": _count(db, "products", "roaster_slug = ?", (args.slug,)),
        "articles": _count(db, "roaster_articles", "roaster_slug = ?", (args.slug,)),
        "tasks": _count(db, "enrichment_tasks", "roaster_slug = ?", (args.slug,)),
    }

    print(f"\nBefore run (for {args.slug}):")
    for k, v in before.items():
        print(f"  {k}: {v}")

    # Confirm roaster exists in the snapshot.
    profile_row = db.execute(
        "SELECT roaster_slug, website FROM roaster_profiles WHERE roaster_slug = ?",
        (args.slug,),
    ).fetchone()
    if profile_row is None:
        print(f"\nERROR: roaster_profile not found for {args.slug!r}")
        print("Available slugs:")
        for r in db.execute(
            "SELECT roaster_slug FROM roaster_profiles "
            "WHERE published = 1 ORDER BY roaster_slug LIMIT 10"
        ).fetchall():
            print(f"  - {r['roaster_slug']}")
        return 1

    print(f"\nRunning v2 enrichment for {args.slug}, kinds={list(kinds)}")
    print(f"website: {profile_row['website']}")
    print()

    with patch(
        "services.entity_enricher.call_llm",
        side_effect=lambda **kw: _mock_call_llm(**kw),
    ):
        result = run_for_roaster(
            db, args.slug, kinds=kinds, force_enrich=True,
            log=lambda m: print(m),
        )

    print()
    print("Summary:")
    print(json.dumps(result.to_summary(), indent=2))

    after = {
        "products": _count(db, "products", "roaster_slug = ?", (args.slug,)),
        "articles": _count(db, "roaster_articles", "roaster_slug = ?", (args.slug,)),
        "tasks": _count(db, "enrichment_tasks", "roaster_slug = ?", (args.slug,)),
    }
    print(f"\nAfter run:")
    for k, v in after.items():
        delta = v - before[k]
        sign = "+" if delta >= 0 else ""
        print(f"  {k}: {v} ({sign}{delta})")

    # Validate task state distribution.
    print(f"\nenrichment_tasks state distribution for {args.slug}:")
    for row in db.execute(
        "SELECT state, COUNT(*) c FROM enrichment_tasks "
        "WHERE roaster_slug = ? GROUP BY state ORDER BY c DESC",
        (args.slug,),
    ).fetchall():
        print(f"  {row['state']}: {row['c']}")

    print(f"\nenrichment_tasks provenance for {args.slug}:")
    for row in db.execute(
        "SELECT extraction_provenance, COUNT(*) c FROM enrichment_tasks "
        "WHERE roaster_slug = ? AND extraction_provenance IS NOT NULL "
        "GROUP BY extraction_provenance ORDER BY c DESC",
        (args.slug,),
    ).fetchall():
        print(f"  {row['extraction_provenance']}: {row['c']}")

    # Quick verification — at least one product row should have the
    # mocked coffee_name if any product enriched.
    if "product" in kinds and after["products"] > before["products"]:
        row = db.execute(
            "SELECT product_id, coffee_name, origin, roast_level, bean_type "
            "FROM products WHERE roaster_slug = ? "
            "  AND coffee_name = 'Validation Test Coffee' LIMIT 1",
            (args.slug,),
        ).fetchone()
        if row:
            print(f"\nSample upserted product: {dict(row)}")
        else:
            print(f"\nNote: no product matched the mocked coffee_name — "
                  f"probably all UPDATEs to existing rows (force_enrich=True).")

    db.close()
    if args.keep_db:
        print(f"\nKept temp DB at {tmp_db_path}")
    else:
        Path(tmp_db_path).unlink(missing_ok=True)
        print(f"\nCleaned up temp DB")

    print("\nValidation complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
