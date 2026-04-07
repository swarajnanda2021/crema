# Indian Specialty Coffee Aggregator — Community Layer Specification

**Version:** 1.0  
**Date:** April 5, 2026  
**Status:** Draft for Review  
**Component:** User Community Layer (Backend + Frontend Extension)  
**Depends on:** SCRAPER_SPEC.md (produces the product catalog), UI_SPEC.md (the existing frontend this extends)

---

## Core Idea

The discovery UI (UI_SPEC.md) solves one problem: finding Indian specialty coffee. But the people who drink it have no shared space to document, compare, and discuss what they're drinking. Roasters are easy to find — their websites exist. Users aren't. This spec creates the user layer.

Think of it as a **coffee journal that two people can share on the same WiFi**. Each user maintains a shelf of coffees (Currently Drinking, Drank, Want to Try), writes structured tasting notes using a standardized vocabulary, and can see what their partner is drinking. Every coffee card links back to the roaster's product page, driving traffic and building the click data that becomes leverage for future roaster partnerships.

This is a **localhost prototype for two users**. Not a social platform. Not a public deployment. The goal is to get the data model, interactions, and tasting vocabulary right between two real people before scaling anything.

**This spec is purely additive to UI_SPEC.md.** The existing frontend — card grid, filters, search, share system — is untouched. The community layer adds a backend, authentication, shelves, tasting notes, and click tracking alongside the existing static-JSON browsing experience.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Model](#2-data-model)
3. [Authentication](#3-authentication)
4. [Shelf System](#4-shelf-system)
5. [Tasting Note System](#5-tasting-note-system)
6. [Tasting Note Dictionary](#6-tasting-note-dictionary)
7. [Click Tracking](#7-click-tracking)
8. [API Endpoints](#8-api-endpoints)
9. [Frontend Integration Guide](#9-frontend-integration-guide)
10. [Implementation Checklist](#10-implementation-checklist)
11. [Future Considerations](#11-future-considerations)

---

## 1. Architecture Overview

### 1.1 System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  EXISTING (from UI_SPEC.md) — unchanged                      │
│                                                              │
│  products.json ──→ React App (Vite, :5173)                   │
│                    Card grid, filters, search, share, likes  │
└──────────────────────────────┬───────────────────────────────┘
                               │
                    fetch() to localhost:8000
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  NEW (this spec) — Community Backend                         │
│                                                              │
│  FastAPI (:8000, bound to 0.0.0.0)                           │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │   Auth   │  │  Shelves │  │  Tasting   │  │   Click   │  │
│  │          │  │          │  │  Notes     │  │  Tracking │  │
│  └──────────┘  └──────────┘  └────────────┘  └───────────┘  │
│                                                              │
│  SQLite (coffee_community.db)                                │
│  Single file, zero config, lives in project root             │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend Framework | Python FastAPI | Async, auto-generates API docs at `/docs`, minimal boilerplate |
| Database | SQLite | Zero config, single file, perfect for localhost prototype |
| ORM | None — raw `sqlite3` | Two users, five tables. An ORM is overhead. |
| Password Hashing | `bcrypt` via `passlib` | Industry standard, one dependency |
| Auth Tokens | Simple random tokens (UUID4) | No JWT complexity needed for localhost |
| CORS | FastAPI `CORSMiddleware` | Allow requests from Vite dev server on `:5173` |

### 1.3 Local Development

```bash
# Backend setup (run once)
cd coffee-community-api
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install fastapi uvicorn passlib[bcrypt] python-multipart

# Run the backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# The API is now available at:
#   http://localhost:8000          (from this machine)
#   http://192.168.x.x:8000       (from any device on the same WiFi)
#   http://localhost:8000/docs     (interactive API documentation)
```

The React frontend (from UI_SPEC.md) continues to run on `:5173` as before. Community features in the frontend make `fetch()` calls to `:8000`.

### 1.4 Project Structure

```
coffee-community-api/
├── main.py                      ← FastAPI app, CORS, router mounting
├── database.py                  ← SQLite connection, table creation
├── auth.py                      ← Register, login, session management
├── shelves.py                   ← Shelf CRUD endpoints
├── tasting_notes.py             ← Tasting note CRUD endpoints
├── click_tracking.py            ← Click logging endpoints
├── dictionary.py                ← Flavor tags + brew methods reference data
├── models.py                    ← Pydantic request/response models
├── coffee_community.db          ← SQLite database (auto-created on first run)
└── requirements.txt             ← Python dependencies
```

### 1.5 Core Principles

- **Additive only.** The existing UI_SPEC frontend must work identically with or without this backend running. Community features degrade gracefully (components simply don't render if the API is unreachable).
- **Catalog-linked.** Every shelf entry and tasting note references a `product_id` that exists in `products.json`. No freeform coffee entries.
- **Two users.** The system supports N users, but the design decisions optimize for two people on localhost. No pagination, no feed algorithms, no notification systems.
- **Standardized vocabulary.** Tasting notes use a controlled dictionary. Users select from predefined tags, not freeform text (except for a short optional comment).

---

## 2. Data Model

### 2.1 Entity Relationship

```
┌──────────┐       ┌───────────────┐       ┌───────────────┐
│  users   │──1:N──│ shelf_entries  │──1:N──│ tasting_notes │
└──────────┘       └───────┬───────┘       └───────────────┘
                           │
                    product_id (FK to products.json)
                           │
┌──────────────────────────┘
│
│  ┌──────────────┐
└──│ click_events │
   └──────────────┘
```

### 2.2 Table: `users`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `username` | TEXT | UNIQUE, NOT NULL | Lowercase, alphanumeric + underscores, 3–20 chars |
| `display_name` | TEXT | NOT NULL | Human-readable name shown in UI |
| `password_hash` | TEXT | NOT NULL | bcrypt hash |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

### 2.3 Table: `sessions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `token` | TEXT | PRIMARY KEY | UUID4 string |
| `user_id` | INTEGER | FK → users.id, NOT NULL | |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `expires_at` | TEXT | NOT NULL | 30 days from creation |

### 2.4 Table: `shelf_entries`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `user_id` | INTEGER | FK → users.id, NOT NULL | |
| `product_id` | TEXT | NOT NULL | Matches `product_id` in products.json |
| `shelf` | TEXT | NOT NULL, CHECK IN ('currently_drinking', 'drank', 'want_to_try') | |
| `added_at` | TEXT | NOT NULL | When first added to any shelf |
| `moved_at` | TEXT | NOT NULL | When last moved between shelves |

**Constraint:** UNIQUE(`user_id`, `product_id`) — a coffee can only live on one shelf per user. Moving a coffee between shelves is an update, not a delete + insert.

### 2.5 Table: `tasting_notes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `user_id` | INTEGER | FK → users.id, NOT NULL | |
| `product_id` | TEXT | NOT NULL | Matches `product_id` in products.json |
| `acidity` | INTEGER | CHECK 1–5, nullable | Physical attribute slider |
| `body` | INTEGER | CHECK 1–5, nullable | Physical attribute slider |
| `sweetness` | INTEGER | CHECK 1–5, nullable | Physical attribute slider |
| `aftertaste` | INTEGER | CHECK 1–5, nullable | Physical attribute slider |
| `flavor_tags` | TEXT | nullable | JSON array of strings from the dictionary, e.g. `["chocolate","caramel","nutmeg"]` |
| `brew_method` | TEXT | nullable | Must be a value from the brew method dictionary |
| `comment` | TEXT | nullable | Freeform, max 500 characters |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

**No uniqueness constraint on (user_id, product_id).** A user can write multiple tasting notes for the same coffee — different brew methods, different dates, different bags. Each note is an independent record.

**Validation:** `flavor_tags` must be validated server-side against the dictionary. Any tag not in the dictionary is rejected. This keeps the data clean.

### 2.6 Table: `click_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `user_id` | INTEGER | FK → users.id, nullable | Null if clicked before login |
| `product_id` | TEXT | NOT NULL | |
| `roaster_slug` | TEXT | NOT NULL | Denormalized for fast aggregation |
| `source_page` | TEXT | NOT NULL | Where the click originated (see 2.7) |
| `clicked_at` | TEXT | NOT NULL | ISO 8601 |

### 2.7 Click Source Pages

The `source_page` field records where the user clicked the outbound roaster link. Valid values:

| Value | Meaning |
|---|---|
| `card_front` | "Buy" or roaster link on the coffee card front face |
| `card_back` | Link on the flipped card back |
| `coffee_detail` | The "Buy from {Roaster}" button on CoffeePage |
| `roaster_profile` | Website link on the RoasterPage |
| `shelf` | Roaster link clicked from the user's own shelf view |
| `partner_shelf` | Roaster link clicked while viewing another user's shelf |

### 2.8 Database Initialization SQL

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    shelf TEXT NOT NULL CHECK (shelf IN ('currently_drinking', 'drank', 'want_to_try')),
    added_at TEXT NOT NULL,
    moved_at TEXT NOT NULL,
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS tasting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    acidity INTEGER CHECK (acidity BETWEEN 1 AND 5),
    body INTEGER CHECK (body BETWEEN 1 AND 5),
    sweetness INTEGER CHECK (sweetness BETWEEN 1 AND 5),
    aftertaste INTEGER CHECK (aftertaste BETWEEN 1 AND 5),
    flavor_tags TEXT,
    brew_method TEXT,
    comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    product_id TEXT NOT NULL,
    roaster_slug TEXT NOT NULL,
    source_page TEXT NOT NULL,
    clicked_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shelf_user ON shelf_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_shelf_product ON shelf_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON tasting_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_product ON tasting_notes(product_id);
CREATE INDEX IF NOT EXISTS idx_clicks_roaster ON click_events(roaster_slug);
CREATE INDEX IF NOT EXISTS idx_clicks_product ON click_events(product_id);
```

---

## 3. Authentication

### 3.1 Registration

A user provides a `username`, `display_name`, and `password`. The backend:

1. Validates username: lowercase, alphanumeric + underscores only, 3–20 characters, unique
2. Validates password: minimum 6 characters (this is localhost, not a bank)
3. Hashes password with bcrypt (12 rounds)
4. Inserts user row
5. Creates a session token (UUID4)
6. Returns the token

### 3.2 Login

User provides `username` and `password`. The backend:

1. Looks up user by username
2. Verifies password against bcrypt hash
3. Creates a new session token
4. Returns the token

### 3.3 Session Management

- Tokens are UUID4 strings, stored in the `sessions` table
- Tokens expire after 30 days (effectively permanent for a localhost prototype)
- The frontend stores the token in `localStorage` under key `coffee_session_token`
- Every authenticated API request sends the token as: `Authorization: Bearer {token}`
- The backend validates the token on each request via a dependency function

### 3.4 No Email, No Password Reset

This is a localhost prototype for two people. If you forget your password, delete `coffee_community.db` and re-register. There is no email field, no password reset flow, no verification.

---

## 4. Shelf System

### 4.1 Shelf Types

Each user has three fixed shelves. These are not user-created — they are hardcoded categories:

| Shelf Key | Display Name | Icon | Meaning |
|---|---|---|---|
| `currently_drinking` | Currently Drinking | ☕ | A bag I have open right now |
| `drank` | Drank | ✓ | Finished this bag (or sampled it) |
| `want_to_try` | Want to Try | ✦ | On my list, haven't bought yet |

### 4.2 Shelf Rules

- A coffee (`product_id`) can exist on **exactly one shelf** per user at a time
- Adding a coffee that's already on a different shelf **moves** it (updates the `shelf` field and `moved_at` timestamp)
- Adding a coffee that's already on the same shelf is a no-op (200 OK, no change)
- Removing a coffee from shelves deletes the `shelf_entries` row but **does not delete** associated tasting notes (notes are independent records)
- There is no limit on how many coffees can be on a shelf

### 4.3 Shelf Card Display

When viewing a shelf, each coffee is displayed as a simplified card (not the full flip-card from UI_SPEC). The shelf card shows:

```
┌─────────────────────────────────────────────┐
│  [Image]  Attikan Estate                    │
│  (80px)   Blue Tokai Coffee Roasters    ↗   │
│           Medium Roast · ₹449 / 250g        │
│                                             │
│           ☕ Chocolate, Caramel, Nutmeg       │
│           ★★★★☆ (your tasting note avg)     │
│                                             │
│  [Move to ▾]  [Add Tasting Note]  [Remove]  │
└─────────────────────────────────────────────┘
```

- The `↗` icon is the outbound roaster link (tracked as a click event)
- "Move to ▾" is a dropdown to move between shelves
- Tasting note summary shows the average of your physical attribute scores and your most recent flavor tags
- If no tasting note exists, the tasting note area shows a muted prompt: "How does it taste? Add a note."

---

## 5. Tasting Note System

### 5.1 Structure

A tasting note has four sections, all optional (a user can fill in as much or as little as they want):

**A) Physical Attributes — Sliders (1–5)**

| Attribute | Scale Left (1) | Scale Right (5) | What It Measures |
|---|---|---|---|
| Acidity | Flat | Bright | Liveliness on the tongue — the tangy, crisp quality |
| Body | Light / Tea-like | Full / Syrupy | Weight and texture of the coffee in the mouth |
| Sweetness | Low | High | Perceived sweetness, independent of sugar |
| Aftertaste | Short / Clean | Long / Lingering | How long the flavor remains after swallowing |

These render as discrete 5-step sliders in the UI (not continuous). Each step has a subtle label. Null means "not rated."

**B) Flavor Tags — Multi-select from Dictionary**

The user selects flavor tags from the curated dictionary (Section 6). Tags are organized by category. The UI shows category headers with selectable pills underneath. A user can select tags from multiple categories.

Maximum 8 tags per note (to prevent lazy "select everything" behavior).

**C) Brew Method — Single-select Dropdown**

One selection from the brew method list (Section 6.2). Null means "not specified."

**D) Comment — Freeform Text**

A short text field, max 500 characters. For anything that doesn't fit the structured fields. Examples: "Second bag of this, still great", "Tastes better after 10 days off roast", "My girlfriend hated this but I think she's wrong."

### 5.2 Multiple Notes per Coffee

A user can write multiple tasting notes for the same coffee. This is intentional:

- Same beans, different brew method
- Same beans, different rest period (day 3 vs day 14 off roast)
- Re-purchased the same coffee months later (different harvest/lot)

Each note is timestamped and displayed chronologically.

### 5.3 Viewing Partner's Notes

On a partner's profile, their tasting notes are visible alongside their shelf entries. You see what they rated, which tags they picked, and their comment. This is the "social" interaction at the localhost scale — not likes and follows, just reading each other's notes.

---

## 6. Tasting Note Dictionary

### 6.1 Flavor Tags

The dictionary is organized hierarchically: **Category → Specific Descriptor**. Users see categories as section headers and descriptors as selectable pills. The descriptor string (e.g., `"blueberry"`) is what gets stored in the database, not the category.

This dictionary is derived from the SCA/WCR Coffee Taster's Flavor Wheel (2016 revision) but curated to ~50 descriptors relevant to Indian specialty coffee. Categories and descriptors that rarely appear in Indian roaster tasting profiles (e.g., rubber, petroleum, pipe tobacco) are excluded.

```json
{
  "flavor_dictionary": {
    "Fruity": {
      "Berry": ["blueberry", "strawberry", "raspberry", "blackberry"],
      "Citrus": ["lemon", "orange", "grapefruit", "lime"],
      "Stone Fruit": ["peach", "plum", "apricot", "cherry"],
      "Tropical": ["mango", "pineapple", "passionfruit", "guava"],
      "Dried Fruit": ["raisin", "fig", "date", "prune"]
    },
    "Floral": ["jasmine", "rose", "lavender", "hibiscus", "chamomile"],
    "Sweet": ["honey", "caramel", "brown sugar", "vanilla", "molasses", "toffee", "maple"],
    "Nutty": ["almond", "hazelnut", "peanut", "walnut", "cashew"],
    "Chocolate": ["dark chocolate", "milk chocolate", "cocoa", "white chocolate"],
    "Spices": ["cinnamon", "cardamom", "clove", "black pepper", "nutmeg", "ginger"],
    "Roasted": ["toasted", "smoky", "malty", "burnt sugar", "roasted grain"],
    "Earthy & Woody": ["cedar", "sandalwood", "tobacco", "leather", "earthy", "mushroom"],
    "Green & Herbal": ["herbal", "grassy", "tea-like", "mint"]
  }
}
```

**Total descriptor count: 51**

**Design notes:**

- **Fruity** is the largest category because Indian specialty coffees (particularly from Chikmagalur, Coorg, and Araku) frequently express fruit-forward profiles. The subcategory grouping (Berry, Citrus, Stone Fruit, Tropical, Dried Fruit) helps users narrow down what kind of fruitiness they're tasting.
- **Guava** is included because it appears in Indian coffee profiles and is absent from the US-centric SCA wheel.
- **Cardamom** and **ginger** are included in Spices — common descriptors for Indian coffee and culturally resonant.
- **Sandalwood** is included in Earthy & Woody — it appears in tasting notes for South Indian estate coffees and is immediately recognizable to Indian users.
- **Sour/Fermented** from the SCA wheel is excluded at the descriptor level because for non-professionals, "sour" and "fermented" read as defects. The acidity slider (Flat → Bright) captures the positive end of this spectrum. If users need to note fermented/winey character, they can use the freeform comment.

### 6.2 Brew Methods

```json
{
  "brew_methods": [
    {"key": "pour_over",         "label": "Pour Over / V60"},
    {"key": "south_indian_filter", "label": "South Indian Filter"},
    {"key": "french_press",      "label": "French Press"},
    {"key": "aeropress",         "label": "AeroPress"},
    {"key": "espresso",          "label": "Espresso"},
    {"key": "moka_pot",          "label": "Moka Pot"},
    {"key": "cold_brew",         "label": "Cold Brew"},
    {"key": "chemex",            "label": "Chemex"},
    {"key": "clever_dripper",    "label": "Clever Dripper"},
    {"key": "turkish",           "label": "Turkish / Ibrik"},
    {"key": "siphon",            "label": "Siphon"},
    {"key": "instant",           "label": "Instant / Sachets"}
  ]
}
```

**Design notes:**

- **South Indian Filter** is listed second (after Pour Over) because this is an Indian platform. The traditional stainless steel drip filter is the most culturally significant brew method in South India where most of the specialty coffee is grown.
- **Instant / Sachets** is included because several Indian specialty roasters (e.g., Blue Tokai, Sleepy Owl) sell instant specialty coffee. Excluding it would be snobbish; including it respects the full product range in the catalog.
- **Siphon** is included for completeness but expected to be rarely used.

### 6.3 Physical Attribute Labels

For the UI, each step on the 1–5 sliders has a short label:

```json
{
  "physical_attributes": {
    "acidity": {
      "1": "Flat",
      "2": "Soft",
      "3": "Balanced",
      "4": "Crisp",
      "5": "Bright"
    },
    "body": {
      "1": "Tea-like",
      "2": "Light",
      "3": "Medium",
      "4": "Full",
      "5": "Syrupy"
    },
    "sweetness": {
      "1": "Absent",
      "2": "Faint",
      "3": "Moderate",
      "4": "Pronounced",
      "5": "Intense"
    },
    "aftertaste": {
      "1": "Clean",
      "2": "Brief",
      "3": "Moderate",
      "4": "Lasting",
      "5": "Lingering"
    }
  }
}
```

---

## 7. Click Tracking

### 7.1 What Gets Tracked

Every click on an outbound link to a roaster's website is logged. This includes:

- The "Buy from {Roaster}" button on CoffeePage
- The roaster website link on RoasterPage
- Any roaster link clicked from a shelf view
- The roaster name link on coffee cards (if it opens the roaster's external site)

Internal navigation (e.g., clicking roaster name to go to the in-app RoasterPage) is **not** tracked as a click event.

### 7.2 Why Track

Click data is the platform's leverage with roasters. When approaching a roaster for a future partnership, the pitch is: "We sent you X clicks last month. Here's the data." This requires clean, attributable tracking from day one — even at the two-user prototype stage.

### 7.3 Tracking Implementation

The frontend wraps every outbound roaster link in a tracking function:

```javascript
// utils/trackClick.js

async function trackOutboundClick(productId, roasterSlug, sourcePage) {
  // Fire and forget — don't block the navigation
  fetch('http://localhost:8000/api/clicks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getSessionToken()}`,
    },
    body: JSON.stringify({
      product_id: productId,
      roaster_slug: roasterSlug,
      source_page: sourcePage,
    }),
  }).catch(() => {
    // Silently fail — click tracking should never block user experience
  });

  // Immediately open the roaster's product page
  window.open(productUrl, '_blank');
}
```

Key behavior: the tracking request is **fire-and-forget**. The `window.open` call happens immediately, not after the API responds. If the backend is down, the user still reaches the roaster's site. Click tracking is opportunistic, never blocking.

### 7.4 Aggregation Queries

The backend provides a stats endpoint that aggregates clicks for future use:

```sql
-- Total clicks per roaster (all time)
SELECT roaster_slug, COUNT(*) as total_clicks
FROM click_events
GROUP BY roaster_slug
ORDER BY total_clicks DESC;

-- Clicks per product (all time)
SELECT product_id, roaster_slug, COUNT(*) as total_clicks
FROM click_events
GROUP BY product_id
ORDER BY total_clicks DESC;

-- Clicks per roaster, last 30 days
SELECT roaster_slug, COUNT(*) as clicks_30d
FROM click_events
WHERE clicked_at >= datetime('now', '-30 days')
GROUP BY roaster_slug
ORDER BY clicks_30d DESC;

-- Click sources breakdown
SELECT source_page, COUNT(*) as count
FROM click_events
GROUP BY source_page;
```

---

## 8. API Endpoints

All endpoints are prefixed with `/api`. The backend serves interactive API documentation at `/docs` (Swagger UI, auto-generated by FastAPI).

### 8.1 Auth Endpoints

#### `POST /api/auth/register`

Register a new user.

**Request body:**
```json
{
  "username": "swaraj",
  "display_name": "Swaraj",
  "password": "coffeeislife"
}
```

**Response (201):**
```json
{
  "user": {
    "id": 1,
    "username": "swaraj",
    "display_name": "Swaraj",
    "created_at": "2026-04-05T14:30:00Z"
  },
  "token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Errors:**
- 409: Username already taken
- 422: Validation error (username format, password length)

#### `POST /api/auth/login`

**Request body:**
```json
{
  "username": "swaraj",
  "password": "coffeeislife"
}
```

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "username": "swaraj",
    "display_name": "Swaraj",
    "created_at": "2026-04-05T14:30:00Z"
  },
  "token": "f9e8d7c6-b5a4-3210-fedc-ba9876543210"
}
```

**Errors:**
- 401: Invalid username or password

#### `GET /api/auth/me`

Returns the currently authenticated user. Requires `Authorization: Bearer {token}` header.

**Response (200):**
```json
{
  "id": 1,
  "username": "swaraj",
  "display_name": "Swaraj",
  "created_at": "2026-04-05T14:30:00Z"
}
```

**Errors:**
- 401: Missing or invalid token

### 8.2 Shelf Endpoints

All shelf endpoints require authentication.

#### `GET /api/shelves`

Returns the authenticated user's shelves with all entries.

**Response (200):**
```json
{
  "currently_drinking": [
    {
      "id": 1,
      "product_id": "blue-tokai_attikan-estate-medium-roast",
      "shelf": "currently_drinking",
      "added_at": "2026-04-05T15:00:00Z",
      "moved_at": "2026-04-05T15:00:00Z",
      "tasting_note_count": 2
    }
  ],
  "drank": [],
  "want_to_try": [
    {
      "id": 2,
      "product_id": "subko_kalledevarapura-natural",
      "shelf": "want_to_try",
      "added_at": "2026-04-05T15:05:00Z",
      "moved_at": "2026-04-05T15:05:00Z",
      "tasting_note_count": 0
    }
  ]
}
```

Note: `tasting_note_count` is a computed field — the number of tasting notes this user has written for this product. Helps the UI show whether a note exists.

#### `GET /api/shelves/users/:username`

Returns another user's shelves (public view). Same response shape as above but for the specified user.

**Errors:**
- 404: User not found

#### `POST /api/shelves`

Add a coffee to a shelf (or move it if already on a different shelf).

**Request body:**
```json
{
  "product_id": "blue-tokai_attikan-estate-medium-roast",
  "shelf": "currently_drinking"
}
```

**Response (201 if new, 200 if moved):**
```json
{
  "id": 1,
  "product_id": "blue-tokai_attikan-estate-medium-roast",
  "shelf": "currently_drinking",
  "added_at": "2026-04-05T15:00:00Z",
  "moved_at": "2026-04-05T15:00:00Z"
}
```

#### `DELETE /api/shelves/:entry_id`

Remove a coffee from all shelves. Does not delete associated tasting notes.

**Response (204):** No content.

**Errors:**
- 404: Entry not found or doesn't belong to authenticated user

### 8.3 Tasting Note Endpoints

All endpoints require authentication.

#### `GET /api/tasting-notes?product_id={product_id}`

Returns all tasting notes for a product, from all users. Grouped by user.

**Response (200):**
```json
{
  "product_id": "blue-tokai_attikan-estate-medium-roast",
  "notes": [
    {
      "id": 1,
      "user": {
        "username": "swaraj",
        "display_name": "Swaraj"
      },
      "acidity": 3,
      "body": 4,
      "sweetness": 3,
      "aftertaste": 4,
      "flavor_tags": ["chocolate", "caramel", "nutmeg"],
      "brew_method": "south_indian_filter",
      "comment": "Best with milk, but solid black too",
      "created_at": "2026-04-05T16:00:00Z",
      "updated_at": "2026-04-05T16:00:00Z"
    },
    {
      "id": 2,
      "user": {
        "username": "priya",
        "display_name": "Priya"
      },
      "acidity": 4,
      "body": 3,
      "sweetness": 4,
      "aftertaste": 3,
      "flavor_tags": ["orange", "honey", "almond"],
      "brew_method": "pour_over",
      "comment": null,
      "created_at": "2026-04-05T17:00:00Z",
      "updated_at": "2026-04-05T17:00:00Z"
    }
  ]
}
```

#### `GET /api/tasting-notes/mine`

Returns all tasting notes by the authenticated user, across all products. Useful for the "My Journal" view.

#### `POST /api/tasting-notes`

Create a new tasting note.

**Request body:**
```json
{
  "product_id": "blue-tokai_attikan-estate-medium-roast",
  "acidity": 3,
  "body": 4,
  "sweetness": 3,
  "aftertaste": 4,
  "flavor_tags": ["chocolate", "caramel", "nutmeg"],
  "brew_method": "south_indian_filter",
  "comment": "Best with milk, but solid black too"
}
```

**Validation:**
- `product_id` is required
- All other fields are optional (a note can be just a comment, or just sliders, or just tags)
- `flavor_tags` must each exist in the flavor dictionary; max 8 tags
- `brew_method` must exist in the brew method list
- `comment` max 500 characters
- At least one field beyond `product_id` must be non-null (prevent empty notes)

**Response (201):** The created note (same shape as in GET response).

**Errors:**
- 422: Validation error (invalid tags, unknown brew method, etc.)

#### `PUT /api/tasting-notes/:note_id`

Update an existing tasting note. Same request body as POST. Only the note's author can update it.

#### `DELETE /api/tasting-notes/:note_id`

Delete a tasting note. Only the note's author can delete it.

**Response (204):** No content.

### 8.4 Click Tracking Endpoints

#### `POST /api/clicks`

Log an outbound click. Authentication is optional (supports tracking before login).

**Request body:**
```json
{
  "product_id": "blue-tokai_attikan-estate-medium-roast",
  "roaster_slug": "blue-tokai",
  "source_page": "coffee_detail"
}
```

**Response (201):**
```json
{ "tracked": true }
```

#### `GET /api/clicks/stats`

Requires authentication. Returns aggregate click statistics.

**Response (200):**
```json
{
  "total_clicks": 142,
  "by_roaster": [
    { "roaster_slug": "blue-tokai", "clicks": 45 },
    { "roaster_slug": "subko", "clicks": 32 }
  ],
  "by_product": [
    { "product_id": "blue-tokai_attikan-estate-medium-roast", "clicks": 12 },
    { "product_id": "subko_kalledevarapura-natural", "clicks": 9 }
  ],
  "by_source": [
    { "source_page": "coffee_detail", "count": 78 },
    { "source_page": "card_front", "count": 34 },
    { "source_page": "shelf", "count": 30 }
  ]
}
```

### 8.5 Dictionary Endpoints

These are public (no auth required). They serve the tasting vocabulary so the frontend doesn't need to hardcode it.

#### `GET /api/dictionary/flavors`

Returns the full flavor tag dictionary (Section 6.1 JSON).

#### `GET /api/dictionary/brew-methods`

Returns the brew method list (Section 6.2 JSON).

#### `GET /api/dictionary/physical-attributes`

Returns the physical attribute labels (Section 6.3 JSON).

---

## 9. Frontend Integration Guide

### 9.1 Relationship to UI_SPEC.md

This section describes **new** pages and components to add to the existing React app defined in UI_SPEC.md. Nothing in the existing spec is modified or replaced.

### 9.2 New Project Structure (additions only)

```
coffee-discovery/src/
├── ...existing files from UI_SPEC.md...
│
├── community/                           ← NEW: all community code isolated here
│   ├── api.js                           ← API client (fetch wrapper with auth headers)
│   │
│   ├── components/
│   │   ├── LoginForm.jsx                ← Username + password form
│   │   ├── RegisterForm.jsx             ← Registration form
│   │   ├── ShelfSelector.jsx            ← Dropdown to add/move coffee to shelf
│   │   ├── ShelfCard.jsx                ← Compact card for shelf view
│   │   ├── ShelfGrid.jsx               ← Grid of ShelfCards, grouped by shelf type
│   │   ├── TastingNoteForm.jsx          ← The full tasting note input form
│   │   ├── TastingNoteDisplay.jsx       ← Read-only view of a single tasting note
│   │   ├── FlavorTagPicker.jsx          ← Multi-select pills organized by category
│   │   ├── AttributeSlider.jsx          ← Discrete 5-step slider with labels
│   │   ├── BrewMethodSelect.jsx         ← Dropdown for brew method
│   │   └── UserBadge.jsx               ← Small username/avatar chip
│   │
│   ├── pages/
│   │   ├── MyShelfPage.jsx              ← Authenticated user's shelf view
│   │   ├── UserProfilePage.jsx          ← Another user's public shelf + notes
│   │   └── AuthPage.jsx                 ← Login/register combined page
│   │
│   └── hooks/
│       ├── useAuth.js                   ← Auth state, login, register, logout
│       ├── useShelves.js                ← Shelf CRUD operations
│       ├── useTastingNotes.js           ← Tasting note CRUD
│       └── useClickTracking.js          ← Outbound click logging
```

### 9.3 New Routes

Added to the existing React Router configuration:

| Path | Component | Auth Required | Description |
|---|---|---|---|
| `/auth` | `AuthPage` | No | Login / register |
| `/my-shelf` | `MyShelfPage` | Yes | Current user's shelves |
| `/user/:username` | `UserProfilePage` | Yes | Another user's shelves + notes |

### 9.4 Navbar Additions

The existing navbar (from UI_SPEC Section 12.2) gains two new elements when the community backend is available:

```
┌──────────────────────────────────────────────────────────────────┐
│  ☕ CoffeeCatalog   [Search...]   📚 My Shelf   ♡ (3)   About  │
└──────────────────────────────────────────────────────────────────┘
```

- **📚 My Shelf** appears only when logged in. Links to `/my-shelf`.
- If not logged in, a **Sign In** link appears instead, linking to `/auth`.
- The ♡ liked count (from UI_SPEC) remains unchanged and continues to use localStorage.

### 9.5 Integration Points with Existing Components

**CoffeePage.jsx (from UI_SPEC Section 9):**

Below the existing content (image, metadata, variants, buy button, description), add a new section:

```
── existing content from UI_SPEC ──

┌─────────────────────────────────────────────────────┐
│  TASTING NOTES                                       │
│                                                     │
│  [Your note — TastingNoteDisplay]                   │
│  [Partner's note — TastingNoteDisplay]              │
│                                                     │
│  [+ Add Tasting Note]  (opens TastingNoteForm)      │
│                                                     │
│  ── or if not logged in ──                          │
│  Sign in to add tasting notes                       │
└─────────────────────────────────────────────────────┘
```

**CoffeeCard.jsx (from UI_SPEC Section 5):**

On the card back face, below the existing metadata rows and above the Share/Like buttons, add a small shelf action:

```
  ⚙️ PROCESS
  Washed

  ┌──────────────────────────────────┐
  │  + Add to Shelf ▾               │    ← NEW: ShelfSelector dropdown
  └──────────────────────────────────┘

  ┌────────┐ ┌────────┐
  │ Share  │ │  Like  │
  └────────┘ └────────┘
```

The shelf selector only renders if (a) the community backend is reachable and (b) the user is logged in. Otherwise, this row is simply absent — the card looks exactly as UI_SPEC describes.

### 9.6 API Client

```javascript
// community/api.js

const API_BASE = 'http://localhost:8000/api';

function getToken() {
  return localStorage.getItem('coffee_session_token');
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `API error: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}
```

### 9.7 Graceful Degradation

The community features must **never** break the existing browsing experience. The implementation pattern:

```javascript
// hooks/useAuth.js

export function useAuth() {
  const [backendAvailable, setBackendAvailable] = useState(false);

  useEffect(() => {
    // Probe the backend on mount
    fetch('http://localhost:8000/api/dictionary/brew-methods')
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false));
  }, []);

  // ... auth logic ...

  return { backendAvailable, user, login, register, logout };
}
```

Components that depend on the backend check `backendAvailable` before rendering. If `false`, they render nothing. The app works identically to UI_SPEC — static JSON, localStorage likes, no auth.

### 9.8 LAN Access Configuration

For two people on the same WiFi, the React dev server also needs to bind to `0.0.0.0`:

```javascript
// vite.config.js — add this to the existing config
export default defineConfig({
  server: {
    host: '0.0.0.0',    // Allow LAN access
    port: 5173,
  },
  // ...existing config from UI_SPEC
});
```

The second person accesses the app at `http://192.168.x.x:5173` (where `192.168.x.x` is the host machine's local IP). The community API calls go to `http://192.168.x.x:8000`.

**Important:** The `API_BASE` in `community/api.js` should dynamically resolve to the same host as the page, not hardcode `localhost`:

```javascript
const API_BASE = `http://${window.location.hostname}:8000/api`;
```

This way, both users (host machine on `localhost` and partner on `192.168.x.x`) hit the same backend.

---

## 10. Implementation Checklist

### Phase 1: Backend Foundation

- [ ] Create `coffee-community-api/` project directory
- [ ] Set up Python virtual environment and install dependencies
- [ ] Implement `database.py` — SQLite connection, table creation (Section 2.8)
- [ ] Implement `models.py` — Pydantic models for all request/response shapes
- [ ] Implement `dictionary.py` — hardcoded flavor tags, brew methods, attribute labels
- [ ] Implement `main.py` — FastAPI app with CORS middleware
- [ ] Verify: `uvicorn main:app --host 0.0.0.0 --port 8000` starts, `/docs` loads

### Phase 2: Authentication

- [ ] Implement `auth.py` — register, login, session token, `get_current_user` dependency
- [ ] Test: register two users, login, verify `/api/auth/me` returns correct user
- [ ] Test: invalid token returns 401

### Phase 3: Shelf System

- [ ] Implement `shelves.py` — add/move/remove shelf entries, list shelves, view other user's shelves
- [ ] Test: add coffee to shelf, move between shelves, verify uniqueness constraint
- [ ] Test: view partner's shelves via `/api/shelves/users/:username`

### Phase 4: Tasting Notes

- [ ] Implement `tasting_notes.py` — create, read, update, delete notes
- [ ] Implement flavor tag validation against dictionary
- [ ] Implement brew method validation
- [ ] Test: create note with all fields, create note with partial fields
- [ ] Test: multiple notes per coffee
- [ ] Test: cannot edit/delete another user's note

### Phase 5: Click Tracking

- [ ] Implement `click_tracking.py` — log click, stats endpoint
- [ ] Test: log clicks, verify stats aggregation queries

### Phase 6: Frontend Integration

- [ ] Create `community/` directory in existing React app
- [ ] Implement `api.js` — fetch wrapper with dynamic host and auth headers
- [ ] Implement `useAuth` hook — backend probe, login, register, logout, token storage
- [ ] Build `AuthPage.jsx` — login/register combined page
- [ ] Update `Navbar.jsx` — add "My Shelf" / "Sign In" link (conditional on auth state)
- [ ] Update `vite.config.js` — add `host: '0.0.0.0'`

### Phase 7: Shelf UI

- [ ] Build `ShelfSelector.jsx` — dropdown for adding/moving coffees
- [ ] Build `ShelfCard.jsx` — compact card for shelf view
- [ ] Build `ShelfGrid.jsx` — grouped shelf display
- [ ] Build `MyShelfPage.jsx` — authenticated user's shelf view
- [ ] Build `UserProfilePage.jsx` — partner's shelf view
- [ ] Integrate `ShelfSelector` into `CoffeeCard.jsx` back face

### Phase 8: Tasting Note UI

- [ ] Fetch and cache dictionary data (flavors, brew methods, attributes)
- [ ] Build `AttributeSlider.jsx` — discrete 5-step slider
- [ ] Build `FlavorTagPicker.jsx` — categorized multi-select pills
- [ ] Build `BrewMethodSelect.jsx` — dropdown
- [ ] Build `TastingNoteForm.jsx` — combines all inputs
- [ ] Build `TastingNoteDisplay.jsx` — read-only note card
- [ ] Integrate tasting notes section into `CoffeePage.jsx`

### Phase 9: Click Tracking UI

- [ ] Implement `useClickTracking` hook
- [ ] Wrap all outbound roaster links with click tracking (fire-and-forget)
- [ ] Verify clicks are logged in database

---

## 11. Future Considerations

These are **not in scope** but document how this prototype evolves.

### 11.1 Localhost → Public Deployment

When moving beyond two users on a WiFi:

- **Auth:** Add email field, password reset flow, rate limiting on login attempts
- **Database:** Migrate from SQLite to PostgreSQL (SQLite doesn't handle concurrent writes well)
- **Hosting:** Backend on Railway/Render/Fly.io, frontend on Vercel/Netlify
- **API_BASE:** Move from dynamic `window.location.hostname` to environment variable pointing to the deployed API domain
- **CORS:** Restrict to the actual frontend domain instead of `*`

### 11.2 Social Features

When scaling beyond a handful of users:

- **Follow system:** Users follow each other. Feed shows followed users' shelf activity and tasting notes.
- **Like on notes:** Heart-react to someone's tasting note
- **Discovery feed:** "People are currently drinking..." — aggregated view of `currently_drinking` shelves across all users, sorted by recency
- **Roaster follow:** Get notified (in-app) when a followed roaster's catalog updates

### 11.3 Tasting Note Enhancements

- **Photo attachment:** Upload a photo of the brew or the bag (requires file storage — S3 or equivalent)
- **Roast date tracking:** "Days off roast" field, auto-computed from a user-entered roast date
- **Flavor tag voting:** If multiple users note the same tag for the same coffee, it gets more weight in display (consensus-driven tasting profile)
- **Personal flavor profile:** Aggregate a user's most-selected tags across all notes → "You tend to pick chocolatey, nutty coffees"

### 11.4 Click Tracking → Roaster Pitch

The click data becomes a sales tool:

- Generate a per-roaster report: "Blue Tokai received 453 clicks from 128 unique users in the last 90 days. Top clicked product: Attikan Estate (87 clicks). Most common source: coffee detail page."
- This report is the basis for approaching roasters about formal partnerships, featured placements, or the commission-based marketplace model (documented in UI_SPEC Section 16).

### 11.5 Likes Migration

If the platform fully commits to the community model, the localStorage-based like system (UI_SPEC Section 10) can be migrated to server-side. The "Want to Try" shelf is functionally a superset of a like — it means "I'm interested in this coffee." The migration path:

1. On first login, read the user's localStorage likes
2. Offer to import them as "Want to Try" shelf entries
3. Once imported, the server-side shelf replaces the localStorage system

This is a one-time migration, not a permanent dual system.

---

**END OF COMMUNITY LAYER SPECIFICATION**

*This document extends UI_SPEC.md. Build the backend (Phases 1–5) first, test all endpoints via `/docs`, then build the frontend integration (Phases 6–9). The existing discovery UI continues to work independently throughout.*
