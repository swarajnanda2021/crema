"""
Article scraper — discovers + extracts roaster blog/journal articles.

Two-stage pipeline per roaster:

  1. Discovery — given a website + platform hint, find article URLs.
     Strategies (in priority order):
       a. Shopify    → /sitemap.xml → sitemap_blogs_*.xml →
                       enumerate blog handles →
                       /blogs/<handle>.atom for each
       b. WordPress  → /feed/  (NOT /blog/feed/ — that's the
                       comments feed, a known trap)
       c. Generic    → /feed, /rss, /atom.xml
       d. HTML index → scrape /blog, /journal, /articles
     The successful strategy is cached on `roaster_sources`
     (`articles_index_url`, `articles_feed_kind`, `articles_handles`)
     so subsequent runs skip enumeration.

  2. Extraction — for each new URL (URL is the dedup key against
     `roaster_articles`), fetch HTML and pull:
       • title         <title> or og:title
       • excerpt       og:description or first <p>
       • image_url     og:image
       • published_at  og:article:published_time or <time datetime=>
       • body_html     <article>, .article-template__content,
                       .rte, .entry-content, or <main>
       • word_count    derived from cleaned text length

Atom + RSS are parsed with stdlib xml.etree.ElementTree. HTML
extraction uses bs4 + html.parser. No lxml dependency.

The smoke-test findings (Black Poetry Atom, Blue Tokai sitemap,
Black Baza multi-handle, Naivo WP /feed/) showed bs4 +
<article>/.rte/.entry-content + og: metadata is sufficient for
all current Indian-specialty roasters; trafilatura/markdownify
remain unintroduced unless a roaster lands with hostile markup.
"""

from __future__ import annotations

import datetime
import io
import json
import os
import re
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, Iterable, Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (compatible; CremaArticleBot/1.0; "
    "+https://crema.coffee)"
)
TIMEOUT = 12

# Shopify's `sitemap_blogs_*.xml` enumerates EVERY blog handle on a
# storefront — including ones that aren't articles in any meaningful
# sense (founder/team bios, policy pages, contact, careers). The
# discovery step walks each handle and asks Haiku to extract an
# article from it; on a `team` handle, Haiku gets a Shopify product-
# page (`<small class="tax-note">Taxes included…</small>`) and
# either fabricates an "article" or returns is_article=false. The
# filter below short-circuits the walk.
_NON_ARTICLE_HANDLES = frozenset({
    "team", "about", "about-us", "policies", "policy", "contact",
    "contact-us", "legal", "pages", "careers", "press", "terms",
    "privacy", "shipping", "returns", "faq", "faqs", "help",
    "support", "wholesale-inquiry", "wholesale-application",
    "stockists", "store-locator",
})

# WebP article-hero pipeline. Hero images downloaded by the scraper
# get converted to WebP and stored under `/uploads/articles/` so the
# consumer reader serves a local, already-resized asset (the same
# treatment the rest of the site gives user-uploaded photos via
# `routes/uploads.py`). External hot-linking is the bs4-fallback
# behaviour and stays as a fallback when the download fails.
_API_ROOT = Path(__file__).resolve().parent.parent
_ARTICLE_UPLOADS_DIR = _API_ROOT / "uploads" / "articles"
_WEBP_QUALITY = 82
_IMG_TIMEOUT = 15
_IMG_MAX_BYTES = 8 * 1024 * 1024  # 8 MiB cap — refuse oversized hero downloads

# Atom + RSS namespaces (we handle both verbatim and namespace-bound).
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


# ── Public API ─────────────────────────────────────────────────────────────


def discover(website: str, platform: Optional[str] = None) -> Optional[dict]:
    """Find a roaster's article index. Returns
    `{index_url, kind, handles}` or None when no strategy worked.

    `platform` is the `roaster_sources.platform` hint (Sonnet bio
    enrichment fills it). 'shopify' / 'shopify_custom' get the
    sitemap-first path; 'woocommerce' / 'wordpress' get /feed/
    first; everything else falls through to generic + HTML."""
    base = website.rstrip("/")

    # Order strategies by platform hint when we have one.
    plat = (platform or "").strip().lower()
    if "shopify" in plat:
        strategies = [_shopify, _wordpress, _generic_feed, _html_index]
    elif "woo" in plat or "wordpress" in plat or "wp" in plat:
        strategies = [_wordpress, _shopify, _generic_feed, _html_index]
    else:
        strategies = [_shopify, _wordpress, _generic_feed, _html_index]

    for strategy in strategies:
        try:
            result = strategy(base)
        except Exception:
            result = None
        if result:
            return result
    return None


def enumerate_articles(website: str, *, index_url: str, kind: str,
                         handles: Optional[list[str]] = None) -> list[dict]:
    """Given a discovered index, return a list of partially-populated
    article dicts: `{url, title?, excerpt?, published_at?,
    image_url?, body_html?}`. Atom feeds usually carry inline
    content; sitemap-only paths return URL-only stubs and the caller
    must invoke `fetch_full_article(url)` to flesh each one out."""
    base = website.rstrip("/")
    if kind == "atom":
        if handles:
            out: list[dict] = []
            for h in handles:
                out.extend(_parse_atom(f"{base}/blogs/{h}.atom"))
            return out
        return _parse_atom(index_url)
    if kind == "rss":
        return _parse_rss(index_url)
    if kind == "sitemap":
        return _parse_sitemap_blog_urls(index_url)
    if kind == "html":
        return _parse_html_index(index_url)
    return []


