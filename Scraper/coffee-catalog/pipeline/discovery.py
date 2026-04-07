"""
Phase 1: Discover coffee roasters via multiple sources:
  1A. Google Places Text Search (physical roasteries + cafes)
  1B. Seed list (known D2C brands that Google Places misses)

Deduplicates by website domain, collapses multi-branch brands.
"""

import json
import os
import re
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse
from utils import is_real_website, clean_url, infer_state, infer_city

MAX_WORKERS = 8

# Expanded query templates — not just "roasters" but also D2C-friendly terms
QUERY_TEMPLATES = [
    "coffee roasters {}",
    "coffee roastery {}",
    "specialty coffee {}",
    "buy coffee beans {}",
]

CITIES = [
    # Tier 1: Metros
    "New Delhi", "Mumbai", "Bengaluru", "Chennai", "Hyderabad",
    "Kolkata", "Pune", "Ahmedabad",
    # Tier 2: State capitals + major cities
    "Jaipur", "Lucknow", "Chandigarh", "Bhopal", "Indore",
    "Kochi", "Thiruvananthapuram", "Bhubaneswar", "Guwahati",
    "Dehradun", "Raipur", "Ranchi", "Patna", "Panaji",
    "Visakhapatnam", "Coimbatore", "Madurai", "Nagpur",
    "Vadodara", "Surat", "Mangalore", "Mysuru",
    # Tier 3: Coffee belt
    "Chikmagalur", "Coorg", "Madikeri", "Kodaikanal",
    "Wayanad", "Kalpetta", "Auroville", "Sakleshpur",
    # Tier 3: Northeast
    "Shillong", "Kohima", "Imphal", "Aizawl", "Gangtok",
    "Agartala", "Itanagar", "Dimapur",
    # Tier 3: NCR satellites
    "Noida", "Gurgaon", "Panchkula",
]


def _search_places(query, api_key):
    """Run a Google Places Text Search and paginate through all results."""
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "region": "in", "key": api_key}
    results = []
    while True:
        resp = requests.get(url, params=params, timeout=10).json()
        results.extend(resp.get("results", []))
        token = resp.get("next_page_token")
        if not token:
            break
        # Google requires a short delay before using next_page_token
        time.sleep(2)
        params = {"pagetoken": token, "key": api_key}
    return results


def _get_place_details(place_id, api_key):
    """Fetch detailed info (website, address) for a single place."""
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,formatted_address,geometry,website,url,types,"
                  "business_status,rating,user_ratings_total",
        "key": api_key,
    }
    resp = requests.get(url, params=params, timeout=10).json()
    return resp.get("result", {})


def _normalize_candidate(place, city_searched, details=None):
    """Merge Text Search result + Place Details into a candidate dict."""
    d = details or {}
    geo = place.get("geometry", {}).get("location", {})
    address = d.get("formatted_address") or place.get("formatted_address", "")
    website = d.get("website") or place.get("website")

    return {
        "place_id": place["place_id"],
        "name": place.get("name", ""),
        "brand": re.split(r"\s*[|–—\-]\s*", place.get("name", ""))[0].strip(),
        "address": address,
        "lat": geo.get("lat", 0),
        "lng": geo.get("lng", 0),
        "website": clean_url(website) if website and is_real_website(website) else None,
        "google_maps_url": d.get("url") or place.get("url"),
        "types": place.get("types", []),
        "rating": place.get("rating"),
        "rating_count": place.get("user_ratings_total") or d.get("user_ratings_total"),
        "business_status": place.get("business_status", "UNKNOWN"),
        "city_searched": city_searched,
        "city": infer_city(address, city_searched),
        "state": infer_state(address, city_searched),
    }


def _deduplicate(candidates):
    """Remove duplicates by place_id."""
    seen = set()
    out = []
    for c in candidates:
        pid = c["place_id"]
        if pid not in seen:
            seen.add(pid)
            out.append(c)
    return out


def _has_ecommerce_domain(website):
    """Check if a website URL looks like a real e-commerce site (not a Google Maps redirect)."""
    if not website:
        return False
    try:
        domain = urlparse(website).hostname or ""
        # Reject Google Maps URLs and social media
        if "google.com" in domain or "goo.gl" in domain:
            return False
        return True
    except Exception:
        return False


