# Crema — Community Layer Specification

**Version:** 2.0 (reflects actual implementation)
**Last Updated:** April 2026
**Component:** FastAPI Backend + React Community Features

---

## 1. Overview

The community layer adds social features to Crema: user accounts, coffee shelves (Open Bags / On the List), detailed tasting notes with full brew recipes, a social post feed, user profiles, popularity tracking, and a recommendations engine.

> **Note (2026-04-29):** This spec is the **consumer community
> layer** only — auth, shelves, tasting notes, feed, dictionary,
> click tracking — which is exactly the Phase 1 survival surface
> after the café-deferral pivot in `NORTH_STAR.md` (rewritten
> 2026-04-29). Café / wholesale / stamps / loyalty / business-chat
> surfaces were added to the codebase *after* this spec was
> written and are being removed in `BUILD_ROADMAP.md` §2.42
> (deferred to a future Phase N redesign-from-scratch).
>
> Spec is otherwise out-of-sync with the current frontend
> (originally written for the v0 React/Vite app; current app is
> React Native / Expo on a CRUD Utopia backend) and missing
> several backend additions that postdate it (post types, social
> graph, notifications, brew methods, follows, DMs). A general
> refresh is owed but is **not** part of the café-removal pivot.
> Currently still accurate as written: shelf model, tasting-note
> schema, dictionary, click events, avatar upload. Shelf
> categories simplified from three (currently_drinking / drank /
> want_to_try) to two (open_bags / on_the_list). See the root
> `README.md` and `crema-app/README.md` for current architecture.

**Backend:** FastAPI + SQLite + bcrypt (direct, no passlib)
**Frontend:** React components integrated into the main app, auth-gated via `AuthGuard`

---

## 2. Backend Architecture

### Technology

| Component | Implementation |
|---|---|
| Framework | FastAPI |
| Database | SQLite (single file, `community.db`) |
| Auth | bcrypt password hashing (direct `bcrypt.hashpw`/`bcrypt.checkpw`, not passlib) + UUID4 session tokens |
| File uploads | FastAPI `UploadFile` for avatar photos |
| SSE streaming | `sse-starlette` for live scraping progress |

### Directory Structure

```
Community/coffee-community-api/
├── main.py              # FastAPI app: all endpoints, CORS, routers, recommendations, feed, refresh
├── database.py          # SQLite schema, migrations, init
├── auth.py              # Registration, login, sessions, profile update
├── tasting_notes.py     # Tasting note CRUD with validation
├── dictionary.py        # Flavor/brew vocabulary + validation + API
├── models.py            # Pydantic request/response models
└── uploads/             # Avatar photo storage (gitignored)
```

---

## 3. Database Schema (`database.py`)

### Tables

#### `users`
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    bio TEXT,
    avatar_url TEXT,
    location TEXT,
    coffee_preference TEXT,
    brewing_style TEXT
);
```

#### `sessions`
```sql
CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
```
Session duration: 30 days. Token: UUID4.

#### `shelf_entries`
```sql
CREATE TABLE shelf_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    shelf TEXT NOT NULL CHECK(shelf IN ('currently_drinking', 'drank', 'want_to_try')),
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, product_id)
);
```

#### `tasting_notes`
```sql
CREATE TABLE tasting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    comment TEXT,
    acidity INTEGER CHECK(acidity BETWEEN 1 AND 5),
    body INTEGER CHECK(body BETWEEN 1 AND 5),
    sweetness INTEGER CHECK(sweetness BETWEEN 1 AND 5),
    aftertaste INTEGER CHECK(aftertaste BETWEEN 1 AND 5),
    flavor_tags TEXT,              -- JSON array of strings
    brew_method TEXT,
    drink_style TEXT,
    milk_type TEXT,
    dose_grams REAL,
    yield_grams REAL,
    water_volume_ml REAL,
    water_temp_celsius REAL,
    extraction_time_seconds INTEGER,
    grind_size TEXT,
    brew_ratio TEXT,
    blend_components TEXT,         -- JSON array of {product_id, percentage}
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
```

#### `click_events`
```sql
CREATE TABLE click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT,
    roaster_slug TEXT,
    source_page TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Migrations

