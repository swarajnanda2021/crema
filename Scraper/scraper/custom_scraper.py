"""
HTML-parsing fallback scraper for custom/unknown platform sites.

Strategy (in order):
  1. Fetch shop_url, look for product cards via CSS selectors
  2. Look for any links whose URL path contains product-like segments
  3. Try /sitemap.xml to discover product URLs
  4. If the page looks like a JS-rendered SPA, flag it and abort

For each candidate product page, extract name, price, weight, image, description.
"""

import json
import re
import time
import requests
from typing import Optional
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
from utils import extract_domain

# Wix catalog pages are JS-rendered SPAs — the static HTML from
# `requests.get` is a hydration shell with no product cards. Route the
# catalog index through Playwright via wix_fetcher when Wix markers
# are detected. Lazy import so the module loads on hosts without
# Playwright installed.
try:
    from wix_fetcher import fetch_wix_html
    _WIX_FETCHER_AVAILABLE = True
except ImportError:
    _WIX_FETCHER_AVAILABLE = False

# Substrings that identify a page as Wix-rendered (any one match
# triggers the Playwright re-fetch). Conservative — we want zero
# false positives because Playwright is slow.
_WIX_MARKERS = (
    "wixstatic.com",
    "static.parastorage.com",
    "viewerModel",
    "_wixCIDX",
    "data-thunderbolt",
    "wix-viewer",
)

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (product catalog; contact@example.com)"
}
TIMEOUT = 20
MAX_SITE_SECONDS = 30
MAX_PRODUCTS = 100


# ── Selectors ─────────────────────────────────────────────────────────────────

_PRODUCT_CARD_SELECTORS = [
    # Generic e-commerce
    ".product-card", ".product-item", ".product_item",
    ".product-grid-item", ".grid-product", ".grid__item",
    # WooCommerce
    ".woocommerce-LoopProduct", ".type-product", "li.product",
    # Shopify-style (some custom themes)
    ".product-block", ".product-thumbnail",
    # Wix
    "[data-hook='product-list-grid-item']",
    "[data-hook='product-item']",
    # Generic wildcard
    "[class*='product-card']", "[class*='product-item']",
    "[class*='product_card']", "[class*='product_item']",
]

_TITLE_SELECTORS = [
    "h1.product-title", "h1.product_title", "h1.product__title",
    ".product-title h1", ".product__title",
    "h1", ".product-name", ".product__name",
    "[data-hook='product-title']",
]

_DESC_SELECTORS = [
    ".product-description", ".product__description",
    ".woocommerce-product-details__short-description",
    ".woocommerce-Tabs-panel--description",
    "[data-hook='description']",
    "[class*='description']", ".product-detail",
    ".product-info", ".product__info",
]

_IMAGE_SELECTORS = [
    ".product-image img", ".product__media img",
    ".woocommerce-product-gallery img",
    ".product-featured-image img",
    "[data-hook='product-page-media-frame'] img",
    "img.product-image", "img[class*='product']",
    ".product-photo img",
]

_PRICE_PATTERNS = [
    r"₹\s*([\d,]+(?:\.\d+)?)",
    r"Rs\.?\s*([\d,]+(?:\.\d+)?)",
    r"INR\s*([\d,]+(?:\.\d+)?)",
]

# Weight matcher — finds "250g", "1 kg", "100 grams" etc. in free text.
# Mirrors the parser in scraper/utils.py:normalize_weight; same patterns
# kept in one place so the regex stays consistent. Used by the custom
# (Wix / unknown-platform) scraper since those paths don't expose a
# Shopify-style variant.grams field.
_WEIGHT_PATTERN = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:kgs?|kilograms?|kilos?|grams?|gms?|g)\b",
    re.IGNORECASE,
)

# Keywords in a URL path that suggest a product page
_PRODUCT_URL_SEGMENTS = [
    "/product/", "/products/", "/product-page/", "/coffee/",
    "/shop/", "/buy/", "/store/", "/item/",
]

# Keywords in link text that suggest a coffee product link
_COFFEE_LINK_KEYWORDS = [
    "coffee", "roast", "blend", "estate", "arabica", "robusta",
    "espresso", "filter", "pour-over", "natural", "washed",
    "honey", "anaerobic", "monsoon", "malabar", "peaberry",
]

