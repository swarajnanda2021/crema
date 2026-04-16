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
| **Social feed** | Posts (articles, notes, reposts, tasting-note auto-posts), likes, threaded comments with replies, notifications | `roaster_posts` + `post_likes` + `post_comments` resources |
| **Post composer** | Floating modal, image upload, link auto-detect with preview, tasting-note card attachment, tag-a-café (pink heart icon), tag-a-drink picker, location | `ComposePost.tsx` |
| **Buy button** | Outbound click to roaster's product URL, tracked in `click_events` (product, roaster, source page, timestamp) | `CoffeeCard.tsx`, `click_events` resource |
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

### 2.1 "Interested" button (café → roaster wholesale inquiry)

The highest-value Phase 1 B2B feature. A café owner viewing a roaster's
product page sees an "Interested" button that creates a lightweight
inquiry record and sends a business notification to the roaster with
café context (name, location, menu, volume). No transaction — just the
handshake.

Requires: new `wholesale_inquiries` registry resource, new notification
type, business notification tab (2.4), café procurement profile fields
(2.6).

### 2.2 Wholesale availability signal

Roasters mark products as wholesale-available with optional minimum
order and a note. A "Wholesale" badge appears on the product card,
**visible only to café accounts**. Cafés can filter the catalog for
wholesale-available products.

Requires: 3 new fields on products/roaster_profiles, conditional render
gated on viewer's account_type.

### 2.3 Sourcing story posts

A new long-form post type for roasters. 2000+ character body, multiple
photos, auto-detected URLs, tagged product and origin. Renders as a
richer card in the feed with a "Read full story" expansion. Lives on
the roaster profile, in followers' feeds, and linked from the product
page.

Requires: new `post_type: "sourcing_story"`, increased teaser limit,
rich card renderer.

### 2.4 Business notification tab *(shipped — see §1.2 Activity / Business tabs)*

The tab split, categorization helper (`BUSINESS_TYPES` in
`useNotifications.ts`), per-tab unread counts, and admin Supply-tab
metrics all landed. `wholesale_inquiry` and `stamp_awarded` types are
pre-reserved so §2.1 and future loyalty work can fire them without
another enum change.

### 2.5 Brew method cards

Roaster-submitted infographic cards in the product carousel, one per
recommended brew method. Fields vary by method (espresso: dose/yield/
ratio/time/temp/grind; pour-over: dose/water/bloom/brew-time/grind;
etc.). Distinguished visually from user-submitted tasting-note cards.

Requires: new `brew_methods` registry resource nested under products,
infographic card component, method-specific field schema.

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