def fetch_full_article(url: str) -> dict:
    """Fetch + extract a single article URL. Returns a dict with the
    canonical fields; missing values are None. Raises on network or
    parse failure (caller decides whether to swallow)."""
    return _extract_html_article(fetch_article_html(url), base_url=url)


def fetch_article_html(url: str) -> str:
    """Just the raw HTML — for callers that want to do their own
    extraction (e.g. the Haiku enricher takes the cleaned text +
    og: hints separately and shouldn't pay the bs4 cost twice)."""
    r = requests.get(
        url, headers={"User-Agent": UA}, timeout=TIMEOUT,
        allow_redirects=True,
    )
    r.raise_for_status()
    return r.text


def merge_full(stub: dict, full: dict) -> dict:
    """Stub from feed + full from HTML scrape — prefer stub values
    that are non-empty (Atom titles tend to be cleaner than the page
    <title>) and fall back to full for anything missing."""
    out = dict(full)
    for k, v in stub.items():
        if v and not out.get(k):
            out[k] = v
        elif v and k in ("title", "published_at"):
            # Trust feed title + date over the page's <title> /
            # og:article:published_time when both are present —
            # feeds carry the canonical roaster-asserted values.
            out[k] = v
    return out


# ── Discovery strategies ───────────────────────────────────────────────────


def _shopify(base: str) -> Optional[dict]:
    """Probe /sitemap.xml for sitemap_blogs_*.xml. Returns Atom-kind
    with the enumerated handles. Falls back to /blogs/news.atom
    direct-probe if sitemap is unhelpful."""
    handles = _shopify_blog_handles_from_sitemap(base)
    if handles:
        return {
            "index_url": f"{base}/sitemap.xml",
            "kind": "atom",
            "handles": handles,
        }
    # Direct-probe the canonical Shopify blog handle. Atom feeds at
    # /blogs/<handle>.atom return 200 with entries even if the
    # sitemap is missing.
    for h in ("news", "journal", "blog"):
        url = f"{base}/blogs/{h}.atom"
        try:
            r = requests.head(url, headers={"User-Agent": UA},
                              timeout=TIMEOUT, allow_redirects=True)
            if r.status_code == 200:
                # HEAD doesn't always return content-type; verify by GETting.
                r2 = requests.get(url, headers={"User-Agent": UA},
                                  timeout=TIMEOUT)
                if r2.status_code == 200 and "<feed" in r2.text[:500].lower():
                    return {
                        "index_url": url, "kind": "atom", "handles": [h],
                    }
        except Exception:
            continue
    return None


def _shopify_blog_handles_from_sitemap(base: str) -> list[str]:
    """Read /sitemap.xml, find sitemap_blogs_*.xml children, then
    enumerate blog handles from /blogs/<handle>/<slug> URLs inside
    those nested sitemaps."""
    sm_url = f"{base}/sitemap.xml"
    try:
        r = requests.get(sm_url, headers={"User-Agent": UA},
                         timeout=TIMEOUT)
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
    except Exception:
        return []
    # ns map for sitemapindex
    ns_sm = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    handles: set[str] = set()
    nested = [
        loc.text for loc in root.findall(f".//{ns_sm}sitemap/{ns_sm}loc")
        if loc.text and "sitemap_blogs" in loc.text
    ]
    for child_url in nested:
        try:
            r2 = requests.get(child_url, headers={"User-Agent": UA},
                              timeout=TIMEOUT)
            if r2.status_code != 200:
                continue
            child_root = ET.fromstring(r2.content)
            for loc in child_root.findall(f".//{ns_sm}url/{ns_sm}loc"):
                if not loc.text:
                    continue
                m = re.search(r"/blogs/([^/]+)/[^/]+/?$", loc.text)
                if m:
                    handles.add(m.group(1))
        except Exception:
            continue
    return sorted(h for h in handles if h not in _NON_ARTICLE_HANDLES)


def _wordpress(base: str) -> Optional[dict]:
    """WordPress sites expose /feed/ as RSS 2.0 with full-content
    <content:encoded>. /blog/feed/ is the COMMENTS feed (a trap)."""
    url = f"{base}/feed/"
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        # Sanity: must look like RSS or Atom. WordPress comments
        # feeds also live at /feed/?... but the root /feed/ is the
        # post feed.
        head = r.text[:500].lower()
        if "<rss" in head or "<feed" in head:
            kind = "atom" if "<feed" in head else "rss"
            return {"index_url": url, "kind": kind, "handles": None}
    except Exception:
        return None
    return None


def _generic_feed(base: str) -> Optional[dict]:
    """Catch-all feed probes for non-platform-detected roasters."""
    candidates = [
        ("/feed", None),
        ("/rss", None),
        ("/atom.xml", None),
    ]
    for path, _ in candidates:
        url = f"{base}{path}"
        try:
            r = requests.get(url, headers={"User-Agent": UA},
                             timeout=TIMEOUT)
            if r.status_code != 200:
                continue
            head = r.text[:500].lower()
            if "<rss" in head:
                return {"index_url": url, "kind": "rss", "handles": None}
            if "<feed" in head:
                return {"index_url": url, "kind": "atom", "handles": None}
        except Exception:
            continue
    return None