# Indicators that the page is a JS-rendered SPA (no useful static HTML)
_SPA_MARKERS = [
    '<div id="root"', '<div id="app"', '<div id="__next"',
    '__NEXT_DATA__', 'window.__NUXT__', 'ng-version=',
    'data-reactroot', 'data-vue-app',
]


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _fetch(url: str) -> Optional[requests.Response]:
    """Fetch URL, return Response or None on error/Cloudflare."""
    try:
        r = requests.get(
            url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True
        )
        if "cf-ray" in r.headers and "checking your browser" in r.text.lower():
            raise RuntimeError("cloudflare_blocked")
        if r.status_code == 200:
            return r
    except RuntimeError:
        raise
    except Exception:
        pass
    return None


def _fetch_html(url: str) -> Optional[str]:
    r = _fetch(url)
    return r.text if r else None


def _is_spa(html: str) -> bool:
    """Return True if the page appears to be a JS-only SPA."""
    for marker in _SPA_MARKERS:
        if marker in html:
            return True
    return False


def _is_wix(html: str) -> bool:
    """Return True if the page is Wix-rendered. Catches the SPA shell
    case (plain requests.get returns hydration HTML with no products)
    AND the rendered case (Playwright output still has Wix markers in
    inline scripts) — important so we can distinguish 'already
    rendered' from 'needs rendering'."""
    if not html:
        return False
    return any(m in html for m in _WIX_MARKERS)


def _extract_price(text: str) -> Optional[float]:
    for pattern in _PRICE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return None


def _extract_weight_text(*texts: str) -> Optional[str]:
    """Find a weight-like substring in any of the provided text bodies.

    Returns the matched substring (e.g. "250g", "1kg", "100 grams") which
    the normalizer's `normalize_weight()` parses to integer grams. We
    return the raw match rather than the parsed integer so the
    normalizer remains the single owner of the gram-conversion logic.
    None when no weight-shaped substring is found.
    """
    for text in texts:
        if not text:
            continue
        m = _WEIGHT_PATTERN.search(text)
        if m:
            return m.group(0)
    return None


def _ld_weight_to_raw(ld: dict, offers) -> Optional[str]:
    """Pull a weight string out of a JSON-LD Product (or its Offers).

    schema.org's Product can expose `weight` directly OR nest it in
    `offers.weight` as a QuantitativeValue ({value, unitCode|unitText}).
    Wix sometimes uses plain numerics or string blobs. Returns a string
    the normalizer can parse, or None.
    """
    candidates = [ld.get("weight")]
    if isinstance(offers, dict):
        candidates.append(offers.get("weight"))
    for c in candidates:
        if c is None:
            continue
        if isinstance(c, dict):
            val = c.get("value")
            unit = c.get("unitCode") or c.get("unitText") or "g"
            if val is not None:
                return f"{val} {unit}".strip()
        elif isinstance(c, (int, float)):
            # Bare number — assume grams (schema.org's KGM unitCode is
            # what we'd expect but Wix often skips it; bare integers
            # carry their natural unit from the page surrounding text).
            return f"{c} g"
        elif isinstance(c, str) and c.strip():
            return c.strip()
    return None


# ── Product link discovery ────────────────────────────────────────────────────

def _links_from_cards(soup: BeautifulSoup, base_url: str, domain: str) -> set:
    """Look for product card containers and extract their anchor hrefs."""
    links = set()
    for selector in _PRODUCT_CARD_SELECTORS:
        cards = soup.select(selector)
        if not cards:
            continue
        for card in cards:
            a = card.find("a", href=True)
            if a:
                href = urljoin(base_url, a["href"])
                if domain in href:
                    links.add(href)
        if links:
            return links
    return links


def _links_from_url_segments(soup: BeautifulSoup, base_url: str, domain: str) -> set:
    """Find links whose URL path contains known product-page segments."""
    links = set()
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"])
        if domain not in href:
            continue
        path = urlparse(href).path.lower()
        if any(seg in path for seg in _PRODUCT_URL_SEGMENTS):
            links.add(href)
    return links


def _links_from_text(soup: BeautifulSoup, base_url: str, domain: str) -> set:
    """Find links whose visible text matches coffee keywords."""
    links = set()
    for a in soup.find_all("a", href=True):
        text = a.get_text().lower()
        href = urljoin(base_url, a["href"])
        if domain in href and any(kw in text for kw in _COFFEE_LINK_KEYWORDS):
            links.add(href)
    return links


