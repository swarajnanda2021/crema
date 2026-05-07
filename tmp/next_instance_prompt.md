# Prompt for next Claude instance — Journals admin v2 + scrape pathology fixes

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. Branch: `feat/mobile-readiness`
> (live).
> Don't open with a recap — pick up the task.

---

## TL;DR

Make the admin **Journals** sub-tab as detailed as Roasters & Beans
+ Standardization. Fix the scraping pathologies the bulk run
surfaced (off-topic content like founder bios + spirituality
articles, broken Haiku body extraction, missing hero images, no
tags). Add per-roaster Haiku site-quirk hint (analogous to the
existing bean-enrichment hint). Make articles searchable sitewide
via Haiku-generated tags.

The bulk article scrape ran end-to-end against all 96 published
roasters and landed **173 articles across 16 roasters**. Most of
the remaining 80 roasters have no discoverable feed (Wix sites,
custom-built sites without `/feed` or `sitemap`); a few have
discoverable feeds but the content has problems we now need to
address.

---

## Decisions already locked (do NOT re-ask)

User locked these in the previous session — implement directly:

1. **Multi-select** = checkboxes on every row + sticky "Refresh N
   selected" CTA replacing the bulk hero when anything's selected.
2. **Per-roaster article curation** = inline expand of the row in
   the Journals panel (not a click-through to `/admin/roaster/[slug]`).
   The expanded card shows the site-quirk hint AND a scrollable
   list of the roaster's articles with show/hide toggle per
   article.
3. **Site-quirk hint timing** = generate after first scrape that
   returns ≥1 enriched article (NOT ≥3). Auto-trigger, no admin
   opt-in needed for the first generation.
4. **Hero image must be recovered** for every article. The current
   pipeline leaves G-Shot 2/2 + Aromas 1/9 with `image_url=NULL`.
5. **Coffee-relevance is a HARD gate**. Founder bios (Black Baza
   `/blogs/team/`) + Tibetan pulsing essays (G-Shot) + Osho commune
   posts must be filtered out — these are real articles on the
   site but topically off-brand for a coffee app.
6. **Haiku also generates `tags[]`** per article. Tags drive
   sitewide search (the navbar `<SearchDropdown />` should surface
   matching articles).
7. **Filter drawer + sort** on the Journals panel can wait — ship
   it later if needed.

---

## Symptoms confirmed in live data (concrete cases to fix)

After the bulk scrape (DB at session start):

### Pathology 1 — Off-topic content slipped through

| Roaster | Article | Why it's wrong |
|---|---|---|
| Black Baza `[26-28]` | "Radha Rangarajan", "Dr Arshiya Bose", "Dr Suri Venkatachalam" | These are **founder bio pages** at `/blogs/team/<slug>`. Discovery enumerated the `team` blog handle as if it were an article handle. Haiku's `body_html` came back as `<small class="tax-note">Taxes included…</small>` — Shopify product-page boilerplate that bled into the page text. word_count = 8 each. |
| G-Shot `[60-61]` | "What is a Commune?" / "Explanation of Tibetan Pulsing" | Real article body extraction works; topic is Osho spirituality, not coffee. |
| (likely others, audit needed) | — | — |

**Two distinct sub-bugs:**
- **Discovery overreach**: Shopify's blog-handle enumeration via
  `sitemap_blogs_*.xml` walks every handle including `team`,
  `policies`, `about`, etc. Handle filter needed.
- **Topic relevance**: Even when discovery is correct, the page
  itself can be off-topic. Haiku needs a coffee-relevance gate.

### Pathology 2 — Broken body extraction (word_count = 0 on real articles)

