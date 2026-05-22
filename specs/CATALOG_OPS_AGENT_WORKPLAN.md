# Catalog Ops — Agent Workplan

This is the runbook for the autonomous agent that owns catalog ops.
Catalog ops is the work of keeping Crema's roaster catalog current
and accurate — discovering changes in roaster storefronts, enriching
new products + articles with structured fields, and getting them
applied to the live catalog with operator review.

The agent is autonomous-by-default and human-supervised. Every
session ends with an `agent_summaries` row the human reads at
breakfast. The human is in the loop only for proposal review +
trapdoor decisions — not for routine refreshes.

This document is the template for future agent surfaces (content
moderation, ad-placement curation, journal curation). Each surface
gets its own workplan in `specs/`, all following the structure here.

---

## 1. Agent identity

| | |
|---|---|
| Role | The Crema **catalog-ops agent**. Single role, narrow scope. |
| Powers | Read/write everything in `roaster_profiles`, `roaster_sources`, `products`, `scraped_articles`, `scrape_proposals`, `roaster_snapshots`, `llm_jobs`, `agent_summaries`, `jobs` — **via MCP only, no exceptions**. |
| Forbidden | **Direct DB queries (reads OR writes) outside MCP.** Running shell commands for DB access. Reading saved tool-result files to parse data. Editing application code as a workaround. Touching tables not owned by catalog ops (`users`, `posts`, `tasting_notes`, etc.). |
| Identity string | `crema-catalog-ops@<model>` (e.g. `crema-catalog-ops@haiku-4.5`). Stamped on every `agent_runs` row + `llm_jobs.agent_identity` claim. |

### The MCP-purity rule

The MCP tool surface is the **provider portability boundary**. If the
agent reaches outside it (direct SQL, file reads of saved tool output,
ad-hoc Bash for state inspection), the operator loses the ability to:

- swap LLM providers (Claude → another model) without losing capability,
- swap hosts (cloud ↔ local) without rewiring tool access,
- audit every catalog action through `agent_runs` (the bypass leaves no
  audit row).

**Every read or write to catalog state goes through an MCP tool.** When
a needed read isn't surfaced, the right action is to **add a new MCP
tool first, then use it** — not to bypass with SQL "just this once."

Side-tool bypass leaks observed and closed 2026-05-21:

- Catalog state aggregates (counts, ratios) → `crema_catalog_stats`
- Proposal grouped counts (by roaster / by enrichment_status) → `crema_proposal_breakdown`
- Per-roaster freshness (`last_scraped_at` age buckets) → `crema_freshness_report`
- `crema_list_proposals` filter ignored → backend now honors `slug` + `limit`

If a future session finds itself reaching for SQLite, that's a missing
tool to flag immediately (log via `crema_log_agent_summary` with the
TODO), not a workaround to ship.

---

## 2. Tool inventory (MCP)

All catalog-ops tools are `mcp__crema-catalog-ops__crema_*`. Group by
verb-class:

### Discovery (read-only, free)

| Tool | Purpose |
|---|---|
| `crema_list_roasters({search?, limit?})` | Substring match across all 96 published roasters. Returns `slug + name + city + state + website + products_count`. |
| `crema_get_all_status({has_diff?, has_snapshot?, platform?, missing_article_hint?})` | Per-roaster snapshot age + diff counts. The dashboard query. |
| `crema_get_snapshot({slug})` | Drill into one roaster's snapshot + diff structure (added/updated/removed lists, full hashes, bio_len delta). |
| `crema_get_hints({slug})` | Read the three site-quirk hints (bio+bean, journal, diff). |
| `crema_list_proposals({slug?, status?, limit?})` | Read scrape proposals. Statuses: `pending` / `applied` / `rejected`. |
| `crema_list_jobs({limit?})` | Read recent catalog-ops jobs (kind: `scrape` / `article_scrape`). |
| `crema_list_llm_jobs({status?, roaster_slug?, step?})` | Read the LLM enqueue queue. Used to debug agent-fallback drainer state. |
| `crema_list_agent_runs({agent_identity?, tool_name?, session_id?})` | The audit log. Filter what the agent did. |

### Crawl / snapshot (LLM-free, cheap)