def _links_from_sitemap(domain: str) -> set:
    """Discover product URLs from the host's sitemaps.

    Delegates to the canonical
    `services.sitemap_walker.discover_product_urls`. Returns a set
    of URL strings to preserve the legacy call-site interface
    (which dedupes by raw string and doesn't need lastmod /
    source-sitemap metadata).
    """
    try:
        from services.sitemap_walker import discover_product_urls  # type: ignore
    except ImportError:
        return set()
    # The canonical walker accepts a website URL (scheme + host); we
    # pass an https:// constructor with the bare domain — the walker
    # itself probes both bare-host and www-host variants.
    entries = discover_product_urls(f"https://{domain}")
    return {e.url for e in entries}


def _find_product_links(
    soup: BeautifulSoup, shop_url: str, domain: str
) -> set:
    """
    Try each discovery strategy in order, returning the first non-empty set.
    """
    links = _links_from_cards(soup, shop_url, domain)
    if links:
        return links

    links = _links_from_url_segments(soup, shop_url, domain)
    if links:
        return links

    links = _links_from_text(soup, shop_url, domain)
    if links:
        return links

    # Last resort: sitemap
    links = _links_from_sitemap(domain)
    return links


# ── Per-product page scraper ──────────────────────────────────────────────────

def _extract_jsonld_product(soup: BeautifulSoup):
    """Pull the first JSON-LD Product / ProductGroup schema from
    the page. Delegates to the canonical
    `services.jsonld_extractor.extract_product` — returns a
    `CanonicalProduct` (dataclass) so callers can access typed
    fields (.name, .price, .image_url, .additional_properties, …)
    instead of dict.get-ing into a raw schema-org payload.

    Returns None when no Product-family schema is present. Caller
    falls back to CSS-selector / body-text extraction.
    """
    try:
        from services.jsonld_extractor import (  # type: ignore
            extract_jsonld_blocks, extract_product,
        )
    except ImportError:
        return None
    blocks = extract_jsonld_blocks(soup)
    return extract_product(blocks)


def _product_from_jsonld(
    canonical, url: str, roaster: dict, domain: str,
) -> Optional[dict]:
    """Convert a CanonicalProduct (from the canonical JSON-LD
    extractor) into the raw-product dict shape the rest of the
    pipeline expects. Falls back to body-text weight extraction
    when JSON-LD doesn't carry a weight field.

    Accepts either the legacy raw dict shape OR a CanonicalProduct
    dataclass — the second is what `_extract_jsonld_product` now
    returns. Keeping the dual shape lets call-sites change one at
    a time during the refactor.
    """
    # CanonicalProduct dataclass path (new)
    if hasattr(canonical, "name"):
        name = (canonical.name or "").strip()
        if not name:
            return None
        desc = canonical.description or ""
        price = canonical.price
        image_url = canonical.image_url
        weight_raw = canonical.weight_raw
        # Weight fallback — JSON-LD often omits weight; description
        # copy almost always mentions it ("250g bag").
        if not weight_raw:
            weight_raw = _extract_weight_text(name, desc)
        return {
            "_roaster": roaster,
            "_domain": domain,
            "_platform": "custom",
            "_product_url": url,
            "title": name,
            "body_html": desc,
            "price_raw": price,
            "weight_raw": weight_raw,
            "image_raw": image_url,
            "tags": [],
            "product_type": "",
            "variants": [],
        }
    # Legacy raw-dict path — kept for backward compat with any
    # caller still passing schema.org dicts directly.
    ld = canonical
    name = (ld.get("name") or "").strip()
    if not name:
        return None
    desc = (ld.get("description") or "").strip()
    offers = ld.get("offers") or ld.get("Offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    price = None
    raw_price = offers.get("price") if isinstance(offers, dict) else None
    if raw_price is not None:
        try:
            price = float(str(raw_price).replace(",", ""))
        except (ValueError, TypeError):
            pass
    image_url = None
    images = ld.get("image")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, dict):
            image_url = first.get("contentUrl") or first.get("url")
        elif isinstance(first, str):
            image_url = first
    elif isinstance(images, dict):
        image_url = images.get("contentUrl") or images.get("url")
    elif isinstance(images, str):
        image_url = images
    weight_raw = _ld_weight_to_raw(ld, offers)
    if not weight_raw:
        weight_raw = _extract_weight_text(name, desc)
    return {
        "_roaster": roaster,
        "_domain": domain,
        "_platform": "custom",
        "_product_url": url,
        "title": name,
        "body_html": desc,
        "price_raw": price,
        "weight_raw": weight_raw,
        "image_raw": image_url,
        "tags": [],
        "product_type": "",
        "variants": [],
    }


