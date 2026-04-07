"""
Phase 3: Roaster Profile Enrichment.
For each verified roaster, extract logo, tagline, about blurb,
founding year, sourcing regions, specialties, and social links.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin
from bs4 import BeautifulSoup

MAX_WORKERS = 8
from utils import fetch_page

# ── Indian coffee regions ─────────────────────────────────────────────────────

INDIAN_COFFEE_REGIONS = [
    "Chikmagalur", "Chikkamagaluru", "Coorg", "Kodagu", "Baba Budan",
    "Araku", "Araku Valley", "Wayanad", "Nilgiris", "Nilgiri",
    "Yercaud", "Shevaroy", "Kodaikanal", "Pulney", "Palani",
    "Manjarabad", "Hassan", "Sakleshpur",
    "Koraput", "Kalahandi",
    "Bababudangiris", "Biligirirangan", "BR Hills",
    "Mudigere", "Suntikoppa", "Somwarpet",
    # International
    "Ethiopia", "Colombia", "Kenya", "Rwanda", "Guatemala", "Brazil",
    "Sumatra", "Vietnam", "Panama",
]

SPECIALTY_TERMS = {
    "small-batch": ["small batch", "small-batch", "micro batch", "micro-batch"],
    "single-origin": ["single origin", "single-origin"],
    "direct-trade": ["direct trade", "direct-trade", "farm to cup", "farm-to-cup"],
    "organic": ["organic", "certified organic"],
    "fair-trade": ["fair trade", "fair-trade", "fairtrade"],
    "estate-grown": ["estate grown", "estate-grown", "own estate", "our estate", "our farm"],
    "specialty-grade": ["specialty grade", "specialty coffee", "speciality coffee"],
    "women-owned": ["women owned", "women-owned", "woman-owned", "all-women"],
    "sustainability": ["sustainable", "sustainability", "biodiversity", "shade-grown", "shade grown"],
    "q-grader": ["q grader", "q-grader", "certified q"],
}

FOUNDING_PATTERN = re.compile(
    r"(?:founded|established|started|since|est\.?|born)\s*(?:in\s+)?(\d{4})",
    re.IGNORECASE,
)

SOCIAL_PATTERNS = {
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[\w.]+/?"),
    "twitter": re.compile(r"https?://(?:www\.)?(twitter|x)\.com/[\w]+/?"),
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/[\w.]+/?"),
    "youtube": re.compile(r"https?://(?:www\.)?youtube\.com/[\w@]+/?"),
    "linkedin": re.compile(r"https?://(?:www\.)?linkedin\.com/company/[\w-]+/?"),
}


def _extract_logo(base_url, soup):
    """Extract the roaster's logo URL."""
    # Strategy 1: apple-touch-icon (best quality)
    for rel in ["apple-touch-icon", "apple-touch-icon-precomposed"]:
        link = soup.find("link", rel=lambda r: r and rel in (r if isinstance(r, list) else [r]))
        if link and link.get("href"):
            return urljoin(base_url, link["href"])

    # Strategy 2: OG image
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        return urljoin(base_url, og["content"])

    # Strategy 3: First <img> in <header>
    header = soup.find("header") or soup.find("nav")
    if header:
        img = header.find("img")
        if img and img.get("src"):
            return urljoin(base_url, img["src"])

    # Strategy 4: favicon
    link = soup.find("link", rel=lambda r: r and "icon" in (r if isinstance(r, list) else [r]))
    if link and link.get("href"):
        return urljoin(base_url, link["href"])

    return None


def _extract_tagline(soup):
    """Extract a short tagline from meta description."""
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        text = meta["content"].strip()
        if 10 < len(text) < 200:
            return text

    og = soup.find("meta", property="og:description")
    if og and og.get("content"):
        text = og["content"].strip()
        if 10 < len(text) < 200:
            return text

    return None


def _find_about_url(base_url, soup):
    """Find the About/Our Story page URL from navigation links."""
    about_patterns = ["/about", "/our-story", "/story", "/pages/about", "/pages/our-story"]
    text_patterns = ["about", "our story", "our journey", "the story"]

    for a in soup.find_all("a", href=True):
        href = a["href"].lower()
        text = a.get_text(strip=True).lower()
        if any(p in href for p in about_patterns) or any(p in text for p in text_patterns):
            return urljoin(base_url, a["href"])
    return None


def _extract_about_blurb(about_url):
    """Fetch about page and extract the first 1-3 meaningful paragraphs."""
    status, html = fetch_page(about_url)
    if status != 200 or not html:
        return None

    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup.find("article") or soup
    paragraphs = []

    for p in main.find_all("p"):
        text = p.get_text(strip=True)
        if len(text) > 50:
            paragraphs.append(text)
        if len(" ".join(paragraphs)) > 1000:
            break

    blurb = " ".join(paragraphs[:3])
    if blurb and len(blurb) > 50:
        return blurb[:1500]
    return None


