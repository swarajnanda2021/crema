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
| **Notifications** | Dropdown with likes, comments, follows, reposts, reply, catalog-change notifications (product added/removed, menu changed). Subject line + deep-link to source entity. | `NotificationsDropdown.tsx`, `useNotifications.ts` |
| **Activity / Business tabs** | Roaster + café accounts see the notifications dropdown split into two tabs. Activity = social (like/comment/follow/repost/reply); Business = catalog fanout + future wholesale inquiries (§2.1) + stamp awards. Regular users still see one flat list. Unread count appears next to each tab label. | `NotificationsDropdown.tsx` `BUSINESS_TYPES` set in `useNotifications.ts` |
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

### 2.18 B2B metrics expansion + clickable cards drilling into a daily chart *(partial — drill-down shipped, new metrics pending)*

**Drill-down UX shipped.** Every `<Card>` in `TractionDashboard` is
now a Pressable that opens `MetricSeriesModal`: Canela title +
one-line definition (from the `E` map), current value + prior-period
delta, full daily line chart (ggplot-style via the existing
`LineChart` component). Backend dispatcher at
`GET /api/stats/series?key={key}&range=30d` (admin-gated). 13
series wired at ship: `daily_signups`, `dau`, `daily_posts`,
`total_posts`, `total_comments`, `total_reposts`, `total_clicks`,
`total_stamps`, `total_follows`, `inquiries_total`, `inquiries_30d`,
`sourcing_stories_total`, `brew_methods_total`. Cards without a
backing series hit a graceful "Daily history not yet captured"
state.

**Still parked: the new B2B metrics.** Each needs its own SQL
rollup + an `_SERIES_DEFS` entry + a `seriesKey` prop on the
Card. Backlog below.

**Missing metrics to add.** The current Supply tab covers
inquiry volume + wholesale-flag coverage + sourcing stories + brew
recipes. Missing pieces a real B2B dashboard should surface:

- **Time-to-first-response** (median hours, 30d rolling) — measures
  roaster responsiveness on inquiry threads. Low number = warm
  market; high = friction.
- **Inquiry thread depth** — avg messages per thread. Distinguishes
  drive-by clicks from real conversations.
- **Inquiry re-open rate** — % of archived threads that came back
  to Open. Signals that archiving is premature, or that repeat
  conversations happen on the same lead.
- **Cafés returning for a 2nd inquiry** to the *same* roaster —
  best proxy for "this sourcing relationship is sticking."
- **Inquiry velocity** — new inquiries per week, trendline. Pairs
  with the existing Inquiries (30d) card.
- **Most-inquired-about beans** (top-N table) — product-level
  demand signal. Equivalent to the existing "Top clicked products"
  table but for wholesale interest.
- **Most-responded-to roasters** — roaster leaderboard by response
  rate + volume. Identifies high-conversion roasters worth
  highlighting.
- **Avg order size mentions** — if the café sets an inquiry note
  with quantity, parse it into a numeric field. Optional, nice-to-
  have, needs a minor schema tweak.
- **Wholesale flag churn** — how often roasters toggle
  `wholesale_available` on/off per week. High churn = seasonal
  supply; low churn = stable offerings.
- **Inquiry geo distribution** — cafés inquiring by city,
  roasters receiving by city. Ties into the "network" chart work
  the admin tab already started.
- **Messages-per-day trend** — total inquiry message volume across
  the platform, daily series. Leading indicator before a thread
  converts to a formal order (Phase 2).

**Out of scope for this item:** per-user / per-roaster cohort
filtering, exportable CSV, alerts. Those are follow-ons once the
new metrics land.

### 2.19 Confirm-before-delete sweep (every delete button)

The roaster bean delete now asks first (see §2.9). Standing rule
going forward: **every destructive action opens a confirmation
sheet before firing.** Audit pass needed on the full list of
delete affordances:

- Café menu item trash (per-row delete in the menu table) — no
  confirm today.
- Post delete (PostCard `…` menu → Delete) — check; at least some
  surfaces skip the confirm.
- Comment delete — check.
- Shelf entry remove (CoffeeCard shelf bin from the user's own
  shelf) — no confirm today.
- Tasting note delete — check.
- Café loyalty disable (trash button next to stamp meta) — currently
  toggles off, no confirm; low-stakes but inconsistent.
- Roaster / café profile image removal — check.
- Admin account deletion (once §2.16 lands) — requires a much
  stronger confirm flow (type-to-confirm username).

Reusable `<ConfirmModal>` component (same shell as the bean-delete
sheet already landed on the roaster page) with props `{ title,
body, confirmLabel = "Delete", destructive = true, onConfirm,
onClose }`. Every call site switches to it in one pass.

### 2.20 Cross-business follower notifications (wholesale flag, etc.)

Follow edges already cross business lines: a café can follow a
roaster, a roaster can follow a café, etc. Today **catalog
notifications** only fire on a roaster's own-catalog changes
(add/remove product) to their followers. Missing fanouts to build:

- **Wholesale flag flipped on.** When a roaster toggles
  `wholesale_available` on an existing bean (once §2.9's roaster
  edit mode lands), fire a `wholesale_available` notification to
  every **business** follower (café or roaster accounts). Lands in
  the recipient's Business tab with a deep-link to the product.
  Consumers don't get this — the signal is B2B-only.
- **Menu item change → business followers.** When a café updates
  its menu, its **business** followers (other cafés / roasters)
  see the change in their Business tab, while consumer followers
  keep seeing it in Activity.
- **Sourcing story published.** Roaster publishes a
  `sourcing_story` → business followers get a Business-tab
  notification; consumers see it in Activity.
- **Café loyalty program changes.** Big reward swap or seasonal
  reopen → business followers.

General rule: **if the action is about *what a business offers*,
the notification is B2B, fanned out to business followers via the
Business tab.** If it's social (like / comment / follow), it goes
to Activity. This completes the §2.4 tab split — right now the
Business tab only sees a narrow subset of events.

Mechanics:
- Extend `BUSINESS_TYPES` in `useNotifications.ts` with
  `wholesale_available`, `menu_updated_business`, `sourcing_story`,
  `loyalty_changed`.
- Service hook `notify_business_followers(entity_slug, event,
  payload)` that looks up follow edges where the follower has
  `account_type IN ('roaster', 'cafe')` and creates rows in
  `notifications`.
- Wire from the existing fanout points (product update hook,
  menu item hooks, roaster_posts on_create for sourcing_story,
  café_profiles on_update for loyalty).

Downstream roadmap note: once this ships, the B2B metrics (§2.18)
benefit from a new "Business notification engagement" card — how
often business-tab recipients click through to the source entity.
Good signal for wholesale-offer visibility.

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

### 2.30 Launch blockers (from LAUNCH_TODO.md)

Before any of the above ships to real users:
- Password reset flow
- Account deletion (Apple requirement)
- Report post + moderation
- Privacy Policy + Terms of Service stubs
- Contact us / feedback widget
- Env-based config (no more hardcoded localhost)
- Postgres migration + object storage
- App Store submission (icons, splash, TestFlight)

---

*When a build item is completed, move it from section 2 into section 1
with the relevant commit hash and file references. This document should
always reflect the true state of the codebase.*
