"""
Field normalization, enrichment extraction, and confidence scoring.
Converts raw platform-specific product dicts into the unified output schema.
"""

import re
import datetime
from typing import Optional

from utils import slugify, clean_price, normalize_weight, clean_image_url, strip_html


# ── Roast level ───────────────────────────────────────────────────────────────

# Ordered most-specific → least-specific to avoid ambiguous matches
_ROAST_PATTERNS = [
    (r"medium[\s-]dark|full[\s-]?city\+?", "Medium-Dark"),
    (r"medium[\s-]light|city\s*roast\b", "Medium-Light"),
    (r"light[\s-]roast\b|light\b", "Light"),
    (r"dark[\s-]roast\b|french[\s-]roast|italian[\s-]roast|dark\b", "Dark"),
    (r"medium[\s-]roast\b|medium\b", "Medium"),
]


def extract_roast_level(text_sources: list) -> tuple:
    """
    Search ordered text sources (tags list, title string, description string).
    Returns (level: str, found: bool).
    """
    for source in text_sources:
        if not source:
            continue
        s = source if isinstance(source, str) else " ".join(str(x) for x in source)
        for pattern, level in _ROAST_PATTERNS:
            if re.search(pattern, s, re.IGNORECASE):
                return level, True
    return "Unknown", False


# ── Tasting notes ─────────────────────────────────────────────────────────────

_NOTES_PATTERNS = [
    r"tasting\s+notes?\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
    r"flavou?r\s+notes?\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
    r"flavou?r\s+profile\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
    r"cup\s+profile\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
    r"in\s+the\s+cup\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
    r"^notes\s*[:\-–]\s*(.+?)(?:\.|<|\n|$)",
]


def extract_tasting_notes(text: str) -> Optional[str]:
    if not text:
        return None
    for pattern in _NOTES_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if m:
            raw = m.group(1).strip()
            notes = re.split(r"\s*[,&/|]\s*|\s+and\s+", raw)
            notes = [n.strip().title() for n in notes if n.strip() and len(n.strip()) < 50]
            if notes:
                return ", ".join(notes)
    return None


# ── Altitude ──────────────────────────────────────────────────────────────────

_ALTITUDE_PATTERNS = [
    # Range with masl/m/meters suffix: "1000-1400 masl", "900-1100m"
    r"(\d{3,4})\s*[-–to]+\s*(\d{3,4})\s*(?:m\.?a\.?s\.?l\.?|masl|meters?(?:\s+asl)?|mts?\s*asl|m\b)",
    # altitude/elevation label with range: "altitude: 900-1100"
    r"(?:altitude|elevation)[:\s]+(\d{3,4})\s*[-–to]+\s*(\d{3,4})",
    # Single value with masl/m/meters suffix
    r"(\d{3,4})\s*(?:m\.?a\.?s\.?l\.?|masl|meters?\s*(?:above\s+sea\s+level)?|mts?\s*asl|m\b)",
    # altitude/elevation label with single value
    r"(?:altitude|elevation)[:\s]+(\d{3,4})",
    r"grown\s+at\s+(\d{3,4})",
]


def extract_altitude(text: str) -> Optional[int]:
    if not text:
        return None
    for pattern in _ALTITUDE_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            groups = [g for g in m.groups() if g is not None]
            if len(groups) == 2:
                try:
                    return int((int(groups[0]) + int(groups[1])) / 2)
                except (ValueError, TypeError):
                    pass
            elif groups:
                try:
                    return int(groups[0])
                except (ValueError, TypeError):
                    pass
    return None


# ── Processing method ─────────────────────────────────────────────────────────

_PROCESS_PATTERNS = [
    (r"fully[\s-]washed|wet[\s-]process(?:ed)?|washed", "Washed"),
    (r"sun[\s-]?dried|dry[\s-]process(?:ed)?|naturals?\b", "Natural"),
    (r"honey\b|pulped[\s-]natural", "Honey"),
    (r"anaerobic(?:ally)?(?:\s+fermented)?", "Anaerobic"),
    (r"semi[\s-]washed|wet[\s-]hulled|giling[\s-]basah", "Semi-Washed"),
]


def extract_process(text: str) -> Optional[str]:
    if not text:
        return None
    for pattern, process in _PROCESS_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return process
    return None


# ── Varietal ──────────────────────────────────────────────────────────────────