Schema evolution via `ALTER TABLE ... ADD COLUMN` wrapped in try/except (idempotent). Columns added:
- `users`: bio, avatar_url, location, coffee_preference, brewing_style
- `tasting_notes`: blend_components

---

## 4. Authentication (`auth.py`)

### Password Hashing

Direct bcrypt usage (passlib removed due to bcrypt 4.x incompatibility):

```python
class _BcryptCompat:
    @staticmethod
    def hash(password):
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def verify(password, hash):
        return bcrypt.checkpw(password.encode(), hash.encode())
```

### Endpoints

#### `POST /api/auth/register`
```json
Request:  { "username": "swaraj", "display_name": "Swaraj", "password": "..." }
Response: { "token": "uuid4", "user": { ... } }
```
Creates user + 30-day session. Username must be unique, 3-20 chars, alphanumeric + underscore.

#### `POST /api/auth/login`
```json
Request:  { "username": "swaraj", "password": "..." }
Response: { "token": "uuid4", "user": { ... } }
```

#### `GET /api/auth/me`
Returns current user (requires Bearer token).
```json
Response: { "id": 1, "username": "swaraj", "display_name": "Swaraj", "bio": "...", "avatar_url": "...", ... }
```
**Important:** Uses `SELECT u.*` to include all profile columns (not just id/username).

#### `PUT /api/auth/profile`
Updates profile fields: `display_name`, `bio`, `avatar_url`, `location`, `coffee_preference`, `brewing_style`.

### Dependencies

- `get_current_user(token)` — validates Bearer token, returns user dict or 401
- `get_optional_user(token)` — returns user or None (for public endpoints)

---

## 5. Shelves

### Endpoints

#### `GET /api/shelves`
Returns current user's shelves:
```json
{
    "currently_drinking": [{ "id": 1, "product_id": "blue-tokai_attikan", "added_at": "..." }],
    "drank": [...],
    "want_to_try": [...]
}
```

#### `GET /api/shelves/users/{username}`
Returns another user's shelves (public).

#### `POST /api/shelves`
```json
Request: { "product_id": "blue-tokai_attikan", "shelf": "currently_drinking" }
```
Moves product to the specified shelf (upserts — if already on a different shelf, moves it).

#### `DELETE /api/shelves/{entry_id}`
Removes a shelf entry.

---

## 6. Tasting Notes (`tasting_notes.py`)

### Endpoints

#### `GET /api/notes?product_id={id}`
Returns all notes for a product (public).

#### `GET /api/notes/mine`
Returns current user's notes across all products.

#### `POST /api/notes`
Creates a tasting note. All fields optional except `product_id`.

```json
{
    "product_id": "blue-tokai_attikan",
    "comment": "Beautiful morning cup. The citrus notes really pop as an espresso.",
    "drink_style": "espresso",
    "brew_method": "espresso-machine",
    "milk_type": "none",
    "dose_grams": 18,
    "yield_grams": 36,
    "extraction_time_seconds": 28,
    "grind_size": "fine",
    "water_temp_celsius": 93,
    "acidity": 4,
    "body": 3,
    "sweetness": 4,
    "aftertaste": 3,
    "flavor_tags": ["citrus", "chocolate", "caramel"],
    "blend_components": [
        { "product_id": "blue-tokai_attikan", "percentage": 60 },
        { "product_id": "nada_gangecool", "percentage": 40 }
    ]
}
```

**Validation:**
- `flavor_tags` validated against `dictionary.py` flavor list (51 tags)
- `drink_style` validated against 15 styles
- `brew_method` validated against 12 methods
- `milk_type` validated against 8 types
- `grind_size` validated against 6 sizes
- `blend_components` percentages must sum to 100
- Physical attributes (acidity/body/sweetness/aftertaste): 1-5 scale

#### `PUT /api/notes/{note_id}`
Updates a note (owner only).

#### `DELETE /api/notes/{note_id}`
Deletes a note (owner only).

---

## 7. Tasting Dictionary (`dictionary.py`)

### Flavor Tags (51 total)

Organized in a hierarchical flavor wheel:

| Category | Tags |
|---|---|
| Fruity > Berry | strawberry, blueberry, raspberry, blackberry |
| Fruity > Citrus | lemon, orange, grapefruit, lime, tangerine |
| Fruity > Stone Fruit | peach, apricot, plum, cherry |
| Fruity > Tropical | mango, pineapple, passion-fruit, coconut, lychee |
| Fruity > Dried Fruit | raisin, fig, date, prune |
| Floral | jasmine, rose, lavender, honeysuckle, bergamot |
| Sweet | honey, caramel, brown-sugar, maple, molasses, vanilla, toffee |
| Nutty | almond, hazelnut, walnut, peanut, cashew |
| Chocolate | dark-chocolate, milk-chocolate, cocoa, white-chocolate |
| Spices | cinnamon, cardamom, clove, black-pepper, nutmeg, ginger |
| Roasted | smoky, tobacco, burnt-sugar, malt, toast |
| Earthy & Woody | cedar, oak, leather, mushroom, moss |
| Green & Herbal | green-tea, mint, basil, sage, grass |

### Brew Methods (12)
pour-over, french-press, aeropress, espresso-machine, moka-pot, cold-brew, siphon, turkish, drip-machine, chemex, south-indian-filter, instant

### Drink Styles (15)
black, espresso, americano, lungo, ristretto, cortado, macchiato, cappuccino, flat-white, latte, mocha, cold-brew, iced-latte, filter-coffee, pour-over

### Milk Types (8)
none, whole, skim, oat, almond, soy, cashew, coconut

### Grind Sizes (6)
extra-fine, fine, medium-fine, medium, medium-coarse, coarse

### Physical Attributes (1-5 scales)
| Attribute | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Acidity | Flat | Low | Balanced | Bright | Electric |
| Body | Tea-like | Light | Medium | Full | Syrupy |
| Sweetness | Absent | Faint | Moderate | Sweet | Intense |
| Aftertaste | Clean | Short | Medium | Long | Lingering |

### Endpoints

- `GET /api/dictionary/flavors` — hierarchical flavor wheel
- `GET /api/dictionary/brew-methods` — brew method list
- `GET /api/dictionary/drink-styles` — drink style list
- `GET /api/dictionary/milk-types` — milk type list
- `GET /api/dictionary/grind-sizes` — grind size list
- `GET /api/dictionary/attributes` — physical attribute scales
- `GET /api/dictionary/all` — combined dictionary

---

## 8. Products & Roasters API (`main.py`)

### `GET /api/products`

Returns all coffee products with corrections applied at read time:

1. Load `products.json` (scraper output)
2. Load `manual_products.json` (hand-entered)
3. Merge manual products (append)
4. Load `product_corrections.json`
5. Apply corrections: for each correction, find matching product by `product_id` and merge fields

### `GET /api/roasters`

Returns all roasters with corrections, dedup, and manual entries merged:

1. Load `verified_roasters_catalog.json` (catalog output)
2. Derive additional roasters from products (roasters that appear in products but not catalog)
3. Load `manual_roasters.json`
4. Merge manual roasters
5. Load `roaster_corrections.json`, apply corrections
6. Load `roaster_dedup.json`, remove duplicate slugs

---

## 9. Recommendations Engine (`main.py`)

### `GET /api/recommendations?source={source}&limit={limit}&for_user={username}`

**Sources:**

#### `source=self` (My Shelf recommendations)
Cross-references user's shelf with all products. Finds similar coffees by:
1. Same roaster (different product)
2. Same origin
3. Same process
4. Random discovery

Excludes products already on user's shelf. Applies **novelty scoring**: products NOT from any roaster on the user's shelf get `_novel: true`.

#### `source=community` (Feed recommendations)
Same algorithm but aggregates across ALL users' shelves. Higher weight for frequently-shelved attributes.

#### `source=user` (Other user's profile)
Recommendations based on a specific user's shelf (used on `/user/:username`).

**Response:**
```json
[
    {
        "product_id": "blue-tokai_attikan",
        "coffee_name": "Attikan Estate",
        "roaster_name": "Blue Tokai",
        ...all product fields...,
        "_novel": true,
        "_reason": "Same origin as coffees on your shelf"
    }
]
```

---

## 10. Feed (`main.py`)

### `GET /api/feed/timeline`

