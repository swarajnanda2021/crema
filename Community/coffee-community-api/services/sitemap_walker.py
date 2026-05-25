"""
Generic sitemap-based product-URL discovery.

This is the canonical sitemap walker for the catalog-ops pipeline.
Replaces four prior implementations (custom_scraper, sync_runner,
article_scraper, roaster_enricher) that each rolled their own,
diverged in subtle ways, and missed each other's improvements.

## Why sitemap-first

Every modern e-commerce platform (Shopify, WooCommerce, Wix Stores,
Squarespace, Magento) emits a sitemap as part of basic SEO. The
sitemap is the canonical "every product URL the public can reach"
feed, INDEPENDENT of which collection / category the admin pinned
as the catalog-ops `shop_url`. This is the architectural answer to
the narrow-shop_url bug class — sitemap discovery returns the full
catalog regardless of whether the admin pointed us at
/collections/coffee-for-cafe (Drum) or /collections/specialty-
selection (Reserved). The configured shop_url becomes a hint, not
a hard scope.

## What it does

1. Probe well-known sitemap entry points for the host.
2. Follow sitemap-index entries recursively (capped at 20 sitemaps
   total to prevent runaway recursion on pathological cases).
3. Extract every `<loc>` whose path matches the configured product-
   URL patterns.
4. Deduplicate by canonical URL (strip trailing slash, lowercase
   host) and return.

## Entry points probed (in order)

Each probed against both `host` and `www.host` to handle either-
side redirects:

- `/sitemap.xml`                  — universal
- `/store-products-sitemap.xml`   — Wix Stores convention
- `/sitemap_products_1.xml`       — Shopify products sitemap
- `/sitemap_index.xml`            — Yoast SEO convention
- `/wp-sitemap.xml`               — WordPress 5.5+ native
- `/wp-sitemap-posts-product-1.xml` — Yoast WooCommerce
- `/page-sitemap.xml`             — sometimes carries product pages

The first non-empty leaf wins; we still follow sitemap-index
entries from any probe that returns one.

## Output

`discover_product_urls(website, ...) -> List[ProductUrlEntry]`

Each entry carries (url, lastmod_iso, source_sitemap) so callers
can dedupe across leaves AND know which sitemap surfaced each URL
for debugging.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from typing import Iterable, List, Optional, Set
from urllib.parse import urlparse
import xml.etree.ElementTree as ET


# Default product-URL path segments — used to filter sitemap entries
# to "looks like a product page" vs nav/content/etc. Caller can
# override per-platform if their store uses a non-standard layout.
DEFAULT_PRODUCT_PATH_SEGMENTS = (
    "/product/",        # Shopify, WooCommerce, generic
    "/products/",       # Shopify (plural)
    "/product-page/",   # Wix Stores
    "/shop/",           # WooCommerce (sometimes)
    "/store/",          # Squarespace, custom
    "/item/",           # eBay-style, some custom
    "/coffee/",         # Indian roaster convention
    "/buy/",            # some custom
    "/beans/",          # some specialty stores
    "/lots/",           # microlot stores
)

# Sitemap entry-point paths to probe per host. Order is preference —
# first non-empty leaf returns. We still follow sitemap-index
# entries discovered along the way.
DEFAULT_SITEMAP_PATHS = (
    "/store-products-sitemap.xml",   # Wix Stores — narrowest, most signal
    "/sitemap_products_1.xml",       # Shopify products sitemap (first page)
    "/sitemap_index.xml",            # Yoast SEO master index
    "/wp-sitemap.xml",               # WordPress 5.5+ native index
    "/wp-sitemap-posts-product-1.xml",  # Yoast WC products
    "/sitemap.xml",                  # universal — last because broadest
)

# Maximum number of sitemap URLs we'll follow in one walk. Keeps a
# pathological sitemap-of-sitemaps from spinning forever.
MAX_SITEMAPS_PER_WALK = 25

# Per-sitemap fetch timeout (seconds). Short on purpose — the
# walker is one of many discovery probes and we want to fail fast
# on dead endpoints rather than block the per-roaster pipeline.
SITEMAP_FETCH_TIMEOUT = 8

# Polite UA. Some hosts serve a different sitemap to known bots.
DEFAULT_UA = "CremaCatalogOps/1.0 (+https://crema.coffee/catalog-ops)"


@dataclass(frozen=True)
class ProductUrlEntry:
    """One product URL surfaced by the sitemap walker."""
    url: str
    lastmod: Optional[str]      # ISO 8601 from <lastmod>, or None
    source_sitemap: str         # which sitemap leaf this URL came from


def _normalise_url(url: str) -> str:
    """Canonicalise a URL so dedupe across sitemap leaves works.

    Strip trailing slash, lowercase scheme + host, drop fragment.
    KEEP the query string — Shopify's paginated product sitemaps
    use the path `/sitemap_products_1.xml` with `?from=X&to=Y`
    range params, and the bare path (without query) returns HTTP
    400. Treating these as the same key caused our probe of the
    bare path to mark the canonical key seen → the linked-from-
    /sitemap.xml form (with query) was then deduped out and never
    fetched. So: query is part of identity.

    Keep the path's case (some platforms have case-sensitive
    product handles where the lowercased form 301s).
    """
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
    except Exception:
        return ""
    if not p.scheme or not p.netloc:
        return ""
    path = (p.path or "/").rstrip("/") or "/"
    netloc = p.netloc.lower()
    scheme = p.scheme.lower()
    query = f"?{p.query}" if p.query else ""
    return f"{scheme}://{netloc}{path}{query}"


def _looks_like_product_path(url: str, segments: Iterable[str]) -> bool:
    """True if the URL's path contains any of the product-URL
    segments. Case-insensitive on the segment match."""
    try:
        path = (urlparse(url).path or "").lower()
    except Exception:
        return False
    return any(seg in path for seg in segments)


def _fetch_sitemap_text(
    url: str, *, ua: str = DEFAULT_UA, timeout: float = SITEMAP_FETCH_TIMEOUT,
) -> Optional[str]:
    """GET the sitemap URL, return body text or None on any failure.

    Uses `requests` — the happy-eyeballs patch installed at API boot
    (and at scraper-subprocess boot via main.py's hook) is in scope.
    """
    try:
        import requests  # local import: keeps module importable in
                         # environments without requests, e.g. tests.
    except ImportError:
        return None
    try:
        r = requests.get(
            url,
            headers={"User-Agent": ua},
            timeout=timeout,
            allow_redirects=True,
        )
        if r.status_code != 200:
            return None
        # Some sitemaps come back with text/html when the host returns
        # a 404-as-200 SPA. Cheap sanity check on the body — must look
        # XML-ish (start with '<' after whitespace).
        text = r.text.lstrip()
        if not text.startswith("<"):
            return None
        return r.text
    except Exception:
        return None


def _parse_sitemap(text: str) -> tuple[List[str], List[tuple[str, Optional[str]]]]:
    """Parse a sitemap XML document.

    Returns:
        (child_sitemap_urls, leaf_entries)

    where each leaf_entry is `(url, lastmod_iso_or_None)`. The
    distinction matters: a sitemap-index has `<sitemap>` children
    (return them as child URLs to recurse into); a leaf sitemap
    has `<url>` children (return them as leaf entries with their
    `<lastmod>` when present).
    """
    if not text:
        return [], []

    # Strip namespace declarations to make element matching
    # straightforward — sitemaps universally use a single xmlns
    # so this loses nothing and dodges ElementTree's namespace
    # tax.
    try:
        # Fast path: just strip the default xmlns attribute.
        # ElementTree's find/iter then matches on bare local names.
        text_no_ns = text.replace(
            'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', ""
        )
        root = ET.fromstring(text_no_ns)
    except ET.ParseError:
        return [], []

    children: List[str] = []
    leaves: List[tuple[str, Optional[str]]] = []

    tag = (root.tag or "").lower().rsplit("}", 1)[-1]  # strip any remaining namespace
    if tag == "sitemapindex":
        # `<sitemap>` children with `<loc>`
        for sm in root:
            loc = None
            for child in sm:
                local = (child.tag or "").lower().rsplit("}", 1)[-1]
                if local == "loc" and child.text:
                    loc = child.text.strip()
                    break
            if loc:
                children.append(loc)
    elif tag == "urlset":
        # `<url>` children with `<loc>` and optional `<lastmod>`
        for u in root:
            loc = None
            lastmod = None
            for child in u:
                local = (child.tag or "").lower().rsplit("}", 1)[-1]
                if local == "loc" and child.text:
                    loc = child.text.strip()
                elif local == "lastmod" and child.text:
                    lastmod = child.text.strip()
            if loc:
                leaves.append((loc, lastmod))
    else:
        # Unexpected root — try a permissive recursive scan for `<loc>`
        # tags. Catches malformed sitemaps that still have the data.
        for elem in root.iter():
            local = (elem.tag or "").lower().rsplit("}", 1)[-1]
            if local == "loc" and elem.text:
                leaves.append((elem.text.strip(), None))

    return children, leaves


def _host_variants(website: str) -> List[str]:
    """Return the (host, www.host) variants to probe.

    We probe both because some hosts canonicalize one way and serve
    sitemaps only there.
    """
    try:
        p = urlparse(website)
    except Exception:
        return []
    if not p.netloc:
        return []
    host = p.netloc.lower()
    if host.startswith("www."):
        bare = host[len("www."):]
        return [f"https://{host}", f"https://{bare}"]
    return [f"https://{host}", f"https://www.{host}"]


def discover_product_urls(
    website: str,
    *,
    path_segments: Iterable[str] = DEFAULT_PRODUCT_PATH_SEGMENTS,
    sitemap_paths: Iterable[str] = DEFAULT_SITEMAP_PATHS,
    max_sitemaps: int = MAX_SITEMAPS_PER_WALK,
    ua: str = DEFAULT_UA,
    timeout: float = SITEMAP_FETCH_TIMEOUT,
    extra_seed_sitemaps: Optional[Iterable[str]] = None,
) -> List[ProductUrlEntry]:
    """Discover every product URL the host's sitemaps expose.

    Args:
        website: the roaster's homepage URL — host is extracted
            from this. Scheme + path on the input is ignored.
        path_segments: URL path substrings that mark a "this is a
            product page" — defaults cover Shopify, WooCommerce,
            Wix, Squarespace, custom storefronts.
        sitemap_paths: well-known sitemap entry points to probe.
            Defaults cover every platform we've seen.
        max_sitemaps: cap on number of distinct sitemap URLs the
            walker will follow in one call. Sitemap-index recursion
            counts against this.
        ua: User-Agent header. Some hosts gate sitemap responses on
            bot identity.
        timeout: per-sitemap fetch timeout (seconds).
        extra_seed_sitemaps: optional caller-supplied additional
            sitemap URLs to enqueue (e.g. an admin who knows their
            site uses a non-standard path).

    Returns:
        List of `ProductUrlEntry` deduplicated by canonical URL,
        in the order they were first surfaced.
    """
    bases = _host_variants(website)
    if not bases:
        return []

    queue: List[str] = []
    for base in bases:
        for path in sitemap_paths:
            queue.append(base + path)
    if extra_seed_sitemaps:
        queue.extend(extra_seed_sitemaps)

    seen_sitemaps: Set[str] = set()
    seen_urls: Set[str] = set()
    out: List[ProductUrlEntry] = []
    segments = tuple(path_segments)

    while queue and len(seen_sitemaps) < max_sitemaps:
        sm_url = queue.pop(0)
        canonical = _normalise_url(sm_url)
        if not canonical or canonical in seen_sitemaps:
            continue
        seen_sitemaps.add(canonical)

        text = _fetch_sitemap_text(sm_url, ua=ua, timeout=timeout)
        if text is None:
            continue

        children, leaves = _parse_sitemap(text)
        for child_url in children:
            if _normalise_url(child_url) not in seen_sitemaps:
                queue.append(child_url)
        for url, lastmod in leaves:
            if not _looks_like_product_path(url, segments):
                continue
            canonical_url = _normalise_url(url)
            if not canonical_url or canonical_url in seen_urls:
                continue
            seen_urls.add(canonical_url)
            out.append(ProductUrlEntry(
                url=url,
                lastmod=lastmod,
                source_sitemap=sm_url,
            ))

    return out


def summarize_discovery(entries: List[ProductUrlEntry]) -> dict:
    """Diagnostic helper — produce a per-sitemap breakdown of
    where the discovered URLs came from. Useful when debugging
    a roaster whose count looks off.
    """
    by_sitemap: dict[str, int] = {}
    for e in entries:
        by_sitemap[e.source_sitemap] = by_sitemap.get(e.source_sitemap, 0) + 1
    return {
        "total_urls": len(entries),
        "sitemaps_with_hits": len(by_sitemap),
        "by_sitemap": by_sitemap,
    }
