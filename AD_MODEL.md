# Ad Model & Revenue — Crema

The canonical home for how Crema makes money: the **ad tiers** (the
near-term focus) and the broader **revenue model** (moved here from
`NORTH_STAR.md` §6). `NORTH_STAR.md` keeps the vision and the governing
"no revenue before Phase 1 metrics" rule; the detail lives here.

> Status note: this consolidates strategy worked out across several
> planning sessions. The **agentic-SEO distribution tier** (§2.4) is the
> newest element and the least built; **promoted listings** and
> **premium analytics** predate it (in NORTH_STAR §6); **in-article ADS**
> (§2.3) already exists in code. Sequencing in §4.

---

## 1. Revenue model (moved from NORTH_STAR §6)

Ad/promotion streams lead (the near-term levers); commerce, delivery,
and café/wholesale fees follow (later phases).

| Stream | Phase | Mechanism | Take rate |
|--------|-------|-----------|-----------|
| **Promoted listings** | 2+ | Roasters pay for visibility in catalog/search discovery | ₹2-5k/mo |
| **Premium analytics** | 2+ | Deeper seller insights beyond the free dashboard | ₹1-3k/mo |
| **Agentic-SEO distribution tier** | (new) | Roasters pay to be distributed to AI assistants (feeds + structured data + MCP) — see §2.4 | TBD |
| Consumer purchase fee | 2 | % of in-app bean purchase | 3-5% |
| Delivery fee | 3 | Per-kg per-km + route consolidation margin | Variable |
| Subscription margin | 3 | Bulk courier rate delta on recurring deliveries | 10-15% |
| Café POS fee | N | % of counter transaction | 1-2% |
| Wholesale order fee | N | % of B2B order value | 2-5% |

**Rule:** no revenue extraction before Phase 1 metrics are hit. The
consumer-roaster network has to be warm before anyone pays. Premature
monetisation kills the flywheel.

Self-sustaining threshold: ~₹15k/month in fees covers infrastructure.
Originally projected at 200 consumer purchases/month + a handful of
paying roasters in one city.

> **Catalog-only-launch reconciliation:** the original "promoted
> listings in search + **feed** discovery" predates the catalog-only
> pivot (see `project_catalog_only_launch` in memory). With the social
> feed dropped, "feed discovery" → **catalog/search discovery**, and the
> agentic-SEO tier (§2.4) becomes the natural near-term evolution of
> "promoted listings" — promotion happens in the surfaces AI assistants
> and search read, not a social feed.

---

## 2. The ad tiers

### 2.1 Promoted listings
Roasters pay for higher placement in catalog/search discovery (and, when
they exist, the curated "Popular/Featured" rails). Phase 2+. Mechanically
a ranking boost gated on the same opt-in flag as §2.4.

### 2.2 Premium analytics
Paid sellers get deeper insight than the free dashboard — repeat-interest
signals, regional breakdown, agent-activity (§2.4 measurement). Phase 2+.

### 2.3 In-article ADS (already built — revisit for launch)
A shipped in-article ad-placement system: `roaster_ad_placements`, the
roaster "ADS" tab, journal-placement matcher (commit `eb4ea00`). Roasters'
products are placed inside JOURNAL articles. **Status:** built, but parked
for the catalog-only launch (the ADS tab is one of the surfaces slated to
drop — see the migration scoping). Revisit post-launch as a real ad lever
once the catalog surface is stable.

### 2.4 Agentic-SEO distribution tier (the new, detailed one)

**Goal:** a roaster opts in → their beans become discoverable by AI
assistants → a person on *any* chat UI asking about Indian coffee gets
that roaster's Crema beans (with images) in the answer, like Claude
rendering a recipe card.

**The reframe that makes it work — Crema is the data layer *behind* the
assistant, not a destination.** The user installs nothing and visits
nothing; their natural-language question to their chatbot *is* the
interface. All the friction moves onto Crema's side (be retrievable,
publish feeds) — done once, every user benefits.

**Three discovery channels** (reach vs. friction):
1. **Answer-engine retrieval / GEO** — *zero install.* ChatGPT-search (Bing
   index), Gemini/AI-Overviews (Google), Perplexity, Claude web search
   retrieve + cite. Won by being the most retrievable, structured,
   complete, *token-cheap* source for the natural query.
