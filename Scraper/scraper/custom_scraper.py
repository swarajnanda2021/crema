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


def _extract_price(text: str) -> Optional[float]:
    for pattern in _PRICE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                pass
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
    """Try sitemap.xml to find product URLs.

    Many sites (Wix, large WooCommerce installs, sites with multiple
    business lines) emit a *sitemap index* at `/sitemap.xml` whose
    `<loc>` entries point to child sitemaps, not products. We follow
    each child once. Also probes well-known per-platform paths:
    `/store-products-sitemap.xml` is the Wix Stores convention.

    A safety cap (20 sitemaps total) prevents runaway recursion on
    pathological cases.
    """
    links: set = set()
    seen: set = set()
    queue = [
        f"https://{domain}/sitemap.xml",
        f"https://www.{domain}/sitemap.xml",
        f"https://{domain}/store-products-sitemap.xml",
        f"https://www.{domain}/store-products-sitemap.xml",
    ]

    while queue and len(seen) < 20:
        sitemap_url = queue.pop(0)
        if sitemap_url in seen:
            continue
        seen.add(sitemap_url)

        html = _fetch_html(sitemap_url)
        if not html:
            continue
        soup = BeautifulSoup(html, "lxml")

        # Sitemap *index*: enqueue child sitemaps; nothing to extract here.
        if soup.find("sitemap"):
            for child in soup.find_all("sitemap"):
                loc = child.find("loc")
                if loc:
                    child_url = loc.get_text(strip=True)
                    if child_url and child_url not in seen:
                        queue.append(child_url)
            continue

        # Leaf sitemap: extract product URLs by path-segment match.
        for loc in soup.find_all("loc"):
            url = loc.get_text(strip=True)
            if domain not in url:
                continue
            path = urlparse(url).path.lower()
            if any(seg in path for seg in _PRODUCT_URL_SEGMENTS):
                links.add(url)

    return links


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

def _extract_jsonld_product(soup: BeautifulSoup) -> Optional[dict]:
    """If the page emits a JSON-LD `Product` schema, return that dict.

    Wix (and many other JS-rendered platforms) emit complete Product
    schemas in `<script type="application/ld+json">` for SEO, even
    when the visible HTML is a hydration shell. The schema may live
    at the top level, inside an array, or wrapped in `@graph`.
    """
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            payload = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        if isinstance(payload, dict) and isinstance(payload.get("@graph"), list):
            candidates = payload["@graph"]
        for c in candidates:
            if isinstance(c, dict) and str(c.get("@type", "")).lower() == "product":
                return c
    return None


def _product_from_jsonld(
    ld: dict, url: str, roaster: dict, domain: str,
) -> Optional[dict]:
    """Convert a JSON-LD Product object into the dict shape the rest
    of the pipeline expects. Tolerates Wix's non-standard `Offers`
    capitalization alongside the schema.org-canonical `offers`."""
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

    return {
        "_roaster": roaster,
        "_domain": domain,
        "_platform": "custom",
        "_product_url": url,
        "title": name,
        "body_html": desc,
        "price_raw": price,
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

    return {
        "_roaster": roaster,
        "_domain": domain,
        "_platform": "custom",
        "_product_url": url,
        "title": name,
        "body_html": desc_text,
        "price_raw": price,
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
    """
    start = time.time()
    shop_url = roaster.get("shop_url") or roaster["website"]
    domain = extract_domain(roaster["website"])

    html = _fetch_html(shop_url)
    if not html:
        return []

    # Detect JS-only SPA early — no point parsing further
    if _is_spa(html):
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
