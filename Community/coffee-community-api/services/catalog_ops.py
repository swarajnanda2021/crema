"""
Catalog Ops — job lifecycle + first-boot seeding for the admin tabs.

Two responsibilities:

  * `seed_initial_state(conn)` — populates `roaster_sources` from the
    on-disk catalog JSON, `sca_addresses` from
    `tasting_notes_tags/tag_resolutions.json`, and `sca_tree_versions`
    with the canonical SCA tree. Idempotent; called from
    `database.init_db()` after the new tables exist.

  * `enqueue_*` / `run_*_job` helpers — called from the admin endpoints
    in `routes/specific.py`. Each `run_*` function opens its own DB
    connection (so it survives the request returning) and writes status
    + log_tail back to the `jobs` row.

Per LAUNCH_TODO §3.8 this is the v0 sync-in-process flow. The prod
hardening (queue worker, separate machine, restart safety, log file
persistence) is parked.
"""

from __future__ import annotations

import datetime
import json
import subprocess
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Optional

from database import get_db
from services import sca_geolocator, scrape_runner

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CATALOG_SEED_PATH = PROJECT_ROOT / "Scraper" / "verified_roasters_catalog.json"
# Tag resolutions live alongside their generator scripts in
# tasting_notes_tags/ — moved out of tmp/ so the exploratory
# pipeline + its cached output are colocated. The seeder is
# gated on `sca_addresses` being empty so this only fires once.
RESOLUTIONS_SEED_PATH = PROJECT_ROOT / "tasting_notes_tags" / "tag_resolutions.json"


# ── Time helper ─────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── First-boot seeding ──────────────────────────────────────────────────────

def seed_initial_state(conn) -> None:
    """Run the first-boot seed exactly once.

    Each seed step is gated on "the relevant table is empty" — so a row
    the admin deletes (or disables) stays gone across every subsequent
    backend reload, instead of getting silently re-created the next
    time uvicorn's `--reload` re-imports `database.init_db`. Without
    this gate the verified-catalog seed used to re-insert its 39 rows
    on every code change.
    """
    # Recover orphan jobs first — any `running` row at server boot
    # was abandoned by a worker that died mid-execution (uvicorn
    # killed during a scrape, OS crash, OOM, etc.). The worker can't
    # come back to call `mark_finished`, so the row would otherwise
    # block `enqueue_job` indefinitely with a 409. Idempotent — once
    # all running rows are flipped, subsequent boots are no-ops.
    recover_orphan_jobs(conn)
    _seed_roaster_sources_combined(conn)
    _seed_sca_addresses(conn)
    _seed_sca_tree(conn)
    # Swap canonical SCA → crema_tree_v1 once. Wipes both sca_addresses
    # and sca_tree_versions, then re-seeds the active row inline so the
    # post-condition is "v1 is active, addresses empty, ready for the
    # admin to run Standardization > Tasting." Gated on PRAGMA
    # user_version so it runs exactly once per database.
    reset_for_flavor_schema_v3(conn)
    # Restore verbatim experimental-process text on rows already
    # overwritten by the prior writeback, then wipe process_addresses
    # so the next Standardization Process re-classifies with the new
    # display_label column populated.
    restore_experimental_process_verbatim(conn)
    reset_process_addresses_for_display_label(conn)
    # Wipe legacy proposals + prior scrape jobs once. The first iteration
    # of the workflow auto-applied scrape diffs and then a subsequent
    # backfill marked them as `applied` proposals — which made Undo on
    # those jobs destructive (it deleted real catalog products that the
    # admin considered original). Clearing the slate gives the new
    # approval-first flow a clean queue. Gated on PRAGMA user_version so
    # the wipe runs exactly once per database.
    _cleanup_legacy_proposals(conn)
    # Normalize roaster website URLs across both `roaster_profiles` and
    # `roaster_sources` so the website-form drift (http vs https, www.
    # vs bare, trailing slash) stops fragmenting otherwise-identical
    # roasters. Gated on PRAGMA user_version so it runs exactly once.
    normalize_roaster_websites(conn)
    # Backfill `last_scraped_at` for sources whose linked roaster
    # already has products but never got the stamp because the legacy
    # per-roaster runs never threaded `roaster_slug` through to the
    # bulk-mode stamper. Must run AFTER `normalize_roaster_websites`
    # so the website-match join works on the canonical form. Gated on
    # PRAGMA user_version so it runs exactly once.
    backfill_last_scraped_at(conn)
    # Populate `origin_region` + `varietal_canonical` for every
    # existing product so the Discover filter drawer has chip-ready
    # data on next app launch. Uses the same `services.canonicalize`
    # helpers that the per-scrape staging path now calls inline.
    # Gated on PRAGMA user_version so it runs exactly once.
    backfill_canonical_columns(conn)
    # Collapse the 10-bucket article topic taxonomy into the 7-bucket
    # v4 scheme (brew / roast / origins / taste / lifestyle / news /
    # misc). Programmatic mapping for the bulk + a tight title-regex
    # carve-out for the roast cluster. Gated on PRAGMA user_version
    # >= 9 so it runs exactly once per DB.
    migrate_topic_categories_v4(conn)


def _seed_roaster_sources_combined(conn) -> None:
    """Combined verified-catalog + roaster_profiles seeder. Runs ONLY
    when `roaster_sources` is empty so admin edits (delete, disable,
    add) are never reverted by a subsequent server restart."""
    existing_count = conn.execute(
        "SELECT COUNT(*) FROM roaster_sources"
    ).fetchone()[0]
    if existing_count > 0:
        # Table is already populated — admin curation wins. Subsequent
        # additions to the verified catalog or roaster_profiles can be
        # backfilled manually via the admin tab's "Add" input.
        return

    now = _now()
    inserted_verified = 0
    inserted_unverified = 0
    seen_websites: set[str] = set()

    # Pass 1 — verified catalog (enabled=1).
    if CATALOG_SEED_PATH.exists():
        try:
            with open(CATALOG_SEED_PATH) as f:
                catalog = json.load(f)
        except (json.JSONDecodeError, OSError):
            catalog = []
        if isinstance(catalog, list):
            for entry in catalog:
                website = (entry or {}).get("website")
                if not website or website in seen_websites:
                    continue
                conn.execute(
                    "INSERT INTO roaster_sources "
                    "(name, website, shop_url, platform, city, state, enabled, added_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                    (
                        entry.get("name") or website,
                        website,
                        entry.get("shop_url"),
                        entry.get("platform"),
                        entry.get("city"),
                        entry.get("state"),
                        now,
                    ),
                )
                seen_websites.add(website)
                inserted_verified += 1

    # Pass 2 — roaster_profiles fill (enabled=0).
    rows = conn.execute(
        "SELECT roaster_slug, name, website, city, state "
        "FROM roaster_profiles "
        "WHERE website IS NOT NULL AND website <> ''"
    ).fetchall()
    for r in rows:
        website = r["website"]
        if website in seen_websites:
            continue
        conn.execute(
            "INSERT INTO roaster_sources "
            "(name, website, shop_url, platform, city, state, enabled, added_at) "
            "VALUES (?, ?, NULL, NULL, ?, ?, 0, ?)",
            (r["name"] or r["roaster_slug"], website, r["city"], r["state"], now),
        )
        seen_websites.add(website)
        inserted_unverified += 1

    if inserted_verified or inserted_unverified:
        conn.commit()
        print(
            f"Catalog-ops seed: inserted {inserted_verified} verified + "
            f"{inserted_unverified} unverified roaster_sources rows "
            f"(fresh-table seed, runs once)"
        )


def _seed_sca_addresses(conn) -> None:
    """Import the cached tag → address resolutions from
    `tasting_notes_tags/tag_resolutions.json` — but only on a fresh
    table. Once the admin starts running classification jobs, the
    runner writes here and we don't want a stale cache file
    resurrecting deleted rows on the next restart.

    Skipped entirely once `PRAGMA user_version >= 5` (crema_tree_v1
    swap). The cached JSON is keyed on canonical SCA branch names
    (`Sour/Fermented`, `Brown Sugar`, etc.) that are invalid under
    the new tree; re-importing it would just reinsert garbage.
    """
    cur = conn.execute("PRAGMA user_version")
    if cur.fetchone()[0] >= 5:
        return
    existing_count = conn.execute(
        "SELECT COUNT(*) FROM sca_addresses"
    ).fetchone()[0]
    if existing_count > 0:
        return
    if not RESOLUTIONS_SEED_PATH.exists():
        return
    try:
        with open(RESOLUTIONS_SEED_PATH) as f:
            resolutions = json.load(f)
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(resolutions, dict):
        return
    resolutions.pop("_comment", None)

    now = _now()
    inserted = 0
    for tag, addr in resolutions.items():
        # Address shape — list[1..3] | None.
        if addr is not None and not isinstance(addr, list):
            continue
        t1, t2, t3, is_null = sca_geolocator.address_to_columns(addr)
        conn.execute(
            "INSERT INTO sca_addresses "
            "(tag, address_t1, address_t2, address_t3, is_null, source, "
            " classified_at, model_version) "
            "VALUES (?, ?, ?, ?, ?, 'imported', ?, ?)",
            (tag, t1, t2, t3, is_null, now, sca_geolocator.MODEL_VERSION),
        )
        inserted += 1
    if inserted:
        conn.commit()
        print(f"Catalog-ops seed: inserted {inserted} sca_addresses rows (fresh-table)")


def _seed_sca_tree(conn) -> None:
    """No-op shim. v3 schemas are seeded by `reset_for_flavor_schema_v3`
    which both wipes and inserts inline. Kept callable so older
    `_seed_initial_state` orderings don't break."""
    return


# ── Job lifecycle ───────────────────────────────────────────────────────────

class JobConflict(RuntimeError):
    """Raised when a job of the same kind is already queued / running.

    The admin endpoint maps this to HTTP 409 with the live job's id so
    the UI can surface "already running, see job N".
    """
    def __init__(self, message: str, live_job_id: int):
        super().__init__(message)
        self.live_job_id = live_job_id


def get_active_job(db, kind: str) -> Optional[dict]:
    """Return the active (queued or running) job of `kind`, if any."""
    row = db.execute(
        "SELECT * FROM jobs WHERE kind = ? AND status IN ('queued', 'running') "
        "ORDER BY id DESC LIMIT 1",
        (kind,),
    ).fetchone()
    return dict(row) if row else None


def enqueue_job(db, kind: str, started_by: int,
                  *, bypass_mutex: bool = False) -> int:
    """Insert a new job row in `queued` state. Raises `JobConflict` if a
    job of the same kind is already live.

    `bypass_mutex=True` (refactored per-roaster flow): skip the
    same-kind-already-running check entirely. Used by the new
    orchestrator path which runs each roaster's scrape in its own
    isolated workspace (`/tmp/crema-scrape/{slug}-{ts}/`), so the
    file-collision concern that motivated the original mutex doesn't
    apply. Multiple scrapes can run concurrently — the jobs row is
    kept purely for visibility (admin UI's "Recent Enrichment Runs")
    and for the `scrape_proposals.job_id` FK that ties proposals to
    their parent run.
    """
    if not bypass_mutex:
        active = get_active_job(db, kind)
        if active:
            raise JobConflict(
                f"A {kind} job is already {active['status']} (id={active['id']}).",
                live_job_id=active["id"],
            )
    cur = db.execute(
        "INSERT INTO jobs (kind, status, started_by, created_at) "
        "VALUES (?, 'queued', ?, ?)",
        (kind, started_by, _now()),
    )
    db.commit()
    return cur.lastrowid


def mark_running(db, job_id: int) -> None:
    db.execute(
        "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
        (_now(), job_id),
    )
    db.commit()


def mark_finished(db, job_id: int, *, status: str,
                   error_message: str | None = None,
                   log_tail: str | None = None,
                   result_summary: dict | None = None) -> None:
    db.execute(
        "UPDATE jobs SET status = ?, finished_at = ?, error_message = ?, "
        "log_tail = ?, result_summary = ? WHERE id = ?",
        (
            status,
            _now(),
            error_message,
            log_tail,
            json.dumps(result_summary) if result_summary is not None else None,
            job_id,
        ),
    )
    db.commit()


# ── Background runners ──────────────────────────────────────────────────────
#
# Each `run_*_job` is invoked by FastAPI's BackgroundTasks. It opens its
# own DB connection (the request-scoped one is closed by the time this
# fires) and writes status + log_tail back to the `jobs` row.

