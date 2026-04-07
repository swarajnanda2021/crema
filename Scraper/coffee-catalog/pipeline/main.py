"""
Coffee Catalog Pipeline — Orchestrator

Usage:
    python pipeline/main.py --all               # Run all 4 phases
    python pipeline/main.py --phase 1           # Run Phase 1 only (discovery)
    python pipeline/main.py --phase 2           # Phase 2 (verification, reads discovery.json)
    python pipeline/main.py --phase 3           # Phase 3 (enrichment, reads discovery + verification)
    python pipeline/main.py --phase 4           # Phase 4 (assembly, reads all intermediates)

Requires GOOGLE_PLACES_API_KEY in .env or environment.
"""

import json
import os
import sys
import time
import argparse

# Add pipeline dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from discovery import run_discovery
from verification import run_verification
from enrichment import run_enrichment
from assembler import assemble_catalog, write_csv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")


def _load_api_key():
    """Load Google Places API key from .env or environment."""
    key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if key:
        return key
    env_path = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("GOOGLE_PLACES_API_KEY="):
                    return line.split("=", 1)[1].strip()
    print("ERROR: GOOGLE_PLACES_API_KEY not found in .env or environment.")
    sys.exit(1)


def _write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run_phase_1(api_key):
    """Phase 1: Google Places Discovery."""
    print(f"\n{'═' * 55}")
    print("PHASE 1: Discovery")
    print(f"{'═' * 55}")

    candidates = run_discovery(api_key)

    path = os.path.join(OUTPUT_DIR, "discovery.json")
    _write_json(path, candidates)
    print(f"\n  Output: {path} ({len(candidates)} candidates)")

    return candidates


def run_phase_2(candidates):
    """Phase 2: Website Verification."""
    print(f"\n{'═' * 55}")
    print("PHASE 2: Verification")
    print(f"{'═' * 55}")

    results, verified, dropped = run_verification(candidates)

    path = os.path.join(OUTPUT_DIR, "verification.json")
    _write_json(path, results)
    print(f"\n  Verified: {verified} | Dropped: {dropped}")
    print(f"  Output: {path}")

    return results


def run_phase_3(candidates, verifications):
    """Phase 3: Roaster Profile Enrichment."""
    print(f"\n{'═' * 55}")
    print("PHASE 3: Enrichment")
    print(f"{'═' * 55}")

    results = run_enrichment(candidates, verifications)

    path = os.path.join(OUTPUT_DIR, "enrichment.json")
    _write_json(path, results)
    print(f"\n  Enriched: {len(results)} roasters")
    print(f"  Output: {path}")

    return results


def run_phase_4(candidates, verifications, enrichments):
    """Phase 4: Catalog Assembly."""
    print(f"\n{'═' * 55}")
    print("PHASE 4: Catalog Assembly")
    print(f"{'═' * 55}")

    verified, dropped, summary = assemble_catalog(candidates, verifications, enrichments)

    # Build full catalog output
    import datetime
    catalog = {
        "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pipeline_version": "1.0",
        "criteria": "Physical roastery (Google Places) + working website + online bean shop",
        "summary": summary,
        "roasters": verified,
        "dropped": dropped,
    }

    # Write outputs
    catalog_path = os.path.join(OUTPUT_DIR, "verified_roasters_catalog.json")
    _write_json(catalog_path, catalog)

    csv_path = os.path.join(OUTPUT_DIR, "verified_roasters_catalog.csv")
    write_csv(csv_path, verified)

    # Also write a scraper-compatible flat JSON (just the fields the scraper needs)
    scraper_compat = []
    for r in verified:
        scraper_compat.append({
            "name": r["name"],
            "city": r["city"],
            "state": r["state"],
            "lat": r["lat"],
            "lng": r["lng"],
            "website": r["website"],
            "shop_url": r["shop_url"],
            "platform": r["platform"],
        })
    scraper_path = os.path.join(OUTPUT_DIR, "scraper_input.json")
    _write_json(scraper_path, scraper_compat)

    # Profile completeness stats
    logo_count = sum(1 for r in verified if r.get("logo_url"))
    tagline_count = sum(1 for r in verified if r.get("tagline"))
    about_count = sum(1 for r in verified if r.get("about_blurb"))
    year_count = sum(1 for r in verified if r.get("founding_year"))
    social_count = sum(1 for r in verified if r.get("social_links"))
    n = len(verified) or 1

    print(f"\n  Verified roasters: {len(verified)}")
    print(f"  States covered: {summary['states_covered']}")
    print(f"  Profile completeness:")
    print(f"    logo:     {logo_count}/{n} ({100*logo_count//n}%)")
    print(f"    tagline:  {tagline_count}/{n} ({100*tagline_count//n}%)")
    print(f"    about:    {about_count}/{n} ({100*about_count//n}%)")
    print(f"    year:     {year_count}/{n} ({100*year_count//n}%)")
    print(f"    social:   {social_count}/{n} ({100*social_count//n}%)")
    print(f"\n  Outputs:")
    print(f"    {catalog_path}")
    print(f"    {csv_path}")
    print(f"    {scraper_path}")

    return verified, dropped


def main():
    parser = argparse.ArgumentParser(description="Coffee Roaster Catalog Pipeline")
    parser.add_argument("--all", action="store_true", help="Run all 4 phases")
    parser.add_argument("--phase", type=int, choices=[1, 2, 3, 4], help="Run a specific phase")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not args.all and not args.phase:
        args.all = True

    api_key = _load_api_key()

    t_start = time.time()

    if args.all or args.phase == 1:
        candidates = run_phase_1(api_key)
    else:
        candidates = _read_json(os.path.join(OUTPUT_DIR, "discovery.json"))

    if args.all or args.phase == 2:
        verifications = run_phase_2(candidates)
    else:
        verifications = _read_json(os.path.join(OUTPUT_DIR, "verification.json"))

    if args.all or args.phase == 3:
        enrichments = run_phase_3(candidates, verifications)
    else:
        enrichments = _read_json(os.path.join(OUTPUT_DIR, "enrichment.json"))

    if args.all or args.phase == 4:
        run_phase_4(candidates, verifications, enrichments)

    elapsed = time.time() - t_start
    print(f"\n{'═' * 55}")
    print(f"Pipeline complete in {elapsed:.0f}s")
    print(f"{'═' * 55}")


if __name__ == "__main__":
    main()
