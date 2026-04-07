# Crema — Roaster Catalog Discovery Specification

**Version:** 2.0 (reflects actual implementation)
**Last Updated:** April 2026
**Component:** Roaster Discovery & Enrichment Pipeline

---

## 1. Overview

The catalog pipeline discovers Indian specialty coffee roasters via Google Places API, verifies they have online shops, enriches their profiles from their websites, and produces a verified roaster catalog that feeds the product scraper.

The pipeline runs as a 4-phase sequential process. Each phase is parallelized internally using `ThreadPoolExecutor(max_workers=8)`.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUTS                                                         │
│  ├── Google Places API key (env: GOOGLE_PLACES_API_KEY)         │
│  └── input/seeds.json (20 known D2C roasters as seed list)      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: DISCOVERY (discovery.py)                              │
│  Google Places Text Search: 4 query templates × 49 cities       │
│  + seed list merge + brand collapse + domain dedup              │
│  Output: discovery.json                                         │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: VERIFICATION (verification.py)                        │
│  Crawl each website for: coffee terms, INR prices, cart signals │
│  Classify: VERIFIED | VERIFIED_WHATSAPP | NO_SHOP_PAGE | etc.   │
│  Output: verification.json                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: ENRICHMENT (enrichment.py)                            │
│  Extract: logo, tagline, about, founding year, social links,    │
│  sourcing regions, specialties                                  │
│  Output: enrichment.json                                        │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 4: ASSEMBLY (assembler.py)                               │
│  Merge all phases → final catalog + CSV + scraper input         │
│  Output: verified_roasters_catalog.json, .csv, scraper_input.json│
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Directory Structure

```
Scraper/coffee-catalog/
├── pipeline/
│   ├── discovery.py        # Phase 1: Google Places + seeds
│   ├── verification.py     # Phase 2: Website crawl + classify
│   ├── enrichment.py       # Phase 3: Profile extraction
│   ├── assembler.py        # Phase 4: Merge + output
│   └── utils.py            # Shared: fetch_page, slugify, city→state lookup
├── input/
│   └── seeds.json          # 20 known D2C roasters (hand-curated)
└── output/
    ├── discovery.json              # Raw candidates from Phase 1
    ├── verification.json           # Verification results from Phase 2
    ├── enrichment.json             # Profile data from Phase 3
    ├── verified_roasters_catalog.json  # Final catalog (Phase 4)
    ├── verified_roasters_catalog.csv   # CSV export (Phase 4)
    └── scraper_input.json          # Slim format for product scraper
```

---

## 4. Phase 1: Discovery (`discovery.py`)

### Function: `run_discovery(api_key) → list[dict]`

Combines Google Places search with a hand-curated seed list of known D2C roasters.

### 1A. Google Places Text Search

**Query Templates (4):**
```python
QUERY_TEMPLATES = [
    "coffee roasters {}",
    "coffee roastery {}",
    "specialty coffee {}",
    "buy coffee beans {}",
]
```

**Cities (49):** Covers all Indian metros, state capitals, coffee belt towns, and Northeast India:
- **Tier 1 (8):** New Delhi, Mumbai, Bengaluru, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad
- **Tier 2 (23):** Jaipur, Lucknow, Chandigarh, Kochi, Coimbatore, Mangalore, Mysuru, etc.
- **Tier 3 Coffee Belt (8):** Chikmagalur, Coorg, Madikeri, Kodaikanal, Wayanad, Kalpetta, Auroville, Sakleshpur
- **Tier 3 Northeast (8):** Shillong, Kohima, Imphal, Aizawl, Gangtok, Agartala, Itanagar, Dimapur
- **Tier 3 NCR (3):** Noida, Gurgaon, Panchkula

**Total queries:** 4 × 49 = 196, executed in parallel with 8 workers.

**Google Places API calls per query:**
1. `textsearch/json` with `region=in` — returns up to 20 results
2. Follows `next_page_token` for additional pages (2-second delay between pages)

### 1B. Seed List

`input/seeds.json` contains 20 known D2C roasters that Google Places misses (online-only brands, new entries). Schema:
```json
{
    "name": "Nada Coffee",
    "website": "https://nadacoffee.in",
    "city": "Goa",
    "state": "Goa",
    "lat": 15.4,
    "lng": 73.9
}
```

