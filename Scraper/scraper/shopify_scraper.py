"""
Scrape product data from Shopify stores via the public /products.json endpoint.
"""

import time
import requests
from typing import Optional
from utils import extract_domain

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (product catalog; contact@example.com)"
}
TIMEOUT = 10
MAX_RETRIES = 3


def _fetch_json(url: str) -> Optional[dict]:
    """GET JSON with exponential-backoff retry. Raises on fatal errors."""
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)

            # Cloudflare challenge detection
            if "cf-ray" in r.headers and "checking your browser" in r.text.lower():
                raise RuntimeError("cloudflare_blocked")

            if r.status_code == 200:
                return r.json()
            elif r.status_code in (403, 429):
                raise RuntimeError(f"blocked: HTTP {r.status_code}")
            elif r.status_code >= 500:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
                raise RuntimeError(f"server_error: HTTP {r.status_code}")
            else:
                # Unexpected status — treat as failure
                return None

        except RuntimeError:
            raise
        except Exception as exc:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise RuntimeError(f"request_failed: {exc}") from exc

    return None


def scrape_shopify(roaster: dict) -> list:
    """
    Fetch all products from a Shopify store via /products.json.
    Each returned product dict has _roaster, _domain, _platform attached.
    """
    domain = extract_domain(roaster["website"])
    all_products = []
    page = 1

    while True:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        data = _fetch_json(url)

        if not data:
            break

        products = data.get("products", [])
        if not products:
            break

        all_products.extend(products)

        # Shopify returns fewer than 250 on the last page
        if len(products) < 250:
            break

        page += 1
        time.sleep(1)  # polite inter-page pause

    # Attach metadata used by the normalizer
    for p in all_products:
        p["_roaster"] = roaster
        p["_domain"] = domain
        p["_platform"] = "shopify"

    return all_products
