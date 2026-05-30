"""
Generic-first product discovery pipeline.

This is the entry point the per-roaster scraper subprocess should
call to turn a roaster's website into a list of discovered product
URLs + the data needed to enrich them.

## The architecture this replaces

Before: discovery was per-platform with no cross-fallback.

  if platform == "shopify":
      raw = scrape_shopify(roaster)         # /products.json only
  elif platform == "woocommerce":
      raw = scrape_woocommerce(roaster)     # /wp-json/wc only
  else:
      raw = scrape_custom(roaster)          # generic walker

Each was a "discover + fetch + parse" monolith. They never fell
through to each other. When Shopify's /products.json returned 5
(because the admin pinned shop_url to a narrow collection), the
scrape returned 5 — even though the generic walker would have
found 19 from the sitemap. This is the architectural shape of
the Drum / Reserved / 44-other-roasters bug.

## What this module does

`discover(roaster) -> DiscoveryResult`

  1. **Sitemap discovery** (generic, sitemap_walker.py)
     Walks every well-known sitemap entry point for the host,
     follows sitemap-index recursively, returns ALL product URLs.
     Platform-independent. This is the primary discovery surface.

  2. **Platform augmentation** (optional, additive)
     If the platform exposes a richer canonical API for variant /
     price / SKU data (Shopify /products.json, WooCommerce
     /wp-json/wc), call it AS AN AUGMENTER — merge by URL into
     the sitemap-discovered set. Adds metadata that JSON-LD
     doesn't carry on every page (especially variant pricing).

  3. **Shop_url as filter, not scope**
     If the admin pinned `shop_url = /collections/specialty-selection`,
     treat it as a HINT to prefer products in that collection but
     don't EXCLUDE other discovered ones. The narrow shop_url stops
     being a silent loss.

  4. **Per-URL enrichment data** (downstream)
     Each discovered product URL flows into the existing Tier 2-4
     extraction ladder (JSON-LD → body text → Playwright). This
     module doesn't replace per-page extraction — only discovery.

## What this module does NOT do

  - It does NOT replace per-product LLM enrichment. The Haiku
    pass that produces canonical fields (origin, varietal, etc.)
    runs unchanged.
  - It does NOT replace the Tier 2-4 per-page extraction. The
    `Scraper/enrich.py:_fetch_product_page_text` ladder runs
    unchanged.
  - It does NOT touch normalization (the next refactor step).

## Output shape

`DiscoveryResult`:
  - `urls`: List[DiscoveredProduct] — every product URL we found,
    with whatever metadata the discovery surface provided.
  - `source_breakdown`: dict — diagnostic counts per discovery
    source (sitemap, shopify_api, woocommerce_api).
  - `dropped_off_scope`: int — count of URLs that didn't match
    the configured shop_url filter (when one was set with strict
    mode).

`DiscoveredProduct`:
  - `url`: canonical product page URL.
  - `source`: where we found it ("sitemap" | "shopify_api" |
    "woocommerce_api").
  - `augmented`: optional dict of platform-specific data
    (variants, SKU, pricing) for the normalizer to merge.
  - `lastmod`: optional ISO string from sitemap (when present).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence
from urllib.parse import urlparse


# Late-bound to avoid hard import dependencies at module load.
# Both modules live alongside this one.
from services.sitemap_walker import (
    discover_product_urls as _walk_sitemaps,
    ProductUrlEntry,
)


# Platform-augmenter modules — soft-loaded so this module is
# usable in environments that don't have the legacy scrapers in
# scope (e.g. unit tests).
_AUGMENTERS = {
    # Filled lazily in _get_augmenter. Each entry returns a dict
    # keyed by canonical URL → augmenting data.
    "shopify": None,
    "woocommerce": None,
}


@dataclass
class DiscoveredProduct:
    """One product URL surfaced by the discovery pipeline."""
    url: str
    source: str                      # "sitemap" | "shopify_api" | "woocommerce_api"
    augmented: dict = field(default_factory=dict)
    lastmod: Optional[str] = None


@dataclass
class DiscoveryResult:
    """The full output of one discovery pass for one roaster."""
    urls: List[DiscoveredProduct] = field(default_factory=list)
    source_breakdown: dict = field(default_factory=dict)
    dropped_off_scope: int = 0
    # When the configured shop_url filtered out everything, surface
    # the diagnostic so the caller can decide (warn, ignore, fall
    # back to all). True = "we had data but the filter killed it."
    filter_collapsed: bool = False


def discover(
    roaster: dict,
    *,
    strict_shop_url_filter: bool = False,
    enable_platform_augmenter: bool = True,
    log: Optional[callable] = None,
) -> DiscoveryResult:
    """Generic-first discovery for one roaster.

    Args:
        roaster: dict with at minimum `website`. Optional keys:
            `shop_url` (used as a soft filter), `platform`
            ("shopify" / "woocommerce" / etc — used to pick an
            augmenter, NOT to gate discovery).
        strict_shop_url_filter: when True, products NOT matching
            the configured shop_url path are dropped. When False
            (default), shop_url is informational — every discovered
            product is kept, the filter only affects logging.
        enable_platform_augmenter: when True (default), call the
            platform's canonical API (Shopify /products.json,
            WC REST) to add variant/price data to the sitemap
            results. Disable to test pure sitemap discovery.
        log: optional callable(str) for progress lines (admin log
            tail).

    Returns:
        DiscoveryResult with urls + source_breakdown + filter info.
    """
    website = roaster.get("website") or ""
    if not website:
        return DiscoveryResult()

    platform = (roaster.get("platform") or "").lower().strip() or None
    shop_url = roaster.get("shop_url")
    _log = log or (lambda _: None)

    # ── 1. Sitemap discovery (the primary, generic path)
    sitemap_entries: List[ProductUrlEntry] = _walk_sitemaps(website)
    _log(f"sitemap discovery: {len(sitemap_entries)} product URLs")

    by_url: dict[str, DiscoveredProduct] = {}
    for e in sitemap_entries:
        canonical = _canonical_url(e.url)
        if canonical in by_url:
            continue
        by_url[canonical] = DiscoveredProduct(
            url=e.url,
            source="sitemap",
            lastmod=e.lastmod,
        )

    # ── 2. Platform augmentation (optional, additive)
    if enable_platform_augmenter and platform:
        augmenter = _get_augmenter(platform)
        if augmenter:
            try:
                augmented_data, augmenter_urls = augmenter(roaster)
                _log(
                    f"{platform} augmenter: {len(augmenter_urls)} URLs, "
                    f"{len(augmented_data)} carry variant/price data"
                )
                # MERGE: add any URLs the augmenter found that sitemap
                # missed (e.g. unpublished-to-sitemap but
                # API-discoverable products), AND attach augmenter
                # data to existing entries.
                for url in augmenter_urls:
                    canonical = _canonical_url(url)
                    if canonical in by_url:
                        # Augment existing sitemap entry.
                        data = augmented_data.get(canonical)
                        if data:
                            by_url[canonical].augmented = data
                    else:
                        # API knows about this URL but sitemap didn't.
                        # Probably a hidden/unpublished product;
                        # admin may still want it. Add it.
                        by_url[canonical] = DiscoveredProduct(
                            url=url,
                            source=f"{platform}_api",
                            augmented=augmented_data.get(canonical, {}),
                        )
            except Exception as exc:
                _log(f"{platform} augmenter failed: {exc!s}")

    # ── 3. Apply shop_url filter
    discovered = list(by_url.values())
    dropped = 0
    filter_collapsed = False
    if shop_url:
        scope_segment = _shop_url_scope_segment(shop_url)
        if scope_segment:
            kept = []
            for p in discovered:
                if _url_matches_scope(p.url, scope_segment):
                    kept.append(p)
                elif strict_shop_url_filter:
                    dropped += 1
                # else: keep the off-scope URL (soft mode); count
                # as off-scope for diagnostics only.
            if strict_shop_url_filter:
                if discovered and not kept:
                    # Configured shop_url filter killed everything.
                    # Surface so the caller can decide.
                    filter_collapsed = True
                    _log(
                        f"WARN: shop_url filter '{scope_segment}' "
                        f"collapsed discovery (would drop {len(discovered)} URLs); "
                        f"keeping all in soft mode"
                    )
                    # Soft-mode fallback: keep all discovered when
                    # strict filter would zero us out.
                else:
                    discovered = kept

    # ── 4. Build source breakdown for diagnostics
    source_breakdown: dict[str, int] = {}
    for p in discovered:
        source_breakdown[p.source] = source_breakdown.get(p.source, 0) + 1

    return DiscoveryResult(
        urls=discovered,
        source_breakdown=source_breakdown,
        dropped_off_scope=dropped,
        filter_collapsed=filter_collapsed,
    )


# ── helpers ─────────────────────────────────────────────────────────


def _canonical_url(url: str) -> str:
    """Lowercase host + strip trailing slash. Used for cross-source
    dedupe of the same product URL discovered via multiple paths."""
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
    except Exception:
        return ""
    if not p.scheme or not p.netloc:
        return ""
    path = (p.path or "/").rstrip("/") or "/"
    return f"{p.scheme.lower()}://{p.netloc.lower()}{path}"


def _shop_url_scope_segment(shop_url: str) -> Optional[str]:
    """Extract the scope-defining path segment from a shop_url.

    Examples:
      /collections/specialty-selection  → "specialty-selection"
      /collections/all                  → None (no filter)
      /shop                             → None (too broad)
      /category/coffee                  → "coffee"

    Returns None when the shop_url is too broad to act as a filter
    OR is a known wildcard like /collections/all.
    """
    if not shop_url:
        return None
    try:
        path = urlparse(shop_url).path or ""
    except Exception:
        return None
    parts = [p for p in path.split("/") if p]
    if not parts:
        return None
    # /collections/X — the X is the scope
    if parts[0] == "collections" and len(parts) >= 2:
        if parts[1].lower() in ("all", "all-products", "all-coffee"):
            return None
        return parts[1].lower()
    # /category/X — Wix Stores convention
    if parts[0] == "category" and len(parts) >= 2:
        return parts[1].lower()
    # /product-category/X — WooCommerce convention
    if parts[0] == "product-category" and len(parts) >= 2:
        return parts[1].lower()
    # Anything else is too broad to use as a meaningful filter.
    return None


def _url_matches_scope(url: str, scope_segment: str) -> bool:
    """True if the product URL is "in scope" per the shop_url hint.

    Heuristic: the scope segment (the collection / category slug)
    appears anywhere in the URL path. Not perfect — Shopify product
    URLs don't carry the collection name — so the safe default
    elsewhere is `strict_shop_url_filter=False` (soft filter, never
    drops). When the caller wants strict mode AND the URL doesn't
    carry collection metadata, the filter just won't match anything
    and we fall back to soft mode in `discover()`.
    """
    try:
        path = (urlparse(url).path or "").lower()
    except Exception:
        return False
    return scope_segment in path


def _get_augmenter(platform: str):
    """Lazy-load and cache the platform augmenter.

    Returns a callable `augmenter(roaster) -> (data_by_url, urls)`
    or None if the platform has no augmenter / the import fails.
    """
    cached = _AUGMENTERS.get(platform)
    if cached is not None:
        return cached if cached != "missing" else None

    augmenter = None
    if platform == "shopify":
        augmenter = _shopify_augmenter
    elif platform == "woocommerce":
        augmenter = _woocommerce_augmenter

    _AUGMENTERS[platform] = augmenter or "missing"
    return augmenter


def _shopify_augmenter(roaster: dict) -> tuple[dict, List[str]]:
    """Pull variants/pricing/SKU data from Shopify /products.json.

    This is the "augmenter" form of the prior `scrape_shopify`
    function — it returns canonical-URL-keyed metadata, not raw
    discovery results. Discovery already came from the sitemap.

    Honors the admin's `shop_url` collection scope when present —
    if the admin pinned /collections/coffee, the API call is
    scoped to that collection (cheaper + matches what the admin
    explicitly chose).
    """
    import requests
    import re
    import time

    website = roaster["website"]
    domain = urlparse(website).netloc.replace("www.", "")
    shop_url = roaster.get("shop_url") or ""

    # Detect collection-scoped shop_url, build the right base path.
    _coll_re = re.compile(
        r"^/collections/([a-z0-9][a-z0-9-]*)/?(?:products(?:\.json)?)?/?$",
        re.IGNORECASE,
    )
    coll_match = _coll_re.match(urlparse(shop_url).path or "")
    if coll_match:
        base_path = f"/collections/{coll_match.group(1).lower()}/products.json"
    else:
        # Site-wide /products.json — covers everything but may
        # include merch the Stage 1 filter / Haiku gate will drop.
        base_path = "/products.json"

    all_products = []
    page = 1
    while True:
        url = f"https://{domain}{base_path}?limit=250&page={page}"
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "CremaCatalogOps/1.0"},
                timeout=10,
            )
            if not r.ok:
                break
            data = r.json()
        except Exception:
            break
        products = data.get("products", [])
        if not products:
            break
        all_products.extend(products)
        if len(products) < 250:
            break
        page += 1
        time.sleep(0.5)

    # Build the URL → data map
    data_by_url: dict[str, dict] = {}
    urls: List[str] = []
    for p in all_products:
        handle = p.get("handle")
        if not handle:
            continue
        product_url = f"https://{domain}/products/{handle}"
        canonical = _canonical_url(product_url)
        data_by_url[canonical] = {
            "shopify_raw": p,
            "_roaster": roaster,
            "_domain": domain,
            "_platform": "shopify",
        }
        urls.append(product_url)
    return data_by_url, urls


def _woocommerce_augmenter(roaster: dict) -> tuple[dict, List[str]]:
    """Pull product data from WooCommerce REST.

    Same shape as `_shopify_augmenter` — returns canonical-URL-keyed
    metadata + URL list. Falls back to empty result on auth failure
    (some WC stores require API keys for /wp-json/wc/store).
    """
    import requests

    website = roaster["website"]
    domain = urlparse(website).netloc.replace("www.", "")

    data_by_url: dict[str, dict] = {}
    urls: List[str] = []

    # WooCommerce Store API base path. Modern WooCommerce serves the
    # VERSIONED endpoint; the unversioned form was dropped in newer
    # releases and 404s — e.g. Curious Life returned 0 products on the
    # unversioned path, silently zeroing discovery for the ENTIRE
    # roaster (the sitemap was bot-blocked, so the augmenter was the
    # only surface). Probe versioned first, fall back to unversioned
    # for older stores, so neither generation regresses. Kept in sync
    # with `_fetch_platform_raw_by_url`, which already uses /v1/.
    _store_api_paths = (
        "/wp-json/wc/store/v1/products",
        "/wp-json/wc/store/products",
    )

    def _fetch_page(base_path: str, page: int):
        url = f"https://{domain}{base_path}?per_page=100&page={page}"
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "CremaCatalogOps/1.0"},
                timeout=10,
            )
            if not r.ok:
                return None
            payload = r.json()
        except Exception:
            return None
        return payload if isinstance(payload, list) else None

    # Pick the first base path that actually yields products.
    base_path = None
    payload = None
    for _cand in _store_api_paths:
        payload = _fetch_page(_cand, 1)
        if payload:
            base_path = _cand
            break
    if not base_path:
        return data_by_url, urls

    page = 1
    while True:
        for p in payload:
            permalink = p.get("permalink")
            if not permalink:
                continue
            canonical = _canonical_url(permalink)
            data_by_url[canonical] = {
                "woocommerce_raw": p,
                "_roaster": roaster,
                "_domain": domain,
                "_platform": "woocommerce",
            }
            urls.append(permalink)
        if len(payload) < 100:
            break
        page += 1
        payload = _fetch_page(base_path, page)
        if not payload:
            break
    return data_by_url, urls