def run_scrape_job(
    job_id: int,
    *,
    roaster_slug: str | None = None,
    regenerate_prompt: bool = False,
) -> None:
    """Scrape `roaster_sources` rows (all enabled, or just one when the
    BEANS dropdown picks a single roaster), stage proposals, stamp
    `last_scraped_at`.

    While the subprocess streams output, we flush the rolling log into
    `jobs.log_tail` every couple of seconds so the admin tab can poll
    and render the verbose `[1/39] roaster ... done` chatter live —
    not just on completion.

    Phase 6 follow-up: when `roaster_slug` is set the runner threads it
    through to `stage_scrape_proposals` along with `regenerate_prompt`,
    which together drive the per-roaster site prompt addendum. The
    addendum is generated by `services.site_prompt_generator` once
    per roaster (or whenever the admin toggles the regen flag) and
    Haiku prepends it to its system prompt on every subsequent run
    for that roaster.
    """
    # Re-stamp the pipeline contextvar — threading.Thread doesn't
    # inherit contextvars from the parent task, so without this
    # every call_llm enqueued from this thread would label its
    # llm_jobs row with roaster_slug='unknown'. Without this, the
    # observability surface (filter llm_jobs by slug) is broken for
    # the scrape pipeline. See routes/specific.py:_orchestrate_refresh_all
    # for the parent contextvar setter.
    if roaster_slug:
        try:
            from services.llm_router import set_pipeline_context
            set_pipeline_context(roaster_slug=roaster_slug)
        except Exception:
            pass  # best-effort — router import shouldn't block the scrape
    db = get_db()
    log_lines: list[str] = []
    pending_lines: list[str] = []
    pending_lock = threading.Lock()
    last_flush = [time.monotonic()]

    def log(line: str) -> None:
        ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
        prefixed = f"[{ts}] {line}"
        log_lines.append(prefixed)
        # Also queue for the next live-flush so internal log() calls
        # (not just subprocess stdout) appear in the streaming feed.
        with pending_lock:
            pending_lines.append(prefixed)

    def stream_line(line: str) -> None:
        with pending_lock:
            pending_lines.append(line)
            log_lines.append(line)
        # Flush at most every 1.5s — enough to stream a 30-min scrape
        # without hammering SQLite.
        now_t = time.monotonic()
        if now_t - last_flush[0] >= 1.5:
            _flush_log_tail()

    def _flush_log_tail() -> None:
        with pending_lock:
            tail_text = scrape_runner.truncate_log("\n".join(log_lines))
            pending_lines.clear()
        last_flush[0] = time.monotonic()
        try:
            # Use a separate connection — the main `db` may be mid-
            # transaction with the upsert step. SQLite locks if two
            # writers race; this update is short and idempotent.
            live = get_db()
            try:
                live.execute(
                    "UPDATE jobs SET log_tail = ? WHERE id = ?",
                    (tail_text, job_id),
                )
                live.commit()
            finally:
                live.close()
        except Exception:
            # Best-effort: a missed flush is fine; the next one tries
            # again, and the final mark_finished writes a complete tail.
            pass

    try:
        mark_running(db, job_id)
        log(f"starting scrape (scope={roaster_slug or 'all enabled'})")
        sources_count = scrape_runner.write_input_catalog(db, roaster_slug=roaster_slug)
        log(f"wrote {sources_count} enabled sources to scraper input")
        _flush_log_tail()

        if sources_count == 0:
            mark_finished(
                db, job_id, status="succeeded",
                log_tail="\n".join(log_lines + ["no enabled sources — nothing to scrape"]),
                result_summary={
                    "scraped": 0, "skipped": 0,
                    "new_products": [], "new_products_total": 0,
                    "updated": [], "updated_total": 0,
                    "missing": [], "missing_total": 0,
                    "sources": 0,
                },
            )
            return

        try:
            returncode, subprocess_out = scrape_runner.invoke_scraper(on_line=stream_line)
        except subprocess.TimeoutExpired as e:
            log("scraper timed out after 30 min")
            mark_finished(
                db, job_id, status="failed",
                error_message="Scraper timed out after 30 min.",
                log_tail=scrape_runner.truncate_log("\n".join(log_lines) + "\n" + (e.stdout or "")),
            )
            return

        if returncode != 0:
            log(f"scraper exited with returncode={returncode}")
            mark_finished(
                db, job_id, status="failed",
                error_message=f"Scraper subprocess exited with code {returncode}",
                log_tail=scrape_runner.truncate_log("\n".join(log_lines)),
            )
            return

        log("scraper completed; staging proposals + per-product enrichment")
        _flush_log_tail()
        upsert_summary = scrape_runner.stage_scrape_proposals(
            db, job_id, log=log,
            roaster_slug=roaster_slug,
            regenerate_prompt=regenerate_prompt,
        )
        log(
            f"staged: scraped={upsert_summary['scraped']} "
            f"new={upsert_summary['new_products_total']} "
            f"updated={upsert_summary['updated_total']} "
            f"restoring={upsert_summary['restoring_total']} "
            f"missing={upsert_summary['missing_total']} "
            f"skipped={upsert_summary['skipped']} "
            f"enrich-fail={upsert_summary.get('enrichment_failures', 0)} "
            f"awaiting admin review"
        )
        if upsert_summary.get("enrichment_setup_error"):
            log(f"note: {upsert_summary['enrichment_setup_error']}")
        stamped = scrape_runner.stamp_sources_scraped(db, roaster_slug=roaster_slug)
        log(f"stamped {stamped} sources with last_scraped_at")

        mark_finished(
            db, job_id, status="succeeded",
            log_tail=scrape_runner.truncate_log("\n".join(log_lines)),
            result_summary={**upsert_summary, "sources": sources_count},
        )
    except Exception as e:
        log(f"unexpected error: {type(e).__name__}: {e}")
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail="\n".join(log_lines)[-10_000:],
            )
        except Exception:
            pass
    finally:
        db.close()


# ── Agent-first per-roaster runners (no scrape mutex) ──────────────────────
#
# These bypass the global `scrape` / `article_scrape` kind mutex by passing
# `bypass_mutex=True` to enqueue_job, and isolate the subprocess workspace
# under /tmp/crema-scrape/{slug}-{ts}/ so concurrent runs don't collide on
# the legacy Scraper/input/ + Scraper/output/ files. The visibility jobs
# row + the scrape_proposals.job_id FK are preserved so the admin's
# "Recent Enrichment Runs" panel keeps working.
#
# Compared to `run_scrape_job`:
#   - No live log_tail streaming (the per-roaster run is short — ~30-120s);
#     the final log lines land in the jobs row at completion only.
#   - No JobConflict possible — the mutex is bypassed.
#   - Per-roaster scrape workspace prevents file-collision races.
#   - Uses set_pipeline_context() at the top so every call_llm inside the
#     thread's scope labels its llm_jobs row with the right roaster_slug.

def scrape_one_roaster(
    *,
    roaster_slug: str,
    user_id: int,
    regenerate_prompt: bool = False,
) -> dict:
    """Run a catalog scrape for ONE roaster in an isolated workspace.

    Owns its own DB connection (intended to be called as the target of
    a threading.Thread, where the parent's db is already closed by the
    time this runs).

    Concurrency-safe vs. other roasters' scrapes — the subprocess
    writes to `/tmp/crema-scrape/{slug}-{ts}/output/`, not the shared
    `Scraper/output/`.

    Returns the final result_summary dict (same shape as run_scrape_job
    persists into jobs.result_summary). On failure, returns a dict with
    an `error` key set; the visibility row is still marked finished so
    the admin sees the failure.
    """
    from services.llm_router import set_pipeline_context
    set_pipeline_context(roaster_slug=roaster_slug)

    db = get_db()
    workspace = scrape_runner.ScrapeWorkspace(roaster_slug)
    log_lines: list[str] = []

    def log(line: str) -> None:
        ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
        log_lines.append(f"[{ts}] {line}")

    log(f"per-roaster scrape (workspace={workspace.root})")

    # Visibility row — bypass the mutex; proposals reference its id.
    try:
        job_id = enqueue_job(
            db, "scrape", started_by=user_id, bypass_mutex=True,
        )
    except Exception as e:
        log(f"failed to enqueue visibility row: {type(e).__name__}: {e}")
        workspace.cleanup()
        return {"error": f"enqueue failed: {e}"}

    mark_running(db, job_id)

    try:
        sources_count = scrape_runner.write_input_catalog(
            db, roaster_slug=roaster_slug, workspace=workspace,
        )
        log(f"wrote {sources_count} source(s) to {workspace.input_path}")

        if sources_count == 0:
            mark_finished(
                db, job_id, status="succeeded",
                log_tail="\n".join(log_lines + ["no enabled sources"]),
                result_summary={
                    "scraped": 0, "skipped": 0,
                    "new_products": [], "new_products_total": 0,
                    "updated": [], "updated_total": 0,
                    "missing": [], "missing_total": 0,
                    "sources": 0,
                },
            )
            workspace.cleanup()
            return {"sources": 0}

        try:
            returncode, _ = scrape_runner.invoke_scraper(
                workspace=workspace,
            )
        except subprocess.TimeoutExpired as e:
            log("scraper timed out after 30 min")
            mark_finished(
                db, job_id, status="failed",
                error_message="Scraper timed out after 30 min.",
                log_tail=scrape_runner.truncate_log("\n".join(log_lines)),
            )
            workspace.cleanup()
            return {"error": "scraper timeout"}

        if returncode != 0:
            log(f"scraper exited with returncode={returncode}")
            mark_finished(
                db, job_id, status="failed",
                error_message=f"Scraper subprocess exited with code {returncode}",
                log_tail=scrape_runner.truncate_log("\n".join(log_lines)),
            )
            workspace.cleanup()
            return {"error": f"scraper exit {returncode}"}

        log("scraper completed; staging proposals + per-product enrichment")
        upsert_summary = scrape_runner.stage_scrape_proposals(
            db, job_id, log=log,
            roaster_slug=roaster_slug,
            regenerate_prompt=regenerate_prompt,
            workspace=workspace,
        )
        log(
            f"staged: scraped={upsert_summary['scraped']} "
            f"new={upsert_summary['new_products_total']} "
            f"updated={upsert_summary['updated_total']} "
            f"restoring={upsert_summary.get('restoring_total', 0)} "
            f"missing={upsert_summary['missing_total']} "
            f"skipped={upsert_summary['skipped']}"
        )
        if upsert_summary.get("enrichment_setup_error"):
            log(f"note: {upsert_summary['enrichment_setup_error']}")
        stamped = scrape_runner.stamp_sources_scraped(
            db, roaster_slug=roaster_slug,
        )
        log(f"stamped {stamped} sources with last_scraped_at")

        mark_finished(
            db, job_id, status="succeeded",
            log_tail=scrape_runner.truncate_log("\n".join(log_lines)),
            result_summary={**upsert_summary, "sources": sources_count},
        )
        return {**upsert_summary, "sources": sources_count}
    except Exception as e:
        log(f"unexpected error: {type(e).__name__}: {e}")
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail="\n".join(log_lines)[-10_000:],
            )
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        workspace.cleanup()
        db.close()


