# Coffee Aggregator (Crema) — working context for Claude

This file is auto-loaded into every Claude Code session in this repo.
It pins the vision doc to every turn and tells Claude which other docs
to pull in depending on the kind of work being done.

## Always-loaded: the north star + design language

The vision anchor and the visual-language source of truth.
Both load on every turn so palette / typography / identity rules
are never stale.

@NORTH_STAR.md

@DESIGN_LANGUAGE.md

## Hard rule — palette discipline

**Before touching any color value, anywhere — re-read
[DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) §1 in full.** Do this every time.
Don't trust your memory. Don't reuse stale context.

The Crema brand identity is exactly three colors. Pulled from Figma node
[697-4663](https://www.figma.com/design/QIT6HorllZ7wbeULQ4iLAt/Crema-%E2%80%93-Initial-UI?node-id=697-4663):

- **Espresso** `#351101`
- **Crema** `#D798DA`
- **Crema White** `#FAF8F0`

Two-track rule for tonal hierarchy (refined 2026-05-01):

- **Light mode** has an established set of approved functional
  neutrals (warm browns + creams) tonally consistent with the brand —
  see `DESIGN_LANGUAGE.md` §1's "Functional neutrals — LIGHT MODE"
  table. Use those exact tokens. Don't add new ones.
- **Dark mode** splits into two opaque page-tones plus two named
  hexes for lines and muted text:
  - `#2a0d00` is the **page body** in dark mode — `bg`, `card.front`,
    `card.back`, `card.info`, `card.subtle`, and `roaster.panel` all
    resolve to it. Same hex as the light-mode roaster bio panel.
  - `#351101` (Espresso, brand color) is the **chrome** —
    `navbar.bg`, `nav.mobile.bar.bg`, `roaster.hero.fallback`. Chrome
    floats as a distinct strip above the slightly-darker `#2a0d00`
    page body.
  - `#684F44` is for **all line elements** (`border`, `border.light`,
    `divider` — collapsed to one tier).
  - `#C7BAA5` is for `text.muted` (inactive tab labels, timestamps,
    hint text).

  Beyond those four named values, dark-mode tonal hierarchy is still
  `rgba(...)` opacity variants of brand colors only.
  *(Refined 2026-05-01 in three passes: first lines + muted text got
  named warm-brown hexes; then the roaster bio panel got `#2a0d00`
  to preserve its identity band in dark mode; then the same `#2a0d00`
  was extended to the page body so the Espresso chrome reads as
  distinct chrome instead of melting into the body.)*
- **Line tokens are a single tier per mode.** `border`, `border.light`,
  and `divider` all resolve to the same value (`#D7D1C4` light /
  `#684F44` dark). There's no hairline / divider / separator
  alternative anymore — collapsed 2026-05-01.
- **Active-tab underlines use `text.primary`**, never `accent.cta`
  (which flips to Crema pink in dark mode and mis-reads). `accent` /
  Crema pink is reserved for post-action icons (like, comment, share).

In both modes, any token, any inline style, any new component must
resolve to one of: a brand color, an approved light-mode neutral, a
dark-mode named opaque (`#2a0d00` page body + bio panel, `#351101`
chrome, `#684F44` lines, `#C7BAA5` muted text), an `rgba(...)` opacity
variant of a brand color, or pure `#000000` / `#FFFFFF` for
unavoidable shadow/highlight defaults.

**Don't invent new colors.** No "slightly lighter" or "slightly
darker" shade for elevation. No reaching for golds, alert reds,
success greens, or in-between tones you've seen in prior versions of
this codebase. If a surface needs visual separation from the page,
either use an existing approved neutral (light mode) or an rgba
opacity variant of a brand color (dark mode) — never a new hex.

If a request seems to require a fourth color (alert red, success green,
gold accent, neutral grey), surface the conflict back to the user
before introducing it. Do not silently invent.

## Hard rule — Figma is literal

**When a Figma node specifies an exact value, use that value
EXACTLY in the code. Don't substitute the closest token-ladder
value, don't round to a "consistent" alternative, don't reach for
`t.radius.full` / `t.spacing.lg` / etc. because the literal number
"isn't on the ladder." Figma is the source of truth — when the
user gives you a Figma node URL, every dimension in that node's
metadata is a directive, not a suggestion.**

This applies to: `borderRadius`, `padding*`, `margin*`, `gap`,
`width`, `height`, `top`/`left`/`right`/`bottom`, font size, line
height, letter spacing — any numeric style value the Figma node
exposes.

Examples:
- Figma says `radius: 30.269` → write `borderRadius: 30.269`,
  NOT `borderRadius: t.radius.full` (9999) and NOT `t.radius.2xl`
  (20). Even if 30.269 ≥ height/2 makes both render as a pill in
  theory, RN's handling of very large radius values can produce
  sharp-edge artifacts that the literal Figma value avoids.
- Figma says `padding-left: 9` → write `paddingLeft: 9`, NOT
  `t.spacing.sm` (8) or `t.spacing.md` (12). The 1-px difference
  is what makes the pill come out to the Figma's exact 119-px
  width.
- Figma says `gap: 2.79` → round to a sensible integer (3) and
  use that literally, NOT `t.spacing.xs` (4).

The token ladder is the DEFAULT for screens without a Figma
source — keep using it for new components built from scratch.
When the user provides a Figma node, that node overrides the
ladder for every value it specifies.

If a Figma node value seems wrong (e.g. designer typo, value
larger than the visual evidence supports), surface the conflict
back to the user before substituting — do not silently "correct"
to a ladder value.

## Hard rule — beans-only catalog

Crema is a **whole-beans catalog.** We list and show coffee **beans** —
whole-bean or ground. **Grind is a roaster fulfillment option, not a
product type:** a coffee offered with a grind selector, or sold as a
bulk bag of ground coffee, is still "the bean" and stays. We just talk
about and show beans.

**Single-serve and non-bean FORMATS are out of scope** and must be
Stage-1 filtered, never admitted: single-serve drip bags / pour-over
filter bags, brew bags, sachets, "drip filters", capsules / pods,
instant coffee, and ready-to-drink (cans / bottles / cold-brew bottles
/ concentrates).

- The filter targets **formats, not grind.** Bare `filter coffee` /
  `South Indian filter` / `ground` (a ground bean) must NOT be excluded;
  `drip filter(s)` / `drip bag` / `sachet` (the single-serve format) MUST.
- Enforcement (`services/product_filters.py`), four layers — keep all
  in sync with the audit's `non_bean_format` counter:
  - `_HARD_EXCLUDE_TITLE` (Stage-1 URL/title rejection) +
    `NON_BEAN_FORMAT_MARKERS` / `is_non_bean_format` (title marker).
  - `is_non_bean_format_text` (Stage-2a body-text marker, fetched page).
  - `is_single_serve_by_economics` (weight ≤ 15 g AND ≥ 15 ₹/g) — the
    text-invisible single-serve whose marker never reaches name/slug/
    prose (roast-coffee "Monsoon Malabar" 5 g); enforced on the write
    path by `CanonicalProduct._single_serve_format_economics`.
  - `is_non_bean_format_desc` (strict stored-description marker; OMITS
    recipe-tool nouns like "cold brew bag" so a real bean's brew recipe
    is never rejected — motley-brew). Used by the retro sweep + audit.
- **Multi-coffee BUNDLES are also out of scope** (a gift box / curated
  set / duo / combo of ≥2 distinct coffees in separate bags is coffee
  but not a single bean SKU). A **single-bag BLEND** that mixes coffees
  is ONE SKU and STAYS. Enforcement separates observation from policy:
  the model emits `distinct_coffee_count` (`Scraper/enrich.py` +
  `CanonicalProduct`; a blend = 1, a bundle = N), deterministic code
  rejects >1 (`_multi_coffee_bundle_guard`). Belt: `is_multi_coffee_bundle`
  (text detector keyed on SEPARATION structure, never a bare "N coffees")
  in the retro sweep + the audit's `multi_coffee_bundle` counter. Never
  widen onto blend language — "a blend of two coffees" is a real bean.
- This reverses the 2026-05-27 "let Haiku decide on drip bags" call.
  If a format seems borderline (e.g. a roaster's own bean bag named
  "coffee bag"), surface it — don't silently widen the exclusion onto
  grind terms.

## Before any dev / implementation work — read these

The moment a request is about writing, modifying, debugging, reviewing,
deploying, or scoping code (anything beyond discussion, research,
docs-only edits, or non-technical planning), Read the full contents of
all four before proposing changes or writing code:

- [CRUD_UTOPIA.md](CRUD_UTOPIA.md) — architecture rules (registry-driven backend, design tokens, the non-negotiables)
- [AGENTIC_UTOPIA.md](AGENTIC_UTOPIA.md) — agent-first orchestration: operator-based routing (queue vs SDK), MCP tools as the agent-facing surface, Opus-orchestrates / Haiku-executes, activity-log-over-approval-queue. Required reading for any catalog-ops or backend automation change.
- [BUILD_ROADMAP.md](BUILD_ROADMAP.md) — what's built, what's next, key files per feature
- [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) — primary palette (3 brand colors only), font directive (NewSpirit display + Inter body), spacing/radius/shadow ladders, identity-surface split (CroppedAvatar circular vs RoasterLogo rounded square), pre-flight checklist

The DESIGN_LANGUAGE.md doc is the source of truth for *visual*
decisions — palette, typography, identity treatments. Run its
pre-flight checklist before any UI commit.

If unsure whether a request counts as "dev work," err on the side of
reading them. The cost is small; the cost of acting on stale
assumptions is large.

## Read-on-demand

Pull these in only when the task touches their area:

- [README.md](README.md) — repo overview, onboarding, local setup
- [MAESTRO_OPS.md](MAESTRO_OPS.md) — operational guide for running and extending the Maestro E2E suite. Pull this in whenever the user asks to run flows, debug a Maestro failure, or add a new user journey.
- [LAUNCH_TODO.md](LAUNCH_TODO.md) — pre-launch backlog. Don't self-direct onto these items; only pull in when the user explicitly asks to work on launch blockers / infra / legal / app-store prep.
- [AD_MODEL.md](AD_MODEL.md) — revenue & ad strategy: ad tiers (promoted listings, premium analytics, in-article ADS, the agentic-SEO distribution tier), the moved revenue model, opt-in mechanics. Pull in for any monetisation / ad-tier / agentic-SEO work.
- [specs/UI_SPEC.md](specs/UI_SPEC.md) — component structure, page flows, design tokens
- [specs/CATALOG_SPEC.md](specs/CATALOG_SPEC.md) — catalog data model
- [specs/SCRAPER_SPEC.md](specs/SCRAPER_SPEC.md) — scraper architecture
- [specs/COMMUNITY_SPEC.md](specs/COMMUNITY_SPEC.md) — social feed (the retention surface)
- [specs/ENRICHMENT_PROMPT.md](specs/ENRICHMENT_PROMPT.md) — LLM enrichment prompts

## Keeping BUILD_ROADMAP.md current

Living doc. When work lands, update it in the same change (or the
immediate follow-up commit) — don't let reality drift from what's
written.

- When a feature is shipped, move it from "next build targets" into
  the appropriate "What has been built" section with a one-line
  description and the key files touched (match the existing table
  format).
- When an architectural decision changes, update the relevant prose —
  don't just append. The roadmap should read as the current state, not
  a changelog.
- When a new build target appears (user asks for a new feature, scope
  expands), add it to the "next build targets" section so it isn't
  lost.

If it's unclear whether a feature is "done enough" to move into the
shipped section, prefer a brief note over guessing. BUILD_ROADMAP is
read by humans as the project's ground truth — accuracy matters.

## Not doing yet: LAUNCH_TODO.md items

The launch blockers, infra setup, legal review, and app-store prep in
[LAUNCH_TODO.md](LAUNCH_TODO.md) are **not the default workstream**.
Don't self-direct onto them. If status on those items matters to a
specific request, the user will say so explicitly.

When LAUNCH_TODO items do come up:
- `[ ]` → `[~]` when starting, `[~]` → `[x]` when done (with commit
  hash / short note), `[~]` → `[!]` if blocked.
- Part 2 items need the user's credentials/money/decision — leave a
  "YOU: <decision>" line instead of starting those.

## Standing rules

- Don't create new top-level `.md` files without asking. The set above
  is deliberate.
- When a task touches multiple specs, update each spec in the same
  change rather than leaving specs to drift behind code.
- If the code contradicts a spec, surface it — don't silently "fix"
  the spec to match the code or vice versa.

## Hard rule — Haiku-agent validation runs

When you iterate on a Haiku-driven prompt (article enricher, product
enricher, site-hint generator, etc.) and the API credits are exhausted
so you spawn Claude Code `Agent` calls with `model: "haiku"` to act as
the production Haiku, the spawned agent MUST run the full production
prompt + tool schema and produce the FULL structured output that
production would write to the DB.

Concretely:

- **Load the canonical assets**: read the actual `_ARTICLE_SYSTEM` (or
  whichever module-level prompt you're iterating) verbatim into
  `/tmp/haiku_system.txt`. Read the actual `_ARTICLE_TOOL.input_schema`
  verbatim into `/tmp/haiku_schema.json`. The agent reads those files;
  no excerpting, no paraphrasing, no narrow extracts.
- **Build the user_content the same way `enrich_article` would**:
  ARTICLE URL, OG hints, DETECTED VIDEOS, DETECTED BODY LINKS,
  CLEANED PAGE TEXT — exactly the structure the production runner
  passes to the SDK. Don't strip blocks because "I'm only testing the
  title polish today" — Haiku reads the full context to make every
  field decision.
- **Demand every field**: the agent must produce every schema field
  (`is_article`, `is_about_coffee`, `title`, `excerpt`, `body_html`,
  `topic_category`, `tags`, `image_url`, `published_at`,
  `word_count`). The whole structured payload, not a slice. Validation
  is meaningless if the agent under-emits and you only inspect the
  one field you were tuning.
- **Write the full payload back to the DB**: same fields the
  production runner's `upsert_scraped_articles` writes — title,
  excerpt, body_html, topic_category, tags, image_url, published_at,
  word_count, is_about_coffee, enrichment_status. Anything less and
  the validation is unrepresentative of what would land in
  production. **Including the `published` flag** when the runner's
  rule (`published = is_about_coffee ? 1 : 0` on insert, sticky on
  update) calls for it — admin curation stays sticky on update, but a
  validation re-enrichment that restores `is_about_coffee=1` should
  also re-publish if the prior `published=0` was driven by a stale
  `is_about_coffee=0` decision.
- **Report the full delta**: when summarising the validation results
  to the user, show every changed field (title, excerpt, body_html
  length, topic, tags, published flag, …) — not just the one you were
  tuning. Hiding changes obscures regressions.

Spawned Haiku is production Haiku for these validation purposes. Treat
it that way.
