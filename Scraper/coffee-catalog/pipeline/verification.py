"""
Phase 2: Website Verification.
For each candidate with a website, crawl to determine if it has
a functioning online coffee bean shop.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from utils import fetch_page

MAX_WORKERS = 8

# ── Shop link patterns ────────────────────────────────────────────────────────

SHOP_HREF_PATTERNS = [
    "/shop", "/store", "/collections", "/products", "/buy", "/order",
    "/coffee", "/beans", "/roasted", "/blends", "/single-origin",
]

SHOP_TEXT_PATTERNS = [
    "shop", "store", "buy", "products", "coffee", "beans",
    "our coffees", "browse", "order",
]

# ── E-commerce signal keywords ────────────────────────────────────────────────

COFFEE_TERMS = {
    "coffee", "beans", "roast", "blend", "arabica", "robusta",
    "filter", "espresso", "ground", "single-origin", "single origin",
    "whole-bean", "whole bean", "peaberry", "natural", "washed",
}

# Multiple price patterns — WooCommerce uses HTML entities and spans
PRICE_PATTERNS = [
    re.compile(r"(?:₹|Rs\.?|INR)\s*[\d,]+"),           # ₹449, Rs. 599
    re.compile(r"&#8377;\s*[\d,]+"),                      # HTML entity &#8377; = ₹
    re.compile(r"woocommerce-Price-amount.*?[\d,]+"),     # WooCommerce price spans
    re.compile(r"price.*?[\d,]{3,}"),                     # Generic "price" near a number
]

CART_SIGNALS = [
    "add to cart", "add to bag", "buy now",
    "cdn.shopify.com", "shopify", "woocommerce",
    "instamojo", "razorpay", "cashfree", "paytm",
    "wa.me/", "whatsapp",
]


def _find_shop_urls(base_url, html):
    """Parse homepage HTML for links that look like a shop/products page."""
    soup = BeautifulSoup(html, "lxml")
    candidates = []

    for a in soup.find_all("a", href=True):
        href = a["href"].lower()
        text = a.get_text(strip=True).lower()
        full = urljoin(base_url, a["href"])

        # Must be same domain
        if urlparse(base_url).netloc not in urlparse(full).netloc:
            continue

        for pattern in SHOP_HREF_PATTERNS:
            if pattern in href:
                candidates.append(full)
                break
        else:
            for pattern in SHOP_TEXT_PATTERNS:
                if pattern in text:
                    candidates.append(full)
                    break

    # Deduplicate preserving order
    seen = set()
    return [u for u in candidates if not (u in seen or seen.add(u))]


def _detect_platform(html):
    """Detect the e-commerce platform from HTML content."""
    h = html.lower()
    if "cdn.shopify.com" in h or "shopify." in h:
        return "Shopify"
    if "woocommerce" in h or "wp-content/plugins/woocommerce" in h:
        return "WooCommerce"
    if "instamojo" in h:
        return "Instamojo"
    return "Custom"


def _check_ecommerce_signals(html):
    """
    Check a shop page for the three required signals:
    coffee terms, INR prices, and a cart/order mechanism.
    Returns (coffee_terms_found, price_examples, cart_signals_found).
    """
    h = html.lower()

    coffee_found = [t for t in COFFEE_TERMS if t in h]
    prices = []
    for pattern in PRICE_PATTERNS:
        prices.extend(pattern.findall(html)[:5])
    prices = prices[:5]
    carts = [s for s in CART_SIGNALS if s in h]

    return coffee_found, prices, carts


def _classify(homepage_status, shop_urls, coffee_terms, prices, carts, has_whatsapp):
    """Determine the verification classification."""
    if homepage_status != 200:
        return "WEBSITE_DEAD"
    if not shop_urls:
        return "NO_SHOP_PAGE"
    if len(coffee_terms) < 2:
        return "NO_COFFEE_PRODUCTS"
    if not prices:
        return "NO_PRICES"
    if carts:
        return "VERIFIED"
    if has_whatsapp:
        return "VERIFIED_WHATSAPP"
    return "NO_CART_MECHANISM"


def verify_candidate(candidate):
    """
    Verify a single candidate. Returns a verification result dict.
    """
    name = candidate["name"]
    website = candidate.get("website")

    result = {
        "place_id": candidate["place_id"],
        "name": name,
        "website": website,
        "homepage_status": 0,
        "shop_url": None,
        "classification": "NO_WEBSITE",
        "platform": None,
        "evidence": {
            "coffee_terms_found": [],
            "price_examples": [],
            "cart_signals": [],
            "shop_links_found": [],
        },
    }

    if not website:
        return result

    # 1. Fetch homepage
    status, html = fetch_page(website)
    result["homepage_status"] = status

    if status != 200 or not html:
        result["classification"] = "WEBSITE_DEAD"
        return result

    # Detect platform from homepage
    result["platform"] = _detect_platform(html)

    # 2. Find shop URLs
    shop_urls = _find_shop_urls(website, html)
    result["evidence"]["shop_links_found"] = shop_urls[:5]

    # If Shopify, the homepage itself often has the signals
    # Also check the homepage directly for signals
    all_html = html
    best_shop_url = None

    if shop_urls:
        best_shop_url = shop_urls[0]
        result["shop_url"] = best_shop_url
        # Fetch the shop page
        shop_status, shop_html = fetch_page(best_shop_url)
        if shop_status == 200 and shop_html:
            all_html = html + shop_html
        time.sleep(1)

    # 3. Check e-commerce signals across homepage + shop page
    coffee_terms, prices, carts = _check_ecommerce_signals(all_html)
    has_whatsapp = "wa.me/" in all_html.lower() or "whatsapp" in all_html.lower()

    result["evidence"]["coffee_terms_found"] = coffee_terms
    result["evidence"]["price_examples"] = prices
    result["evidence"]["cart_signals"] = carts

    # If no explicit shop URL found, use homepage as shop_url for Shopify
    if not best_shop_url and result["platform"] == "Shopify":
        result["shop_url"] = website

    # 4. Classify
    result["classification"] = _classify(
        status, shop_urls or (result["platform"] == "Shopify"),
        coffee_terms, prices, carts, has_whatsapp,
    )

    return result


def _verify_one(candidate):
    """Worker: verify a single candidate. Returns (candidate, result)."""
    try:
        return candidate, verify_candidate(candidate)
    except Exception as e:
        return candidate, {
            "place_id": candidate["place_id"],
            "name": candidate["name"],
            "website": candidate.get("website"),
            "homepage_status": 0,
            "shop_url": None,
            "classification": "WEBSITE_DEAD",
            "platform": None,
            "evidence": {"error": str(e)},
        }


def run_verification(candidates):
    """
    Phase 2 entry point. Verify all candidates in parallel.
    Returns (results, verified_count, dropped_count).
    """
    results = []
    verified = 0
    dropped = 0
    total = len(candidates)
    done = [0]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_verify_one, c): c for c in candidates}

        for future in as_completed(futures):
            candidate, result = future.result()
            done[0] += 1
            name = candidate["name"][:40]
            classification = result["classification"]
            platform = result.get("platform") or ""

            if classification in ("VERIFIED", "VERIFIED_WHATSAPP"):
                verified += 1
                print(f"  [{done[0]}/{total}] {name:40} -> {classification} ({platform})")
            else:
                dropped += 1
                print(f"  [{done[0]}/{total}] {name:40} -> {classification}")

            results.append(result)

    return results, verified, dropped