Returns the 50 most recent tasting notes across all users, ordered newest to oldest.

```json
{
    "timeline": [
        {
            "note_id": 42,
            "user": { "username": "swaraj", "display_name": "Swaraj", "avatar_url": "..." },
            "product_id": "blue-tokai_attikan",
            "coffee_name": "Attikan Estate",
            "roaster_name": "Blue Tokai",
            "image_url": "...",
            "comment": "Beautiful morning cup...",
            "drink_style": "espresso",
            "flavor_tags": ["citrus", "chocolate"],
            ...all note fields...,
            "created_at": "2026-04-05T09:30:00"
        }
    ]
}
```

---

## 11. Popularity & User Tracking

### `GET /api/products/popularity`
Returns a map of `{ product_id: user_count }` for all products on any user's shelf.

### `GET /api/products/{product_id}/users`
Returns detailed list of users who have a specific product on their shelf, with their tasting notes:

```json
{
    "users": [
        {
            "username": "swaraj",
            "display_name": "Swaraj",
            "avatar_url": "...",
            "location": "Goa",
            "shelf": "currently_drinking",
            "notes": [
                { "id": 42, "comment": "...", "flavor_tags": [...], ... }
            ]
        }
    ]
}
```

---

## 12. Click Tracking

### `POST /api/clicks`
```json
{ "product_id": "blue-tokai_attikan", "roaster_slug": "blue-tokai", "source_page": "card_front" }
```

Fire-and-forget analytics. `source_page` values: `card_front`, `coffee_page`, `roaster_page`.

---

## 13. Avatar Upload

### `POST /api/auth/avatar`
Accepts `multipart/form-data` with an image file. Saves to `uploads/` directory. Returns the avatar URL path which is stored in the user's profile.

---

## 14. Frontend Community Components

### 14.1 FeedPage (`FeedPage.jsx`)

**Layout:** 2-column on desktop (feed + recommendations), single column on mobile.

**Feed column:**
- Temporal timeline of tasting notes (newest first)
- Each feed card: user avatar + name + location → coffee image + name + roaster + price → tasting note display
- Clicking user links to `/user/{username}`
- Clicking coffee links to `/coffee/{productId}`
- Buy button with ShoppingCart icon

**Recommendations column:**
- `RecommendationPanel` with `source="community"`, `count={10}`
- Independently scrollable

### 14.2 MyShelfPage (`MyShelfPage.jsx`)

**Layout:** 3-column desktop layout.

| Column | Width | Behavior |
|---|---|---|
| Left: ProfileCard | ~240px | Sticky, shows avatar/bio/stats |
| Center: Shelf Feed | flex-1 | Scrollable, shelf islands |
| Right: Recommendations | ~280px | Sticky, independently scrollable |

**Shelf Tabs:**
Three tabs in a single card island row: Currently Drinking, Drank, Want to Try. Always one active (defaults to `currently_drinking`). Each tab shows icon + label + count in a single compact line.

**Shelf Content (ShelfIsland):**
For the active tab, renders `ShelfIsland` components for each shelf entry.

### 14.3 UserProfilePage (`UserProfilePage.jsx`)

Same 3-column layout as MyShelfPage but read-only. Recommendations use `source=user&for_user={username}`.

### 14.4 ShelfIsland (`ShelfIsland.jsx`)

Two-column card layout:
- **Left:** Large product image + coffee details + action buttons (Buy, Add to shelf, Share)
- **Right:** Tasting notes journal — all notes for this product by this user, fetched on mount

Roaster name is a `<Link>` to `/roaster/{slug}`.

Notes are always expanded (no collapse toggle). Each note rendered as `TastingNoteDisplay`.

### 14.5 TastingNoteForm (`TastingNoteForm.jsx`)

**Two modes:**

**Light mode (always visible):**
- Comment textarea
- Drink style dropdown
- Brew method dropdown
- Milk type dropdown

**Advanced mode (collapsible via "Show advanced" button):**
- Recipe grid: dose, yield, water volume, water temp, extraction time
- Grind size dropdown
- Brew ratio input
- Physical attribute sliders (acidity, body, sweetness, aftertaste): 1-5 with step labels
- Flavor tag picker: searchable, multi-select, grouped by category

