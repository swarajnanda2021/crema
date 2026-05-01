# Prompt for next Claude instance — Discover "Journal" tab (roaster blog ingestion)

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. Branch: `feat/mobile-readiness`
> (still active — cut a sub-branch off it if Journal ends up spanning
> several PRs).
> Don't open with a recap; pick up the task directly.

---

## Pre-flight — catch up on uncommitted work

Run `git status` first. The working tree carries the user's local
Scraper run output:

- `Scraper/input/verified_roasters_catalog.json`
- `Scraper/output/{images_manifest.json, products.json, products.xlsx, scrape_log.json}`

These are routine scraper-cycle artifacts, not session work. **Don't
auto-commit them.** Confirm with the user whether the latest run is
the canonical state worth checkpointing, or whether to leave them
uncommitted. If the user says "commit them", stage just those files
and ship a `chore(scraper): refresh catalog + product data` commit
before starting Journal work.

Verify the branch is `feat/mobile-readiness`. Recent commits
(most recent first) describe the immediate prior context:

- `bfb8e8e` filter drawer — `dimBackdrop={false}` keeps partial
  width but clears the dim/blur on the underlying app
- `e8c2d89` RoasterRow — full-width row + edge-to-edge divider
- `e00d49c` profile — `stickyHeaderIndices` corrected from `[2]`
  → `[1]` after Fabric was eliding the inactive hero slot from
  the native tree (this was THE Catalog Ops scroll bug)
- `89c8810` `router.back()` calls now guard with `canGoBack()` and
  fall back to `/profile?tab=catalog` (admin/roaster) or
  `/(tabs)/browse` (consumer roaster)
- `1d1759a` roaster chrome — back/delete buttons + hero + leftPanel
  text now use the FAB pattern + `text.on-dark` for legibility
- `ec7476a` palette standardization — line tokens collapsed to one
  tier per mode; tab labels use `text.muted`/`text.primary`;
  `accent.cta` retired as tab-underline color (was Crema pink in
  dark mode); DESIGN_LANGUAGE.md auto-loaded via CLAUDE.md
- `de07a20` `LAUNCH_TODO §3.4` expanded into the moderation +
  legal-docs workplan (parked behind the iOS-launch trigger)

---

## TL;DR

Add a third tab to Discover — **JOURNAL** — alongside BEANS and
ROASTERS. The tab surfaces blog / journal articles published by
roasters on their own sites. The existing roaster-enrichment
pipeline focuses on bio + product catalog; we now extend it to
discover, scrape, and store roaster blog articles, then render
them in a chronological feed inside Crema.

Why now (per `NORTH_STAR.md` field findings): "micro-roasters don't
want to lead with tasting notes; they want to tell the sourcing
story — the farm, the relationship, the processing". Journal is
the surface where those stories live. The feed becomes the second
discovery channel after BEANS, and a strong reason for consumers
to open Crema even when they're not shopping.

This is substantial — plan for 6-10 hours of focused work. There
are several reasonable scopes; default to **Phase 1: scraper +
storage + Discover tab + simple in-app reader**. Defer Haiku
summarization / categorization unless the user asks otherwise.

---

## Hard rules — read first

1. **Do not start dev servers from Bash or `preview_start`.** The
   user runs their own Metro on device. The PostToolUse hook will
   nag about preview servers — ignore it explicitly with a one-line
   acknowledgement and continue.
2. **Palette discipline is the dual-track refined rule** (see
   `DESIGN_LANGUAGE.md` §1, auto-loaded via CLAUDE.md). Three brand
   colors plus the light-mode functional neutrals plus exactly two
   named opaque hexes in dark mode (`#684F44` for lines, `#C7BAA5`
   for `text.muted`). No new dark-mode hexes. Re-read §1 before any
   color edit; don't trust memory.
3. **Phase-1 wireframe fidelity** (per `NORTH_STAR.md`). No animations
   beyond what's already shipped. No gold accents, alert reds,
   success greens. Article surfaces still feel native to the app.