def _html_index(base: str) -> Optional[dict]:
    """Last resort — HTML index page whose article links we'll
    scrape. The roaster has to expose a /blog or /journal section
    for this to work.

    Wix sites use a `-N` suffix on the collection-root URL to
    disambiguate the page (`/journal`) from the items collection
    (`/journal-1`, `/journal-2`, …). Either can be the listing
    page depending on the template — probe both forms."""
    for path in (
        "/blog", "/blog-1",
        "/journal", "/journal-1",
        "/articles", "/articles-1",
        "/stories", "/stories-1",
        "/news", "/news-1",
        "/posts", "/posts-1",
        "/blogs/news",
    ):
        url = f"{base}{path}"
        try:
            r = requests.get(url, headers={"User-Agent": UA},
                             timeout=TIMEOUT, allow_redirects=True)
            if r.status_code != 200:
                continue
            # Heuristic: page must have at least 3 anchors that look
            # like article links. _parse_html_index re-runs the link
            # extraction so the discovery probe is just a sanity gate.
            urls = _extract_index_links(r.text, base_url=url)
            if len(urls) >= 3:
                return {"index_url": url, "kind": "html", "handles": None}
        except Exception:
            continue
    return None


# ── Feed parsers ───────────────────────────────────────────────────────────


def _fetch_xml_with_pw_fallback(url: str) -> Optional[bytes]:
    """Fetch XML/feed content. Try requests.get first; on non-200 or
    exception, escalate to Playwright (which can clear CF rate-limit
    walls by presenting a browser fingerprint). Black Baza's
    /blogs/*.atom returns 503 to scripted requests; the Playwright
    render goes through. Returns the raw bytes (XML) or None on
    total failure.

    Playwright renders XML wrapped in a tiny HTML viewer — extract the
    inner XML text via the <pre> tag or just strip the wrapper. We do
    the simplest thing: grab whatever's between <body>...</body>, then
    fall back to the raw rendered HTML if there's no body tag.
    """
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code == 200:
            return r.content
    except Exception:
        pass

    # Tier 4 Playwright fallback for CF-walled feeds.
    try:
        from services.sync_runner import _render_wix_html
    except ImportError:
        return None
    rendered = _render_wix_html(url)
    if not rendered:
        return None
    # Playwright wraps XML in <html><head></head><body><pre>{XML}</pre></body></html>
    # — strip the wrapper to get to the XML.
    import re as _re
    pre_match = _re.search(
        r"<pre[^>]*>(.*?)</pre>", rendered, _re.DOTALL | _re.IGNORECASE,
    )
    if pre_match:
        # Unescape HTML entities — Playwright entitizes `<` etc.
        import html as _html
        return _html.unescape(pre_match.group(1)).encode("utf-8")
    # No <pre>? Return the raw rendered bytes — xml parser may still cope.
    return rendered.encode("utf-8")


def _parse_atom(url: str) -> list[dict]:
    """Atom 1.0 — entries carry title, link, summary, content,
    published, updated."""
    content = _fetch_xml_with_pw_fallback(url)
    if not content:
        return []
    try:
        root = ET.fromstring(content)
    except Exception:
        return []
    out: list[dict] = []
    for e in root.findall(f"{{{NS['atom']}}}entry"):
        link_el = e.find(f"{{{NS['atom']}}}link")
        href = link_el.get("href") if link_el is not None else None
        if not href:
            continue
        title_el = e.find(f"{{{NS['atom']}}}title")
        title = (title_el.text or "").strip() if title_el is not None else ""
        summary_el = e.find(f"{{{NS['atom']}}}summary")
        excerpt = (
            (summary_el.text or "").strip() if summary_el is not None else None
        )
        published_el = e.find(f"{{{NS['atom']}}}published")
        if published_el is None:
            published_el = e.find(f"{{{NS['atom']}}}updated")
        published_at = (
            (published_el.text or "").strip()
            if published_el is not None else None
        )
        # Atom entries can carry inline content.
        content_el = e.find(f"{{{NS['atom']}}}content")
        body_html = None
        if content_el is not None:
            body_html = (content_el.text or "").strip() or None
        out.append({
            "url": href,
            "title": title or None,
            "excerpt": excerpt,
            "published_at": published_at,
            "body_html": body_html,
        })
    return out


def _parse_rss(url: str) -> list[dict]:
    """RSS 2.0 — items carry title, link, description, pubDate, and
    optional content:encoded with full HTML."""
    content = _fetch_xml_with_pw_fallback(url)
    if not content:
        return []
    try:
        root = ET.fromstring(content)
    except Exception:
        return []
    out: list[dict] = []
    for item in root.findall(".//item"):
        link = (item.findtext("link") or "").strip()
        if not link:
            continue
        title = (item.findtext("title") or "").strip()
        excerpt = (item.findtext("description") or "").strip() or None
        pub = (item.findtext("pubDate") or "").strip() or None
        encoded = item.findtext(f"{{{NS['content']}}}encoded")
        body_html = (encoded or "").strip() or None
        out.append({
            "url": link,
            "title": title or None,
            "excerpt": excerpt,
            "published_at": _normalize_pubdate(pub),
            "body_html": body_html,
        })
    return out


def _parse_sitemap_blog_urls(sitemap_url: str) -> list[dict]:
    """Walk a Shopify sitemap_blogs_*.xml and return URL-only stubs
    (caller fills body via fetch_full_article)."""
    content = _fetch_xml_with_pw_fallback(sitemap_url)
    if not content:
        return []
    try:
        root = ET.fromstring(content)
    except Exception:
        return []
    ns_sm = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    out: list[dict] = []
    for url_el in root.findall(f".//{ns_sm}url"):
        loc = url_el.findtext(f"{ns_sm}loc")
        if not loc:
            continue
        # Skip section index pages — only article pages have a
        # trailing slug after the handle.
        if not re.search(r"/blogs/[^/]+/[^/]+/?$", loc):
            continue
        lastmod = url_el.findtext(f"{ns_sm}lastmod")
        out.append({
            "url": loc, "published_at": lastmod, "title": None,
            "excerpt": None, "body_html": None,
        })
    return out


