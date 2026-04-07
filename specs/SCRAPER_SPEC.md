# Crema — Product Scraper Specification

**Version:** 2.0 (reflects actual implementation)
**Last Updated:** April 2026
**Component:** Product Data Scraper Pipeline

---

## 1. Overview

The scraper pipeline discovers and normalizes specialty coffee bean listings from 30+ Indian roasters running Shopify, WooCommerce, or custom websites. It produces a unified JSON dataset consumed by both the React frontend and the FastAPI community backend.

The pipeline runs either as a CLI script or via the backend's `POST /api/refresh` SSE endpoint, which streams progress events to the admin UI.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  INPUT                                                        │
│  ├── verified_roasters_catalog.json  (from catalog pipeline) │
│  ├── manual_products.json            (hand-entered products) │
│  └── manual_roasters.json            (hand-entered roasters) │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 1: Platform Detection (platform_detector.py)          │
│  Tests /products.json (Shopify) then /wp-json/wc/store/      │
│  products (WooCommerce) on both bare domain + www. prefix.   │
│  Falls back to "custom".                                     │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 2: Raw Scraping (shopify/woocommerce/custom scrapers) │
│  Fetches all product listings from the detected platform.    │
│  Parallelized: ThreadPoolExecutor(max_workers=6).            │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 3: Two-Stage Filtering (filters.py)                   │
│  Stage 1: Title keyword exclusion (equipment, tea, chocolate)│
│  Stage 2: Structural check (needs 2+ bean attributes)        │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 4: Normalization (normalizer.py)                      │
│  Extracts roast level, tasting notes, altitude, process,     │
│  varietal, origin, grind options. Assigns confidence score.  │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  OUTPUT                                                       │
│  ├── products.json          (all products, unified schema)   │
│  ├── products.xlsx          (color-coded Excel for review)   │
│  ├── images_manifest.json   (all product image URLs)         │
│  └── scrape_log.json        (per-roaster scrape metadata)    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Directory Structure

```
Scraper/
├── scraper/
│   ├── main.py                 # Orchestrator, output writers, CLI entry
│   ├── filters.py              # Two-stage coffee bean classifier
│   ├── normalizer.py           # Field extraction & platform normalizers
│   ├── shopify_scraper.py      # Shopify /products.json API scraper
│   ├── woocommerce_scraper.py  # WooCommerce Store API scraper
│   └── platform_detector.py    # Runtime platform detection
├── input/
│   ├── manual_products.json    # Hand-entered products (e.g. Nada Coffee)
│   ├── manual_roasters.json    # Hand-entered roaster profiles
│   ├── roaster_corrections.json # Roaster field patches (9 entries)
│   └── roaster_dedup.json      # Duplicate roaster merge rules (5 entries)
├── output/
│   ├── products.json           # Main product dataset (~559 products)
│   ├── products.xlsx           # Excel export with formatting
│   ├── product_corrections.json # Product field patches (11 entries)
│   ├── images_manifest.json    # All product image URLs
│   └── scrape_log.json         # Per-roaster scrape metadata
└── coffee-catalog/             # Roaster discovery pipeline (separate spec)
```

---

## 4. Platform Detection (`platform_detector.py`)

### Function: `confirm_platform(domain, declared_platform)`

Probes platform-specific endpoints to confirm the actual platform, regardless of what the catalog declares.

**Strategy:**
1. Generate candidate domains: `[domain, "www." + domain]` (handles redirects)
2. Test Shopify first: `GET /products.json?limit=1` — validates JSON has `products` array
3. Test WooCommerce: `GET /wp-json/wc/store/products?per_page=1` — validates list response
4. If neither responds, returns `"custom"`

**Timeouts:** 20 seconds per probe. Both bare domain and www variant are tested.

**Returns:** `("shopify" | "woocommerce" | "custom", resolved_domain)`

---

## 5. Shopify Scraper (`shopify_scraper.py`)

### Function: `scrape_shopify(domain, roaster_slug)`

