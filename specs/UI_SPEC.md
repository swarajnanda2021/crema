# Crema — Frontend UI Specification

**Version:** 2.0 (reflects actual implementation)
**Last Updated:** April 2026
**Component:** React Discovery & Community Frontend

---

## 1. Overview

Crema's frontend is a React 18 single-page application that serves as both a coffee bean discovery marketplace and a social community platform. The social feed is the primary entry point (home route), with the marketplace (Browse) as a secondary tab.

---

## 2. Technology Stack

| Technology | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | 5 | Build tool & dev server |
| Tailwind CSS | 4 | Utility-first styling (via `@import "tailwindcss"`) |
| React Router | 6 | Client-side routing |
| Lucide React | latest | Icon library |
| Framer Motion | latest | Animations |
| react-easy-crop | latest | Image crop/zoom for avatar uploads |

**No component library** — all components are custom-built.

---

## 3. Directory Structure

```
coffee-discovery/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── src/
    ├── App.jsx                    # Root: providers + routes
    ├── main.jsx                   # ReactDOM entry point
    ├── styles/
    │   └── index.css              # Theme variables + flip-card CSS + scrollbar hide
    ├── components/                # Shared/marketplace components
    │   ├── Navbar.jsx
    │   ├── CoffeeCard.jsx         # 3D flip card
    │   ├── CardGrid.jsx           # Infinite-scroll grid
    │   ├── IndiaMap.jsx           # SVG India outline with pins
    │   ├── FilterSidebar.jsx      # Filter panel for Browse
    │   └── ShareButton.jsx        # Web Share API + fallback
    ├── pages/                     # Route-level pages
    │   ├── BrowsePage.jsx         # Tabs: Beans + Roasters
    │   ├── HomePage.jsx           # Beans grid with filters
    │   ├── CoffeePage.jsx         # Single coffee detail
    │   ├── RoasterPage.jsx        # Single roaster profile
    │   └── RoastersPage.jsx       # Roaster directory
    ├── hooks/                     # Shared data hooks
    │   ├── useCoffeeData.jsx      # Products context + provider
    │   ├── useFilters.js          # URL-param-driven filter state
    │   └── useShare.js            # Share utilities
    ├── utils/
    │   ├── filterCoffees.js       # Filter + sort logic
    │   └── formatPrice.js         # Price formatting helpers
    ├── data/
    │   ├── products.json          # Bundled product data (fallback)
    │   ├── roasters.json          # Bundled roaster data (fallback)
    │   └── coffeeRegions.js       # 33 estates + 25 regions with lat/lng
    └── community/                 # Community layer (auth-gated)
        ├── api.js                 # API client with bearer token
        ├── hooks/
        │   ├── useAuth.jsx        # Auth context + provider
        │   ├── useShelves.jsx     # Shelf CRUD hook
        │   └── useRecommendations.js  # Recommendations fetcher
        ├── pages/
        │   ├── AuthPage.jsx       # Login / Register
        │   ├── FeedPage.jsx       # Temporal feed (home route)
        │   ├── MyShelfPage.jsx    # 3-column profile + shelf
        │   └── UserProfilePage.jsx # Other user's profile
        └── components/
            ├── ShelfIsland.jsx        # Shelf card with notes
            ├── ShelfSelector.jsx      # Add-to-shelf dropdown
            ├── TastingNoteForm.jsx    # Note creation form
            ├── TastingNoteDisplay.jsx # Note display card
            ├── ProfileCard.jsx        # Avatar + bio sidebar
            ├── ProfileEditForm.jsx    # Profile edit modal
            ├── ImageCropModal.jsx     # Circular crop with zoom
            ├── RecommendationPanel.jsx # Recommendations sidebar
            ├── PopularityModal.jsx    # "Who has this" modal
            └── QuickAddModal.jsx      # Search + add to shelf
```

---

## 4. Routing