def _parse_html_index(url: str) -> list[dict]:
    """Scrape an HTML index page for article links."""
    try:
        r = requests.get(url, headers={"User-Agent": UA},
                         timeout=TIMEOUT, allow_redirects=True)
        if r.status_code != 200:
            return []
    except Exception:
        return []
    urls = _extract_index_links(r.text, base_url=url)
    return [
        {"url": u, "title": None, "excerpt": None, "body_html": None,
         "published_at": None}
        for u in urls
    ]


def _extract_index_links(html: str, *, base_url: str) -> list[str]:
    """Pull article links from a /blog HTML index. Heuristic: anchor
    href that looks like:
      - /blog/<slug>, /journal/<slug>, /articles/<slug>, /stories/<slug>
      - /blog-N/<slug>, /journal-N/<slug>, … (Wix collection suffix)
      - /blogs/<handle>/<slug> (Shopify-style nested)
    on the same host as the index page."""
    soup = BeautifulSoup(html, "html.parser")
    base_host = urlparse(base_url).netloc
    candidates: list[str] = []
    seen: set[str] = set()
    # The `(-\d+)?` slot catches Wix's `/journal-1/`, `/blog-2/` etc.
    # collection-root suffix; bare `/journal/{slug}` paths still match.
    article_re = re.compile(
        r"^(?:"
        r"/blog(?:-\d+)?/[^/]+"
        r"|/blogs/[^/]+/[^/]+"
        r"|/journal(?:-\d+)?/[^/]+"
        r"|/articles(?:-\d+)?/[^/]+"
        r"|/stories(?:-\d+)?/[^/]+"
        r"|/news(?:-\d+)?/[^/]+"
        r"|/posts(?:-\d+)?/[^/]+"
        r")"
    )
    # Section/index roots — exclude these even when the regex
    # accidentally matches a `/journal-1/` with a trailing slash and
    # no slug (the [^/]+ already prevents this, but belt-and-braces).
    SECTION_ROOTS = {
        "/blog", "/journal", "/articles", "/stories",
        "/news", "/posts", "/blogs/news",
    }
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href:
            continue
        # Resolve relative paths to absolute.
        absolute = urljoin(base_url, href)
        path = urlparse(absolute).path
        # Same-host only.
        if urlparse(absolute).netloc != base_host:
            continue
        if not article_re.match(path):
            continue
        # Reject the index/section roots in either bare or suffixed
        # form (`/journal` AND `/journal-1`).
        stripped = path.rstrip("/")
        if stripped in SECTION_ROOTS:
            continue
        if re.fullmatch(r"/(blog|journal|articles|stories|news|posts)-\d+", stripped):
            continue
        if path.startswith("/blogs/") and path.count("/") < 3:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        candidates.append(absolute)
    return candidates


# ── HTML article extraction ───────────────────────────────────────────────


def _extract_html_article(html: str, *, base_url: str) -> dict:
    """Extract title / excerpt / image / body from an article page.
    Body extraction tries Shopify (`<article>`,
    `.article-template__content`, `.rte`), WordPress
    (`.entry-content`), then `<main>`."""
    soup = BeautifulSoup(html, "html.parser")

    title = _meta(soup, "og:title") or (
        soup.title.string.strip() if soup.title and soup.title.string else None
    )
    excerpt = _meta(soup, "og:description")
    image_url = _meta(soup, "og:image")
    if image_url:
        image_url = urljoin(base_url, image_url)

    published_at = (
        _meta(soup, "article:published_time")
        or _meta(soup, "og:article:published_time")
    )
    if not published_at:
        time_el = soup.find("time", attrs={"datetime": True})
        if time_el and time_el.get("datetime"):
            published_at = time_el["datetime"].strip()

    body_node = (
        soup.select_one(".article-template__content")
        or soup.select_one(".rte")
        or soup.select_one(".entry-content")
        or soup.select_one("article")
        or soup.select_one("main")
    )
    body_html = None
    word_count = 0
    if body_node is not None:
        # Strip noise: nav, header, footer, scripts, styles, hidden.
        for sel in ("nav", "header", "footer", "script", "style"):
            for el in body_node.find_all(sel):
                el.decompose()
        for el in body_node.select("[aria-hidden='true']"):
            el.decompose()
        body_html = str(body_node)
        text = body_node.get_text(" ", strip=True)
        word_count = len(text.split())
        if not excerpt:
            # First non-empty paragraph as fallback excerpt.
            p = body_node.find("p")
            if p:
                excerpt = p.get_text(" ", strip=True)[:280]

    # When og:image is absent, scan the body for a hero candidate so
    # roasters that omit OG metadata (G-Shot, Aromas-of-Coorg) still
    # land a hero on the JOURNAL card. Haiku gets the same candidate
    # via extract_for_enrichment so it doesn't have to re-scan the
    # body for itself.
    if not image_url and body_node is not None:
        image_url = _first_body_image(body_node, base_url)

    return {
        "url": base_url,
        "title": title,
        "excerpt": excerpt,
        "image_url": image_url,
        "published_at": published_at,
        "body_html": body_html,
        "word_count": word_count or None,
    }


# Substrings that disqualify a body `<img src>` from being the hero.
# Order doesn't matter; substring-match is enough for the obvious
# cases (logos, social icons, tracking pixels, share-button SVGs).
_HERO_IMG_DISQUALIFIERS = (
    "logo", "icon", "favicon", "twitter.com", "facebook.com",
    "instagram.com", "x.com", "linkedin.com", "pixel", "1x1",
    "spacer", "share", "social", "avatar", "emoji", "loader",
    "loading", "sprite", "bg-", "/bg.", "background",
)


