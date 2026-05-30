"""Generic URL → (page_text, hints) for the v2 enrichment pipeline.

ONE fetcher both kinds use. Dispatches:

  • kind='article' → wraps `article_scraper.extract_for_enrichment`
    which already does bs4 strip + og: hints + body-image fallback +
    inline-video/link detection.
  • kind='product' → bs4 strip + JSON-LD prepend + og: title hint.
    Wix products route through the existing Playwright-backed
    `wix_fetcher` (lazy import — costs nothing on non-Wix sites).

Returns (page_text: str, hints: dict). The hints dict is
kind-specific and matches what `entity_enricher.enrich_url` expects.
Empty page_text + empty hints means the fetch failed.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_SCRAPER_DIR = _PROJECT_ROOT / "Scraper"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
# Bot UAs ("CremaCatalog", "compatible; ...; +https://") get 403'd by
# some Shopify-on-Cloudflare storefronts (Drum, Black Soul) that gate
# product pages behind a JS challenge. A browser-like UA + minimal
# Accept headers clears those gates without needing a headless browser.
FETCH_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Upgrade-Insecure-Requests": "1",
}
FETCH_TIMEOUT_S = 15
PRODUCT_PAGE_TEXT_CAP = 12_000
# Tier 4 escalation threshold (added 2026-05-25): if the requests-based
# Tier 2 fetch returns less than this many chars of combined text, fall
# back to a headless-browser render. Cloudflare/JS-challenge gated
# stores (pandurangacoffee.com, rossettecoffee.com) return length=0
# to the requests fetcher even on HTTP 200 — a real browser clears the
# challenge. 200 chars is well below any legitimate product page's
# floor and well above a Cloudflare interstitial.
TIER4_MIN_TEXT_LENGTH = 200


def _is_wix_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    return (
        ".wix.com" in lower
        or ".wixsite.com" in lower
        or "/product-page/" in lower
    )


def _meta(soup: BeautifulSoup, prop: str) -> Optional[str]:
    tag = soup.find("meta", attrs={"property": prop})
    if tag and tag.get("content"):
        return tag["content"].strip()
    tag = soup.find("meta", attrs={"name": prop})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def _jsonld_strings(soup: BeautifulSoup) -> list[str]:
    """Lean on the canonical jsonld_extractor for product-grade signal."""
    try:
        from services.jsonld_extractor import (
            extract_jsonld_blocks,
            extract_strings_for_llm,
        )
    except ImportError:
        return []
    try:
        blocks = extract_jsonld_blocks(soup)
        return extract_strings_for_llm(blocks)
    except Exception:
        return []


def _fetch_wix_product_html(url: str) -> str:
    """Wix products are JS-rendered SPAs; delegate to the existing
    Playwright-backed fetcher in `Scraper/scraper/wix_fetcher.py`.
    Returns the rendered HTML (Playwright preferred, requests-fetched
    raw HTML as fallback) so the caller can run the standard
    `_extract_product_from_html` selectors against the same DOM
    Shopify/WooCommerce flow through.

    Returns '' if the fetcher isn't importable (deps missing) or
    both render paths fail.
    """
    if str(_SCRAPER_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRAPER_DIR))
    try:
        from scraper.wix_fetcher import fetch_wix_html  # type: ignore
    except ImportError:
        return ""
    try:
        return fetch_wix_html(url) or ""
    except Exception:
        return ""


def _render_with_playwright(url: str) -> str:
    """Tier 4 escalation: headless Chromium render for non-Wix sites
    where the requests-based Tier 2 fetch returns empty (Cloudflare /
    JS-challenge gated storefronts like pandurangacoffee.com and
    rossettecoffee.com). Reuses the same Playwright launch profile
    `sync_runner._render_wix_html` uses — that function is generic
    despite its name. Returns '' on any failure.
    """
    try:
        from services.sync_runner import _render_wix_html
    except ImportError:
        return ""
    try:
        return _render_wix_html(url) or ""
    except Exception:
        return ""


def _jsonld_product_image(block: Any) -> Optional[str]:
    """Pull a product image URL from a JSON-LD block when its @type is
    a Product (or contains Product). Walks @graph too. Used to prefer
    Schema.org's canonical product-image declaration over og:image,
    which on many storefronts is the brand logo / share card instead
    of the specific SKU's image."""
    if not isinstance(block, dict):
        return None
    t = block.get("@type")
    if isinstance(t, list):
        is_product = any(str(x).endswith("Product") for x in t)
    elif t:
        is_product = str(t).endswith("Product")
    else:
        is_product = False
    if is_product:
        img = block.get("image")
        if isinstance(img, str) and img.strip():
            return img.strip()
        if isinstance(img, dict):
            u = img.get("url") or img.get("contentUrl") or img.get("@id")
            if isinstance(u, str) and u.strip():
                return u.strip()
        if isinstance(img, list) and img:
            first = img[0]
            if isinstance(first, str) and first.strip():
                return first.strip()
            if isinstance(first, dict):
                u = first.get("url") or first.get("contentUrl") or first.get("@id")
                if isinstance(u, str) and u.strip():
                    return u.strip()
        return None
    graph = block.get("@graph")
    if isinstance(graph, list):
        for sub in graph:
            hit = _jsonld_product_image(sub)
            if hit:
                return hit
    return None


