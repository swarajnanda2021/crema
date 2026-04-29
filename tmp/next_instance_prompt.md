# Prompt for next Claude instance — Café removal pivot + outstanding items

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. The previous session ran
> through the BEANS-tab restructure, Haiku enricher rewrite, per-roaster
> site-prompt addendum, Discover ↔ Catalog 1:1, long-press detail
> sheets, and a stack of UX polish. Café removal is the next major
> pivot. **Read first, propose the execution plan, get user sign-off
> before deleting code.**

---

## 1. The big pivot — café removal

The user is reverting Crema to a **pure roaster-beans-users platform**.
Every café-related concept gets removed. Specifically:

- Café tab on the consumer Discover surface
- Café profile pages (consumer + admin)
- Stamps / loyalty UI (the café stamp-card system)
- Wholesale tags / wholesale-related signals (the cafe-as-wholesale-buyer flow)
- Business chat / Business notification tab (café-roaster wholesale messaging)
- Café data model: `cafe_profiles`, `cafe_menu_items`, `stamps`,
  `stamp_rewards`, `qr_tokens`, `wholesale_inquiries`, `inquiry_messages`
- Café user account type (`account_type='cafe'` value in `users`)
- Seed data: `seed_cafes.py`
- Specs / docs: `NORTH_STAR.md` café mentions, `specs/COMMUNITY_SPEC.md`,
  `BUILD_ROADMAP.md` café sections

### Inventory (already audited last session)

**Files to delete entirely (11):**
```
crema-app/app/cafe/[slug].tsx                        (3,767 LOC)
crema-app/src/hooks/useCafes.ts                      (63 LOC)
crema-app/src/hooks/useCafeResolver.ts               (40 LOC)
crema-app/src/hooks/useInquiryInbox.ts               (~50 LOC)
crema-app/src/components/StampBookList.tsx           (122 LOC)
crema-app/src/components/StampBookModal.tsx          (136 LOC)
crema-app/src/components/QRModal.tsx                 (~80 LOC)
crema-app/src/components/ScannerModal.tsx            (~70 LOC)
crema-app/src/components/InterestedButton.tsx        (~70 LOC)
Community/coffee-community-api/seed_cafes.py         (441 LOC)
Community/coffee-community-api/services/qr_tokens.py (~70 LOC)
```

**Files to modify surgically (~22):**
- Frontend: `browse.tsx` (CafeCard + tab), `profile.tsx` (favorite café
  + Stamps tab), `messages.tsx` (wholesale_inquiry branch), `_layout.tsx`
  (route), `CoffeeCard.tsx` (Package chip + wholesale modal),
  `NotificationsDropdown.tsx`, `MessagesDropdown.tsx`,
  `TractionDashboard.tsx`, `BusinessAnalytics.tsx`, `types.ts`,
  `primitives/index.ts`
- Backend: `database.py` (DROP migrations), `registry.py` (delete 7
  resources, update users + roaster_posts + products + notifications),
  `resources/crud.py` (café hook dispatch), `routes/specific.py`
  (delete 9 café endpoints), `models.py`, `services/notifications.py`
  (delete wholesale + stamp handlers), `services/business_stats.py`,
  `services/admin_stats.py`
- Docs: `NORTH_STAR.md` (café participant + roles), `BUILD_ROADMAP.md`
  (mark café phases superseded), `specs/COMMUNITY_SPEC.md`

**Total scope:** ~6,200 LOC removed, ~60-65 files touched, ~7 tables
DROPPED, ~5-8 columns dropped from existing tables. Estimated effort:
**6-7 hours** for a careful execution with verification.

### Decisions the user needs to make BEFORE deletion starts

1. **Wholesale columns on `products`** — `wholesale_available`,
   `wholesale_minimum_kg`, `wholesale_note`. Keep for any future
   roaster-roaster B2B flagging, or delete entirely? Default: **delete**
   (re-add later if needed).
2. **`favorite_cafe_slug` on `users`** — confirm full removal (no
   roasters use this currently).
3. **`menu_updated_business` notification** — does it survive when
   roasters update their catalogs (rename to `menu_updated`), or get
   deleted entirely?
4. **`account_type` enum** — drop the `'cafe'` value entirely, or keep
   the enum value but guard new registrations? Existing café user rows
   need to be NULL'd or deleted before any DROP migration.

Confirm those four before touching code.

### Pre-removal checklist

