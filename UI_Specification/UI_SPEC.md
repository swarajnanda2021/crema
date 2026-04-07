# Indian Specialty Coffee Aggregator — UI Frontend Specification

**Version:** 1.0  
**Date:** March 31, 2026  
**Status:** Ready for Claude Code Implementation  
**Component:** Discovery UI (React App)  
**Depends on:** SCRAPER_SPEC.md (produces the data this app consumes)

---

## Core Idea

India has 39+ specialty coffee roasters, each with their own website, branding, and product catalog. A consumer who wants to explore Indian specialty coffee has no single place to browse, compare, and discover coffees across roasters.

This app is that place. It is a **card-based discovery platform** that presents every specialty coffee from every Indian roaster in a unified, beautiful, browsable interface. Each coffee is a flip-card — the front shows the product image and key identity (name, roaster, price), and the back reveals the depth (tasting notes, origin, altitude, roast level, process). The user can like, share, and eventually buy.

**This is the frontend-only specification.** It consumes static JSON produced by the scraper pipeline (specified separately in SCRAPER_SPEC.md). No backend server. No database. No authentication. Just a React app serving a local JSON file.

The share button is the growth engine. Every shared card must render a beautiful preview on WhatsApp, Instagram, and Twitter — this is how people hear about the platform.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Data Layer](#3-data-layer)
4. [UI Design System](#4-ui-design-system)
5. [Coffee Card Specification](#5-coffee-card-specification)
6. [Card Grid & Layout](#6-card-grid--layout)
7. [Filtering & Search](#7-filtering--search)
8. [Roaster Profile Page](#8-roaster-profile-page)
9. [Individual Coffee Page](#9-individual-coffee-page)
10. [Like System](#10-like-system)
11. [Share System](#11-share-system)
12. [Navigation & Routing](#12-navigation--routing)
13. [Responsive Design](#13-responsive-design)
14. [Performance](#14-performance)
15. [SEO & Social Previews](#15-seo--social-previews)
16. [Future: Transaction Bridge](#16-future-transaction-bridge)
17. [Implementation Checklist](#17-implementation-checklist)

---

## 1. Architecture Overview

### 1.1 System Diagram

```
┌──────────────────────────────────────────────────┐
│  STATIC DATA (products.json)                     │
│  Output of scraper pipeline                      │
│  ~400-600 coffee products from ~39 roasters      │
│  Loaded at build time or fetched at runtime      │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│  REACT APP (Vite + React)                        │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Card Grid  │  │  Filters   │  │  Search   │  │
│  │ (flip anim)│  │ (sidebar)  │  │  (top bar)│  │
│  └────────────┘  └────────────┘  └───────────┘  │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Coffee     │  │  Roaster   │  │  Liked    │  │
│  │ Detail Page│  │  Profile   │  │  Page     │  │
│  └────────────┘  └────────────┘  └───────────┘  │
│                                                  │
│  State: React useState/useReducer                │
│  Persistence: localStorage (likes only)          │
│  Routing: React Router                           │
└──────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | React 18+ (Vite) | Fast, local dev with HMR, simple build |
| Styling | Tailwind CSS | Rapid utility-first styling, responsive out of the box |
| Animations | CSS transitions + Framer Motion | Flip-card animation, page transitions |
| Routing | React Router v6 | Client-side routing for coffee/roaster pages |
| Build | Vite | Fast builds, ESM-native, works well on M1 |
| Icons | Lucide React | Lightweight, consistent icon set |
| Data | Static JSON import | No API calls, no backend, no database |

### 1.3 Local Development

```bash
# Setup
npm create vite@latest coffee-discovery -- --template react
cd coffee-discovery
npm install
npm install tailwindcss @tailwindcss/vite framer-motion react-router-dom lucide-react

# Development
npm run dev          # → http://localhost:5173

# Build for deployment (when ready)
npm run build        # → dist/ folder, deployable to Vercel/Netlify
```

### 1.4 Core Principles

- **No backend.** Everything runs client-side. The JSON is the entire "database."
- **Offline-capable.** Once loaded, the app works without network (except images, which load from roaster CDNs).
- **Mobile-first.** Most specialty coffee discovery happens on phones (Instagram → WhatsApp share → browse). Design for 375px first, scale up.
- **Fast.** Target: <2 second first contentful paint on localhost. Lazy-load images, virtualize the card grid if needed.
- **Beautiful.** The card UI is the product. It must look better than any individual roaster's own website. This is the value proposition.

---

## 2. Project Structure

```
coffee-discovery/
├── public/
│   ├── favicon.ico
│   ├── og-default.jpg                    ← Default social preview image
│   └── robots.txt
│
├── src/
│   ├── main.jsx                          ← Entry point
│   ├── App.jsx                           ← Router + layout shell
│   │
│   ├── data/
│   │   └── products.json                 ← Static data from scraper (copied here)
│   │
│   ├── components/
│   │   ├── CoffeeCard.jsx                ← The flip-card component (core UI)
│   │   ├── CardGrid.jsx                  ← Responsive grid of CoffeeCards
│   │   ├── FilterSidebar.jsx             ← Filter panel (roast, roaster, price, etc.)
│   │   ├── SearchBar.jsx                 ← Search input with live filtering
│   │   ├── Navbar.jsx                    ← Top navigation bar
│   │   ├── LikeButton.jsx               ← Heart icon with localStorage persistence
│   │   ├── ShareButton.jsx              ← Share dropdown (copy link, WhatsApp, Twitter)
│   │   ├── RoasterBadge.jsx             ← Small roaster identity chip
│   │   ├── PriceTag.jsx                 ← Price display with per-gram comparison
│   │   ├── CoffeeMetaRow.jsx            ← Single metadata row (icon + label + value)
│   │   └── VariantSelector.jsx          ← Weight/size variant pills
│   │
│   ├── pages/
│   │   ├── HomePage.jsx                  ← Card grid + filters + search
│   │   ├── CoffeePage.jsx                ← Individual coffee detail page
│   │   ├── RoasterPage.jsx              ← Roaster profile + their coffees
│   │   ├── LikedPage.jsx                ← User's liked coffees
│   │   └── AboutPage.jsx                ← About the platform
│   │
│   ├── hooks/
│   │   ├── useCoffeeData.js             ← Load and index the JSON data
│   │   ├── useFilters.js                ← Filter state management
│   │   ├── useLikes.js                  ← localStorage-based like system
│   │   └── useShare.js                  ← Share URL generation and clipboard
│   │
│   ├── utils/
│   │   ├── filterCoffees.js             ← Filter logic (pure function)
│   │   ├── searchCoffees.js             ← Search/fuzzy match logic
│   │   ├── formatPrice.js              ← ₹ formatting with commas
│   │   └── generateShareUrl.js          ← Build shareable URLs with OG params
│   │
│   └── styles/
│       └── index.css                     ← Tailwind directives + custom CSS (flip animation)
│
├── index.html
├── tailwind.config.js
├── vite.config.js
├── package.json
└── README.md
```

---

## 3. Data Layer

### 3.1 Loading Strategy

The `products.json` file is placed in `src/data/` and imported directly:

```javascript
// hooks/useCoffeeData.js

import rawProducts from '../data/products.json';
import { useMemo } from 'react';

export function useCoffeeData() {
  const { products, roasters, roastLevels, origins } = useMemo(() => {
    // Filter to only available products (or include all, with availability flag)
    const products = rawProducts;

    // Build roaster index: unique roasters with their coffee counts
    const roasterMap = new Map();
    products.forEach(p => {
      if (!roasterMap.has(p.roaster_slug)) {
        roasterMap.set(p.roaster_slug, {
          slug: p.roaster_slug,
          name: p.roaster_name,
          city: p.roaster_city,
          state: p.roaster_state,
          lat: p.roaster_lat,
          lng: p.roaster_lng,
          website: p.roaster_website,
          coffeeCount: 0,
        });
      }
      roasterMap.get(p.roaster_slug).coffeeCount++;
    });
    const roasters = Array.from(roasterMap.values());

    // Extract unique roast levels for filter
    const roastLevels = [...new Set(products.map(p => p.roast_level).filter(Boolean))];

    // Extract unique origins
    const origins = [...new Set(products.map(p => p.origin).filter(Boolean))];

    return { products, roasters, roastLevels, origins };
  }, []);

  return { products, roasters, roastLevels, origins };
}
```

### 3.2 Data Indexing

On load, the hook builds:
- A product array (the main list)
- A roaster index (for the roaster profile pages and filter dropdown)
- Unique roast levels, origins, and tags (for filter options)

All computed once via `useMemo`. No re-computation on re-render.

### 3.3 Product Lookup

For individual coffee pages and share links, products are looked up by `product_id`:

```javascript
const coffee = products.find(p => p.product_id === productId);
```

For ~500 products this is instantaneous. If the dataset grows beyond 2000, switch to a `Map` keyed by `product_id`.

---

## 4. UI Design System

### 4.1 Color Palette

The design language is warm, earthy, and premium — reflecting specialty coffee culture.

| Token | Hex | Usage |
|---|---|---|
| `--color-bg` | `#FAF7F2` | Page background (warm off-white, like unbleached paper) |
| `--color-card-front` | `#FFFFFF` | Card front face |
| `--color-card-back` | `#2C1810` | Card back face (deep coffee brown) |
| `--color-text-primary` | `#1A1A1A` | Headings, card front text |
| `--color-text-secondary` | `#6B5B4F` | Subtext, metadata labels |
| `--color-text-on-dark` | `#F5F0EB` | Text on dark card back |
| `--color-accent` | `#C8553D` | Buttons, links, active states (terracotta/rust) |
| `--color-accent-hover` | `#A94432` | Hover state for accent |
| `--color-like` | `#E63946` | Like button filled state (red) |
| `--color-tag-bg` | `#EDE8E1` | Tag/chip background |
| `--color-tag-text` | `#5D4E42` | Tag/chip text |
| `--color-border` | `#E0D8CF` | Card borders, dividers |
| `--color-unavailable` | `#B0A89F` | Greyed-out sold-out products |

### 4.2 Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| App title / Logo | `Playfair Display` (serif) | 28px | 700 |
| Card coffee name | `Playfair Display` | 18px | 600 |
| Card roaster name | `Inter` (sans-serif) | 13px | 500 |
| Card back headings | `Inter` | 11px uppercase | 600 |
| Card back values | `Inter` | 14px | 400 |
| Body text | `Inter` | 15px | 400 |
| Price | `Inter` | 20px | 700 |
| Price per gram | `Inter` | 12px | 400 |
| Filter labels | `Inter` | 13px | 500 |
| Buttons | `Inter` | 14px | 600 |

**Font loading:** Import from Google Fonts in `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 4.3 Spacing & Sizing

| Token | Value | Usage |
|---|---|---|
| Card width | 300px | Fixed card width |
| Card height (front) | 420px | Image (240px) + content (180px) |
| Card border radius | 16px | Rounded corners |
| Grid gap | 24px | Space between cards |
| Page padding | 24px mobile, 48px desktop | Page edge margins |
| Section spacing | 48px | Between major sections |

### 4.4 Shadows & Depth

```css
/* Card resting state */
.card-shadow {
  box-shadow: 0 2px 8px rgba(44, 24, 16, 0.08);
}

/* Card hover state */
.card-shadow-hover {
  box-shadow: 0 8px 24px rgba(44, 24, 16, 0.15);
}

/* Card flipped state (elevated) */
.card-shadow-flipped {
  box-shadow: 0 12px 32px rgba(44, 24, 16, 0.20);
}
```

---

## 5. Coffee Card Specification

This is the core UI element. Every coffee product is rendered as a flip-card.

### 5.1 Card Structure

```
┌─────────────────────────────────┐
│         FRONT FACE              │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │     PRODUCT IMAGE         │  │
│  │     (240px height)        │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  Attikan Estate               ♡ │
│  Blue Tokai Coffee Roasters     │
│                                 │
│  Medium Roast  •  Washed        │
│                                 │
│  ₹449 / 250g         ₹1.80/g   │
│                                 │
└─────────────────────────────────┘
```

```
┌─────────────────────────────────┐
│         BACK FACE               │
│       (dark background)         │
│                                 │
│  ☕ TASTING NOTES               │
│  Chocolate, Citrus, Nutty       │
│                                 │
│  📍 ORIGIN                     │
│  Attikan Estate, Chikmagalur    │
│                                 │
│  ⛰️ ALTITUDE                   │
│  1,200 m.a.s.l.                │
│                                 │
│  🌱 VARIETAL                   │
│  SLN 795, Kent                  │
│                                 │
│  ⚙️ PROCESS                    │
│  Washed                         │
│                                 │
│  ┌────────┐ ┌────────┐         │
│  │ Share  │ │  Like  │         │
│  └────────┘ └────────┘         │
│                                 │
│       ↻ Tap to flip back       │
└─────────────────────────────────┘
```

### 5.2 Flip Animation

The card flips on click/tap, rotating 180° on the Y-axis to reveal the back face.

**CSS implementation:**

```css
.card-container {
  perspective: 1000px;
  width: 300px;
  height: 420px;
}

.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
}

.card-inner.flipped {
  transform: rotateY(180deg);
}

.card-front,
.card-back {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  border-radius: 16px;
  overflow: hidden;
}

.card-back {
  transform: rotateY(180deg);
}
```

**Interaction rules:**
- **Desktop:** Click anywhere on the card to flip. Click again to flip back.
- **Mobile:** Tap anywhere on the card to flip. Tap again to flip back.
- **Exception:** Clicking the Like button, Share button, or roaster name link should NOT trigger the flip. Use `event.stopPropagation()` on those elements.

### 5.3 Front Face Elements

| Element | Source Field | Behavior |
|---|---|---|
| Product image | `image_url` | Object-fit cover, 240px height. Lazy loaded. Placeholder gradient if null. |
| Coffee name | `coffee_name` | Truncate with ellipsis if >2 lines. Full name on hover tooltip. |
| Roaster name | `roaster_name` | Clickable — navigates to roaster profile page. Does NOT trigger flip. |
| Roast level chip | `roast_level` | Small pill/chip. Hidden if `Unknown`. |
| Process chip | `process` | Small pill next to roast level. Hidden if null. |
| Price | `price_inr` | Formatted: `₹449`. Bold, prominent. |
| Weight | `weight_grams` | Shown next to price: `/ 250g` |
| Price per gram | `price_per_gram` | Small text below price: `₹1.80/g` |
| Like button | — | Heart icon, top-right of image. See Section 10. |
| Availability | `available` | If false, overlay the image with a semi-transparent "Sold Out" badge. |

### 5.4 Back Face Elements

The back face has a dark brown background (`#2C1810`) with light text (`#F5F0EB`).

Each metadata row follows the pattern:

```
[Icon]  LABEL (uppercase, small, muted)
        Value (normal size, bright)
```

| Row | Icon | Label | Source Field | Display if null? |
|---|---|---|---|---|
| Tasting notes | ☕ or coffee cup icon | TASTING NOTES | `tasting_notes` | Show "Not listed" in muted text |
| Origin | 📍 or map pin icon | ORIGIN | `origin` | Show "Not listed" |
| Altitude | ⛰️ or mountain icon | ALTITUDE | `altitude_masl` | Hide row entirely |
| Varietal | 🌱 or leaf icon | VARIETAL | `varietal` | Hide row entirely |
| Process | ⚙️ or gear icon | PROCESS | `process` | Hide row entirely |

**Conditional rows:** Altitude, varietal, and process are only shown if data exists. Tasting notes and origin always show (with "Not listed" fallback).

**Bottom of back face:**

Two action buttons side by side:
- **Share** button (left) — see Section 11
- **Like** button (right) — see Section 10

Below the buttons, a small muted text hint: `"Tap to flip back"` with a flip icon.

### 5.5 Variant Handling

If a coffee has multiple weight variants, the **front face** shows the **smallest available variant** by default (most affordable entry point). A small text below the price indicates other sizes exist:

```
₹449 / 250g     ₹1.80/g
Also: 500g · 1kg
```

The individual coffee detail page (Section 9) shows the full variant selector.

### 5.6 Sold-Out State

If `available: false`:
- Front face: product image overlaid with a semi-transparent dark wash and "Sold Out" text centered
- Like and share buttons still functional
- Card still flips
- Price still shown (with strikethrough style)
- Used to indicate: "this coffee exists but isn't in stock right now"

---

## 6. Card Grid & Layout

### 6.1 Grid Behavior

The home page displays all coffee cards in a responsive grid.

| Viewport | Columns | Card Width | Gap |
|---|---|---|---|
| <640px (mobile) | 1 | Full width (max 360px, centered) | 16px |
| 640–1024px (tablet) | 2 | 300px | 20px |
| 1024–1440px (desktop) | 3 | 300px | 24px |
| >1440px (wide) | 4 | 300px | 24px |

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
  justify-items: center;
}
```

### 6.2 Sorting

Default sort: **Newest first** (by `scraped_at`, which roughly corresponds to most recently updated catalogs).

Available sort options (dropdown in toolbar):
- Newest first
- Price: Low to High
- Price: High to Low
- Price per gram: Low to High
- Price per gram: High to Low
- Roaster: A → Z
- Name: A → Z

### 6.3 Infinite Scroll / Pagination

For ~500 products, render the first 24 cards immediately and lazy-load the rest as the user scrolls. Use `IntersectionObserver` to trigger loading the next batch of 24.

**No traditional page numbers.** Infinite scroll is the expected mobile pattern.

### 6.4 Empty State

If filters return zero results:

```
☕
No coffees match your filters.
Try broadening your search or clearing some filters.

[Clear all filters]
```

---

## 7. Filtering & Search

### 7.1 Filter Panel

On desktop: a collapsible sidebar on the left (240px wide).  
On mobile: a bottom sheet triggered by a "Filters" button in the toolbar.

**Filter categories:**

| Filter | Type | Options Source |
|---|---|---|
| Roaster | Multi-select checkboxes | Unique `roaster_name` values |
| Roast Level | Multi-select checkboxes | `Light`, `Medium-Light`, `Medium`, `Medium-Dark`, `Dark` |
| Origin / Region | Multi-select checkboxes | Unique `origin` values |
| Process | Multi-select checkboxes | `Washed`, `Natural`, `Honey`, `Anaerobic`, etc. |
| Price Range | Range slider | Min–Max of all `price_inr` values |
| Price per Gram | Range slider | Min–Max of all `price_per_gram` values |
| Availability | Toggle | Show sold-out items (default: on) |

**Filter logic:** All filters are AND-combined. Within each multi-select, options are OR-combined.

Example: Roaster = [Blue Tokai, Subko] AND Roast Level = [Medium, Dark] → shows coffees from either roaster that are either Medium or Dark roast.

### 7.2 Active Filter Display

Active filters shown as removable chips above the card grid:

```
Showing 47 coffees  ·  Blue Tokai ✕  ·  Medium Roast ✕  ·  ₹200–₹600 ✕  ·  [Clear all]
```

### 7.3 Search

A search bar in the top navigation. Searches across:
- `coffee_name`
- `roaster_name`
- `tasting_notes`
- `origin`
- `tags`

**Implementation:** Simple case-insensitive substring match. No fuzzy matching needed at this scale (~500 products).

```javascript
function searchCoffees(products, query) {
  const q = query.toLowerCase().trim();
  if (!q) return products;

  return products.filter(p =>
    p.coffee_name.toLowerCase().includes(q) ||
    p.roaster_name.toLowerCase().includes(q) ||
    (p.tasting_notes && p.tasting_notes.toLowerCase().includes(q)) ||
    (p.origin && p.origin.toLowerCase().includes(q)) ||
    (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
  );
}
```

### 7.4 URL State Sync

Filters and search should be reflected in the URL query string so that filtered views are shareable:

```
/browse?roaster=blue-tokai,subko&roast=medium&q=chocolate
```

Use React Router's `useSearchParams` to sync filter state with URL.

---

## 8. Roaster Profile Page

### 8.1 Route

```
/roaster/:roaster_slug
```

Example: `/roaster/blue-tokai`

### 8.2 Layout

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Blue Tokai Coffee Roasters                         │
│  New Delhi, Delhi                                   │
│  bluetokaicoffee.com ↗                              │
│                                                     │
│  32 coffees available                               │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Card Grid of this roaster's coffees only]         │
│                                                     │
│  (Same card components, same flip behavior)         │
│  (Filters still available, scoped to this roaster)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 8.3 Data

All data is derived from the products JSON — the roaster's name, city, state, website, and coffee count are computed from the product entries. No separate roaster data file needed.

---

## 9. Individual Coffee Page

### 9.1 Route

```
/coffee/:product_id
```

Example: `/coffee/blue-tokai_attikan-estate-medium-roast`

### 9.2 Purpose

This page exists for two reasons:
1. **Share target.** When someone shares a coffee, the link opens this page.
2. **Full detail view.** Shows everything the card shows, plus the full description, all variants, and the buy link.

### 9.3 Layout

```
┌─────────────────────────────────────────────────────┐
│  ← Back to browse                                   │
│                                                     │
│  ┌──────────────────┐   Attikan Estate              │
│  │                  │   Blue Tokai Coffee Roasters ↗ │
│  │  LARGE PRODUCT   │                               │
│  │  IMAGE           │   Medium Roast  •  Washed     │
│  │  (400px)         │                               │
│  │                  │   ☕ Chocolate, Citrus, Nutty   │
│  └──────────────────┘   📍 Attikan Estate, Chikmagalur│
│                         ⛰️ 1,200 m.a.s.l.           │
│                         🌱 SLN 795, Kent             │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  250g   ₹449     ← selected                │    │
│  │  500g   ₹799                                │    │
│  │  1kg    ₹1,449                              │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ₹1.80/g                                           │
│                                                     │
│  [♡ Like]  [↗ Share]  [🛒 Buy from Blue Tokai]     │
│                                                     │
│  ─────────────────────────────────────              │
│                                                     │
│  ABOUT THIS COFFEE                                  │
│  (Full description_raw text)                        │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  MORE FROM BLUE TOKAI                               │
│  [Card] [Card] [Card] (horizontal scroll)           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 9.4 Buy Button

The "Buy from {Roaster}" button opens `product_url` in a new tab. This is the bridge to the roaster's own website.

In the future (V2), this button will be replaced with cart injection or an on-platform checkout. The `product_url` ensures this transition is seamless — every card already knows where to send the user.

### 9.5 Variant Selector

Clickable pills showing each variant's weight and price. Selecting a variant updates the displayed price, price-per-gram, and the buy link (if variants have different URLs).

```
  [250g  ₹449]   [500g  ₹799]   [1kg  ₹1,449]
       ▲ selected
```

---

## 10. Like System

### 10.1 Persistence

Likes are stored in `localStorage` as a JSON array of `product_id` strings:

```javascript
// hooks/useLikes.js

const STORAGE_KEY = 'coffee_likes';

export function useLikes() {
  const [likes, setLikes] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const toggleLike = (productId) => {
    setLikes(prev => {
      const next = prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const isLiked = (productId) => likes.includes(productId);

  return { likes, toggleLike, isLiked };
}
```

### 10.2 UI Behavior

- **Unliked:** Outline heart icon (transparent fill, border only)
- **Liked:** Solid filled heart icon in `--color-like` red, with a brief scale-up animation (pulse)
- **Tap:** Toggles state. On the card front, the heart sits in the top-right corner of the image area.
- **On card back:** A full "Like" button with the heart icon + text label.
- **On coffee detail page:** A full "Like" button with text.

### 10.3 Liked Page

Route: `/liked`

Shows all liked coffees as the same card grid. If no likes yet:

```
♡
You haven't liked any coffees yet.
Start browsing and tap the heart on coffees you love!

[Browse coffees →]
```

---

## 11. Share System

### 11.1 Share URL

Every coffee has a shareable URL:

```
https://{domain}/coffee/{product_id}
```

During local development this is `http://localhost:5173/coffee/blue-tokai_attikan-estate-medium-roast`.

When deployed, it becomes the public URL.

### 11.2 Share Actions

The Share button opens a small dropdown/bottom sheet with options:

| Action | Behavior |
|---|---|
| **Copy Link** | Copies the coffee page URL to clipboard. Shows "Copied!" toast. |
| **WhatsApp** | Opens `https://wa.me/?text={encoded message + URL}` |
| **Twitter/X** | Opens `https://twitter.com/intent/tweet?text={encoded message}&url={url}` |
| **Native Share** | Uses `navigator.share()` API if available (mobile browsers). Falls back to copy link. |

**Share text template:**

```
Check out {coffee_name} from {roaster_name} — {tasting_notes}. ₹{price} for {weight}g.
{url}
```

Example:

```
Check out Attikan Estate from Blue Tokai — Chocolate, Citrus, Nutty. ₹449 for 250g.
https://coffeemap.in/coffee/blue-tokai_attikan-estate-medium-roast
```

### 11.3 Mobile-First Share Priority

On mobile, `navigator.share()` is supported on iOS Safari, Chrome Android, and most modern browsers. If available, use it as the primary share action (single tap → native share sheet). The dropdown with WhatsApp/Twitter/Copy is the fallback for desktop and older browsers.

---

## 12. Navigation & Routing

### 12.1 Routes

| Path | Component | Description |
|---|---|---|
| `/` | `HomePage` | Card grid with filters and search |
| `/coffee/:product_id` | `CoffeePage` | Individual coffee detail |
| `/roaster/:roaster_slug` | `RoasterPage` | Roaster profile + their coffees |
| `/liked` | `LikedPage` | User's liked coffees |
| `/about` | `AboutPage` | About the platform |

### 12.2 Navbar

Fixed top bar on all pages:

```
┌─────────────────────────────────────────────────────┐
│  ☕ CoffeeCatalog    [Search...]    ♡ (3)    About  │
└─────────────────────────────────────────────────────┘
```

- Logo/name: links to `/`
- Search: expands to full search bar on focus
- Heart with count: links to `/liked`, shows total liked count
- About: links to `/about`

On mobile, the search bar collapses to a search icon that expands on tap.

---

## 13. Responsive Design

### 13.1 Breakpoints

| Breakpoint | Label | Layout Changes |
|---|---|---|
| <640px | Mobile | 1-column cards, bottom sheet filters, hamburger nav |
| 640–1024px | Tablet | 2-column cards, collapsible sidebar filters |
| 1024–1440px | Desktop | 3-column cards, persistent sidebar filters |
| >1440px | Wide | 4-column cards, persistent sidebar |

### 13.2 Mobile-Specific Adaptations

- **Filter panel:** becomes a bottom sheet (slides up from bottom) triggered by a floating "Filter" button
- **Search:** becomes a full-screen overlay on tap
- **Card width:** fills screen width with 16px padding on each side (max 360px, centered)
- **Coffee detail page:** single-column layout with image on top, details below
- **Share button:** uses `navigator.share()` natively

### 13.3 Touch Interactions

- Card flip: tap (not click-and-hold, not swipe)
- Like: tap heart (with ripple feedback)
- Share: tap share icon → native share sheet or dropdown
- Scroll: smooth scroll, momentum scrolling on iOS

---

## 14. Performance

### 14.1 Image Loading

- All product images lazy-loaded with `loading="lazy"` on `<img>` tags
- Use Shopify CDN image transformation for responsive sizes:
  ```
  {image_url}?width=600    (card view)
  {image_url}?width=800    (detail page)
  ```
  This works for Shopify-hosted images. For non-Shopify images, load the original.
- Placeholder: a subtle gradient in coffee-tones (`#D4C5B8` to `#E8DDD3`) while image loads

### 14.2 Card Grid Virtualization

For 500+ cards, consider virtualizing the grid so only visible cards are in the DOM. Options:
- `react-window` or `react-virtuoso` for virtualized grids
- Or: simple pagination with "Load more" button (24 cards per page)

**Recommendation for MVP:** Start with the simple "load 24, scroll to load 24 more" approach. Only add virtualization if performance profiling shows a need.

### 14.3 Bundle Size

Target: <200KB gzipped for the JS bundle (excluding images and fonts).

- Vite tree-shakes unused code
- Framer Motion adds ~30KB gzipped — acceptable for the flip animations
- Tailwind purges unused classes at build time

---

## 15. SEO & Social Previews

### 15.1 OG Meta Tags

Every coffee page must have proper Open Graph tags so shared links render beautiful previews on WhatsApp, iMessage, Twitter, and Instagram.

**For individual coffee pages (`/coffee/:product_id`):**

```html
<meta property="og:title" content="Attikan Estate — Blue Tokai Coffee Roasters" />
<meta property="og:description" content="Medium Roast · Chocolate, Citrus, Nutty · ₹449 / 250g" />
<meta property="og:image" content="https://cdn.shopify.com/.../attikan-estate.jpg" />
<meta property="og:url" content="https://coffeemap.in/coffee/blue-tokai_attikan-estate-medium-roast" />
<meta property="og:type" content="product" />
<meta name="twitter:card" content="summary_large_image" />
```

### 15.2 Dynamic OG Tags Challenge

Since this is a static React SPA, OG tags cannot be set dynamically per page on the client — social media crawlers don't execute JavaScript. This needs one of:

**Option A: Pre-rendering at build time** — Use a Vite plugin or a static site generator to pre-render each coffee page as a static HTML file with correct OG tags. This is the cleanest solution for a static JSON dataset. Tools: `vite-plugin-ssr`, `react-snap`, or a custom build script.

**Option B: Edge function at deploy time** — Deploy to Vercel/Netlify and use an edge function that intercepts crawler user agents (facebookexternalhit, Twitterbot, WhatsApp) and returns a lightweight HTML page with correct OG tags. Regular users get the SPA.

**Option C: Defer to V2** — For local development, OG tags don't matter. Ship without them and add pre-rendering when the app is deployed publicly.

**Recommendation:** Start with Option C. Add Option A or B when deploying.

---

## 16. Future: Transaction Bridge

This section is **not in scope for MVP** but documents how the current architecture supports the eventual transaction layer.

### 16.1 The URL Bridge

Every coffee card already stores `product_url` — the direct link to buy this coffee on the roaster's own website. The current "Buy from {Roaster}" button opens this URL in a new tab.

### 16.2 Upgrade Path to Cart Injection

When the transaction layer is built:

1. For Shopify roasters: the "Buy" button calls Shopify's `/cart/add.json` endpoint with the `variant_id` (extractable from the scraped variant data) to add the item to the roaster's cart, then redirects to the roaster's checkout page.
2. For non-Shopify roasters: the button continues to redirect to `product_url`.

### 16.3 Upgrade Path to On-Platform Checkout

Further in the future, the "Buy" button triggers an on-platform checkout flow where:
- The platform collects payment (Razorpay/Cashfree)
- The platform forwards the order to the roaster
- The platform takes a commission at settlement (5–8%)
- This requires: Pvt. Ltd. formation, RBI payment aggregator compliance, roaster onboarding

**None of this affects the current spec.** The current architecture is designed so that the frontend never needs to be rewritten — only the action behind the "Buy" button changes.

---

## 17. Implementation Checklist

### Phase 1: Project Setup

- [ ] Initialize Vite + React project
- [ ] Install and configure Tailwind CSS
- [ ] Install dependencies (framer-motion, react-router-dom, lucide-react)
- [ ] Set up Google Fonts (Playfair Display, Inter)
- [ ] Define CSS custom properties (color palette, shadows)
- [ ] Place `products.json` in `src/data/`
- [ ] Implement `useCoffeeData` hook (data loading and indexing)

### Phase 2: Coffee Card Component

- [ ] Build `CoffeeCard.jsx` with front and back faces
- [ ] Implement CSS flip animation (Y-axis 180° rotation)
- [ ] Front face: image, name, roaster, roast chip, price, weight, price/g
- [ ] Back face: tasting notes, origin, altitude, varietal, process
- [ ] Handle null/missing fields (conditional rows on back)
- [ ] Sold-out overlay state
- [ ] Image lazy loading with placeholder gradient

### Phase 3: Card Grid & Home Page

- [ ] Build `CardGrid.jsx` with responsive CSS grid
- [ ] Build `HomePage.jsx` combining grid + toolbar
- [ ] Implement sorting (dropdown with sort options)
- [ ] Implement infinite scroll / load-more (24 cards per batch)
- [ ] Empty state for zero results

### Phase 4: Filtering & Search

- [ ] Build `FilterSidebar.jsx` with all filter categories
- [ ] Build `SearchBar.jsx` with live substring matching
- [ ] Implement `useFilters` hook (filter state management)
- [ ] Active filter chips display with removal
- [ ] URL query string sync (filters in URL)
- [ ] Mobile: bottom sheet filter panel

### Phase 5: Like System

- [ ] Implement `useLikes` hook (localStorage persistence)
- [ ] Build `LikeButton.jsx` with heart icon toggle + pulse animation
- [ ] Integrate like button on card front (image corner) and card back
- [ ] Build `LikedPage.jsx` showing liked coffees

### Phase 6: Share System

- [ ] Implement `useShare` hook (URL generation, clipboard, native share)
- [ ] Build `ShareButton.jsx` with dropdown (Copy, WhatsApp, Twitter, Native)
- [ ] Share text template generation
- [ ] "Copied!" toast notification
- [ ] Mobile: prefer `navigator.share()` API

### Phase 7: Detail Pages & Routing

- [ ] Set up React Router with all routes
- [ ] Build `CoffeePage.jsx` (individual coffee detail)
- [ ] Build `RoasterPage.jsx` (roaster profile + their coffees)
- [ ] Build `Navbar.jsx` with logo, search, liked count, about link
- [ ] Build `AboutPage.jsx`
- [ ] "More from this roaster" horizontal scroll on coffee detail page

### Phase 8: Polish & Responsive

- [ ] Mobile responsive pass on all pages
- [ ] Touch interaction tuning (tap targets, scroll behavior)
- [ ] Loading states and transitions
- [ ] Performance audit (bundle size, image loading, scroll performance)
- [ ] Cross-browser testing (Chrome, Safari, Firefox)

---

**END OF UI FRONTEND SPECIFICATION**

*This document consumes the output of SCRAPER_SPEC.md. Build the scraper first, review the data, then build this UI.*