| Tool | Purpose |
|---|---|
| `crema_sync_roaster({slug, mode})` | Crawl + snapshot ONE roaster. `mode: tab1` = full re-baseline, `mode: tab2` (default) = diff vs prev. **Zero LLM cost.** This is the deterministic change-detection primitive. |
| `crema_sync_all({slugs?, mode?})` | Bulk crawl every published roaster (or a list) in parallel BG tasks. Returns immediately, work happens async. **Zero LLM cost.** |
| `crema_diff_sweep({slugs?, wait_seconds?})` | **The one-shot daily heartbeat.** Fires `crema_sync_all` internally, waits for BG tasks to settle (default 45s; bump to 120-180 for the full 96-roaster scope), then returns the list of roasters with non-zero diff plus the bucket counts. Zero LLM cost. Use this as the FIRST tool of every catalog-ops shift — it tells you who needs work. |

### Enrichment (LLM cost — real money)

| Tool | Purpose |
|---|---|
| `crema_enrich_roaster({slug, regenerate_prompt?, regenerate_article_hint?})` | Full pipeline for ONE roaster: bio enrich + catalog scrape (per-product Haiku) + article scrape (per-article Haiku). Use only on roasters where the snapshot diff actually warrants it. |
| `crema_enrich_all({slugs?, filter?, regenerate_prompt?, regenerate_article_hint?})` | Bulk enrich. Cost-aware — fanning out to 96 roasters can be $15-30 in LLM calls. Use `filter: {has_diff: true}` to scope to roasters that actually changed. |

### Proposals (apply or discard)

| Tool | Purpose |
|---|---|
| `crema_auto_approve_proposals({slug?, since?, dry_run?, strict_checks?})` | Apply the auto-approval policy. Default = permissive (approve every `enrichment_status='enriched'` proposal; reject is_coffee_bean=false; skip null). `strict_checks: true` adds completeness gating (species-not-in-varietal, valid roast_level, non-empty blurb, etc.) — useful for high-trust pipelines, too strict for routine sweeps. |
| `crema_approve_proposals({ids})` | Approve specific proposal ids — for surgical fixes. |
| `crema_reject_proposals({ids})` | Reject specific proposal ids. |

### Hints (per-roaster prompt addenda)

| Tool | Purpose |
|---|---|
| `crema_set_diff_hint({slug, hint})` | Write the diff-prompt hint for one roaster. The ONLY hint that's admin-written; bio + journal hints are auto-generated by Haiku meta-calls during enrich. |
| `crema_regenerate_hint({slug, kind})` | Flag a bio/journal hint for regeneration on the next enrich run. `kind: bio` is one-shot (clears after regen); `kind: journal` is perpetual. |

### Audit / logging (agent-MUST)

| Tool | Purpose |
|---|---|
| `crema_log_agent_summary({task_label, summary, outcome, scope_slugs?, tool_calls_count?, metrics?, started_at?, prompt_excerpt?})` | **MANDATORY at end of every agent session.** Free-text `task_label`, 3-5 sentence `summary` in the agent's voice, `outcome` enum (success/partial/failed/aborted), the roasters touched, and any free-form metrics. This is the human-readable boss-man report — the digest in the Agent Log admin tab. **Skip this call and the human can't tell you ran.** |

### Drainer-only (agent-fallback execution path)

These two are used ONLY by drainer agents that act as production
Haiku for FastAPI's queue. Not used in routine catalog-ops work.

| Tool | Purpose |
|---|---|
| `crema_haiku_next_job({step?, roaster_slug?, agent_identity?})` | Claim the oldest pending llm_job atomically. |
| `crema_haiku_submit({job_id, output, status, error?})` | Submit the structured output for an in-flight claimed job. |

### Lifecycle (onboard / publish / update / delete)

| Tool | Purpose |
|---|---|
| `crema_test_source_url({url})` | Pre-flight URL probe — reachability, content_type, html_title, elapsed_ms. 10s timeout, GET (not HEAD) so SPA shells return enough body for title extraction. Read-only. |
| `crema_onboard_roaster({website, name?, shop_url?, platform?, city?, state?})` | Create a `roaster_sources` row from a URL. Best-effort `<title>` fills name if omitted. Newly-onboarded rows land at `enabled=false` — flip via `crema_update_scrape_settings` when ready. 409 on duplicate website. |
| `crema_update_scrape_settings({slug, shop_url?, platform?, enabled?})` | Mutate the scrape-side fields on the source row. Use to flip `enabled=true` after onboarding, or `platform=wix` when auto-detection guesses wrong. Auto-creates the source row for profile-only roasters. Idempotent. |
| `crema_publish_roaster({slug, published})` | Toggle Discover-visibility. Non-destructive, reversible. |
| `crema_delete_roaster({slug})` | Soft-archive — removes profile + source row but products survive. Audit row in `deleted_roasters`. Destructive. |