**Endpoint:** `GET https://{domain}/products.json?limit=250&page={page}`

**Pagination:** 250 products per page. Stops when fewer than 250 returned.

**Error Handling:**
- Cloudflare detection: checks `cf-ray` header + "checking your browser" in response body
- Exponential backoff retry: `2^n` seconds, max 3 retries for 5xx errors
- Fatal errors raised as exceptions: `cloudflare_blocked`, `blocked` (403/429), `request_failed`

**Returns:** List of raw Shopify product dicts with attached metadata:
```python
product["_roaster"] = roaster_slug
product["_domain"] = domain
product["_platform"] = "shopify"
```

---

## 6. WooCommerce Scraper (`woocommerce_scraper.py`)

### Function: `scrape_woocommerce(domain, roaster_slug)`

**Endpoint:** `GET https://{domain}/wp-json/wc/store/products?per_page=100&page={page}`

**Pagination:** 100 products per page.

**Graceful Fallback:**
- Returns `([], True)` on first-page 404/403/401 → signals custom scraper fallback
- Continues if later pages fail but first page succeeded
- Returns `([], True)` if zero products found

**Timeout:** 20 seconds (bumped from 10s for slow sites like Naivo).

**Returns:** Tuple `(products: list, needs_custom_fallback: bool)`

---

## 7. Two-Stage Filter (`filters.py`)

### Stage 1: `is_coffee_product(product)` — Pre-Normalization Title Filter

Examines the product title (and WooCommerce tags) against exclusion keyword lists.

**Exclusion Categories:**
| Category | Examples |
|---|---|
| Equipment | grinder, dripper, mug, kettle, filter paper, scale |
| Non-coffee beverages | tea, chai, matcha, turmeric latte |
| Confectionery | cookie, brownie, cake, granola bar |
| Ready-to-drink | cold brew can, cans, bottled |
| Instant/capsules | instant coffee, capsule, pod, brew bag |
| Gifts/subscriptions | gift card, subscription, mystery box |
| Merchandise | t-shirt, tote bag, sticker, poster |

**Special Handling — "Chocolate":**
The word "chocolate" appears both in confectionery products and in coffee tasting notes ("chocolate notes"). The helper `_chocolate_is_tasting_note(title)` uses regex to check if "chocolate" appears adjacent to tasting-note language (e.g., "chocolate notes", "chocolatey").

**Tag-Level Exclusion:** `_HARD_EXCLUDE_TAGS = {"can", "cold brew cans", "cans"}` — WooCommerce tags matching these are excluded regardless of title.

### Stage 2: `is_confirmed_coffee_bean(product)` — Post-Normalization Structural Check

After normalization, validates that the product is actually a coffee bean:

1. **Price AND weight must exist** — no price or no weight → reject
2. **Weight sanity:** 50g ≤ weight ≤ 5000g (below = chocolate bar, above = wholesale)
3. **Attribute check:** Must have **2 or more** of:
   - `roast_level` (not null, not "Unknown")
   - `process` (not null)
   - `origin` (not null)
   - `varietal` (not null)
   - `tasting_notes` (not null, not empty string)

This default-deny approach catches edge cases that keyword filtering misses.

---

## 8. Normalizer (`normalizer.py`)

### Field Extraction Functions

All extractors use regex on the combined title + description text:

#### `extract_roast_level(text)`
Matches 5 levels in priority order (most specific first):
1. `Medium-Dark` / `Medium Dark`
2. `Medium-Light` / `Medium Light`
3. `Light`
4. `Dark`
5. `Medium`

#### `extract_tasting_notes(text)`
Looks for common label patterns:
- "Tasting Notes: X, Y, Z"
- "Flavour Notes: X, Y"
- "Notes of X, Y and Z"
- "Taste: X | Y | Z"

Splits by comma, ampersand, pipe. Returns comma-separated string.

#### `extract_altitude(text)`
Regex: `(\d{3,4})\s*(?:–|-|to)\s*(\d{3,4})\s*(?:masl|m\.?a\.?s\.?l|metres?|meters?|m\b|ft)`
- For ranges (e.g., "1000-1400 masl"), returns the average
- Rejects values below 200 or above 3000 (sanity check)