4. **Don't reach for new colors for "tags" / "categories".**
   Crema-pink (`accent` `#D798DA`) is reserved for post-action
   icons (like, comment, share). Tags on articles, if shown, use
   the existing `tag.bg` / `tag.text` pair.
5. **`accent.cta` is NOT a tab-underline color.** The active tab
   underline on the new JOURNAL tab uses `text.primary` (matches
   BEANS / ROASTERS); the underline flips to Crema White in dark.

---

## Workstream — Journal end-to-end

The work has four mostly-independent layers. Order them so each
tier produces a working surface even if the next tier is deferred.

### Layer A — Backend data + endpoints (~2 h)

#### A.1 Schema migration

New table in `community.db` via the `_MIGRATIONS` list in
`Community/coffee-community-api/database.py` (idempotent ALTER
pattern; gate on `PRAGMA user_version`). Suggested shape — verify
naming against existing conventions before writing:

```sql
CREATE TABLE IF NOT EXISTS roaster_articles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    roaster_slug    TEXT    NOT NULL,
    url             TEXT    UNIQUE NOT NULL,           -- canonical article URL
    title           TEXT    NOT NULL,
    excerpt         TEXT,                               -- 1-2 sentence summary
    image_url       TEXT,                               -- hero image
    body_md         TEXT,                               -- cleaned markdown of full article
    word_count      INTEGER,
    published_at    TEXT,                               -- ISO from <time> / og:article:published_time / RSS
    scraped_at      TEXT    NOT NULL,                   -- when we ingested
    enrichment_status TEXT  NOT NULL DEFAULT 'pending'  -- pending | enriched | failed
);
CREATE INDEX IF NOT EXISTS idx_articles_roaster ON roaster_articles(roaster_slug);
CREATE INDEX IF NOT EXISTS idx_articles_published ON roaster_articles(published_at DESC);
```

`url UNIQUE` is the dedup key. Re-running the scraper for a roaster
should be idempotent (skip rows with matching URL).

#### A.2 Endpoints (`routes/specific.py` or a new `routes/articles.py`)

Match the existing `@router.get(...)` patterns in
`routes/specific.py`:

- `GET /articles?limit=50&before=<id>` — chronological feed
  (newest first), paginated. Joins on roaster name + logo for
  display. Public endpoint, no auth.
- `GET /roasters/{slug}/articles` — per-roaster list (used on the
  roaster page later if we add an Articles section there).
- `POST /admin/roasters/{slug}/scrape-articles` — admin trigger,
  returns 202 + job_id (mirror the
  `/admin/roasters/enrich` pattern). Background task runs the
  scraper, writes rows, sets `enrichment_status`.
- `GET /admin/jobs/{id}` already exists — reuse for polling.

Admin endpoints gate on `_require_admin` (defense-in-depth pattern
in `routes/specific.py:23-29` — `is_admin=1 AND username="crema"`).

### Layer B — Scraper (~3 h)

#### B.1 Discovery

Per-roaster article-index URL is unknown a priori. Strategy in
order of preference:

1. **RSS / Atom feed** — try `/feed`, `/feed/`, `/rss`, `/blog/feed`,
   `/journal/feed`, `/atom.xml`. Roasters on Shopify often expose
   `/blogs/news.atom`. RSS gives clean structured data (title, link,
   pubDate, description, content) — no HTML parsing needed.
2. **Sitemap** — fetch `/sitemap.xml` (and recursively any nested
   sitemap_index entries), filter URLs matching `/blog/`, `/journal/`,
   `/articles/`, `/news/`, `/stories/`.
3. **Index page scraping** — fetch `/blog`, `/journal`, `/articles`,
   etc. and extract `<a>` tags with article-shaped href patterns.

