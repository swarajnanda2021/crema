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
    """Strip per-line whitespace + collapse blank-line runs + scrub
    high-churn ephemera so the resulting hash is stable across
    consecutive fetches of effectively-unchanged pages.

    Without ephemera-scrubbing, the May 19 -> May 21 diff sweep
    showed `bio_changed=true` on 90+ of 96 roasters even though no
    real bio updates had happened — homepages carry a rotating
    "latest articles" carousel + cart count + cookie date + featured
    product slider, any of which flips the byte-identity hash on
    every fetch. We can't strip those by selector alone (they live
    in <main>, not <nav>/<footer>), so we redact common patterns at
    the canonicalization layer."""
    if not s:
        return ""
    # Redact obvious ephemera BEFORE hashing.
    # 1. Cart-count widget: "Cart (3)", "Cart 0", "(3) items" etc.
    s = re.sub(r"\bCart\s*[\(:]?\s*\d+\s*\)?", "Cart", s, flags=re.IGNORECASE)
    s = re.sub(r"\(\s*\d+\s*\)\s*item[s]?", "items", s, flags=re.IGNORECASE)
    # 2. ISO + numeric dates that update per-fetch (timestamps,
    #    "last updated", "as of").
    s = re.sub(r"\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[Z\-+\d:]*)?\b", "<date>", s)
    s = re.sub(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", "<date>", s)
    # 3. © year — flips at most yearly; redact so the year boundary
    #    doesn't trigger a bio_changed.
    s = re.sub(r"©\s*\d{4}", "© <year>", s)
    s = re.sub(r"\bCopyright\s+\d{4}\b", "Copyright <year>", s, flags=re.IGNORECASE)
    # 4. CSRF / nonce / build-hash blobs (16+ hex chars or
    #    underscore-separated tokens).
    s = re.sub(r"\b[a-f0-9]{16,}\b", "<hex>", s, flags=re.IGNORECASE)

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

    # Strip high-churn body widgets — these are the actual cause of
    # universal bio_changed=true in diff sweeps. Featured-product
    # sliders, recent-blog carousels, "you may also like" rails, and
    # promo banners all rotate per-fetch even when the actual roaster
    # bio hasn't changed. Class-name substring matching covers the
    # naming conventions across Shopify themes (Dawn / Debut), Wix
    # widgets, and WooCommerce blocks.
    _CHURN_SELECTORS = (
        # Carousels / sliders of any kind.
        "[class*='carousel']", "[class*='slider']", "[class*='slideshow']",
        # Latest / recent / featured anything.
        "[class*='latest']", "[class*='recent']", "[class*='featured']",
        # Blog / news widgets that surface the latest N posts.
        "[class*='blog-card']", "[class*='blog-post']", "[class*='blog-grid']",
        "[class*='news-grid']", "[class*='post-card']",
        # Product widgets that show featured / new arrivals.
        "[class*='product-card']", "[class*='product-grid']",
        "[class*='product-list']", "[class*='product-rail']",
        "[class*='related-products']", "[class*='product-recommendations']",
        # Wix-specific data-hook widgets that mount dynamic content.
        "[data-hook*='product-list']", "[data-hook*='product-grid']",
        "[data-hook*='product-card']", "[data-hook*='blog-post']",
        # Cookie banner / promo bar.
        "[class*='cookie']", "[class*='announcement']", "[class*='promo-bar']",
        # Cart widget (item counts flip per-session).
        "[class*='cart-count']", "[class*='cart-item-count']",
        "[id*='cart-count']", "[data-hook*='cart-count']",
    )
    for sel in _CHURN_SELECTORS:
        for el in soup.select(sel):
            el.decompose()

    text = _canonical_text(soup.get_text("\n", strip=True))
    # Truncate to the first 2000 chars — homepage hero + intro text
    # lives at the top; anything past 2000 chars is invariably
    # newsletter signup / shipping copy / FAQ / footer-ish chrome
    # that we already mostly stripped but want to belt-and-suspender
    # cap. Caps stabilize the hash against later-page additions that
    # don't reflect a real bio update.
    text = text[:2000]
    return {
        "hash":      _stable_hash(text),
        "text":      text,
        "len":       len(text),
        "image_url": og_image,
    }


def _crawl_products_shopify(website: str) -> tuple[list[dict], str]:
    """Hit Shopify's /products.json (stable IDs).

    Returns (products, status) where status is:
      - "ok": the fetch succeeded; products list (possibly empty) is
        authoritative
      - "empty_retry_confirmed": the first fetch returned 0 products;
        a retry confirmed empty (most likely a real "store is paused"
        scenario worth flagging to admin)
      - "failed_network": connection error (DNS, TLS, timeout, refused).
        Products list is NOT authoritative — caller should suppress
        the diff to avoid false-positive "everything removed" signals
      - "failed_http_<code>": got a non-200 response (rate-limit, 5xx,
        Cloudflare interstitial). Same as failed_network — don't trust.
      - "failed_parse": got 200 but JSON didn't decode — likely a CF
        challenge HTML page returned as 200. Don't trust.

    The pre-2026-05-21 behaviour was to return [] on ALL of these,
    which made transient scraper failures masquerade as catalog wipes
    (e.g. the diff sweep on 2026-05-21 reported humble-express as
    "products_removed: 39" when the products were still there — the
    one bad fetch in between two good ones produced a false delete
    signal).
    """
    url = f"{website.rstrip('/')}/products.json?limit=250"

    def _fetch_once() -> tuple[list, str]:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        except (requests.RequestException, OSError) as e:
            return [], f"failed_network: {type(e).__name__}"
        if r.status_code != 200:
            return [], f"failed_http_{r.status_code}"
        try:
            data = r.json()
        except ValueError as e:
            return [], f"failed_parse: {type(e).__name__}"
        if not isinstance(data, dict):
            return [], "failed_parse: not_a_dict"
        return data.get("products", []) or [], "ok"

    raw, status = _fetch_once()

    # Retry once on success-but-empty — Shopify occasionally returns
    # an empty product list under rate-limit before serving the real
    # response. The retry usually clears the throttle.
    if status == "ok" and not raw:
        import time as _time
        _time.sleep(2.0)
        retry_raw, retry_status = _fetch_once()
        if retry_status == "ok":
            if retry_raw:
                raw, status = retry_raw, "ok"
            else:
                # Confirmed empty after retry. Probably real (store has
                # no products listed). Flag distinctly so the diff layer
                # can still treat the result as authoritative but the
                # operator can spot the pattern across roasters.
                status = "empty_retry_confirmed"
        else:
            # Retry hit a network/HTTP error — keep the original "ok"
            # but trust nothing; mark as failed.
            status = retry_status

    if status not in ("ok", "empty_retry_confirmed"):
        return [], status

    data = {"products": raw}
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
    return out, status


_PRODUCT_PATH_SEGMENTS = (
    "/product/", "/products/", "/product-page/",
    "/shop/", "/store/", "/coffee/",
)


def _crawl_products_generic(website: str) -> list[dict]:
    """Scrape product-listing URLs for non-Shopify roasters.

    Three sources tried in order, returning at the first non-empty hit:
      1. Sitemap (`/sitemap.xml`, `/store-products-sitemap.xml`)
      2. Known listing paths (`/shop`, `/coffee`, etc.)
      3. Wix-specific: re-render the listing page via Playwright if
         the static HTML matches Wix markers, then re-parse hrefs.

    Pre-fix this returned [] for every Wix roaster — `/shop` etc.
    didn't exist, the static HTML had no product links (SPA shell),
    sitemap.xml wasn't probed. The diff sweep on 2026-05-21 showed
    8/8 Wix roasters at 0 products as a result. The sitemap path
    catches most Wix stores (the standard /store-products-sitemap.xml
    is emitted by Wix Stores automatically). Playwright is the
    last-resort path for Wix stores that gate the sitemap.

    Returns URL-only entries (hash = url). Per-product content hashes
    happen later during enrichment.
    """
    base = website.rstrip("/")
    seen: set[str] = set()
    out: list[dict] = []

    def _add_link(abs_url: str, title: Optional[str] = None) -> None:
        if not abs_url:
            return
        clean = abs_url.split("?")[0].rstrip("/")
        path = urlparse(clean).path.lower()
        if not any(seg in path for seg in _PRODUCT_PATH_SEGMENTS):
            return
        if clean in seen:
            return
        seen.add(clean)
        out.append({
            "id":     None,
            "url":    clean,
            "handle": urlparse(clean).path.rsplit("/", 1)[-1],
            "title":  (title or "")[:120] or None,
            "hash":   _stable_hash(clean),
        })

    # 1. Sitemap discovery — covers Wix Stores
    #    (`/store-products-sitemap.xml`), most WooCommerce installs,
    #    and any large Shopify-but-misclassified store.
    sitemap_candidates = [
        f"{base}/store-products-sitemap.xml",
        f"{base}/sitemap.xml",
    ]
    sitemap_queue = list(sitemap_candidates)
    sitemap_seen: set[str] = set()
    while sitemap_queue and len(sitemap_seen) < 20:
        sm_url = sitemap_queue.pop(0)
        if sm_url in sitemap_seen:
            continue
        sitemap_seen.add(sm_url)
        try:
            r = requests.get(sm_url, headers={"User-Agent": UA},
                             timeout=TIMEOUT, allow_redirects=True)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "lxml-xml")
            # Sitemap-index: enqueue child sitemaps.
            if soup.find("sitemap"):
                for child in soup.find_all("sitemap"):
                    loc = child.find("loc")
                    if loc:
                        child_url = loc.get_text(strip=True)
                        if child_url and child_url not in sitemap_seen:
                            sitemap_queue.append(child_url)
                continue
            # Leaf sitemap: extract product URLs.
            for loc in soup.find_all("loc"):
                _add_link(loc.get_text(strip=True))
        except Exception:
            continue

    if out:
        return out

    # 2. Listing-page discovery — the original path.
    paths = ["/shop", "/coffee", "/product", "/products",
             "/product-category/coffee", "/category/coffee",
             "/store", "/store/coffee"]
    listing_html: Optional[str] = None
    listing_resp_url: Optional[str] = None
    for path in paths:
        try:
            r = requests.get(f"{base}{path}", headers={"User-Agent": UA},
                             timeout=TIMEOUT, allow_redirects=True)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                _add_link(urljoin(r.url, a["href"]),
                          title=a.get_text(strip=True))
            if out:
                return out
            # Remember the first reachable listing page for the
            # Playwright fallback below.
            if listing_html is None:
                listing_html = r.text
                listing_resp_url = r.url
        except Exception:
            continue

    # 3. Playwright fallback for Wix-rendered storefronts where
    #    sitemap discovery missed and the static HTML had no links.
    if listing_html and _looks_wix(listing_html):
        rendered = _render_wix_html(listing_resp_url or base)
        if rendered:
            soup = BeautifulSoup(rendered, "html.parser")
            for a in soup.find_all("a", href=True):
                _add_link(urljoin(listing_resp_url or base, a["href"]),
                          title=a.get_text(strip=True))

    return out