### 14.6 TastingNoteDisplay (`TastingNoteDisplay.jsx`)

**Always-visible section:**
- Comment text (the story, prominently displayed)
- Drink line: "{drink_style} via {brew_method}" with optional milk type
- Flavor tags as colored chips
- Date formatted as ordinal: "5th April, 2026"

**Collapsible "Show brew details" section:**
- Recipe grid: dose, yield, water, temp, time, grind, ratio
- Physical attribute bars (visual 1-5 scale with labels)
- Blend components (if present): "60% Attikan + 40% Gangecool"

**Edit/Delete buttons** (owner only).

### 14.7 ProfileCard (`ProfileCard.jsx`)

Full-bleed avatar as card background with cream semi-opaque overlay for bio content.

**Content:**
- Avatar (full card background, or placeholder initial)
- Display name + @username
- Location (MapPin icon)
- Bio text
- Coffee preference + brewing style
- Stats: "{N} coffees tried", "Since {month} '{year}"
- Edit button (pencil icon, top-right corner) → opens ProfileEditForm

### 14.8 ImageCropModal (`ImageCropModal.jsx`)

Uses `react-easy-crop` for avatar photo uploads:
- Circular crop area
- Trackpad-native zoom/pan (no zoom bar)
- Floating Cancel/Done buttons
- Click anywhere outside to dismiss
- Returns cropped blob for upload

### 14.9 RecommendationPanel (`RecommendationPanel.jsx`)

Compact MiniCard format (200px tall):
- Horizontal layout: image left, details right
- "New to you" badge (for `_novel: true`)
- Icon-only action buttons: `+` (add to shelf), ShoppingCart (buy), Share2 (share)
- Roaster name as hyperlink to `/roaster/{slug}`
- Independently scrollable container with `overflow-y: auto`

### 14.10 PopularityModal (`PopularityModal.jsx`)

Shows who has a coffee on their shelf. Rendered via `createPortal` to escape card CSS context.

- Fixed overlay: `z-[100]`, `height: 70vh`, `maxHeight: 600px`
- Scrollable user list with `flex: 1 1 0, minHeight: 0`
- Each user: avatar, name, location, shelf label (color-coded), tasting notes

### 14.11 ShelfSelector (`ShelfSelector.jsx`)

Dropdown on the CoffeeCard back face for adding/moving coffees between shelves.

### 14.12 QuickAddModal (`QuickAddModal.jsx`)

Search modal for adding coffees to a shelf without navigating:
- Searchable product list (first 12 or 15 search results)
- Shows coffee image, name, roaster
- Add button with checkmark feedback

---

## 15. Frontend Hooks

### `useAuth()` — Auth Context

**State:** `user`, `backendAvailable`, `loading`

**Functions:**
- `login(username, password)` → POST `/auth/login`
- `register(username, display_name, password)` → POST `/auth/register`
- `logout()` → clears token + state
- `updateProfile(fields)` → PUT `/auth/profile`

**Session probe:** On mount, tries `GET /dictionary/brew-methods` to check backend availability, then `GET /auth/me` to restore session.

### `useShelves()` — Shelf CRUD

**State:** `shelves = { currently_drinking: [], drank: [], want_to_try: [] }`

**Functions:**
- `fetchShelves()` → GET `/shelves`
- `fetchUserShelves(username)` → GET `/shelves/users/{username}`
- `addToShelf(productId, shelfKey)` → POST `/shelves`
- `removeFromShelf(entryId)` → DELETE `/shelves/{entryId}`
- `getShelfForProduct(productId)` → returns shelf key or null

### `useRecommendations()` — Recommendations Fetcher

**State:** `recommendations` array, `loading`

**Function:** `fetchRecommendations(source, forUser, limit)` → GET `/recommendations?source={}&limit={}&for_user={}`

---

## 16. Unified Refresh (`main.py`)

### `POST /api/refresh`

Runs the full pipeline (catalog discovery + product scraping) via SSE streaming:

1. **Phase 1-4 (Catalog):** Import catalog modules via `importlib.util.spec_from_file_location` to avoid module name collisions
2. **Purge modules:** Clear cached catalog modules from `sys.modules`
3. **Product scraping:** Import and run `scrape_all_generator()`
4. **Background thread:** Entire pipeline runs in a separate thread to avoid blocking FastAPI event loop