```
[ ] Get user sign-off on the four decisions above.
[ ] Back up the DB:
    cp Community/coffee-community-api/coffee_community.db \
       Community/coffee-community-api/coffee_community.db.bak
[ ] Check existing café user count:
    sqlite3 ...db "SELECT COUNT(*) FROM users WHERE account_type='cafe';"
[ ] Check active café_profiles count + dependent FKs.
[ ] Confirm uvicorn is OFF before running schema migrations
    (or accept the --reload race risk).
```

### Risk flags

- **`account_type` enum tightening** — existing café user rows will
  break queries. Backfill or delete them first.
- **Cascade deletes** — dropping `cafe_profiles` cascades to
  `cafe_menu_items`, `stamps`, `wholesale_inquiries`,
  `inquiry_messages`. Verify the cascade fires cleanly; some FK paths
  may not have ON DELETE CASCADE set.
- **CoffeeCard top-right slot** — currently shows
  heart/bin/Package depending on viewer type. Removing the Package
  chip leaves the slot for the heart only. Verify no other future
  affordance was planned for it.
- **Roaster-to-roaster DMs** — `direct_threads` / `direct_messages`
  have no café dependency. Stays.

---

## 2. Outstanding items from this session (deferred)

These shipped partially in the previous session but the user wants
them finished. Pick them up after (or interleave with) the café
removal — they touch different surfaces.

### 2a. Days-since-enriched on the roaster admin page hero

Show "Last enriched 2d ago" as a third line under the
**name + city/state** in the admin roaster page hero
(`crema-app/app/admin/roaster/[slug].tsx`). Pulls from
`source.last_scraped_at`. Falls back to "Never enriched" when null.

Trivial — small Text addition in the hero block. ~10 LOC.

### 2b. Discover BEANS — coffee count + new/sold-out filters

User wants:
- **Coffee count** under the BEANS search bar — "1,247 coffees"
- **Filter chips** for "New" (recent) and "Sold out" (`available=0`)
- Need to actually surface sold-out items in the list (currently
  the consumer Discover only shows `available=1` products)

The new filter chips go alongside the existing roast-level + process
+ roaster filters in the right-side filter drawer. Sold-out filter
needs the consumer endpoint to start returning `available=0` rows
(currently filtered out). Affected:
`crema-app/app/(tabs)/browse.tsx`, possibly the products endpoint /
useCoffeeData hook.

### 2c. Drift-tolerant profile→source lookup on the admin roaster page

The admin roaster page matches profile to source by exact
`website` string — a www./trailing-slash drift breaks the join and
the page shows "Not enriched yet" even when products are in the
catalog. Fix: lower-case + strip www. + strip trailing slash on both
sides before comparing. The backend's `_website_form_variants`
helper in `services/scrape_runner.py` is the reference.

Affected: `crema-app/app/admin/roaster/[slug].tsx` (the
`Promise.all([...]).then(([profRes, srcRes]) => ...)` block, ~5-10
LOC).

### 2d. One-shot backfill: stamp Leo Coffee + collapse duplicate source row

Leo Coffee currently has TWO source rows
(`https://leocoffee.co.in` and `https://www.leocoffee.co.in/`)
because the bio re-enrich upserted the non-canonical form
post-migration. The migration already auto-merges collisions but
this row was added after the migration ran. One-shot SQL: stamp
`last_scraped_at` on Leo's source from the last successful job, and
delete the duplicate row.

```sql
-- pseudo:
UPDATE roaster_sources
SET last_scraped_at = '2026-04-28T07:33:03Z'
WHERE website = 'https://leocoffee.co.in';

DELETE FROM roaster_sources WHERE website = 'https://www.leocoffee.co.in/';

-- Optional: re-run the URL normalization migration with PRAGMA bump
-- to clean any other drift introduced post-migration.
```

### 2e. Apply refresh dud — error surfacing already shipped

The previous session shipped error surfacing for the approve/reject
bulk handlers (`JobProposalsCarousel.tsx` — `actionError` state +
banner). Remaining: monitor whether the user actually hits errors
on the next "Apply refresh all" run. If they do, the banner will
show the error message; otherwise the dud was likely the same
silent-poll-failure pattern that affected the spinner (also
patched).

### 2f. Spinner-stuck + token-flatline on long enrichment runs

Already patched — polling has a 12-error circuit breaker (~24s) and
a 20-min hard ceiling. If a job actually hangs, the spinner now
clears and surfaces an error. If it's the same root cause as the
G-Shot / Korebi incidents (job actually finishes but Metro bundle
on the phone is stale), reload Metro on the phone after every code
push.