### Standardization (5-task SCA pipeline)

| Tool | Purpose |
|---|---|
| `crema_standardize_stats()` | Per-task unclassified counts + bucket breakdowns (tasting / origin / varietal / roast / process). The "what's left to classify" dashboard. |
| `crema_standardize_exemplars()` | Read the cached per-task exemplars Haiku is primed with. Audit what's grounding the classifier before a run. |
| `crema_standardize_run({tasks?, regenerate_exemplars?, force_reclassify?})` | Enqueue a Catalog Standardization job. Tasks subset = `tasting | origin | varietal | roast | process`. `force_reclassify=true` re-classifies every input regardless of existing addresses (use after a prompt or schema change). |
| `crema_regenerate_exemplars({task, value?})` | Flag a task's exemplars for resampling on the next run. `task: all` flips every task. |

### Flavor schemas (the tasting-note tree)

| Tool | Purpose |
|---|---|
| `crema_list_flavor_schemas()` | Read every version in `sca_tree_versions`, newest-first. Reports active_id + `stale_address_count` (rows keyed against retired branches). |
| `crema_upload_flavor_schema({tree_json, notes?, activate?})` | Upload a new single_tier schema (kind + label + version + sectors[]). `activate=true` flips it live on upload; otherwise stays inactive for later activation. |
| `crema_activate_flavor_schema({schema_id})` | Make a specific schema active. Atomic flip (prior active off, named id on) in one transaction. Response reports post-activation `stale_address_count`. |

### Articles / Journal

| Tool | Purpose |
|---|---|
| `crema_bulk_scrape_articles({roaster_slugs?, force_enrich?, regenerate_article_hint?})` | Enqueue bulk article scrape. Empty `roaster_slugs` = every published roaster. `force_enrich=true` re-runs Haiku on already-enriched articles. Only one article_scrape can be in-flight at a time (409 on conflict). |
| `crema_scrape_roaster_articles({slug, force_enrich?, regenerate_article_hint?})` | Per-roaster article scrape. Shares the article_scrape job kind with the bulk endpoint — same 409 gate. |
| `crema_list_articles({roaster_slug?, limit?, offset?, include_hidden?})` | Admin article list. `include_hidden=true` (default) shows `published=0`. |
| `crema_set_article_published({article_id, published})` | Toggle consumer-visibility. Non-destructive. |
| `crema_delete_article({article_id})` | Hard-delete. Re-scrape re-inserts if URL still resolves. Destructive — for hiding use `crema_set_article_published`. |

### Per-product

| Tool | Purpose |
|---|---|
| `crema_get_product_detail({product_id})` | Full `products` row + most-recent `scrape_proposals` row touching it (any status). The investigative entry point for "why does this bean look wrong?". |
| `crema_reenrich_product({product_id})` | Force re-run the enricher on one product. Use when initial enrichment failed (`enrichment_status='failed'`) or a prompt change applies. |
| `crema_mark_product_sold_out({product_id})` | Flip `available=0`. Logged against a synthetic `manual_sold_out` job — undoable via `crema_undo_scrape_job`. |
| `crema_delete_product({product_id})` | Hard-delete one row. Shelf / tasting_notes references go stale (no cascade). Use only for truly broken rows; prefer `crema_mark_product_sold_out` for "hide but keep history". Destructive. |
| `crema_undo_scrape_job({job_id})` | Reverse every applied proposal from a scrape (or manual_sold_out) job. Inserts deleted (scraped-source only); updates replay prev_state; sold-out flips back. Destructive. |

### Job inspect / control

