# Build Roadmap — Crema

Implementation companion to `NORTH_STAR.md`. This document tracks what
has been built, what architecture decisions were made, and what the next
build targets are. For deployment/launch checklists see `LAUNCH_TODO.md`.
For architecture rules see `CRUD_UTOPIA.md`.

---

## 1. What has been built

### 1.1 Architecture (CRUD Utopia)

The backend is **registry-driven**. Every CRUD resource is declared in
`resources/registry.py` (~20 lines per resource); the generic engine in
`resources/crud.py` turns declarations into SQL. Composite actions that
can't be declared (QR tokens, stamps, admin stats, catalog sync) live
in `routes/specific.py` and `services/`. Every API response follows the
`{ data, meta }` envelope from `resources/envelope.py`.

The frontend consumes the API via `apiFetchRaw` (the only fetch
wrapper) and `useResource<T>` (the generic data hook). Every visual
value — color, font, size, spacing, radius, shadow — lives in
`design-tokens.json` and is consumed through `useTokens.ts`. No hex
codes inline, no magic numbers. The token system is platform-portable:
a Swift or Kotlin app reads the same JSON.

**Backend stack:** Python / FastAPI / SQLite (Postgres migration
pending) / file-based uploads (object storage migration pending).

**Frontend stack:** TypeScript / React Native (Expo) / Expo Router /
react-native-svg / lucide-react-native. Builds to web, iOS, and
Android from a single codebase.

### 1.2 Consumer features

| Feature | Description | Key files |
|---------|-------------|-----------|
| **Auth** | Register, login, UUID session tokens (30-day TTL), multi-account (one user + one roaster + one café simultaneously), floating auth modal for Add Another Account | `services/auth.py`, `useAuth.tsx`, `AuthModal.tsx` |
| **User profile** | Canela display name, avatar with drag-to-reposition + pinch-to-zoom, bio, favorite drink/café, roast preference, in-place editing | `app/(tabs)/profile.tsx` |
| **Tasting journal** | Sliders (acidity, body, sweetness, aftertaste 1-5), flavor tags, full brew recipe (method, dose, yield, water, time, temp, grind, ratio), blend components | `tasting_notes` resource |
| **Coffee shelf** | Open Bags / On the List, horizontal card carousel, move between shelves, remove | `shelf_entries` resource, `useShelves.ts` |
| **Stamp book** | Per-café stamp progress (dots UI), QR display for barista scan, reward tracking | `StampBookList.tsx`, `StampBookModal.tsx` |
| **Social feed** | Posts (articles, notes, reposts, tasting-note auto-posts, sourcing stories), likes, threaded comments with replies, notifications | `roaster_posts` + `post_likes` + `post_comments` resources |
| **Long-form post type** (§2.14) | `post_type = "sourcing_story"` with a dedicated `body_full` column on `roaster_posts`. Teaser stays the excerpt shown in the feed; `body_full` is the expanded narrative. PostCard renders "Read the full post →" to toggle the long body inline and shows "Shared a long-form post" as the subtitle. Available to every account type — originally gated to roasters as "Sourcing story", the gate was dropped in §2.14 because the underlying thing is just "extend the character limit". Roasters still use it for sourcing stories; consumers can write a detailed brew walkthrough or journal entry. | `roaster_posts.body_full`, PostCard `isSourcingStory` branch, `ComposePost` long-form toggle |
| **Post composer** | Floating modal, image upload, link auto-detect with preview, tasting-note card attachment, tag-a-café (pink heart icon), tag-a-drink picker, location. Every account gets a "Long form" toggle that promotes the post to long-form with a dedicated body_full textarea (min 200, max 5000 chars). | `ComposePost.tsx` |
| **Buy button** | Outbound click to roaster's product URL, tracked in `click_events` (product, roaster, source page, timestamp) | `CoffeeCard.tsx`, `click_events` resource |
| **Brew method cards** | Roaster-submitted recipe cards rendered as a horizontal carousel on the product detail page ("Recommended recipes from the roaster"). Method-specific field layout (espresso: dose/yield/ratio/time/temp/grind; pour-over: dose/water/bloom/brew-time/grind; etc.). `fields_json` escape hatch for method-specific extras that don't fit the shared columns. | `brew_methods` resource, `BrewMethodCard.tsx`, `/coffee/[id]` carousel |
| **"Interested" wholesale handshake** | Café accounts see an Interested button on the product detail page. Tapping opens a modal with an optional note, creates a `wholesale_inquiries` row, and fires a `wholesale_inquiry` notification to every roaster-account user on that slug — lands in their Business tab (§2.4) with a deep-link to the sending café's profile (where §2.6 procurement fields render). Roaster can respond / archive via `POST /api/wholesale-inquiries/{id}/respond`. | `InterestedButton.tsx`, `wholesale_inquiries` resource, `_handle_notify_wholesale_inquiry` hook, `/api/my-wholesale-inquiries` |
| **Messages inbox + inquiry chat** | Navbar Messages icon (every authenticated user) with unread badge opens a chat-style inbox dropdown listing every inquiry + DM thread — counterparty avatar, product (for inquiries), last-message preview, time, unread count. Business users (roaster + café) see the inbox split into three tabs (§2.15): **Business** (wholesale inquiries), **Non-business** (direct messages), **Archive** (archived inquiries). Regular users see the flat list. Tapping a row opens `ThreadBody`: compact header with counterparty + product + status chip, collapsible Details drawer for business context, conversation area with self/other bubbles, composer at bottom. Polls every 5s while open; marks read on open + on new messages. Roasters get a `…` menu for Mark-replied / Archive / Reopen. Archive tab keeps archived threads reachable; Reopen lives inside the thread. | `/api/my-threads`, `/api/wholesale-inquiries/{id}/thread`, `/api/wholesale-inquiries/{id}/messages`, `/api/wholesale-inquiries/{id}/read`, `MessagesDropdown.tsx`, `ThreadBody.tsx`, `useInquiryInbox.ts` |
| **Wholesale availability signal** | Roasters flag products as wholesale-available via a single checkbox on `EditableCoffeeCard`. The min-kg + note fields were dropped (negotiation happens inline on the inquiry thread). Products live in both `products` and `roaster_products` tables so the columns + indexes are mirrored; `wholesale_minimum_kg` and `wholesale_note` remain in the schema for legacy rows but the creation form null-throughs them. On `CoffeeCard` the Package chip sits in the top-right slot (displacing the heart for business viewers — roasters AND cafés, neither has a personal shelf), visible only when `wholesale_available === 1`. Browse has a "Wholesale available only" filter for business viewers (both roaster + café accounts). `POST /api/roasters/{slug}/products` still accepts the legacy 3 fields. Inline owner-edit UI on existing products is tracked in §2.9. | `products.wholesale_*`, `roaster_products.wholesale_*`, `CoffeeCard` Package chip, browse filter |
| **Popularity modal (on-shelf viewer)** | Tapping the circular social dot on a CoffeeCard opens `PopularityModal`. Fetches `/products/{id}/users` and `/products/{id}/posts` in parallel, renders tasting-note posts via the shared `PostCard` (full header + tasting-note card + action bar — identical to the feed), and silent shelvers (no post) land in a compact "Also on shelf" list below. Shell matches the floating-modal language (blur backdrop, token overlay, Canela title). Count lives in the header subtitle ("On N people's shelves") — the card dot itself is number-free. | `PopularityModal.tsx`, `/api/products/{id}/posts`, `PostCard` |
| **Notifications** | Dropdown with likes, comments, follows, reposts, reply, catalog-change notifications (product added/removed, menu changed), §2.20 cross-business fanout types (wholesale_available, sourcing_story, menu_updated_business, loyalty_changed). Subject line + deep-link to source entity (sourcing_story → PostModal, others → entity profile). | `NotificationsDropdown.tsx`, `useNotifications.ts` |
| **Activity / Business tabs** | Roaster + café accounts see the notifications dropdown split into two tabs. Activity = social (like/comment/follow/repost/reply); Business = catalog fanout + wholesale inquiries (§2.1) + stamp awards + §2.20 cross-business signals (new wholesale flag, sourcing story, menu update from a followed café, loyalty program change). Regular users still see one flat list. Unread count appears next to each tab label. | `NotificationsDropdown.tsx` `BUSINESS_TYPES` set in `useNotifications.ts` |
| **Browse / Discover** | Roasters list with city filter, cafés list with city filter, product catalog. Sticky search bar hides/shows via `useSearchBarAutoHide` (§2.16) with dead-band, bottom-freeze, and top-force-show guards so it doesn't thrash at end-of-list rubber-banding. | `app/(tabs)/browse.tsx`, `src/hooks/useSearchBarAutoHide.ts` |
| **Sitewide search dropdown** (§2.11) | Navbar glass opens a floating dropdown styled like messages / notifications. Cream-backed input (no browser focus ring), live narrowing, four sections: Users (via `/api/users/search`), Beans, Roasters, Cafés (local-cache filter). Beans render without product image. Each section caps at 5 hits; a "See all results for …" row routes to Discover with the query pre-filled. | `SearchDropdown.tsx`, `Navbar.tsx` |
| **QR identity** | Short-lived QR tokens (5-min TTL), displayed in profile dropdown "Show QR" and inside stamp book modals | `useQRToken.ts`, `QRModal.tsx`, `services/qr_tokens.py` |

