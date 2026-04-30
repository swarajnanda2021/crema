"""
Scrape runner — wraps the existing `Scraper/scraper/main.py` for the admin
Scraper tab.

The pipeline (per-job, called from `services.catalog_ops.run_scrape_job`):

  1. Read every enabled row from `roaster_sources`, write them into
     `Scraper/input/verified_roasters_catalog.json` (the path the scraper
     reads by default — this lets us select which roasters get crawled
     without modifying scraper internals).
  2. Spawn `python scraper/main.py` as a subprocess with cwd=Scraper/,
     capture stdout/stderr, enforce a 30-min timeout.
  3. Parse `Scraper/output/products.json` and upsert into the `products`
     table. The owner-set `source` column is preserved on update.
  4. Stamp `roaster_sources.last_scraped_at` for every source in the run.
  5. Return a result summary { scraped: N, new_products: M, updated: K, ... }.

Per LAUNCH_TODO §3.8, this is the v0 sync-in-process flow. The prod
hardening (queue worker, log persistence, secret manager, restart safety)
is parked.
"""

from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRAPER_DIR = PROJECT_ROOT / "Scraper"
SCRAPER_INPUT = SCRAPER_DIR / "input" / "verified_roasters_catalog.json"
SCRAPER_OUTPUT = SCRAPER_DIR / "output" / "products.json"
SCRAPER_LOG = SCRAPER_DIR / "output" / "scrape_log.json"
SCRAPER_ENTRYPOINT = SCRAPER_DIR / "scraper" / "main.py"