_PRICE_INR_RE = re.compile(
    r"(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)(?=\s|$|[^\w])",
    re.IGNORECASE,
)


# Page-text phrases that positively signal a product is sold out.
# Surfaced as hints["sold_out_signal"] so the K3 validator on
# CanonicalProduct can distinguish "really sold out" from "price
# extraction failed". Lowercase substring match — page text is
# already lowercased before checking. Order doesn't matter; we only
# need any one to fire.
_SOLD_OUT_PHRASES = (
    "sold out",
    "out of stock",
    "currently unavailable",
    "notify me when available",
    "back in stock",
)

# Pre-launch / not-yet-purchasable button states (2026-05-30, Class D).
# Lower-confidence than the sold-out phrases — a real in-stock page can
# mention "coming soon" in marketing copy — so these count as
# not-purchasable ONLY when the page carries NO purchase affordance (the
# add-to-cart / buy button has been replaced by the pre-launch label).
# araku NANOLOT #5 (₹2600, "Coming Soon" button, no "add to cart") is the
# trigger: priced but unbuyable, and the Shopify .json endpoint omits
# variant.available so the page text is the only signal.
_NOT_PURCHASABLE_PHRASES = (
    "coming soon",
    "pre-order",
    "preorder",
    "pre order",
)
_PURCHASE_AFFORDANCE_PHRASES = (
    "add to cart",
    "add to bag",
    "add to basket",
    "buy now",
    "buy it now",
    "proceed to checkout",
)


def _detect_sold_out(cleaned_text: str) -> Optional[bool]:
    """Look for sold-out / not-purchasable language in cleaned page text.

    Returns True if any _SOLD_OUT_PHRASES appears (case-insensitive), OR a
    _NOT_PURCHASABLE_PHRASES (pre-launch) appears AND the page has no
    purchase affordance (add-to-cart / buy button). Returns False if the
    text was checked and nothing matched, None when the text is empty (no
    signal extractable). Pure substring match — the sold-out phrases are
    multi-word and don't false-positive inside other words; the pre-launch
    phrases are guarded by the no-affordance check so a real in-stock page
    that merely mentions 'coming soon' in copy is never flagged.
    """
    if not cleaned_text:
        return None
    lower = cleaned_text.lower()
    if any(phrase in lower for phrase in _SOLD_OUT_PHRASES):
        return True
    if any(phrase in lower for phrase in _NOT_PURCHASABLE_PHRASES):
        if not any(aff in lower for aff in _PURCHASE_AFFORDANCE_PHRASES):
            return True
    return False


def _extract_price_inr(text: str) -> Optional[float]:
    """Pull the first NON-ZERO INR price from cleaned page text.

    Currency forms supported (in order of frequency): `₹`, `Rs.`,
    `Rs `, `INR `. Playwright Tier 4 separates currency / amount /
    unit on newlines (`Rs.\\n900\\n200\\ng` or `₹\\n700\\n200\\ng`),
    so the word-boundary lookahead extracts the price cleanly.
    Concatenation bugs like `₹900200g` (Vithai pre-fix Tier 2 symptom)
    fail the lookahead and fall through — operator triages those via
    the absurd-price validator on CanonicalProduct rather than this
    extractor returning junk. Broadened 2026-05-25 after Kafeido
    (Shopify) showed the `Rs.` form which the ₹-only regex missed.

    Zero-filter rationale (2026-05-26): cart subtotals ("Your cart is
    empty\\n₹0"), JSON-LD numeric noise ("Offer\\n890.00\\nINR\\n\\n0\\n
    Your Cart" — the standalone `0` from a cart-count badge after the
    INR currency string matches `INR\\s*0`), and other template
    scaffolding regularly produce price=0 matches that appear BEFORE
    the actual product price in the page text. Zenforest 2026-05-26
    surfaced this: bulk_reenrich zeroed out positive prices sitewide
    because the first regex match was `INR\\n\\n0` (value=0) from
    JSON-LD output rather than `₹\\n890.00` (value=890) from the
    product header further down the page.

    First non-zero match is the correct pick for multi-variant pages
    too — the page header surfaces the default (usually cheapest)
    variant first, which is what the consumer-browse card displays.
    """
    if not text:
        return None
    for m in _PRICE_INR_RE.finditer(text):
        raw = m.group(1).replace(",", "")
        try:
            val = float(raw)
        except ValueError:
            continue
        if val > 0:
            return val
    return None