_VARIETAL_PATTERNS = [
    r"arabica\b", r"robusta\b", r"liberica\b", r"excelsa\b",
    r"SLN\s*795", r"SLN\s*9\b", r"S\.?\s*795", r"kent\b",
    r"cauvery\b", r"chandragiri\b", r"selection\s*[56]\b",
    r"catimor\b", r"caturra\b", r"typica\b", r"bourbon\b",
]


def extract_varietal(text: str) -> Optional[str]:
    if not text:
        return None
    found = []
    for pattern in _VARIETAL_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = m.group(0).strip()
            if val not in found:
                found.append(val)
    return ", ".join(found) if found else None


# ── Origin ────────────────────────────────────────────────────────────────────

_INDIAN_REGIONS = [
    "chikmagalur", "coorg", "kodagu", "araku", "wayanad", "baba budan",
    "bababudan", "nilgiris", "pulney", "pollibetta", "sakleshpur",
    "manjarabad", "shevaroy", "attikan", "siddapur", "mudigere",
    "yercaud", "ooty", "koraput", "visakhapatnam", "biligiri",
]

_ESTATE_PATTERN = re.compile(
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Estate|Farm|Plantation|Hills?|Valley|Bagh))",
    re.IGNORECASE,
)


def extract_origin(body_text: str, title: str = "") -> Optional[str]:
    combined = (body_text + " " + title).lower()
    for region in _INDIAN_REGIONS:
        if region in combined:
            idx = combined.find(region)
            raw = (body_text + " " + title)
            snippet = raw[max(0, idx - 5): idx + len(region) + 40].strip()
            snippet = re.split(r"[.!?\n|]", snippet)[0].strip()
            return snippet.title() if snippet else region.title()
    m = _ESTATE_PATTERN.search(body_text + " " + title)
    if m:
        return m.group(1).strip().title()
    return None


# ── Grind options ─────────────────────────────────────────────────────────────

# Maps lowercase keywords found in option values → canonical grind names
_GRIND_MAP = {
    "whole bean": "Whole Bean",
    "whole beans": "Whole Bean",
    "coarse": "Coarse",
    "filter grind": "Filter",
    "filter": "Filter",
    "fine grind": "Fine",
    "fine": "Fine",
    "medium grind": "Medium Grind",
    "espresso grind": "Espresso",
    "espresso": "Espresso",
    "moka pot": "Moka Pot",
    "moka": "Moka Pot",
    "french press": "French Press",
    "aeropress": "AeroPress",
    "pour over": "Pour Over",
    "pour-over": "Pour Over",
    "chemex": "Chemex",
    "cold brew": "Cold Brew",
    "v60": "V60",
    "drip": "Drip",
}

# Option names that signal a grind/type axis (case-insensitive)
_GRIND_OPTION_NAMES = {"grind", "grind size", "grind type", "type", "brew method"}


def _match_grind(value: str) -> Optional[str]:
    """Return canonical grind name if value matches a known grind keyword."""
    v = value.lower().strip()
    # Longest-match first so "whole bean" beats "bean"
    for kw in sorted(_GRIND_MAP, key=len, reverse=True):
        if kw in v:
            return _GRIND_MAP[kw]
    return None


def extract_grind_options(product_raw: dict) -> list:
    """
    Extract all distinct grind options from a Shopify product dict.

    Strategy:
    1. Check product.options for an axis named "Grind" (or similar).
    2. Fall back to scanning all variant option1/option2/option3 values.
    """
    options = product_raw.get("options") or []

    # 1. Named option axis
    for opt in options:
        name = (opt.get("name") or "").lower().strip()
        if name in _GRIND_OPTION_NAMES or "grind" in name:
            grinds = []
            for val in (opt.get("values") or []):
                g = _match_grind(val)
                if g and g not in grinds:
                    grinds.append(g)
            if grinds:
                return sorted(grinds)

    # 2. Scan variant option values
    grinds = []
    for v in (product_raw.get("variants") or []):
        for opt_key in ("option1", "option2", "option3"):
            val = v.get(opt_key) or ""
            g = _match_grind(val)
            if g and g not in grinds:
                grinds.append(g)
    return sorted(grinds)


# ── Weight extraction (Shopify) ───────────────────────────────────────────────

def _weight_from_variant(v: dict) -> Optional[int]:
    """
    Parse weight for a single Shopify variant.

    Priority order:
    1. option1 / option2 / option3 parsed as weight string  (most reliable)
    2. variant title parsed as weight string
    3. variant.grams field (least reliable — often set to shipping weight)
    """
    for key in ("option1", "option2", "option3"):
        w = normalize_weight(v.get(key) or "")
        if w:
            return w
    w = normalize_weight(v.get("title") or "")
    if w:
        return w
    raw_grams = v.get("grams") or 0
    try:
        g = int(raw_grams)
        return g if g > 0 else None
    except (ValueError, TypeError):
        return None