def _first_body_image(body_node, base_url: str) -> Optional[str]:
    """Pick the first reasonable `<img>` inside `body_node` to use as
    a hero. Returns an absolute URL or None.

    Heuristic order:
      1. Skip `data:` URIs (inline base64), tracking pixels, logos,
         social icons, share-button graphics.
      2. Prefer images that declare a width >= 600 (either via
         `width=` attr or in the URL like `_1024x.jpg` shopify hint).
      3. Failing that, return the first non-disqualified absolute
         URL — Haiku gets the next pass and will reject if it isn't
         article-like.
    """
    candidates: list[str] = []
    for img in body_node.find_all("img"):
        # Shopify lazy-loads via data-src; pick that over src when
        # src points at a placeholder.
        src = (
            img.get("data-src")
            or img.get("data-original")
            or img.get("data-lazy-src")
            or img.get("src")
        )
        if not src:
            continue
        src = src.strip()
        if not src or src.startswith("data:"):
            continue
        lowered = src.lower()
        if any(token in lowered for token in _HERO_IMG_DISQUALIFIERS):
            continue
        absolute = urljoin(base_url, src)
        # Prefer images that look "big enough" via the width attr.
        width_attr = img.get("width") or ""
        try:
            width_int = int(re.match(r"\d+", str(width_attr)).group(0))  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            width_int = 0
        if width_int >= 600:
            return absolute
        candidates.append(absolute)
    return candidates[0] if candidates else None


def _meta(soup: BeautifulSoup, name: str) -> Optional[str]:
    el = soup.find("meta", attrs={"property": name})
    if el is None:
        el = soup.find("meta", attrs={"name": name})
    if el is None:
        return None
    val = el.get("content", "").strip()
    return val or None


def _normalize_pubdate(raw: Optional[str]) -> Optional[str]:
    """Try to normalize an RSS pubDate (RFC-822) into ISO-8601. Return
    the raw string when parsing fails — Discover JOURNAL still groups
    by COALESCE(published_at, scraped_at) so a malformed date is
    harmless."""
    if not raw:
        return None
    raw = raw.strip()
    # RFC 822: "Mon, 01 Jan 2024 12:34:56 +0000"
    # Shopify JSON-LD: "2026-01-03 11:05:39 +0530"
    fmts = (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S %z",
        "%Y-%m-%d",
    )
    for f in fmts:
        try:
            dt = datetime.datetime.strptime(raw, f)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, TypeError):
            continue
    return raw


def _extract_jsonld_date(soup: BeautifulSoup) -> Optional[str]:
    """Pull `datePublished` from JSON-LD Article / BlogPosting /
    NewsArticle / TechArticle schemas on the page.

    Delegates to the canonical
    `services.jsonld_extractor.extract_article_date`. Kept as a
    thin wrapper here so existing call-sites in this module don't
    need to change.

    Shopify is the dominant pattern here — its default blog
    templates emit JSON-LD with `BlogPosting` containing
    `datePublished` while leaving `og:article:published_time` and
    `<time datetime=>` empty. Without this branch, the scraper's
    date extraction misses every Shopify blog that doesn't
    customise its head metadata (442 of 912 articles in catalog
    as of 2026-05-13 landed with published_at = NULL because of
    this gap). Caller passes the result through
    `_normalize_pubdate` for ISO coercion.
    """
    from services.jsonld_extractor import (
        extract_jsonld_blocks, extract_article_date,
    )
    blocks = extract_jsonld_blocks(soup)
    return extract_article_date(blocks)


# ── Page-text + og: hint extraction (Haiku enricher input) ─────────────────


_YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:embed/|watch\?(?:[^#]*&)?v=|v/|shorts/)"
    r"|youtu\.be/)([A-Za-z0-9_-]{11})",
    re.IGNORECASE,
)
_VIMEO_ID_RE = re.compile(
    r"(?:vimeo\.com/(?:video/|channels/[^/]+/|groups/[^/]+/videos/)?"
    r"|player\.vimeo\.com/video/)(\d{6,12})",
    re.IGNORECASE,
)


def _extract_video_embeds(html: str) -> list[dict]:
    """Find every YouTube + Vimeo embed reference in raw page HTML and
    return canonicalised entries.

    Runs over the RAW HTML before BS4 strips nav/script/iframe/etc.
    chrome — by that point the iframes are already gone and Haiku has
    no signal that there's a video on the page. We surface the
    detected videos as a separate enricher-input field so Haiku can
    place a `<video-embed>` block where the source positioned them in
    body prose.

    Dedupes on (platform, video_id) so the same embed appearing in
    iframe src + a bare-URL share link doesn't produce two entries.
    Captures both iframe-embed forms (the common `youtube.com/embed/`
    iframe + `player.vimeo.com/video/`) AND bare URLs in href / text
    (`youtu.be/ID`, `youtube.com/watch?v=ID`, `vimeo.com/ID`) which
    some authors paste in body prose instead of using an embed.

    Returns a list of dicts shaped:
        {"platform": "youtube" | "vimeo",
         "video_id": "vbEADaG4F2Y",
         "url":      "https://youtu.be/vbEADaG4F2Y"}
    in source order. Empty list when nothing matched.
    """
    if not html:
        return []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for m in _YOUTUBE_ID_RE.finditer(html):
        vid = m.group(1)
        key = ("youtube", vid)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "platform": "youtube",
            "video_id": vid,
            "url": f"https://youtu.be/{vid}",
        })

    for m in _VIMEO_ID_RE.finditer(html):
        vid = m.group(1)
        key = ("vimeo", vid)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "platform": "vimeo",
            "video_id": vid,
            "url": f"https://vimeo.com/{vid}",
        })

    return out