| Tool | Purpose |
|---|---|
| `crema_get_scrape_run_log({job_id})` | Log tail + error_message for one job. Pairs with `crema_list_jobs` for end-to-end debug context. |
| `crema_list_scrape_runs({roaster_slug?, kind?, limit?})` | Recent jobs with proposal-count summaries per job (total / pending / applied / rejected). Joins jobs + scrape_proposals via product_id LIKE. |
| `crema_cancel_running_job({job_id})` | Sticky cancel — runner exits cleanly at next per-source checkpoint with whatever it has already committed (no half-scraped rows). Idempotent on terminal jobs. |
| `crema_get_raw_snapshot({slug})` | Raw `crawl_snapshots` payload (parsed JSON) — what the crawler captured before any diff/join enrichment. Use when `crema_get_snapshot`'s `unknown` count is high. Response can be large. |
| `crema_get_llm_job_detail({job_id})` | Full `llm_jobs` row INCLUDING payloads (system_prompt, user_content, tool_schema_json, response_payload). Debug a specific Haiku call — failed (why?) or complete (what did it produce?). |
| `crema_requeue_llm_job({job_id})` | Flip an `in_progress` or `failed` job back to `pending`. Clears claimed_at, agent_identity, response_payload, error. Use for stuck zombies (drainer died mid-task) or transient retries. 409 if already pending/complete. |

### Aggregate observability (MCP-purity gap closers, added 2026-05-21)

Built explicitly to eliminate every SQLite-bypass that crept into earlier
sessions. The agent operator surface must be provider-portable — every
read must go through MCP so a different LLM or host can drop in without
losing capability.

| Tool | Purpose |
|---|---|
| `crema_catalog_stats({slug?})` | Aggregate product counts: total, enriched, failed, by_status breakdown, available yes/no, distinct source count. Optional `slug` scopes to one roaster. Answers "where is the catalog at?". |
| `crema_proposal_breakdown({group_by?, status?, change_type?, enrichment_filter?})` | Group-by counts over scrape_proposals. `group_by` ∈ {roaster_slug, change_type, enrichment_status, status}. Most-common usage: `enrichment_filter="failed"` + `group_by="roaster_slug"` to find roasters with held proposals stuck on Haiku errors. |
| `crema_freshness_report()` | Per-roaster `last_scraped_at` + age buckets (fresh≤1d, stale>1d, stale>7d, never_scraped). Summary counts + per-row data sorted most-stale first. Answers "how stale is the catalog?". |

**The list_proposals filter fix (same date)**: `crema_list_proposals`'s
`slug` and `limit` params were silently ignored by the backend; both now
honored. The slug filter applies a `product_id LIKE 'slug_%'`
post-filter; limit caps at 5000 to prevent MCP response truncation.

### Agent working journal — actions + memory (added 2026-05-21)

The agent's working journal is a two-layer system: timestamped per-phase
actions (within-session timeline) and durable lessons (cross-session
experience). Granularity for actions is INTENTIONALLY coarser than
`crema_list_agent_runs` — one entry per meaningful decision, not per
tool call. A human reading the log sees "agent did X, here's why" not
the 250 underlying MCP calls.

| Tool | Purpose |
|---|---|
| `crema_log_agent_action({action, reasoning, metadata?, session_id?, agent_identity?})` | Append one entry. `action` = short label ('diff_sweep', 'enrich_all on 10 stale'). `reasoning` = agent's prose explaining WHY. 10–20 per session, not per tool call. |
| `crema_get_session_actions({session_id?, agent_identity?, since?, limit?})` | Read the timeline. Filter by session_id (chronological reconstruction) or recent activity. **Call at session start to read what previous sessions did.** |
| `crema_log_agent_memory({scope, lesson, tags?, source_session_id?, source_summary_id?})` | Preserve a durable lesson. Use sparingly — high-signal lessons only. Examples below in §6. |
| `crema_get_agent_memory({scope?, tag?, limit?})` | Inherit institutional knowledge at session start. Reading bumps `reference_count` + `last_referenced_at` so the operator can later see which lessons are load-bearing vs vestigial. |

The intended session-shape:

```
START → crema_get_agent_memory({scope: "catalog-ops"})
       → crema_get_session_actions({limit: 20})   # what did the previous agent do?
DURING → crema_log_agent_action(...) after each meaningful phase
END   → crema_log_agent_summary(...)              # existing — the boss-man report
       → crema_log_agent_memory(...) × N          # any new lessons worth preserving
```

Lessons fit a structured grammar (each in one or two sentences):

- **Cause + consequence + fix.** "When X happens, Y goes wrong, the fix is Z."
- **Boundary condition.** "Z doesn't apply when the platform is W."
- **Anti-pattern.** "Don't do X — it produces Y false signal."

Example lessons (the ones earned 2026-05-21):

