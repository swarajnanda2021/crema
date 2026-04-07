"""
Scrape product data from WooCommerce stores via the public Store API.
Falls back to signalling 'use custom scraper' if the API is inaccessible.
"""

import time
import requests
from typing import Optional
from utils import extract_domain

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (product catalog; contact@example.com)"
}
TIMEOUT = 20
MAX_RETRIES = 3


def _fetch_json(url: str) -> Optional[list]:
    """GET JSON list with retry. Returns None on non-200 or auth errors."""
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)

            # Cloudflare challenge
            if "cf-ray" in r.headers and "checking your browser" in r.text.lower():
                raise RuntimeError("cloudflare_blocked")

            if r.status_code == 200:
                return r.json()
            elif r.status_code in (401, 403, 404):
                # API not available / auth required
                return None
            elif r.status_code == 429:
                raise RuntimeError(f"blocked: HTTP 429")
            elif r.status_code >= 500 and attempt < MAX_RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            else:
                return None

        except RuntimeError:
            raise
        except Exception as exc:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise RuntimeError(f"request_failed: {exc}") from exc

    return None


def scrape_woocommerce(roaster: dict) -> tuple:
    """
    Fetch products from WooCommerce Store API with pagination.

    Returns:
        (products: list, needs_custom_fallback: bool)
        If the API is unavailable, returns ([], True) so main.py can
        route to the custom HTML scraper instead.
    """
    domain = extract_domain(roaster["website"])
    all_products = []
    page = 1

    while True:
        url = (
            f"https://{domain}/wp-json/wc/store/products"
            f"?per_page=100&page={page}"
        )
        data = _fetch_json(url)

        if data is None:
            # API inaccessible on first page → signal fallback
            if page == 1:
                return [], True
            break

        if not isinstance(data, list) or not data:
            break

        all_products.extend(data)

        if len(data) < 100:
            break

        page += 1
        time.sleep(1)

    if not all_products:
        return [], True

    # Attach metadata
    for p in all_products:
        p["_roaster"] = roaster
        p["_domain"] = domain
        p["_platform"] = "woocommerce"

    return all_products, False