#### `extract_process(text)`
Matches: Washed, Natural/Naturals, Honey, Anaerobic, Semi-Washed/Semi Washed

#### `extract_varietal(text)`
Matches: Arabica, Robusta, SLN 795, SLN 9, Kent, S274, Chandragiri, Cauvery, Selection 5B, Selection 6, Sarchimor, Catimor, Peaberry

#### `extract_origin(text)`
Searches for 20+ Indian coffee regions:
- Chikmagalur/Chikkamagaluru, Coorg/Kodagu, Araku Valley
- Wayanad, Nilgiris, Sakleshpur, Baba Budan Giris
- Kodaikanal, Yercaud, Shevaroy Hills, Manjarabad
- Also extracts estate/farm names from patterns like "from X Estate"

#### `extract_grind_options(product)`
Parses Shopify variant options and WooCommerce attributes against a canonical grind map:
```
"Whole Bean" → "Whole Bean"
"Espresso"   → "Espresso"
"Filter"     → "Filter"
"Moka Pot"   → "Moka Pot"
"French Press" → "French Press"
"Aeropress"  → "Aeropress"
"Cold Brew"  → "Cold Brew"
```

### Platform Normalizers

All three normalizers return a unified dict with this schema:

```python
{
    "product_id": str,          # "{roaster_slug}_{product_slug}"
    "roaster_slug": str,
    "roaster_name": str,
    "coffee_name": str,
    "product_url": str,
    "image_url": str | None,
    "price_inr": float | None,
    "weight_grams": float | None,
    "price_per_gram": float | None,
    "available": bool,
    "roast_level": str | None,
    "tasting_notes": str | None,
    "origin": str | None,
    "altitude_masl": int | None,
    "process": str | None,
    "varietal": str | None,
    "grind_options": list[str],
    "description_snippet": str,
    "tags": list[str],
    "confidence": "high" | "medium" | "low",
    "confidence_flags": list[str],
    "scraped_at": str,          # ISO 8601
}
```

#### `normalize_shopify_product(product)`
- Price: smallest variant price (in INR, divides by 100 if paise)
- Weight: tries variant option1 → option2 → option3 → title → `variant.grams` (last resort, as it may be shipping weight)
- Image: first image in `images` array
- Confidence: "high" if no flags, "medium" if 1-2, "low" if 3+

#### `normalize_woocommerce_product(product)`
- Price: `price_range.min_amount` (pairs with smallest weight from attributes)
- Weight: reads from `attributes` array (Weight axis with terms like "250g"), falls back to top-level `weight`
- Image: first image in `images` array
- Confidence: starts at "medium" (WooCommerce data is less structured)

#### `normalize_custom_product(product)`
- Maps from BeautifulSoup-extracted data
- Confidence: starts at "low"

---

## 9. Main Orchestrator (`main.py`)

### Entry Point: `scrape_all_generator(catalog_path=None)`

A Python generator that yields SSE-compatible event dicts as it progresses. This allows both CLI and FastAPI to consume the same pipeline.

**Flow:**
1. Load roaster catalog (from file path or default location)
2. Create `ThreadPoolExecutor(max_workers=6)`
3. For each roaster, submit `_scrape_single_roaster()` as a future
4. As futures complete, yield progress events
5. After all complete, run quality gate, write outputs, yield summary

### Per-Roaster Function: `_scrape_single_roaster(roaster)`

1. Call `confirm_platform(domain, declared_platform)` to detect actual platform
2. Route to appropriate scraper:
   - Shopify → `scrape_shopify()`
   - WooCommerce → `scrape_woocommerce()` with custom fallback
   - Custom → custom HTML scraper
3. Filter raw products through `is_coffee_product()` (Stage 1)
4. Normalize each product via platform-specific normalizer
5. Filter normalized products through `is_confirmed_coffee_bean()` (Stage 2)
6. Log metadata: platform, counts (raw → filtered → confirmed), errors, timing