def article_scrape_one_roaster(
    *,
    roaster_slug: str,
    user_id: int,
    regenerate_article_hint: bool = False,
) -> dict:
    """Run an article scrape for ONE roaster, bypassing the mutex.

    Articles don't use a subprocess (`article_scraper.upsert_article`
    runs in-process) so there's no file-collision concern — the mutex
    on `article_scrape` was purely for symmetry with `scrape`. This
    runner just delegates to the existing `run_article_scrape_job`
    helper via a bypass-mutex enqueue.

    Returns the result_summary dict.
    """
    from services.llm_router import set_pipeline_context
    set_pipeline_context(roaster_slug=roaster_slug)

    db = get_db()
    try:
        try:
            job_id = enqueue_job(
                db, "article_scrape", started_by=user_id, bypass_mutex=True,
            )
        except Exception as e:
            return {"error": f"enqueue failed: {e}"}
    finally:
        db.close()

    # Reuse the full per-job runner — it already handles in-process
    # article discovery + enrichment + hint regen + jobs-row lifecycle
    # (and opens its own DB connection internally). The mutex bypass
    # above is the only refactor needed for articles since they don't
    # use a subprocess.
    run_article_scrape_job(
        job_id,
        roaster_slug=roaster_slug,
        regenerate_article_hint=regenerate_article_hint,
    )

    # Re-fetch the row to surface the final summary.
    db = get_db()
    try:
        row = db.execute(
            "SELECT status, result_summary FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return {"error": "article job row vanished"}
        try:
            summary = json.loads(row["result_summary"]) if row["result_summary"] else {}
        except Exception:
            summary = {}
        return {**summary, "job_id": job_id, "status": row["status"]}
    finally:
        db.close()


def list_proposals(db, *, job_id: int | None = None,
                    status: str | None = None) -> list[dict]:
    """Read pending / applied / etc. proposals. Returns rows with the
    JSON columns parsed so the admin tab can render thumbnails directly."""
    sql = (
        "SELECT id, job_id, product_id, change_type, proposed_state_json, "
        "prev_state_json, status, applied_at, reverted_at, rejected_at, created_at "
        "FROM scrape_proposals"
    )
    where = []
    params: list = []
    if job_id is not None:
        where.append("job_id = ?")
        params.append(job_id)
    if status is not None:
        where.append("status = ?")
        params.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id ASC"
    rows = db.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        for col in ("proposed_state_json", "prev_state_json"):
            if d.get(col):
                try:
                    d[col.replace("_json", "")] = json.loads(d[col])
                except (json.JSONDecodeError, TypeError):
                    d[col.replace("_json", "")] = None
            else:
                d[col.replace("_json", "")] = None
        out.append(d)
    return out


def approve_proposals(db, ids: list[int]) -> dict:
    """Apply each pending proposal in `ids` and mark it applied. Returns
    counts of what was applied vs skipped (already-applied / unknown)."""
    applied = 0
    skipped = 0
    now = _now()
    for pid in ids:
        row = db.execute(
            "SELECT * FROM scrape_proposals WHERE id = ?", (pid,)
        ).fetchone()
        if not row or row["status"] != "pending":
            skipped += 1
            continue
        prop = dict(row)
        try:
            scrape_runner.apply_proposal(db, prop)
        except Exception:
            skipped += 1
            continue
        db.execute(
            "UPDATE scrape_proposals SET status = 'applied', applied_at = ? "
            "WHERE id = ?",
            (now, pid),
        )
        applied += 1
    db.commit()
    return {"applied": applied, "skipped": skipped}


def reject_proposals(db, ids: list[int]) -> dict:
    """Mark proposals as rejected (admin chose not to apply). No DB
    change to `products`."""
    now = _now()
    rejected = 0
    skipped = 0
    for pid in ids:
        row = db.execute(
            "SELECT status FROM scrape_proposals WHERE id = ?", (pid,)
        ).fetchone()
        if not row or row["status"] != "pending":
            skipped += 1
            continue
        db.execute(
            "UPDATE scrape_proposals SET status = 'rejected', rejected_at = ? "
            "WHERE id = ?",
            (now, pid),
        )
        rejected += 1
    db.commit()
    return {"rejected": rejected, "skipped": skipped}


def undo_job(db, job_id: int) -> dict:
    """Reverse every applied proposal from `job_id`. For proposals
    backfilled from prior auto-applied runs (no `prev_state_json`), we
    do a best-effort revert — inserts get deleted; updates without a
    captured prev_state are left alone with a note in the result."""
    rows = db.execute(
        "SELECT * FROM scrape_proposals WHERE job_id = ? AND status = 'applied'",
        (job_id,),
    ).fetchall()
    reverted = 0
    skipped = 0
    skipped_reasons: list[str] = []
    now = _now()
    for r in rows:
        prop = dict(r)
        if prop["change_type"] in ("update", "restore_available") and not prop.get("prev_state_json"):
            skipped += 1
            skipped_reasons.append(prop["product_id"])
            continue
        try:
            scrape_runner.revert_proposal(db, prop)
        except Exception:
            skipped += 1
            continue
        db.execute(
            "UPDATE scrape_proposals SET status = 'reverted', reverted_at = ? "
            "WHERE id = ?",
            (now, prop["id"]),
        )
        reverted += 1
    db.commit()
    return {
        "reverted": reverted,
        "skipped": skipped,
        "skipped_product_ids": skipped_reasons[:20],
    }


def mark_product_sold_out(db, product_id: str, *, started_by: int) -> dict:
    """Manual sold-out: spin up a one-off job + proposal so this change
    is undoable like any other. Different from approving a scrape's
    `mark_sold_out` proposal (that path goes through approve_proposals).
    """
    row = db.execute(
        f"SELECT {scrape_runner.PRODUCT_LITE_COLS} FROM products WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, f"Product {product_id} not found")
    prev = scrape_runner._product_lite_from_row(row)
    if prev["available"] == 0:
        return {"already_sold_out": True}
    now = _now()
    cur = db.execute(
        "INSERT INTO jobs (kind, status, started_by, started_at, finished_at, "
        " result_summary, created_at) "
        "VALUES ('manual_sold_out', 'succeeded', ?, ?, ?, ?, ?)",
        (
            started_by, now, now,
            json.dumps({"product_id": product_id, "manual": True}), now,
        ),
    )
    job_id = cur.lastrowid
    db.execute(
        "INSERT INTO scrape_proposals "
        "(job_id, product_id, change_type, proposed_state_json, prev_state_json, "
        " status, applied_at, created_at) "
        "VALUES (?, ?, 'mark_sold_out', NULL, ?, 'applied', ?, ?)",
        (job_id, product_id, json.dumps(prev), now, now),
    )
    db.execute("UPDATE products SET available = 0 WHERE product_id = ?", (product_id,))
    db.commit()
    return {"job_id": job_id, "product_id": product_id}


def _cleanup_legacy_proposals(conn) -> None:
    """One-shot wipe of pre-approval-flow scrape data. Runs exactly once,
    gated by SQLite's `PRAGMA user_version` so re-imports don't replay it.

    Removes:
      * Every existing `scrape_proposals` row (auto-apply era + backfill
        artifacts, both of which created surprising Undo behaviour).
      * Every `jobs` row with kind in ('scrape', 'manual_sold_out') —
        their proposals just got deleted, so leaving the bare history
        rows would only show empty carousels with no admin recourse.

    Catalog `products` themselves are left untouched. The next scrape
    starts from a clean queue.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 1:
        return

    deleted_props = conn.execute("DELETE FROM scrape_proposals").rowcount
    deleted_jobs = conn.execute(
        "DELETE FROM jobs WHERE kind IN ('scrape', 'manual_sold_out')"
    ).rowcount
    conn.execute("PRAGMA user_version = 1")
    conn.commit()
    if deleted_props or deleted_jobs:
        print(
            f"Catalog-ops cleanup: removed {deleted_props} legacy proposals + "
            f"{deleted_jobs} pre-approval-era scrape jobs (one-shot)"
        )


def _normalize_website(raw: str | None) -> str:
    """Pick a canonical form for a roaster website so two rows that
    point at the same site agree on a single string.

    Rules (host-only — preserves any path beyond the host):
      • Strip whitespace, lowercase the host portion.
      • Force `https://` (drop any `http://` prefix).
      • Strip a leading `www.` from the host.
      • Strip a single trailing `/` from the result.

    Empty / null input round-trips to `""` so the cleanup never invents
    a URL where there isn't one (Sleepy Owl-style: profile has no
    website, scraper-side source row does).
    """
    if not raw:
        return ""
    s = raw.strip()
    if not s:
        return ""
    # Split scheme + rest. Default to https so bare-domain rows
    # ("bilihu.in") get promoted to a full URL.
    if "://" in s:
        scheme, rest = s.split("://", 1)
    else:
        scheme, rest = "https", s
    # Lowercase only the host — paths can be case-sensitive on some
    # servers, so preserve them as-is below.
    if "/" in rest:
        host, path = rest.split("/", 1)
        path = "/" + path
    else:
        host, path = rest, ""
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    out = f"https://{host}{path}"
    # Drop a single trailing `/` only when there's no further path —
    # avoid touching `https://x.com/collections/` since the slash is
    # part of the catalog URL.
    if out.endswith("/") and out.count("/") == 3:
        out = out[:-1]
    return out


def preview_website_normalization(conn) -> dict:
    """Read-only preview of what `normalize_roaster_websites` would
    do. Returns a structured report — no writes. Use this to inspect
    drift causes + collisions before committing the migration.

    Shape:
        {
            "profiles": {
                "would_update": [(slug, old, new), ...],
                "collisions": {normalized_url: [slug, slug, ...]},
            },
            "sources": {
                "would_update": [(old, new), ...],
                "collisions": {normalized_url: [old, old, ...]},
            },
        }
    """
    profiles = conn.execute(
        "SELECT roaster_slug, website FROM roaster_profiles"
    ).fetchall()
    sources = conn.execute(
        "SELECT website FROM roaster_sources"
    ).fetchall()

    def _bucket(rows, key_index):
        would: list[tuple] = []
        normed_to_keys: dict[str, list[str]] = {}
        for row in rows:
            key = row[key_index] if key_index is not None else None
            old = row["website"] or ""
            new = _normalize_website(old)
            if new and new != old:
                would.append((key, old, new) if key is not None else (old, new))
            if new:
                normed_to_keys.setdefault(new, []).append(key if key is not None else old)
        collisions = {k: v for k, v in normed_to_keys.items() if len(v) > 1}
        return {"would_update": would, "collisions": collisions}

    return {
        "profiles": _bucket(profiles, 0),
        "sources": _bucket(sources, None),
    }


def normalize_roaster_websites(conn) -> None:
    """One-shot website canonicalization across `roaster_profiles` and
    `roaster_sources`. Gated on `PRAGMA user_version >= 2` so it runs
    exactly once per database.

    Why: the prior verified-catalog seed and the per-roaster Sonnet
    enrichment landed websites in inconsistent shapes — `http://www.x`
    in profiles vs `https://x` in sources, trailing slashes in some
    rows but not others. The `roaster_sources.website` ↔
    `roaster_profiles.website` join (used by the registry to compute
    `roaster_slug` + `products_count` subfields, and by the BEANS-tab
    filter to attribute scraper state to a profile) silently fails on
    every drift case. Picking one canonical form closes that gap.

    Reports collisions (multiple rows that normalize to the same URL)
    to stdout — those need admin attention since they typically mean
    duplicate roaster identities that should be merged manually.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 2:
        return

    preview = preview_website_normalization(conn)
    p_updates = preview["profiles"]["would_update"]
    s_updates = preview["sources"]["would_update"]
    p_collisions = preview["profiles"]["collisions"]
    s_collisions = preview["sources"]["collisions"]

    # ── Source collision resolution ───────────────────────────────
    # `roaster_sources.website` carries a UNIQUE constraint, so two
    # rows that normalize to the same URL would collide on UPDATE.
    # Pick a winner per collision and delete the losers before the
    # bulk update. Winner heuristic: most-populated row wins (counts
    # platform + shop_url + last_scraped_at as the signal columns);
    # ties broken by most-recently-scraped-at, then by lowest id.
    deleted_source_rows = 0
    for canonical, originals in s_collisions.items():
        rows = conn.execute(
            f"SELECT id, website, platform, shop_url, last_scraped_at "
            f"FROM roaster_sources WHERE website IN ({','.join('?' * len(originals))})",
            originals,
        ).fetchall()
        def score(r):
            return (
                int(bool(r["platform"])) + int(bool(r["shop_url"])) + int(bool(r["last_scraped_at"])),
                r["last_scraped_at"] or "",
                -r["id"],
            )
        winner = max(rows, key=score)
        for r in rows:
            if r["id"] == winner["id"]:
                continue
            conn.execute("DELETE FROM roaster_sources WHERE id = ?", (r["id"],))
            deleted_source_rows += 1

    # Re-fetch the source-side update list now that losers are gone —
    # the winners may already be at the canonical URL (no UPDATE
    # needed) or still at a non-canonical form (UPDATE needed).
    if s_collisions:
        s_updates = [
            (old, new) for (old, new) in s_updates
            if conn.execute(
                "SELECT 1 FROM roaster_sources WHERE website = ?", (old,),
            ).fetchone() is not None
        ]

    # ── Apply the bulk updates ────────────────────────────────────
    for slug, _old, new in p_updates:
        conn.execute(
            "UPDATE roaster_profiles SET website = ? WHERE roaster_slug = ?",
            (new, slug),
        )
    for old, new in s_updates:
        conn.execute(
            "UPDATE roaster_sources SET website = ? WHERE website = ?",
            (new, old),
        )

    conn.execute("PRAGMA user_version = 2")
    conn.commit()

    # Report what landed + what still needs human attention.
    print(
        f"Website normalization: updated {len(p_updates)} profiles + "
        f"{len(s_updates)} sources to canonical https form. "
        f"Merged {deleted_source_rows} duplicate source row(s)."
    )
    if p_collisions:
        print(f"  ⚠ {len(p_collisions)} profile collision(s) — duplicate identities for admin to merge manually:")
        for url, slugs in list(p_collisions.items())[:10]:
            print(f"      {url}")
            for s in slugs:
                print(f"          ← {s}")


def backfill_last_scraped_at(conn) -> None:
    """One-shot backfill: stamp `roaster_sources.last_scraped_at` for
    sources whose linked roaster has products but no scrape stamp.

    Why: every per-roaster enrichment run before `run_scrape_job` was
    patched to thread `roaster_slug` through to `stamp_sources_scraped`
    fell into the bulk-mode `WHERE enabled = 1` filter, which excluded
    the typical `enabled=0` state of per-roaster sources. Result:
    products + Haiku prompt hints exist, yet the per-roaster page
    reads "Catalog not enriched yet" forever.

    Signal: `MAX(products.created_at)` per linked roaster. `created_at`
    is set on INSERT only, so this is the date of the most-recent
    first-seen product — a strict lower bound for "when was this
    catalog last touched." Better than NULL ("never enriched") and
    accurate enough for the relative-age hero text.

    Gated on `PRAGMA user_version >= 3` so it runs exactly once per DB.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 3:
        return

    cur = conn.execute(
        """
        UPDATE roaster_sources
        SET last_scraped_at = (
            SELECT MAX(p.created_at)
            FROM products p, roaster_profiles rp
            WHERE LOWER(rp.website) = LOWER(roaster_sources.website)
              AND p.roaster_slug = rp.roaster_slug
        )
        WHERE last_scraped_at IS NULL
          AND EXISTS (
            SELECT 1 FROM products p, roaster_profiles rp
            WHERE LOWER(rp.website) = LOWER(roaster_sources.website)
              AND p.roaster_slug = rp.roaster_slug
          )
        """
    )
    stamped = cur.rowcount

    conn.execute("PRAGMA user_version = 3")
    conn.commit()

    if stamped:
        print(
            f"Backfill last_scraped_at: stamped {stamped} source(s) "
            f"from products.created_at."
        )


def recover_orphan_jobs(conn) -> None:
    """Mark any `running` jobs as `failed` at server boot, and reset
    any `in_progress` llm_jobs claims back to `pending` so the
    drainer agent can re-claim them cleanly.

    A `jobs.status='running'` row at boot is by definition an orphan
    from a prior worker that died (uvicorn killed mid-scrape, OS
    crash, OOM during per-product Haiku enrichment, --reload while
    a BG task was polling the queue). Without this, `enqueue_job`'s
    in-flight gate refuses every subsequent kick with a 409 until
    the admin hand-edits the row.

    Similarly, an `llm_jobs.status='in_progress'` row at boot is an
    abandoned claim from a drainer that never submitted (the drainer
    died, or the BG task that was waiting on the response gave up).
    Reset claimed_at + agent_identity to NULL and flip status back
    to 'pending' so the next drainer round picks it up. Per the
    agent-first operating model, autonomy means not requiring a
    human or shell-level intervention to unstick stuck queue rows.

    Runs unconditionally — the WHERE clauses are no-ops when no
    orphans exist, so there's nothing to gate on.
    """
    cur = conn.execute(
        "UPDATE jobs SET status = 'failed', "
        "  finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), "
        "  error_message = COALESCE(error_message, '') || "
        "    CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' · ' END || "
        "    'Server restarted while job was running — partial state may be staged.' "
        "WHERE status = 'running'"
    )
    if cur.rowcount > 0:
        conn.commit()
        print(f"Recovered {cur.rowcount} orphan job(s) from prior worker death.")

    # Reset abandoned llm_jobs claims so drainers can re-pick them up.
    cur = conn.execute(
        "UPDATE llm_jobs SET status = 'pending', claimed_at = NULL, "
        "  agent_identity = NULL "
        "WHERE status = 'in_progress'"
    )
    if cur.rowcount > 0:
        conn.commit()
        print(f"Reset {cur.rowcount} stale in_progress llm_job(s) to pending.")


def backfill_canonical_columns(conn) -> None:
    """One-shot backfill: populate `products.origin_region` +
    `products.varietal_canonical` for every existing row.

    These columns drive the Discover filter drawer's Region + Varietal
    chip sets. Per-scrape population happens in
    `scrape_runner._product_lite_from_scraped`; this backfill closes
    the gap for rows that landed before that hook existed.

    The canonicalization is the light-touch regex pass in
    `services/canonicalize.py`. Heavier curation lands later via the
    Coffee Standardization sub-tab (planned). When that ships, this
    backfill stays as the *seed* — admin overrides write into the
    same columns.

    Gated on `PRAGMA user_version >= 4` so it runs exactly once per DB.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 4:
        return

    # Import inside the function to keep `services.canonicalize` out
    # of the module-load graph for environments that don't need it
    # (e.g., test fixtures stub `services.catalog_ops`).
    from services.canonicalize import canonical_region, canonical_varietal

    rows = conn.execute(
        "SELECT product_id, origin, varietal, description_raw FROM products"
    ).fetchall()
    region_updates = 0
    varietal_updates = 0
    for r in rows:
        region = canonical_region(r["origin"], r["description_raw"])
        varietal = canonical_varietal(r["varietal"])
        conn.execute(
            "UPDATE products SET origin_region = ?, varietal_canonical = ? "
            "WHERE product_id = ?",
            (region, varietal, r["product_id"]),
        )
        if region:
            region_updates += 1
        if varietal:
            varietal_updates += 1

    conn.execute("PRAGMA user_version = 4")
    conn.commit()

    print(
        f"Backfill canonical columns: {region_updates}/{len(rows)} rows "
        f"got a region chip, {varietal_updates}/{len(rows)} got a varietal chip."
    )


FLAVOR_SCHEMAS_DIR = Path(__file__).parent / "flavor_schemas"


def _load_seed_schema(filename: str) -> dict:
    """Read a seed schema JSON file from `services/flavor_schemas/`.
    Returns the parsed dict (no validation here — the loader trusts the
    on-disk seed; the upload endpoint runs the schema validator)."""
    with open(FLAVOR_SCHEMAS_DIR / filename) as f:
        return json.load(f)


def reset_for_flavor_schema_v3(conn) -> None:
    """Swap the platform's flavor taxonomy to single-tier v3 schemas.

    v1 was multi-tier (10 T1 · 39 T2 · 28 T3) with a bottom-semicircle
    wheel that drilled T1→T2→T3 — design feedback killed that surface
    because it produced too many "0 coffees" results. v3 is a flat
    single-tier schema rendered as a full-circle, single-select wheel.
    Two schemas seed by default: `crema_v3_n10` (active) and
    `crema_v3_n14` (inactive A/B variant) so the admin can switch
    between sector counts via the Catalog Ops Schema Manager.

    What this resets:
      * Every `sca_tree_versions` row → drops both the canonical SCA seed
        and any v1/v2 schemas that may have been activated.
      * Every `sca_addresses` row → all prior classifications were keyed
        against multi-tier branch names that don't exist in v3. Admin
        completes the swap by running Standardization > Tasting.

    Catalog `products` rows are NOT touched — only the address index.

    Gated on `PRAGMA user_version >= 6` so it runs exactly once per DB.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 6:
        return

    deleted_addresses = conn.execute("DELETE FROM sca_addresses").rowcount
    deleted_versions = conn.execute("DELETE FROM sca_tree_versions").rowcount

    now = _now()
    n10 = _load_seed_schema("crema_v3_n10.json")
    n14 = _load_seed_schema("crema_v3_n14.json")

    # n10 is active by default; n14 sits inactive so admin can A/B by
    # flipping its `is_active` flag in the Schema Manager UI.
    conn.execute(
        "INSERT INTO sca_tree_versions "
        "(uploaded_at, uploaded_by, tree_json, is_active, notes) "
        "VALUES (?, NULL, ?, 1, ?)",
        (now, json.dumps(n10), n10.get("notes", "")),
    )
    conn.execute(
        "INSERT INTO sca_tree_versions "
        "(uploaded_at, uploaded_by, tree_json, is_active, notes) "
        "VALUES (?, NULL, ?, 0, ?)",
        (now, json.dumps(n14), n14.get("notes", "")),
    )

    conn.execute("PRAGMA user_version = 6")
    conn.commit()

    print(
        f"crema_v3 swap: dropped {deleted_addresses} sca_addresses + "
        f"{deleted_versions} sca_tree_versions rows; seeded "
        f"{n10.get('version')} (active) + {n14.get('version')} (inactive). "
        f"Admin must re-run Standardization > Tasting to repopulate "
        f"addresses against the new schema."
    )


def reset_process_addresses_for_display_label(conn) -> None:
    """One-shot wipe of `process_addresses` so the next Standardization
    Process run re-classifies every input with the new `display_label`
    column populated. Without this, the COALESCE-based product
    writeback would set `products.process` to the canonical bucket
    name for legacy rows (e.g. "Anaerobic"), losing the descriptive
    raw text. Wiping here forces a fresh Haiku pass that produces
    cleaned display labels.

    Gated on `PRAGMA user_version >= 8` so it runs exactly once.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 8:
        return

    deleted = conn.execute("DELETE FROM process_addresses").rowcount
    conn.execute("PRAGMA user_version = 8")
    conn.commit()

    if deleted:
        print(
            f"process_addresses reset: dropped {deleted} rows so the "
            f"next Standardization Process run repopulates with the new "
            f"display_label column. Admin must re-run."
        )


def restore_experimental_process_verbatim(conn) -> None:
    """One-shot repair: any product whose `process` column is the
    literal string "Experimental" gets its descriptive process_raw
    written back over it. The Standardize writeback used to clobber
    descriptive text like "Whiskey Barrel Aged" with the catch-all
    bucket name — this restores the fidelity for display.

    Gated on `PRAGMA user_version >= 7` so it runs exactly once.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 7:
        return

    restored = conn.execute(
        "UPDATE products SET process = process_raw "
        "WHERE process = 'Experimental' "
        "  AND process_raw IS NOT NULL "
        "  AND process_raw != ''"
    ).rowcount

    conn.execute("PRAGMA user_version = 7")
    conn.commit()

    if restored:
        print(
            f"Process repair: restored verbatim text on {restored} rows "
            f"that had been overwritten with 'Experimental'."
        )


def migrate_topic_categories_v4(conn) -> None:
    """Collapse the 10-bucket topic taxonomy into the 7-bucket v4
    scheme. Runs exactly once per database, gated on `PRAGMA
    user_version >= 9`.

    Mapping (old → new):
      origin_profile, sourcing_story, harvest_report → origins
      tasting_notes                                  → taste
      brew_guide                                     → brew
      culture, health                                → lifestyle
      industry_news, company_update                  → news
      miscellaneous, other                           → misc

    After the bulk remap, a tighter regex carves out clear roast-
    subject articles currently sitting in `brew` and moves them to
    the new `roast` bucket — only articles whose title carries a
    sharp roast-subject signal ('roast level', 'roasting process',
    'light/medium/dark roast', 'why freshly roasted X matters',
    'resting roasted coffee', 'roast profile', 'how roast affects',
    etc.). Borderline rows ('Roasted Coffee Beans for Those Who
    Love Coffee' — adjective-style marketing) stay in `brew` until
    the next Haiku re-enrichment surfaces them.

    Why a programmatic carve-out instead of a Haiku re-enrich:
    re-enriching 854 pre-v4 rows would burn ~$10 of Haiku spend.
    Title-based regex catches ~50 of the clearest cases at zero
    cost. The remaining ambiguous roast-flavored articles will
    correctly land in `roast` on their next re-enrichment via the
    v4 cascade.
    """
    cur = conn.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version >= 9:
        return

    bulk_mapping = {
        "origin_profile": "origins",
        "sourcing_story": "origins",
        "harvest_report": "origins",
        "tasting_notes": "taste",
        "brew_guide": "brew",
        "culture": "lifestyle",
        "health": "lifestyle",
        "industry_news": "news",
        "company_update": "news",
        "miscellaneous": "misc",
        "other": "misc",
    }

    moved_by_bucket: dict[str, int] = {}
    for old, new in bulk_mapping.items():
        moved = conn.execute(
            "UPDATE roaster_articles SET topic_category = ? "
            "WHERE topic_category = ?",
            (new, old),
        ).rowcount
        if moved:
            moved_by_bucket[old] = moved

    # Roast carve-out — tighter than just `LIKE '%roast%'`. Match
    # any of: roast level(s), roasting process, light/medium/dark
    # roast as a noun phrase, 'roast profile', 'freshly roasted X
    # matters/why/benefits', 'resting roasted', 'how roast (level)
    # affects'. These are all SUBJECT roast, not adjective roast.
    roast_patterns = [
        "LOWER(title) LIKE '%roast level%'",
        "LOWER(title) LIKE '%roasting process%'",
        "LOWER(title) LIKE '%light roast%'",
        "LOWER(title) LIKE '%medium roast%'",
        "LOWER(title) LIKE '%dark roast%'",
        "LOWER(title) LIKE '%french roast%'",
        "LOWER(title) LIKE '%vienna roast%'",
        "LOWER(title) LIKE '%espresso roast%'",
        "LOWER(title) LIKE '%roast profile%'",
        "LOWER(title) LIKE '%freshly roasted%matters%'",
        "LOWER(title) LIKE '%freshly roasted%why%'",
        "LOWER(title) LIKE '%freshly roasted%benefits%'",
        "LOWER(title) LIKE '%resting roasted%'",
        "LOWER(title) LIKE '%rest roasted%'",
        "LOWER(title) LIKE '%roasting specialty%'",
        "LOWER(title) LIKE '%science behind roast%'",
        "LOWER(title) LIKE '%art of%light roast%'",
        "LOWER(title) LIKE '%how roast%affect%'",
        "LOWER(title) LIKE '%types of%roast%'",
        "LOWER(title) LIKE '%coffee roasts%'",
        "LOWER(title) LIKE '%coffee roasting%'",
    ]
    where_clause = " OR ".join(roast_patterns)
    moved_roast = conn.execute(
        f"UPDATE roaster_articles SET topic_category = 'roast' "
        f"WHERE topic_category IN ('brew','origins') AND ({where_clause})"
    ).rowcount

    conn.execute("PRAGMA user_version = 9")
    conn.commit()

    if moved_by_bucket or moved_roast:
        summary = ", ".join(f"{k}→{bulk_mapping[k]}: {v}" for k, v in moved_by_bucket.items())
        print(
            f"Topic taxonomy v4 migration: {summary}; roast carve-out: {moved_roast} rows."
        )


def backfill_prior_scrape_jobs(conn) -> int:
    """One-shot retroactive seed: every prior `succeeded` scrape job
    that has `result_summary.new_products[]` becomes a series of
    `applied` proposals so the admin can undo old runs.

    Update + missing entries from prior runs lack a captured prev_state,
    so they're recorded as `applied` proposals with `prev_state_json=NULL`
    — undo will skip them with a clear explanation rather than corrupt
    state.
    """
    # Skip if any proposal exists at all — that means we've already
    # processed (or are processing) the live workflow. No double-seed.
    existing = conn.execute(
        "SELECT COUNT(*) FROM scrape_proposals"
    ).fetchone()[0]
    if existing > 0:
        return 0

    rows = conn.execute(
        "SELECT id, result_summary, started_at, finished_at FROM jobs "
        "WHERE kind = 'scrape' AND status = 'succeeded' "
        "  AND result_summary IS NOT NULL"
    ).fetchall()
    inserted = 0
    for r in rows:
        try:
            summary = json.loads(r["result_summary"]) if r["result_summary"] else {}
        except (json.JSONDecodeError, TypeError):
            continue
        applied_at = r["finished_at"] or r["started_at"] or _now()
        for kind, key in (("insert", "new_products"), ("update", "updated"),
                           ("mark_sold_out", "missing")):
            items = summary.get(key) or []
            if not isinstance(items, list):
                continue
            for it in items:
                if not isinstance(it, dict):
                    continue
                pid = it.get("product_id")
                if not pid:
                    continue
                conn.execute(
                    "INSERT INTO scrape_proposals "
                    "(job_id, product_id, change_type, proposed_state_json, "
                    " prev_state_json, status, applied_at, created_at) "
                    "VALUES (?, ?, ?, ?, NULL, 'applied', ?, ?)",
                    (r["id"], pid, kind, json.dumps(it), applied_at, applied_at),
                )
                inserted += 1
    if inserted:
        conn.commit()
        print(f"Catalog-ops backfill: created {inserted} retroactive proposals "
               f"for {len(rows)} prior scrape jobs")
    return inserted


def run_standardize_job(job_id: int, *, regenerate_exemplars: bool = False,
                          tasks: Optional[list] = None,
                          force_reclassify: bool = False) -> None:
    """Catalog Standardization runner — formerly the SCA-only geolocate job,
    extended to also map origins → estate names and varietals → canonical
    cultivar + species + morphology. One Haiku call covers all three tasks
    via a shared cache-controlled system prompt.

    Writes results into:
      • sca_addresses (existing)
      • origin_addresses, varietal_addresses (new)
      • products.origin_estate_canonical / .varietal_canonical /
        .bean_type_canonical / .morphology (denormalized for query speed)

    Cached exemplars are reused unless `regenerate_exemplars` is true, in
    which case all three exemplar lists are resampled before the call.
    """
    db = get_db()
    log_lines: list[str] = []

    def log(line: str) -> None:
        ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
        log_lines.append(f"[{ts}] {line}")

    try:
        mark_running(db, job_id)

        sca_tree = sca_geolocator.get_active_tree(db)
        variety_tree = sca_geolocator.load_variety_tree()

        # Per-task selection — admin can opt subsets via the
        # STANDARDIZATION sub-tab toggles. Empty / None = run all five.
        ALL_TASKS = ("tasting", "origin", "varietal", "roast", "process")
        if not tasks:
            selected_tasks = set(ALL_TASKS)
        else:
            selected_tasks = {t for t in tasks if t in ALL_TASKS}
        if not selected_tasks:
            mark_finished(
                db, job_id, status="failed",
                error_message="No tasks selected. Toggle at least one task on.",
                log_tail="\n".join(log_lines)[-10_000:],
            )
            return
        log(f"selected tasks: {sorted(selected_tasks)}")

        # Harvest unique input strings per selected task only — we
        # don't need to walk the catalog for tasks the admin skipped.
        tag_counts = sca_geolocator.harvest_product_tags(db) if "tasting" in selected_tasks else Counter()
        origin_counts = sca_geolocator.harvest_origins(db) if "origin" in selected_tasks else Counter()
        varietal_counts = sca_geolocator.harvest_varietals(db) if "varietal" in selected_tasks else Counter()
        roast_counts = sca_geolocator.harvest_roasts(db) if "roast" in selected_tasks else Counter()
        process_counts = sca_geolocator.harvest_processes(db) if "process" in selected_tasks else Counter()

        # Diff against existing address tables. Re-classifying entries
        # we've already mapped wastes tokens and risks drift — skip them
        # by default. When `force_reclassify=True` (admin re-run after
        # prompt or schema change), the diff is bypassed: every input
        # is fed to Haiku and the existing rows are overwritten via
        # INSERT OR REPLACE downstream.
        def _existing(table: str, col: str) -> set:
            if force_reclassify:
                return set()
            return {r[col] for r in db.execute(f"SELECT {col} FROM {table}").fetchall()}

        sca_existing = _existing("sca_addresses", "tag") if "tasting" in selected_tasks else set()
        origin_existing = _existing("origin_addresses", "raw_string") if "origin" in selected_tasks else set()
        varietal_existing = _existing("varietal_addresses", "raw_string") if "varietal" in selected_tasks else set()
        roast_existing = _existing("roast_addresses", "raw_string") if "roast" in selected_tasks else set()
        process_existing = _existing("process_addresses", "raw_string") if "process" in selected_tasks else set()

        unclassified_tags = sorted(t for t in tag_counts if t not in sca_existing)
        unclassified_origins = sorted(s for s in origin_counts if s not in origin_existing)
        unclassified_varietals = sorted(s for s in varietal_counts if s not in varietal_existing)
        unclassified_roasts = sorted(s for s in roast_counts if s not in roast_existing)
        unclassified_processes = sorted(s for s in process_counts if s not in process_existing)
        if force_reclassify:
            log("force_reclassify=true — every input will be re-fed to Haiku")

        log(
            "unclassified — "
            f"tasting:{len(unclassified_tags)}, "
            f"origins:{len(unclassified_origins)}, "
            f"varietals:{len(unclassified_varietals)}, "
            f"roasts:{len(unclassified_roasts)}, "
            f"processes:{len(unclassified_processes)}"
        )

        if not (unclassified_tags or unclassified_origins or unclassified_varietals
                or unclassified_roasts or unclassified_processes):
            mark_finished(
                db, job_id, status="succeeded",
                log_tail="\n".join(log_lines + ["nothing to classify — exiting"]),
                result_summary={
                    t: {"unclassified_input": 0, "classified": 0}
                    for t in selected_tasks
                },
            )
            return

        # Exemplars — cached across runs unless the admin opted to refresh.
        # Only fetch for selected tasks.
        tag_exemplars = sca_geolocator.get_or_refresh_exemplars(
            db, "tasting", regenerate=regenerate_exemplars, log=log,
        ) if "tasting" in selected_tasks else []
        origin_exemplars = sca_geolocator.get_or_refresh_exemplars(
            db, "origin", regenerate=regenerate_exemplars, log=log,
        ) if "origin" in selected_tasks else []
        varietal_exemplars = sca_geolocator.get_or_refresh_exemplars(
            db, "varietal", regenerate=regenerate_exemplars, log=log,
        ) if "varietal" in selected_tasks else []
        roast_exemplars = sca_geolocator.get_or_refresh_exemplars(
            db, "roast", regenerate=regenerate_exemplars, log=log,
        ) if "roast" in selected_tasks else []
        process_exemplars = sca_geolocator.get_or_refresh_exemplars(
            db, "process", regenerate=regenerate_exemplars, log=log,
        ) if "process" in selected_tasks else []

        # Sequential per-task Haiku calls. Each task gets a dedicated
        # focused prompt → smaller per-call output budget than a
        # combined approach, and per-task failures don't poison the
        # others. Within each task, chunking handles input lists too
        # big to fit in MAX_TOKENS of output.
        TASTING_CHUNK = 250
        ORIGIN_CHUNK = 250
        VARIETAL_CHUNK = 150
        ROAST_CHUNK = 200
        PROCESS_CHUNK = 200

        def _chunk(lst, size):
            return [lst[i:i + size] for i in range(0, len(lst), size)]

        def _run_task(task_name: str, inputs: list, chunk_size: int, classifier_fn):
            if not inputs:
                return {}, None
            chunks = _chunk(inputs, chunk_size)
            log(f"── {task_name}: {len(inputs)} unclassified, {len(chunks)} call(s)")
            merged: dict = {}
            for i, ch in enumerate(chunks):
                log(f"   [{task_name} {i + 1}/{len(chunks)}] {len(ch)} entries")
                try:
                    merged.update(classifier_fn(ch))
                except sca_geolocator.GeolocatorError as e:
                    err = (
                        f"{task_name} aborted at chunk {i + 1}/{len(chunks)}: {e}. "
                        f"Keeping {len(merged)} resolved entries."
                    )
                    log(err)
                    return merged, err
            return merged, None

        # Per-task classifier closures.
        def _tasting_call(batch):
            return sca_geolocator.classify_tasting(batch, sca_tree, tag_exemplars, log=log)

        def _origin_call(batch):
            return sca_geolocator.classify_origins(batch, origin_exemplars, log=log)

        def _varietal_call(batch):
            return sca_geolocator.classify_varietals(batch, variety_tree, varietal_exemplars, log=log)

        def _roast_call(batch):
            return sca_geolocator.classify_roasts(batch, roast_exemplars, log=log)

        def _process_call(batch):
            return sca_geolocator.classify_processes(batch, process_exemplars, log=log)

        log("starting selected per-task Haiku calls")
        tasting_resolved, tasting_err = (_run_task(
            "tasting", unclassified_tags, TASTING_CHUNK, _tasting_call,
        ) if "tasting" in selected_tasks else ({}, None))
        origin_resolved, origin_err = (_run_task(
            "origin", unclassified_origins, ORIGIN_CHUNK, _origin_call,
        ) if "origin" in selected_tasks else ({}, None))
        varietal_resolved, varietal_err = (_run_task(
            "varietal", unclassified_varietals, VARIETAL_CHUNK, _varietal_call,
        ) if "varietal" in selected_tasks else ({}, None))
        roast_resolved, roast_err = (_run_task(
            "roast", unclassified_roasts, ROAST_CHUNK, _roast_call,
        ) if "roast" in selected_tasks else ({}, None))
        process_resolved, process_err = (_run_task(
            "process", unclassified_processes, PROCESS_CHUNK, _process_call,
        ) if "process" in selected_tasks else ({}, None))

        resolved = {
            "tasting": tasting_resolved,
            "origin": origin_resolved,
            "varietal": varietal_resolved,
            "roast": roast_resolved,
            "process": process_resolved,
        }

        # Aggregate any partial-failure messages so the admin sees them
        # all in one result_summary.error field. Each task's failure is
        # independent; if all selected tasks failed AND nothing
        # committed, we mark the job failed below.
        task_errors = [e for e in (
            tasting_err, origin_err, varietal_err, roast_err, process_err,
        ) if e]
        partial_failure: Optional[str] = None
        if task_errors:
            partial_failure = " | ".join(task_errors)
        # Nothing committed at all → fail hard so the row reads as a
        # clean failure rather than a silent zero-row success.
        if (
            not any(resolved.values())
            and task_errors
        ):
            mark_finished(
                db, job_id, status="failed",
                error_message=partial_failure,
                log_tail="\n".join(log_lines)[-10_000:],
            )
            return

        now = _now()

        # Tasting writeback.
        tasting_classified = 0
        tasting_null = 0
        if "tasting" in selected_tasks:
            for tag, addr in resolved["tasting"].items():
                t1, t2, t3, is_null = sca_geolocator.address_to_columns(addr)
                if is_null:
                    tasting_null += 1
                else:
                    tasting_classified += 1
                db.execute(
                    "INSERT OR REPLACE INTO sca_addresses "
                    "(tag, address_t1, address_t2, address_t3, is_null, source, "
                    " classified_at, model_version) "
                    "VALUES (?, ?, ?, ?, ?, 'haiku', ?, ?)",
                    (tag, t1, t2, t3, is_null, now, sca_geolocator.MODEL_VERSION),
                )
            # Tags Haiku didn't return → null row so we don't re-call them.
            for tag in unclassified_tags:
                if tag not in resolved["tasting"]:
                    db.execute(
                        "INSERT OR REPLACE INTO sca_addresses "
                        "(tag, address_t1, address_t2, address_t3, is_null, source, "
                        " classified_at, model_version) "
                        "VALUES (?, NULL, NULL, NULL, 1, 'haiku', ?, ?)",
                        (tag, now, sca_geolocator.MODEL_VERSION),
                    )

        # Origins writeback.
        origin_classified = 0
        if "origin" in selected_tasks:
            for raw, estate in resolved["origin"].items():
                db.execute(
                    "INSERT OR REPLACE INTO origin_addresses "
                    "(raw_string, estate_canonical, source, classified_at, model_version) "
                    "VALUES (?, ?, 'haiku', ?, ?)",
                    (raw, estate, now, sca_geolocator.MODEL_VERSION),
                )
                if estate is not None:
                    origin_classified += 1
            for raw in unclassified_origins:
                if raw not in resolved["origin"]:
                    db.execute(
                        "INSERT OR REPLACE INTO origin_addresses "
                        "(raw_string, estate_canonical, source, classified_at, model_version) "
                        "VALUES (?, NULL, 'haiku', ?, ?)",
                        (raw, now, sca_geolocator.MODEL_VERSION),
                    )

        # Varietals writeback.
        varietal_classified = 0
        if "varietal" in selected_tasks:
            for raw, fields in resolved["varietal"].items():
                db.execute(
                    "INSERT OR REPLACE INTO varietal_addresses "
                    "(raw_string, canonical_varietal, bean_type, morphology, "
                    " source, classified_at, model_version) "
                    "VALUES (?, ?, ?, ?, 'haiku', ?, ?)",
                    (raw, fields["canonical_varietal"], fields["bean_type"],
                     fields["morphology"], now, sca_geolocator.MODEL_VERSION),
                )
                varietal_classified += 1
            for raw in unclassified_varietals:
                if raw not in resolved["varietal"]:
                    db.execute(
                        "INSERT OR REPLACE INTO varietal_addresses "
                        "(raw_string, canonical_varietal, bean_type, morphology, "
                        " source, classified_at, model_version) "
                        "VALUES (?, NULL, NULL, NULL, 'haiku', ?, ?)",
                        (raw, now, sca_geolocator.MODEL_VERSION),
                    )

        # Roast writeback.
        roast_classified = 0
        if "roast" in selected_tasks:
            for raw, canonical in resolved["roast"].items():
                db.execute(
                    "INSERT OR REPLACE INTO roast_addresses "
                    "(raw_string, roast_canonical, source, classified_at, model_version) "
                    "VALUES (?, ?, 'haiku', ?, ?)",
                    (raw, canonical, now, sca_geolocator.MODEL_VERSION),
                )
                if canonical is not None:
                    roast_classified += 1
            for raw in unclassified_roasts:
                if raw not in resolved["roast"]:
                    db.execute(
                        "INSERT OR REPLACE INTO roast_addresses "
                        "(raw_string, roast_canonical, source, classified_at, model_version) "
                        "VALUES (?, NULL, 'haiku', ?, ?)",
                        (raw, now, sca_geolocator.MODEL_VERSION),
                    )

        # Process writeback. classify_processes returns
        # {raw: {"canonical": str|None, "display": str|None}} — both
        # land in process_addresses so the consumer card can render
        # the cleaned display text while the filter chips group by
        # canonical bucket.
        process_classified = 0
        if "process" in selected_tasks:
            for raw, payload in resolved["process"].items():
                # Back-compat: older callers may still pass plain
                # str|None. Normalise to the dict shape.
                if isinstance(payload, dict):
                    canonical = payload.get("canonical")
                    display = payload.get("display")
                else:
                    canonical = payload
                    display = raw if canonical is not None else None
                db.execute(
                    "INSERT OR REPLACE INTO process_addresses "
                    "(raw_string, canonical, display_label, is_null, source, classified_at, model_version) "
                    "VALUES (?, ?, ?, ?, 'haiku', ?, ?)",
                    (raw, canonical, display,
                     1 if canonical is None else 0,
                     now, sca_geolocator.MODEL_VERSION),
                )
                if canonical is not None:
                    process_classified += 1
            for raw in unclassified_processes:
                if raw not in resolved["process"]:
                    db.execute(
                        "INSERT OR REPLACE INTO process_addresses "
                        "(raw_string, canonical, display_label, is_null, source, classified_at, model_version) "
                        "VALUES (?, NULL, NULL, 1, 'haiku', ?, ?)",
                        (raw, now, sca_geolocator.MODEL_VERSION),
                    )

        db.commit()

        # Denormalize address-table results onto products. One pass per
        # field. Only refresh columns whose task ran this time.
        if "origin" in selected_tasks:
            db.execute(
                "UPDATE products SET origin_estate_canonical = ("
                "  SELECT estate_canonical FROM origin_addresses "
                "  WHERE raw_string = products.origin"
                ") WHERE products.origin IS NOT NULL AND products.origin != ''"
            )
        if "varietal" in selected_tasks:
            db.execute(
                "UPDATE products SET varietal_canonical = ("
                "  SELECT canonical_varietal FROM varietal_addresses "
                "  WHERE raw_string = products.varietal"
                ") WHERE products.varietal IS NOT NULL AND products.varietal != ''"
            )
            db.execute(
                "UPDATE products SET bean_type_canonical = ("
                "  SELECT bean_type FROM varietal_addresses "
                "  WHERE raw_string = products.varietal"
                ") WHERE products.varietal IS NOT NULL AND products.varietal != ''"
            )
            db.execute(
                "UPDATE products SET morphology = ("
                "  SELECT morphology FROM varietal_addresses "
                "  WHERE raw_string = products.varietal"
                ") WHERE products.varietal IS NOT NULL AND products.varietal != ''"
            )
        if "roast" in selected_tasks:
            # Lookup uses roast_level_name first (the verbatim term we
            # harvested), falling back to the bucketed roast_level when
            # the verbatim is empty — same precedence as the harvester.
            db.execute(
                "UPDATE products SET roast_level_canonical = ("
                "  SELECT roast_canonical FROM roast_addresses "
                "  WHERE raw_string = COALESCE(NULLIF(products.roast_level_name, ''), products.roast_level)"
                ") WHERE COALESCE(products.roast_level_name, products.roast_level) IS NOT NULL"
            )
        if "process" in selected_tasks:
            db.execute(
                "UPDATE products SET process_canonical = ("
                "  SELECT canonical FROM process_addresses "
                "  WHERE raw_string = COALESCE(NULLIF(products.process_raw, ''), products.process)"
                ") WHERE COALESCE(products.process_raw, products.process) IS NOT NULL"
            )
        db.commit()
        log("denormalized canonical values onto products rows")

        # Feed the canonical values BACK into the legacy product
        # columns so standardization becomes the source of truth for
        # the catalog (per user direction). The verbatim raw inputs
        # stay preserved in the address tables — admins can always
        # recover the original from origin_addresses.raw_string /
        # varietal_addresses.raw_string / etc. Tasting notes are
        # explicitly NOT touched (the per-row `tasting_notes` /
        # `flavor_notes` columns hold the roaster's free-text prose
        # which the SCA address table maps separately).
        if "origin" in selected_tasks:
            db.execute(
                "UPDATE products SET origin = origin_estate_canonical "
                "WHERE origin_estate_canonical IS NOT NULL "
                "  AND origin_estate_canonical != 'Unknown'"
            )
        if "varietal" in selected_tasks:
            db.execute(
                "UPDATE products SET varietal = varietal_canonical "
                "WHERE varietal_canonical IS NOT NULL"
            )
            db.execute(
                "UPDATE products SET bean_type = bean_type_canonical "
                "WHERE bean_type_canonical IS NOT NULL"
            )
        if "roast" in selected_tasks:
            db.execute(
                "UPDATE products SET roast_level = roast_level_canonical "
                "WHERE roast_level_canonical IS NOT NULL"
            )
        if "process" in selected_tasks:
            # The display_label written by classify_processes is the
            # source of truth for `products.process` — a cleaned,
            # consumer-facing string Haiku produced ("Carbonic
            # Maceration", "Whiskey Barrel Aged", "Red Honey").
            # Falls back to canonical bucket name for any older row
            # that doesn't yet have display_label, then to process_raw
            # so we never blank a descriptive value. process_canonical
            # column still holds the 8-bucket label for filtering.
            db.execute(
                "UPDATE products SET process = ("
                "  SELECT COALESCE(NULLIF(pa.display_label, ''), pa.canonical) "
                "  FROM process_addresses pa "
                "  WHERE pa.raw_string = COALESCE(NULLIF(products.process_raw, ''), products.process)"
                ") "
                "WHERE EXISTS ("
                "  SELECT 1 FROM process_addresses pa "
                "  WHERE pa.raw_string = COALESCE(NULLIF(products.process_raw, ''), products.process) "
                "    AND pa.is_null = 0"
                ")"
            )
        db.commit()
        log("wrote canonical values back into legacy product columns")

        log(
            f"wrote — tasting:{tasting_classified}+{tasting_null}n, "
            f"origins:{origin_classified}, varietals:{varietal_classified}, "
            f"roasts:{roast_classified}, processes:{process_classified}"
        )

        # Post-success exemplar refresh. For each task that ran and
        # didn't error, resample exemplars from the freshly-populated
        # address table — this fixes the cold-start bootstrap where
        # the FIRST run sees empty address tables (no anchor exemplars
        # to draw from), classifies anyway, but the cached exemplar
        # list stays empty for every subsequent run. Also resets the
        # `regenerate_next` flag (only after success — if the run
        # failed, the regen intent must persist for the retry).
        per_task_errors = {
            "tasting": tasting_err, "origin": origin_err,
            "varietal": varietal_err, "roast": roast_err,
            "process": process_err,
        }
        for task in selected_tasks:
            if per_task_errors.get(task):
                continue  # leave the regen intent + cache alone for retry
            try:
                sca_geolocator.refresh_exemplars_post_run(db, task, log=log)
            except Exception as e:
                log(f"  post-run exemplar refresh for {task} failed: {e}")

        # If a chunk failed mid-run we still got committed work from the
        # earlier chunks. Mark the job 'failed' so the admin knows to
        # re-run it, but keep the stats so they can see the progress.
        final_status = "failed" if partial_failure else "succeeded"
        mark_finished(
            db, job_id,
            status=final_status,
            error_message=partial_failure,
            log_tail="\n".join(log_lines)[-10_000:],
            result_summary={
                "tasting": {
                    "unclassified_input": len(unclassified_tags),
                    "classified": tasting_classified,
                    "null_resolved": tasting_null,
                },
                "origin": {
                    "unclassified_input": len(unclassified_origins),
                    "classified": origin_classified,
                },
                "varietal": {
                    "unclassified_input": len(unclassified_varietals),
                    "classified": varietal_classified,
                },
                "roast": {
                    "unclassified_input": len(unclassified_roasts),
                    "classified": roast_classified,
                },
                "process": {
                    "unclassified_input": len(unclassified_processes),
                    "classified": process_classified,
                },
                "selected_tasks": sorted(selected_tasks),
            },
        )
    except Exception as e:
        log(f"unexpected error: {type(e).__name__}: {e}")
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail="\n".join(log_lines)[-10_000:],
            )
        except Exception:
            pass
    finally:
        db.close()


def run_geolocate_job(job_id: int) -> None:
    """Diff distinct catalog tags against `sca_addresses`, batch-classify
    the missing ones via Haiku, validate against the active tree, write
    rows back."""
    db = get_db()
    log_lines: list[str] = []

    def log(line: str) -> None:
        ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
        log_lines.append(f"[{ts}] {line}")

    try:
        mark_running(db, job_id)

        active_tree = sca_geolocator.get_active_tree(db)
        counts = sca_geolocator.harvest_product_tags(db)
        catalog_tags = list(counts.keys())
        existing = {r["tag"] for r in db.execute(
            "SELECT tag FROM sca_addresses"
        ).fetchall()}
        unclassified = sorted(t for t in catalog_tags if t not in existing)
        log(f"catalog tags: {len(catalog_tags)} | classified: {len(existing)} "
            f"| unclassified: {len(unclassified)}")

        if not unclassified:
            mark_finished(
                db, job_id, status="succeeded",
                log_tail="\n".join(log_lines + ["nothing to classify — exiting"]),
                result_summary={"unclassified_input": 0, "classified": 0,
                                  "null_resolved": 0},
            )
            return

        exemplars = sca_geolocator.select_exemplars(db, limit=40)
        log(f"selected {len(exemplars)} exemplars for the system prompt")

        try:
            resolved = sca_geolocator.classify_tags(
                unclassified, active_tree, exemplars, log=log,
            )
        except sca_geolocator.GeolocatorError as e:
            log(f"geolocator error: {e}")
            mark_finished(
                db, job_id, status="failed",
                error_message=str(e),
                log_tail="\n".join(log_lines)[-10_000:],
            )
            return

        now = _now()
        non_null = 0
        null_count = 0
        for tag, addr in resolved.items():
            t1, t2, t3, is_null = sca_geolocator.address_to_columns(addr)
            if is_null:
                null_count += 1
            else:
                non_null += 1
            db.execute(
                "INSERT OR REPLACE INTO sca_addresses "
                "(tag, address_t1, address_t2, address_t3, is_null, source, "
                " classified_at, model_version) "
                "VALUES (?, ?, ?, ?, ?, 'haiku', ?, ?)",
                (tag, t1, t2, t3, is_null, now, sca_geolocator.MODEL_VERSION),
            )
        db.commit()
        log(f"wrote {len(resolved)} rows ({non_null} addresses, {null_count} null)")

        mark_finished(
            db, job_id, status="succeeded",
            log_tail="\n".join(log_lines)[-10_000:],
            result_summary={
                "unclassified_input": len(unclassified),
                "classified": non_null,
                "null_resolved": null_count,
            },
        )
    except Exception as e:
        log(f"unexpected error: {type(e).__name__}: {e}")
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail="\n".join(log_lines)[-10_000:],
            )
        except Exception:
            pass
    finally:
        db.close()


def run_roaster_enrich_job(job_id: int, *, website: str,
                             also_scrape: bool = True) -> None:
    """Run a single-URL roaster onboarding as a background task. Two
    phases in one user-visible CTA — mirroring the per-roaster
    `Refresh Roaster` button on the admin detail page, but starting
    from a URL instead of an existing slug:

      Phase 1 — bio enrich. Calls `_apply_roaster_enrichment` which
        runs Sonnet, upserts `roaster_profiles` + `roaster_sources`,
        and returns `{slug, name, website}`. Failure here marks the
        whole job failed.

      Phase 2 — catalog scrape (optional, default on). After bio
        succeeds, look up the freshly-mirrored `roaster_sources` row.
        If it has both `shop_url` and `platform` (Sonnet picked them),
        enqueue a `scrape` job for this roaster and spawn it on a
        daemon thread. The scrape job is its OWN row in `jobs` —
        admin sees both this enrich row AND a sibling scrape row in
        the feed. If the scrape pre-flight fails (no shop_url, an
        in-flight scrape conflict, etc.), the bio still succeeds and
        the reason is recorded in `result_summary.scrape_skipped_reason`;
        admin can manually re-trigger from the per-roaster admin page.

    Pass `also_scrape=False` to skip phase 2 entirely (kept for the
    earlier hero CTA semantics where bio-only was the intent).

    `result_summary` carries `{slug, name, website, scrape_job_id?,
    scrape_skipped_reason?}`. Errors come back as plain
    `error_message` strings (no log_tail — Sonnet enrichment is one
    round-trip, not a long subprocess; there's nothing to stream).
    The chained scrape's own log streams into its own row.
    """
    db = get_db()
    try:
        mark_running(db, job_id)
        # Late import — services -> routes would otherwise create a
        # circular import at module load time.
        from routes.specific import _apply_roaster_enrichment  # noqa: WPS433
        applied = _apply_roaster_enrichment(db, website)

        result_summary: dict = {
            "slug": applied["slug"],
            "name": applied.get("name"),
            "website": applied.get("website"),
        }

        if also_scrape:
            # Look up the user who started this onboard so the chained
            # scrape job is attributed to the same admin in the audit log.
            row = db.execute(
                "SELECT started_by FROM jobs WHERE id = ?", (job_id,),
            ).fetchone()
            started_by = row["started_by"] if row else None

            src_row = db.execute(
                "SELECT shop_url, platform FROM roaster_sources WHERE website = ?",
                (applied["website"],),
            ).fetchone()
            if not src_row:
                result_summary["scrape_skipped_reason"] = "no source row created"
            elif not src_row["shop_url"]:
                result_summary["scrape_skipped_reason"] = "missing shop_url"
            elif not src_row["platform"]:
                result_summary["scrape_skipped_reason"] = "missing platform"
            elif started_by is None:
                result_summary["scrape_skipped_reason"] = "missing started_by"
            else:
                try:
                    scrape_id = enqueue_job(db, "scrape", started_by=started_by)
                    # Daemon thread — BackgroundTasks aren't accessible from
                    # inside another BackgroundTask. The scrape job's row is
                    # already in `queued` state; the orphan-recovery boot pass
                    # cleans up if the worker dies mid-scrape.
                    threading.Thread(
                        target=run_scrape_job,
                        kwargs={"job_id": scrape_id, "roaster_slug": applied["slug"]},
                        daemon=True,
                    ).start()
                    result_summary["scrape_job_id"] = scrape_id
                except JobConflict as e:
                    result_summary["scrape_skipped_reason"] = (
                        f"another scrape is already running (job {e.live_job_id})"
                    )

        mark_finished(
            db, job_id, status="succeeded",
            log_tail=None,
            result_summary=result_summary,
        )
    except Exception as e:
        # Map the enricher's typed error to a clean message; everything
        # else falls through with the type name + str(e) for debugging.
        from services import roaster_enricher
        msg = (
            str(e)
            if isinstance(e, roaster_enricher.RoasterEnricherError)
            else f"{type(e).__name__}: {e}"
        )
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=msg, log_tail=None,
            )
        except Exception:
            pass
    finally:
        db.close()


def run_resolve_held_job(
    job_id: int,
    *,
    scope_slug: Optional[str] = None,
    limit: int = 50,
) -> None:
    """Background runner for `/admin/scrape/proposals/resolve-held`.

    Same 4-branch decision rule as the prior sync implementation:
      1. Re-run enrichment ONCE per held proposal (Tier 1-4 ladder via
         product_enricher.enrich_product).
      2. retry success → apply normally with merged state.
      3. retry still fails AND live row is already enriched →
         skip_live_enriched (never downgrade).
      4. retry still fails AND no enriched live → apply as
         source_thin with LLM fields nulled.

    Progress writes to `jobs.log_tail` every ~5 proposals so the
    admin's poll can see live ticks. The full disposition lands in
    `jobs.result_summary` on completion.
    """
    db = get_db()
    try:
        mark_running(db, job_id)
        # Late imports for circular-avoidance
        from routes.specific import (
            _should_skip_failed_proposal,
            _apply_failed_as_thin,
        )
        from services.llm_router import set_pipeline_context as _set_ctx
        from services import product_enricher, scrape_runner

        # Find held targets the same way the sync route did
        where = ["status = 'pending'"]
        params: list = []
        if scope_slug:
            where.append("product_id LIKE ?")
            params.append(f"{scope_slug}_%")
        where_sql = " AND ".join(where)
        rows = db.execute(
            f"SELECT id, product_id, change_type, prev_state_json, "
            f"proposed_state_json "
            f"FROM scrape_proposals WHERE {where_sql} "
            f"ORDER BY id ASC LIMIT ?",
            tuple(params) + (limit * 4,),
        ).fetchall()

        held_targets = []
        for r in rows:
            try:
                state = json.loads(r["proposed_state_json"] or "{}")
            except Exception:
                continue
            if state.get("enrichment_status") == "failed":
                held_targets.append(dict(r))
                if len(held_targets) >= limit:
                    break

        succeeded_on_retry = 0
        applied_thin = 0
        skipped_live_enriched = 0
        errored = 0
        detail: list[dict] = []
        total = len(held_targets)

        def _tick(i: int):
            # Tick progress every 5 processed proposals.
            if i % 5 == 0 or i == total:
                try:
                    db.execute(
                        "UPDATE jobs SET log_tail = ? WHERE id = ?",
                        (json.dumps({
                            "processed": i,
                            "total": total,
                            "succeeded_on_retry": succeeded_on_retry,
                            "applied_thin": applied_thin,
                            "skipped_live_enriched": skipped_live_enriched,
                            "errored": errored,
                        }), job_id),
                    )
                    db.commit()
                except Exception:
                    pass

        from datetime import datetime as _dt
        for idx, r in enumerate(held_targets, start=1):
            try:
                state = json.loads(r["proposed_state_json"] or "{}")
            except Exception:
                errored += 1
                detail.append({
                    "id": r["id"],
                    "product_id": r["product_id"],
                    "outcome": "errored",
                    "reason": "proposed_state_json could not be parsed",
                })
                _tick(idx)
                continue

            _set_ctx(roaster_slug=state.get("roaster_slug"))
            enriched = None
            try:
                enriched = product_enricher.enrich_product(state)
            except Exception as e:
                detail.append({
                    "id": r["id"],
                    "product_id": r["product_id"],
                    "outcome": "retry_errored_apply_thin",
                    "reason": f"{type(e).__name__}: {e}",
                })

            now_iso = _dt.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

            if enriched and enriched.get("enrichment_status") == "enriched":
                # Retry success path
                modified = dict(r)
                merged_state = dict(state)
                merged_state.update({k: v for k, v in enriched.items()
                                       if v is not None})
                modified["proposed_state_json"] = json.dumps(merged_state)
                try:
                    scrape_runner.apply_proposal(db, modified)
                    db.execute(
                        "UPDATE scrape_proposals SET status='applied', "
                        "applied_at=? WHERE id=?",
                        (now_iso, r["id"]),
                    )
                    succeeded_on_retry += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "coffee_name": merged_state.get("coffee_name"),
                        "outcome": "succeeded_on_retry",
                    })
                    db.commit()
                except Exception as e:
                    errored += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "outcome": "errored",
                        "reason": f"apply failed: {type(e).__name__}: {e}",
                    })
            else:
                # Retry still failed (or threw)
                if _should_skip_failed_proposal(db, r["product_id"]):
                    skipped_live_enriched += 1
                    detail.append({
                        "id": r["id"],
                        "product_id": r["product_id"],
                        "coffee_name": state.get("coffee_name"),
                        "outcome": "skipped_live_enriched",
                        "reason": "live row already enriched; never downgrade",
                    })
                else:
                    try:
                        _apply_failed_as_thin(db, r)
                        db.execute(
                            "UPDATE scrape_proposals SET status='applied', "
                            "applied_at=? WHERE id=?",
                            (now_iso, r["id"]),
                        )
                        applied_thin += 1
                        detail.append({
                            "id": r["id"],
                            "product_id": r["product_id"],
                            "coffee_name": state.get("coffee_name"),
                            "outcome": "applied_thin",
                            "reason": "ladder exhausted + no enriched live",
                        })
                        db.commit()
                    except Exception as e:
                        errored += 1
                        detail.append({
                            "id": r["id"],
                            "product_id": r["product_id"],
                            "outcome": "errored",
                            "reason": f"apply_failed_as_thin error: {type(e).__name__}: {e}",
                        })
            _tick(idx)

        result_summary = {
            "processed": total,
            "succeeded_on_retry": succeeded_on_retry,
            "applied_thin": applied_thin,
            "skipped_live_enriched": skipped_live_enriched,
            "errored": errored,
            "detail": detail[:200],  # Cap detail rows in summary
            "detail_total": len(detail),
        }
        mark_finished(
            db, job_id, status="succeeded",
            log_tail=None, result_summary=result_summary,
        )
    except Exception as e:
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail=None,
            )
        except Exception:
            pass
    finally:
        db.close()


def run_article_scrape_job(job_id: int, *,
                              roaster_slug: str | None = None,
                              roaster_slugs: Optional[list[str]] = None,
                              force_enrich: bool = False,
                              regenerate_article_hint: bool = False) -> None:
    """Discover + scrape blog/journal articles for one roaster (or
    every enabled roaster when roaster_slug is None) and write them
    into `roaster_articles`.

    Per-source steps:
      1. Pull (or rediscover) the article index — strategy + URL +
         optional Shopify handle list — and persist back to
         `roaster_sources.articles_*` so the next run can skip the
         enumeration.
      2. Enumerate article stubs from the index.
      3. For each stub:
         a. If URL is already in `roaster_articles` with
            enrichment_status='enriched', skip cheaply (no fetch,
            no Haiku, no WebP). Pass `force_enrich=True` to
            re-process every URL.
         b. Otherwise fetch the page HTML, strip chrome, send the
            cleaned text + og: hints to Haiku
            (services.article_enricher) and use its structured
            response for title / body_html / image_url /
            published_at. Falls back to the bs4 extraction when
            Haiku fails or returns is_article=False. Excerpt
            comes from the scraper stub / og:description (no
            longer enriched by Haiku — see Figma 801:155 card
            design + article_enricher.py docstring).
         c. Download the hero image, convert to WebP, persist under
            `/uploads/articles/`, store the local path. External URL
            stays as the fallback when the download fails.
      4. Refresh `articles_count` + `last_articles_scraped_at` on
         the source.

    Per-row commits inside `article_scraper.upsert_article` keep the
    SQLite writer-lock window short — same DB-lock discipline as
    `services/scrape_runner.py:_insert_proposal`.

    `roaster_slug` scopes the run to ONE roaster (per-roaster admin
    button). `roaster_slugs` scopes to a multi-select subset (Layer
    C2's "Refresh N selected" button). Both empty = all published
    roasters. The two are mutually exclusive — if both arrive, the
    list takes precedence.

    `regenerate_article_hint` (Layer B) forces the per-roaster site-
    quirk hint to be regenerated for every roaster touched in this
    run, even if a cached hint already exists.

    Result summary keys: `roasters_processed`, `articles_inserted`,
    `articles_updated`, `articles_skipped`, `discoveries`, `enriched`,
    `enrich_failed`, `not_article_skipped`, `off_topic_skipped`,
    `empty_skipped`, `hints_generated`, `hints_regenerated`,
    `hints_failed`, `errors` (list of `{slug, message}`).
    """
    # Re-stamp the pipeline contextvar — threading.Thread doesn't
    # inherit contextvars, so this thread's call_llm enqueues would
    # otherwise label rows with roaster_slug='unknown'. Mirror of the
    # set in run_scrape_job. When the run is scoped to one slug we
    # use that; for multi-roaster runs we set None and the per-
    # iteration loop is responsible for re-stamping per roaster.
    if roaster_slug:
        try:
            from services.llm_router import set_pipeline_context
            set_pipeline_context(roaster_slug=roaster_slug)
        except Exception:
            pass

    from services import (
        article_scraper, article_enricher, article_site_prompt_generator,
    )

    db = get_db()
    log_lines: list[str] = []

    def log(line: str) -> None:
        ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
        log_lines.append(f"[{ts}] {line}")

    summary = {
        "roasters_processed": 0,
        "articles_inserted": 0,
        "articles_updated": 0,
        "articles_skipped": 0,
        "discoveries": 0,
        "enriched": 0,
        "enrich_failed": 0,
        "not_article_skipped": 0,
        # Off-topic Haiku gate (founder bios, spirituality essays, etc.).
        # Row is still written but hidden from consumers; admin can
        # un-hide if Haiku misclassified.
        "off_topic_skipped": 0,
        # Empty-shell guard — Haiku failed AND bs4 fallback came back
        # with no body and no image. Nothing renderable; we skip
        # without writing a row.
        "empty_skipped": 0,
        # Layer B — per-roaster article-extraction site-quirk hint.
        "hints_generated": 0,
        "hints_regenerated": 0,
        "hints_failed": 0,
        "errors": [],
    }

    try:
        mark_running(db, job_id)
        # Resolve the slug filter shape: single > list > all-published.
        # The two single-source paths exist because the per-roaster
        # admin button posts `roaster_slug` and the multi-select
        # bulk button posts `roaster_slugs` (Layer C2). When both
        # arrive — shouldn't happen but guard anyway — the list wins.
        slug_subset: Optional[list[str]] = None
        if roaster_slugs:
            slug_subset = [s for s in roaster_slugs if s]
        elif roaster_slug:
            slug_subset = [roaster_slug]
        scope_label = (
            f"{len(slug_subset)} selected" if slug_subset is not None
            else "all published"
        )
        log(f"starting article scrape (scope={scope_label})")

        # Pull the source rows we'll iterate. JOIN to roaster_profiles
        # so we have the slug (sources is keyed on website, but the
        # public articles surface is keyed on roaster_slug).
        #
        # NOTE: bulk article scrape does NOT gate on `rs.enabled = 1`.
        # The enabled flag is a CATALOG-scrape concept — it means the
        # roaster's product page is verified parseable enough to crawl
        # for beans. Article scraping has different cost/value
        # tradeoffs: discovery itself is the gate (no Atom feed → no
        # articles), there's no LLM-per-product cost, and there's no
        # admin proposals workflow to review. Filtering on `enabled`
        # would hide article opportunities from 90+ roasters that have
        # perfectly fine blogs but no verified product catalog yet.
        # Gate on `roaster_profiles.published = 1` instead so we don't
        # spend cycles on draft/unreviewed roasters whose articles
        # wouldn't surface to consumers anyway.
        if slug_subset is not None:
            placeholders = ",".join("?" * len(slug_subset))
            rows = db.execute(
                "SELECT rs.id, rs.website, rs.platform, "
                "  rs.articles_index_url, rs.articles_feed_kind, "
                "  rs.articles_handles, rp.roaster_slug, rp.name AS roaster_name, "
                "  rp.article_enrichment_prompt_hint, "
                "  rp.article_hint_force_regenerate "
                "FROM roaster_sources rs "
                "JOIN roaster_profiles rp ON rp.website = rs.website "
                f"WHERE rp.roaster_slug IN ({placeholders})",
                slug_subset,
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT rs.id, rs.website, rs.platform, "
                "  rs.articles_index_url, rs.articles_feed_kind, "
                "  rs.articles_handles, rp.roaster_slug, rp.name AS roaster_name, "
                "  rp.article_enrichment_prompt_hint, "
                "  rp.article_hint_force_regenerate "
                "FROM roaster_sources rs "
                "JOIN roaster_profiles rp ON rp.website = rs.website "
                "WHERE rp.published = 1",
            ).fetchall()

        log(f"iterating {len(rows)} roaster(s)")
        if not rows:
            mark_finished(
                db, job_id, status="succeeded",
                log_tail="\n".join(log_lines + ["no sources to scrape"]),
                result_summary=summary,
            )
            return

        # Cancellation contract: runner polls `jobs.cancel_requested`
        # at the top of every per-source iteration. Admin sets it via
        # POST /admin/jobs/{id}/cancel from the live progress banner's
        # Stop button. On detection we break out cleanly and stamp the
        # job as `succeeded` with `result_summary.cancelled = true` —
        # NOT `failed`, because every committed article is a real
        # full article (per-row commits in upsert_article). Cancelled
        # state is a clean stop, not a crash.
        cancelled = False
        for row in rows:
            # Re-read the cancellation flag every iteration. Cheap (one
            # indexed lookup per roaster, ~95 max in a bulk run).
            flag_row = db.execute(
                "SELECT cancel_requested FROM jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if flag_row and flag_row["cancel_requested"]:
                cancelled = True
                log("CANCELLED by admin — committing partial summary")
                break

            slug = row["roaster_slug"]
            website = row["website"]

            # Stamp current_target so the admin UI's live banner can
            # show "Looking at {name}" instead of an opaque spinner.
            # The display name from the JOIN reads cleaner than the
            # slug, so we prefer it when present.
            current_label = row["roaster_name"] or slug
            try:
                db.execute(
                    "UPDATE jobs SET current_target = ? WHERE id = ?",
                    (current_label, job_id),
                )
                db.commit()
            except Exception:
                # Telemetry-only; never let it break the actual scrape.
                pass

            # Layer B — per-roaster site-quirk hint, prepended to every
            # Haiku call for this roaster. None until the meta-call has
            # generated one; threaded through unchanged for the rest of
            # this iteration so all per-article calls see the same
            # hint state.
            article_hint = row["article_enrichment_prompt_hint"]
            try:
                index_url = row["articles_index_url"]
                kind = row["articles_feed_kind"]
                handles_raw = row["articles_handles"]
                handles = json.loads(handles_raw) if handles_raw else None

                if not index_url or not kind:
                    # First-time discovery for this roaster (or a
                    # rediscovery after the cached strategy stopped
                    # working). One Sonnet-bio probe per roaster on
                    # first run; re-runs are cheap.
                    discovered = article_scraper.discover(
                        website, platform=row["platform"],
                    )
                    if not discovered:
                        log(f"  {slug}: no article feed found, skipping")
                        summary["roasters_processed"] += 1
                        continue
                    summary["discoveries"] += 1
                    index_url = discovered["index_url"]
                    kind = discovered["kind"]
                    handles = discovered.get("handles")
                    db.execute(
                        "UPDATE roaster_sources SET "
                        "  articles_index_url = ?, articles_feed_kind = ?, "
                        "  articles_handles = ? "
                        "WHERE id = ?",
                        (
                            index_url, kind,
                            json.dumps(handles) if handles else None,
                            row["id"],
                        ),
                    )
                    db.commit()
                    log(f"  {slug}: discovered {kind} index "
                        f"({len(handles) if handles else 1} feed(s))")

                stubs = article_scraper.enumerate_articles(
                    website, index_url=index_url, kind=kind, handles=handles,
                )
                log(f"  {slug}: {len(stubs)} article(s) in index")

                inserted = updated = skipped = 0
                now_iso = _now()
                for stub in stubs:
                    url = (stub.get("url") or "").strip()
                    if not url:
                        skipped += 1
                        continue

                    # Skip-cheap path: already enriched, not forced.
                    # No HTTP, no Haiku, no WebP download — just
                    # advance the loop. This keeps re-scrapes
                    # essentially free in token + bandwidth cost.
                    existing_row = db.execute(
                        "SELECT id, enrichment_status FROM roaster_articles "
                        "WHERE url = ?",
                        (url,),
                    ).fetchone()
                    if (
                        existing_row
                        and (existing_row["enrichment_status"] or "") == "enriched"
                        and not force_enrich
                    ):
                        skipped += 1
                        continue

                    # Fetch the article HTML — needed for both the
                    # Haiku enricher (cleaned page text) and the
                    # bs4 fallback (when Haiku fails).
                    try:
                        page_html = article_scraper.fetch_article_html(url)
                    except Exception as e:
                        summary["errors"].append({
                            "slug": slug, "url": url,
                            "message": f"page fetch failed: "
                                       f"{type(e).__name__}: {e}",
                        })
                        skipped += 1
                        continue

                    # Cleaned text + og: hints + bs4 fallback all in
                    # one pass.
                    extracted = article_scraper.extract_for_enrichment(
                        page_html, base_url=url,
                    )
                    fallback = extracted["fallback"]

                    # Haiku enrichment — primary content source.
                    enriched = None
                    enrichment_status = "pending"
                    try:
                        enriched = article_enricher.enrich_article(
                            url=url,
                            page_text=extracted["page_text"],
                            og_title=extracted["og_title"],
                            og_description=extracted["og_description"],
                            og_image=extracted["og_image"],
                            og_published_at=extracted["og_published_at"],
                            detected_videos=extracted.get("detected_videos"),
                            detected_links=extracted.get("detected_links"),
                            system_addendum=article_hint,
                        )
                    except article_enricher.ArticleEnricherError as e:
                        # Setup error (no SDK, etc.) — bubble up,
                        # falls into the per-roaster except block
                        # below, but record the cause first.
                        summary["errors"].append({
                            "slug": slug, "url": url,
                            "message": f"enrich setup: "
                                       f"{type(e).__name__}: {e}",
                        })

                    if enriched is not None and enriched.get("is_article") is False:
                        # Haiku says this URL isn't an article —
                        # category landing, 404, product listing
                        # mis-classified by the discovery step. Skip
                        # without writing a row.
                        summary["not_article_skipped"] += 1
                        skipped += 1
                        continue

                    # Coffee-relevance gate (Layer A2). Off-topic
                    # rows still write so admin can review + override,
                    # but the row goes in with `published=0` so it
                    # never reaches the consumer JOURNAL feed. Counter
                    # bumps separately from `articles_skipped` because
                    # the upsert still produces an inserted/updated
                    # row.
                    is_about_coffee = bool(
                        enriched.get("is_about_coffee", True)
                    ) if enriched is not None else True
                    topic_category = (
                        enriched.get("topic_category")
                        if enriched is not None else None
                    )
                    enriched_tags = (
                        enriched.get("tags") if enriched is not None else []
                    ) or []

                    # Build the article dict from Haiku output
                    # (preferred) or bs4 fallback. Always merge in
                    # the stub fields (Atom feed title/published_at)
                    # so we don't lose canonical roaster-asserted
                    # values.
                    #
                    # Three cases to distinguish:
                    #   (a) Haiku succeeded with body — full enrichment
                    #   (b) Haiku succeeded but said is_about_coffee=
                    #       false (permitted to omit body/title per
                    #       schema) — TRUST the off-topic verdict,
                    #       use bs4 fallback for the visible fields
                    #       so the row still renders for admin
                    #       override. enrichment_status='enriched'.
                    #   (c) Haiku call failed entirely (None) — bs4
                    #       fallback, enrichment_status='failed'.
                    if enriched and enriched.get("body_html"):
                        # Case (a)
                        article = {
                            "url": url,
                            "title": (
                                enriched.get("title")
                                or stub.get("title")
                                or fallback.get("title")
                            ),
                            "excerpt": (
                                enriched.get("excerpt")
                                or stub.get("excerpt")
                                or fallback.get("excerpt")
                            ),
                            "image_url": (
                                enriched.get("image_url")
                                or extracted["og_image"]
                                or fallback.get("image_url")
                            ),
                            "body_html": enriched.get("body_html"),
                            "word_count": (
                                enriched.get("word_count")
                                or fallback.get("word_count")
                            ),
                            "published_at": (
                                enriched.get("published_at")
                                or stub.get("published_at")
                                or fallback.get("published_at")
                            ),
                        }
                        enrichment_status = "enriched"
                        summary["enriched"] += 1
                    elif enriched is not None and not is_about_coffee:
                        # Case (b) — Haiku DID respond, just decided
                        # is_about_coffee=false so the optional fields
                        # may be omitted per the v4 schema. The
                        # verdict itself is the value of this call;
                        # the row's body comes from bs4 so admin can
                        # still review + override.
                        fb = article_scraper.merge_full(stub, fallback)
                        article = {
                            "url": url,
                            "title": (
                                enriched.get("title")
                                or fb.get("title")
                            ),
                            "excerpt": (
                                enriched.get("excerpt")
                                or fb.get("excerpt")
                            ),
                            "image_url": (
                                enriched.get("image_url")
                                or extracted["og_image"]
                                or fb.get("image_url")
                            ),
                            "body_html": fb.get("body_html"),
                            "word_count": (
                                enriched.get("word_count")
                                or fb.get("word_count")
                            ),
                            "published_at": (
                                enriched.get("published_at")
                                or fb.get("published_at")
                            ),
                        }
                        enrichment_status = "enriched"
                        summary["enriched"] += 1
                    else:
                        # Case (c) — Haiku failed (transient, missing
                        # key, parse error). Write the bs4 fallback
                        # so the scrape still produces a row, and
                        # stamp enrichment_status='failed' so admin
                        # can re-run with force_enrich later.
                        article = article_scraper.merge_full(
                            stub, fallback,
                        )
                        enrichment_status = "failed"
                        summary["enrich_failed"] += 1

                    # A5 secondary guard — drop rows with NEITHER body
                    # nor hero image. Nothing for the reader or card
                    # to render; an empty row is just noise in the
                    # admin tab. We don't gate on word_count alone
                    # because Devans-style infographic articles have
                    # short text but a real hero image.
                    if not article.get("body_html") and not article.get("image_url"):
                        summary["empty_skipped"] += 1
                        skipped += 1
                        continue

                    if not is_about_coffee:
                        summary["off_topic_skipped"] += 1

                    # Hero image: download external URL → WebP local.
                    # Falls back to the external URL when the download
                    # or convert fails so cards still render heroes.
                    external_image = article.get("image_url")
                    if external_image and not external_image.startswith(
                        "/uploads/"
                    ):
                        local_path = article_scraper.download_hero_image(
                            external_image,
                        )
                        if local_path:
                            article["image_url"] = local_path

                    try:
                        outcome = article_scraper.upsert_article(
                            db, roaster_slug=slug, article=article,
                            now_iso=now_iso,
                            enrichment_status=enrichment_status,
                            is_about_coffee=is_about_coffee,
                            topic_category=topic_category,
                            tags=enriched_tags,
                        )
                    except Exception as e:
                        summary["errors"].append({
                            "slug": slug, "url": url,
                            "message": f"upsert failed: {type(e).__name__}: {e}",
                        })
                        skipped += 1
                        continue
                    if outcome == "inserted":
                        inserted += 1
                    elif outcome == "updated":
                        updated += 1
                    else:
                        skipped += 1

                # Refresh denormalized count + scrape stamp on the
                # source row.
                count_row = db.execute(
                    "SELECT COUNT(*) AS c FROM roaster_articles "
                    "WHERE roaster_slug = ?",
                    (slug,),
                ).fetchone()
                db.execute(
                    "UPDATE roaster_sources SET "
                    "  articles_count = ?, last_articles_scraped_at = ? "
                    "WHERE id = ?",
                    (count_row["c"], now_iso, row["id"]),
                )
                db.commit()

                summary["articles_inserted"] += inserted
                summary["articles_updated"] += updated
                summary["articles_skipped"] += skipped
                summary["roasters_processed"] += 1
                log(
                    f"  {slug}: +{inserted} inserted · "
                    f"~{updated} updated · -{skipped} skipped",
                )

                # Layer B — site-quirk hint generation.
                # Trigger when the roaster has ≥1 enriched article AND
                # (no cached hint OR job-level `regenerate_article_hint`
                # OR the perpetual per-roaster `article_hint_force_regenerate`
                # flag is set). The DB flag is sticky/server-side — the
                # admin toggles it from the Journals expand row and it
                # never auto-clears, so every subsequent scrape regenerates
                # until the admin flips it back off.
                row_force_regen = bool(row["article_hint_force_regenerate"])
                hint_outcome = _maybe_generate_article_hint(
                    db, slug=slug,
                    roaster_name=row["roaster_name"] or slug,
                    existing_hint=article_hint,
                    regenerate=regenerate_article_hint or row_force_regen,
                    log=log,
                )
                if hint_outcome == "generated":
                    summary["hints_generated"] += 1
                elif hint_outcome == "regenerated":
                    summary["hints_regenerated"] += 1
                elif hint_outcome == "failed":
                    summary["hints_failed"] += 1
            except Exception as e:
                summary["errors"].append({
                    "slug": slug,
                    "message": f"{type(e).__name__}: {e}",
                })
                log(f"  {slug}: ERROR {type(e).__name__}: {e}")

        # Surface the cancellation to JobHistory + the live banner.
        # We finish as `succeeded` (cancel is a clean stop, not a
        # crash) but stamp the summary so summarizeJob can show
        # "(cancelled — N done)" instead of treating it as a normal
        # success.
        if cancelled:
            summary["cancelled"] = True
        # Clear current_target so a stale slug doesn't render in the
        # live banner if the admin re-opens the panel after finish.
        try:
            db.execute(
                "UPDATE jobs SET current_target = NULL WHERE id = ?",
                (job_id,),
            )
            db.commit()
        except Exception:
            pass
        mark_finished(
            db, job_id, status="succeeded",
            log_tail="\n".join(log_lines)[-10_000:],
            result_summary=summary,
        )
    except Exception as e:
        log(f"unexpected error: {type(e).__name__}: {e}")
        try:
            db.execute(
                "UPDATE jobs SET current_target = NULL WHERE id = ?",
                (job_id,),
            )
            db.commit()
        except Exception:
            pass
        try:
            mark_finished(
                db, job_id, status="failed",
                error_message=f"{type(e).__name__}: {e}",
                log_tail="\n".join(log_lines)[-10_000:],
                result_summary=summary,
            )
        except Exception:
            pass
    finally:
        db.close()


def _maybe_generate_article_hint(db, *, slug: str, roaster_name: str,
                                   existing_hint: Optional[str],
                                   regenerate: bool,
                                   log) -> str:
    """Generate (or regenerate) the per-roaster article-extraction
    site-quirk hint when conditions are met.

    Returns one of:
      • 'generated'     — first-time generation succeeded
      • 'regenerated'   — admin asked us to redo it; succeeded
      • 'cached'        — hint already exists, no regen requested
      • 'skipped'       — no enriched articles yet → nothing to learn from
      • 'failed'        — Sonnet meta-call returned None / failed

    Failure is non-fatal: leave the hint at its current value (None
    on first run, stale value on regen) and move on. The next run
    retries.
    """
    from services import article_site_prompt_generator, article_scraper

    if existing_hint and not regenerate:
        return "cached"

    # Pull enriched articles for this roaster — title / image_url /
    # word_count / topic_category / tags / url. Skip rows that are
    # off-topic or had failed enrichment; we only want signal-rich
    # samples for the Sonnet meta-call.
    enriched_rows = db.execute(
        "SELECT url, title, excerpt, image_url, word_count, "
        "  published_at, topic_category, tags, is_about_coffee, "
        "  enrichment_status "
        "FROM roaster_articles "
        "WHERE roaster_slug = ? "
        "  AND enrichment_status = 'enriched' "
        "  AND is_about_coffee = 1 "
        "ORDER BY id DESC "
        "LIMIT 50",
        (slug,),
    ).fetchall()
    if not enriched_rows:
        return "skipped"

    # Decode tags from JSON for the meta-call's per-sample summary.
    articles: list[dict] = []
    for r in enriched_rows:
        d = dict(r)
        raw_tags = d.get("tags")
        if raw_tags:
            try:
                parsed = json.loads(raw_tags)
                d["tags"] = parsed if isinstance(parsed, list) else []
            except (TypeError, ValueError):
                d["tags"] = []
        else:
            d["tags"] = []
        articles.append(d)

    picks = article_site_prompt_generator.pick_samples(articles)
    if not picks:
        return "skipped"

    # Re-fetch live page text for each pick — we don't store it.
    samples: list[dict] = []
    for pick in picks:
        url = pick.get("url")
        if not url:
            continue
        try:
            html = article_scraper.fetch_article_html(url)
            extracted = article_scraper.extract_for_enrichment(
                html, base_url=url,
            )
        except Exception:
            # A single-sample fetch failure isn't fatal — keep going
            # with the remaining samples. Sonnet can still spot
            # patterns from 2-3 samples.
            continue
        samples.append({
            "article_url": url,
            "page_text": extracted.get("page_text") or "",
            "extracted": {
                "title": pick.get("title"),
                "summary": pick.get("excerpt"),
                "image_url": pick.get("image_url"),
                "word_count": pick.get("word_count"),
                "published_at": pick.get("published_at"),
                "topic_category": pick.get("topic_category"),
                "is_about_coffee": bool(pick.get("is_about_coffee", 1)),
                "tags": pick.get("tags") or [],
                "enrichment_status": pick.get("enrichment_status"),
            },
        })

    if not samples:
        return "failed"

    log(f"  {slug}: generating article-extraction site hint "
        f"({len(samples)} samples, {'regen' if regenerate else 'first-time'})")
    addendum = article_site_prompt_generator.generate_article_site_prompt_hint(
        roaster_name=roaster_name, samples=samples,
    )
    if addendum is None:
        log(f"  {slug}: hint generation FAILED — leaving hint unchanged")
        return "failed"

    db.execute(
        "UPDATE roaster_profiles SET "
        "  article_enrichment_prompt_hint = ?, "
        "  article_enrichment_prompt_hint_updated_at = ? "
        "WHERE roaster_slug = ?",
        (addendum or None, _now(), slug),
    )
    db.commit()
    return "regenerated" if regenerate else "generated"