- `scope: scrape-noise` — "Shopify `/products.json` sometimes returns empty under rate-limit / Cloudflare / TLS failure. Retry once with 2s backoff before treating empty as authoritative; otherwise the diff layer reports false-positive 'everything removed' (humble-express −39 incident)."
- `scope: drainer-discipline` — "Every `crema_haiku_next_job` claim MUST be followed by `crema_haiku_submit` even on parse failure — submit with `status: failed`. Unsubmitted claims block parent scrapes for up to 600s (Drainer A & K incidents)."
- `scope: wix-routing` — "Wix-hosted roasters are intermittently unreachable from our IP block (ConnectTimeoutError / TLS failure). Don't retry same-day — leave for tomorrow's window."
- `scope: catalog-ops` — "When a refresh would re-enrich roasters already touched today, skip them (already in the window). Run `crema_diff_sweep` first, then enrich only the stale-and-actionable subset."

---

## 3. Standard workflows

### W1. Daily diff sweep — detect change, prioritise refresh (zero LLM)

**Goal**: Detect which roasters changed since yesterday. Cheap.

```
1. crema_diff_sweep({wait_seconds: 180})
   — re-crawls every published roaster in parallel BG tasks, waits for
     them to settle, returns the stale list with per-bucket diff counts
2. crema_log_agent_summary({
     task_label: "Daily diff sweep",
     summary: "...",
     outcome: "success",
     scope_slugs: <list of slugs the sweep returned as stale>,
     metrics: {scanned: scope_count, has_diff: stale_count, no_change: no_change_count}
   })
```

Run nightly via cron or on-demand. Zero LLM calls.

For scoped sweeps (e.g. just the Wix roasters, or just Karnataka roasters),
pass `slugs: [...]`. For a one-shot per-roaster check, prefer
`crema_sync_roaster({slug, mode: "tab2"})` + `crema_get_snapshot({slug})`.

Run nightly via cron or on-demand. Zero LLM calls. Outcome: a list of
roasters that need enrichment work the next day.

### W2. Full re-enrich on changed roasters (LLM cost)

**Goal**: Run enrichment on the roasters that W1 surfaced.

```
1. crema_get_all_status({has_diff: true})
   — confirm list (in case the human deferred any)
2. crema_enrich_all({filter: {has_diff: true}, regenerate_prompt: true, regenerate_article_hint: true})
   — kicks off per-roaster orchestrators in parallel
3. (background) Haiku drainer agents process the llm_jobs queue
4. crema_list_proposals({status: "pending"})
   — review what landed
5. crema_auto_approve_proposals({dry_run: true})
   — preview the policy outcome
6. crema_auto_approve_proposals({})
   — apply
7. crema_log_agent_summary(...)
```

### W3. Single-roaster refresh (operator hit "Refresh" on a card)

**Goal**: Refresh ONE roaster end-to-end.

```
1. crema_enrich_roaster({slug, regenerate_prompt: true, regenerate_article_hint: true})
2. (background) Haiku drainer processes its llm_jobs
3. crema_list_proposals({slug, status: "pending"})
4. crema_auto_approve_proposals({slug})
5. crema_log_agent_summary(...)
```

### W4. Wix / image-card roaster refresh (special path)

**Goal**: For roasters where the structured fields (Producer / Variety
/ Notes / Process / Altitude) live in **PNG images** (Canva/Figma
cards) instead of HTML — e.g. 729-Grams.

The enrichment pipeline auto-detects these:

- `Scraper/scraper/wix_fetcher.py` handles JS-rendered Wix pages via
  Playwright fallback.
- `Scraper/scraper/image_ocr.py` runs Tesseract on the primary product
  image when an `image_url` is present. The OCR'd text lands in the
  user_content as `IMAGE OCR (...)` section that Haiku reads
  alongside the listing description and page text.

Agent workflow is identical to W3 — the OCR fires automatically. The
only agent-side awareness needed:

- **Tesseract digit/letter quirks**: stylized fonts can read "74110"
  as "7AN10" or "7ANO". When the OCR text shows a code-like token
  with mixed letters and digits, trust the digit interpretation if
  surrounding context is numeric.
- **Bio enrich may fail** on hostile Wix hosts (729-Grams, etc.).
  The orchestrator continues past bio failure to the catalog scrape
  + OCR enrichment. Bio fields stay null; products still land.

### W5. Recovery — orphan job cleanup (legacy path)

**Goal**: When drainers exit mid-claim (Claude Code restart,
network blip), llm_jobs rows stay in `in_progress` forever.

The pre-Phase-2 path:

