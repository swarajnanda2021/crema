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

> **Superseded for the production v2 path (2026-05-29).** The live catalog is
> enriched by `Community/coffee-community-api/services/enrichment_runner.py`
> (`full_reenrich_roaster`), NOT this legacy normalizer. Two corrections there
> diverge from the behavior above and are the source of truth:
> 1. **Coherent retail-tier variant pick** (`_pick_default_variant`): price AND
>    weight are taken from the SAME chosen variant — never "min price + max
>    weight" from different variants (that pairing was the Coral Rum ₹3799/20g /
>    kapi-kottai ₹4620-for-200g class). The chosen variant is the retail ENTRY
>    bag: smallest bag ≥100g (sample floor), a URL `-1-kg`-style size hint
>    overriding, and a largest-sub-floor fallback for genuine micro-lots
>    (Reserved 40–90g gesha).
> 2. **Availability from platform stock** : `available=0` when all Shopify
>    variants are `available:false` or WooCommerce `is_in_stock`/`is_purchasable`
>    is false — instead of defaulting to buyable.
> 3. **Genuinely-thin → `source_thin`** (`entity_enricher._adapt_product_payload`):
>    a NOT-single-origin product (Haiku `is_single_origin=False`, or
>    `bean_type='Blend'`) with null process_raw + altitude + producer is
>    classified `source_thin` (honest), not left `enriched`+silent_empty.
>    Single-origins are untouched (a thin single-origin flags a real miss).
>    Varietal is deliberately NOT in the test (a species varietal doesn't make
>    a commodity blend traceable).
> 4. **Re-enrich dup prevention** (`entity_upserter._url_match_variants`): an
>    existing row is matched across {https,http}×{bare,www}×{±slash} URL forms
>    so a bare-domain re-discovery UPDATEs in place instead of INSERTing a
>    name-derived duplicate.
> 5. **`force_enrich` propagation**: threaded endpoint → `_orchestrate_full_reenrich`
>    → `_orchestrate_refresh_all` → `scrape_one_roaster` → `run_enrichment_v2_job`
>    (was hardcoded `False`; also added to the MCP `tools.ts` schema/body — needs
>    `npm run build` + MCP restart). Lets a re-enrich re-process content-unchanged
>    rows so enricher/classifier code changes actually apply catalog-wide.
> 6. **`_zero_provenance` → `source_thin`** (`entity_enricher._adapt_product_payload`,
>    2026-05-29): extends item 3 beyond non-single-origin. ANY bean (incl.
>    single-origin) with process_raw + altitude + producer + tasting_notes +
>    flavor_notes ALL empty → `source_thin`. Catches genuinely-thin single-origin
>    SOURCES (e.g. la-cuppa "Altaghat Plantation", whose WooCommerce body is one
>    line) that item 3's blend-only test left as perpetual silent_empty. Gated on
>    all five descriptors empty so it only fires when Haiku found nothing — never
>    masks a rich-page extraction miss.
> 7. **Non-bean-format detection** (`services/product_filters.py`): `is_url_excluded`
>    now also tests the URL slug against `NON_BEAN_FORMAT_MARKERS` (catches
>    hyphenated brew-bag slugs the cleaned `coffee_name` lost), and a new
>    `is_non_bean_format_text()` runs as Stage-2a in `enrichment_runner` (before
>    the bean-marker gate) matching unambiguous body-text format phrases
>    ("single-serve drip bag", "drip bag sachet", "hot brew bag", …) so brew-bag
>    formats whose marker survives only in body prose flip to `filter_reject` per
>    beans-only. Never matches bare grind terms.
> 8. **Single-serve FORMAT — economic + description detection (Class A, 2026-05-30)**
>    (`services/product_filters.py` + `canonical_entity.py` + `catalog_filter_sweep.py`).
>    The hardest single-serve leaks carry NO format token in the cleaned
>    `coffee_name`, the URL slug, OR the body prose — e.g. roast-coffee "Monsoon
>    Malabar" (5 g, slug `ep-monsoon-malabar`, `description_raw` NULL). They read
>    as available=1 beans and the ₹/g sort floats them to #1 (a 5 g bag at ₹540 =
>    108 ₹/g, the priciest per gram in the catalog). Two new detectors close this:
>    (a) `is_single_serve_by_economics(weight, price)` — the economic signature
>    `weight ≤ 15 g AND ≥ 15 ₹/g` (real specialty beans ship ≥ 50 g at ~₹0.6-8/g,
>    so the box holds only single-serves); enforced post-extraction by the
>    `CanonicalProduct._single_serve_format_economics` validator (flips
>    `available=False` on every re-enrich) and by the retro sweep. (b)
>    `is_non_bean_format_desc(description_raw)` — a STRICTER cousin of
>    `is_non_bean_format_text` used against the stored description: it keeps only
>    product-SELF-DECLARATION phrases ("single-serve drip bag", "pocket brew",
>    "tear the filter bag") and DROPS recipe-tool nouns ("cold brew bag") that a
>    real whole-bean listing legitimately mentions inside a brewing recipe (motley-
>    brew "…Steep coffee in a cold brew bag or a muslin cloth" is a real 200 g
>    bean — must not be rejected). It catches single-serves the economic gate
>    misses because their weight is the pack weight (ninetytwo "Riverside Estate"
>    Pocket Pour, 120 g, body "Our single-serve drip bags … just add hot water").
>    `crema_apply_filters_retro` and the audit's `non_bean_format` counter both run
>    all three checks, so the retro sweep, the write path, and the measurement
>    converge on one verdict. Sweep flipped 8 rows → `filter_reject` (op 2274,
>    reversible); ₹/g `max` 108 → 40, upper band now legit-premium beans only.
> 9. **Multi-coffee BUNDLE rejection (Class B, 2026-05-30)** — separate
>    OBSERVATION from POLICY (`Scraper/enrich.py` + `canonical_entity.py` +
>    `product_filters.py`). A gift box / curated set / duo / combo of ≥2
>    distinct coffees in separate bags is coffee but NOT a single bean SKU.
>    The `is_coffee_bean` boolean conflated "is coffee?" (yes) with "is one
>    SKU?" (no) and the "lean TRUE" pressure won, so multi-coffee boxes leaked
>    in even though Haiku described the bundle in its own blurb ("a curated
>    gift box featuring three distinct coffees"). ROOT FIX: a new
>    `distinct_coffee_count` extraction field — the model only OBSERVES (counts
>    the coffees; a BLEND mixing coffees into one bag = 1, a bundle = N),
>    deterministic code applies the POLICY (`CanonicalProduct._multi_coffee_bundle_guard`
>    flips `available=False` when count > 1). BELT: `is_multi_coffee_bundle`,
>    a deterministic text detector over name + blurb + tasting_notes +
>    description, keyed on SEPARATION structure ("includes/set of/pairing of N
>    coffees", "N-coffee set", "experience duo", "tasted side by side") — NOT a
>    bare count, so a single-bag BLEND ("a blend of two coffees") is never
>    rejected. It runs in the retro sweep, the write-path guard (re-enrich
>    stability), and the audit's new `multi_coffee_bundle` counter, so all
>    three converge. Sweep flipped 8 bundles → `filter_reject` (op 2275:
>    caarabi Light Roast Edit, black-poetry Java Joy Box, zenforest Bourbon
>    Bliss / Mathavara / Monsoon Malabar duos, aromas-of-coorg Balanced/Power
>    packs, blue-tokai Yercaud 3-coffee pack), 0 real beans/blends. KNOWN
>    RESIDUAL: 93-degrees "Piña Colada × Mimosa" — a re-enrich COLLAPSED the
>    combo into a single-origin-looking row, erasing the bundle prose, so the
>    deterministic detector can't safely catch it (a noisy two-coffee-slug
>    heuristic was tried and rejected for false-flagging real beans). It
>    flips on its next re-enrich once the `distinct_coffee_count` prompt is
>    live (Scraper/enrich.py is snapshotted into each job at enqueue →
>    needs a server restart, per the operational caveat below).
> 10. **product_id off the URL handle + Stage-2 thin-page bypass (Class E,
>    2026-05-30)** (`services/entity_upserter.py` + `services/enrichment_runner.py`).
>    Two fixes that let Sikkim Coffee's 3 roast SKUs land as distinct rows
>    (was 1 of 3). (a) `_product_id_for` now keys the id off the URL HANDLE
>    (`_handle_from_url` = last path segment), not `slugify(coffee_name)` —
>    Haiku's `coffee_name_clean` strips the roast suffix so 3 roasts of one
>    coffee collapse to the same name-slug and collide on insert. The handle
>    is unique + stable per SKU. SAFE for existing rows: `upsert_entity`
>    matches the live row by product_url FIRST and reuses its stored id, so
>    the new derivation only fires for a genuine new insert (no
>    duplicate-minting). Falls back to the name slug when the URL has no
>    usable handle. (b) `_strong_platform_bean_signal` is a Stage-2 BYPASS:
>    a thin storefront-chrome page (~800 chars, < 3 visible-text bean
>    markers) is still admitted when the platform metadata is unambiguously
>    coffee — `product_type=Coffee`, or 'Whole Beans' / 'Grounded' grind
>    variant labels (read from the augmenter payload, then the cleaned page
>    text as fallback). Without it, the bean-marker gate silently dropped 2
>    of Sikkim's 3 roasts as 'no-bean-markers'.
>
> **Operational caveat (orchestration).** The v2 product step inline-waits for a
> Haiku drainer in each product's poll window. Reliable application of these
> classifier fixes therefore requires `full_reenrich` (async/202) + per-roaster
> DEDICATED drainers (roaster_slug-filtered, high null-tolerance, ≥2 overlapping)
> — one roaster at a time. Slow WooCommerce sites trickle products minutes apart
> (source retry-backoff), so wave drainers across many roasters time out live
> jobs. `crema_reenrich_product` is SYNCHRONOUS → times out at the MCP fetch
> layer → marks the product `failed`; do NOT use it for bulk application.

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

---

## 13. Article Scraper (parallel pipeline)

The product scraper above feeds Discover BEANS / ROASTERS. A separate
**article scraper** at
`Community/coffee-community-api/services/article_scraper.py` feeds
Discover JOURNAL — the same roaster network, different surface.

It is intentionally NOT part of the `Scraper/scraper/` directory:

- The product scraper writes a JSON file consumed by an `upsert` step
  inside the API. The article scraper writes directly to the
  `roaster_articles` table from inside the API process.
- The product scraper runs as a CLI subprocess with SSE progress; the
  article scraper runs as a `BackgroundTask` invoked by
  `services/catalog_ops.run_article_scrape_job` (job kind
  `article_scrape`).
- The product scraper depends on platform-specific raw scraper modules
  (`shopify_scraper.py`, `woocommerce_scraper.py`); the article
  scraper is a single self-contained module using `requests` + `bs4`.

### Discovery — strategy by platform

| Platform | Strategy | Verified on |
|---|---|---|
| **Shopify** | `/sitemap.xml` → enumerate `sitemap_blogs_*.xml` → harvest blog handles → filter against `_NON_ARTICLE_HANDLES` → fetch `/blogs/<handle>.atom` for each | Black Poetry, Black Baza, Blue Tokai, Subko, Caffinary |
| **WordPress / WooCommerce** | `/feed/` (NOT `/blog/feed/` — that's the comments-feed trap). RSS items typically carry inline HTML in `<content:encoded>` so a second per-URL fetch isn't needed except for `og:image` | Naivo |
| **Custom / unknown** | `/feed`, `/rss`, `/atom.xml` (generic), then HTML index probes at `/blog`, `/journal`, `/articles`, `/stories`, `/blogs/news` | — |

The successful strategy is cached on `roaster_sources.articles_index_url`
+ `articles_feed_kind` + `articles_handles` (JSON array for Shopify
multi-handle) so subsequent runs skip enumeration.

**Shopify handle filter.** Shopify's `sitemap_blogs_*.xml` enumerates
every blog handle on a storefront, including handles that aren't
articles in any meaningful sense — `team`, `policies`, `about`,
`careers`, `pages`, `terms`, `privacy`, etc. The discovery walk
drops these via the `_NON_ARTICLE_HANDLES` set in
`article_scraper.py` before they reach Haiku. This is the fix for
the Black Baza founder-bio rows that surfaced on the bulk run —
discovery was enumerating `team` as if it were a real blog handle.

### Extraction

For each article URL:

1. **Fetch HTML** with a real User-Agent + 12-second timeout.
2. **Cleaned text + og: hints** in one pass via
   `extract_for_enrichment()`: strip `nav, header, footer, script,
   style, noscript, form, [aria-hidden='true']` globally, return
   the page text + `og:title` / `og:description` / `og:image` /
   `og:article:published_time` (or `<time datetime>`) + a bs4
   fallback extraction. Stdlib XML parsing for Atom/RSS feeds —
   no `lxml`.
3. **Per-article Haiku enrichment** (`services/article_enricher.py`)
   — single tool-use call, model `claude-haiku-4-5-20251001`, max
   4000 output tokens. Page text clipped to 16K chars (~4-5K
   tokens). Returns:

       {
         is_article: bool,                  # gate — false rejects URL
         is_about_coffee: bool,             # gate — false → published=0
         topic_category: str,               # one of TOPIC_CATEGORIES
         tags: list[str],                   # 3-7 lowercase keyword tags
         title: str,
         summary: str,                      # 1-2 sentences (excerpt)
         body_html: str,                    # h2/h3, p, ul/ol/li,
                                            # blockquote, img, hr ONLY
         image_url: Optional[str],          # absolute hero URL
         published_at: Optional[str],       # ISO 8601
         word_count: int,
       }

   Strict tag subset — no inline `<span>`, `<strong>`, `<em>`,
   `<a>`, no class/id/style attributes. Every output emitted by
   the enricher maps 1:1 to the consumer reader's `htmlToBlocks`
   walker, so the renderer never has to handle stray markup.
   `is_article=false` rejects category landings, 404s, product
   listings the discovery step mis-classified. Cost ~$0.01 per
   article, latency ~3-5 s. Falls back to bs4 extraction with
   `enrichment_status='failed'` when the call errors.

   **Coffee-relevance gate.** `is_about_coffee=false` is the
   second gate — for pages that ARE articles but aren't about
   coffee. Triggered by founder/team biographies (even on a
   coffee site), wellness / spirituality / lifestyle essays,
   café-event recaps with no coffee content, generic motivation
   posts, and Shopify product-page boilerplate that bled into a
   blog handle. The runner still writes the row but with
   `published=0` so admin can override. Off-topic rows land in
   the admin Articles list with an "Off-topic" badge.

   **Topic categorisation.** `topic_category` is one of eight
   fixed buckets (locked in `services/article_enricher
   .TOPIC_CATEGORIES`): `sourcing_story`, `brew_guide`,
   `origin_profile`, `industry_news`, `harvest_report`,
   `tasting_notes`, `company_update`, `other`. Required when
   `is_about_coffee=true`. New buckets need a schema migration
   AND a system-prompt update — don't extend ad-hoc.

   **Tags.** `tags` is 3-7 lowercase keyword tags drawn from the
   article — origin regions, varietals, processing methods, brew
   gear, café names — never generic terms like `coffee`, `india`,
   `specialty`. Stored as a JSON array in `roaster_articles.tags`
   for sitewide search via `LIKE '%tag%'` on the JSON-as-string
   (FTS5 deferred until performance demands it).

   **Per-roaster site-quirk hint** (Layer B). `enrich_article`
   accepts a `system_addendum` string prepended as a separate
   cacheable system block ahead of `_ARTICLE_SYSTEM`. Generated
   by `services/article_site_prompt_generator.py` after the first
   per-roaster run that lands ≥1 enriched article. The addendum
   captures footer noise that bs4 missed, infographic-driven body
   conventions, stale `<img src>` URL forms, recurring section
   delimiters, date-format quirks. ONE Sonnet meta-call per
   roaster (~$0.03), prompt-cached system block. Stored in
   `roaster_profiles.article_enrichment_prompt_hint` with
   `_updated_at`. Failure mode: any meta-call hiccup leaves the
   hint untouched; the next run retries.
4. **Body-img hero fallback.** When `og:image` is absent,
   `_first_body_image()` scans the article body for the first
   reasonable `<img>` (skips logos, social icons, tracking
   pixels, share-button graphics; prefers images that declare
   width ≥600 px). The candidate is threaded into both the bs4
   fallback's `image_url` and `extract_for_enrichment`'s og:image
   hint, so Haiku sees something concrete instead of `(none)` on
   pages without OG metadata (G-Shot, Aromas-of-Coorg).
5. **WebP hero pipeline** (`download_hero_image()`): fetch the
   chosen hero URL, run through Pillow → WebP @ q=82, persist
   under `Community/coffee-community-api/uploads/articles/<uuid>.webp`
   (mounted at `/uploads/articles/`). URL-form retry on first
   failure: try `https://` (force) and drop `www.` prefix —
   recovers stale `http://www....` URLs Haiku sometimes relays
   from in-body `<img>` tags. 8 MiB input cap. Same WebP pipeline
   as user-uploaded photos in `routes/uploads.py`. Falls back to
   the original external URL when the download / convert fails.
6. **Empty-shell guard.** Rows where Haiku failed AND the bs4
   fallback came back with neither `body_html` nor `image_url`
   are skipped without writing — nothing for the reader or card
   to render. Crucially we don't gate on `word_count` alone:
   Devans-style infographic articles have short body text but a
   real hero JPG that IS the content, and the site-quirk hint
   tells Haiku to preserve those.
7. **Dedup by URL.** `roaster_articles.url UNIQUE` makes re-runs
   idempotent. Skip-cheap path: already-enriched URLs (`enrichment_status='enriched'`)
   don't trigger HTTP, Haiku, or WebP — pass `force_enrich=true`
   on the admin scrape endpoints to re-process every URL.
   Per-row commits inside `upsert_article` keep the SQLite
   writer-lock window short.

### Data shape

`roaster_articles`:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `roaster_slug` | TEXT NOT NULL | Joins to `roaster_profiles` |
| `url` | TEXT UNIQUE NOT NULL | Dedup key |
| `title` | TEXT NOT NULL | From og:title or `<title>` |
| `excerpt` | TEXT | og:description or first `<p>` |
| `image_url` | TEXT | og:image, with body-img fallback |
| `body_html` | TEXT | Cleaned HTML (from extraction) |
| `word_count` | INTEGER | Derived from text length |
| `published_at` | TEXT | ISO from feed / og / `<time>` |
| `scraped_at` | TEXT NOT NULL | ISO at write time |
| `published` | INTEGER NOT NULL DEFAULT 1 | Admin curation flag; off-topic rows insert with 0 |
| `enrichment_status` | TEXT NOT NULL DEFAULT 'pending' | `pending` / `enriched` / `failed` |
| `is_about_coffee` | INTEGER NOT NULL DEFAULT 1 | Layer-A coffee-relevance gate output |
| `topic_category` | TEXT | One of `TOPIC_CATEGORIES` (`sourcing_story` / `brew_guide` / `origin_profile` / `industry_news` / `harvest_report` / `tasting_notes` / `company_update` / `other`) |
| `tags` | TEXT | JSON array of 3-7 lowercase keyword tags powering sitewide search |

Discovery cache columns on `roaster_sources`:

- `articles_index_url TEXT`
- `articles_feed_kind TEXT` — `'rss' | 'atom' | 'sitemap' | 'html'`
- `articles_handles TEXT` — JSON array (Shopify only)
- `last_articles_scraped_at TEXT`
- `articles_count INTEGER NOT NULL DEFAULT 0`

Per-roaster article-extraction hint columns on `roaster_profiles`
(Layer B):

- `article_enrichment_prompt_hint TEXT` — Sonnet-generated addendum
  prepended to `_ARTICLE_SYSTEM` for every Haiku call on this
  roaster. Captures footer noise / infographic conventions / stale
  CDN URL forms / date-format quirks unique to this roaster.
- `article_enrichment_prompt_hint_updated_at TEXT` — relative-time
  display in the admin Journals expand row.
- `article_hint_force_regenerate INTEGER NOT NULL DEFAULT 0` —
  perpetual server-side flag. While set to 1, every
  `article_scrape` pass for this roaster regenerates the hint via
  the Sonnet meta-call (~$0.03 each). Never auto-clears; admin
  flips back to 0 from the Journals expand row when satisfied.
  Toggled via `POST /admin/roasters/{slug}/article-hint/regenerate-flag`
  (body `{ enabled: 0 | 1 }`). The runner ORs this with the per-job
  `regenerate_article_hint` body param so admins can also force a
  one-off regen without flipping the persistent flag.

### Surfaces

- Admin: Catalog Ops → **Articles** sub-tab
  (`crema-app/src/components/admin/ArticlesPanel.tsx`).
- Consumer: Discover → **JOURNAL** sub-tab
  (`crema-app/app/(tabs)/browse.tsx#JournalList`).
- Endpoints documented in `specs/COMMUNITY_SPEC.md`.


## 2026-05-30 — Reliable queue apply + beans-only format hardening

**Applier FK bug (found + fixed while QC-gating savorworks).** The
background applier (next paragraph) shipped with a latent bug: it passed
`upsert_entity(..., job_id=<llm_jobs.id>)`, but `enrichment_tasks.job_id`
is an FK to the **jobs** (scrape) table, not llm_jobs — so the background
apply rolled back with `apply_error="FK constraint failed"` and the
product didn't update (the inline path, which passes the correct scrape
job_id, kept applying in parallel and masked it). Fixed by passing
`job_id=None` to the task-state writers in `_apply_enrichment_job`: the
task row already carries its scrape job_id from `_open_task`, and
`_mark_task_enriched` uses `COALESCE(?, job_id)`, so None preserves it;
the llm_jobs↔apply link is recorded via `applied_at` on the llm_jobs row.
QC-verified by re-enriching savorworks-coffee-chocolate end-to-end
(`failed` 6→1; Phenom failed→enriched with price ₹1050 + image + advanced
enriched_at, confirmed via get_product_detail).

**Background applier (the silent-loss fix).** The v2 queue path used to
apply an enriched product/article ONLY inside the BG thread that
inline-polled `llm_router._call_via_queue` for the drained Haiku answer.
A 600s drainer-starvation timeout orphaned the completed job (the apply
never ran) — the root cause of last session's "huge activity, zero
consumer result". Now every product/article `llm_jobs` row carries
`apply_context_json` (kind, url, roaster_slug, scraped_at, provenance,
resolved deterministic hints, task_id) written at enqueue, and the
drainer's submit endpoint `POST /admin/llm-jobs/{id}/respond` is the
applier: it rebuilds the entity via
`entity_enricher.build_entity_from_output` and calls
`entity_upserter.upsert_entity` directly
(`routes/specific._apply_enrichment_job`). The row lands regardless of
whether the requesting thread is still alive. New columns:
`llm_jobs.apply_context_json`, `applied_at`, `apply_error`. QC = the
product's `enriched_at` advanced past run-start AND the target field is
populated ("queued" / "status changed" is not a pass). Proven end-to-end
on La Cuppa (missing_image + missing_price → 0 for that roaster).

**Beans-only FORMAT enforcement.** `is_coffee_bean` (Scraper/enrich.py
`_EXTRACT_TOOL` + `_SYSTEM`) now classifies single-serve pour-over / drip
/ sachet / brew-bag PACKS as FALSE (they were previously whitelisted as
TRUE). `product_filters.NON_BEAN_FORMAT_MARKERS` is kept in sync with the
FORMAT subset of `_HARD_EXCLUDE_TITLE` (added pourtable / pourover /
pour-over box / pack-of-N / k-cup / drip-kit / go-60). `is_url_excluded`
gained a coincidental-brand-slug guard: a format marker found ONLY in the
URL slug is ignored when the title carries a bean marker and has no
format word of its own — this protects a real bean sitting at a generic
brand URL (World of Coffee "Yellow Honey Sun Dried Robusta 250g" lives at
`/products/world-of-coffee-drip-bag`). Existing leaks are cleared
deterministically via `crema_apply_filters_retro` (no re-enrich needed);
the prompt edit needs a server restart to affect newly-enqueued jobs
(the prompt is snapshotted into each `llm_jobs` row at enqueue).

**Environment limit (honest-null).** Wix product pages (`/product-page/`
— agastya, gb-roasters, mindful, mirras) do not render in this
environment (Playwright / `crema_render_page` / `crema_fetch_page_text`
return length 0). Live image/weight are therefore unfetchable for Wix
roasters; the only data is what the listing-crawl snapshot captured.
Missing Wix image/weight where the snapshot lacks it is genuinely absent
→ leave null, never substitute a logo/placeholder. Shopify roasters can
still show missing image/price via handle drift (live store re-slugged
products); the fix there is a complete re-drain of the fresh enrich (the
Shopify snapshot carries full data), not extraction work.

## 2026-05-30 — Availability is explicit-signal-only + manual set-available tool

**Platform-gated availability (no OOS-from-absence).**
`enrichment_runner` derives `available` from STRUCTURED platform stock
fields only: Shopify (every `variant.available is False`) or WooCommerce
(`is_in_stock is False` / `is_purchasable is False`). For Magento /
custom / Wix — which expose no structured stock field — availability is
left at its incoming default (True); a thin or failed fetch on those
platforms must NEVER infer out-of-stock from the absence of a signal.
The page-text "sold out" path
(`CanonicalProduct._no_price_means_sold_out`) is the only other way a
row hides, and it ALSO requires a positive `sold_out_signal=True` AND a
null/zero price. So a priced bean with no structured stock field (e.g.
Ainmane Magento "Robusta of Coorg", live "₹350 / In stock") stays
`available=1` through a re-enrich. (Hardened after that row was
suspected of being auto-hidden; investigation found it was never
actually flipped — it was `enrichment_status='failed'`, so the v2 upsert
never ran on it — but the gating is now explicit so a future edit can't
regress it.)

**`crema_set_product_available(product_id, available)`** — the companion
to `crema_mark_product_sold_out`. mark-sold-out can only HIDE a bean
(`available=0`); set-available can also UN-HIDE one (`available=1`)
without a full re-enrich. Logged as a `catalog_operations` row
(`kind='manual_set_available'`) with a pre-mutation `catalog_snapshots`
capture, so it's undoable via `crema_rollback_catalog_operation`.
Backend: `POST /admin/products/{id}/set-available` →
`catalog_ops.set_product_available`. Filled the gap where an in-stock
bean wrongly hidden could only be recovered by re-enriching.


## 2026-05-30 — Wix size-select weight extraction (Class D)

Wix product pages expose pack size as a `<select>` inside the
add-to-cart `<form>`. `page_fetcher._extract_product_from_html` strips
`<form>` before building the page text, so the size options were
invisible to `_extract_weight_grams` — weight came back null even though
the page states it. Fix: `_harvest_size_options(soup)` collects
`<option>` / Wix variant-dropdown labels BEFORE the form is decomposed
and appends a `SIZE OPTIONS:` line to the body text; `_pick_bag_grams()`
chooses the representative retail bag = the largest option ≤ 250 g (the
typical 200–250 g specialty bag; lower side if every option exceeds it).
For gb-roasters 50/150/340/900 g → 150 g; DB-verified across the
roaster's beans. Where a roaster's select renders only a bare "Select"
placeholder (options lazy-loaded on interaction, not in the rendered DOM
— e.g. agastya), no size is harvestable and weight stays null
(honest-absent, never fabricated). NOTE: Wix Playwright renders are
intermittently flaky in this env; a single length-0 fetch is not proof
of absence — re-fetch before concluding.

## 2026-05-30 — full_reenrich head-of-line fix (bio no longer blocks scrape)

`_orchestrate_refresh_all` (routes/specific.py) ran step 2 (bio enrich)
inline before dispatching the step-4 scrape/article threads. Bio's
`call_llm` blocks the worker thread until a drainer answers (up to 600s,
×2 for bio + bio_hint). With no bio drainer on the queue, product
enrichment was delayed 10+ minutes even though step 4 is independent of
bio (the scrape preflight only needs the `roaster_sources` row, which on
a re-enrich already exists). Symptom: full_reenrich parent op sits
`running` and "never dispatches the scrape child" — actually it does,
just minutes late, long after the operator stops polling. Fix: when a
usable sources row already exists, bio runs in its own daemon thread
(still best-effort) and the scrape dispatches immediately; only on
first-time onboarding (sources row absent — bio is what creates it) does
bio run inline-first. Verified: bili-hu sync→scrape-dispatch went from
~11 min to ~11 ms.