```jsx
<AuthProvider>
  <CoffeeDataProvider>
    <Navbar />
    <Routes>
      <Route path="/"                element={<AuthGuard><FeedPage /></AuthGuard>} />
      <Route path="/profile"         element={<AuthGuard><MyShelfPage /></AuthGuard>} />
      <Route path="/user/:username"  element={<AuthGuard><UserProfilePage /></AuthGuard>} />
      <Route path="/auth"            element={<AuthPage />} />
      <Route path="/browse"          element={<BrowsePage />} />
      <Route path="/coffee/:productId" element={<CoffeePage />} />
      <Route path="/roaster/:roasterSlug" element={<RoasterPage />} />
      {/* Legacy redirects */}
      <Route path="/my-shelf"  → Navigate to="/profile" />
      <Route path="/roasters"  → Navigate to="/browse?tab=roasters" />
    </Routes>
  </CoffeeDataProvider>
</AuthProvider>
```

**AuthGuard:** Redirects to `/auth` if not logged in or backend unavailable.

---

## 5. Theme & Design System

### CSS Custom Properties (`index.css`)

```css
@theme {
  --color-bg: #FAF7F2;              /* Warm cream background */
  --color-card-front: #FFFFFF;
  --color-card-back: #2C1810;        /* Dark coffee brown */
  --color-text-primary: #1A1A1A;
  --color-text-secondary: #6B5B4F;
  --color-text-on-dark: #F5F0EB;
  --color-accent: #C8553D;           /* Terracotta red */
  --color-accent-hover: #A94432;
  --color-like: #E63946;
  --color-tag-bg: #EDE8E1;
  --color-tag-text: #5D4E42;
  --color-border: #E0D8CF;
  --color-unavailable: #B0A89F;

  --font-serif: "Playfair Display", Georgia, serif;
  --font-sans: "Inter", system-ui, sans-serif;
}
```

### Global Styles
- All scrollbars hidden: `* { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }`
- Body: `font-family: var(--font-sans)`, `background: var(--color-bg)`

---

## 6. Core Components

### 6.1 Navbar (`Navbar.jsx`)

Fixed top bar, 56px height, backdrop blur, z-50.

| Element | Behavior |
|---|---|
| Crema logo (Coffee icon + text) | Links to `/` (feed) |
| My Shelf tab | Links to `/profile` (visible when logged in) |
| Browse tab | Links to `/browse` |
| Search icon | Toggles inline search input, navigates to `/browse?q={query}` |
| Sign In button | Links to `/auth` (visible when logged out) |

Active tab highlighted with `var(--color-tag-bg)` background.

### 6.2 CoffeeCard (`CoffeeCard.jsx`)

3D flip card with CSS perspective transform. Click anywhere to flip.

**Dimensions:** `max-width: 300px`, `height: 360px`

**Front Face:**
- Product image (180px height) with lazy loading
- Popularity badge (top-left, `z-20`): user count icon, opens PopularityModal via `createPortal(modal, document.body)` — portaled to escape card's CSS perspective/transform context
- Coffee name (Playfair Display serif, 2-line clamp)
- Roaster name (link to `/roaster/{slug}`, click stops propagation)
- Chip row: roast level, process, altitude (if available)
- Price row: `₹{price250} / 250g` + Buy button (accent background, ShoppingCart icon)
- Buy button: `trackClick()` + `window.open(product_url, "_blank")`

**Back Face:**
- **Layer 1:** India map SVG (full background)
- **Layer 2:** Gradient overlay for text readability
- **Layer 3:** Content stack:
  - MetaRows: Tasting Notes, Origin, Altitude, Varietal, Process, Grinds
  - ShelfSelector (community)
  - ShareButton
  - "Tap to flip back" hint

**3D CSS:**
```css
.card-container { perspective: 1000px; }
.card-inner { transform-style: preserve-3d; transition: transform 0.6s; }
.card-inner.flipped { transform: rotateY(180deg); }
.card-front, .card-back { backface-visibility: hidden; border-radius: 16px; }
.card-back { transform: rotateY(180deg); }
```

### 6.3 IndiaMap (`IndiaMap.jsx`)

`React.memo`'d SVG component rendering a public-domain India outline from Wikimedia Commons (Natural Earth data, 5.6KB path).