### 1.3 Roaster features

| Feature | Description | Key files |
|---------|-------------|-----------|
| **Roaster profile** | Split-panel layout, hero with drag/zoom, logo, about blurb, specialties, city, website. In-place editing for owners. | `app/roaster/[slug].tsx` |
| **Product catalog** | Cards with bean name, roast level, origin, process, tasting notes, price, weight, image with crop. Owners can add (EditableCoffeeCard with slide-in animation), hide, or delete products. | `EditableCoffeeCard.tsx`, roaster products endpoints |
| **Posts tab** | Feed of roaster's articles/notes, pinnable featured posts, owner edit/delete affordances. Owner FAB on Posts tab opens the same floating composer modal the consumer feed uses (posts to `/roaster-posts` with the roaster_slug, identity auto-detects as "roaster" so the Sourcing Story toggle appears). Previously the FAB expanded ComposePost inline and posted to `/posts` as the user — now unified with the feed mechanism. | PostCard, FAB + composerOpen modal in roaster page |
| **Follow system** | Follow button, follower count, follower list modal with follow-back toggle | `follows` resource, toggle endpoint |
| **Post-prompt modal** | After adding or removing a coffee, a floating modal asks "Do you want to post about this?" with a pre-filled composer | `PostPromptModal.tsx` |
| **Catalog-change notifications** | When a roaster adds/removes a product, all followers get a notification with the product name | `notify_followers_catalog` hook |
| **Logo → navbar sync** | Updating the roaster logo_url automatically mirrors to user.avatar_url so the navbar avatar reflects the entity image | `sync_roaster_logo_to_user` hook |

### 1.4 Café features

| Feature | Description | Key files |
|---------|-------------|-----------|
| **Café profile** | Split-panel layout (dark left, light right), logo with drag/zoom (circular crop), hero with drag/zoom, about blurb, address, Instagram, website, hours, seasonal badge | `app/cafe/[slug].tsx` |
| **Coffee menu** | Grouped by drink name, horizontal bean-card carousel per drink. In-place editing (pencil icon in edit mode). Add-bean empty-card with slide-in animation at end of each drink row. Add-drink form for new drinks (available outside edit mode). | MenuTab, DrinkRow, BeanCard, AddBeanCard, AddMenuItemForm in café page |
| **Stamp system** | Camera-only QR scanner (no manual token paste). Two-step flow: camera decodes → avatar preview with circular stamp button → tap to commit. Rate-limited 1 per user per café per 24h. | `ScannerModal.tsx`, `/cafes/{slug}/stamp` endpoint |
| **Loyalty program** | Configurable stamp target (tappable to cycle 5/8/10/12/15), reward picker (pill chips from menu drinks + custom text), seasonal schedule picker (month grid + year-round toggle). Opt-out via inline trash button (cream circle, dark icon — matches coffee card delete). Re-enable via "Enable loyalty program" pill. | Seasonal/RewardPicker in café page |
| **Follow + followers** | Follow button + follower count on bio left column, same endpoint as roaster follows | CafeFollowButton in café page |
| **Post-prompt modal** | Same as roaster — asks owner to post after any menu mutation (add/update/remove) | PostPromptModal wired through MenuTab |
| **Posts tab FAB** | Café owners get the same floating-composer FAB pattern as the roaster page and the consumer feed: bottom-right dark disc, cream plus icon, only on the Posts tab and only when not editing. Opens the existing `composerOpen` modal (already wired to `/roaster-posts` with `cafe_slug` + `roaster_slug: user_${id}`) with an empty prefill. Previously café owners could only post by mutating the menu to trigger PostPromptModal. | FAB + composerOpen modal in café page |
| **Menu-change notifications** | When a café owner adds/edits/removes a menu item, all followers get a notification | `notify_menu_added/updated/removed` hooks |
| **Logo → navbar sync** | Café logo_url + crop coords mirrored to user.avatar_* on profile save | `sync_cafe_logo_to_user` hook |
| **Procurement profile** | Owner-only block on café profile: monthly volume (kg), open-to-new-roasters toggle, free-text note. Qualifies the lead for roasters once §2.1 "Interested" inquiries ship. | `cafe_profiles.{monthly_volume_kg, open_to_new_roasters, procurement_note}`, café page procurement block |

### 1.5 Admin dashboard

| Feature | Description |
|---------|-------------|
| **Site Analytics tab** | Owner-only tab on the Crema admin's profile (username "crema", is_admin=1). Contains 6 sub-tabs: Engagement, Commerce, Loyalty, Network, Retention, Supply. |
| **Metric cards** | Canela big numbers + Inter labels + optional "?" info button that opens a floating modal with the metric's explanation. |
| **Time-series charts** | ggplot-style line charts (react-native-svg) for daily active users, daily signups, daily posts, daily clicks, daily stamps. Friendly date labels ("Apr 1st"), ~6 ticks, hover tooltip that flips below when near top. Pre-data empty days trimmed. |
| **Ranked tables** | MetricTable for top-clicked products, clicks by source, top cafés by stamps, top roasters/cafés by followers. Scrollable inside carousel cards. |
| **Retention cohort grid** | Weekly signup cohorts with D1/D7/D30 retention %, heat-tinted cells. Writer retention + stamp-cohort retention. |
| **Supply · procurement readiness** | 3 cards in Supply tab: Procurement Ready (count), Open to New Roasters (count), Procurement Readiness % (of cafés with any procurement field filled). Leading indicator for §2.1 inquiry quality. |
| **Supply · notification split (30d)** | 3 cards tracking how much of the last month's notification volume is B2B vs social: Business Notifs (30d), Activity Notifs (30d), Business Share %. Rises as catalog activity and wholesale inquiries grow. |
| **Supply · wholesale inquiries** | 6 cards tracking the flagship Phase 1 B2B metric: Inquiries Total, Inquiries (30d), Inquiries Open, Response Rate %, Cafés Inquiring, Roasters Receiving. Response rate = (responded + archived) / total. |
| **Supply · §2.18 expansion** | 6 additional cards: Inquiries (7d) (velocity), Median Response Time (median hours to first roaster reply, 30d), Avg Thread Depth, Returning Cafés (2nd+ inquiry to same roaster), Inquiry Messages (lifetime + 30d). Plus 4 ranked tables in a Plots carousel: Most-inquired beans, Most-responsive roasters, Cafés inquiring by city, Roasters receiving by city. Three remaining metrics (re-open rate, avg order size, wholesale flag churn) deferred — they need new schema (status history, structured quantity field, wholesale-flag history). |
| **Supply · wholesale signal** | 3 cards tracking the roaster-side supply readiness: Wholesale Available (count), Wholesale Signal % (of active products), Roasters With Wholesale (distinct count). Low % means roasters aren't yet opting in. |
| **Supply · sourcing stories** | 3 cards tracking narrative investment: Sourcing Stories (total), Stories (30d), Story Share % (of roaster posts). |
| **Supply · brew recipes** | 3 cards tracking roaster recipe investment: Brew Recipes (count), Recipe Coverage % (of active products with ≥1 recipe), Top Method (most common across all recipe cards). |
| **Plot carousel** | Swipe-only (no buttons), dot pager, per-section state isolation via React key. |
| **Circular refresh button** | 44×44 dark primary fill, cream icon, matches site FAB language. |
| **Backend** | `services/admin_stats.py` (~500 lines): 6 section functions, each wrapped to never crash the others. Daily series with zero-fill + leading-zero trim. Gated on `is_admin=1 AND username="crema"`. |

### 1.6 Design system

- **Fonts:** CanelaText_Regular (display), Inter 400/500/600/700 (body)
- **Colors:** 25+ named tokens (bg, card.front/back/info, text.primary/secondary/muted/on-dark, accent, accent.cta, border, divider, overlay, etc.)
- **Components:** CoffeeCard, CoffeeLabel, PostCard, ActionBar, CommentThread, CroppedAvatar, Toggle — all token-driven, no inline hex
- **Circular buttons:** FAB (52×52), admin refresh (44×44), scanner stamp (56×56), repost (44×44), carousel nav (36×36) — all dark primary fill + cream icon + soft shadow
- **Floating modals:** PostModal, InfoModal, PostPromptModal, AuthModal, SeasonalPicker, RewardPicker, ScannerModal — all use overlayWrap + backdrop blur + card pattern
- **Delete buttons:** cream circle (card.info) + dark primary trash icon — consistent across coffee cards, bean cards, loyalty disable