The Onboard pipeline (`services/roaster_enricher.py`, `scrape_runner.py`)
already does this kind of best-effort site discovery for product
URLs — mirror its tone. Persist the *successful* discovery method
+ root URL on the roaster row (new column `articles_index_url`,
`articles_feed_kind` `'rss'|'sitemap'|'html'`) so subsequent runs
are a single fetch.

#### B.2 Extraction

For each candidate article URL:

1. **Fetch HTML** (already-installed `requests` + `beautifulsoup4`).
2. **Pull metadata** — `<title>`, `og:image`, `og:description`,
   `<time datetime>` / `og:article:published_time`. These give the
   row's title / image / excerpt / published_at.
3. **Body extraction** — strip nav / header / footer / sidebar, keep
   the article body. Prefer:
   - `trafilatura` (Python lib, ~1 dep, very robust article
     extraction across CMS variants — used by news aggregators).
     Add to `Community/coffee-community-api/requirements.txt`.
   - Fallback: `<article>` tag heuristic + `bs4.get_text()`.
4. **Markdown conversion** — convert the cleaned HTML to markdown
   for storage in `body_md`. `markdownify` (Python) does this in
   one pass.
5. **Deduplication** — skip if URL already in `roaster_articles`.

#### B.3 Background job

Wire as `services/catalog_ops.run_article_scrape_job` mirroring
`run_roaster_enrich_job`. Same `jobs` table, same status enum,
same orphan-recovery-on-server-boot path.

The "Refresh Roaster" admin action could optionally chain
article-scrape after the bio + product scrape — confirm with user
whether to add automatic chaining or keep article scraping
on-demand.

### Layer C — Admin surface (~1 h)

Two viable patterns; default to (1) unless the user asks otherwise:

1. **Inline button on the per-roaster admin page**
   (`app/admin/roaster/[slug].tsx`). New "Refresh Articles" CTA
   under the existing Refresh Roaster combined button. Status strip
   reuses the existing `refreshPhase` UI. Article count visible in
   the hero meta line ("Last enriched 2d ago · 14 articles").
2. **New sub-tab "Articles" in CatalogOps** alongside Roasters & Beans
   and Standardization. Mass-refresh + per-roaster status. More
   chrome but easier ops at scale.

Lower-friction debug: `Refresh Articles` on the per-roaster page +
a single "Refresh ALL article feeds" button on the Catalog Ops
Roasters & Beans hero (parallel to the existing "Onboard Roaster"
URL hero).

### Layer D — Discover JOURNAL tab (~3 h)

#### D.1 Tab plumbing

`app/(tabs)/browse.tsx` currently renders BEANS / ROASTERS. Add
JOURNAL as a third tab via the existing `TabButton` pattern
(line ~947). The `activeTab` union becomes
`"beans" | "roasters" | "journal"`. Existing filter drawer +
search behavior wraps cleanly around the new tab; if Journal needs
no filters in v1, render the filter button as a no-op or hide it
when `activeTab === "journal"`.

#### D.2 ArticleCard primitive

New component `src/components/domain/ArticleCard.tsx`. Look at
`PostCard` and the Discover bean grid card for visual language.

Suggested layout (mobile-first, full-width row on phone, optional
2-col on wide):

```
┌─────────────────────────────────────────────┐
│  [hero image, 16:9, t.radius.md]            │
│                                             │
│  Title in t.font.display, t.size["font.xl"] │
│  Two lines max.                             │
│                                             │
│  [logo] Roaster Name · 12 Apr 2026 · 4 min  │
│                                             │
│  Excerpt body text two lines max...         │
└─────────────────────────────────────────────┘
```

Fonts / spacing / colors all from tokens. Identity treatment: the
small roaster logo uses `RoasterLogo` (rounded square per
`DESIGN_LANGUAGE.md` §4 — that's the canonical roaster identity
treatment). Tap routes to the article reader (Layer D.3) or
external open if reader is deferred.

#### D.3 Article reader screen

