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
| **Auth** | Register, login, UUID session tokens (30-day TTL), multi-account (one user + one roaster simultaneously), floating auth modal for Add Another Account | `services/auth.py`, `useAuth.tsx`, `AuthModal.tsx` |
| **User profile** | Canela display name, avatar with drag-to-reposition + pinch-to-zoom, bio, favorite drink/café (free text), roast preference, in-place editing | `app/(tabs)/profile.tsx` |
| **Tasting journal** | Sliders (acidity, body, sweetness, aftertaste 1-5), flavor tags, full brew recipe (method, dose, yield, water, time, temp, grind, ratio), blend components | `tasting_notes` resource |
| **Coffee shelf** | Open Bags / On the List, horizontal card carousel, move between shelves, remove | `shelf_entries` resource, `useShelves.ts` |
| **Social feed** | Posts (articles, notes, reposts, tasting-note auto-posts, sourcing stories), likes, threaded comments with replies, notifications | `roaster_posts` + `post_likes` + `post_comments` resources |
| **Long-form post type** | `post_type = "sourcing_story"` with a dedicated `body_full` column on `roaster_posts`. Teaser stays the excerpt shown in the feed; `body_full` is the expanded narrative. PostCard renders "Read the full post →" to toggle the long body inline and shows "Shared a long-form post" as the subtitle. Available to every account type. | `roaster_posts.body_full`, PostCard `isSourcingStory` branch, `ComposePost` long-form toggle |
| **Post composer** | Floating modal, image upload, link auto-detect with preview, tasting-note card attachment, tag-a-drink picker, location. Every account gets a "Long form" toggle that promotes the post to long-form with a dedicated body_full textarea (min 200, max 5000 chars). | `ComposePost.tsx` |
| **Buy button** | Outbound click to roaster's product URL, tracked in `click_events` (product, roaster, source page, timestamp) | `CoffeeCard.tsx`, `click_events` resource |
| **Brew method cards** | Roaster-submitted recipe cards rendered as a horizontal carousel on the product detail page ("Recommended recipes from the roaster"). Method-specific field layout (espresso: dose/yield/ratio/time/temp/grind; pour-over: dose/water/bloom/brew-time/grind; etc.). `fields_json` escape hatch for method-specific extras that don't fit the shared columns. | `brew_methods` resource, `BrewMethodCard.tsx`, `/coffee/[id]` carousel |
| **Messages inbox** | Navbar Messages icon (every authenticated user) with unread badge opens a chat-style inbox dropdown listing direct-message threads — counterparty avatar, last-message preview, time, unread count. Inbox / Archive tabs (Archive is session-scoped until the DM-archive backend ships in §2.40.8). Tapping a row opens `ThreadBody`: compact header with counterparty avatar, conversation area with self/other bubbles, composer at bottom. Polls every 5s while open; marks read on open + on new messages. | `/api/my-threads`, `/api/direct-threads/*`, `MessagesDropdown.tsx`, `ThreadBody.tsx`, `useDirectInbox.ts` |
| **Popularity modal (on-shelf viewer)** | Tapping the circular social dot on a CoffeeCard opens `PopularityModal`. Fetches `/products/{id}/users` and `/products/{id}/posts` in parallel, renders tasting-note posts via the shared `PostCard` (full header + tasting-note card + action bar — identical to the feed), and silent shelvers (no post) land in a compact "Also on shelf" list below. Shell matches the floating-modal language (blur backdrop, token overlay, Canela title). Count lives in the header subtitle ("On N people's shelves") — the card dot itself is number-free. | `PopularityModal.tsx`, `/api/products/{id}/posts`, `PostCard` |
| **Notifications** | Flat dropdown with likes, comments, follows, reposts, reply, catalog-change notifications (product added/removed), and sourcing-story fanout. Subject line + deep-link to source entity (sourcing_story → PostModal, others → entity profile / post). | `NotificationsDropdown.tsx`, `useNotifications.ts` |
| **Browse / Discover** | Roasters list with city filter + product catalog. Sticky search bar hides/shows via `useSearchBarAutoHide` with dead-band, bottom-freeze, and top-force-show guards so it doesn't thrash at end-of-list rubber-banding. | `app/(tabs)/browse.tsx`, `src/hooks/useSearchBarAutoHide.ts` |
| **Sitewide search dropdown** | Navbar glass opens a floating dropdown styled like messages / notifications. Cream-backed input (no browser focus ring), live narrowing, three sections: Users (via `/api/users/search`), Beans, Roasters (local-cache filter). Beans render without product image. Each section caps at 8 hits. | `SearchDropdown.tsx`, `Navbar.tsx` |
| **Discover flavor wheel — SCA picker on BEANS** | Bottom-semicircle three-ring picker mounted under BEANS on the Discover tab. T1 = 10 fixed `crema_tree_v1` tier-1 categories (radial spoke labels rendered via SVG `<Text>`); T2/T3 bloom from picked parents and re-divide the 180° arc each time picks change. Single outer `Pressable` does polar hit-testing in a custom `findPillAt` so taps survive the SVG tree mutating between selections. Cap is 3 picks per tier with a warn haptic on overflow. Result carousel underneath filters live to coffees whose tasting addresses match `selectedFlavors`. T2/T3 labels render via `@shopify/react-native-skia`'s `<TextPath>` overlaid as a sibling `<Canvas>` inside the same Pressable — Skia's text-on-path engine gives curved labels with native font kerning, which `react-native-svg` couldn't deliver (it had to choose between curve OR kerning). The Skia overlay loads `Inter_600SemiBold.ttf` directly via `useFont`; arc paths are built in screen px (Skia coord space) at the centreline radius of each ring; `pointerEvents="none"` keeps taps flowing to the hit-test below. | `crema-app/src/components/FlavorWheel.tsx`, `crema-app/src/components/FlavorWheelModal.tsx`, `crema-app/app/(tabs)/browse.tsx`, `crema-app/src/utils/scaTree.ts` |
| **`crema_tree_v1` — Crema-specific flavor taxonomy** | Replaced the canonical SCA Coffee Taster's Flavor Wheel with a from-the-catalog rebuild — 10 T1 · 39 T2 · 28 T3, single-word labels at every tier, no self-named children, zero-mass branches dropped. Audit context: of 1,166 prior SCA classifications, 25 T3 leaves had zero catalog occurrences (mostly cupping defects: Acetic/Butyric/Isovaleric Acid, Phenolic, Cardboard, Petroleum, Rubber, Skunky, Animalic) and 6 T2 nodes had zero (Pipe Tobacco, Pungent, Vanillin, Overall Sweet, Beany, Raw). The wheel rendered them as empty pie slices that bloated label space for the 39 leaves that actually carried mass. New T1 set: Sweet, Fruity, Floral, Sour, Earthy (renamed from Other > Papery/Musty), Roasted, Spices, Nutty, Cocoa (split from Nutty/Cocoa since Cocoa alone has 3× the catalog mass of Nutty), and a new **Body** T1 absorbing the 273 unclassified mouthfeel-mass occurrences (Smooth, Bold, Crisp, Creamy, Mellow). Migration: a one-shot `reset_for_crema_tree_v1(conn)` in `services/catalog_ops.py` wipes `sca_addresses` + `sca_tree_versions` and re-inserts v1 as the active tree on next API boot, gated on `PRAGMA user_version >= 5`. The `_seed_sca_addresses` JSON-cache reseed path is also gated on `>= 5` so the canonical-SCA-keyed cache never resurrects post-swap. Admin completes the swap by running Catalog Ops > Standardization > Tasting, which Haiku-classifies all 1,678 tags against v1. The frontend `displayLabel` helper, formerly slash-collapsing `Sour/Fermented` → `Sour` etc., is now an identity function since every node is already a single word; `TIER_1_ORDER` extended to 10 entries. | `Community/coffee-community-api/services/sca_geolocator.py`, `Community/coffee-community-api/services/catalog_ops.py`, `crema-app/src/utils/scaTree.ts` |
| **Flavor wheel direction shift — single-tier full-circle (`crema_tree_v2` planned)** | Designer feedback on the wireframe killed the multi-tier model: drilling T1 → T2 → T3 with multi-pick caps was producing too many "0 coffees" results and felt like work for the user. Direction set to a **single-tier full-circle wheel, single-select**, plus a separate Body chip strip *deferred to a later phase*. Ground-truth check before drafting v2: ran an empirical clustering pass over the 240 distinct flavor-tags-with-catalog-occurrence-≥2, embedding each as `coffee tasting note: <tag>` via `sentence-transformers/all-MiniLM-L6-v2` (M1 venv at `tmp/cluster_venv/`, gitignored), then HDBSCAN (natural k) and KMeans(k=14, the proposal's count). Findings that informed v2: (a) **Body is a clear separate axis** — KMeans grouped `smooth, rich, creamy, bold, full-bodied, velvety, bright, silky, intense, balanced, mellow, mild, complex` together as a 386-mass cluster sharing space with `earthy/oak/wood/smoke`, empirically validating "don't put mouthfeel on the flavor wheel"; (b) **strong validation** for Citrus, Berry, Nutty, Spice, Chocolate as natural clusters; (c) **boundary surprises** — Vanilla embeds with Chocolate (consumer mental model says keep separate but place adjacent on the wheel), Apple/Pear embed closer to Tropical than to Stone (orchard fruits are more "fresh/light" than "stone-fruit-fleshy"), Wine + Grapes form one cluster (keep adjacent), Honey embeds with Spice/Aromatic but consumer-wise belongs with Caramel (keep human placement); (d) Indian-specific terms (jaggery, jackfruit, tamarind) cluster sensibly with the dark-sweet-fruit zone — manual placements were correct. Implementation deferred — `crema_tree_v1` (10 T1 · 39 T2 · 28 T3) is what's in the codebase right now and what the running migration seeded. v2 swap will be a separate change once the design is final. | research artifacts in `tmp/cluster_venv/`, `tmp/cluster_results.txt` (gitignored) |
| **`crema_v3` — single-tier full-circle wheel + Body chip strip + admin Schema Manager** | Shipped the wheel rewrite the designer asked for. **Wheel:** full circle (360°), 10 single-word sectors arranged clockwise from 12 o'clock (Chocolate · Caramel · Floral · Citrus · Berry · Fresh fruit · Dried · Spice · Nutty · Earthy), **single-select** — tap a sector to filter, tap again to clear, tap another to switch. Skia overlay removed (single-word labels at ≥36° wedges fit on radial spokes via plain `<SvgText>`). Bullseye in the centre shows live coffee count for the current pick. **Body chip strip:** five chips (Smooth · Bold · Crisp · Creamy · Mellow) below the wheel, each labeled with its in-stock count so users see bucket size *before* tapping (kills the "0 coffees" surprise). Single-select, AND-filters with the wheel selection. **Schema is data, not code:** flavor schemas live in `sca_tree_versions` rows (each row a JSON document with `kind: "single_tier"`, `version`, `label`, `sectors[]`); two seeded by default — `crema_v3_n10` (active) and `crema_v3_n14` (inactive A/B variant with Vanilla, Tropical, Stone, Wine, Smoky as separate sectors). **Schema Manager UI** in Catalog Ops > Standardization lets admin upload new schemas (paste JSON, server-side validated by `parse_tree_json`), activate any row (`POST /admin/flavor-schemas/{id}/activate`), and see a stale-address banner when classifications don't cover the active schema with a "run Tasting" prompt. Wheel reads active schema via existing `GET /api/sca/tree`. **Backend refactor:** `sca_geolocator.is_valid_address` now validates single-element `[sector_name]` addresses; `build_tasting_prompt` and the unified standardize prompt list sectors with their absorb-exemplars instead of walking a 3-tier dict; `address_to_columns` always stores t1 only (t2/t3 NULL). **Migration:** `reset_for_flavor_schema_v3(conn)` gated on `PRAGMA user_version >= 6` wipes both tables and seeds the two v3 schemas inline; `_seed_sca_addresses` JSON-cache reseed gated on `>= 5` so the canonical-SCA cache stays buried. Front-end `Picks {t1,t2,t3}` collapsed to `selectedFlavor: string | null`; `coffeeMatchesPicks` → `coffeeMatchesSelection`. | `Community/coffee-community-api/services/flavor_schemas/crema_v3_n10.json` + `crema_v3_n14.json`, `Community/coffee-community-api/services/sca_geolocator.py`, `Community/coffee-community-api/services/catalog_ops.py`, `Community/coffee-community-api/routes/specific.py`, `crema-app/src/utils/scaTree.ts`, `crema-app/src/components/FlavorWheel.tsx`, `crema-app/src/components/FlavorWheelModal.tsx`, `crema-app/src/components/FlavorBodyStrip.tsx`, `crema-app/src/components/admin/FlavorSchemaManager.tsx`, `crema-app/src/components/admin/StandardizationPanel.tsx`, `crema-app/app/(tabs)/browse.tsx` |
| **Discover JOURNAL — roaster blog/journal feed + in-app reader** | Third sub-tab on Discover alongside BEANS / ROASTERS, surfaces articles each roaster publishes on their own site. Why it earns the surface: per the field findings in `NORTH_STAR.md`, micro-roasters want to lead with sourcing stories (the farm, processing, relationship), not tasting-note shorthand — JOURNAL is the surface where that voice lives. Chronological feed (newest first by `published_at`, falling back to `scraped_at`); 1-col on mobile, 2-col on wide. `ArticleCard` primitive renders a 16:9 hero (Shopify CDN-resized via `thumbnailUrl`), display-font title, RoasterLogo + roaster name + date + reading-time meta row, and a 2-line excerpt. **Reader screen** at `app/article/[id].tsx` hydrates synchronously from the sitewide `RoasterArticlesProvider` cache (every field except `body_html`), then silent-revalidates `/articles/{id}` to populate the body. Body renders via `htmlToBlocks` — a small in-app HTML→native walker that handles h1-h6, p, blockquote, ul/ol, img, hr, figure/figcaption (no `react-native-webview`, no `react-native-render-html`, no markdown lib added). Anything fancier (tables, embeds, video) drops to the bottom "Read the original on {domain}" CTA, which fires `trackClick` with `source_page='article'`. v1 ships with no filter dimensions on the JOURNAL tab — the prompt explicitly defers filter scope until live content shape is known. | `crema-app/app/(tabs)/browse.tsx` (`JournalList`), `crema-app/src/components/domain/ArticleCard.tsx`, `crema-app/app/article/[id].tsx`, `crema-app/src/hooks/useRoasterArticles.tsx` (sitewide cache), `crema-app/src/utils/htmlToBlocks.ts` |

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

### 1.5 Admin dashboard

| Feature | Description |
|---------|-------------|
| **Site Analytics tab** | Owner-only tab on the Crema admin's profile (username "crema", is_admin=1). Contains 4 sub-tabs: Engagement, Commerce, Network, Retention. |
| **Metric cards** | Canela big numbers + Inter labels + optional "?" info button that opens a floating modal with the metric's explanation. |
| **Time-series charts** | ggplot-style line charts (react-native-svg) for daily active users, daily signups, daily posts, daily clicks. Friendly date labels ("Apr 1st"), ~6 ticks, hover tooltip that flips below when near top. Pre-data empty days trimmed. |
| **Ranked tables** | MetricTable for top-clicked products, clicks by source, top roasters by followers. Scrollable inside carousel cards. |
| **Retention cohort grid** | Weekly signup cohorts with D1/D7/D30 retention %, heat-tinted cells. Writer retention. |
| **Plot carousel** | Swipe-only (no buttons), dot pager, per-section state isolation via React key. |
| **Circular refresh button** | 44×44 dark primary fill, cream icon, matches site FAB language. |
| **Backend** | `services/admin_stats.py`: 4 section functions, each wrapped to never crash the others. Daily series with zero-fill + leading-zero trim. Gated on `is_admin=1 AND username="crema"`. |
| **Catalog Ops tab** | Second admin-only top-level tab on the Crema admin's profile, alongside Site Analytics. Two sub-tabs: **Scraper** (run the existing `Scraper/` pipeline on demand, edit the list of roaster sites it crawls, see job history with log tails) and **Taste Graph** (run Haiku classification on un-geolocated flavor-note tags, upload + validate-diff + activate new SCA tree versions). Long-running work fans out to FastAPI `BackgroundTasks` writing into a new `jobs` table; the admin tab polls every 2 s while a job is live. v0 is local-only on the M1; the prod-deployment hardening (worker queue, restart safety, log persistence, secret manager) is parked in `LAUNCH_TODO §3.8`. |
| **Catalog Ops backend** | New tables in `database.py`: `jobs`, `roaster_sources`, `sca_addresses`, `sca_tree_versions`. Seeded idempotently on first boot from `Scraper/verified_roasters_catalog.json`, `tasting_notes_tags/tag_resolutions.json`, and the canonical SCA tree in `services/sca_geolocator.py`. New services: `services/sca_geolocator.py` (Haiku classifier + tree validator + exemplar selection), `services/scrape_runner.py` (subprocess wrapper around `Scraper/scraper/main.py`, upsert preserving `wholesale_*` owner-set columns), `services/catalog_ops.py` (job lifecycle + first-boot seeding). New endpoints in `routes/specific.py` (`POST /api/admin/scrape/run`, `POST /api/admin/scrape/sources`, `POST /api/admin/geolocate/run`, `GET /api/admin/geolocate/stats`, `POST /api/admin/geolocate/tree`, `POST /api/admin/geolocate/tree/{id}/activate`, `GET /api/admin/jobs/{id}/log`) reusing the existing `_require_admin()`. Generic CRUD route in `routes/resources.py` extended to enforce `auth: {"...": "admin"}` so registry-tagged admin resources (the four new tables + any future ones) inherit the same gate. |
| **Catalog Ops frontend** | `src/components/admin/CatalogOps.tsx` (top container with sub-tab carousel matching `TractionDashboard`'s structural moves), `ScraperPanel.tsx` (hero strip with prominent CTA + 5-stat last-run summary, **live progress strip** with parsed `[N/M] roaster …` count + auto-scrolling stdout feed visible while a scrape runs, **three landscape `CoffeeCard` carousels** for "Newly added" / "Refreshed" / "Not found this run" pulled from the job's `result_summary` — sold-out candidates surface in the third rail, **collapsible Sources panel** with All/Enabled/Unverified chip filters + search + add-by-URL so 100+ rows stay out of the way of the live job, and a compact recent-jobs list), `TasteGraphPanel.tsx` (4-card stats top-section, Run-classification CTA, paste-JSON tree upload with diff buckets `still_valid` / `now_invalid` / `would_change_meaning`, activate confirmation, tree-version list, job history). All visual values from `useTokens`; all data via `useResource<T>` or `apiFetchRaw`. Builds for both mobile and web — responsive flex via `useBreakpoint().isMobile`. `CoffeeCard` gained a `forceLandscape` prop so the admin rails get horizontal cards on web too, not just at the mobile breakpoint. |
| **Catalog Ops scrape pipeline** | The runner replaces the original `subprocess.run(capture_output=True)` call with a `Popen`-based pump: a worker thread reads child stdout line by line and calls back into the runner, which flushes `jobs.log_tail` to SQLite roughly every 1.5 s through a separate connection. The admin's poll picks up live `[12/39] Roaster (shopify) … 23 coffees ✓` chatter without waiting for completion. After completion, `upsert_scraped_products` returns three product lists — `new_products` (just inserted), `updated` (refreshed in place), and `missing` (in DB for a scraped slug but absent from this run) — each capped at 50 cards plus a `_total` count. Owner-set columns (`wholesale_available`, `wholesale_minimum_kg`, `wholesale_note`) and the `source` flag stay preserved on update so a roaster-claimed bean isn't demoted back to `'scraped'`. The seeder also pulls every roaster from `roaster_profiles` into `roaster_sources` with `enabled=0` so the admin can see the full network (~136 rows) instead of only the 39 verified-scrapeable ones, and flip new entries on as platform/shop_url get verified. |
| **Catalog Ops source row metadata** | Every `roaster_sources` row carries two registry-computed subfields: `roaster_slug` (joined via `roaster_profiles.website = roaster_sources.website`) and `products_count` (count of `products` for that slug). The admin row meta replaces the old "Never scraped" string with the catalog-side reality: "23 coffees in catalog · refreshed 2 h ago" / "23 coffees in catalog" / "0 coffees · last refresh 2 h ago" / "Not linked to a profile yet" (when the website doesn't match any profile — typically a www./trailing-slash drift). Sources sort by `products_count DESC` so the most catalog-relevant rows top the list, and a fourth filter chip ("In catalog N") narrows to roasters that actually have products in the marketplace. |
| **Catalog Ops seed gating** | All three first-boot seeders (`_seed_roaster_sources_combined`, `_seed_sca_addresses`, `_seed_sca_tree`) gate on "the relevant table is empty". Without this, FastAPI's `--reload` re-imports `database.init_db` on every code change, which used to silently re-insert any verified-catalog row the admin had just deleted — turning row management into Sisyphean toggling. Admin curation now wins on every restart. New entries are added through the Catalog Ops "Add" input rather than the seed file. |
| **Catalog Ops approval workflow** | A scrape no longer touches the `products` table directly. Every diff lands in a new `scrape_proposals` table with `status='pending'` and the admin reviews them in a "Pending review" queue: four rails (New beans / Refreshes / Back in stock / No longer found) with per-card Approve and Reject buttons plus per-rail bulk actions. Each proposal stores both `proposed_state_json` and `prev_state_json` so undo can replay the prior shape. Approving a "No longer found" proposal flips `available=0`; the next scrape that returns the same `product_id` as available proposes a `restore_available` change instead of silently overwriting. Owner-controlled columns (`wholesale_*`, `source`) are coalesced from the live row on apply, so a roaster's edits survive an admin-approved refresh. |
| **Catalog Ops undo + manual sold-out** | Every job — scrape or `manual_sold_out` — is undoable from the job-history row. `POST /api/admin/scrape/jobs/{id}/undo` reads every applied proposal for the job and reverses it (deletes inserted products iff `source='scraped'` so roaster claims survive, replays captured `prev_state` for updates / restores, flips `available=1` for sold-out marks). Backfilled prior runs lack a `prev_state` for updates — those entries are skipped and counted in the response so the admin sees what reverted vs what couldn't. `POST /api/admin/products/{product_id}/sold-out` is the one-tap manual flip; it spins up a synthetic `manual_sold_out` job + applied proposal so it shares the same undo path. |
| **Catalog Ops design polish** | Trash icon on source rows now uses CoffeeCard's `trashCircleLs` geometry — 31 px cream-info disc, 16 px lucide Trash2 in `text.primary` at strokeWidth 1.8 — so the delete affordance reads as a peer of the marketplace cards. Result-rail thumbnails pass `forceLandscape` + `width={370}` so admin cards match the canonical 370 × 251 frame the Discover tab on mobile renders, instead of the slightly-too-narrow 320 px the first cut shipped at. Numerical readouts (`SummaryStat`, rail counts, `StatCard`) take `fontVariant: ["tabular-nums"]` so digit columns line up the way they do under the price chip on a CoffeeCard. |
| **Catalog Ops scrape job accordion** | The standalone "Pending Review" panel from the first approval pass is gone — its rails moved inline under the job history. Each succeeded scrape (or `manual_sold_out`) row in the history list is an expandable accordion: tap to expand into a per-job carousel of landscape `CoffeeCard`s, each with a single status caption ("New" / "In catalog · refresh" / "Returning" / "Missing — mark sold-out?") and a single primary action button labelled per change_type ("Add" / "Apply refresh" / "Mark available" / "Mark sold-out") plus a quiet "Skip" secondary. Bulk per-rail "Apply all (N)" / "Skip all" sit on the rail head. Resolved cards (applied / skipped / reverted) keep rendering with a status badge instead of buttons so the admin sees what the run did at a glance. The most recent eligible job auto-expands on first paint so a fresh scrape lands directly on its review queue. A "Log" link on the row opens the legacy log-tail modal as a secondary action. |
| **Catalog Ops legacy data wipe** | A one-shot cleanup gated by SQLite `PRAGMA user_version` removes every pre-approval-flow `scrape_proposals` row plus every legacy `scrape` / `manual_sold_out` `jobs` row. The auto-apply era and a subsequent retroactive backfill had created `applied` proposals for changes the admin never reviewed — Undo on those was destructive, deleting real catalog products under the slug Devan's South Indian Coffee. Wipe runs once per database; the `backfill_prior_scrape_jobs` call is removed from `seed_initial_state` so the surprise can't reappear. `products` rows are never touched by the cleanup — the catalog stays intact, just the bookkeeping resets. |
| **Catalog Ops source-delete confirmation** | The trash icon on a `roaster_sources` row now opens a confirm modal explaining exactly what's about to happen ("drops the website from the scraper's source list — existing products from this roaster stay in the marketplace"). The earlier one-tap delete was being conflated with Undo by the admin, leading to a "deleted source dropped products" perception even though the products table was untouched. Confirmation copy spells out the catalog/source separation. |
| **Catalog Ops three-tab restructure (Phase 1+2)** | The Catalog Ops surface now splits into three sub-tabs — **ROASTERS / BEANS / MAPPING** — replacing the prior two-tab Scraper + Taste Graph layout. ROASTERS is the new admin entry point: paste a website URL → Sonnet synthesizes a profile (about_blurb / specialties / logo / hero) via `services/roaster_enricher.py` → row lands in `roaster_profiles` with `published=0` (draft) and a matching `roaster_sources` row that BEANS picks up. The grid renders 240-px portrait `RoasterCard`s sorted by `products_count` so the high-signal roasters surface first; tapping any card opens `RoasterProfileDrawer`, a hero-headed modal with inline-edit fields, a Discover-publish toggle, a re-enrich button, and a confirm-gated remove. Filter chips (All / Published / Drafts / In catalog) plus search keep 121 rows manageable. BEANS still maps to the existing scrape proposals flow; MAPPING still maps to Taste Graph — Phase 3 / 4 broaden them next. |
| **Catalog Ops product enrichment schema** | Four new columns on `products` to carry the full 13-field enriched payload going forward: `process_raw` (verbatim roaster text — no fidelity loss to the existing 5-bucket enum), `producer` (narrative-extracted name), `brew_recommendation_json` (`{ method, dose_grams, ratio, water_temp_celsius, notes }`), and `enrichment_status` (`pending` / `enriched` / `failed`) so the admin tab can flag rows where Sonnet was unavailable. `Scraper/enrich.py`'s tool schema gained `Liberica` + `Excelsa` to the bean_type enum, the three new fields, and a new cleanup rule 8 that strips redundant process suffixes from coffee names ("Gangecool Estate - Washed" → "Gangecool Estate" with the process moving into `process_raw`). |
| **Catalog Ops process-graph prep** | Two new tables — `process_addresses` (raw_string PK, canonical, is_null, source, classified_at, model_version) and `process_canonical_versions` (mirror of `sca_tree_versions`) — are seeded for Phase 4's Process Graph admin tab. Same Haiku-driven, exemplar-batched canonicalization pattern as the Taste Graph, but operating on `products.process_raw` instead of flavor notes. Lets the admin keep raw experimental-process strings ("Anaerobic Carbonic Maceration", "Lactic Fermented Natural") while still rolling up into a canonical bucket for filters. Tables wired into the registry with the same admin-only CRUD shape; UI ships in Phase 4. |
| **Catalog Ops Discover publish gate** | `roaster_profiles` gained a `published` integer flag (default 1, all 121 existing rows preserved as live in Discover). New rows added through ROASTERS-tab enrichment land at 0 and only flip when the admin explicitly toggles "Publish" in the drawer. The flag is also exposed as a registry field so future Discover-side queries can filter on it without extra SQL. Two registry subfields on `roaster_profiles` (`products_count`, `scrape_ready`) drive the card status caption ("✓ Scraper · 24 coffees" / "⊘ Unverified") without a second API call. |
| **Catalog Ops slug stability + per-product enrichment (Phase 3)** | The scrape pipeline now (a) overrides every scraped product's `roaster_slug` with the canonical slug from `roaster_profiles` (joined by `website`, with an alt-form lookup that papers over `https://x` ↔ `http://www.x` drift) — kills the Devan-style instability where two scrapes of the same roaster produced two different slugs and every coffee looked "new" the second time around — and (b) runs `enrich.py`'s Sonnet pass per product before staging the proposal, so each `scrape_proposals` row carries the full 13-field enriched payload (process_raw / producer / brew_recommendation / cleaned coffee_name / origin / varietal / bean_type / …). Enrichment failures land as `enrichment_status='failed'` rather than blocking the proposal; setup failures (no `ANTHROPIC_API_KEY`, no SDK) flip every row in the run to `enrichment_status='deferred'` and surface in the result_summary so the admin tab can render a "needs re-enrichment" affordance. `services/product_enricher.py` wraps `Scraper/enrich.py`'s `_enrich_one` + `_merge` via lazy import — the API process boots even when the scraper deps aren't installed. |
| **Catalog Ops BEANS — RoasterPicker + sources moved out** | The bulky source list that used to live at the bottom of the Scraper sub-tab is gone. BEANS now opens with a `RoasterPicker` dropdown (cream-bg input, 56-tall to balance the Run CTA next to it) listing only roasters where `scrape_ready=1`; default is "All enabled" but the admin can scope a scrape to one roaster, which the backend honors via the new `POST /api/admin/scrape/run { roaster_slug }` body. Source management (shop_url / platform / enabled) moves into Tab 1's `RoasterProfileDrawer` as a dedicated **Scrape settings** section: an Enabled pill that refuses to flip on until shop_url + platform are both set, plus inline-edit fields for both. Saves through a new `PUT /api/admin/roasters/{slug}/scrape-settings` endpoint that finds the underlying `roaster_sources` row by website match. Two more new endpoints: `POST /api/admin/products/{id}/re-enrich` for per-product Sonnet re-runs, used by the Library view in Tab 3 + a "needs re-enrichment" affordance per card. |
| **Catalog Ops design audit (Phase 5 ongoing)** | New admin files (`RoastersPanel`, `RoasterCard`, `RoasterProfileDrawer`, `RoasterPicker`, `ScraperPanel`) are token-clean — zero inline `fontSize: \d` / `"#hex"` / `rgba()` literals against a sharp grep. The lone leftover `rgba(47,122,72,0.10)` in TasteGraphPanel's `activeBadge` was retired in favor of `t.color["card.info"]` so the chip style matches the marketplace's "available" affordance language. Pre-existing literals in `MetricSeriesModal` (six font sizes), `MetricCard` (font 48), and `TractionDashboard` (font 35) are surfaced for a future tech-debt sweep — not compounded. |
| **Catalog Ops BEANS browse-tab restructure (Phase 6)** | BEANS is no longer an operational console — it now mirrors the ROASTERS sub-tab structurally: vertical `RoasterRow` list, single SlidersHorizontal filter trigger, tap any row → `/admin/roaster/{slug}`. Bean-context filter drawer carries Last enriched (radio: any / 1d / 7d / 30d / stale) + Catalog (any / has / configured-no-beans / pipeline-not-configured) + Location (multi-checkbox). Bottom collapsible "Recent enrichment runs" wraps the legacy `JobHistory` + log modal + undo confirm — mirrors the "Recently deleted" pattern on ROASTERS so operational diagnostics live below the browse surface, not on top of it. Per-roaster work moves to the roaster page's new **Coffees** section: header carries the "Run enrichment" CTA + a configuration card (Shop URL · Platform · Enabled pill) lifted from the prior BEANS scrape-config block, status line ("23 coffees in catalog · enriched 2h ago"), and a `<JobProposalsCarousel />` mounted whenever the latest enrichment run for this roaster has pending proposals. The carousel + `BeanDetailModal` (long-press detail surface) were extracted into their own files (`crema-app/src/components/admin/JobProposalsCarousel.tsx`, `BeanDetailModal.tsx`) so both BEANS-tab job-history rows and the roaster page mount the same component. `RoasterPicker.tsx` deleted — its filter logic absorbed into the new BEANS panel. UI rename pass: "Scrape" / "scraping" → "Enrichment" / "Enrich" / "enriching" throughout the admin surface (jobLabel returns "Enrichment", section header "Recent enrichment runs", roaster-page CTA "Run enrichment", per-job summary "X fetched · Y new · …", accessibility labels "Enable enrichment" / "Disable enrichment"). Backend schema names (`scrape_runner`, `scrape_proposals`, `/admin/scrape/*` URLs) deliberately unchanged. Polling on the roaster page hits the registry-driven `/jobs/{id}` for single-row reads instead of refetching the whole `/jobs` list. |
| **Catalog Ops website normalization (Phase 6 follow-up)** | One-shot URL canonicalization across `roaster_profiles.website` + `roaster_sources.website` so the form drift that fragmented otherwise-identical roasters stops silently breaking the registry-driven join. New `services/catalog_ops.py:normalize_roaster_websites` helper picks one canonical form per URL (lowercase host, force `https://`, strip leading `www.`, strip a single trailing `/`), updates both tables, and auto-merges `roaster_sources` rows that collide on the canonical form (winner = most-populated row by platform + shop_url + last_scraped_at). Profile collisions surface to stdout for manual admin merge — there's no UNIQUE constraint on profile.website so the migration leaves duplicates alone. `preview_website_normalization` is a paired read-only auditor for safe previewing before the migration runs. PRAGMA user_version=2 gates the migration; it ran on 2026-04-28 and normalized 71 of 95 profile rows + 67 of 122 source rows, plus auto-merged 16 duplicate sources (122 → 106). Two profile collisions remain for manual merge: `cafehandcrafted.com` (two slug variants) and `kruticoffee.com` (two slug variants). |
| **Catalog Ops Roasters & Beans tab merge (Phase 6 follow-up)** | The BEANS sub-tab was deleted entirely — its filter logic + recent-runs collapsible folded into ROASTERS, which renamed to "Roasters & Beans". Reasoning: with the per-roaster Coffees section on `/admin/roaster/[slug]` doing all the bean-pipeline work, the BEANS browse surface was just a different lens for the same roaster set, and the parallel sub-tab carried twice the navigation surface for the same outcome. The merged tab now hosts: enrichment hero (URL → Sonnet profile), filter drawer with all three lenses (Lifecycle + Last enriched + Location) in a single SlidePanel, RoasterRow list, Recently deleted collapsible, Recent enrichment runs collapsible. `ScraperPanel.tsx` deleted; the helpers it exported (`JobHistory`, `JobLogModal`, `RecentEnrichmentRuns`, `parseResult`, `formatRelative`) moved to `crema-app/src/components/admin/JobHistory.tsx` so TasteGraphPanel + RoastersPanel share one operational-diagnostics module. `CatalogOps.tsx` now renders only ROASTERS & BEANS + MAPPING. |
| **Bean enricher: Haiku + per-roaster site prompt hint (Phase 6)** | Two paired changes that drop enrichment cost ~10× while preserving (and over time, improving) extraction quality. **(1)** `Scraper/enrich.py` model swapped from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001` for the per-product extraction call. With the layered context already in place (URL + variants + page text + tags + listing description), Haiku lands the structured schema cleanly — a 50-product run drops from ~$5-7 on Sonnet to ~$0.30-0.50 on Haiku. **(2)** New `services/site_prompt_generator.py` runs ONE Sonnet meta-call per roaster after the first per-roaster Haiku run completes. It samples 3-5 products from the run (biased toward extraction-completeness, with one sparse sample so failure modes get captured too), passes their page-text excerpts (capped at 1500 chars each) + extracted-fields summaries (one-line `key=value` pairs, not JSON dumps) to Sonnet, and asks for a 1-2 paragraph addendum to the extraction system prompt that captures THIS roaster's quirks (units, where info is buried, naming conventions, fields that are unreliable). The addendum is stored in `roaster_profiles.enrichment_prompt_hint`; subsequent runs prepend it to Haiku's system prompt for free past-experience. Token-efficient by design: ~8K input + 150 output Sonnet tokens per generation, prompt-cached system block, ~$0.03/run. **Failure mode:** any meta-call hiccup leaves the hint untouched and the next run retries — per-product extraction is unaffected. **Surfaced to admin:** new collapsible "Site enrichment hint" panel inside the Coffees section on the roaster page shows the cached addendum verbatim, with a sticky "Regenerate site hint on next run" checkbox that's auto-cleared once the run kicks off. **Backend wiring:** `POST /admin/scrape/run` accepts `regenerate_prompt: bool` alongside the existing `roaster_slug`; `catalog_ops.run_scrape_job` and `scrape_runner.stage_scrape_proposals` thread both through. The runner pre-loads `{slug → hint}` once at the top of the scrape so the per-product loop is O(n) lookup. The runner's result_summary now carries `site_prompt_status` (`generated` / `cached` / `regenerated` / `no_pattern` / `failed` / `skipped`) so the admin tab can surface "what happened to the hint this run". |
| **Discover ↔ Catalog 1:1 + long-press detail sheet (Phase 6)** | Two changes that close the loop between the admin Catalog Ops surface and the consumer Discover tab. **(1)** Discover ROASTERS now reads `roaster_profiles` (filtered to `published=1`) directly via `useResource`, instead of deriving the list from distinct `products.roaster_slug` values via `useCoffeeData`. The prior products-derived approach hid every freshly-enriched roaster until at least one bean was scraped + approved — even though the roaster identity (logo / about / city / specialties) was already live. Now an admin enrichment of a roaster's bio shows up in Discover the next time the consumer focuses the tab. Image fallback chain: `logo_url` → `hero_image_url` → first product image → empty placeholder. Sort is `products_count DESC` then alphabetical, so well-stocked roasters surface first but identity-only roasters still appear. **(2)** `useFocusEffect` on both BrowsePage (refetches `products` via the existing `fetchProducts` callback exposed from `useCoffeeData`) and RoastersList (refetches the `roaster_profiles` resource) — admin approvals land in the consumer cache without an app reload. **(3)** Long-press on any CoffeeCard on Discover BEANS or on the consumer roaster page (`app/roaster/[slug].tsx`) opens a new `<CoffeeDetailSheet />` showing every enriched field with prettified labels — sectioned as "About this coffee" (`roaster_blurb`) → "Origin" (estate / region / altitude / producer / varietal / bean type) → "Roast & process" (verbatim term + canonical bucket + `process_raw`) → "Brew guide" (parsed `brew_recommendation_json` — method / dose / ratio / temp / notes) → "Tasting" (prose + flavor chips) → "Pack" (weight + price). Empty sections collapse silently; the long-press never feels broken. Wired identically in `CoffeeList` (Discover BEANS) and `CoffeeGrid` (consumer roaster page). Sheet uses the same concrete-height fix the admin BeanDetailModal got (`height: window.height * 0.78` + ScrollView `minHeight: 0`) so the body never collapses on iOS. |
| **Combined REFRESH ROASTER button + admin page restructure (Phase 6)** | One button on `/admin/roaster/[slug]` runs bio enrichment AND catalog scrape in a single click. Backend: `POST /admin/roasters/{slug}/refresh-all` in `routes/specific.py` (sync orchestrator — Sonnet bio enrich → DB upsert → enqueue scrape job; returns the canonical profile + job_id). `services/catalog_ops.recover_orphan_jobs` flips uvicorn-killed `running` jobs back to `failed` on boot so re-enqueue can't 409 forever after an autoreload. The admin page restructured around the CTA: a new **Sources** cluster pinned right under the Refresh button carries Website + Shop URL (the two URLs the workflow reads from), so the cause-effect of "edit URL → refresh" is one visual block. The **Site enrichment hint** card moved above About so the cached Haiku prompt addendum and its freshness ("updated 2d ago" via the new `enrichment_prompt_hint_updated_at` column) are visible on every roaster page, not gated on having catalog activity. **Filter flip:** the "Last enriched" filter on the Roasters & Beans tab (`crema-app/src/components/admin/RoastersPanel.tsx`) was inverted from freshness ("Within last 24h / 7d / 30d") to staleness ("Older than 24h / 7d / 30d, or never") so the admin uses it to find catalogs that need attention, which is the actual workflow. **SSE streaming experiment reverted:** an earlier pass shipped `/admin/roasters/{slug}/refresh-stream` + `enrich_roaster_from_url_stream` + an `expo/fetch`-routed `apiStream` consumer that piped Sonnet's `input_json_delta` chunks straight into the form. Working in isolation but the wrong shape for the workflow — most of the value was the catalog scrape (which can't stream) and the bio cascade was a 5–10 s novelty that didn't justify the SSE machinery. Backend endpoint, generator, frontend SSE consumer, partial-JSON helpers, and `expo/fetch` wiring all removed; the page now uses the same simple POST against `/refresh-all` that the rest of the admin uses. |
| **Bean enricher rewrite — layered Sonnet context (Phase 6)** | `Scraper/enrich.py` rewritten end-to-end after the prior pipeline let a barista-workshop product land in proposals with zero enrichment because it only saw the listing-endpoint title + 80-char marketing description and had no context to reject the non-bean. The new `_enrich_one` builds a layered context per call: PRODUCT TITLE + PRODUCT URL (slug like `/products/barista-workshop` is a strong is_coffee_bean=false signal) + VARIANTS table (sizes + prices — single flat-price variants are rarely beans; bean SKUs almost always have weight options) + TAGS + LISTING DESCRIPTION + PAGE TEXT (live `requests.get` of the product detail URL, BeautifulSoup-stripped of nav/footer/scripts, capped at 12 KB). Page fetch is unconditional — most roasters' listing endpoints surface marketing-only copy; the detail page is where the sourcing story / altitude / varietal / brew guide actually live. Verified on Coffeeverse's RC-7 Naturals: extracts to 1.6 KB of clean text including "Ratnagiri Estate", "Hemavathi varietal", "4450 feet" altitude, "60-hour anaerobic fermentation" process, "Red Apple / Dried Pineapple / Cran-Grape" tasting prose. Schema additions: `weight_grams` (LLM extracts when scraper missed it; converts kg/oz/gms with rules), `roast_level_name` (verbatim roaster term — Vienna / Full City+ / Espresso roast — alongside the bucketed `roast_level` enum), `roaster_blurb` (1-2 sentence third-person narrative about THIS bean — sourcing story, processing technique, what makes it distinctive — same voice treatment as the roaster-level `about_blurb`, distinct from tasting notes). Schema removal: `process` enum dropped entirely; only `process_raw` (verbatim) survives — process canonicalization is the MAPPING tab's Process Graph job (BUILD_ROADMAP §1.5 row 119). System prompt rewritten with explicit is_coffee_bean signal taxonomy (URL slug patterns, variant-shape heuristics, page-text positives/negatives) and the layered-context hierarchy ("PAGE TEXT — RICHEST SOURCE, lean on it"). DB columns `roast_level_name` + `roaster_blurb` added to `products`; registry surfaces them; TS `Product` interface updated. `scrape_runner._product_lite_from_scraped`, `_product_lite_from_row`, `_exec_insert`, `_exec_update`, `PRODUCT_LITE_COLS` all extended so the new fields persist when the admin approves a proposal. |
| **Catalog Ops Articles sub-tab + article scraper pipeline** | New third sub-tab on Catalog Ops alongside Roasters & Beans + Standardization — feeds the consumer Discover JOURNAL surface (§1.2). **Schema:** `roaster_articles` (id, roaster_slug, url UNIQUE, title, excerpt, image_url, body_html, word_count, published_at, scraped_at, published, enrichment_status). `roaster_sources` gains discovery-state cache columns (`articles_index_url`, `articles_feed_kind`, `articles_handles` JSON, `last_articles_scraped_at`, `articles_count`) so subsequent runs skip the discovery enumeration. **Scraper** (`services/article_scraper.py`): platform-aware discovery — Shopify path (`/sitemap.xml` → `sitemap_blogs_*.xml` → enumerate handles → `/blogs/<handle>.atom`), WordPress (`/feed/`, NOT `/blog/feed/` which is the comments-feed trap), generic (`/feed`, `/rss`, `/atom.xml`), HTML index fallback (`/blog`, `/journal`, `/articles`). Atom + RSS parsed with stdlib `xml.etree.ElementTree`; HTML body extraction with bs4 + html.parser using selector chain `<article>` → `.article-template__content` → `.rte` → `.entry-content` → `<main>`, stripping nav/header/footer/script/style. og: metadata for title/excerpt/image/published_at. No `trafilatura` or `markdownify` introduced; no `lxml`. **Job runner:** `run_article_scrape_job` in `catalog_ops.py` mirrors `run_scrape_job` (mark_running → per-source loop → mark_finished). Per-row commits in `upsert_article` keep the SQLite writer-lock window short — same DB-lock discipline as `scrape_runner._insert_proposal`. New `kind='article_scrape'` in `jobs`. **Endpoints** (`routes/specific.py`): public `GET /articles?limit=&before=&roaster_slug=`, `GET /articles/{id}` (the only path that returns `body_html`), `GET /roasters/{slug}/articles`. All gate on `roaster_articles.published=1 AND roaster_profiles.published=1` so unreviewed roasters' articles never leak. Admin: `POST /admin/articles/scrape-all` (bulk), `POST /admin/roasters/{slug}/scrape-articles` (per-roaster), `GET /admin/articles` (panel list, includes hidden), `POST /admin/articles/{id}/publish`, `DELETE /admin/articles/{id}`. **Admin UI** (`crema-app/src/components/admin/ArticlesPanel.tsx`): hero "Refresh ALL article feeds" CTA + per-roaster row list (logo, name, articles count, last-scraped relative time, feed kind, per-row Refresh button) + `RecentEnrichmentRuns` scoped to `article_scrape`. The widget gained `kinds` + `title` props so the same component can surface journal runs without a parallel copy; `JobHistory.jobLabel` + `summarizeJob` recognize `article_scrape` ("12 roasters · +47 new · ~3 updated · 2 discoveries · 1 error"). | `Community/coffee-community-api/database.py`, `Community/coffee-community-api/services/article_scraper.py`, `Community/coffee-community-api/services/catalog_ops.py`, `Community/coffee-community-api/routes/specific.py`, `crema-app/src/components/admin/ArticlesPanel.tsx`, `crema-app/src/components/admin/CatalogOps.tsx`, `crema-app/src/components/admin/JobHistory.tsx` |

### 1.6 Design system

- **Fonts:** CanelaText_Regular (display), Inter 400/500/600/700 (body)
- **Colors:** 25+ named tokens (bg, card.front/back/info, text.primary/secondary/muted/on-dark, accent, accent.cta, border, divider, overlay, etc.)
- **Light + dark themes:** `design-tokens.json` carries sibling `color.light` / `color.dark` trees + per-mode `shadow` variants. `useTokens.ts` exposes a mutable `t` that is rebound on theme change, plus a `useTheme()` hook (built on `useSyncExternalStore`) and a `makeStyles((t) => ({...}))` factory that rebuilds its sheet on theme change (closure-cell rebinding — RN can freeze `StyleSheet.create` results, so in-place mutation is unsafe). The active mode is initialised synchronously at module load via `Appearance.getColorScheme()` so the first paint already uses the right snapshot — no light-token flash on dark-mode launches. `ThemeProvider` (mounted in `app/_layout.tsx`) hydrates a SecureStore override (`crema.theme.override`) and reconciles with `useColorScheme()`, then calls `setMode()` from `useEffect` (calling it during render trips React's setState-in-render guard since the swap notifies subscribers). User toggle lives in the Account slide panel (hamburger) as a single cycling row: System → Light → Dark → System. Dark palette: Deep Brown `#351101` page bg, slightly elevated card surfaces (`card.front` `#2C1810`, `card.subtle` `#4A2A1A` for the article-share / reposted-post inner card overlay), Crema White text. Files touched: `crema-app/src/tokens/{design-tokens.json,useTokens.ts,ThemeProvider.tsx}`, `crema-app/src/components/ProfileDropdown.tsx`, `crema-app/app/_layout.tsx`, plus `makeStyles` migration across ~70 screens + components and a follow-up sweep that token-ised remaining hex literals in feed surfaces (`PostCard`, `MessagesDropdown`, `NotificationsDropdown`, `SearchDropdown`, `ComposePost`, `Navbar`, `CoffeeCard`/`CoffeeLabel`/`CoffeeList`, etc.). Open follow-ups: a `text.danger` token for the few remaining error-state hexes (`#B84A4A`, `#A33`); audit of admin surfaces (`CatalogOps`, `TractionDashboard` body) and OAuth/auth screens; and the white-cards-on-dark pattern from Figma 740-753 (would need a contextual `text.on-light` token + per-component migration).
- **Components:** CoffeeCard, CoffeeLabel, PostCard, ActionBar, CommentThread, CroppedAvatar, Toggle — all token-driven, no inline hex
- **Circular buttons:** FAB (52×52), admin refresh (44×44), scanner stamp (56×56), repost (44×44), carousel nav (36×36) — all dark primary fill + cream icon + soft shadow
- **Floating modals:** PostModal, InfoModal, PostPromptModal, AuthModal, SeasonalPicker, RewardPicker, ScannerModal — all use overlayWrap + backdrop blur + card pattern
- **Delete buttons:** cream circle (card.info) + dark primary trash icon — consistent across coffee cards, bean cards, loyalty disable

### 1.7 Seeded data

- **121 roasters** from scraped catalog + roaster profiles
- **521 products** in unified products table
- **Admin account:** username `crema`, password `crema`, is_admin=1

---

## 2. What to build next

Ordered by the Phase 1 roadmap in `NORTH_STAR.md`. Each item references
the relevant section there. For deployment/infra prerequisites see
`LAUNCH_TODO.md`.

The mobile readiness block (§2.31–§2.40) shipped in earlier sessions.
Remaining post-pivot work: §2.37 hit-slop second wave, §2.39 EAS,
§2.41 recommender, §2.40.8 DM archive backend.

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

### 2.40 Mobile — sessions 1+2+3+4 (branch `feat/mobile-readiness`)

Session 1 shipped the foundation: `useBreakpoint` primitive, a centered-Crema `MobileHeader` (per Figma 63:4710), Home/Discover/Messages/Profile bottom tabs with the profile-avatar icon, a sticky `MobileFooter` rendered at the root layout so it persists across every mobile screen (except /auth), `SiteHeader` wired into the detail pages (user / cafe / roaster), and real content ported into Search / Messages / Notifications / Account via a `fullScreen` prop on the existing dropdowns. Expo Go now reaches the backend (LAN-IP resolution via `expo-constants`) and keychain reads no longer crash (AFTER_FIRST_UNLOCK). A cross-platform `emit` / `listen` event bus (`src/utils/events.ts`) fixed Comment / Repost on native. The followers modal no longer "follows everyone" (backend `/followers` now returns `user_id`) and long names truncate at 25 chars. `SwipeableRow` lands in the Messages inbox — WhatsApp-style swipe on native, right-click / double-tap on web, with three actions (Archive wired to the existing wholesale-inquiry endpoint; Mute + Delete stub with "Coming soon"). The design-language directive ("every new UI runs the token-only checklist + mirrors the nearest existing screen") is now canonical in `CRUD_UTOPIA.md` and persistent cross-session memory.

Session 2 shipped the chrome-preserving overlay architecture. Every modal / dropdown / panel that used to cover MobileHeader + MobileFooter now sits in the mid-band between them. Key files:

- **`SlidePanel`** (`src/components/mobile/SlidePanel.tsx`) — shared animation primitive (side: left | right | bottom, springs in, backdrop on the sliver, Android hardware back closes, translucent `overlay.panel` token).
- **`MobileOverlays`** (`src/components/mobile/MobileOverlays.tsx`) — root-layout host for Search / Notifications / Account panels. Positioned `top: insets.top + 48, bottom: 0` inside a new relative wrapper in `app/_layout.tsx`, so the slide panels cover only the band between SiteHeader (48 + top inset) and MobileFooter (71 + bottom inset). MobileHeader now emits `crema:toggle-<panel>-panel` events instead of `router.push`; re-tapping the same icon closes.
- **`GlobalPostModal` / `GlobalPopularityModal` / `GlobalComposePost`** (inside `app/_layout.tsx`) — single sitewide mounts, each listening for an `emit` event. On mobile they render as absolute-positioned views in the same mid-band as the slide panels; on web wide they keep the centered RN `<Modal>` card. `openPostModal` / `openPopularityModal` / `openComposePost` helpers in `src/components/primitives/index.ts`. `AuthModal` got the same treatment.
- **`FilterDrawer`** (inline in `app/(tabs)/browse.tsx`, uses the shared SlidePanel) — right-slide 88% with Sort By / Roast / Roasters / Process / Wholesale sections + Reset (counted) + Apply footer.
- **Discover grid redesign** — Roasters + Cafés tabs on `/browse` now render as image-top + name-bottom cards (`BrowseCard`) matching CoffeeCard's 240-wide geometry, replacing the old horizontal rows. Search placeholder harmonized to "Search" across all three tabs.
- **Auth + edit-profile fixes**: AuthGate now respects `?addAccount=1` (§2.40.4 race gone). Profile Discard explicitly resets every edit field before flipping `isEditing=false` and routes the URL cleanup through `router.replace` so Expo Router's cached param doesn't linger (§2.40.5). ProfileDropdown's Edit delay bumped from 100ms → 280ms so the slide-panel exit animation fully plays before the edit banner animates in.
- **Shared composer**: Profile FAB + Home FAB + all post-edit paths now go through `openComposePost`. Consumers pass `endpoint` + `extraData` so a profile post still lands on `/roaster-posts` with `user_<id>` slug, and the sitewide GlobalComposePost fires a `refetchEventName` when it submits so the originating screen refreshes without a direct callback.

Session 3 shipped mobile chrome + feed polish:

- **Figma-matched chrome** — `MobileHeader` per Figma 63:4710 (63 tall, 131×27 Crema logo, landscape 25×16 three-bar hamburger). Browse tab bar per Figma 63:5927 (60 tall, left-aligned BEANS/ROASTERS/CAFÉS, FadersHorizontal filter icon inside the row — the pill button below the search is gone). New `navbar.mobile.height: 63` and `tabbar.mobile.height: 60` tokens; every mid-band modal reads these automatically.
- **Add-another-account cross-platform** — ProfileDropdown always emits `crema:open-auth-modal`; no more router push / AuthGate race on native. Business-track guard: login / register accept `expectedIsBusiness` and reject a mismatched account_type BEFORE any state mutates, so signing a roaster in via "For you" no longer evicts the saved user account.
- **Native multi-account persistence** — saved-accounts helpers were web-only (localStorage); now backed by an in-memory cache that hydrates from SecureStore on AuthProvider boot and persists writes fire-and-forget. Fixes the "only one of two accounts visible" bug on Expo Go.
- **Native switch-account hang** — `switchAccount` + `logout` on native emitted `crema:loading-start` but never the matching `crema:loading-end` and never navigated, leaving the NavigationLoader curtain stuck forever. Now `router.replace(entityHomeFor)` + `emit("crema:loading-end")` on native; on-exception handlers guarantee the curtain can't strand.
- **Profile tabs unified** — (tabs)/profile, user/[username], roaster/[slug], cafe/[slug] all flip to the 60-px Discover tab-bar spec on mobile. Every tab row wraps in a horizontal ScrollView so 4–5 label sets (POSTS / COFFEE SHELF / STAMP BOOK / FOLLOWING / ANALYTICS) can be swiped when they overflow a 390-px viewport.
- **PostCard X-style indent** — avatar moved to a fixed left column (45 px), everything else — name, subtitle, body, location, nested repost, gallery, action bar — indented in a right column. Fonts match X's 15/14 rhythm (name 15 semibold, subtitle + time 14 muted, body 15 regular). Nested repost shows the **full** teaser on mobile (no `numberOfLines` truncation) at the same 15-pt weight. ActionBar icons drop to 20/18/18/16 with a 14-pt count.
- **Scroll-aware chrome primitive** — `src/utils/chromeScroll.ts`. Shared `Animated.Value` (0 shown, 1 hidden); `onChromeScroll(e)` pipes a ScrollView's onScroll event into the animation with a `THRESHOLD: 8` / `TOP_ANCHOR: 40` deadzone. MobileHeader + MobileFooter interpolate the value into their animated HEIGHT (not just translateY) so the flex column reflows and the feed gains real estate when chrome hides. **Native only** — `onChromeScroll` is a no-op on `Platform.OS === "web"`, so every web viewport (including narrow web) keeps chrome sticky. Home feed is wired; the other surfaces are pending (see session 4 block below).

Session 4 shipped the remaining mobile polish items:

- **Scroll-aware chrome — sitewide (§2.40.9)** — `onChromeScroll` now pipes through every vertical ScrollView that drives a mobile screen: `(tabs)/profile`, `user/[username]`, `roaster/[slug]` (via the `ResponsiveWrapper`), `cafe/[slug]` (narrow layout), `browse` (all three sub-tabs — beans list via the `CoffeeList.onScroll` prop, roasters + cafés inline), and the full-screen Messages inbox (`MessagesDropdown`, gated on `fullScreen`). Call-sites that already ran their own handler (the `useSearchBarAutoHide` `handleScroll` on browse tabs, the "load more" pager on profile / user) wrap both handlers in one `onScroll={(e) => { onChromeScroll(e); handleScroll(e); }}` so the two concerns stay orthogonal. `scrollEventThrottle` bumped to 16 on every surface that was at 400/50 — the primitive's THRESHOLD/TOP_ANCHOR deadzone makes the extra events cheap, and chrome now responds fluidly instead of lagging behind the finger.
- **MobileFooter full-collapse residue (§2.40.10)** — the Session 3 height-animated footer left a faint cream stripe at the very end of the collapse because iOS `shadow*` and Android `elevation` bypass `overflow: "hidden"` on the clipping ancestor. Fix: interpolate a parallel `opacity` (1 until `hidden=0.8`, then linear to 0 at `hidden=1`) on the same `Animated.View`. The bar stays crisp for the active part of the animation and disappears cleanly at full hide, regardless of what the platform does with shadow compositing.
- **Feed-row swipe gestures (§2.40.11)** — new primitive `src/components/mobile/SwipeToCommit.tsx`. Commit-on-threshold (not latch-open like `SwipeableRow`): swipe-left past 96 px → `onSwipeLike()`; swipe-right past 96 px → `onSwipeComment()`. Each direction reveals a 52 × 52 `accent`-filled disc at the corresponding edge, scaling from 0.55 → 1 and fading from 0 → 1 in lockstep with finger travel so the user sees a direct mapping between drag progress and commit readiness. Row springs back to neutral on release, regardless of whether the commit fired. Native only — on web the component passes through unchanged so the ActionBar stays visible on web feed rows. `PostCard` gained a `hideActionBar` prop (true on mobile feed; PostModal + profile / roaster / cafe post lists still show it) so the bar only disappears where the swipe pattern replaces it. Feed wire-up in `app/(tabs)/index.tsx` fires the `post_likes/{id}/toggle` endpoint directly from `onSwipeLike` and `refetch()`s so the optimistic like reaches server state; `onSwipeComment` routes through the existing `openPostModal({ mode: "comment" })`.
- **Tap-to-open PostModal on mobile feed cards** — with the ActionBar hidden on mobile feed rows, the card itself becomes the affordance. `PostCard` gained an `onOpen` prop; on mobile it wraps the outer card in a `Pressable` that fires `onOpen(post)`. Nested Pressables (avatar → author, name → author, repost-inner → original, story toggle, media) claim their regions first via RN's responder system, so the outer only fires on empty space / body text. Body text's inline external-URL Pressable is dropped on mobile so the outer tap catches; article + gallery taps on mobile route to `onOpen` instead of the external URL (link is reachable inside the modal). Web wide unchanged. Wired on feed, `(tabs)/profile`, `user/[username]`, `roaster/[slug]`, `cafe/[slug]` — all pass `openPostModal({ post, mode: "view" })`.
- **CoffeeCard landscape variant (§2.33)** — mobile-only fork inside `src/components/CoffeeCard.tsx`. Web wide keeps the portrait 240 × 372 layout untouched; mobile flips to 370 × 251 per Figma 66:6267 + 66:6268 + 66:6297: 180 × 251 image left, 190 × 251 info right, matching radius on outer edges only. Every variant from the portrait button matrix carries over one-for-one — only the anchors change. Image top-left: friends badge OR add-to-shelf heart. Image top-right: heart / bin / Package. Image second-right stacked below bin: pencil. Image bottom-left: share disc (lifted off the info bottom row). Info bottom-right: cart disc. `CoffeeLabel` + `CoffeeLabelPrice` reused verbatim for the info column. Wrapper call-sites (`CoffeeList`, `roaster/[slug]` CoffeeGrid, `(tabs)/profile` + `user/[username]` shelf carousels) flip their allocated `cardHeight` to landscape aspect on mobile; carousel cards sample 340 × 230 on mobile so one card fills a 390-px viewport with a lead-in to the next on swipe.
- **Three-dots dropdown + non-owner menu (Hide / Report / Dislike)** — `PostMenu` dropdown now anchors under the three-dots button on both web (`getBoundingClientRect`) and native (`measureInWindow`); before this the native path fell back to the RN Modal's default top-left so the dropdown always opened in the screen corner. Same menu is now surfaced for *non-owner* viewers with three new items — Hide / Report / Dislike — none of which expose counts to the viewer. Backend: three new resources — `post_hides` (toggle, unique per user+post), `post_dislikes` (toggle, unique per user+post), `post_reports` (create-only, not unique so repeat reports stack). Frontend call-sites on feed / profile / user / roaster / cafe all wire `hidePost` / `dislikePost` / `confirmAndReport` from `src/utils/postMenuActions.ts`. The feed keeps a local `hiddenIds` set so Hide feels instant; the `posts` resource now exposes `hidden_by_me` + `disliked_by_me` flags so hidden posts stay hidden across refetch + reload. These rows are Phase-2 recommender-engine food — see §2.41 for the ranking work that consumes them.
- **Home-tab re-tap scrolls to top (X-style)** — `MobileFooter`'s tab-press handler checks whether the tapped tab is the active one; if so it emits `crema:rescroll-{tab}` + `showChromeNow()` instead of `router.replace`. The feed page listens for `crema:rescroll-home` and calls `scrollTo({ y: 0, animated: true })` on its ScrollView ref. Pattern extends to the other tabs when they want the same behaviour — just listen for the matching event.
- **Haptic feedback (critical flows)** — new `src/utils/haptics.ts` wraps `expo-haptics` with a web no-op. Five semantic helpers: `tap`, `select`, `commit`, `warn`, `error`. Wired into the interactions where missing feedback was being felt most: SwipeToCommit fires `select()` the instant the swipe crosses the commit threshold and `commit()` on release-past-threshold; MobileFooter tab-press fires `tap()` on navigation and `select()` on active re-tap (scroll-to-top); PostMenu three-dots opens with `tap()`, every menu item fires `tap()` (or `warn()` for Delete/Report). Sitewide sweep to every Pressable is a follow-up; the critical-flow wiring lands first because those are the touches that needed the feedback most. Swipe fluidity improved in parallel: PanResponder thresholds dropped from 12px / 3× to 10px / 2× vertical-dominance so the disc responds to the first few pixels of intent.
- **Hide-collapse with inline Undo** — instead of the hidden post vanishing from the feed, `HiddenPostRow` (new, `src/components/domain/HiddenPostRow.tsx`) renders in its slot: EyeOff icon + "Post hidden — we won't show this again." with a pink `accent` **Undo** affordance mirroring the sourcing-story "Read the full post →" toggle language. The feed keeps a `hideOverrides: Map<number, boolean>` so the viewer's intent wins over the server's `hidden_by_me` flag until they actively unhide. Undo fires `hidePost` again — since `post_hides` is a toggle, the second POST deletes the row.
- **Messages Archive tab for non-business users** — non-business viewers now see a two-tab strip (Inbox / Archive), matching the pattern business users already had. Archive is session-scoped (local `Set<${kind}:${id}>`) — the persistence backend lands with §2.40.8. Swipe-Archive on a DM row toggles between Inbox and Archive; swipe label flips to "Unarchive" when already archived.
- **Right-edge drag-to-jump scrubber on home feed (§2.40.12)** — new primitive `src/components/mobile/ScrollScrubber.tsx`. Exposes an imperative `onScroll(e)` handle so the feed's existing `onScroll` keeps its chrome + pagination wiring untouched and just pipes the event through. Thumb height scales to `max(44, trackHeight × viewport/content)` so long feeds stay grabbable; thumb Y maps `scrollY → trackY` at `scrollEventThrottle=16` and is re-seated after every onLayout so a chrome-collapse resize doesn't misplace it. Drag uses a relative `dy` from grab-point + `scrollTo(y, animated: false)` so the feed tracks the finger without interp lag; `dragging` gate prevents the scrollTo-triggered onScroll from fighting the drag. Fade in on first scroll past `MIN_SCROLL_RANGE=600` (short feeds don't show one), fade out 900 ms after the last event; `pointerEvents` flips to `"none"` once hidden so the right-edge hit-column doesn't steal taps from the feed underneath. Haptics: `select()` on grab, `tap()` on release. Native-only — web returns `null` so desktop keeps its browser scrollbar. Home feed wired via `scrubberRef.current?.onScroll(e)` next to the existing `onChromeScroll(e)` call; profile / roaster / cafe feeds can adopt the same pattern when they prove they need it.
- **Swipe fluidity — `react-native-gesture-handler` + reanimated migration (§2)** — `SwipeToCommit` rewritten on `Gesture.Pan()` + `useSharedValue` / `useAnimatedStyle` / `withSpring`. The drag, the disc fill interpolations, and the release spring all run on the UI thread via reanimated worklets, so the row tracks the finger at 60+ fps even when JS is busy handling feed re-renders. `activeOffsetX([-10, 10])` + `failOffsetY([-12, 12])` replace the PanResponder dominance math with gesture-handler's native arbitration — cleaner and deterministic. Haptics hop back to JS via `runOnJS` (`select()` at the first threshold crossing, `commit()` on release-past-threshold). Added `GestureHandlerRootView` at the root `_layout.tsx` (inside `SafeAreaProvider`) so nested detectors mount correctly; `react-native-gesture-handler@2.28.x` pulled in via `npx expo install`. `onFinalize` re-springs to 0 so a cancelled gesture (parent ScrollView claiming responder) doesn't leave the row stuck mid-drag. Commit thresholds + visual disc behaviour unchanged — the port is a feel upgrade, not a spec change.
- **Haptic sitewide Pressable sweep — `HapticPressable` primitive (§2.40.13)** — new `src/components/primitives/HapticPressable.tsx` drop-in Pressable that fires a haptic before `onPress`. `haptic` prop picks semantic weight: `tap` (default), `select`, `commit`, `warn`, `error`, or `none`. Web no-ops because `utils/haptics.ts` already no-ops there. Swept across the high-traffic tactile surfaces the first round skipped: `ActionBar` comment / repost / share (`tap`), `Toggle` like / follow (`select`), `CommentThread` reply (`select`) + send (`commit`), `ComposePost` submit bar cancel (`tap`) + post/save/repost (`commit`), `PostModal` close / back (`tap`), `InterestedButton` pill (`select`) + modal Cancel (`tap`) + Send inquiry (`commit`) + post-send Close (`tap`), `NotificationsDropdown` Mark-all-read (`select`) + tab switches (`select`) + notification row (`tap`) + Close (`tap`), `MessagesDropdown` inbox-tab switches (`select`), `ProfileDropdown` account header (`select`) + switcher rows (`select`) + `MenuItem` central wrapper (`tap`) + Close (`tap`), home feed FAB (`tap`). Central `MenuItem` wrap means every profile menu entry (Manage / Edit / QR / Recycle bin / Sign out) gets haptics from one edit. ~18 Pressables across 9 files converted to `HapticPressable`.
- **Swipe commit-burst + profile-feed parity + Messages cutoff** — follow-ups on the above. (a) `SwipeToCommit` now plays a post-commit *burst* on the reveal disc — opacity snaps to 1 and scale pulses to 1.4 via `withTiming` on `likeBurst` / `commentBurst` shared values that interpolate alongside the drag progress, so the disc stays visually alive for ~420 ms after the row springs back. Before this the row returned to neutral immediately on commit and the user had no visual confirmation the like / comment had registered (ActionBar is hidden on mobile feed rows — the burst is now the sole confirmation beyond the haptic). (b) PostModal in `mode="comment"` auto-focuses the comment input via a new `CommentThread.autoFocusInput` prop (`useEffect` + 260 ms delay so the modal's open animation finishes before `inputRef.current?.focus()` fires — focusing mid-transition is a no-op on iOS). The swipe-right-to-comment path from the mobile feed now lands users on the post with the keyboard already up. (c) `SwipeableRow` (Messages inbox swipe-actions) migrated to `Gesture.Pan()` + reanimated shared values on the same pattern as `SwipeToCommit` — `savedTx` anchor on `onBegin`, clamped `onUpdate`, snap-open / snap-closed decision in `onEnd` based on travel + velocity thresholds (`FLICK=400 px/s`, `SNAP=40 px`). `onFinalize` safety-net springs back to the last committed open state. Web path unchanged (context menu on right-click / double-click). (d) Own-profile (`(tabs)/profile`) and other-user profile (`user/[username]`) post feeds now mirror the home-feed mobile behavior: `hideActionBar={isMobile}`, outer-card tap routes to `openPostModal({ post, mode: "view" })`, and each card is wrapped in `SwipeToCommit` on mobile firing `/post_likes/{id}/toggle` + `loadData()` on swipe-left and `openPostModal({ post, mode: "comment" })` on swipe-right — identical contract. (e) PostModal mobile-open now calls `showChromeNow()` + `scrollRef.current.scrollTo({ y: 0 })` so the mid-band modal aligns flush with the MobileHeader (the prior post above the tapped one was visible through a gap when chrome was mid-collapse, and the inner scroll could leak a leaked y-offset from a previous open). (f) Full-screen Messages tab's thread list had a 380 px `maxHeight` cap on its ScrollView inherited from the floating-dropdown preset — the 5th thread onwards was cut off behind the MobileFooter. Added `listFullScreen: { flex: 1, maxHeight: undefined }` + a `contentContainerStyle` paddingBottom (`t.spacing["4xl"]`) override gated on `fullScreen` so the list now flexes into the full mid-band and the final row stays tappable at rest.
- **Sitewide action-confirmation Toast** — new `src/components/shell/Toast.tsx` + `showToast(message)` helper, mounted once at root `_layout.tsx` as a sibling OUTSIDE the relative wrapper so it anchors screen-absolute and paints above any mid-band modal. Slides down from `translateY = -72` to `0` over 220 ms, dwells 1400 ms, slides back up — a single in-flight toast at a time; a new one replaces the existing animation mid-flight so the pill never stacks. Anchors below the visible header band: `insets.top + navbar.mobile.height + 8` on native, `navbar.height + 12` on web wide. `accent` pink pill + `text.on-dark` cream text + `t.font["body.semibold"]` at `font.md`, pill radius `radius.full`. Haptic-free by design — it's the *visual* confirmation that pairs with the haptic on commit. Wired sites: swipe-to-like on feed / own profile / other-user profile fires `"Liked"` / `"Unliked"` based on the `toggled` field in the `/post_likes/{id}/toggle` response; `ActionBar`'s tap-to-like on web wide routes through a new `onToggled(nowToggled)` callback on `Toggle` + `useToggle` (propagates the server-confirmed state) firing the same copy; `CommentThread.handleSubmit` fires `"Commented"` or `"Replied"` depending on `replyTo`; `PostModal.handleRepostSubmit` fires `"Reposted"`. Errors go through the existing surfaces — Toast is success-only.
- **§2.35 Café menu card-stack on narrow screens** — `app/cafe/[slug].tsx` menu now branches on `useBreakpoint().isMobile`. Wide web keeps the 7-column grid (Drink · Roaster · Roast · Hot · Iced · Notes · Actions) untouched. Mobile renders a stacked card layout where each drink heads its own group (Canela-body-semibold at `font.lg`), and each bean/roaster pairing inside the group is a bordered `card.front` card with: roaster name + external-link chevron as the title row (Pressable → roaster profile), a `·`-separated meta row collapsing Roast + Hot ₹ + Iced ₹ (empty values drop out so the line stays truthful), and tasting-notes below at up to 3 lines. Owner-edit actions (Edit / Delete) pin to the right of the title row with `hitSlop={10}` and accessibilityLabel. The inline AddRoasterToDrinkRow retains its existing form UI inside a mobile-specific wrap.
- **§2.36 Gesture-handler crop pan + pinch** — new `src/components/shell/CropGestureWrap.tsx` wraps any drag-to-reposition frame with `Gesture.Pan()` (translationX/Y → percent against container dimensions) + `Gesture.Pinch()` (scale × startZoom, clamped 1–5) composed via `Gesture.Simultaneous`. Web is a passthrough — the existing DOM `onMouseDown` + `onWheel` handlers continue to drive the drag on desktop since gesture-handler on web would claim the same pointer events and double-fire. Native branches into the GestureDetector + reanimated shared values + `runOnJS` callbacks that delegate to the site's existing `setCropX` / `setCropY` / `setZoom` setters, so the pan math lives in one place now instead of being hand-rolled in 4 files. Wrapped sites: avatar on `app/(tabs)/profile.tsx`, hero + logo (×2 layouts) on `app/cafe/[slug].tsx`, hero on `app/roaster/[slug].tsx`, image frame on `src/components/domain/EditableCoffeeCard.tsx` (cropY only — no X-axis, no zoom; the wrapper accepts `onZoom: () => {}` for the no-op).
- **§2.40.3-follow-up Detail-page composers → `openComposePost`** — `app/cafe/[slug].tsx` and `app/roaster/[slug].tsx` removed their local `<Modal>` wrappers around `<ComposePost>` (the create one, plus roaster's edit-post modal), replaced with `openComposePost({ endpoint, extraData, refetchEventName, initialData, editPostId? })` calls. Cafe uses `endpoint: "/roaster-posts"` + `extraData: { cafe_slug, roaster_slug: "user_{id}" }` + `refetchEventName: "crema:cafe-posts-updated"`; roaster uses the same endpoint with `extraData: { roaster_slug }` and `"crema:roaster-posts-updated"`. Both pages listen for their refetch event to re-pull posts after the global composer submits. Local `composerOpen` / `composerPrefill` / `editingPost` / `handleEditPost` state + the `ComposePost` import deleted from both files — keeping the sitewide composer as the single render point for the compose UI (§2.40.3 proper).
- **§2.40.7 MobileFooter per-screen tab sets** — `src/components/MobileFooter.tsx` factored the 4-tab consumer nav out of the component body and added a `getTabsForPath(pathname, user)` dispatcher. Default path set keeps Home / Discover / Messages / Profile. `/cafe-pos` + `/cafe-pos/*` return a 5-tab POS nav (Scan / Orders / Stamps / Reports / Settings — QrCode, ClipboardList, Users, BarChart3, Settings icons). `/roaster-analytics` + `/roaster-analytics/*` return a 5-tab analytics nav (Overview / Orders / Leads / Audience / Settings — BarChart3, Package, MessageCircle, Users, Settings). The actual POS + analytics screens haven't landed yet; the paths are reserved here so when those screens ship they inherit the right footer automatically with no extra wiring. Adding a new per-screen nav is a single prefix guard in the dispatcher — no provider, no context.
- **§2.37 Hit-slop + a11y sweep (first wave)** — the high-traffic icon-only buttons on mobile that lacked either `hitSlop` or `accessibilityLabel` were upgraded to `hitSlop={14}` + a descriptive label: Discover's clear-search X buttons (main / roaster / cafe variants), the tag-removal X on active filters, and Profile's modal close X on the drink picker / cafe picker / followers modal (these had `hitSlop={8}` and no label — now `hitSlop={14}` and labels like `"Close drink picker"`). Also the new mobile café menu cards ship with `hitSlop={10}` on Edit/Delete and `hitSlop={6}` + "Visit {roaster}" label on the roaster link chip. Not a full sweep — the worst offenders across browse + profile first; other surfaces will batch as they surface.
- **Café menu redo — clean-line list (not card stack)** — the first §2.35 pass flipped mobile to bordered card-stack with `card.front` background; that broke the design language ("looking like the opening hours in the bio"). Rewritten to match `hoursRow`: drink-name section headers with a thin 1-px group divider, each bean as a two-line row (roaster + chevron + price right-aligned; roast + tasting notes muted below), no per-row border box, no card background. Price column collapsed to `₹Hot / ₹Iced` when both are set, single value otherwise. Rows scale proportionally with the hoursBlock's line rhythm.
- **Café + Roaster X-style hero+avatar merge (mobile)** — both detail pages flipped their narrow layout to render the hero banner at the top (shorter 168-px band), with a circular logo / roaster avatar overlapping the hero/panel seam (half on hero, half on panel) via `marginTop: -48` + a `t.color.bg` 4-px ring so it reads as a medallion on the edge. Back button extracted from the brown panel into a floating circular pill on the hero (`rgba(0,0,0,0.4)` disc). `leftPanelMobile.paddingTop: 0` so the overlap math lands exactly; `cafeName` + `roasterName` fonts dropped from 48/56.8 → 28 pt on mobile so the title doesn't dominate. Info section (bio, tags, meta, follow button) flows below the overlap. Wide web keeps the existing side-panel layout.
- **Café about-me overflow + tab alignment** — narrow café layout's Followers/Regulars meta row had no `flexWrap` so long counts pushed the regulars chip off-screen. Added `flexWrap: "wrap"` + `flexShrink: 1` on both pills with `numberOfLines={1}` truncation. Café tabs on mobile: `tabsMobileInner.paddingHorizontal` dropped from `spacing["3xl"]` (32) to `spacing["2xs"]` (4) — when nested inside `rightInner` (padH: 24) that gives a consistent 28-px left inset matching where the user-profile tabs start on the same breakpoint. Narrow-layout tabs gained the Analytics tab for owners (was hardcoded 3 tabs) and now use `TAB_LABEL[tab]` instead of inline strings.
- **Roaster tabs — spec-aligned with café + user profile** — `rightTabBar` gap:100 + paddingLeft:56 were way off from every other tab bar; normalised to gap:48 + no leftPadding. `rightTabBarMobileInner.paddingHorizontal` set to `spacing["2xl"] + spacing["2xs"]` (28 px) so "POSTS" on the roaster starts at the same column as "BIO" on the café — the previous 4-px inner padding left the roaster tabs flush to the edge while café's nested-in-rightInner structure pushed café tabs 28 px in. POSTS tab always rendered (was conditional on `allPosts.length > 0` — inconsistent with every other profile where POSTS shows unconditionally).
- **MobileHeader icon weights matched to the hamburger (mobile)** — bell + search glass were 22/24 pt with strokeWidth 1.5/1.75 against the hamburger's 25×16 landscape with 2-px bars. Normalised both icons to size 24 + strokeWidth 2 so the left/right triplet (hamburger · bell · search) reads as one weight class.
- **PostGallery split + TastingNoteCard landscape + native zero-size fix (§postmodal-redo)** — mobile gallery now splits tasting-note entries into a dedicated full-width landscape carousel (one `TastingNoteCard` per viewport at 370×251, snap-paged via `pagingEnabled` + `snapToInterval`, pagination dots + right-edge chevron when there's more than one) and keeps images in the original small-thumbnail 3-col strip (thumbnail size preserved per user direction: "keep the image size, just add carousel"). `TastingNoteCard` gained a `landscape` prop that swaps to a side-by-side layout matching `CoffeeCard`'s landscape variant — bars on the left, coffee name + by-roaster + process/roast + cart on the right, divided by a thin rule. Seeded the container width from `useWindowDimensions()` so the first paint on Expo Go isn't zero-width (the pure-onLayout path was hiding images until a scroll triggered relayout — user reported "don't see jack shit" on native). Wrapper Views inside the ScrollView now carry explicit `{ width, height }` so native doesn't collapse them to 0×0. `ImageUploadModal` preview now wraps `previewUrl` with `resolveUploadUrl(...)` before handing to `expo-image` — the endpoint returns a relative `/uploads/…` path that `Image` can't fetch without the API base. Repost inner on `PostCard` now detects `original_post.post_type === "article"` and renders the full article card (cover image + title overlay + domain) instead of shoving the cover_image_url through PostGallery as a tiny thumbnail — reposted articles now match the top-level article presentation verbatim.

What still needs doing after session 4:

| # | Item | Notes |
|---|------|-------|
| 2.37 | Hit-slop 44×44 audit + accessibilityLabel sweep | First wave shipped (browse + profile); second wave remains for detail pages + domain components. |
| 2.40.8 | DM archive / mute / delete backend | |
| 2.41 | **Recommender engine — Phase 2** | Consumes the `post_hides` / `post_dislikes` / `post_reports` tables (shipped this session) as negative signals, `post_likes` / `shelf_entries` / `click_events` / `tasting_notes` as positive signals, and scores posts for the feed. Current feed is chronological — NORTH_STAR §5 "Not optimising for scroll time" applies: no algorithmic ranking for attention, but ranking for *relevance* (suppress what you already rejected, surface what matches your taste graph) is table-stakes once the network gets denser. Scope: recommender scoring job + feed query that orders by (chronological × relevance) instead of pure chronological + admin dashboard for report moderation (currently no UI for triaging post_reports). |
| 2.39 | EAS Build + app.json polish | Last. |
| 2.32 remainder | Migrate the remaining 6 `useWindowDimensions()` call-sites to `useBreakpoint` | Parallel. |
| 2.43 | **Coffee Standardization sub-tab (Catalog Ops)** | New third sub-tab alongside Roasters & Beans + Mapping. Single full-catalog pass that curates **bean_type + location + tasting / flavor notes** — heavier than the regex-only auto-pass that lands the Discover filter chips today (`origin_region`, `varietal_canonical` populated by `services/canonicalize.py`). Same Haiku-driven exemplar pattern as the existing Taste Graph and the prepped Process Graph (`process_addresses` / `process_canonical_versions` already seeded). Plan: enrich the last remaining roasters first, then ship this sub-tab, then revisit chip-set quality for the filters added in `app/(tabs)/browse.tsx` — varietal multi-cultivar entries and estate-only origins (Ratnagiri Estate, Hoysala Estate, etc.) that the regex pass leaves null today get curated overrides here. Same columns, admin overrides win — no schema churn from the sub-tab side. |

### Open bugs — mobile session handoff

Captured from the live Expo Go run at the end of the previous
session; addressed below. Web preview is clean for all of them —
the key risks are native-only and need device verification on the
next Expo Go run.

| # | Bug | Status |
|---|-----|--------|
| M1 | **Native "simply does not work" after §postmodal-redo** | Addressed defensively in `PostGallery.tsx`: `isTastingNoteEntry` now guards against non-string entries, and `NoteSlot` wraps `JSON.parse` in a `try/catch` that returns `null` on malformed tasting-note rows (a single bad entry used to throw inside render, crashing the whole feed). Gesture-side fix lands with M7 below. Needs a device re-test to confirm the feed no longer white-screens. |
| M2 | **Header + Footer buttons dead while PostModal is open (mobile)** | Swapped `elevation: 12` for `zIndex: 40` on every mid-band modal host (`PostModal`, `GlobalComposePost`, `PopularityModal`, `AuthModal`). On Android, `elevation` opens a Material-shadow outline whose hit-test region can extend slightly past the view's declared frame, intermittently swallowing taps on sibling chrome; `zIndex` keeps the paint order without the outline quirk. iOS stacking was already JSX-order-based so behaviour there is unchanged. Device verification pending. |
| M3 | **Message button on user profile (viewed as Nada) does nothing** | Shipped. The old handler used `window.__crema_openThread` — a bridge registered only by `Navbar` (wide web). On native `Navbar` never mounts, so the call was a silent no-op. Handler now branches on `isMobile`: native / narrow web routes to `/messages` with `thread_id` + `kind` as route params, and `(tabs)/messages.tsx` reads them via `useLocalSearchParams` and passes `initialThread` into `MessagesDropdown`. Web-wide path kept the bridge. |
| M5 | **Add Image modal thumbnail — verify on native** | Verified on code path: `<Image source={{ uri: resolveUploadUrl(previewUrl) }} />` at `ImageUploadModal.tsx:172`, and `resolveUploadUrl` correctly handles absolute URLs (passes through) and relative `/uploads/…` paths (prefixes the API origin). Still needs one device trigger to confirm. |
| M6 | **Inner Pressables in cards blocked by outer Pressable wrapper on web** | Shipped. `NoteSlot` in `PostGallery` no longer wraps `TastingNoteCard` in a `Pressable` — that reverts to the pre-postmodal-redo behaviour where the inner cart button is the only actionable surface on the card. Tapping the cart now fires only `openExternal(product_url)`; the outer modal-open tap is still reachable on other card regions (body text, avatar row) via PostCard's `mobileTapToOpen` Pressable. `ImageSlot` kept its Pressable since the image IS supposed to route taps to the gallery `onPress`. |
| M7 | **Tap-to-open doesn't fire on image thumbnails (native)** | Shipped. `ImageSlot` on native is now wrapped in a `GestureDetector` running `Gesture.Tap()` via `runOnJS(onPress)()`, replacing the RN `Pressable`. This puts the tap inside gesture-handler's pipeline so it arbitrates with `SwipeToCommit`'s parent Pan at the same level: Tap wins on zero-travel release, Pan wins on >10 px horizontal travel. Deterministic, no responder race. Web path keeps the Pressable (RN Web's onClick bubbles cleanly and SwipeToCommit is a passthrough). Device verification pending. |

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
| LAUNCH_TODO.md §3.4 (expanded 2026-05-01) | Moderation + legal-docs pack — wire existing report/hide/dislike endpoints, block-user, admin queue, audit log, auth rate limit, email verification, four legal docs (Privacy / ToS / Community Guidelines / AUP). Trigger gate: opening to strangers / iOS launch. | 1-1.5 days |
| LAUNCH_TODO.md §3.5 (unparked) | Password reset · account deletion · privacy policy · data export · App Store nutrition label · contact-us widget · accessibility pass. These are Apple-required, handled on backend + legal, not product. Privacy/ToS detail lives in §3.4.7. | 2-3 days |
| LAUNCH_TODO.md Part 1 | Secrets sweep · env lockdown · Dockerfile · error boundary · docker-compose. Only matters if web F&F deploy happens before iOS. | 1 day |
| LAUNCH_TODO.md Part 2 | Fly deploy · domain · DNS · cert · smoke test. Same gate as Part 1. | ~45 min (yours) |

All unshipped items still have full detail in §2.1-2.29 below
(jump to the specific subsection for architecture / key files).

---

### 2.3 Sourcing story posts *(shipped — see §1.2 Sourcing story post type)*

Column, type, composer toggle, and expandable card render all landed.
Tagged-product + tagged-origin UI (the "tie a story to a specific
bean and producer") was not part of this checkpoint — that's additive
and lands cleanly once the next editor pass touches the composer.

### 2.5 Brew method cards *(shipped — see §1.2 Brew method cards)*

Table, registry, card component, product-page carousel, and admin
metrics all landed. A dedicated roaster-owner editor for adding
recipes via UI is deferred alongside the §2.2 product-editor
follow-up; the registry already exposes the CRUD endpoints
(`POST /api/products/{id}/brew_methods`).

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