# Weight-in-body-text regex. Matches "250g", "250 g", "250gm",
# "250 grams", "1kg", "1 kg", "1.5kg", "1 kilo" with reasonable
# whitespace tolerance. Captures the numeric portion in group 1
# and the unit in group 2. Body text on Wix / custom storefronts
# often surfaces weight in the product description even when the
# variants array doesn't carry it — Haiku reads this but storing
# it as a deterministic hint avoids per-product LLM extraction
# variance.
_WEIGHT_GRAMS_RE = re.compile(
    r"\b(\d{1,4}(?:\.\d{1,2})?)\s*"
    r"(g|gm|gms|gram|grams|kg|kgs|kilo|kilos|kilogram|kilograms)\b",
    re.IGNORECASE,
)


def _extract_weight_grams(text: str) -> Optional[int]:
    """Scan body text for a coffee weight. Prefers the FIRST match
    in [50, 5000] grams — real bean SKUs are virtually always in
    that range. Drip-bag per-unit weights (8-15g) and bulk-pack
    weights (10kg+) are intentionally skipped.
    """
    if not text:
        return None
    for m in _WEIGHT_GRAMS_RE.finditer(text):
        raw = m.group(1)
        unit = m.group(2).lower()
        try:
            val = float(raw)
        except ValueError:
            continue
        if unit.startswith("kg") or unit.startswith("kilo"):
            grams = int(val * 1000)
        else:
            grams = int(val)
        if 50 <= grams <= 5000:
            return grams
    return None


def _grams_in(text: str) -> list[int]:
    """Every weight in a string, normalized to grams (kg → ×1000), in
    order. Unlike `_extract_weight_grams` (which returns the first
    plausible match) this returns ALL of them so a multi-size picker
    can choose a representative bag — see `_pick_bag_grams`."""
    out: list[int] = []
    for m in _WEIGHT_GRAMS_RE.finditer(text or ""):
        try:
            val = float(m.group(1))
        except ValueError:
            continue
        unit = m.group(2).lower()
        out.append(
            int(val * 1000) if unit.startswith(("kg", "kilo")) else int(val)
        )
    return out


# Typical specialty bag is 200-250 g. When a product offers MULTIPLE
# sizes (a Wix size <select>: gb-roasters 50/150/340/900 g), pick the
# representative bag: the largest option that does NOT exceed 250 g, so
# a 50 g taster loses to a 150 g bag and a 340 g / 900 g bulk size also
# loses to 150 g. If every option exceeds 250 g, take the smallest
# ("lower side if it exceeds"). Operator directive 2026-05-30 —
# replaces the first-match heuristic for the multi-size case.
_TYPICAL_BAG_GRAMS_HI = 250


def _pick_bag_grams(candidates) -> Optional[int]:
    vals = sorted({g for g in candidates if 50 <= g <= 5000})
    if not vals:
        return None
    under = [g for g in vals if g <= _TYPICAL_BAG_GRAMS_HI]
    return under[-1] if under else vals[0]


def _harvest_size_options(soup) -> list[str]:
    """Collect <select>/<option> + Wix variant-dropdown labels BEFORE
    the form is stripped. A Wix size <select> ('50 Grams / 150 Grams /
    ...') lives inside the add-to-cart <form>, which
    `_extract_product_from_html` decomposes before text extraction — so
    the size options are invisible to the weight parser unless harvested
    first. Returns de-duped, order-preserving labels. (2026-05-30 — the
    gb-roasters / agastya Wix weight=null root cause.)"""
    labels: list[str] = []
    for opt in soup.find_all("option"):
        t = opt.get_text(strip=True)
        if t and t.lower() not in (
            "select", "choose", "choose an option",
        ):
            labels.append(t)
    # Wix sometimes renders variant pickers as non-<option> nodes with a
    # data-hook rather than a native <select> — capture those too.
    try:
        for node in soup.select(
            "[data-hook*='dropdown-option'], [data-hook*='option-item']"
        ):
            t = node.get_text(strip=True)
            if t:
                labels.append(t)
    except Exception:
        pass
    return list(dict.fromkeys(labels))


