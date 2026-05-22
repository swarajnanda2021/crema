#!/usr/bin/env node
/**
 * crema-catalog-ops MCP server.
 *
 * Stdio transport. Anthropic-first (Claude Code, Claude Desktop). When
 * the backend moves to cloud, we add an HTTP/SSE transport variant
 * (launch-blocker in LAUNCH_TODO).
 *
 * Tools land here as registrations only. Schemas + implementations
 * live in `tools.ts`. Audit logging lives in `audit.ts`. The whole
 * MCP server is a thin layer over the existing FastAPI backend; it
 * adds no business logic of its own.
 *
 * Boot:
 *   CREMA_ADMIN_TOKEN=<token> node dist/index.js
 *
 * Optional env:
 *   CREMA_API_BASE        default http://localhost:8000
 *   CREMA_AGENT_IDENTITY  default claude-code@local
 *                         set per-run, e.g. `claude-sonnet-4-6@anthropic`
 *   CREMA_SESSION_ID      default auto-generated; pin to group a batch
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  // schemas
  listRoastersSchema, getAllStatusSchema, syncRoasterSchema,
  syncAllSchema, getSnapshotSchema, enrichRoasterSchema, enrichAllSchema,
  listProposalsSchema, approveProposalsSchema, rejectProposalsSchema, autoApproveProposalsSchema,
  logAgentSummarySchema, diffSweepSchema,
  getHintsSchema, setDiffHintSchema, regenerateHintSchema,
  listJobsSchema, listAgentRunsSchema,
  haikuNextJobSchema, haikuSubmitSchema, listLLMJobsSchema,
  // lifecycle
  onboardRoasterSchema, deleteRoasterSchema, publishRoasterSchema, updateScrapeSettingsSchema,
  // standardization
  standardizeStatsSchema, standardizeExemplarsSchema, standardizeRunSchema, regenerateExemplarsSchema,
  // flavor schemas
  listFlavorSchemasSchema, uploadFlavorSchemaSchema, activateFlavorSchemaSchema,
  // journal
  bulkScrapeArticlesSchema, scrapeRoasterArticlesSchema, listArticlesSchema,
  setArticlePublishedSchema, deleteArticleSchema,
  // products
  reenrichProductSchema, markProductSoldOutSchema, undoScrapeJobSchema,
  // jobs
  getScrapeRunLogSchema, cancelRunningJobSchema,
  // phase 2 inspect / diagnose
  getProductDetailSchema, deleteProductSchema, getRawSnapshotSchema,
  getLLMJobDetailSchema, requeueLLMJobSchema, listScrapeRunsSchema,
  testSourceURLSchema,
  // aggregate observability (MCP-purity gap closers)
  catalogStatsSchema, proposalBreakdownSchema, freshnessReportSchema,
  // agent action log + memory
  logAgentActionSchema, getSessionActionsSchema,
  logAgentMemorySchema, getAgentMemorySchema,
  // impls
  listRoasters, getAllStatus, syncRoaster, syncAll, getSnapshot,
  enrichRoaster, enrichAll, listProposals, approveProposals,
  rejectProposals, autoApproveProposals, logAgentSummary, diffSweep, getHints, setDiffHint, regenerateHint, listJobs,
  listAgentRuns,
  haikuNextJob, haikuSubmit, listLLMJobs,
  onboardRoaster, deleteRoaster, publishRoaster, updateScrapeSettings,
  standardizeStats, standardizeExemplars, standardizeRun, regenerateExemplars,
  listFlavorSchemas, uploadFlavorSchema, activateFlavorSchema,
  bulkScrapeArticles, scrapeRoasterArticles, listArticles,
  setArticlePublished, deleteArticle,
  reenrichProduct, markProductSoldOut, undoScrapeJob,
  getScrapeRunLog, cancelRunningJob,
  getProductDetail, deleteProduct, getRawSnapshot,
  getLLMJobDetail, requeueLLMJob, listScrapeRuns, testSourceURL,
  catalogStats, proposalBreakdown, freshnessReport,
  logAgentAction, getSessionActions, logAgentMemory, getAgentMemory,
} from "./tools.js";

interface ToolDef<T extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  handler: (input: z.infer<T>) => Promise<unknown>;
  // MCP tool annotations — let the client reason about which tools
  // are safe to call without explicit user approval.
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
}

const TOOLS: ToolDef<any>[] = [
  // ── Discovery (read-only) ──────────────────────────────────────────────
  {
    name: "crema_list_roasters",
    description:
      "List published roasters with optional substring filter. Returns slug, name, " +
      "city, state, website, products_count. Use this before any per-roaster op to " +
      "find the right slug.",
    schema: listRoastersSchema,
    handler: listRoasters,
    readOnly: true,
  },
  {
    name: "crema_get_all_status",
    description:
      "Orchestrator dashboard: per-roaster snapshot age + diff counts vs prev. " +
      "Optional filters: has_diff, has_snapshot, platform, missing_article_hint. " +
      "Use this to pick which roasters need work before kicking off bulk operations.",
    schema: getAllStatusSchema,
    handler: getAllStatus,
    readOnly: true,
  },
  {
    name: "crema_get_snapshot",
    description:
      "Get the current snapshot for one roaster + diff vs prev + breakdown of " +
      "storefront / in_catalog / unknown counts. Use this to drill into one roaster " +
      "after spotting it in the dashboard.",
    schema: getSnapshotSchema,
    handler: getSnapshot,
    readOnly: true,
  },
  {
    name: "crema_list_proposals",
    description:
      "List scrape proposals (pending / applied / rejected). Pending proposals are " +
      "in the admin approve queue — use crema_approve_proposals or crema_reject_proposals " +
      "to dispose of them.",
    schema: listProposalsSchema,
    handler: listProposals,
    readOnly: true,
  },
  {
    name: "crema_get_hints",
    description:
      "Read all three per-roaster site quirks (bio+bean, journal, diff). Returns " +
      "{bio_hint, journal_hint, diff_hint} for the given slug.",
    schema: getHintsSchema,
    handler: getHints,
    readOnly: true,
  },
  {
    name: "crema_list_jobs",
    description:
      "List recent catalog-ops jobs (scrape, article_scrape, roaster_enrich). Used to " +
      "track in-flight work kicked off by enrich operations.",
    schema: listJobsSchema,
    handler: listJobs,
    readOnly: true,
  },
  {
    name: "crema_list_agent_runs",
    description:
      "Read the agent_runs audit log. Filters: agent_identity, tool_name, session_id. " +
      "Used by an agent to inspect what previous agents (or itself) did recently — " +
      "the org's day-to-day ops trail.",
    schema: listAgentRunsSchema,
    handler: listAgentRuns,
    readOnly: true,
  },
  // ── Sync (idempotent crawl + snapshot, no LLM) ─────────────────────────
  {
    name: "crema_sync_roaster",
    description:
      "Crawl ONE roaster's site + take snapshot + diff vs prev + stage entity bundles. " +
      "Mode tab1 = full re-baseline (stage every entity). Mode tab2 = diff-only " +
      "(stage only what changed). Zero LLM cost.",
    schema: syncRoasterSchema,
    handler: syncRoaster,
    idempotent: true,
  },
  {
    name: "crema_sync_all",
    description:
      "Bulk crawl + snapshot every roaster in parallel background tasks. Returns " +
      "immediately with the accepted list. Poll crema_get_all_status to see diffs land. " +
      "Steady-state runs zero LLM calls — only crema_enrich_* tools do LLM work.",
    schema: syncAllSchema,
    handler: syncAll,
    idempotent: true,
  },
  // ── Enrichment (LLM work) ──────────────────────────────────────────────
  {
    name: "crema_enrich_roaster",
    description:
      "Run the full enrichment pipeline for ONE roaster: bio Sonnet enrich + catalog " +
      "scrape (Haiku per-product) + article scrape (Haiku per-article). Returns the " +
      "fresh profile + the enqueued job ids. Cost: ~$0.10-1.00 per roaster depending " +
      "on catalog + journal size.",
    schema: enrichRoasterSchema,
    handler: enrichRoaster,
    idempotent: false,
  },
  {
    name: "crema_enrich_all",
    description:
      "Bulk full-pipeline refresh: bio + catalog + article enrichment for every roaster " +
      "in scope. Pass `slugs` to target a specific list, or `filter` (has_diff / " +
      "missing_article_hint / etc.) to derive from all-status. Each per-roaster pipeline " +
      "runs as a background task — poll crema_list_jobs to track progress. WARNING: " +
      "this can fan out to thousands of LLM calls if scoped to all 96 roasters.",
    schema: enrichAllSchema,
    handler: enrichAll,
    idempotent: false,
  },
  // ── Proposals (admin approve queue) ────────────────────────────────────
  {
    name: "crema_approve_proposals",
    description:
      "Approve scrape proposals by id — merges proposed_state_json into the live " +
      "products table. Use crema_list_proposals first to find ids.",
    schema: approveProposalsSchema,
    handler: approveProposals,
    destructive: false,  // creates/updates live rows, but reversible via reject/undo
  },
  {
    name: "crema_reject_proposals",
    description:
      "Reject (discard) scrape proposals by id. Does not touch the live products table.",
    schema: rejectProposalsSchema,
    handler: rejectProposals,
    destructive: false,
  },
  {
    name: "crema_auto_approve_proposals",
    description:
      "Apply the auto-approval policy across all pending proposals (or scoped to one " +
      "roaster). Policy: approve every proposal where Haiku's structured output has " +
      "is_coffee_bean=true; reject every proposal with is_coffee_bean=false; skip the " +
      "ones where the field is null/absent. Pass dry_run=true to preview the outcome. " +
      "Use this after a sweep to bulk-decide proposals without per-card review.",
    schema: autoApproveProposalsSchema,
    handler: autoApproveProposals,
    destructive: false,  // creates/updates live rows but reversible via the existing undo flow
  },
  // ── Deterministic diff sweep (LLM-free change detection) ──────────────
  {
    name: "crema_diff_sweep",
    description:
      "Run a deterministic, LLM-FREE change-detection sweep across one " +
      "or many roasters. Fires `sync-bulk` (crawl + snapshot + hash-diff " +
      "per roaster), waits for the BG tasks to settle, then returns the " +
      "list of roasters with non-zero diff (products added/updated/removed " +
      "OR articles added/updated/removed OR bio_changed). Zero LLM cost — " +
      "this is the cheap heartbeat that decides which roasters need an " +
      "actual `crema_enrich_*` pass. Default wait is 45s (good for small " +
      "batches); bump `wait_seconds` to 120-180 for a full 96-roaster sweep.",
    schema: diffSweepSchema,
    handler: diffSweep,
    destructive: false,  // snapshot writes are idempotent; rolls forward
  },
  // ── Agent journal (explicit session-end log) ──────────────────────────
  {
    name: "crema_log_agent_summary",
    description:
      "Log an entry into the daily activity digest (`agent_summaries`). Every " +
      "autonomous catalog-ops agent (drainer, orchestrator, auto-approve runner, " +
      "hint-regen, etc.) MUST call this exactly once at the end of its run with: " +
      "(a) a free-text `task_label` describing what it did, (b) a 3-5 sentence " +
      "`summary` in its own voice covering scope + outcomes + anything worth " +
      "flagging, (c) an `outcome` enum, (d) `scope_slugs` (roasters touched), " +
      "(e) any `metrics` counters. This is the human-readable boss-man report " +
      "for an otherwise-autonomous system. Don't skip the call — if you skip it, " +
      "the human can't tell that you ran.",
    schema: logAgentSummarySchema,
    handler: logAgentSummary,
    destructive: false,
  },
  // ── Hints (per-roaster site quirks) ────────────────────────────────────
  {
    name: "crema_set_diff_hint",
    description:
      "Admin-write the per-roaster diff-prompt hint (the free-text addendum Haiku " +
      "reads when interpreting a storefront diff). Pass null to clear. This is the " +
      "ONLY hint that's admin-written — the bio + journal hints are auto-generated " +
      "by Sonnet meta-calls during enrichment.",
    schema: setDiffHintSchema,
    handler: setDiffHint,
    idempotent: true,
  },
  {
    name: "crema_regenerate_hint",
    description:
      "Flag a roaster's bio (one-shot) or journal (perpetual) hint for regeneration " +
      "on the next enrichment run. After this, call crema_enrich_roaster to trigger " +
      "the Haiku meta-call that produces the fresh hint.",
    schema: regenerateHintSchema,
    handler: regenerateHint,
    idempotent: true,
  },
  // ── LLM-jobs queue (agent-fallback execution path) ─────────────────────
  // When a Claude operator drives an enrichment, the FastAPI runner
  // enqueues each LLM call as a row in `llm_jobs` instead of calling
  // the Anthropic SDK. Claude polls these rows via `crema_haiku_next_job`,
  // produces the structured output itself (acting as production Haiku
  // per CLAUDE.md hard rule), and writes back via `crema_haiku_submit`.
  // Same prompt + same tool schema as the SDK path — only the executor
  // differs. This is what makes the MCP-only flow possible: no SDK
  // credit spend on Claude-driven sweeps.
  {
    name: "crema_haiku_next_job",
    description:
      "Claim the oldest pending llm_job from the agent-fallback queue. Returns " +
      "the canonical system prompt + tool_schema + user_content the model needs " +
      "to produce a structured tool_use output. Atomic claim — concurrent agents " +
      "race-safe. Optional filters: step (bio | bio_hint | journal_hint | " +
      "article_enrich | product_enrich), roaster_slug. Returns null when the " +
      "queue is empty (or empty for the filter). Pair with crema_haiku_submit " +
      "to deliver the output back.",
    schema: haikuNextJobSchema,
    handler: haikuNextJob,
    idempotent: false,  // mutates queue state (claims the row)
  },
  {
    name: "crema_haiku_submit",
    description:
      "Submit the structured output for an in-flight llm_job claimed via " +
      "crema_haiku_next_job. The `output` MUST match the job's tool_schema — " +
      "every field, full payload, per CLAUDE.md's Haiku-validation hard rule. " +
      "Marks the job complete (or failed with an error message). The awaiting " +
      "enricher in the FastAPI runner picks up the response on its next poll " +
      "tick and resumes the pipeline.",
    schema: haikuSubmitSchema,
    handler: haikuSubmit,
    idempotent: false,
  },
  {
    name: "crema_list_llm_jobs",
    description:
      "Read the llm_jobs queue. Filters: status (pending | in_progress | complete " +
      "| failed), roaster_slug, step. Used to track an enrichment sweep's " +
      "progress — see what's pending vs completed before/after a fan-out.",
    schema: listLLMJobsSchema,
    handler: listLLMJobs,
    readOnly: true,
  },
  // ── Roaster lifecycle (onboard / delete / publish / update) ────────────
  {
    name: "crema_onboard_roaster",
    description:
      "Onboard a new roaster by website URL. Creates a roaster_sources row " +
      "(natural key on website). Best-effort <title> fetch fills the name if " +
      "you don't provide one. Newly-onboarded sources start at enabled=false — " +
      "use crema_update_scrape_settings to flip enabled=true when ready, then " +
      "crema_enrich_roaster to populate the profile. Returns 409 if the website " +
      "already exists.",
    schema: onboardRoasterSchema,
    handler: onboardRoaster,
    destructive: false,
  },
  {
    name: "crema_delete_roaster",
    description:
      "Soft-archive a roaster. Removes the profile + source row but preserves " +
      "products (catalog data isn't destroyed). The deleted_roasters audit table " +
      "captures website + city + state so re-onboarding from the same URL " +
      "recreates the profile cleanly. Use crema_publish_roaster with " +
      "published=false instead if you just want to hide them from Discover.",
    schema: deleteRoasterSchema,
    handler: deleteRoaster,
    destructive: true,
  },
  {
    name: "crema_publish_roaster",
    description:
      "Toggle Discover-visibility for a roaster. published=true = visible on " +
      "the consumer Discover page; published=false = hidden (still queryable " +
      "for admin / scrape). Non-destructive — flip back any time.",
    schema: publishRoasterSchema,
    handler: publishRoaster,
    idempotent: true,
  },
  {
    name: "crema_update_scrape_settings",
    description:
      "Update the scrape-side fields on a roaster's source row: shop_url, " +
      "platform, enabled. Auto-creates the source row if the roaster only has " +
      "a profile (the 121 originally-seeded roasters were profile-only). Use " +
      "this to flip enabled=true after onboarding or to set platform=wix etc. " +
      "when auto-detection guesses wrong.",
    schema: updateScrapeSettingsSchema,
    handler: updateScrapeSettings,
    idempotent: true,
  },
  // ── Standardization (the 5-task SCA pipeline) ──────────────────────────
  {
    name: "crema_standardize_stats",
    description:
      "Read the 5-way standardization stats — per-task unclassified counts " +
      "(tasting / origin / varietal / roast / process), multi-estate / " +
      "international / unknown / morphology breakdowns. Use before " +
      "crema_standardize_run to see what's left to classify.",
    schema: standardizeStatsSchema,
    handler: standardizeStats,
    readOnly: true,
  },
  {
    name: "crema_standardize_exemplars",
    description:
      "Read the cached per-task exemplars Haiku is primed with — the actual " +
      "house-style examples that ground each classification call. Returns " +
      "regenerate_next flag + generated_at stamp + the exemplars list per " +
      "task. Use to inspect/audit what the classifier is seeing before a run.",
    schema: standardizeExemplarsSchema,
    handler: standardizeExemplars,
    readOnly: true,
  },
  {
    name: "crema_standardize_run",
    description:
      "Enqueue a Catalog Standardization job. Harvests unclassified inputs " +
      "across selected tasks, Haiku-classifies them, writes results to address " +
      "tables + denormalized product columns. Pass tasks=[...] to scope; empty " +
      "= all five. force_reclassify=true re-classifies every input (use after " +
      "a prompt or schema change). regenerate_exemplars=true resamples exemplars " +
      "first.",
    schema: standardizeRunSchema,
    handler: standardizeRun,
    idempotent: false,
  },
  {
    name: "crema_regenerate_exemplars",
    description:
      "Flag a task's exemplars (or all five) for regeneration on the next " +
      "standardization run. Mirrors the per-task regen toggle on the admin tab.",
    schema: regenerateExemplarsSchema,
    handler: regenerateExemplars,
    idempotent: true,
  },
  // ── Flavor schemas (the tasting-note tree) ─────────────────────────────
  {
    name: "crema_list_flavor_schemas",
    description:
      "List every flavor schema in sca_tree_versions (newest-first), with the " +
      "active id flagged. Also reports stale_address_count — addresses keyed " +
      "against branches no longer in the active schema. Use before activating " +
      "a new schema to understand the re-classification cost.",
    schema: listFlavorSchemasSchema,
    handler: listFlavorSchemas,
    readOnly: true,
  },
  {
    name: "crema_upload_flavor_schema",
    description:
      "Upload a new flavor schema (single_tier shape: kind, label, version, " +
      "sectors[]). tree_json is parsed + validated server-side; bad shapes raise " +
      "400. If activate=true the new row becomes active immediately, the prior " +
      "active row flips off, and the Discover wheel renders new sectors. Existing " +
      "sca_addresses go stale until crema_standardize_run is re-run.",
    schema: uploadFlavorSchemaSchema,
    handler: uploadFlavorSchema,
    destructive: false,
  },
  {
    name: "crema_activate_flavor_schema",
    description:
      "Make a specific schema the active one. Atomic flip (prior active off, " +
      "named id on) inside a single transaction. Response includes the resulting " +
      "stale_address_count so you know how many sca_addresses need re-classifying.",
    schema: activateFlavorSchemaSchema,
    handler: activateFlavorSchema,
    idempotent: true,
  },
  // ── Journal / articles ─────────────────────────────────────────────────
  {
    name: "crema_bulk_scrape_articles",
    description:
      "Enqueue a bulk article-scrape job across every published roaster (or a " +
      "subset via roaster_slugs[]). Discovers each roaster's blog feed " +
      "(Atom/RSS/sitemap/HTML), fetches articles, Haiku-enriches them, upserts " +
      "into roaster_articles. force_enrich=true re-enriches already-enriched " +
      "rows (use after a prompt change). Only one article_scrape job can be " +
      "in flight at a time — concurrent calls return 409.",
    schema: bulkScrapeArticlesSchema,
    handler: bulkScrapeArticles,
    idempotent: false,
  },
  {
    name: "crema_scrape_roaster_articles",
    description:
      "Per-roaster article scrape — same pipeline as crema_bulk_scrape_articles " +
      "but scoped to one slug. Shares the article_scrape job kind, so concurrent " +
      "calls (incl. across roasters) return 409.",
    schema: scrapeRoasterArticlesSchema,
    handler: scrapeRoasterArticles,
    idempotent: false,
  },
  {
    name: "crema_list_articles",
    description:
      "List roaster_articles for admin review. include_hidden=true (default) " +
      "shows published=0 rows; pass false to mirror the consumer-side filter. " +
      "Paginates via limit + offset.",
    schema: listArticlesSchema,
    handler: listArticles,
    readOnly: true,
  },
  {
    name: "crema_set_article_published",
    description:
      "Toggle consumer-visibility for an article. published=true = visible on " +
      "the Journal feed, false = hidden (admin-only). Row stays in DB either way; " +
      "use crema_delete_article for hard delete.",
    schema: setArticlePublishedSchema,
    handler: setArticlePublished,
    idempotent: true,
  },
  {
    name: "crema_delete_article",
    description:
      "Hard-delete an article row by id. Re-scraping the roaster re-inserts if " +
      "the URL still resolves (URL is the dedup key). Use only for truly stale " +
      "entries — for hiding, use crema_set_article_published.",
    schema: deleteArticleSchema,
    handler: deleteArticle,
    destructive: true,
  },
  // ── Products (re-enrich / sold-out / undo) ─────────────────────────────
  {
    name: "crema_reenrich_product",
    description:
      "Force re-enrichment for one product. Re-runs the full Haiku enricher and " +
      "overwrites the enrichment columns (coffee_name, origin, varietal, process, " +
      "roast_level, brew_recommendation_json, etc.). Use when initial enrichment " +
      "failed (enrichment_status='failed') or when a prompt change should be " +
      "applied to one row without a full re-scrape.",
    schema: reenrichProductSchema,
    handler: reenrichProduct,
    idempotent: false,  // creates an enrichment run, but the resulting row state is idempotent in spirit
  },
  {
    name: "crema_mark_product_sold_out",
    description:
      "Manually flip a product to available=0. Logged as a proposal against a " +
      "synthetic 'manual_sold_out' job so it's undoable via crema_undo_scrape_job " +
      "the same way scrape-driven changes are.",
    schema: markProductSoldOutSchema,
    handler: markProductSoldOut,
    destructive: false,
  },
  {
    name: "crema_undo_scrape_job",
    description:
      "Reverse every applied proposal from a scrape (or manual_sold_out) job. " +
      "Inserts get deleted (only if source='scraped' — roaster-claimed rows " +
      "survive); updates replay captured prev_state; sold-out flips back to " +
      "available=1. Backfilled rows lacking prev_state are skipped and reported. " +
      "Use when a scrape went sideways and you want to roll the catalog back " +
      "to its pre-job state.",
    schema: undoScrapeJobSchema,
    handler: undoScrapeJob,
    destructive: true,
  },
  // ── Jobs (log inspection / cancel) ─────────────────────────────────────
  {
    name: "crema_get_scrape_run_log",
    description:
      "Read the captured log tail + error_message for one job. Pairs with " +
      "crema_list_jobs (job metadata) for end-to-end debug context. The log " +
      "tail is the last N lines the runner emitted — enough to diagnose most " +
      "failures without needing the full stderr stream.",
    schema: getScrapeRunLogSchema,
    handler: getScrapeRunLog,
    readOnly: true,
  },
  {
    name: "crema_cancel_running_job",
    description:
      "Request cancellation of an in-flight job. Sticky-flag: sets " +
      "cancel_requested=1; the runner exits cleanly at its next per-source " +
      "checkpoint with whatever it has already committed (no half-scraped " +
      "rows — per-row commits in upsert_article guarantee a clean checkpoint). " +
      "Idempotent — flipping the flag on a terminal job is a no-op.",
    schema: cancelRunningJobSchema,
    handler: cancelRunningJob,
    idempotent: true,
  },
  // ── Phase 2 inspect / diagnose ─────────────────────────────────────────
  {
    name: "crema_get_product_detail",
    description:
      "Full products row for one product_id + the most recent scrape_proposals " +
      "row that touched it. Per-coffee debugging entry point — when an " +
      "enrichment looks wrong or a field is missing, start here. Use the " +
      "latest_proposal field to see what the scraper most-recently wanted " +
      "to write (proposed_state_json) and whether it was applied / rejected / " +
      "still pending.",
    schema: getProductDetailSchema,
    handler: getProductDetail,
    readOnly: true,
  },
  {
    name: "crema_delete_product",
    description:
      "Hard-delete one products row. User-side tables (shelf, tasting_notes) " +
      "hold product_id references that go stale — those don't cascade. For " +
      "'hide but keep history', use crema_mark_product_sold_out instead. Use " +
      "only for truly broken / mis-scraped rows.",
    schema: deleteProductSchema,
    handler: deleteProduct,
    destructive: true,
  },
  {
    name: "crema_get_raw_snapshot",
    description:
      "Return the raw crawl_snapshots payload (parsed JSON) for a roaster — " +
      "the storefront capture BEFORE the diff/join enrichment that " +
      "crema_get_snapshot applies. Use when the snapshot's `unknown` count " +
      "is high and you want to know what the crawler actually saw on the " +
      "site: products[], articles[], bio, platform, detected signatures. " +
      "Response can be large (kilobytes).",
    schema: getRawSnapshotSchema,
    handler: getRawSnapshot,
    readOnly: true,
  },
  {
    name: "crema_get_llm_job_detail",
    description:
      "Return the FULL llm_jobs row for one id, including the big payload " +
      "fields (system_prompt, user_content, tool_schema_json, " +
      "response_payload). Used to debug a specific job — failed (why? read " +
      "the error column + payload-at-failure) or complete (what did the " +
      "model produce?). Big response: payloads are kilobytes of text each. " +
      "Sister to crema_list_llm_jobs (which is paginated metadata-only " +
      "unless include_payloads=true).",
    schema: getLLMJobDetailSchema,
    handler: getLLMJobDetail,
    readOnly: true,
  },
  {
    name: "crema_requeue_llm_job",
    description:
      "Flip an in_progress or failed llm_job back to status='pending' so " +
      "crema_haiku_next_job can claim it fresh. Use for jobs stuck in " +
      "in_progress (drainer died mid-task) or transient failures worth " +
      "retrying. NOTE: if the parent enrichment pipeline died, the eventual " +
      "output goes nowhere — use crema_get_llm_job_detail to read the " +
      "response in that case. 409 if the job is pending or complete.",
    schema: requeueLLMJobSchema,
    handler: requeueLLMJob,
    idempotent: false,
  },
  {
    name: "crema_list_scrape_runs",
    description:
      "List recent scrape / article_scrape / manual_sold_out jobs with " +
      "proposal-count summaries (total / pending / applied / rejected per " +
      "job). Filters: roaster_slug (joins via product_id LIKE 'slug_%') and " +
      "kind. Use for 'show me scrape history for X' — the agent uses this " +
      "to walk back from a current issue to the run that produced it.",
    schema: listScrapeRunsSchema,
    handler: listScrapeRuns,
    readOnly: true,
  },
  {
    name: "crema_test_source_url",
    description:
      "Probe a URL for reachability + content metadata. Returns status, " +
      "content_type, final_url (post-redirect), html_title, elapsed_ms. " +
      "10s timeout. Use as a pre-flight sanity check before " +
      "crema_onboard_roaster — confirms the URL resolves to HTML the " +
      "scraper can consume.",
    schema: testSourceURLSchema,
    handler: testSourceURL,
    readOnly: true,
  },
  // ── Aggregate observability (MCP-purity gap closers) ───────────────────
  {
    name: "crema_catalog_stats",
    description:
      "Aggregate catalog state: total products, enriched/failed counts, " +
      "by-status breakdown, available yes/no, distinct source count. " +
      "Optional `slug` scopes to one roaster. Replaces the SQLite-bypass " +
      "that earlier sessions used to answer 'where is the catalog at?'.",
    schema: catalogStatsSchema,
    handler: catalogStats,
    readOnly: true,
  },
  {
    name: "crema_proposal_breakdown",
    description:
      "Group-by counts over scrape_proposals. group_by can be roaster_slug | " +
      "change_type | enrichment_status | status. Filters: status, change_type, " +
      "enrichment_filter (filters on the embedded enrichment_status in the " +
      "proposed state — most useful with enrichment_filter='failed' to find " +
      "held proposals stuck on Haiku errors). Replaces the SQLite-bypass for " +
      "'which roasters have held proposals?'.",
    schema: proposalBreakdownSchema,
    handler: proposalBreakdown,
    readOnly: true,
  },
  {
    name: "crema_freshness_report",
    description:
      "Per-roaster freshness — last_scraped_at + age buckets " +
      "(fresh ≤1d / stale >1d / stale >7d / never). Summary counts + per-row " +
      "data sorted with the most-stale first. Replaces the SQLite-bypass " +
      "for 'how stale is the catalog?'. Pair with crema_diff_sweep to decide " +
      "what to re-enrich.",
    schema: freshnessReportSchema,
    handler: freshnessReport,
    readOnly: true,
  },
  // ── Agent action log + memory (working journal) ────────────────────────
  {
    name: "crema_log_agent_action",
    description:
      "Append one entry to the agent's working journal. Granularity is " +
      "INTENTIONALLY coarse — one entry per meaningful phase (10-20 per " +
      "session), not per MCP tool call. Required: `action` (short label) + " +
      "`reasoning` (agent's prose explaining WHY). Optional `metadata` " +
      "(structured payload). The session timeline reconstructed from these " +
      "entries is what a human reads to follow what the agent actually " +
      "did and why — without the noise of every tool call. Call this " +
      "after diff_sweep, after enrich_all, after each drainer round, " +
      "after auto-approve, after any investigation.",
    schema: logAgentActionSchema,
    handler: logAgentAction,
    destructive: false,
  },
  {
    name: "crema_get_session_actions",
    description:
      "Read the agent action timeline. Filter by session_id (rebuilds " +
      "one session chronologically) or agent_identity (recent activity for " +
      "one operator) or since (everything after a timestamp). The agent " +
      "should call this at session start to see what previous sessions " +
      "did — institutional continuity without re-reading the full audit " +
      "log.",
    schema: getSessionActionsSchema,
    handler: getSessionActions,
    readOnly: true,
  },
  {
    name: "crema_log_agent_memory",
    description:
      "Preserve a durable lesson across sessions. Use when the agent " +
      "encounters a noise mode, workaround, or constraint worth teaching " +
      "future agents. Required: `scope` (domain bucket like " +
      "'catalog-ops' / 'scrape-noise' / 'wix-routing') + `lesson` " +
      "(short actionable takeaway). Optional `tags` (finer slicing). " +
      "Future agents read this at session start via crema_get_agent_memory " +
      "and inherit the lesson without needing the incident report. " +
      "Use sparingly — high-signal lessons only, not transient state.",
    schema: logAgentMemorySchema,
    handler: logAgentMemory,
    destructive: false,
  },
  {
    name: "crema_get_agent_memory",
    description:
      "Read durable lessons inherited from past sessions. Call at session " +
      "start (or when stuck) to load institutional knowledge. Optional " +
      "filters: scope (one domain) and tag (finer match). Reading bumps " +
      "each row's reference_count + last_referenced_at so the operator " +
      "can later see which lessons are still load-bearing vs vestigial " +
      "(pruning candidates).",
    schema: getAgentMemorySchema,
    handler: getAgentMemory,
    readOnly: true,
  },
];

async function main() {
  const server = new Server(
    { name: "crema-catalog-ops", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
      annotations: {
        readOnlyHint: t.readOnly ?? false,
        destructiveHint: t.destructive ?? false,
        idempotentHint: t.idempotent ?? false,
        openWorldHint: false,  // all tools talk to the same closed FastAPI backend
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    let input: unknown;
    try {
      input = tool.schema.parse(req.params.arguments ?? {});
    } catch (err) {
      const msg = err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : String(err);
      return {
        content: [{ type: "text", text: `Invalid arguments: ${msg}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(input);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Tool error: ${msg}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Minimal zod → JSON Schema converter. We avoid `zod-to-json-schema`
// to keep the dep tree slim — the MCP protocol needs JSON Schema for
// tool inputSchema; our schemas are simple enough to convert by hand.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def;
  const typeName: string = def.typeName;

  switch (typeName) {
    case "ZodObject": {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        const v = val as z.ZodTypeAny;
        properties[key] = zodToJsonSchema(v);
        if (!isOptional(v)) required.push(key);
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length) out.required = required;
      return out;
    }
    case "ZodString": {
      const out: Record<string, unknown> = { type: "string" };
      if (def.description) out.description = def.description;
      return out;
    }
    case "ZodNumber": {
      const out: Record<string, unknown> = {
        type: Number.isInteger(def.checks?.find((c: any) => c.kind === "int")) ? "integer" : "number",
      };
      const isInt = def.checks?.some((c: any) => c.kind === "int");
      if (isInt) out.type = "integer";
      const min = def.checks?.find((c: any) => c.kind === "min")?.value;
      const max = def.checks?.find((c: any) => c.kind === "max")?.value;
      if (min !== undefined) out.minimum = min;
      if (max !== undefined) out.maximum = max;
      if (def.description) out.description = def.description;
      return out;
    }
    case "ZodBoolean":
      return def.description
        ? { type: "boolean", description: def.description }
        : { type: "boolean" };
    case "ZodArray":
      return {
        type: "array",
        items: zodToJsonSchema(def.type),
        ...(def.description ? { description: def.description } : {}),
      };
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
        ...(def.description ? { description: def.description } : {}),
      };
    case "ZodOptional":
    case "ZodDefault":
      return zodToJsonSchema(def.innerType);
    case "ZodNullable":
      return { ...zodToJsonSchema(def.innerType), nullable: true };
    case "ZodEffects":
      return zodToJsonSchema(def.schema);
    case "ZodUnknown":
    case "ZodAny":
      // Default the schema to a free-form OBJECT — the most common
      // use for z.unknown() here is "an arbitrary JSON object" (the
      // Haiku-submit output payload). Don't default to "string" —
      // that caused the MCP-side serialiser to stringify dicts,
      // which broke the queue-path round-trip with AttributeError
      // on the consumer side. Pass-through objects: any keys/types.
      return {
        type: "object",
        description: def.description || `(${typeName} — arbitrary object)`,
        additionalProperties: true,
      };
    case "ZodRecord":
      return {
        type: "object",
        description: def.description || "Record / dict object",
        additionalProperties: true,
      };
    default:
      return { type: "string", description: `(zod type ${typeName} — narrow schema)` };
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const tn = (schema as any)._def?.typeName;
  return tn === "ZodOptional" || tn === "ZodDefault";
}

main().catch((err) => {
  console.error("Fatal MCP server error:", err);
  process.exit(1);
});