**Coordinate Transform (Plate Carrée projection):**
```
SVG viewBox: 0 0 667 777
x = (lng - 68) × 22.22
y = (37 - lat) × 25.06
```

**Pins:**
- **Origin pin:** Teardrop shape (`#C8553D` terracotta), white center dot, drop shadow
- **Roaster pin:** Circle (`#E8C07A` gold), white stroke
- **Connecting line:** White dashed line (opacity 0.35) between origin and roaster, hidden if <0.15° apart

**ViewBox:** Dynamically centered on the origin point, showing ~60% of India, clamped to bounds.

### 6.4 CardGrid (`CardGrid.jsx`)

Responsive grid with infinite scroll.

```css
grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
gap: 1rem;
```

**Pagination:** 24 items per page, loads more via `IntersectionObserver` with `rootMargin: "200px"`.

**Empty state:** Coffee emoji + "No coffees match your filters."

### 6.5 FilterSidebar (`FilterSidebar.jsx`)

Collapsible filter sections for the Browse/Beans page:
- **Sort dropdown:** Popular (default), Price ↑, Price ↓, Roaster A-Z, Name A-Z
- **Roaster checkboxes** (scrollable list)
- **Roast Level checkboxes** (Light, Medium-Light, Medium, Medium-Dark, Dark)
- **Process checkboxes** (Washed, Natural, Honey, etc.)

Filters are stored in URL search parameters via `useFilters()` for shareability.

Active filters appear as removable chips above the grid.

### 6.6 ShareButton (`ShareButton.jsx`)

Uses Web Share API (native share sheet) when available. Falls back to a popup menu with:
- Copy Link (clipboard)
- WhatsApp (share URL)
- Twitter/X (intent URL)

Share text: `"{coffee_name} from {roaster_name} — {tasting_notes}"`

---

## 7. Pages

### 7.1 BrowsePage (`BrowsePage.jsx`)

Sub-tab bar with two active tabs:
- **Beans** → renders `HomePage` (product grid + filters)
- **Roasters** → renders `RoastersPage` (roaster directory)
- **Apparatus** and **Coffee Spots** — greyed-out placeholder tabs

### 7.2 HomePage (`HomePage.jsx`)

Main bean discovery grid.

**Layout:** Desktop sidebar (260px, sticky) + main content area.

**Features:**
- Fetches popularity counts from `GET /api/products/popularity`
- Default sort: most popular (users who have it on shelf)
- Filter sidebar on desktop, bottom sheet on mobile
- Active filter chips with remove buttons

### 7.3 CoffeePage (`CoffeePage.jsx`)

Single coffee detail view. Route: `/coffee/:productId`

**Content:**
- Large product image
- Coffee name + roaster link
- Chips: roast level, process
- Detail rows: tasting notes, origin, altitude, varietal, grind options
- Standardized price: `₹{price250} / 250g`
- ShareButton + Buy link
- Related coffees from same roaster (up to 6, rendered as CoffeeCards)

### 7.4 RoasterPage (`RoasterPage.jsx`)

Single roaster profile. Route: `/roaster/:roasterSlug`

**Content:**
- Logo, name, tagline, location, founding year, Google rating
- Social links (icon buttons for Instagram, Twitter, Facebook, YouTube, LinkedIn)
- About blurb
- Sourcing regions + specialties chips
- Full grid of roaster's coffees (CardGrid)

### 7.5 RoastersPage (`RoastersPage.jsx`)

Roaster directory listing.

**Features:**
- Search by name/city/state
- State dropdown filter
- Roaster cards: logo/initial avatar, name, city/state, Google rating, founding year, coffee count, platform badge, specialty chips
- Each card links to `/roaster/{slug}`

---

## 8. Data Hooks

### 8.1 `useCoffeeData()` — Context + Provider

**State:** `products` array, `loading` boolean

**Derived (useMemo):**
- `roasters`: unique roaster objects with slug, name, count
- `roastLevels`: unique roast levels
- `origins`: unique origins
- `processes`: unique processes
- `productMap`: `{ [product_id]: product }` lookup