Seeds get `place_id = "seed_{slugified_name}"` and `types = ["seed_d2c"]`.

### Deduplication Pipeline

1. **Place ID dedup** — remove exact duplicates from overlapping city searches
2. **Drop no-website** — candidates without a website are immediately dropped
3. **Brand collapse** — multi-branch brands (Starbucks Indiranagar vs Starbucks Koramangala) collapse to one entry, preferring: real e-commerce website > roastery type > most reviews
4. **Remove closed** — `business_status = "CLOSED_PERMANENTLY"` dropped
5. **Merge seeds** — seeds prepended so they win domain-level dedup
6. **Domain dedup** — deduplicate by website hostname (strip www.)

### Candidate Schema

```python
{
    "place_id": str,
    "name": str,
    "brand": str,              # First segment before pipe/dash
    "address": str,
    "lat": float,
    "lng": float,
    "website": str | None,
    "google_maps_url": str,
    "types": list[str],        # Google Places types
    "rating": float | None,
    "rating_count": int | None,
    "business_status": str,
    "city_searched": str,
    "city": str,
    "state": str,
}
```

---

## 5. Phase 2: Verification (`verification.py`)

### Function: `run_verification(candidates) → (results, verified_count, dropped_count)`

Crawls each candidate's website to determine if it has a functioning online coffee shop.

### Per-Candidate Verification: `verify_candidate(candidate)`

1. **Fetch homepage** — GET with 10s timeout, 3 retries with exponential backoff
2. **Detect platform** — checks for Shopify CDN, WooCommerce plugin, Instamojo
3. **Find shop URLs** — parse `<a>` tags for `/shop`, `/store`, `/collections`, `/products`, etc.
4. **Fetch best shop page** — GET the first shop link found
5. **Check e-commerce signals** across homepage + shop page:
   - **Coffee terms:** "coffee", "beans", "roast", "arabica", "single-origin", etc.
   - **INR prices:** `₹449`, `Rs. 599`, `&#8377;` HTML entity, WooCommerce price spans
   - **Cart signals:** "add to cart", "buy now", Shopify CDN, payment gateways (Razorpay, Instamojo, Cashfree)
6. **Classify** based on signals found

### Classification Values

| Classification | Meaning |
|---|---|
| `VERIFIED` | Has coffee terms + prices + cart mechanism |
| `VERIFIED_WHATSAPP` | Has coffee + prices + WhatsApp ordering (no traditional cart) |
| `NO_SHOP_PAGE` | No shop/products link found |
| `NO_COFFEE_PRODUCTS` | Shop found but <2 coffee terms |
| `NO_PRICES` | Coffee found but no INR prices |
| `NO_CART_MECHANISM` | Coffee + prices but no ordering mechanism |
| `WEBSITE_DEAD` | Homepage returned non-200 or unreachable |
| `NO_WEBSITE` | No website URL available |

### Verification Result Schema

```python
{
    "place_id": str,
    "name": str,
    "website": str,
    "homepage_status": int,
    "shop_url": str | None,
    "classification": str,
    "platform": "Shopify" | "WooCommerce" | "Instamojo" | "Custom",
    "evidence": {
        "coffee_terms_found": list[str],
        "price_examples": list[str],
        "cart_signals": list[str],
        "shop_links_found": list[str],
    },
}
```

---

## 6. Phase 3: Enrichment (`enrichment.py`)

### Function: `run_enrichment(candidates, verifications) → list[dict]`

Only processes candidates classified as `VERIFIED` or `VERIFIED_WHATSAPP`.

### Per-Roaster Enrichment: `enrich_roaster(candidate, verification)`

Makes at most 2 HTTP requests per roaster: homepage + about page.

**Extracted Fields:**

#### Logo (`_extract_logo`)
Priority: apple-touch-icon → og:image → first `<img>` in `<header>`/`<nav>` → favicon

#### Tagline (`_extract_tagline`)
From `<meta name="description">` or `og:description`, must be 10-200 chars.

#### About Blurb (`_extract_about_blurb`)
1. Find about page URL from nav links (patterns: `/about`, `/our-story`, `/story`)
2. Fetch about page
3. Extract first 3 paragraphs >50 chars each from `<main>` or `<article>`
4. Truncate at 1500 chars