def _extract_body_links(soup: BeautifulSoup, base_url: str) -> list[dict]:
    """Find every inline <a href> link inside the article body (post
    nav/footer/script strip) and return absolute-URL entries with
    visible text.

    Surfaces source body-prose links to Haiku as a `DETECTED BODY
    LINKS` block in the user message. The body_html allow-list rule
    already says 'preserve every <a href> the source has inside body
    prose', but Haiku is non-deterministic on which links it
    preserves — explicit listing eliminates the drift. The
    renderer's embed-resolver then matches each href against the
    in-app catalog (products + sibling articles).

    Includes only links whose visible text is non-empty and ≤ 100
    chars, with href pointing to /products/, /blogs/, /collections/
    paths or any non-relative URL. Drops same-page anchors, mailto,
    javascript:.

    Dedupes on (canonical href, visible text) so a product mentioned
    twice doesn't produce two entries. Source-order preserved.
    """
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for a in soup.find_all("a", href=True):
        href = a.get("href", "").strip()
        text = a.get_text(strip=True)
        if not href or not text or len(text) > 100:
            continue
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        # Build absolute URL.
        try:
            abs_url = urljoin(base_url, href)
        except (ValueError, TypeError):
            continue
        # Only keep http(s).
        if not (abs_url.startswith("http://") or abs_url.startswith("https://")):
            continue
        # Drop chrome paths that bs4 didn't fully scrub. Shopify
        # Dawn-style themes embed the mega-menu links inside <main>
        # rather than <nav>, so the bs4 chrome strip leaves them
        # behind. Keep only what's plausibly a body link:
        #   - /products/<slug>                (product page)
        #   - /collections/<x>/products/<y>   (product via category)
        #   - /blogs/<x>/<y>                  (sibling article)
        #   - any cross-domain http(s) link   (citation, source)
        # Drop everything else (bare collections, /pages/*, social
        # icons, cart/login/policy chrome).
        path_low = abs_url.lower()
        if any(p in path_low for p in (
            "/cart", "/account", "/login", "/search", "/policies/",
            "/checkout", "/orders", "/pages/", "facebook.com",
            "instagram.com", "twitter.com", "x.com", "linkedin.com",
            "youtube.com", "shopify.com", "tiktok.com", "pinterest.com",
        )):
            continue
        try:
            p = urlparse(abs_url)
            same_host = p.netloc.lower().lstrip("www.") == urlparse(base_url).netloc.lower().lstrip("www.")
        except Exception:
            same_host = False
        if same_host:
            # On-site links: only product / collection-product / blog
            # paths count as body content. Bare collection roots and
            # the homepage are chrome.
            path = p.path.rstrip("/")
            looks_body = (
                path.startswith("/products/")
                or path.startswith("/blogs/")
                or ("/products/" in path and path.startswith("/collections/"))
            )
            if not looks_body:
                continue
            # Drop the homepage / empty path explicitly.
            if path in ("", "/"):
                continue
            # `/blogs/<handle>` (2 segments) is the blog ROOT — Shopify
            # renders a "Back to blog" anchor pointing to it at the
            # end of every article body. That's chrome. Real article
            # links have 3 segments: `/blogs/<handle>/<slug>`.
            #
            # This is a structural rule (URL shape only), not an
            # anchor-text denylist. Anchor text like "Read more" or
            # "Back to blog" can legitimately appear mid-prose
            # pointing to a real article — those URLs have the slug
            # so they pass; only the bare blog-root anchors fail.
            if path.startswith("/blogs/") and path.count("/") < 3:
                continue
        # Strip Shopify-specific tracking params (`?pr_prod_strat=`,
        # `?_pos=`, `?_sid=`, `?variant=`) so the same product
        # surfaced via different click-paths dedupes.
        try:
            u = urlparse(abs_url)
            from urllib.parse import parse_qsl, urlencode
            cleaned_q = [
                (k, v) for k, v in parse_qsl(u.query)
                if not k.startswith(("pr_", "_pos", "_sid", "utm_"))
                and k not in ("variant", "ref")
            ]
            canon = u._replace(query=urlencode(cleaned_q)).geturl()
        except Exception:
            canon = abs_url

        key = (canon, text)
        if key in seen:
            continue
        seen.add(key)
        out.append({"url": canon, "text": text})

    return out