2. **Agentic commerce feeds — ACP + UCP** — *zero install; the literal
   "beans pop out with images."* Push a product feed once (OpenAI ACP, live
   in ChatGPT; Google UCP, rolling out). Friction is merchant-side, never
   user-side.
3. **MCP / Claude App** — *install-gated → power-user tier, NOT the mass
   path.* For repeat/power users + directory presence. Do not build the
   mass strategy on it.

**Token efficiency is the strategy, not a nicety.** Two sides:
- *User input:* a few natural words must match → render structured
  enrichment (origin/process/flavor/brew) as natural prose so semantic
  retrieval hits.
- *Agent retrieval:* serve compact, clean, high-signal representations
  (Markdown/JSON, dense one-line cards). The cheaper you are to ingest,
  the more of you an assistant includes → **the more it cites you.**
  Bloated JS HTML gets skipped.
- *Concrete artifact:* a **one-cheap-fetch catalog digest** (compact
  Markdown/JSON, sliceable by flavor/origin/city) the engine grabs in one
  request, + **deep-on-demand `.md`/`.json` per bean.** Comprehensive at
  the digest level, deep on drill-in, cheap at both.

**No hidden prompts. Ever.** Cloaking / prompt-injection gets domains
delisted by the labs and ejected from commerce feeds — existential for a
product whose value is *being the trusted source.* The legitimate "red
carpet" is **visible, honest machine-addressed content**: a capability
manifest, typed MCP tools, structured data, agent-skills. (Reference
implementation: `localpulse.nl` — see §2.5.)

#### How the opt-in works mechanically (demystified)
- **One database flag** — `agentic_tier` on `roaster_profiles`. An admin
  flips it when a roaster pays.
- **The daily orchestrator honors it** at each build step: the commerce
  feed generator, the agent digest, the MCP read tools, and the
  enhanced structured-data emission all filter on the flag.
- **No UI change** — the human site looks identical for every roaster.
- **No web-address change** — same `/coffee/{slug}` URLs; the tier only
  changes how much machine richness a page carries and whether the bean
  is packed into the feeds.
- **We never touch the roaster's own website** — everything happens on
  Crema's pages and feeds. (Optional bonus: hand paid roasters a
  JSON-LD snippet for *their* site — reinforces, not required.)