# ── Confidence scoring ────────────────────────────────────────────────────────

_OPTIONAL_FLAGS = {
    "altitude_not_found", "missing_tasting_notes",
    "missing_process", "missing_image",
}


def compute_confidence(platform: str, flags: list) -> str:
    blocking = [f for f in flags if f not in _OPTIONAL_FLAGS]
    if platform == "shopify":
        return "high" if not blocking else ("medium" if len(blocking) <= 2 else "low")
    elif platform == "woocommerce":
        return "medium" if len(blocking) <= 3 else "low"
    return "low"


# ── Timestamp ─────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Shopify normalizer ────────────────────────────────────────────────────────

def normalize_shopify_product(raw: dict, roaster: dict) -> Optional[dict]:
    """
    Map a single Shopify /products.json product → unified schema.

    Returns None if the product should be skipped (no valid variants,
    or all variants are sold out).
    """
    title = (raw.get("title") or "").strip()
    if not title:
        return None

    domain = raw.get("_domain", "")
    body_html = raw.get("body_html") or ""
    body_text = strip_html(body_html)
    tags = raw.get("tags") or []
    handle = raw.get("handle") or slugify(title)
    product_type = raw.get("product_type") or ""
    images = raw.get("images") or []
    variants_raw = raw.get("variants") or []

    # ── Image ──────────────────────────────────────────────────────────────
    image_url = None
    if images:
        image_url = clean_image_url(images[0].get("src") or "")

    product_url = f"https://{domain}/products/{handle}"
    roaster_slug = slugify(roaster["name"])
    coffee_slug = slugify(title)

    # ── Grind options ──────────────────────────────────────────────────────
    grind_options = extract_grind_options(raw)

    # ── Enrichment ─────────────────────────────────────────────────────────
    roast_level, roast_found = extract_roast_level([tags, title, body_text])
    tasting_notes = extract_tasting_notes(body_text)
    altitude = extract_altitude(body_text)
    process = extract_process(body_text + " " + " ".join(str(t) for t in tags))
    varietal = extract_varietal(body_text)
    origin = extract_origin(body_text, title)

    # ── Variants ───────────────────────────────────────────────────────────
    normalized_variants = []
    for v in variants_raw:
        weight_g = _weight_from_variant(v)
        price = clean_price(v.get("price"))
        avail = bool(v.get("available", False))

        # Per-variant grind label (from the option value that matched grind)
        grind_label = None
        for opt_key in ("option1", "option2", "option3"):
            val = v.get(opt_key) or ""
            g = _match_grind(val)
            if g:
                grind_label = g
                break

        ppg = round(price / weight_g, 2) if price and weight_g else None
        normalized_variants.append({
            "weight_grams": weight_g,
            "price_inr": price,
            "price_per_gram": ppg,
            "available": avail,
            "grind": grind_label,
        })

    # ── Skip fully sold-out products ───────────────────────────────────────
    if normalized_variants and not any(v["available"] for v in normalized_variants):
        return None

    # ── Primary variant: first available, else first ───────────────────────
    primary = next(
        (v for v in normalized_variants if v["available"]),
        normalized_variants[0] if normalized_variants else None,
    )

    # ── Flags ──────────────────────────────────────────────────────────────
    flags = []
    if not roast_found:
        flags.append("missing_roast_level")
    if not tasting_notes:
        flags.append("missing_tasting_notes")
    if altitude is None:
        flags.append("altitude_not_found")
    elif not (400 <= altitude <= 2500):
        flags.append("altitude_suspicious")
    if not process:
        flags.append("missing_process")
    if not image_url:
        flags.append("missing_image")
    if primary and not primary.get("weight_grams"):
        flags.append("weight_unknown")
    if primary and not primary.get("price_inr"):
        flags.append("price_missing")

    return {
        "product_id": f"{roaster_slug}_{coffee_slug}",
        "roaster_name": roaster["name"],
        "roaster_slug": roaster_slug,
        "roaster_city": roaster["city"],
        "roaster_state": roaster["state"],
        "roaster_lat": roaster["lat"],
        "roaster_lng": roaster["lng"],
        "roaster_website": roaster["website"],
        "coffee_name": title,
        "coffee_slug": coffee_slug,
        "roast_level": roast_level,
        "tasting_notes": tasting_notes,
        "origin": origin,
        "altitude_masl": altitude,
        "process": process,
        "varietal": varietal,
        "weight_grams": primary["weight_grams"] if primary else None,
        "price_inr": primary["price_inr"] if primary else None,
        "price_per_gram": primary["price_per_gram"] if primary else None,
        "currency": "INR",
        "grind_options": grind_options,
        "image_url": image_url,
        "product_url": product_url,
        "available": True,  # at least one variant is available (guaranteed above)
        "variants": normalized_variants,
        "tags": tags,
        "description_raw": body_text[:2000],
        "scrape_confidence": compute_confidence("shopify", flags),
        "scrape_flags": flags,
        "scraped_at": _now_iso(),
    }


