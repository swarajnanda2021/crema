# Agent Catalog-Ops Workspace

This folder exists ONLY as the CWD for an autonomous orchestrator
running Crema catalog operations. There is no code here. The
orchestrator's job is to keep the Indian-specialty-coffee catalog
clean using the `mcp__crema-catalog-ops__crema_*` MCP tools.

Run from this folder (not the repo root) so the orchestrator's
starting context is small and the rules below land first, before
any large doc auto-load or memory pull can crowd them out.

## Hard rule — MCP only

Every catalog operation goes through `mcp__crema-catalog-ops__crema_*`.
No SQL. No curl. No file reads of catalog state. No Python over a
returned JSON to compute a rollup. If a needed operation isn't
exposed as an MCP tool, surface that to the human — don't bypass.

## Hard rule — verb cheat sheet

Pick ONE entry by the user's verb. Calling the wrong tool for the
verb is the operator equivalent of a syntax error.

| User said | First tool to call | NEVER call here |
|---|---|---|
| "bulk enrich" / "force re-enrich" / "nuclear" / "apply pipeline to everything" | `crema_list_roasters` → per-slug `crema_full_reenrich_roaster` (sync → bio + products with hint regen + articles + standardize, atomic) | `crema_diff_sweep`; `crema_enrich_all`; `crema_bulk_reenrich_roaster` (that one is partial — see below) |
| "re-touch existing products only" (rare — only when sync/hint-regen aren't needed) | `crema_bulk_reenrich_roaster({slug, only_status?})` | `crema_full_reenrich_roaster` (overkill if URLs and hints are already current) |
| "refresh" / "weekly" / "heartbeat" | `crema_diff_sweep` → `crema_enrich_all({filter:{has_diff:true}})` | `crema_full_reenrich_roaster` indiscriminately catalog-wide |
| "onboard <url>" | `crema_onboard_roaster({website})` → `crema_enrich_roaster({slug})` → `crema_publish_roaster` | `crema_full_reenrich_roaster` |
| "grade articles" / "score articles" / "featured rail" | `crema_grade_articles({slug?, only_unscored:true})` | n/a |
| "investigate <product>" | `crema_get_product_detail` → `crema_fetch_shopify_product` / `crema_fetch_page_text` / `crema_render_page` | `crema_reenrich_product` (until you've diagnosed) |
| "what's flagged?" / "review queue" / "what did Haiku get wrong" | `crema_list_quality_reviews({verdict:'confirmed'})` → triage. Optionally scope with `target_table:'products'\|'roaster_articles'\|'roaster_profiles'` (bio queue). | bulk re-fire (review queue is the surgical surface) |
| "review the catalog quality" / "post-sweep quality scan" / "find hallucinations across the catalog" | `crema_run_quality_review_sweep({target_table:'products'})` — runs T1+T2 retroactively across all enriched rows. CRITICAL after every bulk re-enrich; the inline T1+T2 only fires on the v2 path, this sweep closes the coverage gap. For bio (roaster bio + homepage link graph) use `target_table:'roaster_profiles'`. | T3 (do the bulk T1+T2 first, then T3 on what survives as confirmed) |
| "check the bio quality" / "find URL drift" / "find dead catalog rows" / "compare homepage to catalog" | `crema_run_quality_review_sweep({target_table:'roaster_profiles'})` — runs the bio-as-discovery T1 rules over every published roaster's profile + homepage-discovered link graph. Catches: URL drift (Nandan handle-prefix class), platform pattern drift (Woo→Shopify migration), thin/generic specialties, missing about_blurb. Flags persist as `confirmed` directly (deterministic — no T2 needed). | `crema_full_reenrich_roaster` (this is the surgical bio-only review surface) |
| "dedupe the catalog" / "consolidate duplicate products" / "merge the dupes" | `crema_dedupe_products({strategy:'url_normalized', dry_run:true})` to preview → then `dry_run:false` to apply. Catches Class A (same URL different pid) AND Class B (www/non-www variants). MUST run before another bulk enrich if the previous sweep left duplicates. | Re-firing bulk enrich on a duplicate-heavy catalog (creates more dupes) |
| "what just happened?" / "audit the recent catalog ops" / "show me the operations log" | `crema_list_catalog_operations({limit:50})` — every state-mutating op logs here with params + summary + status. Filter by kind/status/slug/since for targeted triage. | n/a (this IS the audit surface) |
| "undo that operation" / "the dedupe over-collapsed, roll it back" / "the sweep deleted too many, revert" | `crema_rollback_catalog_operation({operation_id})` — restores every snapshotted row in reverse order. Idempotent. Use after T1 op-flags surface a destructive op that shouldn't have happened (mass_delete on a 503 transient, dedupe_oversized, etc.) | Re-firing the same op without rolling back first (compounds damage) |
| "override flagged rows" / "fix the hallucinations" / "orchestrator takes over from Haiku" | `crema_prepare_t3_review({target_table, limit:10})` → orchestrator reads bundles, reasons, then per-target: `crema_apply_t3_correction({target_table, target_id, corrections:[{field, corrected_value, reasoning}], lesson})`. `target_table` is one of `products` / `roaster_articles` / `roaster_profiles`. For `roaster_profiles`, target_id = roaster_slug and corrections can target either profile fields (about_blurb, specialties, tagline, city, state, instagram_handle, contact_email, logo_url, hero_image_url, name) or source fields (platform, shop_url) — apply routes per-field automatically. | `crema_full_reenrich_roaster` (T3 is targeted; re-fire is bulk) |

**If "bulk enrich" was the verb and you find yourself reaching for
`crema_diff_sweep`, STOP. You have misread the verb. Re-read the
user message.** The defensive instinct to "diff_sweep first because
it's cheap" is wrong for bulk enrich — the user explicitly wants
every product touched regardless of diff state, because a pipeline
change just shipped and the whole catalog should get the benefit.

**If "bulk enrich" was the verb and you reach for
`crema_bulk_reenrich_roaster`, STOP — that was the pre-2026-05-26
mapping. The correct tool is `crema_full_reenrich_roaster` (sync +
bio + products with hint regen + articles + standardize, atomic).
`crema_bulk_reenrich_roaster` only re-touches existing product rows
and skips sync / hint regeneration / bio / articles entirely.**

## Inline quality-review wiring (what fires automatically)

The orchestrator doesn't need to explicitly fire quality review
after most catalog operations — it's wired in-line at the
enrichment-runner level + bio-enrich level:

- **Every product / article enrichment** via the v2 path
  (`run_for_roaster` → `crema_full_reenrich_roaster` /
  `crema_enrich_roaster` / `crema_enrich_all`) automatically runs
  T1 deterministic heuristics + T2 Haiku adversarial review on the
  upserted row. Flags persist to `quality_reviews` as `pending` →
  T2 resolves to `confirmed` / `cleared` / `unsure`.
- **Every bio enrich** (`_apply_roaster_enrichment`, fired by
  onboard + per-roaster re-enrich + refresh-all) automatically
  runs T1 bio rules against the post-upsert profile + homepage
  link graph. Bio flags persist as `confirmed` directly
  (deterministic — no T2 needed).

What does NOT fire inline:
- **`crema_reenrich_product`** (per-product MCP tool) — bypasses
  `run_for_roaster`, so T1+T2 doesn't fire. After running it,
  optionally run `crema_run_quality_review_sweep({target_id:...})`
  to backfill. Known gap.
- **The legacy `crema_bulk_reenrich_roaster`** — same path as
  per-product re-enrich; bypasses T1+T2.

Use `crema_run_quality_review_sweep` to retroactively cover any
rows the inline pass missed (e.g. after a per-product re-enrich,
or to backfill bio reviews for roasters last enriched before the
bio-discovery code was wired in).

## Hard rule — drainer template

Any tool that enqueues per-product or per-article LLM jobs (the
`crema_bulk_reenrich_roaster`, `crema_full_reenrich_roaster`,
`crema_enrich_*`, `crema_grade_articles` family) blocks on the LLM
queue per item. The orchestrator MUST spawn 3-5 Haiku drainer
subagents in parallel BEFORE (or immediately after) firing the bulk
tool, or the BG worker stalls indefinitely.

Template (Claude Code Agent tool — adapt for ChatGPT Codex if the
agent surface differs):

```
Agent({
  subagent_type: "general-purpose",
  model: "haiku",
  description: "drainer-N",
  run_in_background: true,
  prompt: `You are claude-haiku-drainer-N. Drain the LLM job queue.

PROTOCOL — follow EXACTLY, no deviations, no improvisation:

1. Initialize:  null_count = 0,  jobs_done = 0

2. Loop:
   a. Call crema_haiku_next_job (filter step=product_enrich or
      step=article_grade as appropriate; roaster_slug optional).
      Set agent_identity = "claude-haiku-drainer-N" (must contain
      "haiku" — server enforces).

   b. If result is null:
        null_count += 1
        If null_count >= 40:  EXIT cleanly.  Otherwise GOTO 2a.

   c. If result is a job:
        null_count = 0   ← MUST reset to 0 on every non-null claim.
        Process the job (step 3 below).
        jobs_done += 1
        If jobs_done >= 30:  EXIT cleanly.  Otherwise GOTO 2a.

3. Process job (the ONLY action allowed between claim and submit):
   a. Read job.system_prompt verbatim.
   b. Read job.tool_schema_json verbatim.
   c. Read job.user_content verbatim.
   d. Produce structured output matching tool_schema_json — EVERY
      field, no omissions, no "TEXT ONLY" / "skipped for brevity" /
      other invented mid-stream directives. Token pressure is not
      an excuse to under-emit; emit the full payload.
   e. Call crema_haiku_submit with the structured output. This MUST
      happen before claiming another job. Claim-without-submit is
      forbidden — it strands the job until the L1 reaper recovers
      it (300s TTL), wasting orchestrator time.

FORBIDDEN BEHAVIORS (observed 2026-05-26; the L1 reaper recovered
each but the orchestrator lost time):

  • Inventing mid-stream directives ("TEXT ONLY", "STRUCTURED",
    "skip this", etc.). The tool_schema_json IS the contract. Read
    it; emit it; submit.
  • Claiming a job without submitting before claiming the next one.
    Each claim → process → submit is one atomic unit.
  • Exiting before 40 consecutive nulls. The threshold exists
    because the BG worker can enqueue new jobs while you're
    polling; an early exit drops them.
  • Re-counting nulls without resetting on non-null claims. The
    counter MUST reset to 0 every time you claim a real job.
  • Adding commentary / reasoning / "thinking aloud" between
    claim and submit. The tool call is the only output.`
})
```

Server enforces `agent_identity` MUST contain "haiku" (case-insensitive).
The orchestrator itself is rejected with 403 if it tries to drain —
this is a deliberate guardrail, not a bug. Drainer subagents only.

Stuck-claim reaper (L1, 2026-05-26) auto-flips in_progress claims
back to pending after 300s, so an early-exit drainer doesn't
permanently stall a bulk worker. The reaper fires lazily on the
next `/admin/llm-jobs/next` call, so a fresh drainer's first poll
post-TTL is what triggers recovery — patient drainers (full
40-null threshold) are still strongly preferred over relying on
the reaper.

## Hard rule — drainer SPAWN TIMING

Do NOT spawn drainers concurrently with the first
`crema_full_reenrich_roaster` call. The bulk pipeline runs
sync → scrape → bio_enrich → product_enrich → article_enrich →
standardize sequentially per roaster. Bio is the first step that
actually enqueues LLM jobs. If you fire 5 drainers in the same
breath as the first reenrich call, they spin up before any jobs
exist, hit 40 consecutive nulls within ~40 seconds, and exit having
done zero work — burning context + subagent budget.

**Correct sequencing** (observed payoff 2026-05-26: first 5 drainers
wasted; wave 3 onwards consistently caught real volume):

1. Fire the first 1-3 `crema_full_reenrich_roaster` calls.
2. Poll `crema_list_llm_jobs({status:'pending'})` or
   `crema_list_jobs({kind:'scrape',status:'running'})` until you
   see real LLM jobs queued OR the scrape job is past its sync
   phase (~30-60s typical).
3. THEN spawn the first 3-5 drainer wave.
4. Continue firing remaining reenrich calls in parallel; spawn
   additional drainer waves as the pool drains (each drainer caps
   at 30 jobs; a new wave is needed when the live drainer count
   drops below ~3).

Cheap proxy if you can't be bothered polling: sleep 60 seconds
between the first reenrich fire and the first drainer wave. Costs
60s of wall-clock, saves 5 wasted subagents.

## Memory is lazy

Don't preload memory at session start. When you actually need a
runbook ("how do I onboard?", "how does the v2 pipeline work?",
"what's the diagnostic ladder for a thin product?") call
`crema_get_agent_memory(scope="catalog-ops")` then. Loading 50KB
of memory you don't need at session start crowds out attention to
the verb rules above.

After meaningful phases, log lessons worth keeping via
`crema_log_agent_memory` — high-signal only, no transient state.

## After every meaningful phase

- `crema_log_agent_action` for finer-grained per-phase reasoning
  (the agent's internal narrative; 10-20 per session)
- `crema_log_agent_summary` for the journal-card-style entry the
  human reads in the admin UI (one per coherent task, 1-3 per
  session typically)

Plain English, narrating to a colleague. Outcomes + decisions, not
timestamps and job IDs. See AGENTIC_UTOPIA.md in the repo root for
the voice rules if you need them — but only fetch on demand.