def extract_for_enrichment(html: str, *, base_url: str) -> dict:
    """Strip every chrome element from the page and return the cleaned
    text + og: hints + the bs4-fallback structured extraction in one
    pass. The Haiku enricher takes the cleaned text + hints; the
    fallback extraction stays as a safety net so the runner can still
    write an article row when the LLM call fails or
    `is_article=False` is returned in error.
    """
    soup = BeautifulSoup(html, "html.parser")

    og_title = _meta(soup, "og:title")
    og_description = _meta(soup, "og:description")
    og_image_raw = _meta(soup, "og:image")
    og_image = urljoin(base_url, og_image_raw) if og_image_raw else None
    # Date-extraction cascade — checked in order until one returns a
    # value. The first three are the historical paths; JSON-LD was
    # added 2026-05-13 because Shopify's default blog template emits
    # `datePublished` in <script type="application/ld+json"> ONLY,
    # which is invisible to og:meta + <time> probes. Without it, 442
    # of 912 articles landed with NULL published_at (then displayed
    # the scrape date in the UI, misleading the user).
    og_published_at = (
        _meta(soup, "article:published_time")
        or _meta(soup, "og:article:published_time")
    )
    if not og_published_at:
        time_el = soup.find("time", attrs={"datetime": True})
        if time_el and time_el.get("datetime"):
            og_published_at = time_el["datetime"].strip()
    if not og_published_at:
        og_published_at = _extract_jsonld_date(soup)
    # Normalize to ISO so downstream comparisons / sort don't have to
    # juggle formats. Falls back to the raw string when no format
    # matches — Discover JOURNAL groups by COALESCE so a malformed
    # date is harmless.
    if og_published_at:
        og_published_at = _normalize_pubdate(og_published_at) or og_published_at

    # Strip globally — nav, header, footer, scripts, styles, noscript,
    # forms, and aria-hidden subtrees. Page text becomes the article
    # body + any inline figcaptions / pull quotes / sidebars Haiku
    # needs to judge what's body and what's not.
    cleaned = BeautifulSoup(html, "html.parser")
    for sel in ("nav", "header", "footer", "script", "style",
                "noscript", "form", "aside"):
        for el in cleaned.find_all(sel):
            el.decompose()
    for el in cleaned.select("[aria-hidden='true']"):
        el.decompose()
    # Shopify Dawn-style themes embed mega-menus + drawer popovers
    # inside <main> (not <nav>), so the strips above leave them
    # behind. Target the common container class fragments — these
    # are the chrome wrappers the theme uses for header drawers,
    # account popovers, search overlays, cart drawers, etc.
    chrome_class_fragments = (
        "mega-menu", "menu-drawer", "menu-bar", "account-popover",
        "search-popover", "cart-drawer", "predictive-search",
        "header__inline-menu", "search-modal",
        # Shopify "AI footer column" blocks — hashed class names like
        # `ai-footer-column-azxaruwlpr1u3ugxdcaigenblock759374cwc97jw`
        # wrap footer link grids that survive the <footer> strip.
        "ai-footer-column", "ai-footer-columns",
    )
    for frag in chrome_class_fragments:
        for el in cleaned.select(f"[class*='{frag}']"):
            el.decompose()
    page_text = cleaned.get_text("\n", strip=True)
    # Collapse 3+ blank lines so the LLM doesn't waste tokens on
    # whitespace.
    page_text = re.sub(r"\n{3,}", "\n\n", page_text)

    fallback = _extract_html_article(html, base_url=base_url)

    # When og:image is missing, hand Haiku the body-img candidate
    # found by the bs4 fallback so its hero pick has a real seed.
    # Haiku still has the option to override with a different inline
    # image — this just ensures it isn't seeing "(none)" when the
    # page does carry a visible hero.
    og_image_hint = og_image or fallback.get("image_url")

    # Scan the RAW html (not the cleaned body) for video embeds —
    # BS4 already stripped iframes by this point in `cleaned`, so we
    # have to look at the original. See `_extract_video_embeds`.
    detected_videos = _extract_video_embeds(html)

    # Inline body links: scan the cleaned body so nav/footer chrome
    # is already gone. Haiku is told to preserve every <a href> in
    # body prose, but it's non-deterministic on which ones survive.
    # Surfacing the list explicitly in the user message + having an
    # explicit prompt rule "every URL in DETECTED BODY LINKS must
    # appear in body_html" eliminates the drift. See `_extract_body_links`.
    detected_links = _extract_body_links(cleaned, base_url)

    return {
        "page_text": page_text,
        "og_title": og_title,
        "og_description": og_description,
        "og_image": og_image_hint,
        "og_published_at": og_published_at,
        "detected_videos": detected_videos,
        "detected_links": detected_links,
        "fallback": fallback,
    }


# ── Hero image: download + WebP convert + persist ─────────────────────────


def download_hero_image(image_url: Optional[str]) -> Optional[str]:
    """Fetch the hero, convert to WebP, persist under
    `/uploads/articles/`, return the path the API serves it at
    (`/uploads/articles/...webp`). Returns None when the download
    fails or Pillow can't decode the bytes — caller falls back to the
    original external URL.

    Tries common URL-form variations on first failure (force https,
    drop `www.`) — Haiku occasionally relays a stale URL form from
    in-body `<img src="http://www....">` even when the canonical
    asset lives at `https://...`. The retry is cheap and recovers
    real-world cases like Black Baza's mixed-form CDN paths.

    Mirrors `routes/uploads.py:_save_converted` so consumer-facing
    article hero images go through the same WebP pipeline as user-
    uploaded photos. Quality 82, single-frame (animated GIFs flatten
    to first frame), max 8 MiB input.
    """
    if not image_url:
        return None
    try:
        from PIL import Image, UnidentifiedImageError  # local import — keeps boot light
    except ImportError:
        return None  # Pillow missing — shouldn't happen, surfaces in the upload route too

    content = _fetch_image_bytes(image_url)
    if content is None:
        # Try canonical variants. Order: https + drop www, https only,
        # drop www only. Stops at first 200 with body.
        for alt in _alt_image_urls(image_url):
            content = _fetch_image_bytes(alt)
            if content is not None:
                break
    if content is None:
        return None

    try:
        img = Image.open(io.BytesIO(content))
        if getattr(img, "is_animated", False):
            img.seek(0)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        os.makedirs(_ARTICLE_UPLOADS_DIR, exist_ok=True)
        # Random suffix per write — articles can rescrape and the
        # roaster might rotate the hero, so a fresh filename keeps
        # CDN/expo-image caches honest. Old files for replaced heroes
        # become orphans on disk; a periodic cleanup can sweep them
        # but the bytes are small enough that the leak isn't urgent.
        fname = f"{uuid.uuid4().hex}.webp"
        out_path = _ARTICLE_UPLOADS_DIR / fname
        img.save(str(out_path), format="WEBP", quality=_WEBP_QUALITY,
                 method=4)
        return f"/uploads/articles/{fname}"
    except (UnidentifiedImageError, OSError, ValueError):
        return None