---

## 3. State of play (what just shipped, in this session)

**Major work landed:**

- **Bean enricher: Haiku 4.5 + per-roaster site prompt addendum**
  - `Scraper/enrich.py` swapped from Sonnet to
    `claude-haiku-4-5-20251001`. Layered context (URL + variants +
    page text + tags + listing description) per call.
  - New `services/site_prompt_generator.py` — Sonnet meta-call once
    per roaster (3-5 sample products + page text excerpt + extracted
    fields summary), generates a terse bullet-list addendum.
    Token-efficient: ~8K input + ~150 output, prompt-cached system
    block, ~$0.03/run.
  - Soft target: 3000 chars; hard backstop trim: 10000 chars
    (hidden from the model). Concise-mode framing in system prompt.
  - Hint stored in `roaster_profiles.enrichment_prompt_hint`,
    surfaced in a collapsible "Site enrichment hint" panel on the
    admin roaster page (scrollable inner ScrollView so the card
    stays compact).
  - Sticky "Regenerate site hint on next run" checkbox — auto-
    clears once the run kicks off. Backend route accepts
    `regenerate_prompt` flag; runner threads it through.

- **BEANS sub-tab merged into Roasters & Beans**
  - Old `ScraperPanel.tsx` deleted; `JobHistory.tsx` extracted
    with the operational diagnostics (recent runs collapsible, log
    modal, undo confirm). `RoastersPanel.tsx` absorbed BEANS:
    Last-enriched filter in the drawer, recent-runs collapsible at
    bottom.
  - CatalogOps now renders only `ROASTERS & BEANS` + `MAPPING`.

- **Discover ↔ Catalog 1:1**
  - Discover ROASTERS now reads `roaster_profiles` (filtered to
    `published=1`) directly, not products-derived. Identity-only
    roasters appear without beans.
  - `useFocusEffect` on browse + RoastersList — admin approvals
    propagate to Discover without an app reload.

- **Long-press detail sheets**
  - New `CoffeeDetailSheet.tsx` — consumer-friendly modal with
    grouped sections (About, Origin, Roast & process, Brew guide,
    Tasting, Pack). Wired from `CoffeeList` (Discover BEANS) and
    `CoffeeGrid` (consumer roaster page).

- **Cultivar fix in the enricher schema**
  - SLN 9 was incorrectly listed as Robusta. Fixed: SLN 9 is
    Indian Selection 9, an ARABICA hybrid (Tafarikela × Hibrido
    de Timor, CCRI 1985, leaf-rust tolerant). Schema now lists
    SLN 274 + S5B as the canonical Indian Robustas, with an
    explicit "common confusion" note on SLN 9.

- **Roaster page hero & action button reorganization**
  - Re-enrich bio button moved above the Coffees heading
    (standalone brown filled, right-aligned). Catalog enrichment
    "Run enrichment" stays in the Coffees section header.
  - Remove roaster button moved to top-right of the hero (mirror
    of back button geometry, dark overlay, white Trash2). Bottom
    action row deleted entirely.

- **Spinner + dud fixes**
  - Polling circuit breaker (12 consecutive errors / 20-min
    ceiling) on the catalog enrichment run.
  - JobProposalsCarousel now surfaces approve/reject errors via a
    pink banner; reads the backend's `{applied, skipped}` shape.

- **Display name sync (the freshest item)**
  - Bio enrichment writes `roaster_profiles.name`; previously the
    feed post header still showed `users.display_name` (the slug)
    because there was no sync.
  - New `services/notifications.py:sync_roaster_name_to_user`
    helper. Wired as `roaster_profiles.on_update` registry hook
    AND called explicitly in `/admin/roasters/enrich` (bypasses
    registry CRUD).
  - One-shot backfill ran: 6 roaster accounts updated (Blue Tokai
    `blue-tokai-coffee-roasters` → `Blue Tokai Coffee Roasters`,
    plus Nada, Grey Soul, Maverick & Farmer, Third Wave, G-Shot).

- **Stamp_sources_scraped honor per-roaster scope**
  - The previous bulk-mode behavior only stamped `enabled=1` rows;
    per-roaster runs left `last_scraped_at` NULL because the source
    rows have `enabled=0`. Now accepts an optional `roaster_slug`
    param and stamps via website-form-variant lookup
    (`_website_form_variants` helper). Already wired in
    `catalog_ops.run_scrape_job` → `stage_scrape_proposals`.

