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
import json
import re
import xml.etree.ElementTree as ET
from typing import Callable, Iterable, Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (compatible; CremaArticleBot/1.0; "
    "+https://crema.coffee)"
)
TIMEOUT = 12

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
    r = requests.get(
        url, headers={"User-Agent": UA}, timeout=TIMEOUT,
        allow_redirects=True,
    )
    r.raise_for_status()
    return _extract_html_article(r.text, base_url=url)


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
    return sorted(handles)


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
    for this to work."""
    for path in ("/blog", "/journal", "/articles", "/stories",
                 "/blogs/news"):
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


def _parse_atom(url: str) -> list[dict]:
    """Atom 1.0 — entries carry title, link, summary, content,
    published, updated."""
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
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
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
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
    try:
        r = requests.get(sitemap_url, headers={"User-Agent": UA},
                         timeout=TIMEOUT)
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
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
    href that looks like /blog/<slug> or /blogs/<handle>/<slug> or a
    full URL on the same host pointing to a blog path."""
    soup = BeautifulSoup(html, "html.parser")
    base_host = urlparse(base_url).netloc
    candidates: list[str] = []
    seen: set[str] = set()
    article_re = re.compile(
        r"^(/blog/|/blogs/[^/]+/[^/]+|/journal/|/articles/|/stories/)"
    )
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
        # Reject the index page itself + section pages without a
        # trailing slug.
        if path.rstrip("/") in (
            "/blog", "/journal", "/articles", "/stories", "/blogs/news",
        ):
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

    return {
        "url": base_url,
        "title": title,
        "excerpt": excerpt,
        "image_url": image_url,
        "published_at": published_at,
        "body_html": body_html,
        "word_count": word_count or None,
    }


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
    fmts = (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
    )
    for f in fmts:
        try:
            dt = datetime.datetime.strptime(raw, f)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, TypeError):
            continue
    return raw


# ── Upsert helper (called from catalog_ops.run_article_scrape_job) ────────


def upsert_article(db, *, roaster_slug: str, article: dict,
                    now_iso: str) -> str:
    """Insert or update one article row. Returns 'inserted' / 'updated'
    / 'skipped'. URL is the dedup key (UNIQUE constraint). Per-row
    commits keep the writer-lock window short — same DB-lock
    discipline as services/scrape_runner.py:_insert_proposal."""
    url = (article.get("url") or "").strip()
    if not url:
        return "skipped"
    title = (article.get("title") or "").strip()
    if not title:
        return "skipped"

    existing = db.execute(
        "SELECT id, title, excerpt, image_url, body_html, "
        "  word_count, published_at "
        "FROM roaster_articles WHERE url = ?",
        (url,),
    ).fetchone()

    excerpt = article.get("excerpt")
    image_url = article.get("image_url")
    body_html = article.get("body_html")
    word_count = article.get("word_count")
    published_at = article.get("published_at")

    if existing is None:
        db.execute(
            "INSERT INTO roaster_articles "
            "(roaster_slug, url, title, excerpt, image_url, body_html, "
            " word_count, published_at, scraped_at, published, "
            " enrichment_status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')",
            (roaster_slug, url, title, excerpt, image_url, body_html,
             word_count, published_at, now_iso),
        )
        db.commit()
        return "inserted"

    # Update only when something changed (avoid pointless writes).
    changed = (
        (existing["title"] or "") != (title or "") or
        (existing["excerpt"] or "") != (excerpt or "") or
        (existing["image_url"] or "") != (image_url or "") or
        (existing["body_html"] or "") != (body_html or "") or
        (existing["word_count"] or 0) != (word_count or 0) or
        (existing["published_at"] or "") != (published_at or "")
    )
    if not changed:
        return "skipped"
    db.execute(
        "UPDATE roaster_articles SET "
        "  title = ?, excerpt = ?, image_url = ?, body_html = ?, "
        "  word_count = ?, published_at = COALESCE(?, published_at), "
        "  scraped_at = ? "
        "WHERE id = ?",
        (title, excerpt, image_url, body_html, word_count,
         published_at, now_iso, existing["id"]),
    )
    db.commit()
    return "updated"