```
1. crema_list_llm_jobs({status: "in_progress"})
   — identify zombies (claimed > 5 min ago, no submit)
2. For each zombie: crema_haiku_submit({job_id, status: "failed", error: "drainer abandoned claim"})
   — fails the job so a fresh drainer claims a new one
3. crema_log_agent_summary(...)
```

**Prefer W10** (the requeue path) over this — failing a job loses any
in-flight context, requeueing preserves the original prompt + payload
so a fresh drainer answers the SAME question, not a new one.

### W6. Onboard a new roaster — end-to-end

**Goal**: Add a roaster from a URL to Discover-visible, in one MCP
session. Replaces the multi-tab admin click-through.

```
1. crema_test_source_url({url})
   — confirm reachability + html_title pre-flight; abort if 4xx/5xx
2. crema_onboard_roaster({website: url, name?: html_title})
   — creates roaster_sources row at enabled=false; returns slug
3. crema_update_scrape_settings({slug, enabled: true, platform?: detected})
   — flip the master switch + set platform if known
4. crema_sync_roaster({slug, mode: "tab1"})
   — initial full crawl + stage every entity
5. crema_enrich_roaster({slug, regenerate_prompt: true, regenerate_article_hint: true})
   — bio Sonnet + per-product Haiku + per-article Haiku
6. (background) Haiku drainer processes the llm_jobs queue
7. crema_list_proposals({slug, status: "pending"})
   — review what was staged
8. crema_auto_approve_proposals({slug})
   — bulk-approve (permissive default)
9. crema_publish_roaster({slug, published: true})
   — flip to Discover
10. crema_log_agent_summary({task_label: "Onboarded <name>", scope_slugs: [slug], ...})
```

**Cost**: ~$0.10-$1.00 depending on catalog + journal size. Set
`enabled=true` BEFORE `sync_roaster` or the scraper will skip.

### W7. Per-product investigation

**Goal**: Diagnose why a single coffee row looks wrong (missing
field, bad value, no image). End-to-end via MCP without screen-
sharing the admin DB.

```
1. crema_get_product_detail({product_id})
   — full row + latest_proposal; identifies the missing/wrong field
2. crema_get_raw_snapshot({slug: row.roaster_slug})
   — what the crawler captured for the storefront. Find this product
     by URL match.
3. crema_list_scrape_runs({roaster_slug: slug, kind: "scrape"})
   — find the run that produced latest_proposal.job_id
4. crema_get_scrape_run_log({job_id})
   — read the runner's stderr/stdout for errors specific to this URL
5. crema_list_llm_jobs({roaster_slug: slug, step: "product_enrich"})
   — find the Haiku call (target_id ≈ product_id)
6. crema_get_llm_job_detail({job_id: llm_job.id})
   — read system_prompt + user_content + response_payload
7. Decide:
     - Response was correct but products row is stale → crema_reenrich_product({product_id})
     - Response was wrong (Haiku error) → patch the prompt in
       Scraper/enrich.py + ask operator to re-deploy
     - Job is in_progress / failed → crema_requeue_llm_job({job_id})
8. crema_log_agent_summary(...)
```

### W8. Standardization sweep

**Goal**: Clear unclassified inputs in the 5-task SCA pipeline
(tasting / origin / varietal / roast / process).

```
1. crema_standardize_stats()
   — read per-task unclassified counts; pick the priority tasks
2. crema_standardize_exemplars()
   — audit cached exemplars; check if any look stale
3. (optional) crema_regenerate_exemplars({task: "all"})
   — flag for resampling on the next run if exemplars are stale
4. crema_standardize_run({tasks: ["tasting"], regenerate_exemplars: false})
   — narrow scope = predictable cost. Or pass tasks=[] for all five.
5. (background) Haiku queue drains
6. crema_list_llm_jobs({step: "tasting"})
   — watch progress mid-run
7. crema_standardize_stats()
   — confirm backlog dropped
8. crema_log_agent_summary({metrics: {tasting_classified: N, ...}})
```

**Cost**: ~$0.005 / unclassified input. A full backlog clear of
1239 tasting + 159 origin + 45 varietal + 44 roast + 105 process
= ~$8 if exemplars are fresh. Resampling exemplars adds ~$0.10.

### W9. Flavor schema swap

**Goal**: Switch the active tasting-note tree (e.g. from 10-sector
to a 14-sector A/B variant) and reclassify against the new sectors.