- **Backend hint backfill**
  - `roaster_profiles.enrichment_prompt_hint` column added.
    Already populated for several roasters (Leo Coffee, Korebi,
    G-Shot, etc.).

---

## 4. Recommended next-session execution order

1. **Collect the four decisions** (wholesale columns, favorite_cafe_slug,
   menu_updated_business, account_type enum) from the user.
2. **DB backup** + count café-related rows so the migration impact is
   measurable.
3. **Café removal — backend first** (delete services, update registry,
   add DROP migrations, NULL-out FK fields). Don't run migrations
   yet — let the user sign off on the SQL.
4. **Café removal — frontend** (delete files, surgical edits, route
   cleanup). Test in Expo as you go.
5. **Run migrations**. Verify table drops are clean. No orphaned FKs.
6. **Docs cleanup** — NORTH_STAR.md, BUILD_ROADMAP.md (mark phases
   superseded, don't delete history), specs/.
7. **Commit** as one or several logical chunks
   ("backend café removal", "frontend café removal", "DB migrations",
   "docs pivot").
8. **Then pick up the deferred items** from §2 above.

---

## 5. Critical files (in priority order, last session)

1. `Scraper/enrich.py` — Haiku 4.5 enricher with layered context.
2. `Community/coffee-community-api/services/site_prompt_generator.py`
   — Sonnet meta-call for per-roaster prompt addendum.
3. `Community/coffee-community-api/services/scrape_runner.py` —
   per-roaster stamping, hint loading, meta-call trigger.
4. `Community/coffee-community-api/services/notifications.py` —
   `sync_roaster_name_to_user` helper + hook.
5. `Community/coffee-community-api/resources/registry.py` — new
   `enrichment_prompt_hint` field, registry hook wiring,
   `roaster_profiles.on_update` dispatch.
6. `crema-app/app/admin/roaster/[slug].tsx` — full admin roaster page
   with Re-enrich bio + Run enrichment + site-hint panel + delete
   floating button.
7. `crema-app/src/components/admin/JobProposalsCarousel.tsx` —
   approve/reject error surfacing (banner).
8. `crema-app/src/components/admin/RoastersPanel.tsx` — merged
   Roasters & Beans surface with Last-enriched filter and
   RecentEnrichmentRuns at the bottom.
9. `crema-app/src/components/CoffeeDetailSheet.tsx` — consumer-side
   long-press detail modal.
10. `crema-app/app/(tabs)/browse.tsx` — Discover with
    profile-derived ROASTERS list + focus refetch + long-press wired
    to CoffeeDetailSheet.

---

## 6. Operational notes (unchanged from prior session)

- Backend: `cd Community/coffee-community-api && make dev`. Binds
  `--host 0.0.0.0 --port 8000 --reload`.
- Frontend: user runs `npx expo start --clear` from `crema-app/`, port
  8081. **Don't try to launch your own preview** — Metro takes
  ~14-20 s per bundle and the preview tooling times out before ready.
  Source-side diagnostics + token grep are the verification pattern.
- `ANTHROPIC_API_KEY` lives in
  `Community/coffee-community-api/.env`, loaded by `load_dotenv` in
  `main.py`. If you see a 503 with "ANTHROPIC_API_KEY is not set,"
  uvicorn needs a fresh restart (`pkill -f "uvicorn main:app"`).
- Today's date: **2026-04-29**.

---

## 7. How to start the conversation

1. Acknowledge the substantial work that just shipped (the §3 list).
2. **Confirm the four café-removal decisions** in §1 with the user
   before touching code.
3. Read the relevant files BEFORE proposing the removal plan — there
   may be edge cases the audit missed (e.g., test files, dev seeds).
4. Plan the removal in writing (file-by-file, in execution order),
   get sign-off, then execute.
5. CRUD_UTOPIA token discipline still applies: every visual value
   from `useTokens`, every API call via `apiFetchRaw` /
   `useResource`, every backend resource declared in `registry.py`.
6. **Don't break uncommitted work** — there is a substantial pile of
   uncommitted changes in the working tree (last commit was 7 days
   ago; the entire BEANS-tab merge + Haiku enricher + per-roaster
   site hint + Discover 1:1 + long-press detail sheet + cultivar fix
   sit uncommitted). Suggest committing them as one or several
   logical commits BEFORE starting the café removal so the diff for
   the removal is reviewable.

---

*End of prompt. Don't pre-build; align first.*