#### Free vs. paid (recommended model: enhancement, not exclusion)
Keep the *whole* catalog AI-retrievable so Crema stays the complete,
citeable source (the comprehensiveness moat — "the long tail is the
moat"). Sell the *commercial* layer.

| | Free | Paid (agentic tier) |
|---|---|---|
| Human site | ✅ | ✅ |
| Citeable by AI (organic retrieval) | ✅ basic | ✅ |
| In ChatGPT/Google **shopping** feeds (images + buy) | ❌ | ✅ |
| Enhanced structured data + priority placement | ❌ | ✅ |
| Agent-activity ROI dashboard | ❌ | ✅ |

The split: *"be a fact an AI can mention"* is free (keeps you
comprehensive); *"appear in AI **shopping** results with your beans, your
images, and a buy button — and see the numbers"* is paid.

#### What we ensure vs. can't (the integrity line — for the sales pitch)
- **Ensure (eligibility):** beans are in every AI channel Crema operates
  (commerce feeds, agent digest, structured data, sitemap), refreshed
  daily, best-structured, with a measurement report.
- **Cannot guarantee (outcome):** that a given assistant cites *them* on
  a given query, or ranks them #1 — nobody owns that.
- Analogy: *we guarantee you're on the shelf the AI reads from, freshly
  stocked and well-labeled; we can't make the AI pick you every time —
  but you can't be picked at all if you're not on the shelf, and free
  roasters aren't.* Sell eligibility + structure + analytics, never a
  citation guarantee.

#### Measurement / ROI
Log AI-crawler user-agents (GPTBot, ClaudeBot, PerplexityBot,
OAI-SearchBot, Google-Extended) per roaster page + commerce-feed events +
detectable AI-referral click-throughs → per-roaster dashboard: "agents
surfaced your beans N times, drove M clicks this week."

### 2.5 Reference architecture — `localpulse.nl`
A studied, working agent-native catalog (a structural twin of Crema). Its
five layers, all worth copying:
1. **Self-describing discovery:** every HTTP response carries `Link`
   headers → `rel="agent-manifest"` (`/.well-known/.../index.json`) +
   `rel="mcp"` (`/mcp`). One `GET /` starts discovery (RFC 8288).
2. **Capability manifest** — typed index of every agent surface
   (MCP, server-card, api-catalog [RFC 9727], JSON schema, sitemap,
   robots, per-entity page template, health) + versions.
3. **READ = MCP, no auth** — browse-first/detail-on-demand
   (`search` returns compact cards; `get_detail` only when needed). Tool
   *descriptions* teach token-efficiency.
4. **Per-entity pages content-negotiated** — HTML to browsers,
   Markdown/JSON to agents via `Accept`, with cache-stable `.md`/`.json`
   sibling URLs.
5. **WRITE = a CLI** (device-flow auth, RFC 8628) gated by a published
   JSON Schema + editorial charter + audit checks.
Plus: `robots.txt` via **Content-Signals** (`search=yes, ai-train=no`);
**agent-skills** (`SKILL.md` playbooks, agentskills.io); honest
human/agent split (the SPA tells agents "don't parse me, use the
structured surfaces").

**Crema's mapping:** manifest at `/.well-known/crema/index.json`; MCP
tools `crema.search.beans` / `beans.get_detail` / `search.roasters` /
`articles.search` (filters from existing enrichment — origin, process,
varietal, **flavor-wheel sector**, price, in-stock — queries no roaster
site can answer = the moat); content-negotiated `/coffee/{slug}`,
`/roaster/{slug}`, `/article/{slug}` + `.md`/`.json`; schema.org
Product+Offer / Organization / Article; commerce feeds (ACP/UCP);
sitemap; robots welcoming AI crawlers with `ai-train=no`. Crema **adds**
vs. Local Pulse: the commerce feeds (beans are products; events aren't)
and the opt-in `agentic_tier` gate. Crema's write path is the orchestrator,
so a roaster-self-service CLI is a low-priority future.

**Why it's cheap:** it's a structured-output *layer* on assets Crema
already has — the daily orchestrator (feed/digest generation), the planned
static rebuild (content-negotiated pages), the existing catalog-ops MCP
plumbing (a separate, read-only, opt-in-scoped public MCP), and the
scraper that already *parses* JSON-LD (now *emits* it).

---

## 3. Open decisions
- **Exclusion vs. enhancement** (§2.4) — recommended: **enhancement**
  (keep catalog comprehensive/citeable for the moat; sell commerce +
  structure + analytics). Confirm before building the gate.
- **`ai-train` signal** — recommended **`ai-train=no`** (let assistants
  *answer* live from fresh data; don't let the ad-tier value leak into
  model weights for free), `search=yes`, `ai-input=yes`.
- **In-article ADS (§2.3)** — in or out for the catalog-only launch?
  Currently parked.
- **Public read-MCP vs. admin MCP** — keep separate surfaces; the public
  one is read-only and opt-in-scoped. Reuse plumbing, not the auth.

## 4. Sequencing & build dependencies
- **Layers 0–1** of the agentic stack — pre-rendered/retrievable pages +
  schema.org JSON-LD — **are the same work as launch SEO.** Do them for
  the catalog launch regardless; they double as the agentic foundation.
- **The agent-native layer** (manifest, `Link` headers, public read-MCP,
  content-negotiation, commerce feeds, opt-in gate, measurement) is the
  **fast-follow**, after the catalog-only launch ships.
- The ad tiers don't bill before Phase 1 metrics (the Rule above).

## 5. Principles (non-negotiable)
- **No revenue before Phase 1 metrics.**
- **No hidden prompts / cloaking** — the red carpet is honest structured
  data, not manipulation.
- **Human UI never changes by tier; never touch a roaster's own site.**
- **Sell eligibility + structure + analytics, never a citation guarantee.**

## References
- `NORTH_STAR.md` §3 (phase plan), §4 (the graph/moat), §6 (points here).
- `BUILD_ROADMAP.md` — the agentic-SEO tier as a future build target.
- Memory: `project_agentic_seo_ad_tier`, `project_catalog_only_launch`.
- Reference site: `localpulse.nl` (and `/.well-known/localpulse/index.json`).