# ── WooCommerce normalizer ────────────────────────────────────────────────────

def normalize_woocommerce_product(raw: dict, roaster: dict) -> Optional[dict]:
    """Map a WooCommerce Store API product → unified schema."""
    title = (raw.get("name") or "").strip()
    if not title:
        return None

    domain = raw.get("_domain", "")
    roaster_slug = slugify(roaster["name"])
    coffee_slug = slugify(title)

    desc_html = raw.get("short_description") or raw.get("description") or ""
    body_text = strip_html(desc_html)

    # ── Price ──────────────────────────────────────────────────────────────
    prices = raw.get("prices") or {}
    price_raw = prices.get("price") or "0"
    minor_unit = prices.get("currency_minor_unit", 2)
    currency_code = prices.get("currency_code", "INR")

    price = None
    non_inr = currency_code != "INR"
    if not non_inr:
        try:
            price = float(price_raw) / (10 ** minor_unit)
            price = price if price > 0 else None
        except (ValueError, TypeError):
            pass

    # ── Weight ─────────────────────────────────────────────────────────────
    # Try top-level weight first, then check attributes for a "Weight" axis
    weight_str = str(raw.get("weight") or "")
    weight_g = normalize_weight(weight_str) if weight_str else None

    if not weight_g:
        # WooCommerce variable products store weight in attributes.
        # The API price field is the MINIMUM price, so pair it with the
        # SMALLEST weight variant for a correct price-per-gram ratio.
        for attr in (raw.get("attributes") or []):
            attr_name = (attr.get("name") or "").lower()
            if "weight" in attr_name or "size" in attr_name or "pack" in attr_name:
                terms = attr.get("terms") or []
                weights = []
                for term in terms:
                    t_name = term.get("name", "") if isinstance(term, dict) else str(term)
                    w = normalize_weight(t_name)
                    if w:
                        weights.append(w)
                if weights:
                    weight_g = min(weights)  # smallest → matches min price
                    break

    # ── Image ──────────────────────────────────────────────────────────────
    images = raw.get("images") or []
    image_url = clean_image_url(images[0].get("src") or "") if images else None

    product_url = raw.get("permalink") or ""
    # WooCommerce Store API uses is_in_stock (bool), fallback to in_stock
    available = raw.get("is_in_stock")
    if available is None:
        available = raw.get("in_stock", True)
    available = bool(available)

    # Skip fully sold out
    if not available:
        return None

    # ── Categories / tags → string tags ────────────────────────────────────
    # WooCommerce returns these as lists of dicts: [{id, name, slug, link}, ...]
    cats = raw.get("categories") or []
    woo_tags = raw.get("tags") or []
    tag_names = []
    for item in list(cats) + list(woo_tags):
        if isinstance(item, dict):
            n = item.get("name") or ""
        else:
            n = str(item)
        if n and n not in tag_names:
            tag_names.append(n)

    # ── Grind options from attributes ──────────────────────────────────────
    grind_options = []
    for attr in (raw.get("attributes") or []):
        name = (attr.get("name") or "").lower()
        if "grind" in name or name in _GRIND_OPTION_NAMES:
            for term in (attr.get("terms") or []):
                t_name = term.get("name") or "" if isinstance(term, dict) else str(term)
                g = _match_grind(t_name)
                if g and g not in grind_options:
                    grind_options.append(g)
    grind_options = sorted(grind_options)

    # ── Enrichment ─────────────────────────────────────────────────────────
    roast_level, roast_found = extract_roast_level([tag_names, title, body_text])
    tasting_notes = extract_tasting_notes(body_text)
    altitude = extract_altitude(body_text)
    process = extract_process(title + " " + body_text + " " + " ".join(tag_names))
    varietal = extract_varietal(title + " " + body_text)
    origin = extract_origin(body_text, title)

    ppg = round(price / weight_g, 2) if price and weight_g else None

    flags = []
    if non_inr:
        flags.append("non_inr_price")
    if not roast_found:
        flags.append("missing_roast_level")
    if not tasting_notes:
        flags.append("missing_tasting_notes")
    if altitude is None:
        flags.append("altitude_not_found")
    if not process:
        flags.append("missing_process")
    if not image_url:
        flags.append("missing_image")
    if not weight_g:
        flags.append("weight_unknown")
    if not price:
        flags.append("price_missing")

    return {
        "product_id": f"{roaster_slug}_{coffee_slug}",
        "roaster_name": roaster["name"],
        "roaster_slug": roaster_slug,
        "roaster_city": roaster["city"],
        "roaster_state": roaster["state"],
        "roaster_lat": roaster["lat"],
        "roaster_lng": roaster["lng"],
        "roaster_website": roaster["website"],
        "coffee_name": title,
        "coffee_slug": coffee_slug,
        "roast_level": roast_level,
        "tasting_notes": tasting_notes,
        "origin": origin,
        "altitude_masl": altitude,
        "process": process,
        "varietal": varietal,
        "weight_grams": weight_g,
        "price_inr": price if not non_inr else None,
        "price_per_gram": ppg if not non_inr else None,
        "currency": "INR",
        "grind_options": grind_options,
        "image_url": image_url,
        "product_url": product_url,
        "available": True,
        "variants": [],
        "tags": tag_names,
        "description_raw": body_text[:2000],
        "scrape_confidence": compute_confidence("woocommerce", flags),
        "scrape_flags": flags,
        "scraped_at": _now_iso(),
    }