**SSE events:**
```
event: catalog_phase
data: {"phase": "discovery", "status": "running"}

event: catalog_phase
data: {"phase": "verification", "status": "complete", "verified": 31}

event: roaster_start
data: {"roaster": "Blue Tokai", "index": 1, "total": 31}

event: roaster_done
data: {"roaster": "Blue Tokai", "products": 45}

event: complete
data: {"total_products": 559}
```

---

## 17. CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

The backend runs on port 8000. The frontend Vite dev server runs on port 5173. CORS allows all origins for LAN development.

---

## 18. Blend Model

Blends live in tasting notes (not the shelf). When writing a note, the user toggles "This is a blend" and adds coffees with percentages.

**Storage:** JSON in `blend_components` column:
```json
[
    { "product_id": "blue-tokai_attikan", "percentage": 60 },
    { "product_id": "nada_gangecool", "percentage": 40 }
]
```

**Validation:** Percentages must sum to 100. Each `product_id` must exist.

**Display:** "60% Attikan Estate + 40% Gangecool" in TastingNoteDisplay.

---

## 19. Roaster Articles — Discover JOURNAL

The third Discover sub-tab. Articles are scraped from each roaster's
own blog/journal by the article-scraper pipeline (see
`specs/SCRAPER_SPEC.md` §13). They surface as a chronological feed
in `app/(tabs)/browse.tsx#JournalList`, render as `ArticleCard`s, and
open a full-page reader at `app/article/[id].tsx`.

### Tables

#### `roaster_articles`
```sql
CREATE TABLE roaster_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roaster_slug TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,                    -- dedup key
    title TEXT NOT NULL,
    excerpt TEXT,
    image_url TEXT,
    body_html TEXT,                              -- cleaned HTML
    word_count INTEGER,
    published_at TEXT,                           -- ISO from feed/og/<time>
    scraped_at TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,        -- admin curation flag
    enrichment_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_roaster_articles_roaster ON roaster_articles(roaster_slug);
CREATE INDEX idx_roaster_articles_published_at ON roaster_articles(published_at DESC);
CREATE INDEX idx_roaster_articles_published ON roaster_articles(published);
```

`roaster_sources` gains five discovery-state cache columns so
subsequent scrapes skip enumeration:
- `articles_index_url TEXT` — the discovered Atom/RSS/sitemap URL.
- `articles_feed_kind TEXT` — `'rss' | 'atom' | 'sitemap' | 'html'`.
- `articles_handles TEXT` — JSON array of Shopify blog handles when
  the discovery picked the multi-handle sitemap path.
- `last_articles_scraped_at TEXT`.
- `articles_count INTEGER NOT NULL DEFAULT 0` — denormalized so the
  admin Roasters & Beans list doesn't `JOIN+COUNT` per row.

### Public endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/articles?limit=&before=&roaster_slug=` | Chronological feed. Newest first by `COALESCE(published_at, scraped_at)`. Excludes `body_html` for payload size. Capped at 500 per call (the sitewide `RoasterArticlesProvider` fetches the full set in one request). |
| `GET /api/articles/{id}` | Single article including `body_html` — what the in-app reader fetches. |
| `GET /api/roasters/{slug}/articles?limit=` | Per-roaster article list, same shape as the feed but filtered server-side. |

All three gate on `roaster_articles.published = 1 AND
roaster_profiles.published = 1` so unreviewed roasters' articles
never leak even via deep link.

### Admin endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/articles/scrape-all` | Bulk article scrape across every enabled `roaster_sources` row. Body `{ force_enrich?: bool }` — when true, re-runs Haiku for every URL even if it's already `enrichment_status='enriched'`. Same conflict + `BackgroundTasks` shape as `/admin/scrape/run`; only one `article_scrape` may be live at a time. |
| `POST /api/admin/roasters/{slug}/scrape-articles` | Per-roaster article scrape. Per-row Refresh button on the Articles sub-tab posts here. Same `force_enrich` body field as the bulk endpoint. |
| `GET /api/admin/articles?roaster_slug=&include_hidden=` | Admin list. `include_hidden=1` (default) returns `published=0` rows so the admin sees what they hid. |
| `POST /api/admin/articles/{id}/publish` | Toggle visibility. Body `{ published: 0 \| 1 }`. |
| `DELETE /api/admin/articles/{id}` | Hard-delete. Re-scrape will re-insert if the URL still resolves; use this for truly stale entries, not for hiding. |