SCRAPE_TIMEOUT_SECONDS = 30 * 60  # 30 min


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def write_input_catalog(db, *, roaster_slug: str | None = None) -> int:
    """Render every `enabled=1` `roaster_sources` row into the JSON file the
    scraper reads. Returns the number of sources written.

    When `roaster_slug` is set, scope to just that one roaster — used by
    the BEANS-tab dropdown so the admin can pull a single roaster's
    inventory without re-running the catalog. The slug resolves through
    `roaster_profiles.website` → `roaster_sources.website`, so a Tab-1
    enrichment is what unlocks Tab-2 scraping.

    Latitude / longitude default to 0 because the prompt schema for
    `roaster_sources` doesn't track them — the scraper itself doesn't need
    them, but normalizers may pass them through to product output.
    """
    if roaster_slug:
        # Per-roaster scrape: the admin explicitly picked this one and
        # tapped Enrich, so the `enabled` flag is irrelevant — the
        # button IS the kick. As long as the source row has a
        # `shop_url` + `platform` (the scrape_ready gate), we run.
        # The `enabled=1` filter only governs the bulk "Enrich all"
        # mode where we scrape every active source in one job.
        rows = db.execute(
            "SELECT rs.name, rs.website, rs.shop_url, rs.platform, "
            "       rs.city, rs.state "
            "FROM roaster_sources rs "
            "JOIN roaster_profiles rp ON rp.website = rs.website "
            "WHERE rp.roaster_slug = ? "
            "  AND rs.shop_url IS NOT NULL "
            "  AND rs.platform IS NOT NULL",
            (roaster_slug,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT name, website, shop_url, platform, city, state "
            "FROM roaster_sources WHERE enabled = 1 ORDER BY name ASC"
        ).fetchall()
    catalog = []
    for r in rows:
        catalog.append({
            "name": r["name"],
            "city": r["city"] or "",
            "state": r["state"] or "",
            "lat": 0,
            "lng": 0,
            "website": r["website"],
            "shop_url": r["shop_url"] or r["website"],
            "platform": r["platform"] or "custom",
        })
    SCRAPER_INPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(SCRAPER_INPUT, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    return len(catalog)


def invoke_scraper(
    *,
    timeout: int = SCRAPE_TIMEOUT_SECONDS,
    on_line: Optional[Callable[[str], None]] = None,
) -> tuple[int, str]:
    """Spawn the scraper and stream stdout line by line.

    Returns (returncode, full_log_text).

    `on_line` is called from a background thread for every output line
    (stdout + stderr merged) — the runner uses this to flush the live
    `log_tail` into the jobs row every couple of seconds so the admin
    tab can poll-and-render progress while the scrape is running. If
    `on_line` is None we just collect into a buffer.
    """
    if not SCRAPER_ENTRYPOINT.exists():
        raise RuntimeError(
            f"Scraper entrypoint not found at {SCRAPER_ENTRYPOINT}. "
            "Confirm the Scraper/ directory is intact."
        )

    proc = subprocess.Popen(
        [sys.executable, "-u", str(SCRAPER_ENTRYPOINT.relative_to(SCRAPER_DIR))],
        cwd=str(SCRAPER_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,  # line-buffered
    )

    # We pump the child's stdout in a separate thread so the join /
    # timeout logic on the main thread isn't blocked behind PIPE I/O.
    # Lines land in `lines` for the post-run summary; `on_line` (if
    # provided) is called as each one arrives.
    lines: list[str] = []
    lock = threading.Lock()

    def _pump():
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, ""):
            line = raw.rstrip("\n")
            with lock:
                lines.append(line)
            if on_line is not None:
                try:
                    on_line(line)
                except Exception:
                    # Never let a callback crash the pump — the admin
                    # cares about the scrape result, not the log writer.
                    pass

    pumper = threading.Thread(target=_pump, daemon=True)
    pumper.start()

    deadline = time.monotonic() + timeout
    while True:
        rc = proc.poll()
        if rc is not None:
            break
        if time.monotonic() >= deadline:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            pumper.join(timeout=5)
            with lock:
                tail = "\n".join(lines)
            raise subprocess.TimeoutExpired(
                cmd=str(SCRAPER_ENTRYPOINT), timeout=timeout, output=tail,
            )
        time.sleep(0.5)

    pumper.join(timeout=5)
    with lock:
        out = "\n".join(lines)
    return proc.returncode or 0, out


PRODUCT_LITE_COLS = (
    "product_id, roaster_slug, roaster_name, coffee_name, roast_level, "
    "tasting_notes, origin, process, varietal, altitude_masl, bean_type, "
    "flavor_notes, weight_grams, price_inr, image_url, product_url, "
    "available, source, "
    "process_raw, producer, brew_recommendation_json, enrichment_status, "
    "roast_level_name, roaster_blurb, "
    "origin_region, varietal_canonical"
)


def _product_lite_from_row(row) -> dict:
    """Pack a sqlite3.Row into a JSON-safe dict shaped like what
    CoffeeCard expects for a thumbnail render. The four Phase-1
    enrichment columns are passed through verbatim so the proposal
    carousel can show the full 13-field picture without a second
    fetch."""
    keys = row.keys()
    def _g(name, default=None):
        return row[name] if name in keys else default
    return {
        "product_id": row["product_id"],
        "roaster_slug": row["roaster_slug"],
        "roaster_name": row["roaster_name"],
        "coffee_name": row["coffee_name"],
        "roast_level": row["roast_level"],
        "tasting_notes": row["tasting_notes"],
        "origin": row["origin"],
        "process": row["process"],
        "varietal": row["varietal"],
        "altitude_masl": row["altitude_masl"],
        "bean_type": row["bean_type"],
        "flavor_notes": row["flavor_notes"],
        "weight_grams": row["weight_grams"],
        "price_inr": row["price_inr"],
        "image_url": row["image_url"],
        "product_url": row["product_url"],
        "available": row["available"],
        "source": row["source"],
        "process_raw": _g("process_raw"),
        "producer": _g("producer"),
        "brew_recommendation_json": _g("brew_recommendation_json"),
        "enrichment_status": _g("enrichment_status"),
        "roast_level_name": _g("roast_level_name"),
        "roaster_blurb": _g("roaster_blurb"),
        "origin_region": _g("origin_region"),
        "varietal_canonical": _g("varietal_canonical"),
    }


def _product_lite_from_scraped(p: dict, *, enrichment_status: str = "pending") -> dict:
    """Same shape as `_product_lite_from_row` but built from a scraper +
    enricher output dict before it lands in the DB. Carries the four
    Phase-1 enrichment fields when the LLM filled them, plus the
    `enrichment_status` flag so the admin tab can render a small
    "needs re-enrichment" affordance on rows where Sonnet failed."""
    from services.canonicalize import canonical_region, canonical_varietal
    flavor_notes = p.get("flavor_notes")
    if isinstance(flavor_notes, list):
        flavor_notes = json.dumps(flavor_notes)
    tasting_notes = p.get("tasting_notes")
    if not isinstance(tasting_notes, (str, type(None))):
        tasting_notes = json.dumps(tasting_notes)
    brew_rec = p.get("brew_recommendation")
    if isinstance(brew_rec, dict):
        brew_rec = json.dumps(brew_rec)
    return {
        "product_id": p.get("product_id"),
        "roaster_slug": p.get("roaster_slug"),
        "roaster_name": p.get("roaster_name"),
        "coffee_name": p.get("coffee_name_clean") or p.get("coffee_name"),
        "roast_level": p.get("roast_level"),
        "tasting_notes": tasting_notes,
        "origin": p.get("origin"),
        "process": p.get("process"),
        "varietal": p.get("varietal"),
        "altitude_masl": p.get("altitude_masl"),
        "bean_type": p.get("bean_type"),
        "flavor_notes": flavor_notes,
        "weight_grams": p.get("weight_grams"),
        "price_inr": p.get("price_inr"),
        "image_url": p.get("image_url"),
        "product_url": p.get("product_url"),
        "available": 1 if p.get("available", True) else 0,
        "source": "scraped",
        # Phase 1 enrichment fields — null when the LLM didn't produce
        # them (or wasn't available). The runner copies enrichment_status
        # in too so the admin sees which rows are still raw.
        "process_raw": p.get("process_raw"),
        "producer": p.get("producer"),
        "brew_recommendation_json": brew_rec,
        "enrichment_status": enrichment_status,
        # Phase 6 — verbatim roast term + per-bean narrative blurb.
        # Null when the page text didn't carry them; the admin can
        # re-enrich a single product to retry.
        "roast_level_name": p.get("roast_level_name"),
        "roaster_blurb": p.get("roaster_blurb"),
        # Discover filter axes — light-touch regex pass over free-text
        # origin / varietal. Heavier curation lands later via the
        # Coffee Standardization sub-tab.
        "origin_region": canonical_region(
            p.get("origin"), p.get("description_raw"),
        ),
        "varietal_canonical": canonical_varietal(p.get("varietal")),
    }


# ── Slug canonicalization ──────────────────────────────────────────────────
# The standalone scraper derives `roaster_slug = slugify(roaster_name)` per
# run; if the same roaster's name comes back slightly different (different
# casing, "Pvt Ltd" suffix, …), a fresh scrape produces an entirely new
# slug and the same coffees look NEW under a different identity. Tab 1's
# enrichment fixes the slug once on `roaster_profiles`; this lookup
# back-substitutes that canonical slug onto every scraped product before
# the diff runs, so updates wire up to existing rows.

def _canonical_slug_lookup(db) -> dict[str, str]:
    """Map every roaster_profile's website → canonical roaster_slug."""
    rows = db.execute(
        "SELECT website, roaster_slug FROM roaster_profiles "
        "WHERE website IS NOT NULL AND website <> ''"
    ).fetchall()
    return {r["website"]: r["roaster_slug"] for r in rows}


def _canonicalize(p: dict, lookup: dict[str, str]) -> None:
    """Mutate the scraped product so its roaster_slug + product_id use
    the canonical slug from `roaster_profiles`. No-op when we can't
    resolve a match (unknown roaster — leaves the scraper-derived slug
    in place)."""
    website = p.get("roaster_website") or p.get("website")
    if not website:
        return
    canonical = lookup.get(website)
    if not canonical:
        # Try an alt-form lookup (https://x ↔ http://www.x). One last
        # attempt before giving up — slug drift caused by URL drift is
        # the same root cause we're fighting.
        alt = website
        if alt.startswith("http://"):
            alt = "https://" + alt[len("http://"):]
        elif alt.startswith("https://"):
            alt = "http://" + alt[len("https://"):]
        canonical = lookup.get(alt)
    if not canonical:
        return
    old_slug = p.get("roaster_slug") or ""
    if old_slug == canonical:
        return
    p["roaster_slug"] = canonical
    # product_id is `{slug}_{coffee_slug}` per the scraper's normalizer —
    # rewrite the slug prefix only, preserve the coffee tail.
    pid = p.get("product_id") or ""
    if old_slug and pid.startswith(old_slug + "_"):
        p["product_id"] = canonical + "_" + pid[len(old_slug) + 1:]
    elif old_slug and pid.startswith(old_slug):
        p["product_id"] = canonical + pid[len(old_slug):]


def stage_scrape_proposals(db, job_id: int,
                             *, log: Callable[[str], None] | None = None,
                             roaster_slug: str | None = None,
                             regenerate_prompt: bool = False) -> dict:
    """Read `Scraper/output/products.json` and stage proposals — never
    touches the `products` table directly.

    Two new responsibilities (Phase 3):
      1. **Slug canonicalization.** Each scraped product's `roaster_slug`
         (and its `product_id` prefix) gets overridden with the canonical
         slug from `roaster_profiles` (joined by website). Kills the
         Devan-style instability where the same roaster scraped at two
         different times produces two different slugs.
      2. **Per-product enrichment.** Every product passes through
         `product_enricher.enrich_product()` — a Sonnet call that fills
         the 13 fields the admin reviews (process_raw, producer,
         brew_recommendation, cleaned coffee_name, etc.). If enrichment
         fails for a row, the raw scraper output still goes into the
         proposal with `enrichment_status='failed'`.

    Each diff lands as a row in `scrape_proposals` with `status='pending'`
    so the admin can approve / reject before anything is committed.

    Buckets:
      * `new_products`       — never seen this product_id before (insert)
      * `updated`            — product_id exists; columns differ from scrape
      * `missing`            — exists in DB for this scraped slug but
                                absent from this run (mark-sold-out
                                candidate)
      * `restoring`          — currently `available=0`, scrape returned it
                                as `available=1` (auto-restore proposal)

    Update proposals only fire when the new state actually differs from
    the existing row — so a no-op re-scrape won't fill the queue with
    "approve this trivially-identical row" requests.
    """
    if not SCRAPER_OUTPUT.exists():
        return _empty_summary()

    with open(SCRAPER_OUTPUT) as f:
        scraped = json.load(f)

    # Pre-resolve the canonical slug per scraped roaster website, in one
    # query, so the per-product loop stays O(n) without a SELECT each.
    canonical_by_website = _canonical_slug_lookup(db)

    now = _now()
    new_items: list[dict] = []
    updated_items: list[dict] = []
    restoring_items: list[dict] = []
    skipped_count = 0
    new_total = 0
    updated_total = 0
    restoring_total = 0
    enrichment_failures = 0

    # Try to set up the enricher up front — if the env is broken (no
    # ANTHROPIC_API_KEY, no SDK), every product falls back to its raw
    # scraper output with `enrichment_status='deferred'`. The admin
    # can re-trigger enrichment per-product later.
    enrichment_available = True
    enrichment_setup_error: str | None = None
    try:
        from services import product_enricher
        # Touch the import path early so we fail fast if SDK is missing.
        product_enricher._import_enrich()  # noqa: SLF001
        product_enricher._client()  # noqa: SLF001
    except Exception as e:
        enrichment_available = False
        enrichment_setup_error = str(e)
        if log:
            log(f"enrichment unavailable: {e!s} — proposals will land as raw")

    # Pre-load per-roaster prompt hints in one query so the per-product
    # loop stays O(n). Hint is appended to Haiku's system prompt for
    # THIS roaster only — past extraction experience rides along.
    hints_by_slug = _load_prompt_hints(db)
    # Track successfully-enriched samples for the post-run meta-prompt
    # generation. Only kept when scoped to one roaster — bulk runs
    # don't get a meta-prompt (no useful single-roaster context to
    # generate from).
    enriched_samples_for_meta: list[dict] = []
    scoped_roaster_name: str | None = None

    existing = {
        r["product_id"]: r for r in db.execute(
            f"SELECT {PRODUCT_LITE_COLS} FROM products"
        ).fetchall()
    }
    scraped_pids: set[str] = set()
    scraped_slugs: set[str] = set()

    for p in scraped:
        # Canonicalize slug + product_id BEFORE any further processing so
        # the in-DB lookup keys stay stable across runs.
        _canonicalize(p, canonical_by_website)
        # Per-product Haiku pass with the per-roaster prompt addendum
        # (loaded once at top into `hints_by_slug`).
        product_slug = p.get("roaster_slug") or ""
        addendum = hints_by_slug.get(product_slug)
        enriched_status = "enriched"
        if enrichment_available:
            try:
                merged = product_enricher.enrich_product(p, system_addendum=addendum)
                if merged is None:
                    enriched_status = "failed"
                    enrichment_failures += 1
                else:
                    p = merged
                    # If the LLM rules this isn't a coffee bean, drop it
                    # — no proposal even gets staged.
                    if p.get("is_coffee_bean") is False:
                        skipped_count += 1
                        continue
                    # Capture for the post-run meta-prompt generator —
                    # only when scoped to ONE roaster (bulk runs skip).
                    if (
                        roaster_slug
                        and product_slug == roaster_slug
                        and len(enriched_samples_for_meta) < 12
                    ):
                        enriched_samples_for_meta.append(p)
                        if not scoped_roaster_name:
                            scoped_roaster_name = p.get("roaster_name")
            except Exception as e:
                enriched_status = "failed"
                enrichment_failures += 1
                if log:
                    log(f"enrich error pid={p.get('product_id')}: {e!s}")
        else:
            enriched_status = "deferred"

        pid = p.get("product_id")
        if not pid:
            skipped_count += 1
            continue
        if not p.get("coffee_name"):
            skipped_count += 1
            continue
        scraped_pids.add(pid)
        if p.get("roaster_slug"):
            scraped_slugs.add(p["roaster_slug"])

        scrape_available = 1 if p.get("available", True) else 0
        if scrape_available == 0 and pid not in existing:
            # Don't propose creating a new row that's already out-of-stock.
            skipped_count += 1
            continue

        proposed = _product_lite_from_scraped(p, enrichment_status=enriched_status)

        if pid not in existing:
            _insert_proposal(
                db, job_id, pid, "insert",
                proposed_state=proposed, prev_state=None, now=now,
            )
            new_total += 1
            if len(new_items) < 50:
                new_items.append(proposed)
            continue

        existing_row = _product_lite_from_row(existing[pid])
        # Restore — currently sold out, scrape says available again.
        if existing_row["available"] == 0 and scrape_available == 1:
            _insert_proposal(
                db, job_id, pid, "restore_available",
                proposed_state=proposed, prev_state=existing_row, now=now,
            )
            restoring_total += 1
            if len(restoring_items) < 50:
                restoring_items.append(proposed)
            continue

        # Plain update — only stage if anything actually changed (compare
        # the full lite-row dicts so an identical re-scrape is a no-op).
        if _row_diff(existing_row, proposed):
            _insert_proposal(
                db, job_id, pid, "update",
                proposed_state=proposed, prev_state=existing_row, now=now,
            )
            updated_total += 1
            if len(updated_items) < 50:
                updated_items.append(proposed)

    # Missing — products in the DB whose roaster_slug was scraped this
    # run but whose product_id is absent from the scrape output. The
    # admin reviews these and chooses to mark each one sold-out (which
    # creates a `mark_sold_out` proposal for that product) or leave it.
    # We still store them in scrape_proposals as 'pending' so the admin
    # has a single approve/reject UI.
    missing_items: list[dict] = []
    missing_total = 0
    if scraped_slugs:
        placeholders = ",".join("?" * len(scraped_slugs))
        rows = db.execute(
            f"SELECT {PRODUCT_LITE_COLS} FROM products "
            f"WHERE roaster_slug IN ({placeholders}) AND available = 1",
            tuple(scraped_slugs),
        ).fetchall()
        for r in rows:
            if r["product_id"] in scraped_pids:
                continue
            existing_lite = _product_lite_from_row(r)
            _insert_proposal(
                db, job_id, r["product_id"], "mark_sold_out",
                proposed_state=None, prev_state=existing_lite, now=now,
            )
            missing_total += 1
            if len(missing_items) < 50:
                missing_items.append(existing_lite)

    db.commit()

    # ── Post-run meta-prompt generation ──────────────────────────
    # Only fires when the run was scoped to a single roaster AND
    # either no hint exists yet OR the admin asked for a regen.
    # Per the failure-mode contract: any hiccup in the meta-call
    # leaves the hint untouched — next run retries.
    meta_prompt_status = "skipped"
    meta_prompt_addendum: str | None = None
    if roaster_slug and enriched_samples_for_meta:
        existing_hint = hints_by_slug.get(roaster_slug)
        should_generate = bool(regenerate_prompt) or not existing_hint
        if should_generate:
            try:
                from services import site_prompt_generator
                samples = site_prompt_generator.pick_samples(
                    enriched_samples_for_meta,
                )
                # Convert to the shape the generator expects: pull
                # `_page_text` out (private convention from the
                # enricher) and a clean extracted-fields dict.
                meta_samples = [
                    {
                        "product_url": s.get("product_url") or "",
                        "page_text": s.pop("_page_text", "") or "",
                        "extracted": _meta_sample_extracted(s),
                    }
                    for s in samples
                ]
                if log:
                    log(
                        f"site-prompt meta-call: {len(meta_samples)} sample(s) "
                        f"for {roaster_slug}"
                        + (" (regen requested)" if regenerate_prompt else " (first run)")
                    )
                addendum = site_prompt_generator.generate_site_prompt_hint(
                    roaster_name=scoped_roaster_name or roaster_slug,
                    samples=meta_samples,
                )
                if addendum is None:
                    meta_prompt_status = "failed"
                    if log:
                        log("site-prompt meta-call: failed (hint left null)")
                elif addendum == "":
                    meta_prompt_status = "no_pattern"
                    if log:
                        log("site-prompt meta-call: no useful pattern emerged")
                else:
                    meta_prompt_status = "generated"
                    meta_prompt_addendum = addendum
                    db.execute(
                        "UPDATE roaster_profiles "
                        "SET enrichment_prompt_hint = ?, "
                        "    enrichment_prompt_hint_updated_at = ?, "
                        "    updated_at = ? "
                        "WHERE roaster_slug = ?",
                        (addendum, now, now, roaster_slug),
                    )
                    db.commit()
                    if log:
                        log(
                            f"site-prompt saved ({len(addendum)} chars) — "
                            f"future runs on {roaster_slug} will use it"
                        )
            except Exception as e:
                meta_prompt_status = "failed"
                if log:
                    log(f"site-prompt meta-call error: {e!s}")
        else:
            meta_prompt_status = "cached"
            if log:
                log(f"site-prompt cached — using existing hint for {roaster_slug}")

    return {
        "scraped": len(scraped),
        "skipped": skipped_count,
        "new_products": new_items,
        "new_products_total": new_total,
        "updated": updated_items,
        "updated_total": updated_total,
        "missing": missing_items,
        "missing_total": missing_total,
        "restoring": restoring_items,
        "restoring_total": restoring_total,
        "pending": new_total + updated_total + restoring_total + missing_total,
        "enrichment_failures": enrichment_failures,
        "enrichment_setup_error": enrichment_setup_error,
        "site_prompt_status": meta_prompt_status,
        "site_prompt_addendum": meta_prompt_addendum,
    }


def _load_prompt_hints(db) -> dict[str, str]:
    """Pre-load every roaster's `enrichment_prompt_hint` in one query
    so the per-product loop looks up by slug in O(1)."""
    rows = db.execute(
        "SELECT roaster_slug, enrichment_prompt_hint "
        "FROM roaster_profiles "
        "WHERE enrichment_prompt_hint IS NOT NULL AND enrichment_prompt_hint != ''"
    ).fetchall()
    return {r["roaster_slug"]: r["enrichment_prompt_hint"] for r in rows}


def _meta_sample_extracted(p: dict) -> dict:
    """Compact subset of a merged product dict for the meta-prompt
    generator. Drops storage-only fields (`source`, scraper raw
    data) and anything still empty so the meta-call sees only the
    useful signal."""
    keys = (
        "is_coffee_bean", "coffee_name", "origin", "altitude_masl",
        "roast_level", "roast_level_name", "process_raw", "process",
        "varietal", "bean_type", "weight_grams", "producer",
        "tasting_notes", "flavor_notes", "roaster_blurb",
        "brew_recommendation_json", "enrichment_status",
    )
    out = {}
    for k in keys:
        v = p.get(k)
        if v is None or v == "" or v == [] or v == {}:
            continue
        out[k] = v
    return out


# Columns that the scraper writes, that we use for the diff check.
COMPARE_COLS = (
    "roaster_slug", "roaster_name", "coffee_name", "roast_level",
    "tasting_notes", "origin", "process", "varietal", "altitude_masl",
    "bean_type", "flavor_notes", "weight_grams", "price_inr",
    "image_url", "product_url", "available",
)


def _row_diff(existing: dict, proposed: dict) -> bool:
    """Return True if the scrape's proposed row differs from the
    existing row on any column the scraper actually controls."""
    for col in COMPARE_COLS:
        if existing.get(col) != proposed.get(col):
            return True
    return False


def _empty_summary() -> dict:
    return {
        "scraped": 0, "skipped": 0,
        "new_products": [], "new_products_total": 0,
        "updated": [], "updated_total": 0,
        "missing": [], "missing_total": 0,
        "restoring": [], "restoring_total": 0,
        "pending": 0,
    }


def _insert_proposal(db, job_id: int, product_id: str, change_type: str,
                      *, proposed_state: dict | None, prev_state: dict | None,
                      now: str) -> None:
    db.execute(
        "INSERT INTO scrape_proposals "
        "(job_id, product_id, change_type, proposed_state_json, "
        " prev_state_json, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
        (
            job_id, product_id, change_type,
            json.dumps(proposed_state) if proposed_state is not None else None,
            json.dumps(prev_state) if prev_state is not None else None,
            now,
        ),
    )


# ── Apply / reject / undo helpers ──────────────────────────────────────────

def apply_proposal(db, proposal: dict) -> None:
    """Commit a single proposal to the `products` table. The owner-controlled
    `source` column survives the apply so a roaster's edits aren't
    overwritten."""
    pid = proposal["product_id"]
    ctype = proposal["change_type"]
    proposed = json.loads(proposal["proposed_state_json"]) if proposal["proposed_state_json"] else None
    prev = json.loads(proposal["prev_state_json"]) if proposal["prev_state_json"] else None

    if ctype == "insert":
        if not proposed:
            return
        _exec_insert(db, pid, proposed)
    elif ctype in ("update", "restore_available"):
        if not proposed:
            return
        # Re-read the existing row so we coalesce against the LATEST
        # owner-controlled values, not the snapshot we took at scrape time.
        live = db.execute(
            f"SELECT {PRODUCT_LITE_COLS} FROM products WHERE product_id = ?",
            (pid,),
        ).fetchone()
        live_dict = _product_lite_from_row(live) if live else (prev or {})
        _exec_update(db, pid, proposed, live_dict)
    elif ctype == "mark_sold_out":
        db.execute("UPDATE products SET available = 0 WHERE product_id = ?", (pid,))
    db.commit()


def revert_proposal(db, proposal: dict) -> None:
    """Reverse an applied proposal. For inserts we delete the row; for
    updates / restores we replay the captured `prev_state`; for
    mark-sold-out we set `available=1`."""
    pid = proposal["product_id"]
    ctype = proposal["change_type"]
    prev = json.loads(proposal["prev_state_json"]) if proposal["prev_state_json"] else None

    if ctype == "insert":
        # Only delete if the row still looks scraper-owned. If the
        # roaster has claimed it (source flipped to 'roaster'), leave it.
        row = db.execute(
            "SELECT source FROM products WHERE product_id = ?", (pid,)
        ).fetchone()
        if row and row["source"] == "scraped":
            db.execute("DELETE FROM products WHERE product_id = ?", (pid,))
    elif ctype in ("update", "restore_available"):
        if prev:
            live = db.execute(
                f"SELECT {PRODUCT_LITE_COLS} FROM products WHERE product_id = ?",
                (pid,),
            ).fetchone()
            live_dict = _product_lite_from_row(live) if live else prev
            _exec_update(db, pid, prev, live_dict)
    elif ctype == "mark_sold_out":
        db.execute("UPDATE products SET available = 1 WHERE product_id = ?", (pid,))
    db.commit()


def _exec_insert(db, pid: str, proposed: dict) -> None:
    db.execute(
        """
        INSERT OR IGNORE INTO products
          (product_id, roaster_slug, roaster_name, coffee_name, roast_level,
           tasting_notes, origin, process, varietal, altitude_masl, bean_type,
           flavor_notes, weight_grams, price_inr, image_url, product_url,
           description_raw, available, source, process_raw, producer,
           brew_recommendation_json, enrichment_status,
           roast_level_name, roaster_blurb,
           origin_region, varietal_canonical, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?,
                'scraped', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid,
            proposed.get("roaster_slug"),
            proposed.get("roaster_name"),
            proposed.get("coffee_name"),
            proposed.get("roast_level"),
            proposed.get("tasting_notes"),
            proposed.get("origin"),
            proposed.get("process"),
            proposed.get("varietal"),
            proposed.get("altitude_masl"),
            proposed.get("bean_type"),
            proposed.get("flavor_notes"),
            proposed.get("weight_grams"),
            proposed.get("price_inr"),
            proposed.get("image_url"),
            proposed.get("product_url"),
            proposed.get("available", 1),
            proposed.get("process_raw"),
            proposed.get("producer"),
            proposed.get("brew_recommendation_json"),
            proposed.get("enrichment_status") or "pending",
            proposed.get("roast_level_name"),
            proposed.get("roaster_blurb"),
            proposed.get("origin_region"),
            proposed.get("varietal_canonical"),
            _now(),
        ),
    )


def _exec_update(db, pid: str, target: dict, live: dict) -> None:
    """Update with `source` coalesced from `live` so it survives. Phase-1
    enrichment columns (process_raw / producer / brew_recommendation_json /
    enrichment_status) overwrite — they're scraper-owned, not roaster-
    owned."""
    db.execute(
        """
        UPDATE products SET
            roaster_slug = ?,
            roaster_name = ?,
            coffee_name = ?,
            roast_level = ?,
            tasting_notes = ?,
            origin = ?,
            process = ?,
            varietal = ?,
            altitude_masl = ?,
            bean_type = ?,
            flavor_notes = ?,
            weight_grams = ?,
            price_inr = ?,
            image_url = ?,
            product_url = ?,
            available = ?,
            process_raw = ?,
            producer = ?,
            brew_recommendation_json = ?,
            enrichment_status = ?,
            roast_level_name = ?,
            roaster_blurb = ?,
            origin_region = ?,
            varietal_canonical = ?,
            source = COALESCE(?, source)
        WHERE product_id = ?
        """,
        (
            target.get("roaster_slug"),
            target.get("roaster_name"),
            target.get("coffee_name"),
            target.get("roast_level"),
            target.get("tasting_notes"),
            target.get("origin"),
            target.get("process"),
            target.get("varietal"),
            target.get("altitude_masl"),
            target.get("bean_type"),
            target.get("flavor_notes"),
            target.get("weight_grams"),
            target.get("price_inr"),
            target.get("image_url"),
            target.get("product_url"),
            target.get("available", 1),
            target.get("process_raw"),
            target.get("producer"),
            target.get("brew_recommendation_json"),
            target.get("enrichment_status") or "pending",
            target.get("roast_level_name"),
            target.get("roaster_blurb"),
            target.get("origin_region"),
            target.get("varietal_canonical"),
            live.get("source"),
            pid,
        ),
    )


# Backward-compatible alias — `services.catalog_ops.run_scrape_job` still
# imports `upsert_scraped_products`. Keep the name pointing at the new
# proposal-based flow so older call sites keep working.
def upsert_scraped_products(db, *, job_id: int | None = None) -> dict:
    if job_id is None:
        # Legacy call without a job — synthesize one so the proposals
        # have a valid foreign key. Should never happen in normal flow.
        cur = db.execute(
            "INSERT INTO jobs (kind, status, started_by, created_at) "
            "VALUES ('scrape', 'succeeded', 1, ?)",
            (_now(),),
        )
        job_id = cur.lastrowid
        db.commit()
    return stage_scrape_proposals(db, job_id)


def stamp_sources_scraped(db, *, roaster_slug: str | None = None) -> int:
    """Set `last_scraped_at = now()` on the source rows that were just
    scraped.

    Two modes:
      • `roaster_slug` set — per-roaster run from the roaster page.
        Stamps every source row whose website matches THIS roaster's
        profile.website (case-insensitive, www./trailing-slash drift
        tolerated). Honors enabled=0 too: the per-roaster run path
        deliberately ignores the enabled flag (the button IS the
        kick), so the stamp must too. Without this, freshly-enriched
        roasters showed "Catalog not enriched yet" forever because
        the legacy `enabled=1` filter excluded them.
      • `roaster_slug` None — bulk run. Falls back to the legacy
        behaviour: stamp every enabled source.
    """
    now = _now()
    if roaster_slug:
        # Resolve the canonical website + alt forms from the profile,
        # then UPDATE every source row that matches any of them.
        prof = db.execute(
            "SELECT website FROM roaster_profiles WHERE roaster_slug = ?",
            (roaster_slug,),
        ).fetchone()
        if not prof or not prof["website"]:
            return 0
        forms = _website_form_variants(prof["website"])
        placeholders = ",".join("?" * len(forms))
        cur = db.execute(
            f"UPDATE roaster_sources SET last_scraped_at = ? "
            f"WHERE LOWER(website) IN ({placeholders})",
            (now, *[f.lower() for f in forms]),
        )
        db.commit()
        return cur.rowcount
    cur = db.execute(
        "UPDATE roaster_sources SET last_scraped_at = ? WHERE enabled = 1",
        (now,),
    )
    db.commit()
    return cur.rowcount


def _website_form_variants(url: str) -> list[str]:
    """Return every plausible form a website might be stored as so a
    drift-tolerant LOWER(website) IN (...) lookup catches them all.

    Example: input `https://www.leocoffee.co.in/` →
        [
          'https://www.leocoffee.co.in/',
          'https://www.leocoffee.co.in',
          'https://leocoffee.co.in/',
          'https://leocoffee.co.in',
          'http://www.leocoffee.co.in/',
          'http://www.leocoffee.co.in',
          'http://leocoffee.co.in/',
          'http://leocoffee.co.in',
        ]
    """
    if not url:
        return []
    s = url.strip()
    if "://" in s:
        scheme, rest = s.split("://", 1)
        scheme = scheme.lower()
    else:
        rest = s
    if "/" in rest:
        host, path = rest.split("/", 1)
        path = "/" + path
    else:
        host, path = rest, ""
    host = host.lower()
    bare_host = host[4:] if host.startswith("www.") else host
    www_host = host if host.startswith("www.") else f"www.{host}"
    paths = [path]
    if path == "" or path == "/":
        paths = ["", "/"]
    elif path.endswith("/"):
        paths = [path, path.rstrip("/")]
    else:
        paths = [path, path + "/"]
    forms: set[str] = set()
    for sch in ("https", "http"):
        for h in (bare_host, www_host):
            for p in paths:
                forms.add(f"{sch}://{h}{p}")
    return sorted(forms)


def truncate_log(text: str, max_bytes: int = 10_240) -> str:
    """Keep the last ~10KB of the subprocess log. Multi-byte safe — splits
    on byte length, then decodes from the first newline boundary."""
    if not text:
        return ""
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    tail = encoded[-max_bytes:]
    # Skip until the next newline so we don't cut a UTF-8 character or
    # half a log line.
    nl = tail.find(b"\n")
    if nl >= 0 and nl < len(tail) - 1:
        tail = tail[nl + 1:]
    return "...[truncated]...\n" + tail.decode("utf-8", errors="replace")


def fetch_roaster_title(url: str) -> str:
    """Cheap HTML-only fetch to populate the `name` column when the admin
    adds a new source via the URL input. Imports `urllib` from the stdlib
    so we don't pull in `requests` for the API process.

    Returns the raw <title> stripped, or '' on any failure. Falls through
    silently — if we can't read a title, the admin can edit the row by
    hand later.
    """
    import re as _re
    import urllib.request
    from urllib.parse import urlparse

    if not url or not url.startswith(("http://", "https://")):
        return ""
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "CremaBot/1.0 (admin tab)"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read(50_000).decode("utf-8", errors="ignore")
        m = _re.search(r"<title[^>]*>([^<]+)</title>", html, _re.I)
        if m:
            return m.group(1).strip()
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""
