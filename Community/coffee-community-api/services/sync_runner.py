"""Catalog Ops v2 — unified sync runner.

One function per workflow. Both build CrawlSnapshots from the live
roaster website and produce a structured diff against the previous
snapshot. Both stage the agent work (bundles on disk) so a Claude
session (or eventual scheduled routine) can pick up the bundles,
spawn enrichment agents, and write the results.

The "agentic" half — spawning Sonnet/Haiku agents and persisting
their output — happens outside this module (Claude orchestrator or
a routine). This module is pure Python and produces side-effects
that those agents consume.

Public API:

    run_tab1_sync(slug)  →  full crawl, snapshot, stage every entity
                            as a pending bundle. Used for fresh roaster
                            onboarding + occasional re-baselines.

    run_tab2_sync(slug)  →  full crawl, snapshot, diff vs previous,
                            stage ONLY changed entities as bundles.
                            Steady-state refresh; cost-bounded by the
                            actual change set.

Both return a structured dict (job_summary) the caller can render.
Both write to `crawl_snapshots` + `crawl_snapshots_prev` and a
per-roaster bundle directory under /tmp/catalog_ops_v2/pending/.

Diff semantics — what fires an LLM call:
  bio_changed=True             → spawn Sonnet bio agent
  product added or updated     → spawn Haiku product agent
  product removed              → DB flag flip, no LLM
  article added or updated     → spawn Haiku article agent
  article removed              → DB flag flip, no LLM
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import article_scraper

# Where bundles get staged for the orchestrator to read
BUNDLE_ROOT = Path("/tmp/catalog_ops_v2/pending")
PAGE_TEXT_LIMIT = 16_000

UA = article_scraper.UA
TIMEOUT = article_scraper.TIMEOUT


# ── Hashing ────────────────────────────────────────────────────────────────


def _stable_hash(payload: str) -> str:
    """SHA-256 of canonicalized input, truncated to 16 hex chars."""
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _canonical_text(s: str) -> str:
    """Strip per-line whitespace + collapse blank-line runs. Idempotent
    across consecutive crawls of unchanged HTML."""
    if not s:
        return ""
    lines = [ln.strip() for ln in s.split("\n")]
    out: list[str] = []
    prev_blank = False
    for ln in lines:
        if not ln:
            if prev_blank:
                continue
            prev_blank = True
        else:
            prev_blank = False
        out.append(ln)
    return "\n".join(out).strip()


# ── Per-resource crawl helpers ─────────────────────────────────────────────


def _crawl_bio(website: str) -> dict:
    """Fetch the homepage and return {hash, text, len, image_url}.
    Image is best-effort — first prominent og:image or hero img."""
    try:
        r = requests.get(website, headers={"User-Agent": UA},
                         timeout=TIMEOUT, allow_redirects=True)
        if r.status_code != 200:
            return {"hash": "", "text": "", "len": 0, "image_url": None,
                     "error": f"http {r.status_code}"}
    except Exception as e:
        return {"hash": "", "text": "", "len": 0, "image_url": None,
                 "error": f"{type(e).__name__}: {e}"}

    soup = BeautifulSoup(r.text, "html.parser")
    og_image_el = soup.find("meta", property="og:image")
    og_image = og_image_el.get("content") if og_image_el else None
    if og_image:
        og_image = urljoin(r.url, og_image)

    for sel in ("nav", "header", "footer", "script", "style",
                "noscript", "form", "aside"):
        for el in soup.find_all(sel):
            el.decompose()
    for el in soup.select("[aria-hidden='true']"):
        el.decompose()

    text = _canonical_text(soup.get_text("\n", strip=True))
    return {
        "hash":      _stable_hash(text),
        "text":      text,
        "len":       len(text),
        "image_url": og_image,
    }


def _crawl_products_shopify(website: str) -> list[dict]:
    """Hit Shopify's /products.json (stable IDs)."""
    try:
        r = requests.get(f"{website.rstrip('/')}/products.json?limit=250",
                         headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    out: list[dict] = []
    for p in data.get("products", []):
        prices = sorted(v.get("price", "") for v in (p.get("variants") or []))
        available = any(v.get("available") for v in (p.get("variants") or []))
        identity = f"{p.get('title','')}|{available}|{','.join(prices)}"
        out.append({
            "id":         p.get("id"),
            "handle":     p.get("handle"),
            "url":        f"{website.rstrip('/')}/products/{p.get('handle','')}",
            "title":      (p.get("title") or "").strip(),
            "available":  available,
            "prices":     prices,
            "image_url":  ((p.get("images") or [{}])[0] or {}).get("src"),
            "hash":       _stable_hash(identity),
        })
    out.sort(key=lambda x: x.get("id") or 0)
    return out


def _crawl_products_generic(website: str) -> list[dict]:
    """Scrape known product-listing paths for non-Shopify roasters.
    Returns URL-only entries (hash = url). Coverage gap: hard-coded
    paths only — Wix's `/category/coffee` style needs platform-
    specific work, surfaced as a follow-up."""
    base = website.rstrip("/")
    paths = ["/shop", "/coffee", "/product", "/products",
             "/product-category/coffee", "/category/coffee"]
    seen: set[str] = set()
    out: list[dict] = []
    for path in paths:
        try:
            r = requests.get(f"{base}{path}", headers={"User-Agent": UA},
                             timeout=TIMEOUT, allow_redirects=True)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/product/" in href or "/products/" in href:
                    abs_url = urljoin(r.url, href.split("?")[0].rstrip("/"))
                    if abs_url not in seen:
                        seen.add(abs_url)
                        out.append({
                            "id":     None,
                            "url":    abs_url,
                            "handle": urlparse(abs_url).path.rsplit("/", 1)[-1],
                            "title":  a.get_text(strip=True)[:120] or None,
                            "hash":   _stable_hash(abs_url),
                        })
            if out:
                break
        except Exception:
            continue
    return out


def _crawl_articles(website: str, platform: Optional[str]) -> list[dict]:
    """Use the production discover() + enumerate_articles() helpers
    so the snapshot URL list matches what the article scraper would
    enumerate for a real run."""
    try:
        disc = article_scraper.discover(website, platform=platform)
    except Exception:
        return []
    if not disc:
        return []
    try:
        stubs = article_scraper.enumerate_articles(
            website, index_url=disc["index_url"],
            kind=disc["kind"], handles=disc.get("handles"),
        )
    except Exception:
        return []
    out: list[dict] = []
    for s in stubs:
        url = (s.get("url") or "").split("?")[0].rstrip("/")
        if not url:
            continue
        # Stub-level hash: URL + (stub title or published_at) if
        # present. Body-level hash comes later when the enrich agent
        # actually fetches the page. For Stage 0 / steady-state diff,
        # URL identity is enough to detect added/removed.
        out.append({
            "url":          url,
            "title":        s.get("title"),
            "published_at": s.get("published_at"),
            "hash":         _stable_hash(url),
        })
    # Sort by URL for deterministic ordering
    out.sort(key=lambda x: x["url"])
    return out


# ── Snapshot tables I/O ────────────────────────────────────────────────────


def _snapshot_get(conn: sqlite3.Connection, slug: str,
                   kind: str = "current") -> Optional[dict]:
    table = "crawl_snapshots" if kind == "current" else "crawl_snapshots_prev"
    row = conn.execute(
        f"SELECT taken_at, payload_json FROM {table} WHERE roaster_slug=?",
        (slug,),
    ).fetchone()
    if not row:
        return None
    return {"taken_at": row[0], "payload": json.loads(row[1])}


def _snapshot_set(conn: sqlite3.Connection, slug: str,
                   payload: dict) -> None:
    """Roll current → prev, write new current. N-1 retention by
    construction; older snapshots dropped."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)

    cur = conn.execute(
        "SELECT taken_at, payload_json FROM crawl_snapshots WHERE roaster_slug=?",
        (slug,),
    ).fetchone()
    if cur:
        conn.execute(
            "INSERT OR REPLACE INTO crawl_snapshots_prev "
            "(roaster_slug, taken_at, payload_json) VALUES (?, ?, ?)",
            (slug, cur[0], cur[1]),
        )
    conn.execute(
        "INSERT OR REPLACE INTO crawl_snapshots "
        "(roaster_slug, taken_at, payload_json) VALUES (?, ?, ?)",
        (slug, now, blob),
    )
    conn.commit()


def _diff(cur: dict, prev: Optional[dict]) -> dict:
    """Structured diff between current and prev snapshot payloads.
    No prev means everything is new (Tab 1 cold-start)."""
    if not prev:
        return {
            "has_prev":     False,
            "bio_changed":  True,
            "products":     {"added": cur.get("products", []),
                              "updated": [], "removed": []},
            "articles":    {"added": cur.get("articles", []),
                              "updated": [], "removed": []},
        }
    bio_changed = (cur.get("bio", {}).get("hash") !=
                    prev.get("bio", {}).get("hash"))

    def index(items: list, key: str) -> dict:
        return {it[key]: it for it in items if it.get(key) is not None}

    cp_prods = cur.get("products", [])
    pp_prods = prev.get("products", [])
    prod_key = "id" if (cp_prods and cp_prods[0].get("id") is not None) else "url"
    ci = index(cp_prods, prod_key)
    pi = index(pp_prods, prod_key)

    return {
        "has_prev":    True,
        "bio_changed": bio_changed,
        "products": {
            "added":   [ci[k] for k in ci if k not in pi],
            "updated": [ci[k] for k in ci if k in pi
                          and ci[k].get("hash") != pi[k].get("hash")],
            "removed": [pi[k] for k in pi if k not in ci],
        },
        "articles": {
            "added":   [cur_a for cur_a in cur.get("articles", [])
                          if cur_a["url"] not in {a["url"] for a in prev.get("articles", [])}],
            "updated": [],  # body-hash diffing happens during agent enrichment
            "removed": [prev_a for prev_a in prev.get("articles", [])
                          if prev_a["url"] not in {a["url"] for a in cur.get("articles", [])}],
        },
    }


# ── Bundle staging (for the agent orchestrator) ────────────────────────────


def _stage_bundle(slug: str, kind: str, payload: dict) -> str:
    """Write a JSON file under /tmp/catalog_ops_v2/pending/<slug>/<kind>/.
    Filename is sha1 of the URL or product handle. Returns the
    filename so the caller can list the work."""
    bdir = BUNDLE_ROOT / slug / kind
    bdir.mkdir(parents=True, exist_ok=True)
    ident = payload.get("url") or payload.get("handle") or payload.get("id") or ""
    fname = hashlib.sha1(str(ident).encode("utf-8")).hexdigest()[:16] + ".json"
    (bdir / fname).write_text(json.dumps(payload, ensure_ascii=False))
    return fname


def _clear_pending(slug: str) -> None:
    """Wipe any stale pending bundles for a roaster before re-staging."""
    bdir = BUNDLE_ROOT / slug
    if not bdir.exists():
        return
    for sub in bdir.glob("**/*.json"):
        sub.unlink()


# ── Public entry points ────────────────────────────────────────────────────


def _crawl(slug: str, website: str, platform: Optional[str]) -> dict:
    """Single full crawl. Returns the snapshot payload."""
    bio = _crawl_bio(website)
    if platform and "shopify" in (platform or "").lower():
        products = _crawl_products_shopify(website)
    else:
        products = _crawl_products_generic(website)
    articles = _crawl_articles(website, platform)
    return {
        "platform": platform,
        "bio":      {"hash": bio["hash"], "len": bio["len"],
                      "image_url": bio["image_url"]},
        "products": products,
        "articles": articles,
        # Keep the bio text alongside the snapshot for the Sonnet
        # bio agent's later consumption; it's not part of the hash.
        "_bio_text": bio["text"],
    }


def run_tab1_sync(slug: str, conn: Optional[sqlite3.Connection] = None) -> dict:
    """Tab 1 — full crawl + stage every entity as pending agent work.

    Used for fresh roaster onboarding (admin pastes a URL → row in
    roaster_profiles → run_tab1_sync(slug)) OR for a re-baseline of
    an existing roaster. Every product + every article in the crawl
    gets a pending bundle staged for the agent orchestrator.

    Returns a summary dict. Caller persists to job table.
    """
    from database import get_db
    owns_conn = conn is None
    conn = conn or get_db()

    row = conn.execute(
        "SELECT rp.name, rp.website, rs.platform "
        "FROM roaster_profiles rp "
        "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
        "WHERE rp.roaster_slug = ?",
        (slug,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"unknown slug: {slug}"}
    name, website, platform = row["name"], row["website"], row["platform"]

    if not website:
        return {"ok": False, "error": f"{slug} has no website"}

    _clear_pending(slug)
    payload = _crawl(slug, website, platform)
    bio_text = payload.pop("_bio_text", "")
    _snapshot_set(conn, slug, payload)

    # Stage all entities as pending work — Tab 1 is the cold-start so
    # everything's "added" from the agent's perspective.
    _stage_bundle(slug, "bio", {
        "slug": slug, "website": website, "name": name,
        "platform": platform, "bio_text": bio_text,
        "image_url": payload["bio"].get("image_url"),
    })
    for p in payload.get("products", []):
        _stage_bundle(slug, "product", {"slug": slug, **p})
    for a in payload.get("articles", []):
        _stage_bundle(slug, "article", {"slug": slug, **a})

    summary = {
        "ok": True, "mode": "tab1_full",
        "slug": slug, "website": website, "platform": platform,
        "bio_pending":     1,
        "products_pending": len(payload.get("products", [])),
        "articles_pending": len(payload.get("articles", [])),
        "snapshot_taken_at": _snapshot_get(conn, slug)["taken_at"],
    }
    if owns_conn:
        conn.close()
    return summary


def run_tab2_sync(slug: str, conn: Optional[sqlite3.Connection] = None) -> dict:
    """Tab 2 — diff-based refresh. Stage agent work ONLY for the diff.

    The cost story: steady-state weekly refresh on a 121-roaster
    catalog with ~0 changes runs ~10-20 min wall, 0 LLM calls. When
    something changed, only those entities get bundled.
    """
    from database import get_db
    owns_conn = conn is None
    conn = conn or get_db()

    row = conn.execute(
        "SELECT rp.name, rp.website, rs.platform "
        "FROM roaster_profiles rp "
        "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
        "WHERE rp.roaster_slug = ?",
        (slug,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"unknown slug: {slug}"}
    name, website, platform = row["name"], row["website"], row["platform"]

    if not website:
        return {"ok": False, "error": f"{slug} has no website"}

    prev = _snapshot_get(conn, slug, "current")
    payload = _crawl(slug, website, platform)
    bio_text = payload.pop("_bio_text", "")

    diff = _diff(payload, prev["payload"] if prev else None)
    _snapshot_set(conn, slug, payload)

    # Stage agent work ONLY for diff entities
    _clear_pending(slug)
    if diff["bio_changed"]:
        _stage_bundle(slug, "bio", {
            "slug": slug, "website": website, "name": name,
            "platform": platform, "bio_text": bio_text,
            "image_url": payload["bio"].get("image_url"),
        })
    for p in diff["products"]["added"] + diff["products"]["updated"]:
        _stage_bundle(slug, "product", {"slug": slug, **p})
    for a in diff["articles"]["added"] + diff["articles"]["updated"]:
        _stage_bundle(slug, "article", {"slug": slug, **a})

    # Removals are DB flag flips — no agent call. The caller can act
    # on these directly: product.available=0 / article.published=0.

    summary = {
        "ok": True, "mode": "tab2_diff",
        "slug": slug, "website": website, "platform": platform,
        "bio_pending":      1 if diff["bio_changed"] else 0,
        "products_pending": len(diff["products"]["added"]) + len(diff["products"]["updated"]),
        "products_removed": len(diff["products"]["removed"]),
        "articles_pending": len(diff["articles"]["added"]) + len(diff["articles"]["updated"]),
        "articles_removed": len(diff["articles"]["removed"]),
        "has_prev":         diff["has_prev"],
        # Cheap removals — for the caller to apply directly
        "removed":          {
            "products": diff["products"]["removed"],
            "articles": diff["articles"]["removed"],
        },
        "snapshot_taken_at": _snapshot_get(conn, slug)["taken_at"],
    }
    if owns_conn:
        conn.close()
    return summary


def get_pending(slug: str) -> dict:
    """List the staged agent bundles for a roaster. Used by the
    orchestrator to know what to spawn agents for."""
    bdir = BUNDLE_ROOT / slug
    if not bdir.exists():
        return {"bio": [], "product": [], "article": []}
    out: dict = {}
    for kind in ("bio", "product", "article"):
        sub = bdir / kind
        out[kind] = sorted(p.name for p in sub.glob("*.json")) if sub.exists() else []
    return out