# ── Custom scraper normalizer ─────────────────────────────────────────────────

def normalize_custom_product(raw: dict, roaster: dict) -> Optional[dict]:
    """Map a custom-scraped product dict → unified schema."""
    title = (raw.get("title") or "").strip()
    if not title:
        return None

    roaster_slug = slugify(roaster["name"])
    coffee_slug = slugify(title)

    body_text = strip_html(raw.get("body_html") or "")
    price = raw.get("price_raw")
    if isinstance(price, str):
        price = clean_price(price)

    weight_g = normalize_weight(raw.get("weight_raw")) if raw.get("weight_raw") else None
    image_url = clean_image_url(raw.get("image_raw") or "") or None
    product_url = raw.get("_product_url") or ""
    available = bool(raw.get("available", True))

    if not available:
        return None

    ppg = round(price / weight_g, 2) if price and weight_g else None

    roast_level, roast_found = extract_roast_level([title, body_text])
    tasting_notes = extract_tasting_notes(body_text)
    altitude = extract_altitude(body_text)
    process = extract_process(body_text)
    varietal = extract_varietal(body_text)
    origin = extract_origin(body_text, title)

    flags = []
    if not roast_found:
        flags.append("missing_roast_level")
    if not tasting_notes:
        flags.append("missing_tasting_notes")
    if altitude is None:
        flags.append("altitude_not_found")
    if not process:
        flags.append("missing_process")
    if not image_url:
        flags.append("missing_image")
    if not weight_g:
        flags.append("weight_unknown")
    if not price:
        flags.append("price_missing")

    return {
        "product_id": f"{roaster_slug}_{coffee_slug}",
        "roaster_name": roaster["name"],
        "roaster_slug": roaster_slug,
        "roaster_city": roaster["city"],
        "roaster_state": roaster["state"],
        "roaster_lat": roaster["lat"],
        "roaster_lng": roaster["lng"],
        "roaster_website": roaster["website"],
        "coffee_name": title,
        "coffee_slug": coffee_slug,
        "roast_level": roast_level,
        "tasting_notes": tasting_notes,
        "origin": origin,
        "altitude_masl": altitude,
        "process": process,
        "varietal": varietal,
        "weight_grams": weight_g,
        "price_inr": price,
        "price_per_gram": ppg,
        "currency": "INR",
        "grind_options": [],
        "image_url": image_url,
        "product_url": product_url,
        "available": True,
        "variants": [],
        "tags": raw.get("tags") or [],
        "description_raw": body_text[:2000],
        "scrape_confidence": "low",
        "scrape_flags": flags,
        "scraped_at": _now_iso(),
    }