### Quality Gate: `passes_quality_gate(product)`

Filters for the final output:
- Must have `confidence` of "high"
- Must be `available` (in stock)
- Must have `roast_level` that is not null and not "Unknown"
- Must have valid `price_inr` and `weight_grams`

### Output Writers

#### `_write_json_atomic(data, path)`
Writes to a temp file first, then atomically renames to prevent partial writes.

#### `_write_excel(products, path)`
Creates a formatted `.xlsx` with:
- Color-coded rows by confidence level (green/yellow/red)
- Frozen header row
- Auto-filters on all columns
- Column auto-width

#### `_write_images_manifest(products, path)`
Extracts all `image_url` values into a flat JSON array for CDN pre-warming.

### Output Columns (29 fields)
```
product_id, roaster_slug, roaster_name, coffee_name, product_url,
image_url, price_inr, weight_grams, price_per_gram, available,
roast_level, tasting_notes, origin, altitude_masl, process,
varietal, grind_options, description_snippet, tags, confidence,
confidence_flags, scraped_at
```

---

## 10. Data Correction Layer

The backend merges corrections at **read time** (not at scrape time), preserving the raw scrape output.

### `Scraper/output/product_corrections.json`
```json
[
  {
    "product_id": "blue-tokai-coffee-roasters_attikan-estate",
    "corrections": {
      "tasting_notes": "Chocolate, Citrus, Nutty",
      "origin": "Attikan Estate, Chikmagalur",
      "altitude_masl": 1200
    }
  }
]
```

### `Scraper/input/roaster_corrections.json`
```json
[
  {
    "roaster_slug": "blue-tokai-coffee-roasters",
    "corrections": {
      "tagline": "Freshly Roasted Specialty Coffee",
      "logo_url": "https://...",
      "founding_year": 2013,
      "sourcing_regions": ["Chikmagalur", "Araku Valley"],
      "specialties": ["single-origin", "direct-trade"],
      "social_links": { "instagram": "https://..." }
    }
  }
]
```

### `Scraper/input/roaster_dedup.json`
```json
[
  {
    "keep_slug": "corridor-seven-coffee-roasters",
    "remove_slugs": ["corridor-seven-coffee-roasterystanding-room"]
  }
]
```

### `Scraper/input/manual_products.json`
Hand-entered products for roasters whose sites can't be scraped (e.g., Nada Coffee on Wix). Same schema as normalized products.

### `Scraper/input/manual_roasters.json`
Hand-entered roaster profiles. Same schema as catalog roasters.

---

## 11. SSE Integration with Backend

The FastAPI backend at `POST /api/refresh` calls `scrape_all_generator()` and streams each yielded event as an SSE message:

```
event: roaster_start
data: {"roaster": "Blue Tokai Coffee Roasters", "index": 1, "total": 31}

event: roaster_done
data: {"roaster": "Blue Tokai Coffee Roasters", "products": 45, "confirmed": 38}

event: complete
data: {"total_products": 559, "total_roasters": 31, "duration_seconds": 94}
```

The refresh endpoint runs in a background thread with module isolation — it purges cached catalog modules from `sys.modules` before importing the scraper to avoid module name collisions (both pipelines have a `utils.py`).

---

## 12. Known Edge Cases

| Issue | Solution |
|---|---|
| Shopify `variant.grams` = shipping weight | Try option fields first, grams is last resort |
| WooCommerce variable products: min price + max weight | Use smallest weight from attributes with min price |
| "Chocolate" in title = confectionery OR tasting note | `_chocolate_is_tasting_note()` regex helper |
| Cold brew cans passing title filter | `_HARD_EXCLUDE_TAGS` for WooCommerce tag-level exclusion |
| Naivo (Wix) can't be scraped | Manual products in `manual_products.json` |
| Cloudflare-blocked Shopify sites | Detected and reported in scrape log, skipped gracefully |
| Module collision during unified refresh | `sys.modules` purge before importing scraper |