_PRODUCT_IMG_SELECTORS = (
    # Shopify themes (Dawn / Debut / Sense / Impact / Refresh).
    ".product__media-item img",
    ".product__media img",
    ".product-single__media img",
    "[data-product-image]",
    "[data-product-featured-media] img",
    # WooCommerce.
    ".woocommerce-product-gallery__image img",
    ".wp-post-image",
    # Wix (Vithai, Ainmane, Nandan, Agastya all run on Wix).
    "[data-hook='ProductImageFigure'] img",
    "[data-hook='image-zoom-image-button'] img",
    "[data-hook='gallery-item-image'] img",
    "wow-image img",
    "wix-image img",
    # Magento M2 (Ainmane runs on M2 — Fotorama gallery widget is the
    # default product-page image carousel for M2 themes). Added
    # 2026-05-26 after Ainmane's 2 catalog products landed with
    # prices but no images.
    ".fotorama__stage__frame img",
    ".fotorama img",
    ".gallery-placeholder img",
    "[data-zoom-image]",
    # Generic product-card patterns for custom storefronts.
    ".product-gallery img",
    ".product-images img",
    ".product-image img",
    ".product-photo img",
    "figure.product img",
)


def _pick_product_image(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    """Find the most likely product-specific image URL on a parsed
    product page.

    Priority (most signal-specific first):
      1. JSON-LD Product.image — Schema.org canonical answer.
      2. <meta itemprop="image"> / <link rel="image_src"> — explicit
         per-page declaration.
      3. <img itemprop="image"> — Schema.org on the actual <img>.
      4. Common gallery selectors across Shopify / WooCommerce / Wix
         / custom storefronts.

    Caller falls back to og:image when this returns None. Added
    2026-05-25 because the og:image on Wix / custom storefronts (and
    many Shopify themes) is the brand logo, not the SKU image —
    leaving the catalog at 100% null image_url on Vithai / Ainmane
    / 57% null on Nandan / 54% on Agastya.
    """
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        for block in (data if isinstance(data, list) else [data]):
            hit = _jsonld_product_image(block)
            if hit:
                return urljoin(base_url, hit)

    meta_img = soup.find("meta", attrs={"itemprop": "image"})
    if meta_img and meta_img.get("content"):
        return urljoin(base_url, meta_img["content"].strip())
    link_img = soup.find("link", attrs={"rel": "image_src"})
    if link_img and link_img.get("href"):
        return urljoin(base_url, link_img["href"].strip())

    img_with_prop = soup.find("img", attrs={"itemprop": "image"})
    if img_with_prop:
        src = (
            img_with_prop.get("src")
            or img_with_prop.get("data-src")
            or img_with_prop.get("data-original")
        )
        if src and src.strip() and not src.startswith("data:"):
            return urljoin(base_url, src.strip())

    for sel in _PRODUCT_IMG_SELECTORS:
        tag = soup.select_one(sel)
        if not tag:
            continue
        src = (
            tag.get("src")
            or tag.get("data-src")
            or tag.get("data-original")
        )
        if src and src.strip() and not src.startswith("data:"):
            return urljoin(base_url, src.strip())

    return None


def _extract_product_from_html(
    url: str, html: str,
) -> tuple[str, dict[str, Any]]:
    """Shared between Tier 2 (requests) and Tier 4 (Playwright).
    Pulls og: hints + product-specific image + JSON-LD blocks +
    cleaned visible body text.

    Returns hints with both `image_url` (product-specific, picked by
    `_pick_product_image`) and `og_image` (the page's og:image, often
    the brand logo). Downstream callers prefer `image_url`; `og_image`
    stays as a fallback for the case where structured data is missing
    entirely.
    """
    soup = BeautifulSoup(html, "html.parser")
    og_title = _meta(soup, "og:title")
    og_image_raw = _meta(soup, "og:image")
    og_image = urljoin(url, og_image_raw) if og_image_raw else None
    og_description = _meta(soup, "og:description")

    product_image = _pick_product_image(soup, url)
    image_url = product_image or og_image

    jsonld_chunks = _jsonld_strings(soup)

    # Harvest size/variant <option> labels BEFORE the <form> is stripped
    # below — a Wix size <select> ('50 Grams / 150 Grams / 340 Grams /
    # 900 Grams') lives inside the add-to-cart form and would otherwise
    # be decomposed before the weight parser sees it. (2026-05-30)
    size_option_labels = _harvest_size_options(soup)

    for tag in soup(
        ["script", "style", "nav", "footer", "header", "aside",
         "noscript", "iframe", "form"]
    ):
        tag.decompose()
    target = (
        soup.find("main")
        or soup.find(class_=lambda c: bool(c) and "product" in c.lower())
        or soup.body
        or soup
    )
    text = target.get_text(separator="\n", strip=True)
    lines = [ln for ln in (l.strip() for l in text.splitlines()) if ln]
    cleaned = "\n".join(lines)

    parts = []
    if jsonld_chunks:
        parts.append("[JSON-LD STRUCTURED DATA]\n" + "\n".join(jsonld_chunks))
    if cleaned:
        parts.append(cleaned)
    combined = "\n\n".join(parts)[:PRODUCT_PAGE_TEXT_CAP]

    price_inr = _extract_price_inr(cleaned)
    # Weight: prefer a representative bag from the harvested size options
    # (multi-size Wix select) — the largest ≤250 g, else smallest. Only
    # when the size picker yielded nothing do we fall back to the
    # first-plausible-match scan of the body text (single-size pages
    # that state the weight in prose). Both stay inside [50,5000] g.
    _size_grams = []
    for _lbl in size_option_labels:
        _size_grams.extend(_grams_in(_lbl))
    weight_grams = _pick_bag_grams(_size_grams) or _extract_weight_grams(cleaned)
    sold_out_signal = _detect_sold_out(cleaned)

    # Append the harvested size options to the body text too, so Haiku
    # (and any downstream re-parse) can see the full size ladder the
    # form-strip would otherwise have removed.
    if size_option_labels:
        combined = (
            combined + "\n\nSIZE OPTIONS: " + " / ".join(size_option_labels)
        )[:PRODUCT_PAGE_TEXT_CAP]

    return combined, {
        "og_title": og_title,
        "og_image": og_image,
        "og_description": og_description,
        "image_url": image_url,
        "price_inr": price_inr,
        "weight_grams": weight_grams,
        "sold_out_signal": sold_out_signal,
    }


def _fetch_product(url: str) -> tuple[str, dict[str, Any]]:
    if _is_wix_url(url):
        # Wix is a JS-rendered SPA — plain requests returns the
        # hydration shell with og: meta, the product detail table,
        # and the SKU image all missing from the DOM. Use the
        # Playwright-backed fetcher to get the fully-rendered HTML,
        # then run the standard product extractor on it so og_title,
        # og_image, image_url (via _pick_product_image's Wix
        # selectors) and price_inr all land. Prior implementation
        # returned text-only + hardcoded {og_title:None,og_image:None}
        # which silently dropped image/price for every Wix product.
        rendered_html = _fetch_wix_product_html(url)
        if not rendered_html:
            return "", {}
        return _extract_product_from_html(url, rendered_html)

    # Tier 2: requests-based fetch + bs4 extraction.
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT_S,
            headers=FETCH_HEADERS,
            allow_redirects=True,
        )
    except (requests.RequestException, OSError, ValueError):
        resp = None

    text_t2, hints_t2 = ("", {})
    if resp is not None and resp.status_code == 200:
        text_t2, hints_t2 = _extract_product_from_html(url, resp.text)

    if len(text_t2) >= TIER4_MIN_TEXT_LENGTH:
        return text_t2, hints_t2

    # Tier 4 escalation: the requests fetch came back empty / thin
    # / non-200. A headless browser clears most Cloudflare or JS
    # challenges these stores ship.
    rendered = _render_with_playwright(url)
    if not rendered:
        # Playwright unavailable or also failed. Return whatever T2 had
        # (probably "") so the caller can fail cleanly.
        return text_t2, hints_t2
    text_t4, hints_t4 = _extract_product_from_html(url, rendered)
    if len(text_t4) > len(text_t2):
        return text_t4, hints_t4
    return text_t2, hints_t2


