# Indian Specialty Coffee Aggregator — Roaster Catalog Specification

**Version:** 1.0  
**Date:** April 2, 2026  
**Status:** Ready for Claude Code Implementation  
**Component:** Roaster Discovery, Verification & Profile Enrichment Pipeline  
**Produces:** `verified_roasters_catalog.json` (consumed by SCRAPER_SPEC.md and UI_SPEC.md)

---

## Core Idea

Before you can scrape products or build a discovery UI, you need to know *who the roasters are*. India's specialty coffee ecosystem has no central registry. Roasters are scattered across 28 states, running Shopify stores, WooCommerce sites, or hand-coded pages. Some are heritage brands roasting since 1910. Some launched last year. Many have "Coffee Roasters" in their Google Maps listing but no website, or a website but no shop, or a shop but it only sells chai.

This pipeline is the foundation. It programmatically discovers every specialty coffee roaster in India via Google Places, visits each website to verify it has a functioning online bean shop, then enriches each verified entry with a roaster profile — about blurb, logo, sourcing regions, social links, founding year — so that the downstream scraper and UI have rich, structured data to work with.

**This document specifies the discovery and catalog pipeline only.** It outputs a verified roaster catalog JSON file. The scraper pipeline (SCRAPER_SPEC.md) consumes this file to extract individual coffee products. The UI (UI_SPEC.md) uses the roaster profile fields for roaster profile pages.