#### Founding Year (`_extract_founding_year`)
Regex: `(?:founded|established|started|since|est\.?|born)\s*(?:in\s+)?(\d{4})`
Validates year is 1900–2026.

#### Sourcing Regions (`_extract_sourcing_regions`)
Searches page text for 27 known coffee-growing regions:
- **Indian:** Chikmagalur, Coorg, Araku Valley, Wayanad, Nilgiris, Kodaikanal, Sakleshpur, etc.
- **International:** Ethiopia, Colombia, Kenya, Rwanda, Guatemala, Brazil, etc.

#### Specialties (`_extract_specialties`)
Matches 10 identity tags against page text:
```
small-batch, single-origin, direct-trade, organic, fair-trade,
estate-grown, specialty-grade, women-owned, sustainability, q-grader
```

#### Social Links (`_extract_social_links`)
Regex patterns for: Instagram, Twitter/X, Facebook, YouTube, LinkedIn

### Enrichment Result Schema

```python
{
    "place_id": str,
    "logo_url": str | None,
    "tagline": str | None,
    "about_blurb": str | None,
    "founding_year": int | None,
    "sourcing_regions": list[str] | None,
    "specialties": list[str] | None,
    "social_links": { "instagram": str, ... } | None,
    "enrichment_flags": list[str],  # missing_logo, missing_tagline, etc.
}
```

---

## 7. Phase 4: Assembly (`assembler.py`)

### Function: `assemble_catalog(discovery, verifications, enrichments) → (verified, dropped, summary)`

Merges all three phase outputs into the final catalog.

### Final Roaster Schema

```python
{
    "roaster_slug": str,
    "name": str,
    "city": str,
    "state": str,
    "lat": float,
    "lng": float,
    "website": str,
    "shop_url": str,
    "platform": str,
    "google_maps_url": str | None,
    "place_id": str,
    "rating": float | None,
    "rating_count": int | None,
    "logo_url": str | None,
    "tagline": str | None,
    "about_blurb": str | None,
    "founding_year": int | None,
    "sourcing_regions": list[str] | None,
    "specialties": list[str] | None,
    "social_links": dict | None,
    "verification_class": str,
    "verification_evidence": dict,
    "enrichment_flags": list[str],
    "cataloged_at": str,  # ISO 8601
}
```

### Output Files

1. **`verified_roasters_catalog.json`** — Full catalog, sorted by name
2. **`verified_roasters_catalog.csv`** — Flat CSV with serialized arrays
3. **`scraper_input.json`** — Slim format consumed by the product scraper

---

## 8. Shared Utilities (`utils.py`)

### `fetch_page(url, timeout=10)`
GET with retry + exponential backoff (3 attempts). Returns `(status_code, html)`.

### `slugify(text)`
NFKD normalize → ASCII → lowercase → strip punctuation → hyphen-separated.

### `is_real_website(url)`
Returns False for social media domains (Facebook, Instagram, Twitter, etc.).

### `clean_url(url)`
Ensures `https://` prefix, strips trailing slash.

### `infer_state(address, city_searched)`
Maps city names to Indian states using a 60+ entry lookup table covering all metros, coffee belt towns, and Northeast cities.

### `infer_city(address, city_searched)`
Extracts city from Google Places formatted address (third-from-last comma segment).

---

## 9. Integration with Backend

The FastAPI backend's `POST /api/refresh` endpoint runs the full catalog pipeline + product scraper sequentially:

1. **Catalog phases** — imports `discovery.py`, `verification.py`, `enrichment.py`, `assembler.py` via `importlib.util.spec_from_file_location` (avoids module name collision with scraper's `utils.py`)
2. **Product scraper** — purges cached catalog modules from `sys.modules`, then imports scraper
3. **SSE streaming** — yields progress events for each phase
4. **Background thread** — runs in a separate thread to avoid blocking the FastAPI event loop

---

## 10. Google Places API Usage

**API calls per full pipeline run:**
- Discovery: ~196 text searches + pagination tokens + place details
- Estimated cost: ~$50-80 per full run (depending on pagination depth)

**Rate limiting:** No explicit rate limiting beyond Google's built-in quotas. The 2-second delay between pagination tokens is required by the API.
