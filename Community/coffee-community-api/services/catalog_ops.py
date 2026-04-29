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
    _seed_roaster_sources_combined(conn)
    _seed_sca_addresses(conn)
    _seed_sca_tree(conn)
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
    """
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
    """Insert the canonical SCA tree as the first version + active row.
    No-op if any version already exists (so admin uploads aren't
    overwritten on restart).
    """
    row = conn.execute(
        "SELECT id FROM sca_tree_versions LIMIT 1"
    ).fetchone()
    if row:
        return
    conn.execute(
        "INSERT INTO sca_tree_versions "
        "(uploaded_at, uploaded_by, tree_json, is_active, notes) "
        "VALUES (?, NULL, ?, 1, 'Canonical SCA flavor tree (seeded)')",
        (_now(), json.dumps(sca_geolocator.CANONICAL_TREE)),
    )
    conn.commit()
    print("Catalog-ops seed: inserted canonical SCA tree as version 1")


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


def enqueue_job(db, kind: str, started_by: int) -> int:
    """Insert a new job row in `queued` state. Raises `JobConflict` if a
    job of the same kind is already live."""
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
        stamped = scrape_runner.stamp_sources_scraped(db)
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