# Wix marker substrings — matches the rendered SPA shell.
_WIX_MARKERS = (
    "wixstatic.com",
    "static.parastorage.com",
    "viewerModel",
    "_wixCIDX",
    "data-thunderbolt",
    "wix-viewer",
)


def _looks_wix(html: str) -> bool:
    if not html:
        return False
    return any(m in html for m in _WIX_MARKERS)


def _render_wix_html(url: str) -> str:
    """Headless Chromium render for Wix listings. Lazy-imports
    Playwright so the sync runner still loads on hosts without the
    package installed (e.g. CI). Returns "" on any failure — caller
    treats "" as "couldn't render, no fallback work".

    Same constraints as Scraper/scraper/wix_fetcher: `domcontentloaded`
    is the only Wix-compatible wait state (`load` and `networkidle`
    both wait forever for Wix's BI long-poll sockets); a 4s settle
    delay after DOM-ready lets the Velo XHR cycle mount the product
    grid widget.
    """
    try:
        from playwright.sync_api import (
            sync_playwright,
            TimeoutError as PWTimeout,
        )
    except ImportError:
        return ""
    try:
        # Wire happy-eyeballs IP hints into the Chromium DNS layer.
        # urllib3 patch doesn't help Chromium — it reads system DNS
        # via its own resolver, so we hand it the winning IPs via
        # --host-resolver-rules. See services/http_client.py.
        try:
            from services.http_client import chromium_host_resolver_rules_arg, pick_best_ip
            from urllib.parse import urlsplit as _urlsplit
            # Warm the cache for this URL's host first so the rules
            # arg actually includes it.
            _p = _urlsplit(url)
            if _p.hostname:
                pick_best_ip(_p.hostname, _p.port or (443 if _p.scheme == "https" else 80))
            host_rules = chromium_host_resolver_rules_arg()
        except ImportError:
            host_rules = None
        launch_args = [host_rules] if host_rules else []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=launch_args)
            try:
                ctx = browser.new_context(
                    viewport={"width": 1280, "height": 1024},
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                )
                page = ctx.new_page()
                try:
                    page.goto(url, timeout=30_000,
                              wait_until="domcontentloaded")
                except PWTimeout:
                    pass
                page.wait_for_timeout(4000)
                return page.content() or ""
            finally:
                browser.close()
    except Exception:
        return ""


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
    construction; older snapshots dropped.

    Refusal rule (added 2026-05-21): if `payload.scrape_status.products`
    indicates a network/HTTP/parse failure (`failed_*`), DO NOT rotate
    prev → newer-but-bad. Preserve the last good snapshot as the diff
    anchor. We still UPDATE crawl_snapshots so the operator sees the
    fresh `taken_at` + `scrape_status`, but we don't overwrite the prev
    with a known-bad current. This prevents a cascade where two
    consecutive bad scrapes lose the historical comparison frame
    entirely.
    """
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)

    products_status = (payload.get("scrape_status") or {}).get("products") or "ok"
    bio_status = (payload.get("scrape_status") or {}).get("bio") or "ok"
    is_failed_scrape = (
        products_status.startswith("failed")
        or bio_status.startswith("failed")
    )

    cur = conn.execute(
        "SELECT taken_at, payload_json FROM crawl_snapshots WHERE roaster_slug=?",
        (slug,),
    ).fetchone()
    if cur and not is_failed_scrape:
        # Only rotate prev when the new current is trustworthy. Failed
        # scrapes get overlaid on current (the timestamp updates, the
        # status is recorded) but the prev anchor is preserved.
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
    No prev means everything is new (Tab 1 cold-start).

    Refusal rules (added 2026-05-21):
      - If `cur.scrape_status.products` is a `failed_*` value, suppress
        the products diff entirely and carry prev's product list
        forward. Rationale: a TLS/timeout/CF failure produces an empty
        list, and treating that as authoritative reports "everything
        removed" when nothing was actually removed (humble-express
        symptom from the diff sweep audit).
      - `empty_retry_confirmed` and `empty_unknown` ARE treated as
        authoritative (the store really might have nothing, e.g. the
        roaster paused inventory) — but flagged in the response so
        the operator can see the pattern.
      - Same logic for bio: a failed bio fetch suppresses bio_changed.
    """
    if not prev:
        return {
            "has_prev":     False,
            "bio_changed":  True,
            "products":     {"added": cur.get("products", []),
                              "updated": [], "removed": []},
            "articles":    {"added": cur.get("articles", []),
                              "updated": [], "removed": []},
            "scrape_status": cur.get("scrape_status") or {},
        }

    cur_status = cur.get("scrape_status") or {}
    bio_status = cur_status.get("bio") or "ok"
    products_status = cur_status.get("products") or "ok"

    # Bio diff (suppressed on failure).
    if bio_status.startswith("failed"):
        bio_changed = False  # don't trust empty bio hash
        bio_diff_suppressed = True
    else:
        bio_changed = (cur.get("bio", {}).get("hash") !=
                        prev.get("bio", {}).get("hash"))
        bio_diff_suppressed = False

    def index(items: list, key: str) -> dict:
        return {it[key]: it for it in items if it.get(key) is not None}

    # Products diff (suppressed on failure — caller sees empty added /
    # updated / removed and a `suppressed` flag).
    if products_status.startswith("failed"):
        products_diff = {
            "added": [], "updated": [], "removed": [],
            "suppressed": True,
            "suppressed_reason": products_status,
        }
    else:
        cp_prods = cur.get("products", [])
        pp_prods = prev.get("products", [])
        prod_key = "id" if (cp_prods and cp_prods[0].get("id") is not None) else "url"
        ci = index(cp_prods, prod_key)
        pi = index(pp_prods, prod_key)
        products_diff = {
            "added":   [ci[k] for k in ci if k not in pi],
            "updated": [ci[k] for k in ci if k in pi
                          and ci[k].get("hash") != pi[k].get("hash")],
            "removed": [pi[k] for k in pi if k not in ci],
        }
        # Flag suspicious-but-not-suppressed states so the dashboard
        # can highlight them. The data IS authoritative, just unusual.
        if products_status == "empty_retry_confirmed":
            products_diff["status_note"] = "empty_after_retry"

    return {
        "has_prev":    True,
        "bio_changed": bio_changed,
        "bio_diff_suppressed": bio_diff_suppressed,
        "products": products_diff,
        "articles": {
            "added":   [cur_a for cur_a in cur.get("articles", [])
                          if cur_a["url"] not in {a["url"] for a in prev.get("articles", [])}],
            "updated": [],  # body-hash diffing happens during agent enrichment
            "removed": [prev_a for prev_a in prev.get("articles", [])
                          if prev_a["url"] not in {a["url"] for a in cur.get("articles", [])}],
        },
        "scrape_status": cur_status,
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
    """Single full crawl. Returns the snapshot payload.

    The payload now carries `scrape_status` so the diff layer can
    distinguish a real empty-storefront state ("ok" / "empty_retry_confirmed")
    from a transient scrape failure ("failed_network" / "failed_http_*"
    / "failed_parse"). Pre-2026-05-21 every failure mode collapsed to
    an empty list, causing the diff layer to report false-positive
    "everything removed" signals during transient outages.
    """
    bio = _crawl_bio(website)
    bio_status = "ok" if bio.get("hash") else "failed"
    if platform and "shopify" in (platform or "").lower():
        products, products_status = _crawl_products_shopify(website)
    else:
        products = _crawl_products_generic(website)
        # Generic path doesn't differentiate failure modes yet — assume
        # "ok" when products list non-empty, "empty_unknown" otherwise.
        # This is conservative: the diff layer will accept the result
        # but the operator can spot the bucket if many roasters land
        # here.
        products_status = "ok" if products else "empty_unknown"
    articles = _crawl_articles(website, platform)
    return {
        "platform": platform,
        "bio":      {"hash": bio["hash"], "len": bio["len"],
                      "image_url": bio["image_url"]},
        "products": products,
        "articles": articles,
        "scrape_status": {
            "bio":      bio_status,
            "products": products_status,
        },
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