def _collapse_brands(candidates):
    """
    Collapse multi-branch brands into a single entry per brand.
    Priority: entry with a real e-commerce website > roastery type > most reviews.
    """
    brand_map = {}
    for c in candidates:
        key = c["brand"].lower()
        existing = brand_map.get(key)
        if not existing:
            brand_map[key] = c
            continue

        new_has_site = _has_ecommerce_domain(c.get("website"))
        old_has_site = _has_ecommerce_domain(existing.get("website"))

        # Prefer the entry with a real website
        if new_has_site and not old_has_site:
            brand_map[key] = c
        elif old_has_site and not new_has_site:
            pass  # keep existing
        else:
            # Both have (or lack) websites — prefer roastery type, then most reviews
            new_is_roastery = "coffee_roastery" in c.get("types", [])
            old_is_roastery = "coffee_roastery" in existing.get("types", [])
            if new_is_roastery and not old_is_roastery:
                brand_map[key] = c
            elif not old_is_roastery and not new_is_roastery:
                if (c.get("rating_count") or 0) > (existing.get("rating_count") or 0):
                    brand_map[key] = c

    return list(brand_map.values())


def _load_seeds():
    """
    Load the seed list of known D2C roasters that Google Places won't find.
    These get injected into the candidate list alongside Places results.
    """
    seeds_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "input", "seeds.json"
    )
    if not os.path.exists(seeds_path):
        return []

    with open(seeds_path, encoding="utf-8") as f:
        seeds = json.load(f)

    candidates = []
    for s in seeds:
        candidates.append({
            "place_id": f"seed_{slugify_simple(s['name'])}",
            "name": s["name"],
            "brand": s["name"],
            "address": f"{s.get('city', '')}, {s.get('state', '')}",
            "lat": s.get("lat", 0),
            "lng": s.get("lng", 0),
            "website": clean_url(s["website"]),
            "google_maps_url": None,
            "types": ["seed_d2c"],
            "rating": None,
            "rating_count": None,
            "business_status": "OPERATIONAL",
            "city_searched": s.get("city"),
            "city": s.get("city"),
            "state": s.get("state"),
        })
    return candidates


def slugify_simple(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _dedup_by_domain(candidates):
    """
    Deduplicate candidates by website domain.
    Seeds take priority over Places results (seeds have verified URLs).
    """
    domain_map = {}
    for c in candidates:
        website = c.get("website")
        if not website:
            # No website — keep as-is (will be filtered in Phase 2)
            domain_map[c.get("place_id", id(c))] = c
            continue
        try:
            domain = urlparse(website).hostname.replace("www.", "")
        except Exception:
            domain = website
        existing = domain_map.get(domain)
        if not existing:
            domain_map[domain] = c
        elif "seed" in (c.get("place_id") or ""):
            # Seed entries take priority — they have correct URLs
            domain_map[domain] = c
    return list(domain_map.values())


def run_discovery(api_key):
    """
    Phase 1 entry point.
    Combines Google Places search + seed list of known D2C roasters.
    Returns list of candidate dicts, deduplicated by website domain.
    """
    # ── 1A. Google Places search (parallel) ─────────────────────
    print("\n  Phase 1A: Google Places search (parallel)")
    all_raw = []
    queries = [
        (template.format(city), city)
        for city in CITIES
        for template in QUERY_TEMPLATES
    ]
    total_queries = len(queries)
    done = [0]  # mutable counter for thread-safe printing

    def _run_query(args):
        query, city = args
        try:
            results = _search_places(query, api_key)
            return [(r, city) for r in results], query, len(results), None
        except Exception as e:
            return [], query, 0, str(e)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_run_query, q): q for q in queries}
        for future in as_completed(futures):
            pairs, query, count, err = future.result()
            done[0] += 1
            if err:
                print(f"  [{done[0]}/{total_queries}] {query:45} ... ERROR: {err}")
            else:
                print(f"  [{done[0]}/{total_queries}] {query:45} ... {count} results")
            for r, city in pairs:
                all_raw.append(_normalize_candidate(r, city))

    print(f"\n  Total raw Places candidates: {len(all_raw)}")

    # Deduplicate by place_id
    deduped = _deduplicate(all_raw)
    print(f"  After place_id dedup: {len(deduped)}")

    # Drop candidates with no website — no website, no business
    has_website = [c for c in deduped if c.get("website")]
    no_website = len(deduped) - len(has_website)
    print(f"  Dropped {no_website} candidates with no website, kept {len(has_website)}")
    deduped = has_website

    # Collapse multi-branch brands (prefer entries with real websites)
    collapsed = _collapse_brands(deduped)
    print(f"  After brand collapse: {len(collapsed)}")

    # Filter out closed businesses
    active = [c for c in collapsed if c.get("business_status") != "CLOSED_PERMANENTLY"]
    print(f"  After removing closed: {len(active)}")

    # ── 1B. Seed list (known D2C roasters) ────────────────────────
    seeds = _load_seeds()
    if seeds:
        print(f"\n  Phase 1B: Loaded {len(seeds)} seed roasters")

    # ── Merge and deduplicate by website domain ───────────────────
    # Seeds go first so they take priority in domain dedup
    merged = seeds + active
    final = _dedup_by_domain(merged)
    print(f"\n  Final candidates (Places + Seeds, deduped by domain): {len(final)}")

    return final