def _scrape_product_page(url: str, roaster: dict, domain: str) -> Optional[dict]:
    html = _fetch_html(url)
    if not html:
        return None

    soup = BeautifulSoup(html, "lxml")

    # JSON-LD path — preferred when the page emits a Product schema.
    # Bypasses the CSS-selector heuristics that fail on JS-rendered
    # pages (Wix, Squarespace, bespoke React/Vue themes) where the
    # static HTML has no hydrated product cards.
    ld = _extract_jsonld_product(soup)
    if ld:
        product = _product_from_jsonld(ld, url, roaster, domain)
        if product:
            return product

    # Title
    name = None
    for selector in _TITLE_SELECTORS:
        el = soup.select_one(selector)
        if el:
            name = el.get_text(strip=True)
            if name:
                break
    if not name:
        return None

    # Price
    price = _extract_price(soup.get_text())

    # Description
    desc_text = ""
    for selector in _DESC_SELECTORS:
        el = soup.select_one(selector)
        if el:
            desc_text = el.get_text(separator=" ", strip=True)
            if desc_text:
                break

    # Image
    image_url = None
    for selector in _IMAGE_SELECTORS:
        img = soup.select_one(selector)
        if img:
            src = (
                img.get("src")
                or img.get("data-src")
                or img.get("data-lazy-src")
            )
            if src:
                image_url = urljoin(url, src)
                break

    # Weight — scan title + description + whole-body text for any
    # "<n>g" / "<n> grams" / "<n>kg" substring. The whole-body fallback
    # catches sites that put weight in a sidebar widget instead of the
    # main description block (Wix detail tables, e-comm theme specs).
    weight_raw = _extract_weight_text(
        name, desc_text, soup.get_text(separator=" ", strip=True),
    )

    return {
        "_roaster": roaster,
        "_domain": domain,
        "_platform": "custom",
        "_product_url": url,
        "title": name,
        "body_html": desc_text,
        "price_raw": price,
        "weight_raw": weight_raw,
        "image_raw": image_url,
        "tags": [],
        "product_type": "",
        "variants": [],
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def scrape_custom(roaster: dict) -> list:
    """
    Scrape a custom-platform site via HTML parsing.
    Returns a list of raw product dicts (or empty list on failure).

    Wix routing: when the cheap `requests.get` returns a Wix hydration
    shell (no products), re-fetch via Playwright headless Chromium so
    the product-list widget mounts before we parse. The diff sweep on
    2026-05-21 showed 8/8 Wix roasters returning 0 products via the
    plain-HTML path — the SPA-abort branch killed coverage. With the
    re-fetch we can actually discover the product cards.
    """
    start = time.time()
    shop_url = roaster.get("shop_url") or roaster["website"]
    domain = extract_domain(roaster["website"])

    html = _fetch_html(shop_url)
    if not html:
        return []

    # Wix re-render path: if the cheap fetch returned a Wix shell,
    # promote to Playwright so the product widget renders. Skip the
    # SPA-abort below — we just paid to render, the result IS the
    # rendered DOM. We allow the downstream selectors to do their work.
    rendered_via_playwright = False
    if _is_wix(html) and _WIX_FETCHER_AVAILABLE:
        rendered = fetch_wix_html(shop_url)
        if rendered:
            html = rendered
            rendered_via_playwright = True

    # SPA abort only fires when we did NOT render via Playwright.
    # Rendered Wix pages keep their SPA markers in inline scripts
    # (data-reactroot etc.) — we shouldn't trip on those.
    if not rendered_via_playwright and _is_spa(html):
        raise RuntimeError("requires_js_rendering")

    soup = BeautifulSoup(html, "lxml")
    product_links = _find_product_links(soup, shop_url, domain)

    if not product_links:
        return []

    products = []
    for link in list(product_links)[:MAX_PRODUCTS]:
        if time.time() - start > MAX_SITE_SECONDS:
            break

        # Don't re-scrape the shop index page
        if link.rstrip("/") == shop_url.rstrip("/"):
            continue

        product = _scrape_product_page(link, roaster, domain)
        if product:
            products.append(product)

        time.sleep(1)

    return products