### 1.7 Seeded data

- **9 Goa pilot cafés** with menus, hours, seasonal schedules, owner accounts (`seed_cafes.py`)
- **121 roasters** from scraped catalog + roaster profiles
- **521 products** in unified products table
- **Admin account:** username `crema`, password `crema`, is_admin=1

---

## 2. What to build next

Ordered by the Phase 1 roadmap in `NORTH_STAR.md`. Each item references
the relevant section there. For deployment/infra prerequisites see
`LAUNCH_TODO.md`.

### Mobile (iOS + Android) readiness — THIS WEEK

iOS and Android ship before public launch, not after. **Everything
in §2 that isn't the mobile-readiness block below is a launch
blocker**, consolidated in "Launch blockers — everything non-mobile"
right after §2.39.

**Android follows from iOS for free.** Expo + React Native build to
both platforms from the same codebase — the same responsive layout,
gesture, and safe-area work we do for iOS lands on Android with zero
incremental effort, modulo a one-pass QA on a physical Android
device. Treat iOS as the primary target this week; Android validates
on the back of it.

Expo + React Native Web means every page mechanically builds for iOS
and Android — but every layout was drawn for a 1280-px-wide laptop
and doesn't bend well to 390 px. This block is the design /
native-interaction sweep to make the app *feel* native on a phone.

Apple deployment prerequisites (password reset, account deletion,
privacy policy, data export, App Store nutrition label, EAS setup)
live in [LAUNCH_TODO.md §3.5](LAUNCH_TODO.md) — those are infra +
legal + submission items, not product work, so they stay there.
**§3.5 is now unparked:** iOS ships before public launch, not after.

Rough order: #2.31 is the foundation everything else sits on,
#2.32 is a shared primitive that makes the surface-level items
trivial, then each surface in turn. Estimated total ~6-8 focused
days to a TestFlight-ready build; Android falls out for free with
a single-session QA pass at the end.

**Dev loop: Expo Go, not TestFlight.** The fast iteration path is
`npx expo start` → scan the QR code with the Expo Go app on an
iPhone / Android → live reload on the physical device over the LAN.
No build, no provisioning profile, no Apple review — each code save
lands on the device in seconds. Every item in this block (§2.31
through §2.37) is pure JS / layout / gesture work that Expo Go
supports natively; no new native modules are introduced until
§2.39. TestFlight only gets exercised at the end, when §2.39 ships
and we need Apple-signed builds for external testers.

Caveat: Expo Go runs the stock set of Expo modules. If §2.39 adds
`expo-notifications` (push) or anything else not in the stock
bundle, those specific features need an EAS dev client build to
exercise on device. Everything else — safe areas, bottom tabs,
landscape cards, filter drawer, menu card-stack, pan-responder
drag, hit slops, bottom sheets — works in Expo Go as-is.

### 2.31 Safe areas + bottom-tab navbar mobile variant

`react-native-safe-area-context` is already installed but never
wrapped around the root — the 72-px navbar will sit under the iPhone
notch / Dynamic Island on first launch. Wrap `app/_layout.tsx` in
`<SafeAreaProvider>` + `<SafeAreaView>` and thread the top inset
into the navbar.

Second half of this item is the mobile-paradigm flip: web + wide
screens keep the existing horizontal `Navbar` (HOME · logo · DISCOVER
· messages · notifications · avatar). Below the mobile breakpoint,
switch to a **bottom tab bar** via Expo Router's built-in `Tabs`
layout so the primary navigation sits where the thumb actually is.
The search glass + notifications + messages icons become header-right
buttons on the individual screens; the avatar lives on the profile
tab. No new routing — Expo Router `app/(tabs)/*` already implies
tab-shaped navigation, it's just not being rendered as tabs yet on
native.

### 2.32 Responsive breakpoint primitive

Today every layout file that cares about width makes its own
`useWindowDimensions()` call and rolls its own threshold (600 in the
café page, 1024 in browse, 1100/720 in TractionDashboard). Add a
shared hook + constants file so every call-site reads the same
truth:

```ts
// src/hooks/useBreakpoint.ts
export const BP = { mobile: 600, tablet: 900, wide: 1100 };
export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return {
    width,
    isMobile: width < BP.mobile,
    isTablet: width >= BP.mobile && width < BP.wide,
    isWide: width >= BP.wide,
  };
}
```

Every subsequent item (2.33-2.37) flips on `isMobile`. One grep
target, one truth.

### 2.33 Coffee card — landscape variant for phones