def _fetch_article(url: str) -> tuple[str, dict[str, Any]]:
    try:
        from services.article_scraper import extract_for_enrichment
    except ImportError:
        return "", {}

    # Tier 2: requests-based fetch.
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT_S,
            headers=FETCH_HEADERS,
            allow_redirects=True,
        )
    except (requests.RequestException, OSError, ValueError):
        resp = None

    html_t2 = ""
    if resp is not None and resp.status_code == 200:
        html_t2 = resp.text

    bundle_t2: dict[str, Any] = {}
    if html_t2:
        try:
            bundle_t2 = extract_for_enrichment(html_t2, base_url=url) or {}
        except Exception:
            bundle_t2 = {}

    page_text_t2 = bundle_t2.get("page_text") or ""

    if len(page_text_t2) >= TIER4_MIN_TEXT_LENGTH:
        return page_text_t2, _article_hints_from_bundle(bundle_t2)

    # Tier 4 escalation for atom feeds / Cloudflare-walled blogs
    # (Black Baza's /blogs/*.atom returns 503 to scripted requests).
    rendered = _render_with_playwright(url)
    if not rendered:
        return page_text_t2, _article_hints_from_bundle(bundle_t2)
    try:
        bundle_t4 = extract_for_enrichment(rendered, base_url=url) or {}
    except Exception:
        bundle_t4 = {}
    page_text_t4 = bundle_t4.get("page_text") or ""
    if len(page_text_t4) > len(page_text_t2):
        return page_text_t4, _article_hints_from_bundle(bundle_t4)
    return page_text_t2, _article_hints_from_bundle(bundle_t2)


