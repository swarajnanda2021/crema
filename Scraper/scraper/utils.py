"""
Utility helpers: slugify, price cleaning, weight normalization,
image URL cleaning, HTML stripping.
"""

import re
import unicodedata
from typing import Optional


def slugify(text: str) -> str:
    """Convert text to URL-safe lowercase slug."""
    if not text:
        return ""
    # Normalize unicode to ASCII equivalents
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    # Remove characters that are not alphanumeric, whitespace, or hyphens
    text = re.sub(r"[^\w\s-]", "", text)
    # Replace whitespace and underscores with hyphens
    text = re.sub(r"[\s_]+", "-", text)
    # Collapse multiple hyphens
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def clean_price(price_str) -> Optional[float]:
    """Strip currency symbols and return price as float."""
    if price_str is None:
        return None
    s = str(price_str)
    # Remove currency symbols, labels, commas, spaces
    s = re.sub(r"[₹\s]", "", s)
    s = re.sub(r"(?i)rs\.?|inr", "", s)
    s = s.replace(",", "")
    # Keep only digits and decimal point
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return None
    try:
        val = float(s)
        return val if val > 0 else None
    except ValueError:
        return None


def normalize_weight(raw) -> Optional[int]:
    """
    Normalize weight to grams (integer).
    Accepts strings like '250g', '0.5 kg', '1kg', or bare integers from
    Shopify's variant.grams field.
    """
    if raw is None:
        return None
    s = str(raw).strip().lower()

    # Kilograms
    kg = re.search(r"(\d+(?:\.\d+)?)\s*kg", s)
    if kg:
        return int(float(kg.group(1)) * 1000)

    # Grams (g / gm / gms / gram / grams)
    g = re.search(r"(\d+)\s*(?:grams?|gms?|g)\b", s)
    if g:
        return int(g.group(1))

    # Bare integer — used for Shopify variant.grams
    bare = re.match(r"^(\d+)$", s)
    if bare:
        val = int(bare.group(1))
        return val if val > 0 else None

    return None


def clean_image_url(url: str) -> Optional[str]:
    """
    Remove Shopify size suffixes from CDN image URLs, e.g.:
      _600x, _300x300, _large, _medium, _small, _grande, _1024x1024
    """
    if not url:
        return None
    # Remove dimension suffixes before extension
    url = re.sub(r"_\d+x\d*(?=\.\w{2,4}($|\?))", "", url)
    # Remove named size suffixes
    url = re.sub(r"_(large|medium|small|grande|compact|1024x1024)(?=\.\w{2,4}($|\?))", "", url)
    return url


def strip_html(html_text: str) -> str:
    """Strip HTML tags and return clean text."""
    if not html_text:
        return ""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_text, "lxml")
    return soup.get_text(separator=" ", strip=True)


def extract_domain(url: str) -> str:
    """Return netloc (domain + port) from a URL string."""
    from urllib.parse import urlparse
    return urlparse(url).netloc


def variants_to_display(variants: list) -> str:
    """Serialize variants list to a readable Excel string."""
    parts = []
    for v in variants:
        w = v.get("weight_grams")
        p = v.get("price_inr")
        if w and p:
            parts.append(f"{w}g: ₹{p:.0f}")
    return " | ".join(parts) if parts else ""
