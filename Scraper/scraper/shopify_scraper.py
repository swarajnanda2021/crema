"""
Scrape product data from Shopify stores via the public /products.json endpoint.
"""

import re
import time
import requests
from typing import Optional
from urllib.parse import urlparse
from utils import extract_domain

# Shopify collection paths look like /collections/{handle} (with optional
# trailing slash and optional /products{,.json} suffix).
_COLLECTION_RE = re.compile(
    r"^/collections/([a-z0-9][a-z0-9-]*)/?(?:products(?:\.json)?)?/?$",
    re.IGNORECASE,
)


def _collection_handle(shop_url: Optional[str]) -> Optional[str]:
    """Return the Shopify collection handle if `shop_url` points at one,
    else None. Lets a curated `shop_url` like
    `/collections/roasted-beans` scope the scrape to that collection
    instead of pulling the site-wide product feed and relying on the
    coffee filter to drop merch."""
    if not shop_url:
        return None
    try:
        path = urlparse(shop_url).path or ""
    except Exception:
        return None
    m = _COLLECTION_RE.match(path)
    return m.group(1).lower() if m else None

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
    Fetch products from a Shopify store via /products.json.

    If the admin curated `shop_url` to a specific collection (e.g.
    `/collections/roasted-beans`), scope the scrape to that
    collection's products.json. Otherwise fall back to the site-wide
    feed. Collection-scoping respects roaster intent on mixed-catalog
    sites where the global feed pulls in merch + accessories that
    waste downstream Haiku enrichment calls.

    Each returned product dict has _roaster, _domain, _platform attached.
    """
    domain = extract_domain(roaster["website"])
    handle = _collection_handle(roaster.get("shop_url"))
    base_path = (
        f"/collections/{handle}/products.json" if handle else "/products.json"
    )
    all_products = []
    page = 1

    while True:
        url = f"https://{domain}{base_path}?limit=250&page={page}"
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
