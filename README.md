# Crema

**Indian Specialty Coffee Community Platform**

Crema is a full-stack platform for discovering, tracking, and discussing specialty coffee beans from Indian roasters. Users browse 470+ coffees from 68 roasters, maintain coffee shelves, write tasting notes, follow roasters, and share posts. A product scraper aggregates the catalog from roaster websites in the background.

The frontend is a React Native (Expo) app. The backend uses a **CRUD Utopia** architecture: a declarative resource registry that generates endpoints, a unified response envelope, and a JSON-based design token system. This makes the codebase portable — a Swift/iOS app can read the same token JSON and talk to the same API with zero backend changes.

Built with Claude Code.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [The Scraper Pipeline](#the-scraper-pipeline)
- [The Catalog Pipeline](#the-catalog-pipeline)
- [The Community Backend (CRUD Utopia)](#the-community-backend-crud-utopia)
- [The Crema App (React Native)](#the-crema-app-react-native)
- [Data Flow](#data-flow)
- [API Reference](#api-reference)
- [Specification Documents](#specification-documents)

---

## What It Does

- **Browse** 470+ specialty coffees from 68 Indian roasters with search, filters, and roaster profiles
- **Track** what you're drinking, what you've had, and what you want to try across three shelves
- **Write tasting notes** with structured tasting sliders, flavor tags, and full brew recipe detail
- **Follow roasters** and other users, compose posts, comment, repost, like
- **See what others drink** through a social feed of posts and tasting notes
- **View popularity** on any coffee to see who has it on their shelf and what they thought

A scraper pipeline runs in the background to keep the product catalog current (Shopify, WooCommerce, and custom site scraping). A catalog pipeline discovers new roasters via Google Places across 49 Indian cities.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CREMA APP (React Native / Expo)               │
│  Expo Router + React Native 0.81 + TypeScript                   │
│  Port 8082 (web) / native iOS & Android                         │
│                                                                 │
│  Feed ── Browse (Beans/Roasters) ── My Shelf ── Profiles        │
│  Posts ── Comments ── Follows ── Notifications                  │
│                                                                 │
│  design-tokens.json ─── useResource<T> ─── apiFetchRaw          │
│  (portable tokens)      (generic CRUD)     (envelope-aware)     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ apiFetchRaw() → { data, meta }
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│               COMMUNITY BACKEND (FastAPI — CRUD Utopia)          │
│  Port 8000                                                      │
│                                                                 │
│  registry.py ──→ crud.py ──→ resources.py (auto-generated)      │
│  (20 resources)   (SQL engine)  (list/get/create/update/delete) │
│                                                                 │
│  specific.py (feed, follow, profiles, catalog sync)             │
│  envelope.py ({ data, meta } on every response)                 │
│  services/ (auth, notifications, catalog_sync)                  │
│                                                                 │
│  SQLite database (coffee_community.db)                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ reads from disk
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SCRAPER PIPELINE (Python)                    │
│  Shopify/WooCommerce/Custom scraping → products.json            │
├─────────────────────────────────────────────────────────────────┤
│                    CATALOG PIPELINE (Python)                     │
│  Google Places across 49 cities → verify → enrich → catalog     │
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
├── crema-app/                             ← CREMA APP (React Native / Expo)
│   ├── app/                               ← Expo Router file-based routing
│   │   ├── (tabs)/ index.tsx, browse.tsx, profile.tsx
│   │   ├── auth.tsx, coffee/[id].tsx, roaster/[slug].tsx, user/[username].tsx
│   ├── src/
│   │   ├── api/client.ts                  ← apiFetchRaw, apiUpload (envelope-aware)
│   │   ├── tokens/design-tokens.json      ← Portable design tokens (colors, fonts, sizes)
│   │   ├── tokens/useTokens.ts            ← Token provider: t.color.*, t.font.*, helpers
│   │   ├── resources/useResource.ts       ← Generic CRUD hook for any backend resource
│   │   ├── resources/useToggle.ts         ← Like/follow toggle with optimistic update
│   │   ├── resources/types.ts             ← TypeScript interfaces (User, Post, Product, etc.)
│   │   ├── components/                    ← domain/, primitives/, shell/
│   │   └── hooks/                         ← useAuth, useNotifications, useShelves, etc.
│   └── package.json
│
├── Community/                             ← COMMUNITY BACKEND (CRUD Utopia)
│   ├── COMMUNITY_SPEC.md
│   └── coffee-community-api/
│       ├── main.py                        ← FastAPI app (57 lines — router registration only)
│       ├── database.py                    ← SQLite schema + migrations
│       ├── models.py                      ← Pydantic models
│       ├── resources/
│       │   ├── registry.py                ← 20 declarative resource definitions
│       │   ├── crud.py                    ← Generic SQL engine (joins, counts, flags, embeds)
│       │   └── envelope.py                ← { data, meta } response wrapper
│       ├── routes/
│       │   ├── resources.py               ← Auto-generated CRUD endpoints from registry
│       │   ├── specific.py                ← Fixed routes (feed, follow, profiles, catalog)
│       │   ├── auth.py, uploads.py, dictionary_routes.py
│       ├── services/
│       │   ├── auth.py                    ← Token verification, user context
│       │   ├── notifications.py           ← Hook-driven notification dispatch
│       │   └── catalog_sync.py            ← Product catalog import from scraper output
│       ├── dictionary.py                  ← 51 flavor tags, brew methods, drink styles
│       ├── requirements.txt
│       └── uploads/                       ← User-uploaded files (gitignored)
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
- Python 3.9+
- Node.js 18+
- Google Places API key (for roaster discovery — optional)

### 1. Install dependencies
```bash
# Backend
pip install fastapi uvicorn passlib bcrypt python-multipart sse-starlette
pip install requests beautifulsoup4 lxml openpyxl

# Crema App (React Native)
cd crema-app && npm install
```

### 2. Start the backend
```bash
cd Community/coffee-community-api
uvicorn main:app --host 0.0.0.0 --port 8000
```
API at http://localhost:8000 (Swagger docs at `/docs`).

### 3. Start the Crema App
```bash
cd crema-app
npx expo start --web --port 8082
```
Web at http://localhost:8082. For native: scan the QR code with Expo Go.

### 4. Register and start using
1. Open http://localhost:8082
2. Create an account (username + password)
3. Browse coffees, add to shelf, write tasting notes, follow roasters, compose posts

### 5. Run the scraper (optional)
```bash
curl -N http://localhost:8000/api/refresh
```
Full pipeline: Google Places discovery, website verification, profile enrichment, product scraping. Takes ~5-8 minutes via SSE.

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

## The Community Backend (CRUD Utopia)

### Architecture

The backend uses a **declarative resource registry** instead of hand-written endpoints per feature. Every CRUD resource (posts, comments, likes, shelves, notes, follows, notifications, products, roaster profiles, click events) is declared once in `registry.py` with its fields, auth rules, joins, counts, flags, and hooks. A generic SQL engine in `crud.py` reads these declarations and generates queries. Auto-generated endpoints in `routes/resources.py` provide list/get/create/update/delete/toggle for all 20 resources.

```python
# Example: adding a new resource is ~20 lines, not a new router file
"post_comments": {
    "table": "post_comments",
    "fields": { "comment": {"type": "str", "required": True}, ... },
    "auth": {"list": None, "create": "required", "update": "owner", "delete": "owner"},
    "owner": "user_id",
    "joins": [{"table": "users", "alias": "user", "on": "user_id",
               "fields": ["username", "display_name", "avatar_url"]}],
    "counts": [{"name": "like_count", "table": "comment_likes", "fk": "comment_id"}],
    "flags": [{"name": "liked_by_me", "table": "comment_likes", "fk": "comment_id", "user_col": "user_id"}],
}
```

### Response envelope

Every endpoint returns the same shape. The frontend needs exactly one unwrapping pattern (`res?.data ?? res`):

```json
{ "data": [ ... ], "meta": { "resource": "posts", "total": 148, "limit": 20, "offset": 0 } }
```

### Technology
- **FastAPI** with Swagger docs at `/docs`
- **SQLite** — single file, zero config
- **bcrypt** password hashing, UUID4 session tokens (30-day expiry)

### CRUD resources (20 total)
| Resource | Type | Features |
|---|---|---|
| `posts` | CRUD | author join, like/comment/repost counts, `liked_by_me` flag, `original_post` embed |
| `post_likes` | Toggle | Notifications on like |
| `post_comments` | CRUD | user join, like count, `liked_by_me` flag, notifications |
| `comment_likes` | Toggle | Notifications |
| `follows` | Toggle (by slug) | Notifications on follow |
| `shelves` | CRUD | Grouped by shelf category (currently_drinking/drank/want_to_try) |
| `tasting_notes` | CRUD | Author join, like count, `liked_by_me` flag |
| `note_likes` | Toggle | |
| `note_comments` | CRUD | |
| `notifications` | CRUD | Actor join, read status |
| `products` | CRUD | Unified catalog (scraped + roaster-created) |
| `roaster_profiles` | CRUD | |
| `click_events` | Write-only | Outbound click tracking |

### Fixed routes (specific.py)
Feed timeline, follow/unfollow, user posts/likes/comments, roaster posts, product popularity, roaster directory, notification management, catalog sync.

### Tasting note dictionary
51 flavor tags, 15 drink styles, 8 milk types, 6 grind sizes, 12 brew methods.

---

## The Crema App (React Native)

The primary frontend. Built with Expo (SDK 54), React Native 0.81, TypeScript, and Expo Router for file-based navigation.

### Screens
| Path | Screen | Description |
|---|---|---|
| `/` | Feed | Post timeline with compose, like, comment, repost |
| `/browse` | Browse | Beans tab (search, filter by roast/process/origin) + Roasters tab |
| `/profile` | My Shelf | Own profile with shelves, posts, following, edit capabilities |
| `/auth` | Auth | Login / register toggle |
| `/coffee/:id` | Coffee Detail | Product info, shelf management, tasting notes, related |
| `/roaster/:slug` | Roaster Profile | Split panel: info/follow left, posts/products right |
| `/user/:username` | User Profile | Public profile with posts/likes/comments tabs |

### Design token system

All visual values live in `design-tokens.json` — a language-agnostic JSON file that can be read by React Native, Swift, or Kotlin:

| Token | Value | Usage |
|---|---|---|
| `color.bg` | `#FAF8F0` | Warm off-white background |
| `color.text.primary` | `#351101` | Dark brown text |
| `color.accent` | `#D798DA` | Purple — icons, interactive elements |
| `color.accent.cta` | `#C8553D` | Rust red — CTA buttons, important actions |
| `color.navbar.bg` | `#351101` | Dark brown navbar |
| `font.display` | `CanelaText_Regular` | Coffee names, headings |
| `font.body.regular` | `Inter_400Regular` | Body text |

### Frontend patterns

- **`useResource<T>(name)`** — generic hook that works for any backend resource. Returns `{ data, loading, error, total, refetch, create, update, remove }`.
- **`useToggle(resource, id)`** — like/follow with optimistic update and rollback.
- **`apiFetchRaw(path)`** — centralized fetch with auth token injection. Cross-platform (iOS, Android, web).
- **`t.color.*`, `t.font.*`** — direct token access. Helpers: `font()`, `shadow()`, `sp()`, `rad()`, `sz()`.

---

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

All endpoints prefixed with `/api`. Interactive docs at http://localhost:8000/docs. Every response is envelope-wrapped: `{ "data": ..., "meta": { "resource", "total", "limit", "offset" } }`.

### Generic CRUD (auto-generated from registry)

For any resource `R` in the registry:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/{R}` | List with pagination (`?limit=20&offset=0`) and filters |
| GET | `/api/{R}/{id}` | Get single by ID |
| POST | `/api/{R}` | Create (auth required per resource config) |
| PUT | `/api/{R}/{id}` | Update (owner-only per resource config) |
| DELETE | `/api/{R}/{id}` | Delete (owner-only per resource config) |
| POST | `/api/{R}/{id}/toggle` | Toggle on/off (for like/follow resources) |

Resources: `posts`, `post_comments`, `shelves`, `tasting_notes`, `note_comments`, `notifications`, `products`, `roaster_profiles`, `click_events`. Toggle resources: `post_likes`, `comment_likes`, `note_likes`, `follows`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account (username, display_name, password) |
| POST | `/api/auth/login` | Login (returns session token) |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/profile` | Update profile fields |

### Social & Feed
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/feed-timeline` | Combined posts feed (sorted by date) |
| GET | `/api/users/{username}/posts` | Posts by a user |
| GET | `/api/users/{username}/likes` | Posts liked by a user |
| GET | `/api/users/{username}/comments` | Comments by a user |
| GET | `/api/roasters/{slug}/posts` | Posts by a roaster |
| POST | `/api/roasters/{slug}/follow` | Toggle follow on a roaster |
| GET | `/api/my-following` | Roasters/users the current user follows |
| GET | `/api/follow-status/{slug}` | Check if current user follows a roaster |
| PUT | `/api/posts/{post_id}/pin` | Toggle pin on a post |

### Comments
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/posts/{id}/comments` | Comments on a post |
| POST | `/api/posts/{id}/comments` | Add a comment |
| PUT | `/api/post-comments/{id}` | Edit a comment |
| DELETE | `/api/post-comments/{id}` | Delete a comment |
| POST | `/api/post-comments/{id}/like` | Like a comment |

### Products & Roasters
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/products` | All products (scraped + roaster-created) |
| GET | `/api/roasters` | All roasters (profiles + products merged) |
| GET | `/api/products/popularity` | User count per product |
| GET | `/api/products/{id}/users` | Users on a product's shelf + their notes |
| POST | `/api/roasters/{slug}/products` | Create product (owner only) |
| DELETE | `/api/roasters/{slug}/products/{id}` | Delete product (owner only) |
| PUT | `/api/roasters/{slug}/profile` | Update roaster profile (owner only) |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notification-count` | Unread notification count |
| POST | `/api/notifications-mark-read` | Mark all notifications as read |
| POST | `/api/notification-read/{id}` | Mark single notification as read |

### Other
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/upload/avatar` | Upload profile photo (multipart form) |
| POST | `/api/upload/image` | Upload image for posts/hero (multipart form) |
| POST | `/api/clicks` | Log outbound click (fire-and-forget) |
| GET | `/api/dictionary/brew-methods` | Tasting vocabulary |
| GET | `/api/link-preview?url=X` | Open Graph metadata for a URL |

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

*Built with Claude Code.*