def _extract_founding_year(html):
    """Search for founding year near founding-related keywords."""
    match = FOUNDING_PATTERN.search(html)
    if match:
        year = int(match.group(1))
        if 1900 <= year <= 2026:
            return year
    return None


def _extract_sourcing_regions(html):
    """Find mentions of known coffee-growing regions."""
    html_lower = html.lower()
    found = []
    for region in INDIAN_COFFEE_REGIONS:
        if region.lower() in html_lower and region not in found:
            found.append(region)
    return found if found else None


def _extract_specialties(html):
    """Extract identity tags that describe the roaster's philosophy."""
    html_lower = html.lower()
    found = []
    for tag, patterns in SPECIALTY_TERMS.items():
        if any(p in html_lower for p in patterns):
            found.append(tag)
    return found if found else None


def _extract_social_links(html):
    """Scan for social media URLs."""
    links = {}
    for platform, pattern in SOCIAL_PATTERNS.items():
        match = pattern.search(html)
        if match:
            links[platform] = match.group(0)
    return links if links else None


def enrich_roaster(candidate, verification):
    """
    Enrich a single verified roaster. Makes at most 2 HTTP requests
    (homepage is reused if already cached, plus 1 about page).
    """
    website = candidate.get("website", "")
    result = {
        "place_id": candidate["place_id"],
        "logo_url": None,
        "tagline": None,
        "about_blurb": None,
        "founding_year": None,
        "sourcing_regions": None,
        "specialties": None,
        "social_links": None,
        "enrichment_flags": [],
    }

    # Fetch homepage
    status, html = fetch_page(website)
    if status != 200 or not html:
        result["enrichment_flags"] = ["homepage_unreachable"]
        return result

    soup = BeautifulSoup(html, "lxml")

    # Logo
    result["logo_url"] = _extract_logo(website, soup)
    if not result["logo_url"]:
        result["enrichment_flags"].append("missing_logo")

    # Tagline
    result["tagline"] = _extract_tagline(soup)
    if not result["tagline"]:
        result["enrichment_flags"].append("missing_tagline")

    # Social links (from homepage, especially footer)
    result["social_links"] = _extract_social_links(html)
    if not result["social_links"]:
        result["enrichment_flags"].append("missing_social")

    # Founding year (check homepage first)
    result["founding_year"] = _extract_founding_year(html)

    # Sourcing regions (from homepage)
    result["sourcing_regions"] = _extract_sourcing_regions(html)

    # Specialties (from homepage)
    result["specialties"] = _extract_specialties(html)

    # About page (one additional request)
    about_url = _find_about_url(website, soup)
    if about_url:
        result["about_blurb"] = _extract_about_blurb(about_url)
        time.sleep(1)

        # If founding year not found on homepage, try about page
        if not result["founding_year"] and result["about_blurb"]:
            result["founding_year"] = _extract_founding_year(result["about_blurb"])

        # Augment sourcing regions from about page
        if about_url:
            _, about_html = fetch_page(about_url)
            if about_html:
                extra_regions = _extract_sourcing_regions(about_html)
                if extra_regions:
                    existing = result["sourcing_regions"] or []
                    merged = list(dict.fromkeys(existing + extra_regions))
                    result["sourcing_regions"] = merged

    if not result["about_blurb"]:
        result["enrichment_flags"].append("missing_about")
    if not result["founding_year"]:
        result["enrichment_flags"].append("missing_founding_year")
    if not result["sourcing_regions"]:
        result["enrichment_flags"].append("missing_sourcing_regions")

    return result


def _enrich_one(args):
    """Worker: enrich a single roaster. Returns (candidate, result)."""
    candidate, verification = args
    try:
        return candidate, enrich_roaster(candidate, verification)
    except Exception as e:
        return candidate, {
            "place_id": candidate["place_id"],
            "enrichment_flags": [f"error: {e}"],
        }


def run_enrichment(candidates, verifications):
    """
    Phase 3 entry point. Enrich all verified roasters in parallel.
    """
    verify_map = {v["place_id"]: v for v in verifications}
    verified_candidates = [
        c for c in candidates
        if verify_map.get(c["place_id"], {}).get("classification") in ("VERIFIED", "VERIFIED_WHATSAPP")
    ]

    total = len(verified_candidates)
    results = []
    done = [0]

    tasks = [
        (c, verify_map.get(c["place_id"], {}))
        for c in verified_candidates
    ]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_enrich_one, t): t for t in tasks}

        for future in as_completed(futures):
            candidate, result = future.result()
            done[0] += 1
            name = candidate["name"][:40]

            markers = []
            markers.append("logo " + ("✓" if result.get("logo_url") else "✗"))
            markers.append("tagline " + ("✓" if result.get("tagline") else "✗"))
            markers.append("about " + ("✓" if result.get("about_blurb") else "✗"))
            markers.append("year " + ("✓" if result.get("founding_year") else "✗"))
            markers.append("social " + ("✓" if result.get("social_links") else "✗"))
            print(f"  [{done[0]}/{total}] {name:40} ... {' '.join(markers)}")

            results.append(result)

    return results
