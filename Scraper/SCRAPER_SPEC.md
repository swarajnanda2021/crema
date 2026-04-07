# Indian Specialty Coffee Aggregator — Scraper Specification

**Version:** 1.0  
**Date:** March 31, 2026  
**Status:** Ready for Claude Code Implementation  
**Component:** Product Data Scraper Pipeline  

---

## Core Idea

India's specialty coffee scene is fragmented across 39+ independent roasters, each running their own website with their own product formats, naming conventions, and data structures. A customer who wants to discover and compare specialty coffees across roasters has no single place to do so.

This platform is a **discovery-first coffee aggregator**. It scrapes product data from every verified Indian specialty coffee roaster's website, normalizes it into a unified schema, and outputs static JSON + Excel files that power a consumer-facing React discovery UI (specified separately).

**This document specifies the scraper pipeline only.** It takes a verified roaster catalog as input and produces a normalized product dataset as output. The output will be manually reviewed and fact-checked by the operator before being fed to the frontend.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Input: Verified Roaster Catalog](#2-input-verified-roaster-catalog)
3. [Output: Product Data Schema](#3-output-product-data-schema)
4. [Scraping Strategy by Platform](#4-scraping-strategy-by-platform)
5. [Field Extraction & Normalization Rules](#5-field-extraction--normalization-rules)
6. [Image Handling](#6-image-handling)
7. [Pipeline Execution Flow](#7-pipeline-execution-flow)
8. [Error Handling & Logging](#8-error-handling--logging)
9. [Output File Specifications](#9-output-file-specifications)
10. [Known Limitations & Edge Cases](#10-known-limitations--edge-cases)
11. [Implementation Checklist](#11-implementation-checklist)
12. [Testing & Validation](#12-testing--validation)

---

## 1. Architecture Overview

### 1.1 Pipeline Summary

```
┌─────────────────────────────────────────────────────────────┐
│  INPUT: verified_roasters_catalog.json                      │
│  (39 roasters with name, website, shop_url, platform)       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: PLATFORM DETECTION & ROUTING                     │
│  - Confirm platform type (Shopify / WooCommerce / Custom)  │
│  - Select appropriate scraping strategy per roaster         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: PRODUCT DATA EXTRACTION                          │
│  - Shopify: /products.json API endpoint                    │
│  - WooCommerce: /wp-json/wc/store/products REST endpoint   │
│  - Custom: HTML parsing with BeautifulSoup/selectolax      │
│  - Extract all coffee products per roaster                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: NORMALIZATION                                    │
│  - Map raw fields → unified schema                         │
│  - Compute derived fields (price_per_gram, etc.)           │
│  - Flag missing/uncertain fields for manual review         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  OUTPUT: products.json + products.xlsx + scrape_log.json   │
│  (Normalized product dataset + review spreadsheet + log)    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Principles

- **No partnership required.** The scraper operates entirely from public-facing data. No API keys, no roaster consent, no login.
- **Deterministic and re-runnable.** Running the scraper twice on the same data produces identical output (minus timestamp changes).
- **Human-in-the-loop.** The output is reviewed and fact-checked manually before it enters the frontend. The scraper flags uncertainty, it does not guess.
- **Fail gracefully per roaster.** If one roaster's site is down or format has changed, the pipeline logs the failure and continues to the next roaster. No single failure kills the run.

### 1.3 Runtime Environment

- **Execution target:** Claude Code (unrestricted outbound HTTP access)
- **Language:** Python 3.10+
- **Key dependencies:** `requests`, `beautifulsoup4` or `selectolax`, `openpyxl`, `json`, `re`, `urllib`
- **No browser automation at this stage.** All scraping is HTTP-based (no Selenium/Playwright). If a roaster requires JavaScript rendering to show products, it is flagged as `scrape_failed: requires_js_rendering` and skipped.

---

## 2. Input: Verified Roaster Catalog

### 2.1 File

```
input/verified_roasters_catalog.json
```

This file was produced in a prior workstream and contains 39 verified roaster-vendors. Every entry has been confirmed to have: a physical roastery, a working website, and an online shop with cart/checkout capability.

### 2.2 Input Schema

Each entry in the JSON array:

```json
{
  "name": "Blue Tokai Coffee Roasters",
  "city": "New Delhi",
  "state": "Delhi",
  "lat": 28.4595,
  "lng": 77.0266,
  "website": "https://bluetokaicoffee.com",
  "shop_url": "https://bluetokaicoffee.com/collections/roasted-and-ground-coffee-beans",
  "platform": "Shopify"
}
```

### 2.3 Platform Distribution (as of March 2026)

| Platform | Count | Scraping Strategy |
|---|---|---|
| Shopify | ~25 | `/products.json` API — structured JSON, highly reliable |
| WooCommerce | ~4 | `/wp-json/wc/store/products` REST API — structured JSON, usually accessible |
| Custom | ~10 | HTML parsing — site-specific, lowest reliability |

**The scraper should handle all three categories.** Shopify and WooCommerce are the priority paths. Custom sites are best-effort.

---

## 3. Output: Product Data Schema

### 3.1 Product-Level Fields

Each scraped coffee product normalizes to this schema:

| Field | Type | Required | Source | Description |
|---|---|---|---|---|
| `product_id` | String | Yes | Generated | `{roaster_slug}_{product_slug}` — globally unique |
| `roaster_name` | String | Yes | Catalog input | Name of the roasting company |
| `roaster_slug` | String | Yes | Generated | URL-safe lowercase: `blue-tokai`, `subko`, `corridor-seven` |
| `roaster_city` | String | Yes | Catalog input | City of the roastery |
| `roaster_state` | String | Yes | Catalog input | State of the roastery |
| `roaster_lat` | Float | Yes | Catalog input | Latitude of roastery |
| `roaster_lng` | Float | Yes | Catalog input | Longitude of roastery |
| `roaster_website` | String | Yes | Catalog input | Roaster's homepage URL |
| `coffee_name` | String | Yes | Scraped | Product title as listed on the roaster's site |
| `coffee_slug` | String | Yes | Generated | URL-safe lowercase of the coffee name |
| `roast_level` | String | No | Scraped/Inferred | One of: `Light`, `Medium-Light`, `Medium`, `Medium-Dark`, `Dark`, `Unknown` |
| `tasting_notes` | String | No | Scraped | Comma-separated tasting notes, e.g. `"Chocolate, Citrus, Nutty"` |
| `origin` | String | No | Scraped | Coffee origin/estate, e.g. `"Chikmagalur, Karnataka"` or `"Attikan Estate"` |
| `altitude_masl` | Integer | No | Scraped | Altitude in meters above sea level. Null if not listed. |
| `process` | String | No | Scraped | Processing method: `Washed`, `Natural`, `Honey`, `Anaerobic`, etc. |
| `varietal` | String | No | Scraped | Coffee varietal: `Arabica`, `Robusta`, `SLN 795`, `Kent`, `Cauvery`, etc. |
| `weight_grams` | Integer | Yes | Scraped | Bag weight in grams (normalized from g/kg) |
| `price_inr` | Float | Yes | Scraped | Listed price in INR for this specific weight variant |
| `price_per_gram` | Float | Yes | Computed | `price_inr / weight_grams` — enables cross-roaster comparison |
| `currency` | String | Yes | Hardcoded | `"INR"` — all prices are Indian Rupees |
| `image_url` | String | No | Scraped | URL of the primary product image |
| `product_url` | String | Yes | Scraped | Direct URL to buy this product on the roaster's website |
| `available` | Boolean | Yes | Scraped | Whether the product is currently in stock |
| `variants` | Array | No | Scraped | Array of `{weight_grams, price_inr, price_per_gram, available}` if multiple sizes exist |
| `tags` | Array | No | Scraped | Any tags/categories from the roaster's site: `["Single Origin", "Pour Over", "Espresso"]` |
| `description_raw` | String | No | Scraped | Full product description as raw text (for manual review) |
| `scrape_confidence` | String | Yes | Generated | `high`, `medium`, `low` — see Section 5.7 |
| `scrape_flags` | Array | Yes | Generated | List of issues: `["missing_roast_level", "altitude_not_found", "price_ambiguous"]` |
| `scraped_at` | String | Yes | Generated | ISO 8601 timestamp of when this product was scraped |

**Total: 27 fields per product**

### 3.2 What Gets Excluded

The scraper **does not** collect:
- Brewing equipment (grinders, drippers, pour-over kits, mugs)
- Non-coffee beverages (tea, chai, hot chocolate)
- Coffee capsules/pods (unless they contain specialty roasted coffee)
- Subscription plans (these are not individual products)
- Merchandise (t-shirts, tote bags)
- Gift cards

**Filter rule:** Only products that are roasted coffee beans or ground coffee. The scraper should filter aggressively. When in doubt, include the product but add `"uncertain_category"` to `scrape_flags`.

---

## 4. Scraping Strategy by Platform

### 4.1 Shopify Roasters (~25 sites)

**Primary endpoint:**

```
https://{domain}/products.json?limit=250
```

This is a public, unauthenticated JSON API that Shopify exposes on every store by default. It returns all products with full metadata.

**Pagination:** If a store has >250 products (unlikely for coffee roasters), paginate with:

```
/products.json?limit=250&page=2
```

**Response structure (key fields):**

```json
{
  "products": [
    {
      "id": 123456789,
      "title": "Attikan Estate - Medium Roast",
      "body_html": "<p>Tasting notes: Chocolate, citrus...</p>",
      "vendor": "Blue Tokai",
      "product_type": "Coffee",
      "tags": ["Single Origin", "Medium Roast", "Pour Over"],
      "variants": [
        {
          "id": 987654321,
          "title": "250g",
          "price": "449.00",
          "available": true,
          "grams": 250
        },
        {
          "id": 987654322,
          "title": "500g",
          "price": "799.00",
          "available": true,
          "grams": 500
        }
      ],
      "images": [
        {
          "src": "https://cdn.shopify.com/.../image.jpg"
        }
      ]
    }
  ]
}
```

**Extraction mapping:**

| Output Field | Shopify Source |
|---|---|
| `coffee_name` | `product.title` |
| `roast_level` | Parsed from `product.tags` or `product.title` or `body_html` |
| `tasting_notes` | Parsed from `body_html` (look for "tasting notes", "flavour notes", "notes:") |
| `origin` | Parsed from `body_html` or `product.title` (estate names, region names) |
| `altitude_masl` | Parsed from `body_html` (look for "altitude", "elevation", "masl", "m.a.s.l") |
| `process` | Parsed from `body_html` or `product.tags` (washed, natural, honey, etc.) |
| `varietal` | Parsed from `body_html` (arabica, robusta, SLN 795, kent, etc.) |
| `weight_grams` | `variant.grams` or parsed from `variant.title` |
| `price_inr` | `variant.price` |
| `image_url` | `product.images[0].src` |
| `product_url` | Constructed: `https://{domain}/products/{product.handle}` |
| `available` | `variant.available` |
| `tags` | `product.tags` |
| `description_raw` | `product.body_html` stripped of HTML tags |

**Coffee vs. non-coffee filtering:**

Apply these filters to exclude non-coffee products:

1. Check `product.product_type` — if it contains `"Coffee"`, `"Bean"`, `"Roast"`, include. If it contains `"Equipment"`, `"Merchandise"`, `"Accessory"`, `"Gift"`, exclude.
2. Check `product.tags` — same keyword matching.
3. Check `product.title` — look for coffee-related terms: `roast`, `blend`, `single origin`, `estate`, `arabica`, `robusta`, `espresso`, `filter`, `pour over`.
4. Negative filter on title — exclude if title contains: `grinder`, `dripper`, `mug`, `cup`, `kettle`, `filter paper`, `scale`, `subscription`, `gift card`, `tote`, `t-shirt`, `merchandise`.

**If ambiguous after all four checks:** include the product, add `"uncertain_category"` to `scrape_flags`.

### 4.2 WooCommerce Roasters (~4 sites)

**Primary endpoint:**

```
https://{domain}/wp-json/wc/store/products?per_page=100
```

This is the WooCommerce Store API (public, read-only, no authentication required). Not all WooCommerce stores expose this — if it returns 404 or 403, fall back to HTML parsing.

**Fallback endpoint (older WooCommerce):**

```
https://{domain}/wp-json/wc/v3/products?per_page=100
```

This typically requires consumer key/secret and will likely return 401. If both JSON endpoints fail, the scraper falls back to HTML parsing of the shop page.

**Response structure (key fields):**

```json
{
  "id": 1234,
  "name": "Monsoon Malabar - Dark Roast",
  "short_description": "Tasting notes: Earthy, spicy, low acidity...",
  "description": "Full description...",
  "prices": {
    "price": "45000",
    "currency_code": "INR",
    "currency_minor_unit": 2
  },
  "images": [
    {
      "src": "https://example.com/image.jpg"
    }
  ],
  "permalink": "https://example.com/product/monsoon-malabar"
}
```

**Price handling:** WooCommerce Store API returns price in minor units. Divide by `10^currency_minor_unit` to get actual INR price. So `"45000"` with `currency_minor_unit: 2` = ₹450.00.

**Extraction mapping follows the same logic as Shopify** — field names differ but the normalization target is identical.

### 4.3 Custom Platform Roasters (~10 sites)

These roasters use bespoke websites or platforms like Instamojo, Wix, or hand-coded sites. There is no universal API.

**Strategy: HTML parsing with heuristics.**

1. Fetch the `shop_url` from the catalog.
2. Parse the HTML with BeautifulSoup.
3. Look for product cards — common patterns:
   - `<div class="product-card">` or similar
   - `<a>` tags linking to individual product pages
   - Price patterns: `₹`, `Rs.`, `INR` followed by digits
   - Image tags within product containers
4. For each detected product, fetch the individual product page.
5. Extract fields from the product page's full HTML.

**This category has the lowest reliability.** Many custom sites will not yield clean structured data.

**Rules for custom sites:**

- If the shop page returns no parseable products after 3 attempts, log the failure with `scrape_failed: custom_site_unparseable` and move on.
- If products are detected but key fields (name, price) cannot be extracted, include partial data with `scrape_confidence: low`.
- Never spend more than 30 seconds per custom site. Timeout and move on.

### 4.4 Platform Detection Confirmation

Even though the catalog already has a `platform` field, the scraper should **confirm** the platform at runtime:

```python
def confirm_platform(domain):
    """
    Test endpoints to confirm platform type.
    Returns: 'shopify', 'woocommerce', or 'custom'
    """
    # Test 1: Shopify
    try:
        r = requests.get(f"https://{domain}/products.json?limit=1", timeout=10)
        if r.status_code == 200 and 'products' in r.json():
            return 'shopify'
    except:
        pass

    # Test 2: WooCommerce Store API
    try:
        r = requests.get(f"https://{domain}/wp-json/wc/store/products?per_page=1", timeout=10)
        if r.status_code == 200:
            return 'woocommerce'
    except:
        pass

    # Fallback
    return 'custom'
```

**Why confirm?** Sites can migrate platforms between catalog creation and scrape time. A Shopify site that moved to custom would silently return no products if we blindly hit `/products.json`.

---

## 5. Field Extraction & Normalization Rules

### 5.1 Roast Level Extraction

Roast level is rarely a structured field. It must be inferred from tags, titles, and descriptions.

**Search order:**
1. Product tags (Shopify `tags` array)
2. Product title
3. Product description (body_html / short_description)

**Matching rules (case-insensitive):**

| Pattern | Maps to |
|---|---|
| `light roast`, `light` (in roast context) | `Light` |
| `medium-light`, `medium light`, `city roast` | `Medium-Light` |
| `medium roast`, `medium` (in roast context) | `Medium` |
| `medium-dark`, `medium dark`, `full city` | `Medium-Dark` |
| `dark roast`, `dark`, `french roast`, `italian roast` | `Dark` |
| No match found | `Unknown` + flag `missing_roast_level` |

**Context awareness:** The word "medium" alone is ambiguous (could refer to bag size). Only match it as roast level if it appears near "roast", "roasted", or in a tags array alongside other roast-related terms.

### 5.2 Tasting Notes Extraction

**Search patterns in description text (case-insensitive):**

```
"tasting notes:"
"tasting notes -"
"flavour notes:"
"flavor notes:"
"flavour profile:"
"notes:"  (only if preceded by roast/flavour context)
"cup profile:"
"in the cup:"
```

**Extraction:** Grab the text following the pattern until the next line break, period-terminated sentence, or HTML tag. Split by commas, ampersands, or "and". Strip whitespace. Capitalize each note.

**Example:**
- Input: `"Tasting Notes: dark chocolate, citrus zest & toasted almonds"`
- Output: `"Dark Chocolate, Citrus Zest, Toasted Almonds"`

If no tasting notes pattern is found, set to `null` and add `"missing_tasting_notes"` to `scrape_flags`.

### 5.3 Altitude Extraction

**Search patterns in description text:**

```
r'(\d{3,4})\s*(m\.?a\.?s\.?l\.?|masl|meters?\s*(above\s*sea\s*level)?|mts?\s*asl)'
r'altitude[:\s]*(\d{3,4})'
r'elevation[:\s]*(\d{3,4})'
r'grown\s*at\s*(\d{3,4})'
```

**Validation:** Indian coffee is grown between ~600m and ~2000m. Values outside 400–2500 are likely false positives. Flag as `"altitude_suspicious"`.

**Range handling:** Some roasters list ranges like "1000-1400m". Take the midpoint: `1200`.

If no altitude found, set `altitude_masl` to `null`. Add `"altitude_not_found"` to `scrape_flags`. This is expected for many products — altitude is a nice-to-have, not a dealbreaker.

### 5.4 Weight Normalization

All weights normalize to **grams as an integer**.

| Raw Input | Normalized |
|---|---|
| `"250g"`, `"250 g"`, `"250gm"`, `"250 gms"` | `250` |
| `"0.5 kg"`, `"500g"` | `500` |
| `"1 kg"`, `"1kg"` | `1000` |
| `"100gm"` | `100` |
| `"350g"` | `350` |

**Shopify-specific:** The `variant.grams` field already provides weight in grams. Use it directly. Only fall back to title/option parsing if `grams` is 0 or missing.

**If weight cannot be determined:** Set `weight_grams` to `null`, add `"weight_unknown"` to `scrape_flags`. Candidate for manual review.

### 5.5 Price Normalization

All prices stored as **float in INR**.

**Cleaning rules:**
- Strip `₹`, `Rs.`, `Rs`, `INR`, commas, spaces
- Convert to float
- WooCommerce: divide by `10^currency_minor_unit`

**Example:** `"₹ 1,299.00"` → `1299.0`

### 5.6 Price Per Gram Computation

```python
price_per_gram = round(price_inr / weight_grams, 2)
```

Only computed when both `price_inr` and `weight_grams` are known. Otherwise `null`.

### 5.7 Confidence Scoring

Each product gets a `scrape_confidence` score:

**`high`** — All required fields extracted cleanly from structured API (Shopify/WooCommerce JSON). Zero ambiguous fields.

**`medium`** — Most fields extracted, but 1-2 were inferred from unstructured text (description parsing). Or: extracted from WooCommerce with partial field coverage.

**`low`** — Extracted from custom HTML. Multiple fields missing or inferred. Or: key fields like price or weight required heuristic guessing.

### 5.8 Process & Varietal Extraction

**Process method search patterns:**

| Pattern | Maps to |
|---|---|
| `washed`, `wet process`, `fully washed` | `Washed` |
| `natural`, `dry process`, `sun dried`, `sundried` | `Natural` |
| `honey`, `pulped natural` | `Honey` |
| `anaerobic`, `anaerobically fermented` | `Anaerobic` |
| `semi-washed`, `wet-hulled`, `giling basah` | `Semi-Washed` |
| No match | `null` + flag `missing_process` |

**Varietal search patterns:**

Look for: `arabica`, `robusta`, `SLN 795`, `SLN 9`, `kent`, `S.795`, `cauvery`, `chandragiri`, `selection 5`, `selection 6`, `liberica`, `catimor`, `caturra`. Indian coffee commonly uses S.795 and Kent varietals.

---

## 6. Image Handling

### 6.1 Strategy

The scraper **does not download images**. It stores the image URL only.

**Rationale:** Images are served from the roaster's CDN (usually Shopify's CDN at `cdn.shopify.com`). Downloading and re-hosting them creates copyright issues and storage overhead. The frontend will load images directly from source URLs.

### 6.2 Image URL Cleaning

Shopify image URLs often contain size suffixes. Store the clean base URL:

```
Raw:    https://cdn.shopify.com/s/.../image_600x.jpg
Clean:  https://cdn.shopify.com/s/.../image.jpg
```

Remove size suffixes like `_600x`, `_300x300`, `_large`, `_medium`, `_small`, `_grande`, `_1024x1024` before the file extension.

### 6.3 Fallback

If no product image is found, set `image_url` to `null` and add `"missing_image"` to `scrape_flags`.

---

## 7. Pipeline Execution Flow

### 7.1 Directory Structure

```
coffee-scraper/
├── input/
│   └── verified_roasters_catalog.json     ← Roaster catalog (input)
│
├── output/
│   ├── products.json                      ← Normalized product data (main output)
│   ├── products.xlsx                      ← Same data as Excel for manual review
│   ├── scrape_log.json                    ← Per-roaster scrape results and errors
│   └── images_manifest.json              ← List of all image URLs for cache-warming
│
├── scraper/
│   ├── main.py                            ← Entry point: orchestrates the full pipeline
│   ├── platform_detector.py               ← Confirms platform type per roaster
│   ├── shopify_scraper.py                 ← Shopify /products.json extraction
│   ├── woocommerce_scraper.py             ← WooCommerce REST API extraction
│   ├── custom_scraper.py                  ← HTML parsing fallback
│   ├── normalizer.py                      ← Field normalization & confidence scoring
│   ├── filters.py                         ← Coffee vs. non-coffee classification
│   └── utils.py                           ← Slugify, price cleaning, regex helpers
│
├── requirements.txt
└── README.md
```

### 7.2 Execution Sequence

```python
# main.py — pseudocode

def main():
    # 1. Load roaster catalog
    roasters = load_json("input/verified_roasters_catalog.json")

    all_products = []
    scrape_log = []

    for roaster in roasters:
        log_entry = {"roaster": roaster["name"], "status": "pending"}

        try:
            # 2. Confirm platform
            platform = confirm_platform(roaster["website"])
            log_entry["platform_detected"] = platform

            # 3. Scrape based on platform
            if platform == "shopify":
                raw_products = scrape_shopify(roaster)
            elif platform == "woocommerce":
                raw_products = scrape_woocommerce(roaster)
            else:
                raw_products = scrape_custom(roaster)

            # 4. Filter to coffee-only products
            coffee_products = filter_coffee_only(raw_products)

            # 5. Normalize each product
            normalized = [normalize_product(p, roaster) for p in coffee_products]

            all_products.extend(normalized)

            log_entry["status"] = "success"
            log_entry["products_found"] = len(raw_products)
            log_entry["coffee_products"] = len(coffee_products)

        except Exception as e:
            log_entry["status"] = "failed"
            log_entry["error"] = str(e)

        scrape_log.append(log_entry)

        # 6. Rate limiting: 2-second pause between roasters
        time.sleep(2)

    # 7. Write outputs
    write_json("output/products.json", all_products)
    write_excel("output/products.xlsx", all_products)
    write_json("output/scrape_log.json", scrape_log)
    write_images_manifest("output/images_manifest.json", all_products)

    # 8. Print summary
    print_summary(scrape_log, all_products)
```

### 7.3 Rate Limiting

- **2-second pause between roasters.** This is a polite crawl, not a DDoS.
- **10-second timeout per HTTP request.** If a site doesn't respond in 10 seconds, it's down or blocking.
- **Maximum 3 retries per failed request** with exponential backoff (2s, 4s, 8s).
- **User-Agent header:** Set a descriptive, non-deceptive user agent:
  ```
  CoffeeAggregator/1.0 (product catalog; contact@example.com)
  ```

---

## 8. Error Handling & Logging

### 8.1 Per-Roaster Log Entry

```json
{
  "roaster": "Blue Tokai Coffee Roasters",
  "website": "https://bluetokaicoffee.com",
  "platform_catalog": "Shopify",
  "platform_detected": "shopify",
  "status": "success",
  "products_found": 45,
  "coffee_products": 32,
  "non_coffee_excluded": 13,
  "confidence_breakdown": {
    "high": 28,
    "medium": 3,
    "low": 1
  },
  "flags_summary": ["missing_altitude: 20", "missing_process: 5"],
  "scrape_duration_seconds": 3.2,
  "scraped_at": "2026-03-31T10:00:00Z"
}
```

### 8.2 Failure Categories

| Failure | Log Status | Behavior |
|---|---|---|
| Site down / timeout | `failed: timeout` | Skip roaster, continue pipeline |
| HTTP 403 / 429 | `failed: blocked` | Skip roaster, continue pipeline |
| Platform mismatch (catalog says Shopify, detection says custom) | `warning: platform_mismatch` | Use detected platform, log discrepancy |
| JSON parse error | `failed: json_parse_error` | Skip roaster, continue pipeline |
| Zero coffee products after filtering | `warning: no_coffee_products` | Log and continue |
| Custom site unparseable | `failed: custom_site_unparseable` | Skip roaster, continue pipeline |

### 8.3 Console Output During Run

```
[1/39] Blue Tokai Coffee Roasters (Shopify) ... 32 coffees ✓
[2/39] Savorworks (Shopify) ... 18 coffees ✓
[3/39] Leo Coffee (Custom) ... FAILED: custom_site_unparseable ✗
[4/39] Roastery Coffee House (WooCommerce) ... 12 coffees ✓
...
═══════════════════════════════════════════
SCRAPE COMPLETE
  Roasters attempted: 39
  Roasters succeeded: 34
  Roasters failed: 5
  Total coffee products: 487
  Confidence: 410 high / 52 medium / 25 low
═══════════════════════════════════════════
```

---

## 9. Output File Specifications

### 9.1 products.json

Top-level array of product objects conforming to the schema in Section 3.1.

```json
[
  {
    "product_id": "blue-tokai_attikan-estate-medium-roast",
    "roaster_name": "Blue Tokai Coffee Roasters",
    "roaster_slug": "blue-tokai",
    "roaster_city": "New Delhi",
    "roaster_state": "Delhi",
    "roaster_lat": 28.4595,
    "roaster_lng": 77.0266,
    "roaster_website": "https://bluetokaicoffee.com",
    "coffee_name": "Attikan Estate - Medium Roast",
    "coffee_slug": "attikan-estate-medium-roast",
    "roast_level": "Medium",
    "tasting_notes": "Chocolate, Citrus, Nutty",
    "origin": "Attikan Estate, Chikmagalur",
    "altitude_masl": 1200,
    "process": "Washed",
    "varietal": "SLN 795, Kent",
    "weight_grams": 250,
    "price_inr": 449.0,
    "price_per_gram": 1.80,
    "currency": "INR",
    "image_url": "https://cdn.shopify.com/s/.../attikan-estate.jpg",
    "product_url": "https://bluetokaicoffee.com/products/attikan-estate-medium-roast",
    "available": true,
    "variants": [
      {"weight_grams": 250, "price_inr": 449.0, "price_per_gram": 1.80, "available": true},
      {"weight_grams": 500, "price_inr": 799.0, "price_per_gram": 1.60, "available": true}
    ],
    "tags": ["Single Origin", "Medium Roast", "Pour Over"],
    "description_raw": "Attikan Estate is located in the Baba Budan Giri region of Chikmagalur...",
    "scrape_confidence": "high",
    "scrape_flags": [],
    "scraped_at": "2026-03-31T10:00:05Z"
  }
]
```

### 9.2 products.xlsx

Same data as products.json but in Excel format for manual review. One row per product. Columns map 1:1 to the JSON fields.

**Additional Excel-specific features:**
- Column headers in bold, frozen top row
- `scrape_flags` column highlighted yellow if non-empty
- `scrape_confidence` column color-coded: green (high), orange (medium), red (low)
- `product_url` column as clickable hyperlinks
- Auto-filter enabled on all columns
- `variants` column serialized as a readable string: `"250g: ₹449 | 500g: ₹799"`

### 9.3 scrape_log.json

Array of per-roaster log entries as defined in Section 8.1.

### 9.4 images_manifest.json

A flat list of all unique image URLs, for optional cache-warming:

```json
{
  "total_images": 487,
  "urls": [
    "https://cdn.shopify.com/s/.../image1.jpg",
    "https://cdn.shopify.com/s/.../image2.jpg"
  ]
}
```

---

## 10. Known Limitations & Edge Cases

### 10.1 Products with No Variants

Some roasters list a single product with no size variants (just one price, one weight). The scraper should handle this by creating a single entry with `variants` as an empty array or a single-element array mirroring the main product fields.

### 10.2 Combo Packs / Sampler Packs

Some roasters sell combo packs ("Try All 4 Origins — 100g each"). These should be **included** with `"combo_pack"` added to tags, and `weight_grams` set to the total weight (e.g., 400g for 4×100g). Add `"combo_pack"` to `scrape_flags`.

### 10.3 Duplicate Products Across Collections

Shopify stores sometimes list the same product in multiple collections. The `/products.json` endpoint returns each product once globally, so this is handled automatically. But verify by deduplicating on `product_id` (which is based on the product handle/slug).

### 10.4 Products Listed in USD

Some Indian roasters list prices in USD on their Shopify store (for international customers). If the currency is not INR, add `"non_inr_price"` to `scrape_flags` and set `price_inr` to `null`. Do not attempt currency conversion.

### 10.5 Unavailable / Sold Out Products

Include them with `available: false`. The frontend will decide whether to show them (greyed out) or hide them. The data should reflect the full catalog, not just what's in stock today.

### 10.6 Sites Behind Cloudflare / Anti-Bot

Some sites may block automated requests. If a request returns a Cloudflare challenge page (identifiable by `cf-ray` header and HTML containing "Checking your browser"), log as `failed: cloudflare_blocked` and skip.

---

## 11. Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] Set up project directory structure
- [ ] Create `requirements.txt` with dependencies
- [ ] Implement `utils.py` (slugify, price cleaning, regex helpers, weight normalization)
- [ ] Implement `platform_detector.py`
- [ ] Implement `filters.py` (coffee vs. non-coffee classification)

### Phase 2: Shopify Scraper (highest value, covers ~25 roasters)

- [ ] Implement `shopify_scraper.py`
- [ ] Handle pagination (products.json?limit=250&page=N)
- [ ] Extract all fields from Shopify JSON response
- [ ] Handle variants (multiple sizes/prices)
- [ ] Test against 3-4 known Shopify roasters from the catalog

### Phase 3: WooCommerce Scraper

- [ ] Implement `woocommerce_scraper.py`
- [ ] Handle Store API and fallback to HTML
- [ ] Test against known WooCommerce roasters (Roastery Coffee House, etc.)

### Phase 4: Custom Site Scraper

- [ ] Implement `custom_scraper.py`
- [ ] HTML parsing heuristics for product detection
- [ ] Test against 2-3 custom sites from the catalog

### Phase 5: Normalization & Output

- [ ] Implement `normalizer.py` (all field normalization rules from Section 5)
- [ ] Implement confidence scoring
- [ ] Implement flag generation
- [ ] Implement `main.py` orchestrator
- [ ] Generate products.json
- [ ] Generate products.xlsx (with formatting)
- [ ] Generate scrape_log.json
- [ ] Generate images_manifest.json

### Phase 6: Testing

- [ ] Run full pipeline against all 39 roasters
- [ ] Verify output schema compliance
- [ ] Spot-check 10 random products against their actual product pages
- [ ] Verify non-coffee products are excluded
- [ ] Verify rate limiting and error handling

---

## 12. Testing & Validation

### 12.1 Operator Review Workflow

After the scraper runs, the operator (Swaraj) reviews the output:

1. Open `products.xlsx`
2. Sort by `scrape_confidence` — review all `low` confidence entries first
3. Check `scrape_flags` column — address flagged issues
4. Click `product_url` for any suspicious entries to manually verify
5. Delete or correct rows as needed
6. The reviewed Excel becomes the source of truth for the frontend

### 12.2 Validation Checks

| Check | Method |
|---|---|
| No duplicate `product_id` values | Automated: assert uniqueness |
| All `price_inr` > 0 where present | Automated: range check |
| All `weight_grams` in [50, 5000] where present | Automated: range check |
| All `altitude_masl` in [400, 2500] where present | Automated: range check |
| All `product_url` returns HTTP 200 | Automated: batch HEAD requests |
| All `image_url` returns HTTP 200 | Automated: batch HEAD requests |
| Coffee filter accuracy | Manual: spot-check 20 excluded products |

---

**END OF SCRAPER SPECIFICATION**

*This document feeds into the UI specification (UI_SPEC.md) which consumes the scraper's output.*