**Data fetching:** `GET /api/products` with fallback to bundled `data/products.json` if backend is down.

### 8.2 `useFilters()` — URL Search Params

**State shape:**
```javascript
{
    roasters: string[],      // roaster slugs
    roastLevels: string[],   // e.g., ["Medium", "Light"]
    origins: string[],
    processes: string[],
    priceMin: number | null,
    priceMax: number | null,
    showUnavailable: boolean,
    sortBy: "newest" | "ppg-asc" | "ppg-desc" | "roaster-az" | "name-az",
    query: string,
}
```

All filters persist in URL search params for link sharing.

### 8.3 `useShare()` — Sharing Utilities

Exports: `share(coffee)`, `copyLink(coffee)`, `whatsappUrl(coffee)`, `twitterUrl(coffee)`

---

## 9. Filter Logic (`filterCoffees.js`)

**Hard filters (always applied):**
- Excludes `available === false`
- Excludes `roast_level === null` or `"Unknown"`

**Soft filters (user-toggled):**
- Roaster, roast level, origin, process (array intersection)
- Price range (min/max on `price_per_gram * 250`)
- Text search on name, roaster, origin, tasting notes

**Sort options:**
| Key | Behavior |
|---|---|
| `newest` | Default: popularity sort when popularity data available |
| `ppg-asc` | Price per gram ascending |
| `ppg-desc` | Price per gram descending |
| `roaster-az` | Roaster name alphabetical |
| `name-az` | Coffee name alphabetical |

---

## 10. Price Standardization (`formatPrice.js`)

All prices displayed as **per 250g** regardless of actual bag size.

```javascript
pricePer250g(pricePerGram)      // → numeric value (pricePerGram * 250)
formatPrice(price)               // → "₹X,XXX"
formatPricePer250g(pricePerGram) // → "₹X / 250g"
formatWeight(grams)              // → "250g" or "1kg"
```

---

## 11. Origin Coordinates (`coffeeRegions.js`)

### `resolveOriginCoords(originText, title) → { lat, lng } | null`

Matches substring in the combined `originText + " " + title` against a dictionary of 58 known locations.

**Coverage:**
- **33 named estates:** Attikan Estate, Ratnagiri Estate, Balmadi Estate, etc.
- **25 coffee regions:** Chikmagalur, Coorg/Kodagu, Araku Valley, Wayanad, Nilgiris, etc.

**Match strategy:** Entries sorted longest-match-first to prefer "Baba Budan Giris" over "Baba".

---

## 12. API Client (`community/api.js`)

### `apiFetch(path, options)`

**Base URL:** `http://{window.location.hostname}:8000/api`
(Uses `window.location.hostname` instead of `localhost` for LAN access)

**Auth:** Bearer token from `localStorage.coffee_session_token`, attached as `Authorization` header.

### `setToken(token)`
Stores/clears the session token in localStorage.

### `trackClick(productId, roasterSlug, sourcePage)`
Fire-and-forget `POST /api/clicks` for analytics. Never blocks navigation.

---

## 13. Responsive Breakpoints

| Breakpoint | Layout |
|---|---|
| ≥1024px (lg) | Full 3-column layout (profile + feed + recommendations) |
| 768–1023px | 2-column (feed + recommendations, profile collapses) |
| <768px (sm) | Single column, bottom sheet filters, horizontal scroll recommendations |

---

## 14. PopularityModal

Displays users who have a specific coffee on their shelf.

**Implementation details:**
- Rendered via `createPortal(modal, document.body)` to escape the CoffeeCard's `perspective: 1000px` CSS context
- Fixed overlay: `z-[100]`, `height: 70vh`, `maxHeight: 600px`
- Scrollable user list: `flex: 1 1 0`, `minHeight: 0`, `-webkit-overflow-scrolling: touch`
- Badge click handling: `e.preventDefault()`, `e.stopPropagation()`, `onMouseDown` stop, `z-20`
- Fetches `GET /api/products/{productId}/users`
- Shows: avatar, display name, location, shelf label, tasting notes