```
1. crema_list_flavor_schemas()
   — inspect existing versions, active_id, stale_address_count
2. (if new) crema_upload_flavor_schema({tree_json, notes, activate: false})
   — stage without flipping live
3. crema_activate_flavor_schema({schema_id})
   — atomic flip; response reports the new stale_address_count
4. crema_regenerate_exemplars({task: "tasting"})
   — schema-aware exemplar resampling on next run
5. crema_standardize_run({tasks: ["tasting"], force_reclassify: true})
   — re-classify every tag against the new sectors
6. crema_log_agent_summary({metrics: {schema_id, stale_before, stale_after}})
```

The Discover wheel renders the new sectors immediately on activate;
existing `sca_addresses` rows go stale until step 5 lands. The UI
shows a banner with the stale count.

### W10. Stuck llm_job recovery — clean MCP path (preferred over W5)

**Goal**: Same as W5 — release in_progress jobs left by exited
drainers — but preserves the original prompt + payload so a fresh
drainer answers the SAME question rather than failing it.

```
1. crema_list_llm_jobs({status: "in_progress"})
   — identify zombies (claimed > 5 min ago, no submit)
2. (optional) crema_get_llm_job_detail({job_id}) for context
3. For each zombie: crema_requeue_llm_job({job_id})
   — flips to pending; clears claimed_at, agent_identity,
     response_payload, error
4. Fresh drainer claims via crema_haiku_next_job and re-runs the
   same prompt
5. crema_log_agent_summary(...)
```

Use W10 when you want the work to actually complete; use W5 only
when the job's premise is moot (roaster deleted, etc.) and failing
it is the correct outcome.

---

## 4. Failure modes + recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| `Tool error: fetch failed` on any MCP call | FastAPI is overloaded by concurrent scrape threads + drainers competing for SQLite locks | Wait 30s + retry. If persistent, the operator manually kills the FastAPI worker (`kill -9 <pid>`). Orphan-recovery on restart marks running scrape jobs as failed. |
| Bio enrich fails with "Couldn't fetch homepage" | Wix anti-bot or genuine 4xx/timeout. Hostile sites: 729-Grams. | Non-fatal — orchestrator continues to step 4 (catalog scrape). Live with bio_blurb=null for that roaster. |
| `enrichment_status='failed'` on many proposals | Haiku enrich call errored mid-product (rate limit, JSON parse fail, credit exhaustion) | Re-trigger `crema_enrich_roaster` for the affected slug. Fresh Haiku run replaces the failed proposals. |
| Proposals stuck in `status='staging'` | Scrape's staging→pending promotion was killed mid-flight (FastAPI restart) | Manual DB UPDATE (operator-only — agent can't write SQL): `UPDATE scrape_proposals SET status='pending' WHERE status='staging'`. Then auto-approve normally. |
| Species name ('Arabica', 'Robusta') in `varietal` field of proposals | Pre-patch Haiku output, or a stubborn page where only species is stated | Run `crema_enrich_roaster` again on the affected slug — the patched prompt produces varietal=null when only species is mentioned. |
| Bourbon-as-varietal on barrel-aged coffees | Haiku confused the bourbon-spirit-in-barrel with the Bourbon coffee cultivar | Patched in the system prompt with worked examples. If recurs, fix the system_prompt in `Scraper/enrich.py:_SYSTEM_PRODUCT` and re-enrich. |

---

## 5. Reporting convention

Every session ends with `crema_log_agent_summary`. The fields:

- `task_label` — free text, what you did. Be specific. Examples:
  - "Daily diff sweep"
  - "Re-enrich held-roaster batch after Bourbon-varietal prompt patch"
  - "Auto-approve clean proposals after Wix OCR rollout"
- `summary` — 3-5 sentences in YOUR voice. Cover:
  - Scope (which roasters / how many jobs / which sub-phase)
  - Key outcomes (what landed, what was rejected)
  - Anything surprising or worth escalating to the human
- `outcome` — `success` (everything as expected) / `partial` (some
  work done, some skipped) / `failed` (nothing landed cleanly) /
  `aborted` (gave up voluntarily — e.g. SQLite contention got bad)
- `scope_slugs` — list of roaster slugs the session touched. Used
  by the UI to filter "show me everything that happened to caarabi".
