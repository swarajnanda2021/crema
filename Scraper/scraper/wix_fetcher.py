"""Hybrid fetcher for Wix-rendered product pages.

Why this exists:
  Wix is a JS-rendered SPA. A plain `requests.get` returns a hydration
  shell with all the structured product data (Producer / Variety / Notes
  / Process / Altitude — anything in the lavender table on a roaster's
  product page) loaded via Velo XHR calls AFTER page load. None of that
  reaches a non-JS scraper.

  The diagnosis we ran on 2026-05-20 confirmed this sitewide: 10 Wix
  roasters were getting truncated user_content (~618 chars) vs ~2660
  on Shopify/WooCommerce — because the Wix path was effectively only
  passing the listing description.

Strategy — cheap then expensive:
  1. **Stage 1 — `requests` + multi-source JSON extraction.** Pull the
     raw HTML, then look for the product data in ANY of: JSON-LD
     `Product` schema, `<script type="application/json">` blocks,
     embedded `window.viewerModel` / `window.warmupData` payloads. If
     the extracted content contains the tell-tale table keywords
     ("Producer", "Variety", "Altitude", "Process"), stage 1 wins.
  2. **Stage 2 — Playwright headless Chromium.** Render the page,
     wait for the table widget, dump cleaned text. Slower (3-8s per
     page) but 100% reliable. Triggers only when stage 1 misses.

The output is a single string of cleaned page text — same shape as
`Scraper/enrich.py:_fetch_product_page_text` returns for other
platforms. The caller wires it into the user_content under the
"PAGE TEXT (live fetch, cleaned — RICHEST SOURCE)" header that
Haiku is already trained to read.
"""

from __future__ import annotations

import json
import re
from typing import Optional

import requests
from bs4 import BeautifulSoup


# Heuristic: a Wix product page is "richly enough" extracted via
# stage 1 if the resulting text contains AT LEAST ONE of these keywords
# (signal that the table widget content made it into the HTML).
_TABLE_HINT_KEYWORDS = (
    "producer", "variety", "varietal", "altitude", "process",
    "elevation", "farm", "estate", "harvest",
)

# Cap on cleaned page text — keeps the prompt budget sane and mirrors
# Scraper/enrich.py:PAGE_TEXT_CAP.
PAGE_TEXT_CAP = 8000

# Playwright timeouts. Wix pages NEVER reach the default "load" event
# (long-poll connections to Wix's BI / analytics stay open
# indefinitely) and `networkidle` is similarly out of reach. We wait
# for `domcontentloaded` (HTML parsed, scripts queued) then sleep
# generously so the post-DOMContentLoaded Velo XHR cycle has time to
# fetch product data + paint the lavender detail table.
_PW_NAVIGATION_TIMEOUT_MS = 30_000
_PW_WAIT_AFTER_LOAD_MS = 4_000

_REQUESTS_TIMEOUT_S = 15
_REQUESTS_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def fetch_wix_html(url: str) -> str:
    """Fetch a Wix-rendered page and return the fully-rendered HTML.

    Same hybrid strategy as `fetch_wix_page_text`, but exposes the
    rendered HTML instead of cleaned text — needed by callers that
    have to run their own DOM-aware selectors against the markup
    (image picking, sitemap parsing, etc.). For the bio enrichment
    path in particular, the caller needs to extract `<img>` tags
    for logo/hero selection alongside text, so cleaned-text-only
    isn't enough.

    Returns the headless-rendered HTML when Playwright fires
    cleanly; falls back to the raw `requests.get` response when
    Playwright isn't installed / fails. Returns "" on total
    failure (network down, page 404s, etc.) — caller treats "" as
    "site unreachable", same shape as a plain requests miss.
    """
    if not url or not url.startswith(("http://", "https://")):
        return ""
    # Stage 1 — requests, used as both the cheap path AND the
    # fallback if Playwright isn't available. Always run it first
    # since we may need its HTML anyway.
    raw_html = _try_requests_html(url)
    # Stage 2 — Playwright, for the rendered DOM with table content.
    rendered = _try_playwright_html(url)
    return rendered or raw_html