Every roaster receives identical programmatic treatment. No manual exceptions. No assumptions. If a signal isn't found in the HTML, the field is null.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Discovery via Google Places](#2-phase-1-discovery-via-google-places)
3. [Phase 2: Website Verification](#3-phase-2-website-verification)
4. [Phase 3: Roaster Profile Enrichment](#4-phase-3-roaster-profile-enrichment)
5. [Phase 4: Catalog Assembly](#5-phase-4-catalog-assembly)
6. [Output Schema](#6-output-schema)
7. [Output File Specifications](#7-output-file-specifications)
8. [Error Handling & Logging](#8-error-handling--logging)
9. [Known Limitations & Edge Cases](#9-known-limitations--edge-cases)
10. [Implementation Checklist](#10-implementation-checklist)
11. [Testing & Validation](#11-testing--validation)

---

## 1. Architecture Overview

### 1.1 Pipeline Summary

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: DISCOVERY                                         │
│  Google Places Text Search API                              │
│  Sweep 45+ cities × 2 query templates                       │
│  Deduplicate by place_id, collapse multi-branch brands      │
│  → discovery.json (~100-200 raw candidates)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: WEBSITE VERIFICATION                              │
│  For each candidate with a website URL:                     │
│  - Fetch homepage (does it load?)                           │
│  - Find shop/store/collections links                        │
│  - Check for: coffee products + prices + cart mechanism     │
│  - Classify: VERIFIED / WEBSITE_DEAD / NO_SHOP / etc.      │
│  → verification.json (~30-45 verified)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: ROASTER PROFILE ENRICHMENT                        │
│  For each VERIFIED roaster:                                 │
│  - Fetch About page → extract about blurb, founding year    │
│  - Fetch homepage → extract logo URL, tagline               │
│  - Scan footer → extract social links (IG, Twitter, FB)     │
│  - Parse product pages → infer sourcing regions             │
│  - Detect e-commerce platform (Shopify / Woo / Custom)      │
│  → enrichment.json                                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: CATALOG ASSEMBLY                                  │
│  Merge discovery + verification + enrichment                │
│  → verified_roasters_catalog.json (final output)            │
│  → verified_roasters_catalog.csv (flat spreadsheet)         │
│  → catalog_log.json (per-roaster pipeline log)              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Principles

- **Fully programmatic.** Every roaster is discovered, verified, and enriched through the same code path. No roaster is manually added or manually verified.
- **Consistent treatment.** The same heuristics are applied to every website. If the homepage doesn't load, the roaster is dropped — no "but I know they're real" overrides.
- **Fail gracefully per roaster.** If enrichment fails for one roaster (About page doesn't parse), the roaster is still included with null profile fields. No single failure kills the run.
- **Auditable.** Every classification decision is logged with evidence: which URLs were fetched, what signals were found or not found, and why the roaster was verified or dropped.
- **Idempotent.** Running the pipeline twice on the same day produces the same output (modulo sites that went up or down between runs).

### 1.3 Runtime Environment

- **Execution target:** Claude Code (unrestricted outbound HTTP access)
- **Language:** Python 3.10+
- **Key dependencies:** `requests`, `beautifulsoup4`, `lxml`, `json`, `csv`, `re`, `urllib`
- **Google API dependency:** Google Places API key required for Phase 1 (Text Search + Place Details)
- **No browser automation.** All HTTP-based. JS-rendered content is skipped and flagged.

### 1.4 Directory Structure

```
coffee-catalog/
├── input/
│   └── (none — this pipeline discovers from scratch)
│
├── output/
│   ├── verified_roasters_catalog.json     ← PRIMARY OUTPUT (consumed by scraper + UI)
│   ├── verified_roasters_catalog.csv      ← Flat spreadsheet for manual review
│   ├── catalog_log.json                   ← Per-roaster pipeline log
│   ├── discovery.json                     ← Phase 1 intermediate (all candidates)
│   ├── verification.json                  ← Phase 2 intermediate (crawl results)
│   └── enrichment.json                    ← Phase 3 intermediate (profile data)
│
├── pipeline/
│   ├── main.py                            ← Entry point: orchestrates all 4 phases
│   ├── discovery.py                       ← Phase 1: Google Places search
│   ├── verification.py                    ← Phase 2: Website crawl + e-commerce check
│   ├── enrichment.py                      ← Phase 3: Profile extraction
│   ├── assembler.py                       ← Phase 4: Merge into final catalog
│   └── utils.py                           ← Slugify, URL cleaning, regex helpers
│
├── requirements.txt
└── README.md
```

---

## 2. Phase 1: Discovery via Google Places

### 2.1 Objective

Find every business in India that Google classifies as or near a coffee roaster. Cast a wide net — Phase 2 will filter aggressively.

### 2.2 Search Strategy

For each city, run two query templates:

```python
QUERY_TEMPLATES = [
    "coffee roasters {}",
    "coffee roastery {}",
]
```

### 2.3 City List

Cover all 28 states and 8 union territories. The list is deliberately over-inclusive — most tier-3 cities will return zero results, but that's cheap and ensures no state is missed.

```python
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

    # Tier 3: Northeast India
    "Shillong", "Kohima", "Imphal", "Aizawl", "Gangtok",
    "Agartala", "Itanagar", "Dimapur",

    # Tier 3: NCR satellites + Chandigarh tri-city
    "Noida", "Gurgaon", "Panchkula",
]
```

**Total: ~45 cities × 2 queries = ~90 API calls** (plus pagination tokens).

### 2.4 Google Places API Calls

**Text Search:**

```python
def search_places(query, api_key):
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "region": "in", "key": api_key}
    results = []
    while True:
        resp = requests.get(url, params=params, timeout=10).json()
        results.extend(resp.get("results", []))
        token = resp.get("next_page_token")
        if not token:
            break
        params = {"pagetoken": token, "key": api_key}
        time.sleep(2)  # Required delay for next_page_token
    return results
```

**Place Details (per candidate):**

```python
def get_place_details(place_id, api_key):
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,formatted_address,geometry,website,url,types,"
                  "business_status,rating,user_ratings_total,photos",
        "key": api_key,
    }
    return requests.get(url, params=params, timeout=10).json().get("result", {})
```

### 2.5 Deduplication

Deduplicate by `place_id` (identical Places API results from overlapping city queries).

### 2.6 Multi-Branch Brand Collapse

Many roasters operate multiple café locations. Blue Tokai alone has 100+ listings on Google Maps. The goal is **one entry per brand**, not one per storefront.

**Collapse logic:**

1. Strip location suffixes from names: split on `|`, `–`, `—`, `-` and take the first segment.
2. Group by normalized brand name (lowercased, stripped).
3. Within each group, prefer the entry that has `"coffee_roastery"` in its `types` array.
4. If no roastery-typed entry exists, keep the entry with the most reviews (likely the flagship).

```python
def collapse_brands(places):
    brand_map = {}
    for p in places:
        brand = re.split(r"\s*[|–—-]\s*", p["name"])[0].strip()
        brand_key = brand.lower()
        existing = brand_map.get(brand_key)
        if not existing:
            brand_map[brand_key] = p
        else:
            new_is_roastery = "coffee_roastery" in p.get("types", [])
            old_is_roastery = "coffee_roastery" in existing.get("types", [])
            if new_is_roastery and not old_is_roastery:
                brand_map[brand_key] = p
            elif not old_is_roastery and not new_is_roastery:
                if (p.get("rating_count") or 0) > (existing.get("rating_count") or 0):
                    brand_map[brand_key] = p
    return list(brand_map.values())
```

### 2.7 Social Media URL Filtering

Google Places sometimes returns a Facebook or Instagram page as the `website` field. These are not real websites.

```python
SOCIAL_DOMAINS = {"facebook.com", "instagram.com", "twitter.com", "youtube.com", "linkedin.com"}

def is_real_website(url):
    domain = urlparse(url).netloc.lower().replace("www.", "")
    return domain not in SOCIAL_DOMAINS
```

If the only "website" is a social media URL, set `website` to `null`.

### 2.8 Phase 1 Output: `discovery.json`

Array of candidate roasters:

```json
[
  {
    "place_id": "ChIJ...",
    "name": "Blue Tokai Coffee Roasters",
    "brand": "Blue Tokai Coffee Roasters",
    "address": "Full formatted address",
    "lat": 28.4595,
    "lng": 77.0266,
    "website": "https://bluetokaicoffee.com",
    "google_maps_url": "https://maps.google.com/?cid=...",
    "types": ["coffee_roastery", "cafe", "food_store"],
    "rating": 4.6,
    "rating_count": 1200,
    "business_status": "OPERATIONAL",
    "city_searched": "New Delhi",
    "state": "Delhi"
  }
]
```

**Expected volume:** 80–200 candidates after deduplication and brand collapse. Most will be cafés, not roaster-vendors. Phase 2 filters them.

---

## 3. Phase 2: Website Verification

### 3.1 Objective

For every candidate that has a website URL, determine whether the site has a functioning online store where a consumer can buy roasted coffee beans.

### 3.2 Verification Criteria

A roaster is **VERIFIED** only if all three conditions are met:

1. **Working website.** The homepage returns HTTP 200 (after following redirects).
2. **Coffee products listed.** The site contains pages with coffee product listings — roasted beans or ground coffee with names, descriptions, and prices in INR.
3. **Cart/order mechanism.** The site has some way to place an order — an "Add to Cart" button, a Shopify/WooCommerce checkout, an Instamojo payment link, or at minimum a WhatsApp order link.

### 3.3 Crawl Strategy per Candidate

```
1. GET homepage
   └── Does it return 200? ─── No → WEBSITE_DEAD
                            │
                            Yes
                            │
2. Parse homepage HTML for shop links
   Look for <a> tags with href matching:
     /shop, /store, /collections, /products, /buy, /order,
     /coffee, /beans, /roasted, /blends, /single-origin
   Also check nav text: "Shop", "Store", "Buy", "Products", "Coffee"
                            │
3. GET best candidate shop URL
   └── Does it return 200? ─── No → try next candidate, or NO_SHOP_PAGE
                            │
                            Yes
                            │
4. Check e-commerce signals on shop page:
   a) Coffee terms (≥2 distinct): coffee, beans, roast, blend, arabica,
      robusta, filter, espresso, ground, single-origin, whole-bean
   b) Price patterns: ₹ / Rs / INR followed by digits
   c) Cart signals: "Add to Cart", cdn.shopify.com, woocommerce,
      instamojo, razorpay, wa.me/
                            │
5. Classify:
   - All 3 signals present → VERIFIED
   - Missing coffee terms  → NO_COFFEE_PRODUCTS
   - Missing prices        → NO_PRICES
   - Missing cart           → NO_CART_MECHANISM
```

### 3.4 Classification Enum

| Classification | Meaning | Included in output? |
|---|---|---|
| `VERIFIED` | All 3 signals confirmed | Yes — verified roasters |
| `VERIFIED_WHATSAPP` | Products + prices + WhatsApp order link (no cart widget) | Yes — acceptable for MVP |
| `WEBSITE_DEAD` | Homepage did not return HTTP 200 | No — dropped with reason |
| `NO_WEBSITE` | No website URL from Google Places | No — dropped with reason |
| `NO_SHOP_PAGE` | Homepage loads but no shop/products links found | No — dropped with reason |
| `NO_COFFEE_PRODUCTS` | Shop page found but no coffee-specific product terms | No — dropped with reason |
| `NO_PRICES` | Coffee terms found but no INR price patterns | No — dropped with reason |
| `NO_CART_MECHANISM` | Products and prices found but no way to order | No — dropped with reason |

### 3.5 E-Commerce Platform Detection

While verifying, also detect the platform for downstream use by the scraper:

```python
def detect_platform(html):
    html_lower = html.lower()
    if "cdn.shopify.com" in html_lower or "shopify." in html_lower:
        return "Shopify"
    if "woocommerce" in html_lower or "wp-content/plugins/woocommerce" in html_lower:
        return "WooCommerce"
    if "instamojo" in html_lower:
        return "Instamojo"
    return "Custom"
```

### 3.6 Phase 2 Output: `verification.json`

```json
[
  {
    "place_id": "ChIJ...",
    "name": "Blue Tokai Coffee Roasters",
    "website": "https://bluetokaicoffee.com",
    "homepage_status": 200,
    "shop_url": "https://bluetokaicoffee.com/collections/roasted-and-ground-coffee-beans",
    "classification": "VERIFIED",
    "platform": "Shopify",
    "evidence": {
      "coffee_terms_found": ["coffee", "beans", "roast", "single-origin", "arabica"],
      "price_examples": ["₹449", "₹595", "₹799"],
      "cart_signals": ["cdn.shopify.com", "Add to Cart"],
      "shop_links_found": [
        "https://bluetokaicoffee.com/collections/roasted-and-ground-coffee-beans",
        "https://bluetokaicoffee.com/collections/capsules"
      ]
    }
  }
]
```

---

## 4. Phase 3: Roaster Profile Enrichment

### 4.1 Objective

For each VERIFIED roaster, extract a rich profile from their website: who they are, what they look like, where they source from, and how to find them on social media. This data powers the Roaster Profile Page in the UI.

### 4.2 Fields to Extract

| Field | Source | Extraction Method |
|---|---|---|
| `logo_url` | Homepage HTML | See 4.3 |
| `tagline` | Homepage HTML | See 4.4 |
| `about_blurb` | About page HTML | See 4.5 |
| `founding_year` | About page / homepage | See 4.6 |
| `sourcing_regions` | Product descriptions / about page | See 4.7 |
| `specialties` | Homepage / about page | See 4.8 |
| `social_links` | Homepage footer | See 4.9 |

All fields are **nullable**. If extraction fails, the field is set to `null` and a flag is logged. A roaster is never dropped because enrichment fails — it just gets a thinner profile.

### 4.3 Logo URL Extraction

The logo is the single most important visual identity element. The pipeline tries multiple strategies in order:

**Strategy 1 — OG Image:** Check for `<meta property="og:image">` or `<meta property="og:logo">`. Many Shopify sites use their logo as the OG image.

**Strategy 2 — Favicon / Apple Touch Icon:** Check for:
```html
<link rel="icon" href="...">
<link rel="apple-touch-icon" href="...">
<link rel="shortcut icon" href="...">
```
The `apple-touch-icon` is usually higher resolution (180×180 or 512×512) and preferred over the 16×16 favicon.

**Strategy 3 — Header/Nav image:** Parse the `<header>` or `<nav>` element for the first `<img>` tag. On most sites, this is the logo. Validate by checking: does the `alt` text or `src` filename contain the brand name or terms like "logo"?

**Strategy 4 — Shopify-specific:** For Shopify sites, the logo is often at a predictable CDN path referenced in the theme's `<header>`. Look for `<img>` tags with `src` containing `cdn.shopify.com` inside the first `<header>` element.

```python
def extract_logo(base_url, html):
    soup = BeautifulSoup(html, "lxml")

    # Strategy 1: OG image
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        url = urljoin(base_url, og["content"])
        # Only use OG image if it looks like a logo (not a product photo)
        # Heuristic: logo images are usually < 500KB and square-ish
        # For now, store it as a candidate
        pass

    # Strategy 2: Apple touch icon (best quality)
    for rel in ["apple-touch-icon", "apple-touch-icon-precomposed", "icon", "shortcut icon"]:
        link = soup.find("link", rel=lambda r: r and rel in (r if isinstance(r, list) else [r]))
        if link and link.get("href"):
            return urljoin(base_url, link["href"])

    # Strategy 3: First <img> in <header>
    header = soup.find("header") or soup.find("nav")
    if header:
        img = header.find("img")
        if img and img.get("src"):
            return urljoin(base_url, img["src"])

    return None
```

**Resolution note:** The output stores the URL as-is. The UI or a build step can resize later. Prefer the highest-resolution source available.

### 4.4 Tagline Extraction

The tagline is a short phrase (≤150 characters) that captures the roaster's identity. Common placements:

- `<meta name="description">` content
- `<meta property="og:description">` content
- Hero section `<h2>` or `<p>` immediately following the main `<h1>`
- The `<title>` tag, after stripping the brand name

```python
def extract_tagline(html):
    soup = BeautifulSoup(html, "lxml")

    # Prefer meta description — usually hand-written, concise
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        text = meta["content"].strip()
        if 10 < len(text) < 200:
            return text

    # Fallback: OG description
    og = soup.find("meta", property="og:description")
    if og and og.get("content"):
        text = og["content"].strip()
        if 10 < len(text) < 200:
            return text

    return None
```

**Truncation:** If the extracted text exceeds 200 characters, truncate at the last complete sentence within 200 characters.

### 4.5 About Blurb Extraction

A 1–3 paragraph description of the roaster. Extracted from the About page.

**Step 1: Find the About page URL.** Parse the homepage for links with text or href matching:
```
/about, /our-story, /about-us, /story, /pages/about, /pages/our-story
```
Link text patterns: "About", "Our Story", "About Us", "Our Journey", "The Story".

**Step 2: Fetch and parse the About page.** Extract the main content area:
- Look for `<main>`, `<article>`, or `<div class="...content...">` elements.
- Within that, extract all `<p>` tags.
- Concatenate the first 3 paragraphs (or up to 1000 characters), stripping HTML.

**Step 3: Clean up.**
- Strip excessive whitespace, newlines, and non-printable characters.
- Remove boilerplate phrases: "Read more", "Click here", "Subscribe to our newsletter".
- If the result is <50 characters, it's probably navigation junk — set to `null`.

```python
def extract_about_blurb(base_url, homepage_html):
    soup = BeautifulSoup(homepage_html, "lxml")

    # Find about page link
    about_url = None
    for a in soup.find_all("a", href=True):
        href = a["href"].lower()
        text = a.get_text(strip=True).lower()
        if any(k in href for k in ["/about", "/our-story", "/story"]) or \
           any(k in text for k in ["about", "our story", "our journey"]):
            about_url = urljoin(base_url, a["href"])
            break

    if not about_url:
        return None

    # Fetch about page
    status, html = fetch_page(about_url)
    if status != 200:
        return None

    about_soup = BeautifulSoup(html, "lxml")

    # Extract paragraphs from main content
    main = about_soup.find("main") or about_soup.find("article") or about_soup
    paragraphs = []
    for p in main.find_all("p"):
        text = p.get_text(strip=True)
        if len(text) > 50:  # Skip tiny fragments
            paragraphs.append(text)
        if len(" ".join(paragraphs)) > 1000:
            break

    blurb = " ".join(paragraphs[:3])
    return blurb[:1500] if blurb else None
```

### 4.6 Founding Year Extraction

Search the about page and homepage for year patterns near founding-related keywords.

```python
FOUNDING_PATTERN = re.compile(
    r"(?:founded|established|started|since|est\.?|born)\s*(?:in\s+)?(\d{4})",
    re.IGNORECASE,
)

def extract_founding_year(html):
    match = FOUNDING_PATTERN.search(html)
    if match:
        year = int(match.group(1))
        if 1900 <= year <= 2026:  # Sanity check
            return year
    return None
```

### 4.7 Sourcing Regions Extraction

Identify where the roaster sources its beans. Search the about page, homepage, and product descriptions for Indian coffee region names.

```python
INDIAN_COFFEE_REGIONS = [
    "Chikmagalur", "Chikkamagaluru", "Coorg", "Kodagu", "Baba Budan",
    "Araku", "Araku Valley", "Wayanad", "Nilgiris", "Nilgiri",
    "Yercaud", "Shevaroy", "Kodaikanal", "Pulney", "Palani",
    "Coorg", "Manjarabad", "Hassan", "Sakleshpur",
    "Koraput", "Kalahandi",  # Odisha coffee belt
    "Bababudangiris", "Biligirirangan",
    "Mudigere", "Suntikoppa", "Somwarpet",
    # International (for roasters sourcing globally)
    "Ethiopia", "Colombia", "Kenya", "Rwanda", "Guatemala", "Brazil",
    "Sumatra", "Vietnam", "Panama",
]

def extract_sourcing_regions(html):
    found = []
    html_lower = html.lower()
    for region in INDIAN_COFFEE_REGIONS:
        if region.lower() in html_lower:
            found.append(region)
    return list(set(found)) if found else None
```

### 4.8 Specialties / Identity Tags Extraction

Extract identity terms that describe the roaster's philosophy or approach.

```python
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

def extract_specialties(html):
    html_lower = html.lower()
    found = []
    for tag, patterns in SPECIALTY_TERMS.items():
        if any(p in html_lower for p in patterns):
            found.append(tag)
    return found if found else None
```

### 4.9 Social Links Extraction

Scan the homepage (especially the `<footer>`) for social media links.

```python
SOCIAL_PATTERNS = {
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[\w.]+/?"),
    "twitter": re.compile(r"https?://(?:www\.)?(twitter|x)\.com/[\w]+/?"),
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/[\w.]+/?"),
    "youtube": re.compile(r"https?://(?:www\.)?youtube\.com/[\w@]+/?"),
    "linkedin": re.compile(r"https?://(?:www\.)?linkedin\.com/company/[\w-]+/?"),
}

def extract_social_links(html):
    links = {}
    for platform, pattern in SOCIAL_PATTERNS.items():
        match = pattern.search(html)
        if match:
            links[platform] = match.group(0)
    return links if links else None
```

### 4.10 Enrichment Crawl Budget

Per roaster, the enrichment phase makes at most **3 HTTP requests**:
1. Homepage (already fetched in Phase 2 — reuse the cached HTML)
2. About page (1 new request)
3. One product page (optional — only if sourcing regions not found elsewhere)

This keeps the total crawl under 120 requests for 40 roasters, well within polite-crawl norms.

### 4.11 Phase 3 Output: `enrichment.json`

```json
[
  {
    "place_id": "ChIJ...",
    "logo_url": "https://bluetokaicoffee.com/cdn/shop/files/logo.png",
    "tagline": "Freshly Roasted Specialty Coffee from Indian Estates",
    "about_blurb": "Blue Tokai Coffee Roasters was founded in 2013 by Matt Chitharanjan and Namrata Asthana with a simple goal: to source, roast, and deliver the finest Indian specialty coffee directly to consumers...",
    "founding_year": 2013,
    "sourcing_regions": ["Chikmagalur", "Araku Valley", "Nilgiris", "Coorg"],
    "specialties": ["single-origin", "direct-trade", "specialty-grade"],
    "social_links": {
      "instagram": "https://instagram.com/bluetokaicoffee",
      "twitter": "https://twitter.com/BlueTokaiCoffee",
      "facebook": "https://facebook.com/BlueTokaiCoffee"
    },
    "enrichment_flags": []
  }
]
```

---

## 5. Phase 4: Catalog Assembly

### 5.1 Objective

Merge the outputs of Phases 1, 2, and 3 into the final verified roaster catalog. Only roasters classified as `VERIFIED` or `VERIFIED_WHATSAPP` in Phase 2 are included.

### 5.2 Merge Logic

```python
def assemble_catalog(discovery, verification, enrichment):
    # Index by place_id
    disc_map = {d["place_id"]: d for d in discovery}
    verify_map = {v["place_id"]: v for v in verification}
    enrich_map = {e["place_id"]: e for e in enrichment}

    verified = []
    dropped = []

    for pid, v in verify_map.items():
        d = disc_map.get(pid, {})
        e = enrich_map.get(pid, {})

        if v["classification"] in ("VERIFIED", "VERIFIED_WHATSAPP"):
            verified.append(build_roaster_entry(d, v, e))
        else:
            dropped.append({
                "name": d.get("name", v.get("name")),
                "website": v.get("website"),
                "classification": v["classification"],
                "evidence_summary": summarize_evidence(v),
            })

    return verified, dropped
```

### 5.3 Slug Generation

Each roaster gets a URL-safe slug:

```python
def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[''`]", "", text)             # Remove apostrophes
    text = re.sub(r"[^a-z0-9\s-]", "", text)      # Remove non-alphanumeric
    text = re.sub(r"[\s_]+", "-", text)            # Spaces/underscores to hyphens
    text = re.sub(r"-+", "-", text)                # Collapse multiple hyphens
    return text.strip("-")
```

Examples:
- `"Blue Tokai Coffee Roasters"` → `"blue-tokai-coffee-roasters"`
- `"KC Roasters (Koinonia)"` → `"kc-roasters-koinonia"`
- `"Kāpi Kottai"` → `"kpi-kottai"` (diacritics stripped)

### 5.4 State Inference

State is inferred from the Google Places formatted address. As a fallback, a city→state lookup table is used (see implementation).

---

## 6. Output Schema

### 6.1 Roaster Entry (Verified)

Each verified roaster in the output JSON:

| Field | Type | Required | Source | Description |
|---|---|---|---|---|
| `roaster_slug` | String | Yes | Generated | URL-safe unique identifier |
| `name` | String | Yes | Google Places | Full business name |
| `city` | String | Yes | Google Places / inferred | City of the roastery |
| `state` | String | Yes | Google Places / inferred | State or UT |
| `lat` | Float | Yes | Google Places | Latitude of roastery |
| `lng` | Float | Yes | Google Places | Longitude of roastery |
| `website` | String | Yes | Google Places | Homepage URL |
| `shop_url` | String | Yes | Phase 2 crawl | Direct URL to the online shop/store page |
| `platform` | String | Yes | Phase 2 detection | `Shopify`, `WooCommerce`, `Instamojo`, `Custom` |
| `google_maps_url` | String | Yes | Google Places | Direct Google Maps link |
| `place_id` | String | Yes | Google Places | For re-querying and deduplication |
| `rating` | Float | No | Google Places | Google rating (1.0–5.0) |
| `rating_count` | Integer | No | Google Places | Number of Google reviews |
| `logo_url` | String | No | Phase 3 enrichment | URL to roaster's logo image |
| `tagline` | String | No | Phase 3 enrichment | Short identity phrase (≤200 chars) |
| `about_blurb` | String | No | Phase 3 enrichment | 1–3 paragraph description (≤1500 chars) |
| `founding_year` | Integer | No | Phase 3 enrichment | Year the roaster was founded |
| `sourcing_regions` | Array | No | Phase 3 enrichment | `["Chikmagalur", "Araku Valley"]` |
| `specialties` | Array | No | Phase 3 enrichment | `["single-origin", "direct-trade"]` |
| `social_links` | Object | No | Phase 3 enrichment | `{"instagram": "...", "twitter": "..."}` |
| `verification_class` | String | Yes | Phase 2 | `VERIFIED` or `VERIFIED_WHATSAPP` |
| `verification_evidence` | Object | Yes | Phase 2 | Coffee terms, price examples, cart signals found |
| `enrichment_flags` | Array | Yes | Phase 3 | Missing profile fields: `["missing_about", "missing_logo"]` |
| `cataloged_at` | String | Yes | Generated | ISO 8601 timestamp |

**Total: 24 fields per roaster.**

### 6.2 Dropped Entry

Each dropped roaster:

```json
{
  "name": "Random Coffee Café",
  "website": "https://example.com",
  "classification": "NO_SHOP_PAGE",
  "evidence_summary": "Homepage loaded (200). No /shop, /store, /collections, /products links found in navigation.",
  "place_id": "ChIJ..."
}
```

### 6.3 Compatibility with Downstream Specs

The SCRAPER_SPEC.md (Section 2.2) expects this input schema per roaster:

```json
{
  "name": "...",
  "city": "...",
  "state": "...",
  "lat": 0.0,
  "lng": 0.0,
  "website": "...",
  "shop_url": "...",
  "platform": "..."
}
```

The catalog output is a **superset** of this — all fields the scraper needs are present, plus the profile enrichment fields that the UI needs for roaster pages. The scraper reads only the fields it needs; the UI reads the profile fields.

---

## 7. Output File Specifications

### 7.1 verified_roasters_catalog.json (Primary Output)

```json
{
  "generated_at": "2026-04-02T12:00:00Z",
  "pipeline_version": "1.0",
  "criteria": "Physical roastery (Google Places) + working website + online bean shop with cart/order mechanism",
  "summary": {
    "total_discovered": 145,
    "total_with_website": 92,
    "total_verified": 39,
    "total_dropped": 106,
    "states_covered": 14
  },
  "roasters": [
    {
      "roaster_slug": "blue-tokai-coffee-roasters",
      "name": "Blue Tokai Coffee Roasters",
      "city": "New Delhi",
      "state": "Delhi",
      "lat": 28.4595,
      "lng": 77.0266,
      "website": "https://bluetokaicoffee.com",
      "shop_url": "https://bluetokaicoffee.com/collections/roasted-and-ground-coffee-beans",
      "platform": "Shopify",
      "google_maps_url": "https://maps.google.com/?cid=...",
      "place_id": "ChIJ...",
      "rating": 4.6,
      "rating_count": 1200,
      "logo_url": "https://bluetokaicoffee.com/cdn/shop/files/bt-logo.png",
      "tagline": "Freshly Roasted Specialty Coffee from Indian Estates",
      "about_blurb": "Blue Tokai was founded in 2013 with a simple mission: bring freshly roasted Indian specialty coffee to every doorstep. They source directly from estates across Chikmagalur, the Nilgiris, and Araku Valley, roasting in small batches and shipping within 48 hours of roast date.",
      "founding_year": 2013,
      "sourcing_regions": ["Chikmagalur", "Araku Valley", "Nilgiris", "Coorg"],
      "specialties": ["single-origin", "direct-trade", "specialty-grade"],
      "social_links": {
        "instagram": "https://instagram.com/bluetokaicoffee",
        "twitter": "https://twitter.com/BlueTokaiCoffee",
        "facebook": "https://facebook.com/BlueTokaiCoffee"
      },
      "verification_class": "VERIFIED",
      "verification_evidence": {
        "coffee_terms_found": ["coffee", "beans", "roast", "single-origin", "arabica"],
        "price_examples": ["₹449", "₹595"],
        "cart_signals": ["cdn.shopify.com", "Add to Cart"]
      },
      "enrichment_flags": [],
      "cataloged_at": "2026-04-02T12:00:05Z"
    }
  ],
  "dropped": [
    {
      "name": "Some Café",
      "website": "https://somecafe.in",
      "classification": "NO_SHOP_PAGE",
      "evidence_summary": "Homepage loaded. No shop links found.",
      "place_id": "ChIJ..."
    }
  ]
}
```

### 7.2 verified_roasters_catalog.csv

Flat spreadsheet with one row per verified roaster. All fields from Section 6.1. Array fields (`sourcing_regions`, `specialties`) serialized as comma-separated strings. `social_links` serialized as `"IG: ..., TW: ..., FB: ..."`. `verification_evidence` omitted from CSV (too nested — available in JSON).

### 7.3 catalog_log.json

Per-roaster log of the full pipeline:

```json
[
  {
    "name": "Blue Tokai Coffee Roasters",
    "place_id": "ChIJ...",
    "phase_1": {"status": "found", "city_searched": "New Delhi"},
    "phase_2": {"status": "VERIFIED", "homepage_status": 200, "shop_url_found": true, "platform": "Shopify"},
    "phase_3": {"status": "enriched", "fields_populated": 8, "fields_missing": ["founding_year"]},
    "total_duration_seconds": 4.2
  }
]
```

---

## 8. Error Handling & Logging

### 8.1 Rate Limiting

| Target | Delay | Timeout |
|---|---|---|
| Google Places API | 2 seconds between paginated calls | 10 seconds |
| Website homepage fetch | 1.5 seconds between roasters | 10 seconds |
| About page / shop page fetch | 1 second between requests | 10 seconds |

**User-Agent header for all non-Google requests:**
```
CoffeeAggregator/1.0 (roaster catalog; research)
```

**Maximum 3 retries per failed HTTP request** with exponential backoff (2s, 4s, 8s). After 3 failures, log and skip.

### 8.2 Failure Categories

| Failure | Phase | Log Status | Behavior |
|---|---|---|---|
| Google API quota exceeded | 1 | `fatal: api_quota` | Stop pipeline, report |
| Site down / timeout | 2 | `WEBSITE_DEAD` | Drop roaster, continue |
| Cloudflare challenge | 2 | `WEBSITE_DEAD` (subtype: `cloudflare_blocked`) | Drop roaster, continue |
| About page not found | 3 | `enrichment_partial` | Include roaster, null about fields |
| Logo not extractable | 3 | flag: `missing_logo` | Include roaster, null logo |
| Social links not found | 3 | flag: `missing_social` | Include roaster, null social |

### 8.3 Console Output During Run

```
═══════════════════════════════════════════
PHASE 1: Discovery
═══════════════════════════════════════════
  Searching: coffee roasters New Delhi ... 12 results
  Searching: coffee roastery New Delhi ... 8 results
  ...
  Total raw candidates: 187
  After dedup: 142
  After brand collapse: 98

═══════════════════════════════════════════
PHASE 2: Verification
═══════════════════════════════════════════
  [1/98]  Blue Tokai Coffee Roasters        → VERIFIED (Shopify)
  [2/98]  Savorworks Coffee & Chocolate     → VERIFIED (Shopify)
  [3/98]  Random Chai Café                  → NO_COFFEE_PRODUCTS
  ...
  Verified: 39 | Dropped: 59

═══════════════════════════════════════════
PHASE 3: Enrichment
═══════════════════════════════════════════
  [1/39]  Blue Tokai ... logo ✓ tagline ✓ about ✓ year ✓ social ✓
  [2/39]  Savorworks ... logo ✓ tagline ✓ about ✓ year ✗ social ✓
  [3/39]  KC Roasters ... logo ✓ tagline ✓ about ✗ year ✗ social ✓
  ...

═══════════════════════════════════════════
PHASE 4: Catalog Assembly
═══════════════════════════════════════════
  Verified roasters: 39
  States covered: 14
  Profile completeness:
    logo:     35/39 (90%)
    tagline:  37/39 (95%)
    about:    28/39 (72%)
    year:     18/39 (46%)
    social:   33/39 (85%)
  Output: verified_roasters_catalog.json
  Output: verified_roasters_catalog.csv
  Output: catalog_log.json
═══════════════════════════════════════════
```

---

## 9. Known Limitations & Edge Cases

### 9.1 Google Places Coverage

Google Places does not index every business. A newly launched roaster with no Google listing will be missed. The pipeline can be supplemented with a manual seed list of known roasters (loaded as an optional `seeds.json` input), but those entries still go through the same Phase 2 + Phase 3 treatment.

### 9.2 JavaScript-Rendered Shops

Some websites render their shop entirely via JavaScript (React SPAs, etc.). The HTTP-based crawl will see an empty `<div id="root">` and no products. These are classified as `NO_SHOP_PAGE` even though a browser would show products. The log should include a `requires_js_rendering` flag. This is a known gap — solving it requires headless browser automation (Playwright), which is a V2 enhancement.

### 9.3 Aggregators vs. Single-Roaster Vendors

Sites like `total.coffee` or `aramse.coffee` sell beans from multiple roasters. These should be excluded — the platform is itself an aggregator, not a single-roaster vendor. Detection heuristic: if the shop page lists products from 5+ distinctly named roasters/brands, flag as `aggregator` and drop.

### 9.4 Logo Quality Variance

Some extracted logos will be 16×16 favicons. Others will be high-res PNGs. The pipeline stores whatever it finds. The UI should handle low-res gracefully (e.g., display at small size, or fall back to a text-based roaster name badge).

### 9.5 About Blurb Language

Some roasters (especially in South India) may have about pages in regional languages. The pipeline extracts text regardless of language. The UI may need to handle non-English blurbs or flag them for translation.

### 9.6 Stale Data

Websites change. A roaster verified today may shut down their online shop tomorrow. The pipeline is designed to be re-run periodically (monthly). Diffing the output against the previous run reveals new entrants, exits, and changed URLs.

---

## 10. Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] Set up project directory structure
- [ ] Create `requirements.txt` (`requests`, `beautifulsoup4`, `lxml`)
- [ ] Implement `utils.py` (slugify, URL cleaning, fetch with retry, city→state mapping)
- [ ] Environment variable handling for `GOOGLE_PLACES_API_KEY`

### Phase 2: Google Places Discovery

- [ ] Implement `discovery.py`
- [ ] Text Search across all 45 cities × 2 query templates
- [ ] Place Details fetch for website URL
- [ ] Deduplication by `place_id`
- [ ] Brand collapse (multi-location → single entry)
- [ ] Social media URL filtering
- [ ] Output `discovery.json`

### Phase 3: Website Verification

- [ ] Implement `verification.py`
- [ ] Homepage fetch with status check
- [ ] Shop link detection (URL patterns + nav text patterns)
- [ ] E-commerce signal detection (coffee terms, prices, cart)
- [ ] Classification logic (VERIFIED → NO_CART_MECHANISM spectrum)
- [ ] Platform detection (Shopify / WooCommerce / Custom)
- [ ] Output `verification.json`

### Phase 4: Roaster Profile Enrichment

- [ ] Implement `enrichment.py`
- [ ] Logo extraction (OG image → apple-touch-icon → header img)
- [ ] Tagline extraction (meta description → OG description)
- [ ] About page discovery + blurb extraction
- [ ] Founding year extraction (regex on about + homepage)
- [ ] Sourcing regions extraction (region name matching)
- [ ] Specialties extraction (identity tag matching)
- [ ] Social links extraction (footer link parsing)
- [ ] Output `enrichment.json`

### Phase 5: Catalog Assembly & Output

- [ ] Implement `assembler.py`
- [ ] Merge discovery + verification + enrichment by `place_id`
- [ ] Generate roaster slugs
- [ ] Build final verified list + dropped list
- [ ] Output `verified_roasters_catalog.json`
- [ ] Output `verified_roasters_catalog.csv`
- [ ] Output `catalog_log.json`

### Phase 6: Orchestrator

- [ ] Implement `main.py` with `--phase` and `--all` CLI flags
- [ ] Console progress output
- [ ] Summary statistics
- [ ] Total runtime reporting

---

## 11. Testing & Validation

### 11.1 Operator Review Workflow

After the pipeline runs:

1. Open `verified_roasters_catalog.csv` — scan for obvious errors (wrong city, garbled names).
2. Check `enrichment_flags` column — review roasters with missing logos or about blurbs.
3. Click `website` URLs for any suspicious entries — does the site actually sell coffee?
4. Check `dropped` list in the JSON — are there roasters that should have been verified?
5. Spot-check 5 logo URLs — do they actually render an image?
6. Spot-check 5 about blurbs — are they real descriptions, not navigation junk?

### 11.2 Automated Validation Checks

| Check | Method |
|---|---|
| No duplicate `roaster_slug` values | Assert uniqueness |
| No duplicate `place_id` values | Assert uniqueness |
| All `website` URLs return HTTP 200 | Batch HEAD requests |
| All `shop_url` URLs return HTTP 200 | Batch HEAD requests |
| All `logo_url` URLs return HTTP 200 (where not null) | Batch HEAD requests |
| All `lat`/`lng` within India bounding box (6–37°N, 68–98°E) | Range check |
| All `founding_year` in [1900, 2026] (where not null) | Range check |
| All `about_blurb` > 50 chars (where not null) | Length check |
| `platform` is one of: `Shopify`, `WooCommerce`, `Instamojo`, `Custom` | Enum check |

### 11.3 Regression Testing

Keep the output of each run. When re-running after code changes:
- Compare roaster count (should be stable ±5 unless sites changed).
- Diff the `roaster_slug` lists — new additions and removals should be explainable.
- Verify that no previously verified roaster was dropped without a log explaining why.

---

**END OF ROASTER CATALOG SPECIFICATION**

*This document is the upstream dependency. It produces `verified_roasters_catalog.json`, which is consumed by SCRAPER_SPEC.md (product scraper) and UI_SPEC.md (frontend). Build this pipeline first, review the output, then proceed to the scraper.*