Black Baza `[4-5]` ("Decoding the Black Baza Bag", "Brewing
Basics") at `/blogs/brewing-guides/...` came back with
word_count = 0 and short body. These look like real articles
that the extractor failed on — the brewing-guides handle is a
known good source elsewhere.

Investigate: do those pages render their body via JS? Have an
unusual content container? Run them through `extract_for_enrichment`
manually and see what the cleaned page text contains.

### Pathology 3 — Hero image missing on some sites

Image coverage from the bulk scrape:

| Roaster | Total | NULL image_url |
|---|---|---|
| g-shot-coffee-roastery-cafe | 2 | **2** (100%) |
| aromas-of-coorg | 9 | 1 |
| devans-south-indian | 15 | 5 (33%) |
| (others) | varies | mostly 0 |

Cause: `og:image` is absent from those pages AND the current
fallback chain doesn't try in-body `<img>` tags. The cascade in
`catalog_ops.run_article_scrape_job`:

```python
external_image = (
    enriched.get("image_url")
    or extracted["og_image"]
    or fallback.get("image_url")
)
```

`fallback["image_url"]` is set only from og:image in
`_extract_html_article`. Need a real fallback to "first prominent
body `<img>`" (≥600px wide, not a logo/icon, not an external
service like Twitter/Facebook).

### Pathology 4 — Devans articles look truncated (but actually aren't)

User reported Devans articles look incomplete. Investigation:
they ARE genuinely short. Devans wraps each article around an
**infographic JPG** — the meaningful content is rendered as an
image, not as text. The full page text is ~900 chars regardless
of how long the article "looks".

Implications:
- Don't gate on `word_count >= N` alone — it'll wrongly reject
  these legit infographic-format articles.
- The reader screen + ArticleCard already render `image_url` as
  hero. The infographic IS the content. No extraction fix
  available; accept these as legit short-text-plus-image articles.
- The site-quirk hint *could* tell Haiku "Devans articles are
  often infographic-driven — preserve the body even when it
  reads as just two paragraphs surrounding an image."

### Pathology 5 — Orphan-recovery races CLI script jobs

The bulk scrape script ran as a CLI Python process while uvicorn
was also running. Uvicorn's `recover_orphan_jobs` boot pass
(see `services/catalog_ops.py:recover_orphan_jobs`) saw the
script's `running` job row and flipped it to `failed` with
"Server restarted while job was running…". The script kept
working — articles + images all wrote — but the jobs row tells
a misleading story.