def _article_hints_from_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "og_title": bundle.get("og_title"),
        "og_description": bundle.get("og_description"),
        "og_image": bundle.get("og_image"),
        "og_published_at": bundle.get("og_published_at"),
        "detected_videos": bundle.get("detected_videos") or [],
        "detected_links": bundle.get("detected_links") or [],
        "fallback": bundle.get("fallback") or {},
    }


def fetch_page(url: str, *, kind: str) -> tuple[str, dict[str, Any]]:
    """Fetch a URL and return (page_text, kind-specific hints).

    Empty page_text + empty hints means the fetch failed; the caller
    should mark the enrichment_task `state='failed'` with a clear
    error message and move on.
    """
    if not url or not url.startswith(("http://", "https://")):
        return "", {}
    if kind == "product":
        return _fetch_product(url)
    if kind == "article":
        return _fetch_article(url)
    raise ValueError(f"Unknown kind: {kind!r}")


# HTTP status codes that mean a product URL is permanently gone — the
# catalog row should be flagged `url_dead` (available=0). 404 Not Found
# and 410 Gone are unambiguous. 402 Payment Required is the Shopify
# "store subscription suspended" signal: the whole storefront returns
# 402 on every product (Forest Farmer class), so the row is effectively
# dead even though the host still answers. Everything else (401/403
# anti-bot challenges, 5xx, network errors) is transient and preserves
# the row as-is. Single source of truth — both the inline enrichment
# path and the standalone url-health audit import this.
DEAD_HTTP_STATUSES: frozenset = frozenset({402, 404, 410})


def is_dead_status(status: Optional[int]) -> bool:
    """True when an HTTP status code means the URL is permanently dead
    and the catalog row should flip to `url_dead`."""
    return status in DEAD_HTTP_STATUSES


def head_check_url(url: str) -> Optional[int]:
    """Cheap HEAD-check for a URL. Returns the HTTP status code, or
    None if the request failed at the network layer (DNS, timeout,
    connection reset, etc).

    Used by the enrichment runner after `fetch_page` returns empty
    to distinguish a permanent dead status (catalog row should be
    flagged `url_dead`) from a transient failure (preserve the row
    as-is). See `DEAD_HTTP_STATUSES` for the codes treated as dead.
    Some sites refuse HEAD with 405 — those callers fall back to
    GET for the status check.
    """
    if not url or not url.startswith(("http://", "https://")):
        return None
    try:
        resp = requests.head(
            url, timeout=FETCH_TIMEOUT_S, headers=FETCH_HEADERS,
            allow_redirects=True,
        )
        if resp.status_code == 405:
            # Method Not Allowed — fall back to GET (some Cloudflare-
            # protected stores reject HEAD outright).
            resp = requests.get(
                url, timeout=FETCH_TIMEOUT_S, headers=FETCH_HEADERS,
                allow_redirects=True, stream=True,
            )
            resp.close()
        return resp.status_code
    except (requests.RequestException, OSError, ValueError):
        return None


__all__ = [
    "fetch_page", "head_check_url", "is_dead_status", "DEAD_HTTP_STATUSES",
]