- `tool_calls_count` — approximate count of MCP tool calls made
- `metrics` — free-form counters. Conventions:
  - `jobs_processed`, `submit_failures`, `varietal_null_set`
  - `image_ocr_observed`, `producer_from_ocr`, `altitude_from_ocr`
  - `proposals_approved`, `proposals_rejected`, `proposals_held`
  - Anything else worth measuring

The summary lands in `agent_summaries`. The Agent Log tab in
catalog ops renders it.

---

## 6. Escalation triggers (when to hand off to human)

The agent escalates by setting `outcome="partial"` or `outcome="aborted"`
and naming the issue in the summary. The human reads the agent log
and decides. Specific triggers:

- **SQLite is timing out repeatedly** → operator kills the FastAPI worker.
- **A roaster's homepage cannot be fetched** (Wix anti-bot or DNS down) → operator manually adds the bio data, or accepts it stays blank.
- **A specific product image fails OCR** → operator either uploads better source data or accepts the product without the structured table fields.
- **Auto-approve dry-run shows > 50% would be held** → something is wrong with the prompt patch; operator inspects + tunes the prompt.
- **Per-product LLM cost is unexpectedly high** for a roaster → operator inspects the user_content to see if Haiku is being given too much page text. Cap the input.

---

## 7. Cost model

- **Daily diff sweep (W1)**: $0. No LLM calls. Pure crawl + hash.
- **Single-roaster refresh (W3)**: $0.10 - $1.00 depending on catalog size. Bio ($0.01) + per-product ($0.005 × N) + per-article ($0.005 × M) + per-image OCR (free for Tesseract, ~$0.08 per Haiku-vision escalation).
- **Full re-enrich on changed roasters (W2)**: $5-15 for a typical day's diff set (~20 changed roasters with ~10 products each). $30-50 for a full 96-roaster sweep.
- **Onboard new roaster (W6)**: Same as W3 ($0.10 - $1.00). Pre-flight `test_source_url` is free.
- **Per-product investigation (W7)**: $0 if no re-enrich. ~$0.01 if `crema_reenrich_product` is invoked.
- **Standardization sweep (W8)**: ~$0.005 / unclassified input. A full backlog clear of the current ~1592 unclassified inputs (1239 tasting + 159 origin + 45 varietal + 44 roast + 105 process) is ~$8. Resampling exemplars adds ~$0.10.
- **Flavor schema swap (W9)**: $0 for the activate; the reclassification step is bounded by tasting backlog × $0.005 (≤$6 for the current ~1239 tasting tags).
- **Stuck-job recovery (W10)**: $0 for the requeue itself; the requeued job runs on the next drainer at its normal per-call cost.
- **Inspect / diagnose tools** (`get_product_detail`, `get_raw_snapshot`, `get_scrape_run_log`, `list_scrape_runs`, `get_llm_job_detail`, `test_source_url`, `standardize_stats`, `list_flavor_schemas`): **$0**. Pure reads. Use freely.
- **Auto-approve**: $0. No LLM calls; it's policy + DB writes.

---

## 8. Anti-patterns

Don't:

- **Enrich every roaster every day**. The diff sweep tells you which
  need work. Skip the ones with no changes.
- **Bulk-approve without dry-running first**. `dry_run: true` is
  cheap and reveals which proposals would be auto-rejected as not-a-coffee
  — review the counts before going live.
- **Use `strict_checks: true` on routine sweeps**. It holds 30-40% of
  proposals on minor schema imperfections (Haiku put "Arabica" in
  varietal once, etc.). Permissive mode is faster + ships more.
- **Run multiple `crema_enrich_all` calls in quick succession**.
  FastAPI's SQLite gets contention-stuck at ~20 concurrent scrape
  threads. Wait between batches.
- **Skip `crema_log_agent_summary`**. If you don't log, the human
  has zero visibility into what you did.

---

## 9. Template for future agent surfaces

When we add a new MCP-tooled surface (content moderation,
ad-placement curation, journal curation), follow this exact
structure:

```
specs/<SURFACE>_AGENT_WORKPLAN.md

1. Agent identity (role, powers, forbidden, identity string)
2. Tool inventory (group by verb-class, document destructive ones)
3. Standard workflows (daily / on-demand / single-target)
4. Failure modes + recovery
5. Reporting convention (always crema_log_agent_summary)
6. Escalation triggers
7. Cost model
8. Anti-patterns
9. (cross-reference back to this doc as the template)
```

This file is canonical. Don't drift it from the actual tool surface
— when a tool is added/removed/renamed, update Section 2 in the
same change.
