"""
Shared helpers for the catalog pipeline:
  fetch_page, slugify, city→state lookup, URL cleaning.
"""

import re
import time
import unicodedata
import requests
from urllib.parse import urlparse

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (roaster catalog; research)"
}
TIMEOUT = 10
MAX_RETRIES = 3

SOCIAL_DOMAINS = {
    "facebook.com", "instagram.com", "twitter.com", "x.com",
    "youtube.com", "linkedin.com", "pinterest.com",
}


def fetch_page(url, timeout=TIMEOUT):
    """
    GET a URL with retry + exponential backoff.
    Returns (status_code: int, html: str | None).
    """
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(
                url, headers=HEADERS, timeout=timeout, allow_redirects=True
            )
            return r.status_code, r.text
        except Exception:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
    return 0, None


def slugify(text):
    """URL-safe lowercase slug."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[''`]", "", text)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def is_real_website(url):
    """Return False if the URL is just a social media page."""
    if not url:
        return False
    domain = urlparse(url).netloc.lower().replace("www.", "")
    return domain not in SOCIAL_DOMAINS


def clean_url(url):
    """Ensure URL has a scheme."""
    if not url:
        return None
    if not url.startswith("http"):
        url = "https://" + url
    return url.rstrip("/")


# ── City → State lookup ───────────────────────────────────────────────────────

CITY_STATE = {
    "new delhi": "Delhi", "delhi": "Delhi",
    "mumbai": "Maharashtra", "pune": "Maharashtra", "nagpur": "Maharashtra",
    "bengaluru": "Karnataka", "bangalore": "Karnataka",
    "mysuru": "Karnataka", "mysore": "Karnataka",
    "mangalore": "Karnataka", "mangaluru": "Karnataka",
    "chikmagalur": "Karnataka", "chikkamagaluru": "Karnataka",
    "coorg": "Karnataka", "madikeri": "Karnataka", "sakleshpur": "Karnataka",
    "chennai": "Tamil Nadu", "coimbatore": "Tamil Nadu",
    "madurai": "Tamil Nadu", "kodaikanal": "Tamil Nadu",
    "auroville": "Tamil Nadu",
    "hyderabad": "Telangana", "visakhapatnam": "Andhra Pradesh",
    "kolkata": "West Bengal",
    "ahmedabad": "Gujarat", "surat": "Gujarat", "vadodara": "Gujarat",
    "jaipur": "Rajasthan", "ajmer": "Rajasthan",
    "lucknow": "Uttar Pradesh", "noida": "Uttar Pradesh",
    "gurgaon": "Haryana", "gurugram": "Haryana", "panchkula": "Haryana",
    "chandigarh": "Chandigarh",
    "kochi": "Kerala", "thiruvananthapuram": "Kerala",
    "kalpetta": "Kerala", "wayanad": "Kerala",
    "bhopal": "Madhya Pradesh", "indore": "Madhya Pradesh",
    "bhubaneswar": "Odisha",
    "raipur": "Chhattisgarh",
    "ranchi": "Jharkhand",
    "patna": "Bihar",
    "panaji": "Goa",
    "guwahati": "Assam",
    "shillong": "Meghalaya",
    "kohima": "Nagaland", "dimapur": "Nagaland",
    "imphal": "Manipur",
    "aizawl": "Mizoram",
    "gangtok": "Sikkim",
    "agartala": "Tripura",
    "itanagar": "Arunachal Pradesh",
    "dehradun": "Uttarakhand",
}


def infer_state(address, city_searched=None):
    """Infer state from a Google Places formatted address or city name."""
    if address:
        addr_l = address.lower()
        for city, state in CITY_STATE.items():
            if city in addr_l:
                return state
    if city_searched:
        return CITY_STATE.get(city_searched.lower())
    return None


def infer_city(address, city_searched=None):
    """Extract city from a formatted address (first comma segment) or use city_searched."""
    if address:
        parts = [p.strip() for p in address.split(",")]
        if len(parts) >= 2:
            return parts[-3] if len(parts) >= 3 else parts[0]
    return city_searched