Fix at the lookup-side: `recover_orphan_jobs` should be safe to
keep firing (it's the right move for actually-dead workers), but
the CLI script should mark its own job `'succeeded'` even if the
status was already flipped to `'failed'` by the boot pass — or
better, attribute jobs to a runner identity so the recovery only
flips jobs whose runner doesn't exist anymore.

This is a small follow-up; not blocking the v2 work.

---

## Workstream — staged so each layer is shippable

Order matters: fix the scrape (Layer A) **before** the admin UI
(Layer C). The new admin surface needs to render real, vetted
data; if the scrape still produces founder bios + spirituality
posts, the admin tab just becomes a triage tool.

### Layer A — Scraping pathology fixes

**A1. Discovery handle filter (Shopify only).**
In `services/article_scraper.py:_shopify_blog_handles_from_sitemap`,
filter the enumerated handles to drop obvious non-article ones:
`team`, `about`, `about-us`, `policies`, `contact`, `legal`,
`pages`, `careers`, `press`, `terms`. Add a `_NON_ARTICLE_HANDLES`
constant. Apply BEFORE returning the handle list.

This alone removes Black Baza ids 26-28.

**A2. Coffee-relevance gate in Haiku enricher.**
Extend `services/article_enricher.py`'s `_ARTICLE_TOOL` schema
with two new fields:

```jsonc
{
  "is_article": true,
  "is_about_coffee": true,        // NEW — coffee, brewing, sourcing,
                                  // origins, processing, café culture,
                                  // roasting, tasting; NOT general
                                  // wellness/spirituality/lifestyle
                                  // even if the page lives on a
                                  // coffee site
  "topic_category": "sourcing_story" | "brew_guide" | "origin_profile"
                  | "industry_news" | "harvest_report" | "tasting_notes"
                  | "company_update" | "other"  // NEW
  "tags": ["..."],                // NEW — see A3
  // ...existing fields
}
```

Update `_ARTICLE_SYSTEM` prompt to be explicit:
- "These articles surface in a coffee-discovery app called Crema.
   The audience is specialty-coffee drinkers."
- "Reject pages that aren't ABOUT coffee, even if they're hosted
   on a coffee-roaster's site — author bios, café-event recaps
   without coffee content, philosophical/spiritual essays, general
   wellness posts, founder profiles, team pages."
- "Acceptable: sourcing stories, brewing guides, origin profiles,
   harvest reports, processing techniques, café culture, roasting,
   tasting notes, industry news, company updates that mention
   beans/equipment."

In `run_article_scrape_job`:
- If `is_article=False` → skip (existing behavior)
- If `is_about_coffee=False` → write the row with `published=0`
  (NOT delete; admin can still see + un-hide if Haiku is wrong).
  Increment a new `summary["off_topic_skipped"]` counter.

**A3. Tags from Haiku.**
Add to `_ARTICLE_TOOL` schema (alongside the new gate fields above):

```jsonc
"tags": {
  "type": "array",
  "items": {"type": "string"},
  "description": "3-7 lowercase keyword tags. Examples: ['ethiopia','natural-process','pour-over','single-origin','brewing'], ['arabica','robusta','blends'], ['estate','smallholder','western-ghats']. Used for sitewide search. Avoid generic tags like 'coffee' — every article is about coffee."
}
```

Schema migration: `roaster_articles` gets `tags TEXT` (JSON
array). Index for LIKE-search. Start with simple `LIKE '%tag%'`
queries on the `tags` column treated as a JSON string; upgrade
to FTS5 only if performance demands it.

**A4. Hero image fallback to body-img.**
In `services/article_scraper.py:_extract_html_article`, add a
"first prominent body img" pass:

```python
# When og:image is absent, scan the body for a hero candidate.
if not image_url and body_node is not None:
    for img in body_node.find_all("img", src=True):
        src = urljoin(base_url, img["src"])
        # Skip data-uris, logos, tracking pixels, social-icons.
        if src.startswith("data:"): continue
        if any(skip in src.lower() for skip in
               ("logo", "icon", "favicon", "twitter.com",
                "facebook.com", "pixel", "1x1", "spacer")):
            continue
        # First reasonable img wins — Haiku will be asked to
        # confirm it's a hero downstream.
        image_url = src
        break
```

Also update `extract_for_enrichment`'s hint cascade so when og:image
is empty, Haiku gets the body-img candidate as the og:image hint
(it's the closest thing the page offers).

**A5. Word-count gate is conditional.**
Don't add a generic `word_count >= 50` gate (would reject
legit infographic articles like Devan's). Instead: the
`is_about_coffee` gate is the primary filter. As secondary
guard: if `body_html` AND `image_url` are both empty, skip
(nothing to render).

### Layer B — Per-roaster Haiku site-quirk hint

Mirrors `services/site_prompt_generator.py` (the bean-enricher
hint). Build a parallel pipeline for articles.

**B1. Schema columns on `roaster_profiles`:**
```sql
ALTER TABLE roaster_profiles
  ADD COLUMN article_enrichment_prompt_hint TEXT;
ALTER TABLE roaster_profiles
  ADD COLUMN article_enrichment_prompt_hint_updated_at TEXT;
```

**B2. New `services/article_site_prompt_generator.py`:**
Sample 3-5 enriched articles for THIS roaster (biased toward
extraction-completeness, with one sparse sample so failure modes
get captured). Pass page-text excerpts + Haiku outputs to Sonnet
with a meta-prompt that asks for a 1-2 paragraph addendum
capturing THIS roaster's quirks:
- footer noise the bs4 strip missed
- pull-quote convention
- recurring section delimiters
- stale `<img src>` URL forms (HTTP-vs-HTTPS, www-vs-bare)
- date format if non-standard
- whether infographic-driven (so Haiku doesn't reject the body)

Token budget: ~8K input + 200 output Sonnet tokens, prompt-cached
system block. ~$0.03 per generation.

**B3. Trigger location:**
End of the per-source loop in `run_article_scrape_job`, AFTER
`stamp_sources_scraped`. Conditions:
- This roaster has ≥1 enriched article (`enrichment_status='enriched'`)
- AND (`article_enrichment_prompt_hint IS NULL` OR
       `regenerate_article_hint` flag was passed in body)

**B4. enrich_article uses the hint.**
In `services/article_enricher.py:enrich_article`, accept an
optional `system_addendum` arg. If passed, prepend to
`_ARTICLE_SYSTEM`. The runner passes the cached
`roaster_profiles.article_enrichment_prompt_hint` per call.

**B5. result_summary keys:**
Add `hint_status: 'generated' | 'regenerated' | 'cached' | 'skipped' | 'failed'`.

### Layer C — Admin Journals sub-tab v2

**C1. Rename "Journal" → "Journals":**
- `crema-app/src/components/admin/CatalogOps.tsx`:
  - `SECTION_LABEL["articles"]: "ARTICLES"` → keep (label is fine)
  - `SECTION_TITLE["articles"]: "Roaster Journal"` → "Roaster Journals"
  - `SECTION_BLURB["articles"]` → wording update

**C2. Multi-select checkbox per row.**
- Add `selectedSlugs: Set<string>` state in `ArticlesPanel`.
- Each `ArticleRoasterRow` gets a leading checkbox (token-driven
  square, brand pink fill when checked, espresso outline when
  unchecked).
- Hero "Refresh ALL article feeds" CTA flips to "Refresh N
  selected" when `selectedSlugs.size > 0`. The CTA POSTs:

  ```
  POST /admin/articles/scrape-all
  body: { roaster_slugs: ["slug1", "slug2", ...], force_enrich: false }
  ```

  When the array is empty, treat as "scrape all" (existing
  behavior). When non-empty, scope.

- Backend patch: `admin_scrape_articles_all` reads
  `body.roaster_slugs?: string[]`. The runner's bulk-mode SQL
  becomes:

  ```python
  if roaster_slugs:
      placeholders = ",".join("?" * len(roaster_slugs))
      rows = db.execute(
          f"SELECT ... WHERE rp.published = 1 AND rp.roaster_slug IN ({placeholders})",
          roaster_slugs,
      ).fetchall()
  else:
      rows = db.execute("SELECT ... WHERE rp.published = 1").fetchall()
  ```

  Add `roaster_slugs?: list[str]` to `run_article_scrape_job`'s
  signature.

**C3. Inline expand per row.**
Tap a row → toggle expanded state. The expanded panel shows:
- **Site-quirk hint card** (top) — scrollable cream card with
  the Haiku addendum text. Header: "Site enrichment hint",
  "Updated 2d ago" relative time. Sticky checkbox: "Regenerate
  on next scrape" (writes a sticky flag that
  `run_article_scrape_job` reads + auto-clears after firing the
  regen).
- **Articles list** (below the hint) — each article rendered as
  a compact row: small hero thumbnail, title, scraped date,
  `enrichment_status` badge, word count, **publish toggle**,
  **delete button**, **re-enrich button**.
- Use the existing `roaster_articles.published=0` gate to mean
  "hidden from consumers but visible to admin."
- The publish toggle calls `POST /admin/articles/{id}/publish`
  (existing endpoint).

**C4. JobHistory.summarizeJob extension** for `article_scrape`:
Add the new counters from Layer A:
- `enriched`
- `enrich_failed`
- `not_article_skipped`
- `off_topic_skipped` (NEW from A2)
- `discoveries`
- `errors`

**C5. Per-row state badges** on the Articles row list:
- "✓ Coffee" — `is_about_coffee=true` enriched
- "⊘ Off-topic" — `is_about_coffee=false`, hidden by default
- "⏳ Pending enrich" — `enrichment_status='pending'`
- "⚠ Enrich failed" — `enrichment_status='failed'`

### Layer D — Sitewide search integration

`crema-app/src/components/SearchDropdown.tsx` is the universal
search surface (navbar magnifying glass on web wide, a sheet on
mobile). It currently surfaces Users / Beans / Roasters. Add an
**Articles** section:

**D1. Backend:** Extend `/api/search` (or add `/api/articles/search`
if simpler) to query `roaster_articles` by:
- `title LIKE '%{q}%'`
- `excerpt LIKE '%{q}%'`
- `tags LIKE '%{q}%'` (the JSON-as-string approach)
- Filter to `published=1 AND rp.published=1`

Cap at 8 hits like the other sections.

**D2. Frontend:** New section in `SearchDropdown` rendered
between Beans and Roasters. Each hit shows the small hero
thumbnail + title + roaster name. Tap → `/article/{id}`.

### Layer E — Optional follow-ups

- E1. Filter drawer + sort on Journals panel (mirror Roasters &
  Beans's drawer pattern). User said this can wait.
- E2. `recover_orphan_jobs` runner-identity tracking so CLI
  scripts don't get their jobs flipped to `failed`.
- E3. FTS5 virtual table for tags/title/excerpt if LIKE queries
  get slow.

---

## Files to study before starting

Backend:
- `Community/coffee-community-api/services/article_scraper.py` —
  discovery + extraction + WebP pipeline (current state)
- `Community/coffee-community-api/services/article_enricher.py` —
  Haiku call + tool schema (gets the new fields)
- `Community/coffee-community-api/services/catalog_ops.py` —
  `run_article_scrape_job` (Layer A wiring + B trigger + slug
  filter for C2)
- `Community/coffee-community-api/services/site_prompt_generator.py` —
  template for the article-site-prompt-generator
- `Community/coffee-community-api/services/roaster_enricher.py` —
  Sonnet pattern reference
- `Community/coffee-community-api/routes/specific.py` — admin
  endpoints (slug-list body field on `/admin/articles/scrape-all`)
- `Community/coffee-community-api/database.py` — `_MIGRATIONS`
  list (article_enrichment_prompt_hint columns + `tags` column)

Frontend:
- `crema-app/src/components/admin/ArticlesPanel.tsx` — current
  state (Layer C target)
- `crema-app/src/components/admin/RoastersPanel.tsx` — pattern
  reference (filter drawer, "Recently deleted" collapsible
  pattern)
- `crema-app/src/components/admin/CatalogOps.tsx` — sub-tab
  carousel + section labels (rename target)
- `crema-app/src/components/admin/JobHistory.tsx` —
  `summarizeJob` (gets the new counters)
- `crema-app/src/components/admin/JobProposalsCarousel.tsx` —
  pattern reference for in-row expansion
- `crema-app/src/components/SearchDropdown.tsx` — universal
  search (Layer D target)
- `crema-app/app/admin/roaster/[slug].tsx` — site-prompt-hint
  card pattern reference (the bean enrichment hint surface)

Inspect the data:
```bash
cd Community/coffee-community-api
python -c "
from database import get_db
db = get_db()
# Symptom samples for fix targeting
print(db.execute(
  'SELECT id, title, url, word_count FROM roaster_articles '
  'WHERE roaster_slug IN (\"black-baza-coffee\",\"g-shot-coffee-roastery-cafe\",\"devans-south-indian-coffee-and-tea-pvt-ltd\") '
  'ORDER BY roaster_slug, id'
).fetchall())
"
```

---

## Hard rules — read first

1. **Don't start dev servers.** User runs Metro on device. The
   PostToolUse hook will nag — acknowledge and continue.
2. **Token-only styling, three-color brand palette,
   `useBreakpoint` not `Platform.OS` for visual decisions.** See
   `DESIGN_LANGUAGE.md` (auto-loaded via CLAUDE.md).
3. **CoffeeCard rendering rule** (`DESIGN_LANGUAGE.md §7`) —
   don't fork, don't hardcode width/height pairs, long-press
   detail sheet is built in.
4. **Don't reach for `forceLandscape` outside admin Catalog
   Ops.** Consumer surfaces let the viewport decide.
5. **`enabled` flag is dead** — all four runtime gates were
   retired in commit `f14dcac`. Don't reintroduce a dependency
   on `roaster_sources.enabled` for any new work.
6. **Idempotent scrape** — re-running the bulk scrape with
   `force_enrich=false` should skip already-enriched articles
   cheaply (skip-cheap path is in place). Layer A changes
   should respect this.
7. **Off-topic articles set `published=0`, NOT delete** — admin
   can still see and re-publish if Haiku was wrong.
8. **Topic taxonomy is fixed**, defined in the tool schema and
   the system prompt. Don't let it drift over time without an
   intentional schema migration.

---

## Standing rules (from `CLAUDE.md` / `NORTH_STAR.md`)

- Phase-1 surface — Discover + feed + profile remain priority.
  This work falls under Discover JOURNAL refinement.
- Update `BUILD_ROADMAP.md` §1.2 (Discover JOURNAL row) and
  §1.5 (Catalog Ops Articles row) when work lands.
- Update `specs/SCRAPER_SPEC.md §13` (article scraper section)
  for the discovery filter, coffee-relevance gate, body-img
  fallback, tags.
- Update `specs/COMMUNITY_SPEC.md §19` for the new schema
  columns + endpoint shape changes.
- The `DESIGN_LANGUAGE.md` pre-flight checklist applies to
  every new admin surface.

---

## Suggested order of attack

1. **Layer A first** — coffee-relevance gate + tags +
   discovery handle filter + body-img fallback + system prompt
   rewrite. Re-run the bulk scrape with `force_enrich=true` so
   existing articles get re-evaluated. Black Baza founders
   should disappear / move to `published=0`. G-Shot spirituality
   should also flip to `published=0`. Aromas-of-coorg + G-Shot
   articles should now have hero images.
2. **Layer B** — site-quirk hint pipeline. Generate hints for
   the existing 16 roasters (one per roaster). Verify the hints
   read sensibly via the per-roaster admin page.
3. **Layer C** — admin Journals sub-tab v2 (rename, multi-select,
   inline expand with hint card + article list).
4. **Layer D** — SearchDropdown integration.
5. **Layer E** — optional follow-ups if time.
6. **Docs** — `BUILD_ROADMAP.md` + `specs/SCRAPER_SPEC.md` +
   `specs/COMMUNITY_SPEC.md`.

When work lands, update each spec in the same change rather than
deferring.

---

## Final checkpoint state (so you can verify your starting tree)

Last commit on `feat/mobile-readiness`:

```
f14dcac fix(scraper): retire enabled-flag gate, leave dead column behind
3dc7bd3 fix(journal): bulk article scrape covers ALL published roasters
ef7594e feat(brand): new launcher icon — diver-into-cup on Crema-pink
0ade9e2 fix(chrome-scroll): bail at/past bottom to suppress rubber-band reopen
9f7d094 fix(article-reader): wire onChromeScroll so header/footer auto-hide
e783049 fix(coffee-card): exact Discover dims + long-press built-in
```

Pushed to `origin/feat/mobile-readiness` at the start of this
plan.

DB state at handoff:
- 173 articles, 16 roasters with articles
- Top contributors: caarabi (35), chariot (30), black-baza (25),
  coffee-culture (18), devans (15), naivo (10), aromas-of-coorg
  (9), caffena (9), 93-degrees (7)
- 80 published roasters returned no articles (no discoverable
  feed; Wix / custom-built sites)

When in doubt about scope, lean toward the simpler shipping
deliverable: the scrape pathology fixes (Layer A) are the
highest-value piece — without them, the admin curation surface
is just triage for bad content.
