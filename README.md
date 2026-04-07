# Crema ☕

**Indian Specialty Coffee Community Platform**

Crema is a full-stack platform for discovering, tracking, and discussing specialty coffee beans from Indian roasters. It combines a product scraper that aggregates coffee beans from 60+ roasters across India, a social community layer where users maintain coffee shelves and write detailed tasting notes, and a React frontend that ties it all together.

Built entirely with Claude Code in a single session.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [The Scraper Pipeline](#the-scraper-pipeline)
- [The Catalog Pipeline](#the-catalog-pipeline)
- [The Community Backend](#the-community-backend)
- [The Frontend](#the-frontend)
- [Data Flow](#data-flow)
- [API Reference](#api-reference)
- [Specification Documents](#specification-documents)

---

## What It Does

### For Coffee Drinkers
- **Browse** 470+ specialty coffees from 68 Indian roasters in a card-based UI with flip animations
- **Track** what you're drinking, what you've had, and what you want to try across three shelves
- **Write tasting notes** with full barista-level recipe detail: drink style (cortado, flat white, etc.), milk type, dose, yield, extraction time, temperature, grind size, brew ratio, plus structured tasting sliders and flavor tags from a curated 51-descriptor dictionary
- **Discover** new coffees through community-based recommendations with novelty scoring ("New to you" badges)
- **See what others drink** through a temporal social feed of tasting notes
- **Click the popularity badge** on any coffee to see exactly who has it on their shelf and what they thought of it

### For the Platform
- **Automated scraping** of Shopify, WooCommerce, and custom roaster websites with a two-stage coffee bean filter (title keywords + structural attribute check)
- **Google Places discovery** of roasters across 49 Indian cities with automated website verification and profile enrichment
- **Click tracking** on every outbound "Buy" link — data for future roaster partnerships
- **Manual product/roaster support** for Wix and JS-rendered sites that HTTP scrapers can't reach

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
│  Vite + Tailwind CSS 4 + React Router 6 + Lucide Icons          │
│  Port 5173                                                      │
│                                                                 │
│  Feed ──── My Shelf ──── Browse (Beans/Roasters) ──── Profiles  │
│  Flip cards with India SVG map on back                          │
│  Image crop/zoom for profile photos (react-easy-crop)           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ fetch() via Vite proxy
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    COMMUNITY BACKEND (FastAPI)                   │
│  Port 8000 — single server for everything                       │
│                                                                 │
│  Auth ── Shelves ── Tasting Notes ── Click Tracking             │
│  Recommendations ── Feed Timeline ── Popularity                 │
│  Product & Roaster API (merges scraped + manual + corrections)  │
│  Unified /api/refresh (catalog discovery + product scraping)    │
│                                                                 │
│  SQLite database (coffee_community.db)                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ reads from disk
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SCRAPER PIPELINE (Python)                   │
│  6 parallel workers per roaster site                            │
│                                                                 │
│  Platform Detection → Shopify/WooCommerce/Custom scraping       │
│  → Coffee vs Non-Coffee filtering (Stage 1: title, Stage 2:    │
│    structural — must have 2+ of roast/process/origin/varietal)  │
│  → Normalization → products.json                                │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│                    CATALOG PIPELINE (Python)                     │
│  Google Places Text Search across 49 Indian cities              │
│  → Website verification (coffee terms + prices + cart signals)  │
│  → Profile enrichment (logo, tagline, about, social links)      │
│  → verified_roasters_catalog.json                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
Coffee_Aggregator/
│
├── README.md                              ← You are here
├── .gitignore
│
├── coffee-discovery/                      ← FRONTEND (React + Vite)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx                       ← Entry point
│   │   ├── App.jsx                        ← Router + auth guard
│   │   ├── styles/index.css               ← Tailwind + custom CSS (flip cards, map overlay)
│   │   │
│   │   ├── components/                    ← Shared UI components
│   │   │   ├── CoffeeCard.jsx             ← Flip card with front/back faces
│   │   │   ├── CardGrid.jsx              ← Infinite-scroll responsive grid
│   │   │   ├── IndiaMap.jsx              ← SVG India outline with coordinate pins
│   │   │   ├── Navbar.jsx                ← Top nav (Crema / My Shelf / Browse / Search)
│   │   │   ├── FilterSidebar.jsx         ← Roaster/roast/process multi-select filters
│   │   │   ├── ShareButton.jsx           ← Share dropdown (copy, WhatsApp, Twitter)
│   │   │   ├── LikeButton.jsx            ← Heart toggle (legacy, replaced by shelves)
│   │   │   ├── VariantSelector.jsx       ← Weight/grind variant pills
│   │   │   └── ScrapeProgress.jsx        ← SSE progress bar for live scraping
│   │   │
│   │   ├── community/                     ← Community layer (social features)
│   │   │   ├── api.js                     ← API client with dynamic host + auth headers
│   │   │   ├── components/
│   │   │   │   ├── ProfileCard.jsx        ← Full-bleed avatar + cream overlay bio
│   │   │   │   ├── ProfileEditForm.jsx    ← Edit profile modal with image crop
│   │   │   │   ├── ImageCropModal.jsx     ← Trackpad-native zoom/pan/crop (react-easy-crop)
│   │   │   │   ├── ShelfIsland.jsx        ← Shelf tab content with two-column coffee cards
│   │   │   │   ├── ShelfSelector.jsx      ← Dropdown to add/move coffee between shelves
│   │   │   │   ├── QuickAddModal.jsx      ← Search + add coffee without leaving the page
│   │   │   │   ├── RecommendationPanel.jsx ← Compact flip cards with novelty badges
│   │   │   │   ├── TastingNoteForm.jsx    ← Full brew recipe form (light + advanced mode)
│   │   │   │   ├── TastingNoteDisplay.jsx ← Read-only note with collapsible brew details
│   │   │   │   └── PopularityModal.jsx    ← Who has this coffee + their tasting notes
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.jsx            ← AuthProvider context, login/register/logout
│   │   │   │   ├── useShelves.js          ← Shelf CRUD (add/move/remove)
│   │   │   │   ├── useTastingNotes.js     ← Note CRUD
│   │   │   │   └── useRecommendations.js  ← Fetch recs (self/community/user modes)
│   │   │   └── pages/
│   │   │       ├── FeedPage.jsx           ← Temporal social feed (newest notes first)
│   │   │       ├── MyShelfPage.jsx        ← 3-column: profile / shelf tabs / recommendations
│   │   │       ├── UserProfilePage.jsx    ← Other user's profile (read-only notes)
│   │   │       └── AuthPage.jsx           ← Login / register
│   │   │
│   │   ├── pages/                         ← Non-community pages
│   │   │   ├── BrowsePage.jsx             ← Sub-tabs: Beans / Roasters / (Apparatus) / (Spots)
│   │   │   ├── HomePage.jsx               ← Coffee card grid with filters + popularity
│   │   │   ├── CoffeePage.jsx             ← Individual coffee detail
│   │   │   ├── RoasterPage.jsx            ← Roaster profile + their coffees
│   │   │   └── RoastersPage.jsx           ← Roaster directory with search
│   │   │
│   │   ├── hooks/                         ← Data hooks
│   │   │   ├── useCoffeeData.jsx          ← Fetch products from API, build indexes
│   │   │   ├── useFilters.js              ← URL-synced filter state
│   │   │   ├── useRoasterProfiles.js      ← Fetch roaster profiles with domain matching
│   │   │   └── useShare.js                ← Share URL generation + clipboard
│   │   │
│   │   ├── utils/
│   │   │   ├── filterCoffees.js           ← Filter + sort logic (hides sold-out + unknown roast)
│   │   │   ├── searchCoffees.js           ← Substring search across name/roaster/notes/tags
│   │   │   └── formatPrice.js             ← ₹ formatting, price-per-250g standard
│   │   │
│   │   └── data/
│   │       ├── coffeeRegions.js           ← 33 estates + 25 regions → lat/lng lookup
│   │       ├── products.json              ← Cached product data (API fallback)
│   │       └── roasters.json              ← Cached roaster profiles (API fallback)
│   │
│   └── start-vite.sh                     ← Shell wrapper for conda environments
│
├── Community/                             ← COMMUNITY BACKEND
│   ├── COMMUNITY_SPEC.md                  ← Full specification document
│   └── coffee-community-api/
│       ├── main.py                        ← FastAPI app — all endpoints + unified refresh
│       ├── database.py                    ← SQLite schema + migrations
│       ├── models.py                      ← Pydantic request/response models
│       ├── auth.py                        ← Register, login, sessions, profile update
│       ├── shelves.py                     ← Shelf CRUD (3 shelves per user)
│       ├── tasting_notes.py               ← Note CRUD with dictionary validation
│       ├── click_tracking.py              ← Outbound click logging + stats
│       ├── dictionary.py                  ← 51 flavor tags, 15 drink styles, 8 milk types,
│       │                                    6 grind sizes, 12 brew methods, physical attributes
│       ├── requirements.txt
│       └── uploads/                       ← User-uploaded profile photos (gitignored)
│
├── Scraper/                               ← SCRAPER + CATALOG PIPELINES
│   ├── SCRAPER_SPEC.md                    ← Scraper specification document
│   ├── CATALOG_SPEC.md                    ← Catalog discovery specification
│   ├── requirements.txt
│   │
│   ├── scraper/                           ← Product scraper
│   │   ├── main.py                        ← Orchestrator + parallel generator
│   │   ├── platform_detector.py           ← Shopify/WooCommerce/Custom detection
│   │   ├── shopify_scraper.py             ← /products.json API scraping
│   │   ├── woocommerce_scraper.py         ← WooCommerce Store API scraping
│   │   ├── custom_scraper.py              ← HTML parsing fallback with sitemap
│   │   ├── normalizer.py                  ← Field extraction + confidence scoring
│   │   ├── filters.py                     ← Two-stage coffee bean classification
│   │   └── utils.py                       ← Slugify, price/weight parsing, image URL cleaning
│   │
│   ├── coffee-catalog/                    ← Roaster discovery pipeline
│   │   ├── pipeline/
│   │   │   ├── main.py                    ← 4-phase orchestrator (--all or --phase N)
│   │   │   ├── discovery.py               ← Google Places search + seed list merge
│   │   │   ├── verification.py            ← Website crawl + e-commerce signal detection
│   │   │   ├── enrichment.py              ← Logo, tagline, about, social links extraction
│   │   │   ├── assembler.py               ← Merge + slug generation + CSV export
│   │   │   └── utils.py                   ← Fetch, slugify, city→state mapping
│   │   ├── input/
│   │   │   └── seeds.json                 ← 20 known D2C roasters Google Places misses
│   │   ├── output/                        ← Pipeline output (catalog + intermediates)
│   │   └── requirements.txt
│   │
│   ├── server/                            ← Legacy scraper server (superseded by community API)
│   │   └── app.py
│   │
│   ├── input/                             ← Scraper configuration
│   │   ├── verified_roasters_catalog.json ← 120 roasters (Google Places + seeds + manual)
│   │   ├── manual_products.json           ← Manually added products (Wix sites like Nada)
│   │   ├── manual_roasters.json           ← Manually added roaster profiles
│   │   ├── roaster_corrections.json       ← Enrichment patches from data audit
│   │   ├── roaster_dedup.json             ← Deduplication rules for Google Places duplicates
│   │   └── product_corrections.json       ← Product field corrections
│   │
│   └── output/                            ← Scraper output
│       ├── products.json                  ← 470+ normalized coffee bean products
│       ├── products.xlsx                  ← Same data as Excel for manual review
│       ├── scrape_log.json                ← Per-roaster scrape results
│       └── images_manifest.json           ← All product image URLs
│
├── UI_Specification/
│   └── UI_SPEC.md                         ← Original frontend specification
│
├── Users/                                 ← Test user profile photos
│   ├── Aayushi Kapadia.png
│   ├── Fatema Raja.png
│   ├── Manav.png
│   └── Rishi Solanki.png
│
└── ENRICHMENT_PROMPT.md                   ← Prompt for data enrichment via another Claude instance
```

---

## Getting Started

### Prerequisites
- Python 3.9+ (via conda or system)
- Node.js 18+ (via conda: `conda install nodejs`)
- Google Places API key (for roaster discovery — optional, scraping works without it)

### 1. Install Python dependencies
```bash
pip install fastapi uvicorn passlib bcrypt python-multipart sse-starlette
pip install requests beautifulsoup4 lxml openpyxl
```

### 2. Install frontend dependencies
```bash
cd coffee-discovery
npm install
```

### 3. Start the backend
```bash
cd Community/coffee-community-api
uvicorn main:app --host 0.0.0.0 --port 8000
```
The API is now at http://localhost:8000 (interactive docs at `/docs`).

### 4. Start the frontend
```bash
cd coffee-discovery
npx vite --host
```
The app is now at http://localhost:5173.

### 5. Register and start using
1. Open http://localhost:5173
2. Create an account (username + password, localhost only)
3. Browse coffees → add to your shelf → write tasting notes
4. Edit your profile: upload photo, set bio, coffee preference, brewing style

### 6. Run the scraper (optional)
To refresh the coffee catalog from all roaster websites:
```bash
curl -N http://localhost:8000/api/refresh
```
This runs the full pipeline: Google Places discovery → website verification → profile enrichment → product scraping. Takes ~5-8 minutes. Progress streams as SSE events.

To skip discovery and just re-scrape products:
```bash
# Temporarily hide the API key
mv Scraper/coffee-catalog/.env Scraper/coffee-catalog/.env.bak
curl -N http://localhost:8000/api/refresh
mv Scraper/coffee-catalog/.env.bak Scraper/coffee-catalog/.env
```

---

## The Scraper Pipeline

### How it works

1. **Platform Detection** — for each roaster, probes `/products.json` (Shopify) and `/wp-json/wc/store/products` (WooCommerce). Falls back to custom HTML parsing.

2. **Product Extraction** — Shopify: paginated JSON API. WooCommerce: Store API with weight extraction from attributes. Custom: BeautifulSoup with product card selectors and sitemap fallback.

3. **Coffee Bean Filter (Two-Stage)**
   - **Stage 1** (pre-scrape): title keyword exclusion — kills equipment, chocolate, capsules, stays, gift cards, cascara, brew bags, instant coffee. Special handling for "chocolate" in tasting note context vs product name.
   - **Stage 2** (post-normalization): structural check — a product must have ≥2 of: known roast level, process method, origin, varietal, tasting notes. Plus: weight 50-5000g, price present. This catches non-bean items that slip past keyword filters (e.g., Subko's chocolate bars that have coffee-like metadata).

4. **Normalization** — extracts roast level, tasting notes, altitude, process, varietal, origin from product descriptions using regex patterns. Handles Shopify `variant.grams` weight bug (prefers `option1` weight over shipping weight). Computes price per gram.

5. **Output** — `products.json` (normalized products), `products.xlsx` (colored Excel for review), `scrape_log.json`, `images_manifest.json`.

### Parallelism
6 concurrent threads via `ThreadPoolExecutor`. Rate-limited: 2s between roasters, 10-20s HTTP timeouts with 3 retries + exponential backoff.

### Manual products
For Wix/JS-rendered sites (e.g., Nada Coffee), products are manually entered in `Scraper/input/manual_products.json`. The backend merges them with scraped products at read time.

---

## The Catalog Pipeline

### Four phases

1. **Discovery** — Google Places Text Search across 49 Indian cities × 4 query templates ("coffee roasters {city}", "coffee roastery {city}", "specialty coffee {city}", "buy coffee beans {city}"). Deduplicates by place_id, collapses multi-branch brands (picks the entry with a real website), merges with a seed list of 20 known D2C roasters.

2. **Verification** — crawls each candidate's website. Checks for: working homepage (HTTP 200), shop/products page links, coffee product terms (≥2 of: coffee, beans, roast, blend, arabica...), INR price patterns, cart/order mechanism (Shopify CDN, WooCommerce, Razorpay, WhatsApp). Classifies as VERIFIED or drops with reason.

3. **Enrichment** — for verified roasters, extracts: logo URL (apple-touch-icon → OG image → header img), tagline (meta description), about blurb (from /about page), founding year, sourcing regions (matches 29 Indian + 9 international region names), specialties (10 categories: single-origin, small-batch, direct-trade, organic, etc.), social links (Instagram, Facebook, Twitter, YouTube, LinkedIn).

4. **Assembly** — merges all phases into `verified_roasters_catalog.json` with 24 fields per roaster. Also outputs a scraper-compatible JSON and CSV.

### Corrections layer
- `roaster_corrections.json` — enrichment patches applied at read time
- `roaster_dedup.json` — deduplication rules for Google Places duplicates (e.g., Corridor Seven has 3 listings)
- `manual_roasters.json` — manually added roaster profiles for Wix sites

---

## The Community Backend

### Technology
- **FastAPI** with auto-generated Swagger docs at `/docs`
- **SQLite** — single file, zero config, perfect for localhost
- **bcrypt** — password hashing
- **UUID4 session tokens** — stored in sessions table, 30-day expiry

### Database tables
| Table | Purpose |
|---|---|
| `users` | id, username, display_name, password_hash, bio, avatar_url, location, coffee_preference, brewing_style, created_at |
| `sessions` | token (UUID4), user_id, created_at, expires_at |
| `shelf_entries` | user_id, product_id, shelf (currently_drinking/drank/want_to_try), added_at, moved_at. UNIQUE(user_id, product_id) |
| `tasting_notes` | user_id, product_id, acidity/body/sweetness/aftertaste (1-5), flavor_tags (JSON), brew_method, drink_style, milk_type, dose_grams, yield_grams, water_ml, extraction_time_secs, water_temp_celsius, grind_size, brew_ratio, blend_components (JSON), comment |
| `click_events` | user_id, product_id, roaster_slug, source_page, clicked_at |

### Tasting note dictionary
- **51 flavor tags** across 9 categories (Fruity → Berry/Citrus/Stone Fruit/Tropical/Dried Fruit, Floral, Sweet, Nutty, Chocolate, Spices, Roasted, Earthy & Woody, Green & Herbal)
- **15 drink styles** (Black, Americano, Cortado, Macchiato, Flat White, Cappuccino, Latte, Mocha, Iced, Cold Brew, Filter, South Indian Filter Coffee, Affogato, Lungo, Ristretto)
- **8 milk types** (None, Whole, Toned, Skim, Oat, Almond, Soy, Coconut)
- **6 grind sizes** (Extra Fine → Coarse)
- **12 brew methods** (Pour Over, South Indian Filter, French Press, AeroPress, Espresso, Moka Pot, Cold Brew, Chemex, Clever Dripper, Turkish, Siphon, Instant)

### Recommendations engine
Three modes with novelty scoring:
- `source=self` — based on your own shelf (for /profile)
- `source=community` — based on what everyone is currently drinking (for feed)
- `source=user&for_user=manav` — based on a specific user's shelf (for their profile)

Scoring: +2 for same roaster, +1 for same origin, +1 for same process. Every recommendation includes `_novel: true/false` indicating whether YOU already have it.

---

## The Frontend

### Routes
| Path | Page | Auth Required |
|---|---|---|
| `/` | Social feed (temporal tasting note timeline) | Yes |
| `/profile` | My Shelf (3-column: profile / shelf tabs / recommendations) | Yes |
| `/user/:username` | Another user's profile (read-only) | Yes |
| `/browse` | Marketplace with sub-tabs (Beans / Roasters) | No |
| `/browse?tab=roasters` | Roaster directory | No |
| `/coffee/:productId` | Individual coffee detail | No |
| `/roaster/:roasterSlug` | Roaster profile + their coffees | No |
| `/auth` | Login / register | No |

### Coffee cards
Each coffee is a flip card (CSS 3D transform, 0.6s cubic-bezier). Front face shows image, name, roaster (hyperlinked), roast/process/altitude chips, price per 250g, Buy button. Back face shows an SVG India map (Wikimedia cartographic data) with origin + roaster pins, tasting notes, varietal, process, share button, and shelf selector.

### India map
The card back uses an inline SVG of India's outline (5.6KB, from Wikimedia Commons public domain data). Estate coordinates are resolved from a lookup table of 33 named estates + 25 coffee regions. The map viewBox dynamically centers on the origin, showing ~60% of India for geographic context.

### Popularity badges
Coffee cards with shelf entries show a clickable `[👥 N]` badge. Clicking opens a full-screen modal (portaled to document.body to escape the card's CSS perspective) showing each user who has it: their avatar, name, location, which shelf it's on, and their tasting notes.

### Design system
| Token | Value | Usage |
|---|---|---|
| Background | `#FAF7F2` | Warm off-white (unbleached paper) |
| Card front | `#FFFFFF` | White cards |
| Card back | `#2C1810` | Deep coffee brown |
| Accent | `#C8553D` | Terracotta — buttons, active states, badges |
| Tag background | `#EDE8E1` | Chip/pill backgrounds |
| Serif font | Playfair Display | Headings, coffee names |
| Sans font | Inter | Body text, labels, prices |

---

## Data Flow

```
Google Places API ──→ discovery.json ──→ verification.json ──→ enrichment.json
                                                                      │
Seed list (seeds.json) ─────────────────────────────────────────────────┤
                                                                      ▼
                                                          verified_roasters_catalog.json
                                                                      │
Manual roasters (manual_roasters.json) ──────────────────────────────────┤
Roaster corrections (roaster_corrections.json) ──────────────────────────┤
Roaster dedup rules (roaster_dedup.json) ──────────────────────────────┤
                                                                      ▼
                                                              /api/roasters
                                                          (merged at read time)


verified_roasters_catalog.json ──→ Scraper input
                                        │
                                        ▼
                              products.json (scraped)
                                        │
Manual products (manual_products.json) ──┤
Product corrections (product_corrections.json) ──┤
                                        ▼
                                  /api/products
                              (merged at read time)


/api/products + /api/roasters ──→ React frontend
                                        │
SQLite (shelves, notes, clicks) ────────┤
                                        ▼
                                   User sees:
                                   Feed, Shelf, Browse, Profiles
```

---

## API Reference

All endpoints prefixed with `/api`. Interactive docs at http://localhost:8000/docs.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account (username, display_name, password) |
| POST | `/api/auth/login` | Login (returns session token) |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/profile` | Update bio, avatar_url, location, coffee_preference, brewing_style |

### Shelves
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/shelves` | My shelves (currently_drinking, drank, want_to_try) |
| GET | `/api/shelves/users/:username` | Another user's shelves |
| POST | `/api/shelves` | Add/move coffee to shelf |
| DELETE | `/api/shelves/:entry_id` | Remove from shelf |

### Tasting Notes
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasting-notes?product_id=X` | Notes for a product (all users) |
| GET | `/api/tasting-notes/mine` | All my notes |
| POST | `/api/tasting-notes` | Create note (with dictionary validation) |
| PUT | `/api/tasting-notes/:id` | Update note |
| DELETE | `/api/tasting-notes/:id` | Delete note |

### Products & Roasters
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/products` | All products (scraped + manual + corrections merged) |
| GET | `/api/roasters` | All roasters (catalog + product-derived + manual merged) |
| GET | `/api/products/popularity` | User count per product |
| GET | `/api/products/:id/users` | Users who have this product + their notes |

### Recommendations & Feed
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/recommendations?source=self&limit=3` | Shelf-based recommendations |
| GET | `/api/recommendations?source=community&limit=10` | Community-based (for feed) |
| GET | `/api/recommendations?source=user&for_user=X` | Based on another user's shelf |
| GET | `/api/feed/timeline` | Temporal feed (newest notes first, all users) |
| GET | `/api/feed` | User-grouped feed (legacy) |

### Other
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/upload/avatar` | Upload profile photo (multipart form) |
| POST | `/api/clicks` | Log outbound click (fire-and-forget) |
| GET | `/api/clicks/stats` | Click aggregation stats |
| GET | `/api/dictionary/all` | All tasting vocabulary (flavors, brew methods, etc.) |
| GET | `/api/refresh` | SSE: run catalog discovery + product scraping end-to-end |

---

## Specification Documents

| Document | Location | Purpose |
|---|---|---|
| SCRAPER_SPEC.md | `Scraper/` | Product scraper pipeline specification |
| CATALOG_SPEC.md | `Scraper/` | Roaster discovery + enrichment pipeline specification |
| UI_SPEC.md | `UI_Specification/` | Original frontend specification |
| COMMUNITY_SPEC.md | `Community/` | Community layer (auth, shelves, notes, clicks) specification |
| ENRICHMENT_PROMPT.md | Root | Prompt for data enrichment via another Claude Code instance |

---

## Test Users

Four test users with populated shelves and tasting notes:

| User | Location | Preference | Style | Notable |
|---|---|---|---|---|
| Manav | Bengaluru | Dark / Filter | South Indian filter purist | 2 notes on Attikan Estate + Vienna Roast |
| Aayushi Kapadia | Mumbai | Light / Espresso | Honey-process obsessed | 3 notes including a detailed cortado on Nada's Gangecool |
| Fatema Raja | Pune | Medium / Both | Cold brew enthusiast | 2 notes on cold brew + French press |
| Rishi Solanki | Ahmedabad | Light / Filter | AeroPress precision nerd | 3 notes with exact recipes (dose/yield/time/temp) |

---

## License

This project was built as a personal/prototype platform. No open-source license has been assigned yet.

---

*Built entirely with Claude Code (Anthropic Claude Opus 4) in a single extended session.*
