"""
One-shot script — run the article scrape pipeline against a hand-picked
list of roasters so the JOURNAL surface has live data to render.

Bypasses the `roaster_sources.enabled` filter — passes a slug directly
to `run_article_scrape_job` which scopes per-roaster regardless of the
catalog-scrape enable flag.

Run from this dir (`Community/coffee-community-api`):
    python scripts/sample_journal_scrape.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `database`, `services` importable when run from any cwd.
_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from dotenv import load_dotenv

# `override=True` so an empty `ANTHROPIC_API_KEY=` exported by an
# outer shell doesn't mask the real value in .env. The live FastAPI
# server's own load (`main.py`) doesn't override because uvicorn
# inherits a clean parent env, but the CLI inherits the user's
# interactive shell where the var may have been pre-declared empty.
load_dotenv(_API_ROOT / ".env", override=True)

from database import get_db  # noqa: E402
from services import catalog_ops  # noqa: E402


SAMPLE_SLUGS = [
    "black-poetry",            # Shopify, /blogs/news.atom (3 articles)
    "black-baza-coffee",       # Shopify, sitemap multi-handle (~30 articles across 6 handles)
    "naivo-coffee-company",    # WooCommerce, /feed/ (~10 articles)
]


def main() -> None:
    db = get_db()
    try:
        # The script is started_by the seeded admin user `crema`.
        admin = db.execute(
            "SELECT id FROM users WHERE username = 'crema' LIMIT 1"
        ).fetchone()
        if not admin:
            raise SystemExit(
                "No 'crema' admin user — seed the DB first or pass another id."
            )
        admin_id = admin["id"]

        for slug in SAMPLE_SLUGS:
            row = db.execute(
                "SELECT roaster_slug, name FROM roaster_profiles "
                "WHERE roaster_slug = ?",
                (slug,),
            ).fetchone()
            if not row:
                print(f"[skip] {slug}: no profile row")
                continue

            print(f"\n=== {row['name']} ({slug}) ===")
            try:
                job_id = catalog_ops.enqueue_job(
                    db, "article_scrape", started_by=admin_id,
                )
            except catalog_ops.JobConflict as e:
                print(f"[skip] {slug}: another article_scrape running "
                      f"(job {e.live_job_id})")
                continue

            # Run synchronously inside this script — bypasses
            # FastAPI's BackgroundTasks since we're outside the
            # request lifecycle. Same code path the live admin
            # surface uses.
            catalog_ops.run_article_scrape_job(job_id, roaster_slug=slug)

            # Read back the job's summary for a tidy CLI report.
            r = db.execute(
                "SELECT status, error_message, result_summary FROM jobs "
                "WHERE id = ?",
                (job_id,),
            ).fetchone()
            import json
            summary = json.loads(r["result_summary"]) if r["result_summary"] else {}
            print(f"  status: {r['status']}")
            if r["error_message"]:
                print(f"  error:  {r['error_message']}")
            for k in (
                "roasters_processed", "articles_inserted",
                "articles_updated", "articles_skipped", "discoveries",
                "enriched", "enrich_failed", "not_article_skipped",
            ):
                if k in summary:
                    print(f"  {k}: {summary[k]}")
            errs = summary.get("errors") or []
            if errs:
                print(f"  errors ({len(errs)}):")
                for e in errs[:3]:
                    print(f"    - {e}")
                if len(errs) > 3:
                    print(f"    ... and {len(errs) - 3} more")
    finally:
        db.close()


if __name__ == "__main__":
    main()
