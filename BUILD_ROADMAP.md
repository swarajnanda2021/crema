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
| **Sourcing story post type** | `post_type = "sourcing_story"` with a dedicated `body_full` column on `roaster_posts`. Teaser stays the excerpt shown in the feed; `body_full` is the expanded narrative (farm/producer/process). PostCard renders a "Read full story →" affordance that toggles the long body inline. Roasters opt in from the composer. | `roaster_posts.body_full`, PostCard `isSourcingStory` branch, `ComposePost` story toggle |
| **Post composer** | Floating modal, image upload, link auto-detect with preview, tasting-note card attachment, tag-a-café (pink heart icon), tag-a-drink picker, location. Roaster accounts get a "Sourcing story" toggle (§2.3) that promotes the post to long-form with a dedicated body_full textarea (min 200, max 5000 chars). | `ComposePost.tsx` |
| **Buy button** | Outbound click to roaster's product URL, tracked in `click_events` (product, roaster, source page, timestamp) | `CoffeeCard.tsx`, `click_events` resource |
| **Brew method cards** | Roaster-submitted recipe cards rendered as a horizontal carousel on the product detail page ("Recommended recipes from the roaster"). Method-specific field layout (espresso: dose/yield/ratio/time/temp/grind; pour-over: dose/water/bloom/brew-time/grind; etc.). `fields_json` escape hatch for method-specific extras that don't fit the shared columns. | `brew_methods` resource, `BrewMethodCard.tsx`, `/coffee/[id]` carousel |
| **"Interested" wholesale handshake** | Café accounts see an Interested button on the product detail page. Tapping opens a modal with an optional note, creates a `wholesale_inquiries` row, and fires a `wholesale_inquiry` notification to every roaster-account user on that slug — lands in their Business tab (§2.4) with a deep-link to the sending café's profile (where §2.6 procurement fields render). Roaster can respond / archive via `POST /api/wholesale-inquiries/{id}/respond`. | `InterestedButton.tsx`, `wholesale_inquiries` resource, `_handle_notify_wholesale_inquiry` hook, `/api/my-wholesale-inquiries` |
| **Wholesale availability signal** | Roasters flag products as wholesale-available (3 fields: flag, minimum kg, note). Products live in both `products` and `roaster_products` tables so the columns + indexes are mirrored. A "Wholesale" badge renders bottom-left on `CoffeeCard` — visible only to café accounts. Browse adds a "Wholesale available only" filter (café viewers). `POST /api/roasters/{slug}/products` accepts the 3 fields. Inline owner-edit UI on existing products is deferred — dedicated product editor lands in a follow-up. | `products.wholesale_*`, `roaster_products.wholesale_*`, `CoffeeCard` badge, browse filter |
| **Notifications** | Dropdown with likes, comments, follows, reposts, reply, catalog-change notifications (product added/removed, menu changed). Subject line + deep-link to source entity. | `NotificationsDropdown.tsx`, `useNotifications.ts` |
| **Activity / Business tabs** | Roaster + café accounts see the notifications dropdown split into two tabs. Activity = social (like/comment/follow/repost/reply); Business = catalog fanout + future wholesale inquiries (§2.1) + stamp awards. Regular users still see one flat list. Unread count appears next to each tab label. | `NotificationsDropdown.tsx` `BUSINESS_TYPES` set in `useNotifications.ts` |
| **Browse / Discover** | Roasters list with city filter, cafés list with city filter, product catalog | `app/(tabs)/browse.tsx` |
| **QR identity** | Short-lived QR tokens (5-min TTL), displayed in profile dropdown "Show QR" and inside stamp book modals | `useQRToken.ts`, `QRModal.tsx`, `services/qr_tokens.py` |

### 1.3 Roaster features

| Feature | Description | Key files |
|---------|-------------|-----------|
| **Roaster profile** | Split-panel layout, hero with drag/zoom, logo, about blurb, specialties, city, website. In-place editing for owners. | `app/roaster/[slug].tsx` |
| **Product catalog** | Cards with bean name, roast level, origin, process, tasting notes, price, weight, image with crop. Owners can add (EditableCoffeeCard with slide-in animation), hide, or delete products. | `EditableCoffeeCard.tsx`, roaster products endpoints |
| **Posts tab** | Feed of roaster's articles/notes, pinnable featured posts, owner edit/delete affordances | PostCard in roaster page |
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

### 2.7 Launch blockers (from LAUNCH_TODO.md)

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