New route `app/article/[id].tsx`. Renders `body_md` via
`react-native-markdown-display` (already noted as a Phase-1 dep
for the legal docs in `LAUNCH_TODO §3.4.7` — install once and
reuse here).

Layout:
- Floating back button (use the FAB pattern from `1d1759a` —
  `text.primary` bg + `text.on-cta` icon + token shadow). Same
  `canGoBack()` guard pattern as `89c8810` — fall back to
  `/(tabs)/browse?tab=journal` if back stack is empty.
- Hero image (full-width, 16:9 or 4:3).
- Title (display font, `font.2xl` or `font.display`).
- Author block: `RoasterLogo` (small) + roaster name + published
  date + estimated reading time. Tap → `/roaster/[slug]`.
- Body — markdown rendered with the existing palette tokens
  (paragraph text uses `text.primary`, links use `accent.cta`,
  code / quote blocks pull from `card.info` etc.).
- Bottom CTA: "Read on [roaster site]" external link →
  `Linking.openURL`. Tracked as a click event via the existing
  `POST /clicks` endpoint (`source_page` = `"article"`).

If scope tight, ship the consumer JOURNAL tab with cards only and
have `onPress` open the URL externally; add the reader screen in a
follow-up. Cards still earn their keep without an in-app reader.

---

## Files to study before starting

- `Scraper/scraper/` — the existing site scraping utilities. Look
  at how it discovers product URLs and parses Shopify-flavored
  catalogs; the article-feed discovery should reuse the same
  patterns.
- `Scraper/enrich_roasters.py` — the entrypoint that drives the
  scraper from the `verified_roasters_catalog.json` input.
- `Community/coffee-community-api/services/roaster_enricher.py` —
  Sonnet-driven roaster bio enrichment. Already has a "do NOT
  link to /blog" exclusion at line 199 (when picking the
  catalog/order page); when we ADD blog support, that exclusion
  doesn't change — bio scrape still avoids the blog, the new
  article scrape *only* hits the blog.
- `Community/coffee-community-api/services/scrape_runner.py` —
  product-catalog scrape orchestration; pattern to mirror for the
  new article scraper.
- `Community/coffee-community-api/services/catalog_ops.py` —
  async-job pipeline (`run_roaster_enrich_job`, the chained
  scrape, `_apply_roaster_enrichment`). Article scrape becomes a
  new job kind `'article_scrape'` in this same path.
- `Community/coffee-community-api/database.py` — `_MIGRATIONS`
  list pattern. Migration is idempotent ALTER.
- `Community/coffee-community-api/routes/specific.py` —
  `@router.post`, `@router.get` patterns. `_require_admin`
  defense-in-depth gate at lines 23-29.
- `app/(tabs)/browse.tsx` — Discover BEANS / ROASTERS tab plumbing.
  `TabButton` (~line 947), filter drawer (~line 778),
  `useBreakpoint` for mobile vs wide layout.
- `src/components/RoasterRow.tsx` — recently fixed full-width row
  + edge-to-edge divider. Mirror this width / inset story when
  designing ArticleCard.
- `src/components/domain/PostCard.tsx` — existing feed card; the
  closest visual peer to ArticleCard.
- `src/components/admin/RoastersPanel.tsx` — admin Roasters
  surface. Onboard hero + jobs-poll pattern; mirror for
  any new article-related admin chrome.
- `DESIGN_LANGUAGE.md` (auto-loaded) — palette + typography +
  identity treatments. Pre-flight checklist must pass on any new
  surface.

---

## Open decisions to surface BEFORE drafting

These are the questions that materially shape the implementation;
ask the user before sinking time:

1. **Scraper library**: ok to add `trafilatura` + `markdownify` to
   `requirements.txt`? Both are Apache/MIT licensed, no native
   deps. Alternative is hand-rolled bs4 with site-specific
   selectors per roaster — more code, more fragile.