def _try_requests_html(url: str) -> str:
    """Plain requests.get, return body text if 200 + HTML."""
    try:
        resp = requests.get(
            url,
            timeout=_REQUESTS_TIMEOUT_S,
            headers={
                "User-Agent": _REQUESTS_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
                "Accept-Language": "en-US,en;q=0.9",
            },
            allow_redirects=True,
        )
        if resp.status_code != 200:
            return ""
        ct = resp.headers.get("content-type", "")
        if "text/html" not in ct and "application/xhtml" not in ct:
            return ""
        return resp.text
    except (requests.RequestException, OSError):
        return ""


def _try_playwright_html(url: str) -> str:
    """Render in headless Chromium, return the full HTML.

    Same constraints as `_try_playwright_stage` (no `load` or
    `networkidle` — Wix never reaches those). Returns "" on any
    failure so the caller falls back to the requests HTML."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        return ""
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(
                    viewport={"width": 1280, "height": 1024},
                    user_agent=_REQUESTS_UA,
                )
                page = ctx.new_page()
                try:
                    page.goto(url, timeout=_PW_NAVIGATION_TIMEOUT_MS,
                              wait_until="domcontentloaded")
                except PWTimeout:
                    pass
                page.wait_for_timeout(_PW_WAIT_AFTER_LOAD_MS)
                html = page.content()
            finally:
                browser.close()
        return html or ""
    except Exception:
        return ""


def fetch_wix_page_text(url: str) -> str:
    """Fetch a Wix-rendered product page and return cleaned text.

    Tries the cheap path first; falls back to Playwright on miss.
    Returns "" if both paths fail (network down, page 404s, render
    timeout, no JSON-LD AND no table content after render). The
    caller treats "" the same as the non-Wix `_fetch_product_page_text`
    helper — fall back to whatever the listing endpoint provided.
    """
    if not url or not url.startswith(("http://", "https://")):
        return ""

    # Stage 1 — requests + multi-source JSON
    text = _try_requests_stage(url)
    if _looks_rich_enough(text):
        return text[:PAGE_TEXT_CAP]

    # Stage 2 — Playwright headless render
    rendered = _try_playwright_stage(url)
    if rendered:
        return rendered[:PAGE_TEXT_CAP]

    # Stage 1 might have given us SOMETHING (description, image) even
    # if not the rich table. Better than empty.
    return text[:PAGE_TEXT_CAP] if text else ""


# ─────────────────────────────────────────────────────────────────────
# Stage 1 — requests + multi-source JSON extraction
# ─────────────────────────────────────────────────────────────────────

def _try_requests_stage(url: str) -> str:
    """Plain HTTP fetch + scrape every embedded JSON blob we can find.

    Returns the concatenated cleaned text. Empty if the fetch fails.
    """
    try:
        resp = requests.get(
            url,
            timeout=_REQUESTS_TIMEOUT_S,
            headers={
                "User-Agent": _REQUESTS_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        if resp.status_code != 200:
            return ""
        html = resp.text
    except (requests.RequestException, OSError):
        return ""

    soup = BeautifulSoup(html, "lxml")

    chunks: list[str] = []

    # 1. JSON-LD Product schema(s) — same path Scraper/scraper/custom_scraper
    #    already uses, but here we extract the prose fields for the LLM
    #    rather than the structured offer.
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            payload = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        chunks.extend(_text_from_ld_payload(payload))

    # 2. Other JSON blobs — Wix often inlines `<script type="application/json">`
    #    blocks carrying viewerModel/initialData. Pull readable strings
    #    out of them.
    for tag in soup.find_all("script", type="application/json"):
        try:
            payload = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        flat = _flatten_strings(payload)
        if flat:
            chunks.append("\n".join(flat))

    # 3. Cleaned <body> text — strip nav/footer/script noise. Wix's
    #    static HTML carries breadcrumbs + cart copy + footer chrome
    #    that should be filtered, but any product-relevant strings the
    #    SSR managed to emit live here.
    for tag in soup(["script", "style", "nav", "footer", "header",
                      "aside", "noscript", "iframe", "form"]):
        tag.decompose()
    body = soup.body or soup
    body_text = body.get_text(separator="\n", strip=True)
    if body_text:
        chunks.append(body_text)

    return _dedupe_lines("\n".join(chunks))


def _text_from_ld_payload(payload) -> list[str]:
    """Pull human-readable strings out of a JSON-LD object/array."""
    candidates = payload if isinstance(payload, list) else [payload]
    if isinstance(payload, dict) and isinstance(payload.get("@graph"), list):
        candidates = payload["@graph"]
    out: list[str] = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        if str(c.get("@type", "")).lower() != "product":
            continue
        for key in ("name", "description"):
            v = c.get(key)
            if isinstance(v, str) and v.strip():
                out.append(f"{key.upper()}: {v.strip()}")
    return out


def _flatten_strings(payload, _depth: int = 0) -> list[str]:
    """Recurse a JSON tree and collect every string longer than 8
    chars (filters out enum-like keys, IDs, etc.). Capped depth to
    avoid runaway Wix structures."""
    if _depth > 12:
        return []
    if isinstance(payload, str):
        s = payload.strip()
        # Filter junk: URLs, base64, very short strings, hash-like blobs
        if (len(s) < 8 or len(s) > 1500
                or s.startswith(("http://", "https://", "data:", "blob:"))
                or re.fullmatch(r"[A-Za-z0-9+/=_-]+", s)):
            return []
        return [s]
    if isinstance(payload, dict):
        out: list[str] = []
        for v in payload.values():
            out.extend(_flatten_strings(v, _depth + 1))
        return out
    if isinstance(payload, list):
        out: list[str] = []
        for v in payload:
            out.extend(_flatten_strings(v, _depth + 1))
        return out
    return []


def _looks_rich_enough(text: str) -> bool:
    """Stage 1 verdict — does the extracted text contain at least one
    table keyword? Lowercase substring match across the text body."""
    if not text or len(text) < 200:
        return False
    lower = text.lower()
    return any(k in lower for k in _TABLE_HINT_KEYWORDS)


def _dedupe_lines(text: str) -> str:
    """Collapse duplicate consecutive lines + strip blank runs.
    Wix inlines its menu + footer copy multiple times across the
    HTML; we don't want Haiku reading the same chrome 5×."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line in seen:
            continue
        seen.add(line)
        out.append(line)
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────────────
# Stage 2 — Playwright headless Chromium
# ─────────────────────────────────────────────────────────────────────

