"""
Confirm the e-commerce platform of a roaster's website at runtime.
Tries both the bare domain and the www. variant to handle redirects.
"""

import requests
from utils import extract_domain

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (product catalog; contact@example.com)"
}
TIMEOUT = 20


def _candidate_domains(website: str) -> list:
    """Return [domain, www.domain] or [domain] if already has www."""
    domain = extract_domain(website)
    candidates = [domain]
    if not domain.startswith("www."):
        candidates.append("www." + domain)
    return candidates


def _test_shopify(domain: str) -> bool:
    """Return True if /products.json is accessible and returns Shopify JSON."""
    try:
        r = requests.get(
            f"https://{domain}/products.json?limit=1",
            headers=HEADERS,
            timeout=TIMEOUT,
            allow_redirects=True,
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict) and "products" in data:
                return True
    except Exception:
        pass
    return False


def _test_woocommerce(domain: str) -> bool:
    """Return True if WooCommerce Store API responds with a product list."""
    try:
        r = requests.get(
            f"https://{domain}/wp-json/wc/store/products?per_page=1",
            headers=HEADERS,
            timeout=TIMEOUT,
            allow_redirects=True,
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                return True
    except Exception:
        pass
    return False


def confirm_platform(website: str) -> str:
    """
    Probe platform-specific endpoints to detect the actual platform.
    Tries both bare domain and www. subdomain.
    Returns: 'shopify', 'woocommerce', or 'custom'
    """
    for domain in _candidate_domains(website):
        if _test_shopify(domain):
            return "shopify"
    for domain in _candidate_domains(website):
        if _test_woocommerce(domain):
            return "woocommerce"
    return "custom"