### Job kind

`jobs.kind = 'article_scrape'`. Same `queued → running → succeeded`
lifecycle as the catalog scrape. `result_summary` carries:
- `roasters_processed: int`
- `articles_inserted: int`
- `articles_updated: int`
- `articles_skipped: int` — already-enriched URLs that the
  skip-cheap path bypassed (no fetch, no Haiku, no WebP)
- `discoveries: int` — first-time discovery count (cached on
  `roaster_sources` for subsequent runs)
- `enriched: int` — articles where the Haiku tool-use call
  returned a clean payload and was used as the canonical body
- `enrich_failed: int` — articles where Haiku errored or
  returned None; row is written with the bs4 fallback body and
  `enrichment_status='failed'` for re-run with `force_enrich`
- `not_article_skipped: int` — articles where Haiku returned
  `is_article=false` (mis-classified URLs — category landings,
  404s, product listings)
- `errors: list[{slug, url?, message}]`

### Enrichment status flow

| `enrichment_status` | Set when |
|---|---|
| `pending` | Initial column default; never set by the scraper directly. |
| `enriched` | Haiku returned `is_article=true` with a valid `body_html`. The skip-cheap path on subsequent runs reads this to bypass HTTP / Haiku / WebP entirely (set `force_enrich=true` on the admin endpoint to override). |
| `failed` | Haiku call errored, returned None, or the SDK / `ANTHROPIC_API_KEY` were unavailable. Row carries the bs4-fallback body so the article still surfaces in JOURNAL — re-run with `force_enrich=true` to retry the LLM call. |

### Hero image pipeline

Each article's hero is downloaded once at scrape time, converted to
WebP via Pillow @ quality 82, and persisted under
`Community/coffee-community-api/uploads/articles/<uuid>.webp`
(mounted at `/uploads/articles/`). The `image_url` column then
stores the local path so the consumer endpoint serves a resized,
already-cached asset instead of hot-linking the roaster's CDN.

URL-form retry: when the original download fails, the helper tries
`https://`-forced + dropped-`www.` variants before giving up.
Recovers stale `http://www....` URLs that Haiku occasionally
relays from in-body `<img src=...>` tags even when the canonical
asset lives at `https://...` (Black Baza's mixed-form CDN paths
were the motivating case).

Frontend renders the local path through `resolveUploadUrl()` →
`thumbnailUrl()`: the resolve adds the API origin, the thumbnail
helper passes through unchanged for non-Shopify hosts (the
Shopify `?width=N` resize only applies to live Shopify CDN URLs).

### Frontend wiring

- `RoasterArticlesProvider` (`src/hooks/useRoasterArticles.tsx`)
  is mounted at `app/_layout.tsx`. Eager fetch on mount; SWR via
  `refetch({ silent })`; merges full payloads back from the reader's
  per-id fetch via `upsert(article)`.
- `ArticleCard` (`src/components/domain/ArticleCard.tsx`) — hero +
  display title + RoasterLogo meta row + 2-line excerpt. Hero
  resized via `thumbnailUrl(image_url, 800)` (see
  `src/utils/imageUrl.ts`).
- Reader (`app/article/[id].tsx`) — floating back FAB on hero,
  body rendered via `htmlToBlocks` (`src/utils/htmlToBlocks.ts`)
  which walks the cleaned HTML and emits a flat list of native
  blocks (heading, paragraph, list, image, quote, hr). The bottom
  "Read the original on {domain}" CTA is the escape hatch for
  markup the renderer drops; tapping it fires `trackClick` with
  `source_page='article'`.
- Admin: `ArticlesPanel` (`src/components/admin/ArticlesPanel.tsx`)
  hosts the bulk Refresh CTA + per-roaster row list +
  `RecentEnrichmentRuns` scoped to `kind='article_scrape'`.