def _try_playwright_stage(url: str) -> str:
    """Render the page in headless Chromium and extract cleaned text.

    Returns "" on any error (Playwright not installed, navigation
    timeout, Chromium crash, etc.) — caller falls back to stage 1's
    partial output. Importing playwright is lazy so the module loads
    fine on hosts where Playwright isn't present (e.g. CI without
    the install step)."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        return ""

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    user_agent=_REQUESTS_UA,
                    viewport={"width": 1280, "height": 1024},
                )
                page = context.new_page()
                try:
                    # `domcontentloaded` is the only Wix-compatible
                    # wait state — `load` and `networkidle` both wait
                    # forever for Wix's BI/long-poll sockets.
                    page.goto(url, timeout=_PW_NAVIGATION_TIMEOUT_MS,
                              wait_until="domcontentloaded")
                except PWTimeout:
                    pass  # try to extract whatever rendered anyway
                # Settle delay so the post-DOMContentLoaded Velo XHRs
                # have time to inject the product detail widget into
                # the DOM. Wix's table widget mounts ~2-3s in.
                page.wait_for_timeout(_PW_WAIT_AFTER_LOAD_MS)
                # Extract from <body>, drop chrome.
                html = page.content()
            finally:
                browser.close()
    except Exception:
        return ""

    return _extract_text_from_rendered_html(html)


def _extract_text_from_rendered_html(html: str) -> str:
    """Same cleaning as the stage-1 body-text extraction. Kept
    separate so we can tune stage 2 independently if needed (the
    rendered DOM has different chrome characteristics)."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header",
                      "aside", "noscript", "iframe", "form"]):
        tag.decompose()
    body = soup.body or soup
    text = body.get_text(separator="\n", strip=True)
    return _dedupe_lines(text)