def _fetch_image_bytes(url: str) -> Optional[bytes]:
    try:
        r = requests.get(
            url,
            headers={"User-Agent": UA, "Accept": "image/*,*/*"},
            timeout=_IMG_TIMEOUT,
            stream=True,
            allow_redirects=True,
        )
        r.raise_for_status()
        content = r.raw.read(_IMG_MAX_BYTES + 1, decode_content=True)
        if len(content) > _IMG_MAX_BYTES:
            return None  # oversized — skip
        return content
    except Exception:
        return None


def _alt_image_urls(url: str) -> list[str]:
    """Yield URL forms to retry when the original fails. Covers the
    two common drift modes we've hit: stale http:// (force https),
    and a `www.` host that the CDN doesn't resolve (drop the prefix).
    """
    parts = urlparse(url)
    if not parts.scheme or not parts.netloc:
        return []
    host = parts.netloc
    out: list[str] = []
    # Force https + drop www (most aggressive).
    if host.startswith("www."):
        out.append(parts._replace(scheme="https", netloc=host[4:]).geturl())
    # Force https only.
    if parts.scheme != "https":
        out.append(parts._replace(scheme="https").geturl())
    # Drop www only (keep scheme).
    if host.startswith("www."):
        out.append(parts._replace(netloc=host[4:]).geturl())
    # Dedup while preserving order.
    seen: set[str] = set()
    deduped: list[str] = []
    for u in out:
        if u != url and u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


# ── Upsert helper (called from catalog_ops.run_article_scrape_job) ────────


def upsert_article(db, *, roaster_slug: str, article: dict,
                    now_iso: str,
                    enrichment_status: str = "pending",
                    is_about_coffee: bool = True,
                    topic_category: Optional[str] = None,
                    tags: Optional[list[str]] = None,
                    published_override: Optional[int] = None) -> str:
    """Insert or update one article row. Returns 'inserted' / 'updated'
    / 'skipped'. URL is the dedup key (UNIQUE constraint). Per-row
    commits keep the writer-lock window short — same DB-lock
    discipline as services/scrape_runner.py:_insert_proposal.

    `enrichment_status` is stamped on every write — caller passes
    'enriched' when Haiku succeeded, 'failed' when Haiku errored, or
    leaves the default 'pending' for bs4-only fallback writes.

    `is_about_coffee` / `topic_category` / `tags` come from Haiku's
    Layer-A gate fields. Off-topic rows write with `published=0`
    automatically (admin can override — they still see the row).
    `published_override` lets the runner force `published=0` for
    other reasons (admin-initiated hide); when None the publish
    state is inferred from `is_about_coffee` on insert and left
    untouched on update (so manual hides survive a re-scrape).
    """
    url = (article.get("url") or "").strip()
    if not url:
        return "skipped"
    title = (article.get("title") or "").strip()
    if not title:
        return "skipped"

    existing = db.execute(
        "SELECT id, title, excerpt, image_url, body_html, "
        "  word_count, published_at, enrichment_status, "
        "  is_about_coffee, topic_category, tags "
        "FROM roaster_articles WHERE url = ?",
        (url,),
    ).fetchone()

    excerpt = article.get("excerpt")
    image_url = article.get("image_url")
    body_html = article.get("body_html")
    word_count = article.get("word_count")
    published_at = article.get("published_at")
    coffee_int = 1 if is_about_coffee else 0
    tags_json = json.dumps(tags) if tags else None

    if existing is None:
        # Default insert: off-topic rows are hidden from consumers
        # but kept visible to admin (the prompt's locked behavior).
        if published_override is not None:
            published_initial = 1 if published_override else 0
        else:
            published_initial = 1 if is_about_coffee else 0
        db.execute(
            "INSERT INTO roaster_articles "
            "(roaster_slug, url, title, excerpt, image_url, body_html, "
            " word_count, published_at, scraped_at, published, "
            " enrichment_status, is_about_coffee, topic_category, tags) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (roaster_slug, url, title, excerpt, image_url, body_html,
             word_count, published_at, now_iso, published_initial,
             enrichment_status, coffee_int, topic_category, tags_json),
        )
        db.commit()
        return "inserted"

    # Update only when something changed (avoid pointless writes).
    existing_tags = existing["tags"] or None
    changed = (
        (existing["title"] or "") != (title or "") or
        (existing["excerpt"] or "") != (excerpt or "") or
        (existing["image_url"] or "") != (image_url or "") or
        (existing["body_html"] or "") != (body_html or "") or
        (existing["word_count"] or 0) != (word_count or 0) or
        (existing["published_at"] or "") != (published_at or "") or
        (existing["enrichment_status"] or "") != (enrichment_status or "") or
        ((existing["is_about_coffee"] or 0) != coffee_int) or
        ((existing["topic_category"] or "") != (topic_category or "")) or
        ((existing_tags or "") != (tags_json or ""))
    )
    if not changed:
        return "skipped"
    db.execute(
        "UPDATE roaster_articles SET "
        "  title = ?, excerpt = ?, image_url = ?, body_html = ?, "
        "  word_count = ?, published_at = COALESCE(?, published_at), "
        "  scraped_at = ?, enrichment_status = ?, "
        "  is_about_coffee = ?, topic_category = ?, tags = ? "
        "WHERE id = ?",
        (title, excerpt, image_url, body_html, word_count,
         published_at, now_iso, enrichment_status,
         coffee_int, topic_category, tags_json, existing["id"]),
    )
    db.commit()
    return "updated"