2. **In-app reader vs external open**: ship the article reader
   (`app/article/[id].tsx`) in v1, or just open the original URL
   in the browser? Reader is +2 h but keeps the user inside Crema.
3. **Haiku enrichment**: do we summarize / categorize articles
   with Haiku at ingest time, or store the raw extracted body
   only? Phase 1 default = no Haiku; the human roaster's prose is
   already curated content. Add categorization later if the user
   wants tag-based filtering.
4. **Admin surface placement**: per-roaster button on
   `app/admin/roaster/[slug].tsx`, or new "Articles" sub-tab in
   CatalogOps? Default is the per-roaster button.
5. **Auto-chain article scrape with Refresh Roaster**: should the
   existing "Refresh Roaster" combined button also kick off
   article scrape, or keep articles on a separate explicit
   trigger? Default = separate trigger (scrape can be slow and
   noisy; admin should opt in).
6. **Filter scope on JOURNAL tab**: filter by roaster only, or also
   by date range / reading-time? Phase-1 minimum = roaster filter
   reusing the existing filter drawer pattern.
7. **Empty state copy**: confirm the line. Default suggestion:
   "Roasters haven't started telling their story yet."

---

## Don't get distracted by

- The moderation + legal pack in `LAUNCH_TODO.md §3.4` — that
  block has a real plan now (`de07a20`) but is gated on iOS
  launch, not Journal. Don't merge concerns.
- The P3 color fidelity workstream is dead — the user diagnosed it
  as their iPhone 17 Pro's display behaviour, not a Crema bug.
  See the "P3 = WONTFIX" outcome implicit in the recent commits;
  don't reopen.
- The recent palette work (line standardization, chrome
  legibility) — these are landed. Don't refactor them while
  building Journal.
- Trying to preserve in-flight admin polling state across sub-tab
  flips on Catalog Ops — that experiment broke scroll twice
  (`a4dde97` + `e00d49c`). The async-job backend handles state
  continuity; the UI re-mounts and re-polls cleanly.

---

## Standing rules (from `CLAUDE.md` / `NORTH_STAR.md`)

- Phase-1 surface — Discover + feed + profile are the priority.
  Journal is a Phase-1 add (consumer discovery), not Phase 2.
- Token-only styling. Don't introduce hex literals. Lines use
  the single-tier `t.color.border` / `border.light` / `divider`
  (all collapsed to one value per mode).
- Identity treatment: `CroppedAvatar` for people, `RoasterLogo`
  rounded-square for roasters. Don't invent a third treatment for
  article-author display.
- Update `BUILD_ROADMAP.md` when work lands — Journal warrants its
  own §1.x entry once it ships.
- When the new feature touches the scraper architecture, update
  `specs/SCRAPER_SPEC.md` in the same change. New endpoints
  belong in `specs/COMMUNITY_SPEC.md`.
- The `DESIGN_LANGUAGE.md` pre-flight checklist applies to every
  new surface (ArticleCard, JOURNAL tab, article reader).

---

## Suggested order of attack

1. Surface the 7 open decisions above; wait for the user to
   answer before installing deps or migrating schema.
2. Layer A.1 (migration) + A.2 (endpoints) — backend skeleton.
3. Layer B.1-B.3 (scraper) — wire one roaster end-to-end as the
   smoke test (Blue Tokai's blog feed is well-formed).
4. Layer C (admin trigger) — minimal "Refresh Articles" button
   to drive the scraper for any roaster.
5. Layer D.1-D.2 (consumer JOURNAL tab + ArticleCard) —
   chronological feed, external-open on tap.
6. Layer D.3 (in-app reader) — defer to a follow-up if the user
   wants v1 to ship faster.
7. Update `BUILD_ROADMAP.md`, `specs/SCRAPER_SPEC.md`,
   `specs/COMMUNITY_SPEC.md`. Commit.

When in doubt about scope, lean toward the simpler shipping
deliverable: the consumer experience matters more than admin
polish in v1.