Figma spec: [109:9154 — Crema Beans Mobile](https://www.figma.com/design/QIT6HorllZ7wbeULQ4iLAt/Crema-%E2%80%93-Initial-UI?node-id=109-9154)

The existing `CoffeeCard` (`src/components/CoffeeCard.tsx`) is
240 × 372 portrait. In mobile grids it shrinks to ~180 × 280 and
the image becomes unreadable. Below `isMobile`, flip to landscape:

- **Layout:** 360 × 251 row, 50/50 split. Left = product image
  (180 × 251, `rounded-left` only). Right = info panel (190 × 251,
  `t.color["card.info"]` bg, `rounded-right` only).
- **Right-panel text stack** (all left-aligned, divider lines
  between meta rows): Canela 19 bean name → Inter 11.5 "By {roaster}"
  → hairline → Inter 11.5 "{Arabica/Robusta} Beans" → hairline →
  "{process} • {roast} Roast" → hairline → tasting notes →
  Canela 18 price "₹{n}" + Inter 12.5 "/ {weight}g".
- **Button anchors** — same relative positions as the portrait card,
  just re-mapped to the new frame:
  - Top-left of image: "liked by friends" pill (user icon + count).
  - Top-right of image: heart / like disc (27 × 27).
  - Bottom-left of image: share disc (36 × 36).
  - Bottom-right of card (floating over info panel): cart / shop
    disc (31 × 31 with `t.color.accent` bg circle).
- **Owner overrides** (§2.9 edit/delete language) stack top-right
  over the info panel, same way they stack top-right on the
  portrait card today.
- **Wholesale badge + sold-out tag** (§2.2 / §2.28) land at the same
  relative anchors they use on portrait — top-right of the image for
  wholesale, across the bottom of the image for sold-out.
- **Feed shelf carousel** (profile shelf, "Also on shelf") keeps
  horizontal scroll; the landscape card's taller-than-wide aspect
  flips to shorter-than-wide so four cards can stack vertically in
  a typical viewport without overwhelming.

Key files: `src/components/CoffeeCard.tsx`, `src/components/CoffeeLabel.tsx`
(if we share typography), the feed + profile + browse + popularity
modal call-sites all consume this one component so the flip is a
single-component change.

### 2.34 Filter sheet — right-edge slide-in drawer

Figma spec: [109:9372 — Filter](https://www.figma.com/design/QIT6HorllZ7wbeULQ4iLAt/Crema-%E2%80%93-Initial-UI?node-id=109-9372)

Today `app/(tabs)/browse.tsx` keeps the filter sidebar inline on
narrow screens, eating ~40% of the viewport. On mobile, hide the
sidebar entirely and expose a "Filters" button in the search-bar
row that slides in a full-height panel from the right edge:

- **Panel:** 100% height, ~85-90% width (overlay the 10% strip of
  the underlying browse list on the left so the user sees they're
  still in context). Bg `t.color.bg`, left edge gets the site's
  soft shadow.
- **Animation:** slide `translateX` from `100%` to `0` in
  `~240ms ease-out` (reuse the existing slide easing from
  `useSearchBarAutoHide` → `CoffeeCard` slide-in for consistency).
  Backdrop is the same blur overlay we use for every other modal
  on this site so the language feels native.
- **Header:** "Filter" (Inter SemiBold 24) left, circular X close
  button right (dark-fill disc, cream icon).
- **Sections, top-down:**
  - **Sort By** — 4 radios: Featured / Newest / Price Low-High /
    Price High-Low. Only one active at a time.
  - hairline divider
  - **Roasters** — checkbox list, scrollable inside the drawer.
    Source list = every distinct `roaster_slug` in the catalog;
    sort alphabetically.
  - hairline divider
  - **Process** — checkboxes for the standard process taxonomy
    (Anaerobic / Honey / Natural / Semi-Washed / Washed). Source
    = the `dictionary` endpoint's `process` set, falling back to
    a hard-coded five if the endpoint hasn't shipped yet.
  - (Next pass: roast-level, origin, wholesale-only, price range.)
- **Footer** pinned to the bottom, outside the scroll area:
  - **Reset (n)** pill — cream bg, dark border, dark text. `n` is
    the count of active filters so the user knows there's something
    to reset. Disabled state when no filter is on.
  - **Apply** pill — dark fill, cream text. Closes the drawer and
    refreshes the list.
- **State:** lift filter state (sort, selected roasters, selected
  processes) into `browse.tsx`. The sidebar (wide screens) and the
  drawer (mobile) both bind to the same state object so switching
  viewports mid-session doesn't reset filters.
- **Tap-outside / swipe-right dismiss:** backdrop closes the panel;
  on native, also add a swipe-right edge gesture so the drawer
  closes with a thumb flick.

Key files: `app/(tabs)/browse.tsx`, new `src/components/FilterDrawer.tsx`.

### 2.35 Café menu — card-stack fallback on narrow screens

The §2.10 / §2.24 tabular menu (7 fixed-width columns) overflows on
any phone. Below `isMobile`, render each drink as a vertical card
instead — drink name (Canela) at top, roaster row with ExternalLink
icon next, a row of meta pills for (Roast · Process · Hot · Iced),
tasting notes underneath, owner actions (pencil + trash) top-right.
Columns collapse into labeled rows. The table layout stays for
tablet+ (`winW >= BP.mobile`).

The add-row, add-roaster-to-drink, and per-item edit modals are all
already floating modals so they carry over unchanged.

### 2.36 Hero + avatar drag → PanResponder (touch-compatible)

`app/roaster/[slug].tsx`, `app/cafe/[slug].tsx`, and
`app/(tabs)/profile.tsx` all use `onMouseDown` / `onWheel` for the
drag-to-reposition + pinch-to-zoom affordances on the hero and
avatar — **broken on touch entirely**. Swap to React Native
`PanResponder` or `react-native-gesture-handler`; the state shape
(`cropX` / `cropY` / `zoom`) is already platform-agnostic, it's
only the input events that are web-only today.

Same applies to the scanner + image-upload crop UIs if those carry
any mouse-only handlers.

### 2.37 Hit-slop + tap-target audit (44 × 44 minimum)

Only ~27 files use `hitSlop` today. Apple HIG wants 44 × 44 pt
effective tap targets. Sweep every icon-only `<Pressable>`: add
`hitSlop={8}` (or larger) so the touch region hits 44 × 44 even
when the icon itself is 16-24 px. Prime offenders — navbar icons,
PostMenu three-dot, every table-row trash/pencil, the QR close
button, the stamp-increment button on the café scanner.

Same pass: add `accessibilityLabel` + `accessibilityRole="button"`
to every icon pressable so VoiceOver readers can name what they're
tapping (coverage is <10% today).

### 2.38 Modal → bottom-sheet pattern on mobile

Every floating modal today (ConfirmDeleteModal, MilkOptionsModal,
EditMenuItemModal, ComposePost, AuthModal, PostPromptModal, etc.)
is a centered overlay that works but feels alien on iOS. Wrap the
modal primitive so `isMobile` flips them into a bottom sheet:
slides up from the bottom edge, rounded top corners only, drag
handle at top for swipe-down dismiss. Web + tablet keep the
existing centered pattern.

This is polish — blocks no submission — but it's the single change
that most makes the app read as "native iOS" rather than "web app
in a WebView."

### 2.39 EAS Build + app.json polish

This is the *last* item, run only after §2.31-2.38 have been
iterated on via Expo Go (see the Dev loop note at the top of this
block). Before EAS lands, day-to-day work is:

```
cd crema-app && npx expo start
# → scan QR with Expo Go → live reload on phone
```

EAS only matters once we need signed binaries for TestFlight or
push-notification testing. Ship pipeline to get there:
- `eas.json` with `development`, `preview`, `production` build
  profiles.
- `app.json` permission strings — `NSCameraUsageDescription` (QR
  scan), `NSPhotoLibraryUsageDescription` (image picker), any
  others EAS flags during build.
- App icons — audit `assets/images/icon.png`,
  `adaptive-icon.png`, `splash-icon.png`. Generate the full Apple
  icon set (20pt through 1024pt for App Store) from the crema
  SVG. Ship a proper splash, not a minimal logo-on-cream.
- Deep link config in `app.json` `scheme` + Expo Router's
  `+not-found` fallback so app-store reviewers testing a shared
  link land somewhere.
- Push notifications plugin (`expo-notifications`) + the token
  round-trip to backend (a later pass can wire actual fan-out
  from our existing notifications table).

Between §2.31-2.39 and LAUNCH_TODO §3.5, everything a TestFlight
build needs is in one of two places. No hidden "oh we also need
X" landmines.

### 2.40 Mobile — sessions 1+2 (branch `feat/mobile-readiness`)

Session 1 shipped the foundation: `useBreakpoint` primitive, a centered-Crema `MobileHeader` (per Figma 63:4710), Home/Discover/Messages/Profile bottom tabs with the profile-avatar icon, a sticky `MobileFooter` rendered at the root layout so it persists across every mobile screen (except /auth), `SiteHeader` wired into the detail pages (user / cafe / roaster), and real content ported into Search / Messages / Notifications / Account via a `fullScreen` prop on the existing dropdowns. Expo Go now reaches the backend (LAN-IP resolution via `expo-constants`) and keychain reads no longer crash (AFTER_FIRST_UNLOCK). A cross-platform `emit` / `listen` event bus (`src/utils/events.ts`) fixed Comment / Repost on native. The followers modal no longer "follows everyone" (backend `/followers` now returns `user_id`) and long names truncate at 25 chars. `SwipeableRow` lands in the Messages inbox — WhatsApp-style swipe on native, right-click / double-tap on web, with three actions (Archive wired to the existing wholesale-inquiry endpoint; Mute + Delete stub with "Coming soon"). The design-language directive ("every new UI runs the token-only checklist + mirrors the nearest existing screen") is now canonical in `CRUD_UTOPIA.md` and persistent cross-session memory.

Session 2 shipped the chrome-preserving overlay architecture. Every modal / dropdown / panel that used to cover MobileHeader + MobileFooter now sits in the mid-band between them. Key files:

- **`SlidePanel`** (`src/components/mobile/SlidePanel.tsx`) — shared animation primitive (side: left | right | bottom, springs in, backdrop on the sliver, Android hardware back closes, translucent `overlay.panel` token).
- **`MobileOverlays`** (`src/components/mobile/MobileOverlays.tsx`) — root-layout host for Search / Notifications / Account panels. Positioned `top: insets.top + 48, bottom: 0` inside a new relative wrapper in `app/_layout.tsx`, so the slide panels cover only the band between SiteHeader (48 + top inset) and MobileFooter (71 + bottom inset). MobileHeader now emits `crema:toggle-<panel>-panel` events instead of `router.push`; re-tapping the same icon closes.
- **`GlobalPostModal` / `GlobalPopularityModal` / `GlobalComposePost`** (inside `app/_layout.tsx`) — single sitewide mounts, each listening for an `emit` event. On mobile they render as absolute-positioned views in the same mid-band as the slide panels; on web wide they keep the centered RN `<Modal>` card. `openPostModal` / `openPopularityModal` / `openComposePost` helpers in `src/components/primitives/index.ts`. `AuthModal` got the same treatment.
- **`FilterDrawer`** (inline in `app/(tabs)/browse.tsx`, uses the shared SlidePanel) — right-slide 88% with Sort By / Roast / Roasters / Process / Wholesale sections + Reset (counted) + Apply footer.
- **Discover grid redesign** — Roasters + Cafés tabs on `/browse` now render as image-top + name-bottom cards (`BrowseCard`) matching CoffeeCard's 240-wide geometry, replacing the old horizontal rows. Search placeholder harmonized to "Search" across all three tabs.
- **Auth + edit-profile fixes**: AuthGate now respects `?addAccount=1` (§2.40.4 race gone). Profile Discard explicitly resets every edit field before flipping `isEditing=false` and routes the URL cleanup through `router.replace` so Expo Router's cached param doesn't linger (§2.40.5). ProfileDropdown's Edit delay bumped from 100ms → 280ms so the slide-panel exit animation fully plays before the edit banner animates in.
- **Shared composer**: Profile FAB + Home FAB + all post-edit paths now go through `openComposePost`. Consumers pass `endpoint` + `extraData` so a profile post still lands on `/roaster-posts` with `user_<id>` slug, and the sitewide GlobalComposePost fires a `refetchEventName` when it submits so the originating screen refreshes without a direct callback.

What still needs doing in session 3:

| # | Item | Notes |
|---|------|-------|
| 2.33 | CoffeeCard landscape variant for phones (Figma 109:9154) | Per spec — 360×251 row, 50/50 image/info split. |
| 2.35 | Café menu card-stack fallback on narrow screens | Collapse the 7-column table into vertical cards. |
| 2.36 | PanResponder swap for hero + avatar drag (cafe / roaster / profile / EditableCoffeeCard) | |
| 2.37 | Hit-slop 44×44 audit + accessibilityLabel sweep | |
| 2.40.7 | Register (tabs) with ≠4 tab counts (café POS, roaster analytics) | Factor `MobileFooter` per-screen tab set. |
| 2.40.8 | DM archive / mute / delete backend | |
| 2.40.3-follow-up | Port roaster/cafe **detail-page** inline composers to `openComposePost` | Feed + Profile done; detail-page composers still use local RN Modal for the composer + edit. |
| 2.39 | EAS Build + app.json polish | Last. |
| 2.32 remainder | Migrate the remaining 6 `useWindowDimensions()` call-sites to `useBreakpoint` | Parallel. |

### Launch blockers — everything non-mobile

Everything below this point in §2 is either shipped (historical)
or a launch blocker that's been pushed below the mobile-readiness
focus. Triage at a glance:

| Bucket | What's left | Size |
|--------|-------------|------|
| §2.28 Scraper resurrection + sold-out preservation | Soft-delete scraper-cycled products (don't orphan tasting notes) + parser fidelity pass. Detail in §2.28 below. | 1-2 days |
| §2.18 deferred B2B metrics | Re-open rate, avg order size, wholesale flag churn — all need new schema (status history, structured quantity, change-log). | ½ day after schema |
| §2.13 OAuth backends | Google / Instagram / Reddit. UI is shipped; backends parked. Email-password is fine for first ship. | 1-2 days per provider |
| §2.29 In-place product editor | V2 polish to replace the floating modal. Current modal works. | ½ day |
| LAUNCH_TODO.md §3.5 (unparked) | Password reset · account deletion · privacy policy · data export · App Store nutrition label · contact-us widget · accessibility pass. These are Apple-required, handled on backend + legal, not product. | 2-3 days |
| LAUNCH_TODO.md Part 1 | Secrets sweep · env lockdown · Dockerfile · error boundary · docker-compose. Only matters if web F&F deploy happens before iOS. | 1 day |
| LAUNCH_TODO.md Part 2 | Fly deploy · domain · DNS · cert · smoke test. Same gate as Part 1. | ~45 min (yours) |

All unshipped items still have full detail in §2.1-2.29 below
(jump to the specific subsection for architecture / key files).

---

### 2.1 "Interested" button *(shipped — see §1.2 "Interested" wholesale handshake)*

The flagship Phase 1 B2B feature landed end-to-end: `wholesale_inquiries`
registry resource with subfields for café context, `notify_wholesale_inquiry`
hook firing to every roaster-account user on the target slug, scoped list
endpoint (`GET /api/my-wholesale-inquiries`) with per-account perspective,
roaster response endpoint (`POST /api/wholesale-inquiries/{id}/respond`),
`InterestedButton` component on the product detail page, and 6 admin
Supply cards. Generic list+read are blocked on the resource to keep one
café from peeking at another's leads.

### 2.2 Wholesale availability signal *(shipped — see §1.2 Wholesale availability signal)*

Fields, badge, browse filter, and admin metrics all landed. Inline
owner-edit UI for toggling the flag on *existing* products is
deferred — it needs a dedicated product editor rather than cramming
toggles into the tight Figma layout of `EditableCoffeeCard` (which
is the new-product creation form). Until that editor lands, the
three fields are already accepted by `POST /api/roasters/{slug}/products`
for new creations.

### 2.3 Sourcing story posts *(shipped — see §1.2 Sourcing story post type)*

Column, type, composer toggle, and expandable card render all landed.
Tagged-product + tagged-origin UI (the "tie a story to a specific
bean and producer") was not part of this checkpoint — that's additive
and lands cleanly once the next editor pass touches the composer.

### 2.4 Business notification tab *(shipped — see §1.2 Activity / Business tabs)*

The tab split, categorization helper (`BUSINESS_TYPES` in
`useNotifications.ts`), per-tab unread counts, and admin Supply-tab
metrics all landed. `wholesale_inquiry` and `stamp_awarded` types are
pre-reserved so §2.1 and future loyalty work can fire them without
another enum change.

### 2.5 Brew method cards *(shipped — see §1.2 Brew method cards)*

Table, registry, card component, product-page carousel, and admin
metrics all landed. A dedicated roaster-owner editor for adding
recipes via UI is deferred alongside the §2.2 product-editor
follow-up; the registry already exposes the CRUD endpoints
(`POST /api/products/{id}/brew_methods`).

### 2.6 Café procurement profile *(shipped — see §1.4)*

The 3 fields + owner-editable block + admin readiness metric have
landed. Conditional visibility to roasters is intentionally deferred
to §2.1 where the wholesale inquiry notification carries the snapshot.

### 2.7 Profile edit: eliminate *every* layout shift between modes *(shipped)*

The hero no longer reflows when entering/leaving edit mode. Four
changes stacked to make it stable:

- **Avatar decoupled from info column.** `avatarWrap` now has
  `alignSelf: "flex-start"` in `app/(tabs)/profile.tsx`. Previously
  the flex row's default `stretch` was overriding the aspectRatio
  on Expo Web, so any growth in the info column stretched the
  avatar vertically, which re-fired `onLayout` with a new `cH`,
  which re-ran the MIN_OVER × zoom math and visibly rescaled the
  image. Pinning to flex-start lets aspectRatio win; the container
  is now size-stable regardless of sibling height.
- **Name is single-line in both modes.** Dropped `multiline` + the
  `maxWidth: 281` on the edit TextInput. The display `<Text>` gets
  `numberOfLines={1}` for symmetry. Removes the 2-lines-vs-1-line
  wrap mismatch between `<Text>` and `<TextInput>` on the Canela
  face (the original "Aayushi Kapadia" case).
- **Bio slot reserves stable height.** Both modes render inside a
  `bioSlot` view with `minHeight: 36`. Users with no bio see 36px
  of reserved space in display mode — cheap price for a stable
  hero.
- **Roast preference collapsed to one chip row.** The old
  two-labelled-section edit widget was ~70px tall vs ~18px for the
  display `<Text>`. Now it's a single flat row (3 roast chips ·
  divider · 2 grind chips) that matches the display line-box. The
  unused `editFieldLabel` style was removed.

Sanity-checked in browser — avatar position and image scaling are
invariant across the edit toggle on desktop widths. If a regression
shows up, snapshot the hero's bounding rect entering and leaving
edit — any delta beyond rounding is a fail.

### 2.8 Wholesale chip rework on CoffeeCard + EditableCoffeeCard *(shipped)*

Scope-cut and shipped. The form collapsed to a single "Available
wholesale" checkbox (min-kg + note fields gone — those negotiate
inline on the inquiry thread). On CoffeeCard the Package chip moved
from the top-left friends slot to the top-right heart slot, and is
now visible to both roaster AND café viewers (not café-only),
replacing the heart for business account types that don't have a
personal shelf. The former pill-shaped friends badge became a
circular 31×31 social dot with no count. **Browse wholesale filter**
also opened to roaster viewers in the same pass — parity with the
card chip — so a roaster can surface other roasters' wholesale
offerings when they need a backup supplier (the §1 "supply anxiety"
use-case, applied to roasters too). Filter lives in the sidebar,
same checkbox UI as for cafés.

**PopularityModal redesign** shipped alongside. Moved to the site's
floating-modal language (blur backdrop, token overlay + radius,
Canela title) and — critically — the body now renders real
`PostCard`s for tasting-note posts instead of a bespoke "user row +
inline tasting-note card" layout. A new `/api/products/{id}/posts`
endpoint returns envelope-wrapped `Post` objects (author join,
counts, `liked_by_me`), which the modal pipes into the shared
`PostCard` so Aayushi's tasting note on Gangecool reads the same as
it does on the feed. Users who shelved without writing a note fall
into a compact "Also on shelf" section below the posts.

### 2.9 Roaster edit mode for existing beans *(shipped)*

A pencil button lives top-right on each owner-viewed product card
(stacked below the bin — see layout note below). Tapping opens a
floating modal hosting `EditableCoffeeCard` pre-filled with every
saved field, and save PUTs to `/api/roasters/{slug}/products/{id}`.
Local state patches on success so the edited card re-renders
without a full refetch. Same component handles both create and
edit; `initialData` on `EditableCoffeeCard` skips the placeholder
slide-in and seeds the form. Roasters can now flip the wholesale
flag on existing inventory without re-creating the row.

Two related adjustments shipped in the same pass:
- **Owner affordances moved to the right** on CoffeeCard (per user
  feedback). Bin + pencil stack top-right; social dot owns the
  top-left. Non-owner viewers keep their existing layout (heart /
  Package chip on the right).
- **Delete now asks first.** The bin opens a confirmation sheet
  ("Remove this bean?" with Cancel / Remove) instead of deleting
  on tap. Removes a whole class of fat-finger-regret bugs.

### 2.10 Café menu table (no cards) *(shipped)*

The grid-of-bean-cards menu was replaced with a tabular layout in
`MenuTab` (`app/cafe/[slug].tsx`). Each drink renders as a compact
block — Canela name + per-roaster rows beneath, separated by
dividers that echo the hours table. The roaster name is the only
clickable element (routes to `/roaster/{slug}`); sub-text carries
bean name (if the café set one), bean type, and roast. No images,
no cards, no carousels. Owner-in-edit mode still has trash
affordances per row. `DrinkRow` / `BeanCard` / `AddBeanCard`
helpers are still exported but no longer rendered on the primary
menu path.

### 2.11 Sitewide search (navbar magnifying glass) *(shipped)*

The navbar glass now toggles a floating `SearchDropdown` styled the
same as the messages / notifications panels. Cream-backed input
(no browser focus ring), live narrowing, four sections: **Users**
(hits `/api/users/search?q=...` with a 200ms debounce), **Beans**,
**Roasters**, **Cafés** (all three filter the local
`useCoffeeData` + `useCafes` caches — offline-friendly). Each
section caps at 5 rows and ends with a "See all results for …"
affordance that routes to Discover with the query pre-filled.
Beans render without the product image, per spec — keeps rows
tight. Rows navigate + close the dropdown on tap.

### 2.12 Image pipeline → WebP *(shipped)*

Upload handlers (`routes/uploads.py`, `/upload/avatar` +
`/upload/image`) now convert incoming raster bytes to WebP via
Pillow at quality 82 before writing to disk. Animated sources (GIF)
flatten to the first frame; palette / CMYK / 16-bit sources
convert to RGB(A) first. Unsupported formats (SVG, unknown binary)
fall through with a `.bin` extension rather than erroring — the
upload never fails on an edge format. Went with option (c) from
the original roadmap question: **existing images stay as-is**, only
new uploads get WebP. A backfill job can always run later if the
corpus gets big enough to care.

### 2.13 Two-track login + auth redesign + account-switch flow *(partial — UI shipped, OAuth backend pending)*

Full redesign of `app/auth.tsx`: no navbar cutout, full-viewport
color that recolors with the active track (cream `bg` for User,
`roaster.panel` dark brown for Business), large `CremaLogo` SVG at
the top, "Discover coffee." tagline, pill tab selector, single
cream form card. Social-auth row (Google / Instagram / Reddit,
stubbed) renders on the User track only — business sign-ins skip
it.

`AuthModal` (the floating version opened from the profile
dropdown's "Add another account") matches the page's design
one-for-one — same tabs, same big logo, same track-recolouring,
same social-on-user-only rule. `upsertAccount` still enforces
one-per-type (user / roaster / café); signing into a 4th slot
evicts the existing same-type account automatically.

**Sign-out auto-switch:** `logout` now slides into the next saved
account (priority user → roaster → café) instead of dumping to
`/auth`. Hard-reloads at `entityHomeFor(nextUser)` so the new
identity mounts cleanly. If there's no next account, the auth
screen comes up via AuthGate's usual redirect.

**Post-auth navigation:** `entityHomeFor` sends users to
`/profile` (their own tab) instead of `/` (the feed) — "who am I
now?" is answered visually the moment the switch completes.

**Still parked:** the OAuth integrations themselves (each needs a
provider app + callback route + DB migration for
provider_user_id), JWT + password-reset + email-verification
(tracked with launch blockers).

### 2.14 Long-form posts for everyone (rename from "Sourcing story") *(shipped)*

The composer toggle is now labelled "Long form" / "Long form · on"
and is available to every account type (`canStoryMode = true`,
drop of the roaster-only gate in `ComposePost.tsx`). Backend
`post_type` stays `sourcing_story` so existing posts keep
rendering — no migration needed. PostCard now shows "Shared a
long-form post" as the subtitle and "Read the full post →" as the
expand affordance. Roasters can still write a sourcing story (that
use-case is preserved); consumers can now write a detailed brew
walkthrough or journal entry without hitting the roaster gate.

### 2.15 Messages dropdown: business/non-business tabs + archive tab *(shipped)*

`MessagesDropdown` now renders a tab strip for business users
(roaster + café accounts) with three tabs: **Business** (wholesale
inquiry threads), **Non-business** (direct messages), and
**Archive** (wholesale threads with `status === "archived"`). Each
tab carries its own unread count, same visual language as the §2.4
Activity/Business notification split. Regular users skip the tabs
and keep the single flat list.

Archived inquiry threads — which previously vanished from the
inbox once a roaster hit Archive — now stay one click away. The
thread's `…` menu still has the Reopen affordance to unarchive.

### 2.16 Search-bar hide animation glitches at end-of-list *(shipped)*

New `useSearchBarAutoHide` hook (`src/hooks/useSearchBarAutoHide.ts`)
replaces the old per-tab `y > lastY && y > 10` toggles on Browse.
Four guards stack: **top force-show** (y < 40 → always visible),
**bottom freeze** (distFromBottom < 24 → keep last state), **dead-band**
(|dy| < 4 → ignore jitter), **hide-past threshold** (only hide once
the user has scrolled past 80px). `CoffeeList` now exposes raw
`onScroll` instead of a direction discriminator, and all three
Discover sub-tabs (Beans / Roasters / Cafés) route through the hook
so the fix is one-place-only.

### 2.17 Drop the café procurement profile section *(shipped)*

The owner-visible procurement block (monthly volume / open to new
roasters / procurement note) was removed from `app/cafe/[slug].tsx`
— both edit and read paths. Supporting state, load-from-row hydration,
and save-payload fields came out in the same pass. The admin
"Supply · procurement readiness" cards (`procurementReady`,
`procurementOpen`, `procurementReadiness`) were dropped from
`services/admin_stats.py` and `TractionDashboard.tsx` since the
underlying signal disappears. DB columns stay in place (no
migration) for historic rows; nothing writes to them now. If any
of the fields turns out to genuinely help the inquiry flow, they'd
land inline on the inquiry modal rather than back on the public
profile.

### 2.18 B2B metrics expansion + clickable cards drilling into a daily chart *(shipped — 8 of 11 metrics, 3 deferred on schema-history grounds)*

**Drill-down UX (prior pass, still in place).** Every `<Card>` in
`TractionDashboard` is a Pressable that opens `MetricSeriesModal`:
Canela title + one-line definition (from the `E` map), current
value, full daily line chart (`LineChart` via SVG). Backend
dispatcher at `GET /api/stats/series?key={key}&range=30d`
(admin-gated). Cards without a backing series hit a graceful
"Daily history not yet captured" state.

**This pass — 8 new B2B metrics + 4 ranked tables.** The Supply
tab now reads as a real B2B dashboard, not just an inquiry-volume
screen. Cards (with drill-down where the daily series makes sense):

- **Inquiries (7d)** — leading-edge velocity vs the 30d card.
  `seriesKey="inquiries_7d"`.
- **Median Response Time** (`median_response_hours`) — median
  hours from a café opening an inquiry to the first message back
  from a roaster account, last 30d. SQLite has no MEDIAN; rows
  come back as per-inquiry hours and Python takes the middle one.
  Renders `—` when no responses recorded yet.
- **Avg Thread Depth** (`avg_thread_depth`) — `AVG(c)` over
  `(SELECT COUNT(*) c FROM inquiry_messages GROUP BY inquiry_id)`.
  Distinguishes drive-by interest from real procurement
  conversations.
- **Returning Cafés** (`returning_cafes`) — cafés that have come
  back to the *same* roaster for a 2nd-or-later inquiry. Best
  proxy for "this sourcing relationship is sticking."
- **Inquiry Messages** + **Messages (30d)** — total inquiry-thread
  message volume with daily drill-down series. Leading indicator
  before a thread converts to a formal order (Phase 2).

Plus 4 ranked tables in a new `PlotCarousel` at the bottom of the
Supply tab (same swipe pattern as Loyalty / Network / Commerce):

- **Most-inquired beans** — top 5 by inquiry count, joined to
  `products` + `roaster_products` so beans authored by either
  table show up. Sub-line is the roaster name.
- **Most-responsive roasters** — top 5 by response rate, weighted
  by volume. `HAVING COUNT(*) >= 3` filter dodges the
  "1 of 1 = 100%" noise.
- **Cafés inquiring by city** + **Roasters receiving by city** —
  geo distribution leaderboards. Foundation for the Goa-vs-
  Bangalore-vs-other heatmap once enough volume lands.

**Pre-existing series-defs typo fixed.** The original §2.18 work
wired `inquiries_total` and `inquiries_30d` series defs against
`opened_at` — the column is actually `created_at`, so both
drill-downs were silently returning empty until now. Both keys
now use `created_at`; series renders correctly.

**Deferred metrics (3 of 11 — need new schema, out of scope for
this pass):**

- **Inquiry re-open rate** — needs a `wholesale_inquiry_status_history`
  table (or equivalent column journal) so we can count archived →
  open transitions. The current schema overwrites status without
  history.
- **Avg order size mentions** — needs a regex pass over inquiry
  notes to extract numeric quantities, plus probably a structured
  `quantity_kg` column for the inquiry modal so the data isn't
  parsed every read.
- **Wholesale flag churn** — needs `products_wholesale_history` (or
  reuse a generic audit log). Without a change-log we can't measure
  toggle frequency.

These three should land in a follow-on pass that introduces the
schema additions; once the history tables exist, the SQL is
straightforward and slots into the same `_SERIES_DEFS` /
`renderSupply` pattern as the 8 metrics that landed here.

**Backend code:** `services/admin_stats.py` `_supply()` extended
with the 8 new computations (lines clearly labelled `§2.18
expansion`); `_SERIES_DEFS` extended with `inquiries_7d`,
`inquiry_messages_total`, `inquiry_messages_30d`. Frontend code:
`crema-app/src/components/admin/TractionDashboard.tsx`
`renderSupply()` extended with 6 new cards + a new `PlotCarousel`
slide for each ranked table; `E` map extended with one-line
definitions for every new metric.

### 2.19 Confirm-before-delete sweep (every delete button) *(shipped)*

The shared `<ConfirmDeleteModal>` primitive
(`src/components/primitives/ConfirmDeleteModal.tsx`) now backs every
destructive action across the app. Same shell as §2.9's bean-delete
sheet but lifted to a single component so title / body / confirmLabel
are the only knobs and the visual is identical everywhere
(blur backdrop, Canela title, two-button footer in the site's
floating-modal language).

Per-surface state at the close of this sweep:

- **Roaster bean delete** — was the original §2.9 inline `Modal`
  with custom `confirmCard` styles; migrated to the primitive,
  dead styles dropped. Body falls back to the primitive's
  recycle-bin recovery copy when the bean's `coffee_name` isn't on
  hand at click time, otherwise the bean name is interpolated.
- **Café loyalty disable** (trash next to stamp meta) — the trash
  used to fire `onStampsEnabledChange(false)` directly; now opens
  a "Turn off loyalty?" confirm with a body that explains in-flight
  stamps stay preserved while the program is paused.
- **Roaster post delete**, **profile post delete**, **profile shelf
  entry remove**, **café menu item delete**, **feed post delete** —
  already wrapped in the primitive in earlier passes; verified during
  the audit, no changes needed.
- **Café posts feed post delete**, **comment delete**, **tasting note
  delete**, **profile image removal** — no live delete UI exists for
  these surfaces today (PostCard on cafe page omits `onDelete`,
  `CommentThread` has no delete button, `TastingNoteDisplay` is not
  mounted in any screen, profile image is replace-only). Nothing to
  wrap; if any of these gain a delete affordance later the primitive
  is one line away.
- **Admin account deletion** — out of scope; that flow needs the
  type-to-confirm-username pattern, separate from this sweep.

### 2.20 Cross-business follower notifications (wholesale flag, etc.) *(shipped)*

Four new notification types now fan to business followers (`account_type
IN ('roaster','cafe')`) only — the existing `notify_followers_catalog`
helper still hits everyone, the new helpers narrow the audience:

- **`wholesale_available`** — fires from `products` registry hooks
  (on_create + on_update) and from the hand-rolled
  `POST/PUT /api/roasters/{slug}/products` endpoints in
  `routes/specific.py`. Subject = bean name; deep-link =
  roaster profile. Skips the fanout when the flag isn't currently
  set, so flipping wholesale OFF doesn't notify anyone. Verified
  end-to-end: a wholesale-flagged bean creation by `nada` fanned to
  3 roaster + 1 café follower; 5 consumer followers were correctly
  skipped.
- **`sourcing_story`** — fires from `roaster_posts` on_create when
  `post_type='sourcing_story'`. The hook is a no-op for every other
  post_type so it can sit alongside `notify_repost` without an
  extra registry branch. Carries `post_id` so the dropdown opens
  the post in `PostModal` rather than routing to the roaster
  profile (special-cased in the renderer's `goToSource`).
- **`menu_updated_business`** — fires alongside the existing
  `notify_menu_updated` on `cafe_menu_items` on_update. The
  existing hook fans to all followers (lands in Business via
  `BUSINESS_TYPES` for businesses, Activity for consumers); the
  new hook adds the B2B-flavored copy ("tweaked a menu item") so
  procurement readers can scan it differently. Yes, business
  followers receive both notifications on the same trigger — the
  alternative (split the existing `notify_menu_updated` audience)
  was deferred because it ripples into `product_added` /
  `product_removed` semantics too. Tradeoff accepted.
- **`loyalty_changed`** — fires from `cafe_profiles` on_update
  alongside `sync_cafe_logo_to_user`. Skipped when
  `stamps_enabled=0` so disable events don't notify. Over-fires
  on profile saves that don't actually touch loyalty fields
  (logo change, hours change, etc.) — proper fix is field-diff
  tracking in the registry engine, deferred.

**Frontend.** `useNotifications.ts` `NotificationType` union and
`BUSINESS_TYPES` set extended with all four. `NotificationsDropdown.tsx`
gets matching `NOTIF_MESSAGES` entries; `goToSource` routes
`sourcing_story` to PostModal via `post_id`, others fall through to
the existing `target_slug` handler that routes to the entity profile.

**Service helpers.** Two new functions in `services/notifications.py`:
`_business_follower_user_ids(db, slug)` runs the JOIN'd follow lookup;
`_fanout_to_business_followers(db, slug, kind, change, subject, actor,
*, post_id=None)` wraps the loop + dedupe-by-actor + commit so each
new hook is ~10 lines.

**Caveats documented for the follow-on pass:**
- `wholesale_available` and `loyalty_changed` over-fire on saves that
  don't change the relevant field. Field-diff tracking in the registry
  engine would let the hooks fire only on the meaningful transition.
- The double-notify on menu updates (consumer's `menu_updated` fan
  reaches business followers too, alongside `menu_updated_business`)
  is the cost of not splitting the existing hook's audience. If the
  Business tab gets noisy, the fix is to split `notify_menu_updated`
  into `_consumer` and `_business` variants and move the catalog
  types out of `BUSINESS_TYPES`.

Downstream roadmap note: §2.18 now has a natural follow-on "Business
notification engagement" card — how often business-tab recipients
click through to the source entity. Good signal for wholesale-offer
visibility once enough fanout volume lands.

### 2.21 Page-transition loader *(shipped)*

`NavigationLoader` mounted at root (`app/_layout.tsx`). On every
`usePathname()` change, paints a cream-filled overlay pinned below
the navbar (`top: NAVBAR_HEIGHT`, `zIndex: 9500`) with the actual
`CremaLogo` SVG pulsing (0.45 → 1 → 0.45, 1.1s cycle). Minimum hold
of 320ms keeps the transition from reading as a flicker. Navbar
stays visible throughout — the "you're still in the app, just
moving between rooms" signal that GitHub / Linear use. Pages with
slow data can extend the hold by dispatching
`crema:loading-start` / `crema:loading-end` events.

### 2.22 Article post click-through + link-preview 500 fix *(shipped)*

Two composer bugs folded into one commit:
- **Article post thumbnails weren't clickable** — PostCard wrapped
  the cover image in a plain `<View>` instead of a `<Pressable>`,
  so pasting a URL and publishing it produced a dead card. Swapped
  to Pressable + `handleOpen` (same path the body text uses).
- **`/api/link-preview` was 500ing** — the endpoint was registered
  on `@app.get` in main.py *after* `app.include_router(resources_router)`,
  so the `/{resource}` catch-all swallowed it as
  `resource="link-preview"`. Moved to `routes/specific.py` where
  it's matched before the catch-all. Now returns Open Graph
  metadata + a favicon fallback as originally intended.

### 2.23 Composer polish *(shipped)*

`ComposePost.tsx` redesigned in one pass so the composer feels
like one surface, not four rows of form:

- **Short / Long tab row above the teaser.** Replaces the old
  "Long form · on" toggle + separate `bodyFull` textarea. Tapping
  Long extends the visible char limit (300 → 5000) on the *same*
  teaser textarea and grows its `minHeight` (48 → 220). On submit
  the composer derives a ≤280-char word-boundary excerpt for the
  feed `teaser` and hands the full text over as `body_full`;
  backend `post_type=sourcing_story` is unchanged so PostCard's
  "Read the full post →" keeps working. `bodyFull` state is gone.
- **URLs don't count toward the character count.** `stripUrls()`
  runs on every keystroke; the counter, the max enforcement, and
  the Long-mode min-200 check all use the visible length. Pasting
  a 50-char link no longer costs 50 characters.
- **Optional fields collapsed onto one chip row.** Location,
  Tag-a-café, Tag-a-drink now sit as three pill chips on a single
  horizontal flex row. Each opens its own picker — café + drink
  reuse the existing modals; location gets a small `pickerCard`
  text-prompt so all three chips feel symmetrical. Filled chips
  show the value + an X to clear.
- **Modal shell fit.** The Long-mode textarea pushed Cancel / Post
  off the bottom of the 85%-maxHeight edit shell, so the composer
  card was restructured: body in a `ScrollView` (flex-shrink), the
  submit row pinned outside the scroll with its own top border +
  bg. Tall content scrolls inside the card; Cancel / Post are
  always visible regardless of how much the user writes.
- **Link-preview verified.** `/api/link-preview` still fires on
  URL detection after the refactor; preview card renders inline
  with the editable title overlay intact.

### 2.24 Café menu — column header + tighter row height *(shipped)*

- **Column header row** ("Drink · Roaster · Roast · Price · Tasting
  Notes") added above the first drink block, sharing the data-row
  column widths so everything aligns. Rendered in Inter medium 10px
  uppercase with 0.6 letter-spacing in muted color — reads as
  metadata, not another drink row. Bottom border echoes the hours
  table's per-row rule.
- **Tighter rows** — `menuDrink` lost its own `paddingVertical`
  (set to 0) so rows carry all the per-block vertical spacing.
  `menuRow` stays at 6px top / bottom, matching `hoursRow`
  exactly; dividers keep their 6px `marginVertical`. Per-row
  density now matches the opening-hours block.

### 2.25 Recycle bin / archive *(shipped)*

Sitewide undo for destructive actions. Every hard-delete across the
backend — generic registry DELETEs + hand-rolled DELETE handlers —
funnels through `services/trash.py` `capture()` before the row
leaves its origin table. The row is serialised as JSON into a new
`trash` table along with `owner_user_id` (resolved from either
`user_id`, `cafe_slug`, or `roaster_slug` depending on the entity)
and a human-readable `label` for the bin UI.

Four routes wire the UX:
- `GET /api/trash` — every trash entry for the signed-in user,
  newest first, grouped on the frontend by `entity_type`.
- `POST /api/trash/{id}/restore` — pops the entry, re-INSERTs the
  payload into its origin table (refusing with 409 if another row
  has taken the same primary key in the meantime).
- `DELETE /api/trash/{id}` — permanent single-item purge.
- `DELETE /api/trash` — empty the bin.

Frontend: `RecycleBinModal` opens from a new "Recycle bin" entry in
`ProfileDropdown`. Floating modal in the sitewide language (blur
backdrop, Canela title, token card). Sections per entity type —
Posts, Comments, Tasting notes, Shelf entries, Café menu items,
Brew recipes, Products — each row carries a Restore pill + a
permanent-delete bin icon. Empty-bin pill in the header.

Coverage — every hard-delete path the audit found is captured:
registry `delete_resource()` in `resources/crud.py`, plus
`DELETE /api/post-comments/{id}` (already via registry) and
`DELETE /api/roasters/{slug}/products/{id}` (hand-rolled in
`routes/specific.py`). Toggle flows (likes / follows) and
telemetry (click events) are intentionally out of scope — they're
not "deletes" in user language.

### 2.26 Sign-out auto-switch: no more /auth flicker *(shipped)*

The §2.13 auto-switch was landing users at the next account's
entity home but flashed `/auth` first. Root cause: `logout()`
called `setUser(null)` BEFORE swapping in the next account's
session, so AuthGate saw a null user mid-switch and fired
`router.replace("/auth")` before `window.location.assign` to the
next account home took over.

Fix: reorder `logout()` to swap the session token, fetch the next
`/auth/me`, and hard-navigate FIRST — only fall back to clearing
state + redirecting to `/` when there's no next saved account.
Also dropped the redundant `router.replace("/")` from
`ProfileDropdown.handleSignOut` since `logout()` owns navigation.
Verified: signing out of one account with another saved now lands
directly on the next entity's home, without any auth screen in
between.

### 2.27 Business analytics dashboard *(shipped)*

Per-business analytics sub-tab inside roaster and café profiles.
Counterpart to the admin traction dashboard but scoped to "fast
insight for one owner" rather than "data for the admin team":
two subtabs, three small cards per subtab, one line chart above.
Every card doubles as a chart selector — tap a card, the line
chart re-plots that metric.

**Backend.** `services/business_stats.py` exposes two composer
entry points (`compute_roaster_business`, `compute_cafe_business`)
that assemble the full payload — for each section, three metric
cards + their per-card 30-day daily series. Owner-gated endpoints
at `GET /api/stats/business/roaster/{slug}` and
`/api/stats/business/cafe/{slug}` (with admin bypass for `crema`).

**Roaster dashboard — "Am I finding buyers?"**
- **Wholesale** subtab: Inquiries this week · Open inquiries
  (tinted red when >0) · Top bean cafés are asking about (30d)
- **Audience** subtab: Followers · Cafés following me (the
  warm-lead number) · Posts this month

**Café dashboard — "Is my loyalty program working?"**
- **Loyalty** subtab: Stamps this week · Repeat-customer rate
  (tinted red <10%, green ≥30%) · Top regular
- **Menu** subtab: Tasting notes about my beans · Posts tagged
  with this café · Unique roasters on menu (tinted red when ≤1
  on a ≥3-item menu — the NORTH_STAR §2 supply-anxiety signal)

**Design rules.** Cards are small (170-220px wide, ~140px tall),
flex-wrap horizontally — they never span the full row. Label is
uppercase muted micro-copy; value is 30px Canela display; delta
is a single ↑/↓/→ arrow with % vs prior 7d; optional hint line
below. Selected card gets a cream fill + dark border to signal
"this is the chart source". Every card has an info "?" button
with a one-line explanation + a suggested action ("If this is
zero, try posting a sourcing story this week"). Empty series
renders an honest "No daily history yet" placeholder instead of
an empty chart.

**Mounting.** New "ANALYTICS" tab on both `app/roaster/[slug].tsx`
and `app/cafe/[slug].tsx`, visible only when `isOwner` (admin does
*not* see this tab on other businesses' profiles — use the
existing Traction dashboard for cross-business analytics).
Component lives at `src/components/analytics/BusinessAnalytics.tsx`
and reuses the admin `LineChart` + `InfoButton` / `InfoModal`
primitives; no new schema, no new design tokens.

### 2.28 Scraper resurrection + sold-out preservation

The product catalog is populated by a scraper that crawls roaster
websites — see `specs/SCRAPER_SPEC.md`. Two things need to happen
before the next seeding run:

- **Sold-out preservation.** When a scraped product disappears from
  the roaster's site (sold out, seasonal cycle, reformulated) we
  currently delete the row, which orphans every tasting note, shelf
  entry, and inquiry that referenced it. Instead: soft-delete via a
  `status = 'sold_out'` (or `archived`) column + an `is_visible`
  flag so:
  - The CoffeeCard still renders for anyone who has it on a shelf
    or a tasting note referencing it, visually tagged "sold out"
    and with the Buy button disabled.
  - It's hidden from Discover / Browse / search by default.
  - When the scraper sees it come back online, the flag flips
    back to available — no duplicate row.
  This keeps the graph dense (NORTH_STAR §4) instead of quietly
  shredding historical references every time a roaster swaps a lot.

- **Scraper fidelity.** Spot-checks show the current scraper
  mis-parses a handful of fields — roast level sometimes blank even
  when the source page has it, tasting-notes sometimes captured as
  the whole paragraph instead of the tokenized tags, occasional
  price miss on products with size variants. The `specs/SCRAPER_SPEC.md`
  pipeline needs a pass to stabilize these parsers + add a diff-review
  step before writes land in `products`. Separate discussion — raise
  when actively working on it.

### 2.29 Roaster product editor: migrate off the floating modal

The §2.9 pencil-on-owner-card currently opens a floating modal
hosting `EditableCoffeeCard`. That's the pattern the site has
leaned into too hard — every edit flow is a modal. The in-place
alternative (the card flips to editing mode where it sits, same
language `EditableCoffeeCard` already uses for creation) is less
friction and more honest: the edit happens exactly where the user
was looking. Tracked here as a V2; for Phase 1 the modal stays,
but the PUT endpoint `/roasters/{slug}/products/{product_id}`
(added alongside this note) now exists so the tick button actually
saves — without it the button silently 404'd via the resource
catch-all.

*(§2.30 Launch blockers + §2.31-2.39 Mobile readiness block —
both moved to the top of section 2, under the Runway summary.
See "Mobile (iOS / Android) readiness — THIS WEEK" and "Launch
blockers — everything non-mobile" up top. Heading numbers preserved
for cross-references from commits.)*

---

*When a build item is completed, move it from section 2 into section 1
with the relevant commit hash and file references. This document should
always reflect the true state of the codebase.*
