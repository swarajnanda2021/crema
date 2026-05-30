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
  logAgentSummarySchema, diffSweepSchema,
  getHintsSchema, setDiffHintSchema, regenerateHintSchema,
  listJobsSchema, listAgentRunsSchema,
  haikuNextJobSchema, haikuSubmitSchema, listLLMJobsSchema,
  // lifecycle
  onboardRoasterSchema, deleteRoasterSchema, publishRoasterSchema, updateScrapeSettingsSchema,
  listSourcesSchema, deleteSourceSchema,
  // standardization
  standardizeStatsSchema, standardizeExemplarsSchema, standardizeRunSchema, regenerateExemplarsSchema,
  // flavor schemas
  listFlavorSchemasSchema, uploadFlavorSchemaSchema, activateFlavorSchemaSchema,
  // journal
  bulkScrapeArticlesSchema, scrapeRoasterArticlesSchema, listArticlesSchema,
  setArticlePublishedSchema, deleteArticleSchema,
  // products
  reenrichProductSchema, bulkReenrichRoasterSchema, fullReenrichRoasterSchema,
  reapStuckEnrichmentTasksSchema,
  reapStuckCatalogOperationsSchema,
  listQualityReviewsSchema, prepareT3ReviewSchema, applyT3CorrectionSchema, runQualityReviewSweepSchema, resolveQualityReviewSchema,
  dedupeProductsSchema,
  applyFiltersRetroSchema, urlHealthAuditSchema,
  listCatalogOperationsSchema, rollbackCatalogOperationSchema,
  markProductSoldOutSchema, setProductAvailableSchema, undoScrapeJobSchema,
  // article grading (M2)
  gradeArticlesSchema,
  // jobs
  getScrapeRunLogSchema, cancelRunningJobSchema,
  // phase 2 inspect / diagnose
  getProductDetailSchema, deleteProductSchema, getRawSnapshotSchema,
  getLLMJobDetailSchema, requeueLLMJobSchema, listScrapeRunsSchema,
  testSourceURLSchema,
  // aggregate observability (MCP-purity gap closers)
  catalogStatsSchema, catalogQualityAuditSchema, catalogPricePerGramSchema, freshnessReportSchema,
  listThinProductsSchema,
  // per-tier debug fetchers (Tier 1-4 ladder probes)
  fetchShopifyProductSchema, fetchPageTextSchema, renderPageSchema,
  // agent action log + memory
  logAgentActionSchema, getSessionActionsSchema,
  logAgentMemorySchema, getAgentMemorySchema, searchAgentMemorySchema,
  getRunbookSchema,
  // v2 enrichment_tasks observability
  listEnrichmentTasksSchema, enrichmentTasksBreakdownSchema,
  // impls
  listRoasters, getAllStatus, syncRoaster, syncAll, getSnapshot,
  enrichRoaster, enrichAll, logAgentSummary, diffSweep, getHints, setDiffHint, regenerateHint, listJobs,
  listAgentRuns,
  haikuNextJob, haikuSubmit, listLLMJobs,
  onboardRoaster, deleteRoaster, publishRoaster, updateScrapeSettings,
  listSources, deleteSource,
  standardizeStats, standardizeExemplars, standardizeRun, regenerateExemplars,
  listFlavorSchemas, uploadFlavorSchema, activateFlavorSchema,
  bulkScrapeArticles, scrapeRoasterArticles, listArticles,
  setArticlePublished, deleteArticle,
  reenrichProduct, bulkReenrichRoaster, fullReenrichRoaster,
  reapStuckEnrichmentTasks,
  reapStuckCatalogOperations,
  listQualityReviews, prepareT3Review, applyT3Correction, runQualityReviewSweep, resolveQualityReview,
  dedupeProducts,
  applyFiltersRetro, urlHealthAudit,
  listCatalogOperations, rollbackCatalogOperation,
  markProductSoldOut, setProductAvailable, undoScrapeJob,
  gradeArticles,
  getScrapeRunLog, cancelRunningJob,
  getProductDetail, deleteProduct, getRawSnapshot,
  getLLMJobDetail, requeueLLMJob, listScrapeRuns, testSourceURL,
  catalogStats, catalogQualityAudit, catalogPricePerGram, freshnessReport, listThinProducts,
  fetchShopifyProduct, fetchPageText, renderPage,
  logAgentAction, getSessionActions, logAgentMemory, getAgentMemory, searchAgentMemory,
  getRunbook,
  listEnrichmentTasks, enrichmentTasksBreakdown,
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
  // ── v2 enrichment_tasks observability ─────────────────────────────────
  {
    name: "crema_list_enrichment_tasks",
    description:
      "List rows from the v2 `enrichment_tasks` state machine — one row per " +
      "(url, kind) tracked through discovered → fetching → llm_pending → " +
      "enriched | failed | skipped. Use to inspect what the v2 pipeline " +
      "did (or didn't) on a per-URL basis. Filters: kind ('product' | " +
      "'article'), state, roaster_slug, extraction_provenance ('haiku' | " +
      "'haiku_site_hinted' | 'admin_manual' | 'bs4_fallback'), since " +
      "(ISO8601). Common queries: failed-state to surface stuck work, " +
      "bs4_fallback-provenance to find admin-review candidates, " +
      "state='skipped'+kind='product' to inspect what the two-stage " +
      "filter rejected. Replaces the proposals-table observability of " +
      "the v1 workflow.",
    schema: listEnrichmentTasksSchema,
    handler: listEnrichmentTasks,
    destructive: false,
  },
  {
    name: "crema_enrichment_tasks_breakdown",
    description:
      "Aggregate per-state / per-kind / per-provenance counts of " +
      "`enrichment_tasks` rows. One-shot health check: 'how many of my " +
      "v2 tasks are stuck in failed?', 'what fraction of my catalog " +
      "ran through Haiku vs bs4 fallback?'. Optional scope: roaster_slug, " +
      "since.",
    schema: enrichmentTasksBreakdownSchema,
    handler: enrichmentTasksBreakdown,
    destructive: false,
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
      "batches); bump `wait_seconds` to 120-180 for a full 96-roaster sweep. " +
      "Slug validation (2026-05-24 fix): unknown slugs (no roaster_profiles " +
      "row) are dropped upfront and surfaced in the response's " +
      "`unknown_slugs[]` array — `scope_count` now reflects only slugs that " +
      "actually ran, not the raw input length.",
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
      "Onboard a roaster by website URL. ASYNC pattern (2026-05-24 fix): " +
      "the route inserts a roaster_sources row immediately (if not already " +
      "on file), then enqueues a `roaster_enrich` background job that runs " +
      "Sonnet bio enrichment AND chains a catalog scrape job. Returns 202 " +
      "with {source_id, source_created, website, job_id, status: 'queued'}. " +
      "Poll /api/jobs/{job_id} for completion — the result_summary " +
      "contains {slug, name, website, scrape_job_id?}. Under the agent-" +
      "queue path (LLM_PROVIDER=claude_code_agent), the caller MUST also " +
      "drain crema_haiku_next_job / crema_haiku_submit while polling — the " +
      "BG task's Sonnet bio call queues a `bio` step llm_job that needs the " +
      "agent to respond. Idempotent on website — re-onboarding the same URL " +
      "no longer 409s; the bridge upserts both tables in place, repairing " +
      "any orphan source rows from prior incomplete attempts.",
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
    name: "crema_list_sources",
    description:
      "List `roaster_sources` rows for admin / orphan-detection. " +
      "Joins roaster_profiles by website so each row carries its " +
      "linked slug + published flag (null when no profile is linked " +
      "— the orphan signal). Filters: enabled, has_profile " +
      "(true = profiled, false = orphan), search (substring on name " +
      "+ website + shop_url). Use this to find orphan source rows " +
      "from incomplete onboards before crema_delete_source.",
    schema: listSourcesSchema,
    handler: listSources,
    readOnly: true,
  },
  {
    name: "crema_delete_source",
    description:
      "Hard-delete a `roaster_sources` row by numeric id. Does NOT " +
      "touch roaster_profiles or products. Use to clean up orphan " +
      "source rows from incomplete onboards (find them via " +
      "crema_list_sources with has_profile=false). For a full " +
      "roaster delete (profile + source + soft-archive), use " +
      "crema_delete_roaster instead.",
    schema: deleteSourceSchema,
    handler: deleteSource,
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
    name: "crema_bulk_reenrich_roaster",
    description:
      "Per-product bulk re-enrich (no sync, no hint regeneration, no " +
      "bio / article touch). Use this when the catalog URLs are " +
      "current and you only want to refresh the enrichment columns on " +
      "existing rows — e.g. after a prompt change against products " +
      "with enrichment_status='failed' or pre_v2. For the FULL " +
      "pipeline (sync to refresh URLs + regenerate hints + bio + " +
      "products + articles + standardize), use " +
      "crema_full_reenrich_roaster instead. Spawns a BG worker that " +
      "iterates the products table and calls the shared v2 helper " +
      "(page_fetcher with Playwright Tier 4 + Wix dropdown expansion + " +
      "INR/Rs price regex + Shopify variant augmentation + " +
      "existing_coffee_name hint). Each product blocks on the LLM " +
      "queue — spawn 3-5 drainer subagents in parallel for any " +
      "roaster with 10+ products. Returns a job_id you can poll via " +
      "crema_list_jobs (kind='bulk_reenrich') for progress + " +
      "log_tail. only_status='pre_v2' is the canonical filter for " +
      "healing the pre-v2 backlog (rows with enriched_at=NULL). " +
      "Concurrent-worker cap = 8 (semaphore, 2026-05-26).",
    schema: bulkReenrichRoasterSchema,
    handler: bulkReenrichRoaster,
    readOnly: false,
  },
  {
    name: "crema_full_reenrich_roaster",
    description:
      "Atomic FULL pipeline re-enrich for one roaster: sync " +
      "(refresh snapshot + detect URL changes from replatforming) → " +
      "bio enrich → product scrape with hint regeneration → article " +
      "scrape with article-hint regeneration → catalog-wide " +
      "standardize. ONE call, sequential pipeline in the background. " +
      "This is the 'bulk enrich' verb — what the orchestrator " +
      "CLAUDE.md should aim for. The PARTIAL crema_bulk_reenrich_roaster " +
      "only re-touches existing product rows; it skips sync (so stale " +
      "URLs from replatformed sites like Nandan → www.nandancoffee.com " +
      "linger), skips hint regeneration (so old per-roaster quirks " +
      "persist), and skips bio + article enrichment. Use full-reenrich " +
      "for any catalog-wide refresh sweep; use bulk-reenrich only when " +
      "you specifically want to touch existing product rows without " +
      "re-crawling. Returns 202 with the slug + queued flag; poll " +
      "crema_list_llm_jobs / crema_list_jobs for per-step progress. " +
      "Defaults: mode='tab2' (diff-only sync), regenerate_prompt=true, " +
      "regenerate_article_hint=true.",
    schema: fullReenrichRoasterSchema,
    handler: fullReenrichRoaster,
    readOnly: false,
  },
  {
    name: "crema_list_quality_reviews",
    description:
      "List rows from the quality_reviews table — the trust-but-verify " +
      "queue. Each row is a finding from the T1/T2/T3 review pipeline " +
      "(T1 = deterministic heuristic; T2 = Haiku adversarial reviewer; " +
      "T3 = Opus override). Common usage: " +
      "crema_list_quality_reviews({verdict:'confirmed'}) to surface " +
      "T2-confirmed hallucinations ready for T3 override. " +
      "crema_list_quality_reviews({verdict:'overridden'}) to read the " +
      "T3 lessons accumulated so far. Returns rows + a rollup of " +
      "verdict×tier counts.",
    schema: listQualityReviewsSchema,
    handler: listQualityReviews,
    readOnly: true,
  },
  {
    name: "crema_list_catalog_operations",
    description:
      "List the catalog_operations audit trail. Every state-mutating " +
      "catalog op (dedupe, delete_product, full_reenrich_roaster, " +
      "sync, scrape, standardize, onboard, …) logs a row with its " +
      "params, status, summary, and snapshots. Use this to triage " +
      "what's happened recently, find an operation to roll back, or " +
      "see why an op flagged in quality_reviews. Combine with " +
      "crema_list_quality_reviews({target_table:'catalog_operations'}) " +
      "to see the T1 anomaly findings alongside the operation history.",
    schema: listCatalogOperationsSchema,
    handler: listCatalogOperations,
    readOnly: true,
  },
  {
    name: "crema_rollback_catalog_operation",
    description:
      "Roll back a catalog operation by restoring every row it " +
      "mutated. Reads catalog_snapshots (the pre-mutation row state " +
      "captured before the op ran), reverses delete→insert, " +
      "update→restore-before-state, insert→delete in reverse order. " +
      "Idempotent — re-running on an already-rolled-back op is a " +
      "no-op. Use when T1 op anomaly flags surface a destructive " +
      "operation that shouldn't have happened (e.g. mass_delete on " +
      "a roaster whose storefront just had a 503, not a real wipe). " +
      "The operation row flips to status='rolled_back' with the " +
      "reason recorded on summary_json.",
    schema: rollbackCatalogOperationSchema,
    handler: rollbackCatalogOperation,
    destructive: true,
  },
  {
    name: "crema_dedupe_products",
    description:
      "Consolidate duplicate products. Three strategies: " +
      "'url_normalized' (default — catches www vs no-www, " +
      "/collections/all/ vs /, trailing slashes); 'url_exact' " +
      "(conservative — only same-string URLs); 'content_similarity' " +
      "(groups by roaster + normalized coffee_name + price_inr + " +
      "image_url — catches the Class D pattern where one bean is " +
      "published as N grind/brew-preference SKUs that the URL-" +
      "normalized strategy can't see). Picks a canonical row " +
      "(richest enrichment + most recent enriched_at), merges null " +
      "fields from siblings, re-points FKs in 9 dependent tables " +
      "with UNIQUE-constraint collision handling, then deletes the " +
      "sibling rows. ALWAYS run with dry_run=true first.",
    schema: dedupeProductsSchema,
    handler: dedupeProducts,
    destructive: true,
  },
  {
    name: "crema_apply_filters_retro",
    description:
      "Retroactive Stage 1 filter sweep. Re-applies the current " +
      "`is_url_excluded` rules to every available catalog row and " +
      "flips matches to `available=0, enrichment_status=" +
      "'filter_reject'`. Catalog membership re-evaluation that the " +
      "prior `_already_enriched` short-circuit was preventing — " +
      "rows inserted before filter rules tightened (e.g. 'taster " +
      "pack', 'blend duo', 'drip kit' added after the seed import) " +
      "are now flagged. Field values (price, weight, name, image) " +
      "are preserved; only `available` + `enrichment_status` flip. " +
      "Wraps in `catalog_operations` so rollback is available. " +
      "ALWAYS run with dry_run=true first.",
    schema: applyFiltersRetroSchema,
    handler: applyFiltersRetro,
    destructive: true,
  },
  {
    name: "crema_url_health_audit",
    description:
      "HEAD-check every available `products.product_url` and flip " +
      "persistent 404s to `available=0, enrichment_status='url_dead'`. " +
      "Cleans stale-URL zombies — roasters retire SKUs (Takaraa " +
      "`-takaraa-1-kg`), replatform (ffox/libertario migration), " +
      "or publish per-batch URLs that age out (Caffinary " +
      "`-roasted-on-DDMM` handles). Default 8-way parallel HEAD " +
      "requests; ~3-5 minutes for a 1500-row catalog. Network " +
      "errors and 5xx treated as transient (no mutation). Field " +
      "values preserved; only `available` + `enrichment_status` " +
      "flip. Wraps in `catalog_operations` for rollback. ALWAYS " +
      "run with dry_run=true first.",
    schema: urlHealthAuditSchema,
    handler: urlHealthAudit,
    destructive: true,
  },
  {
    name: "crema_run_quality_review_sweep",
    description:
      "Run T1 (and optionally T2) retroactively across already-" +
      "enriched catalog rows. CRITICAL after every bulk re-enrich " +
      "sweep — the inline T1+T2 wiring in enrichment_runner only " +
      "fires on the v2 path; the subprocess scrape path (which " +
      "crema_full_reenrich_roaster ultimately uses) bypasses it. " +
      "Without running this sweep after a bulk enrich, ~99% of " +
      "products skip quality review entirely. Uses the row's " +
      "description_raw as the 'page text' source (no live re-fetch). " +
      "Idempotent at the row level. Pair with active drainers if " +
      "run_t2=true (default) — T2 fires Haiku per flagged row.",
    schema: runQualityReviewSweepSchema,
    handler: runQualityReviewSweep,
    readOnly: false,
  },
  {
    name: "crema_prepare_t3_review",
    description:
      "Fetch T3 context bundles for the orchestrator to reason over. " +
      "T3 is ORCHESTRATOR-FIRED: this tool returns the data, the " +
      "orchestrator (you, the calling Claude session) decides what to " +
      "correct, then submits via crema_apply_t3_correction. No LLM " +
      "call happens server-side — the orchestrator IS the smarter " +
      "tier. Returns one bundle per (target row, all confirmed flags) " +
      "with the entity, roaster_name, description_raw, and the " +
      "confirmed_flags array (each with rule/field/evidence/" +
      "flagged_value + current_value_in_target for easy comparison). " +
      "Use crema_list_quality_reviews({verdict:'confirmed'}) first to " +
      "see what's queued; then crema_prepare_t3_review to get the " +
      "context; then reason over each bundle and call " +
      "crema_apply_t3_correction with your corrections + lesson.",
    schema: prepareT3ReviewSchema,
    handler: prepareT3Review,
    readOnly: true,
  },
  {
    name: "crema_apply_t3_correction",
    description:
      "Apply orchestrator-decided T3 corrections to one target row. " +
      "Call this AFTER reading a bundle from crema_prepare_t3_review " +
      "and reasoning about what each confirmed flag should become. " +
      "Each correction sets one field to a new value (or null to " +
      "clear). The lesson string is REQUIRED — T3's durable output " +
      "is the lesson, not just the correction; without lessons the " +
      "continuous-hardening loop doesn't close. The lesson should " +
      "describe (a) what the original enricher got wrong, (b) the " +
      "evidence in the page text that pointed to the correct value, " +
      "(c) what T1 heuristic or prompt edit would have caught it. " +
      "Persisted to every overridden quality_reviews row for the " +
      "next iteration.",
    schema: applyT3CorrectionSchema,
    handler: applyT3Correction,
    readOnly: false,
  },
  {
    name: "crema_resolve_quality_review",
    description:
      "Manually resolve one quality_reviews row — when the admin (human) " +
      "wants to set the verdict directly without T2/T3. Common: clear a " +
      "T1 false positive that T2 missed, or override a row inline without " +
      "invoking Opus for a single trivial case. For 'overridden', pass " +
      "corrected_value (or empty string to clear the field) and lesson " +
      "so the override participates in the prompt-hardening loop.",
    schema: resolveQualityReviewSchema,
    handler: resolveQualityReview,
    destructive: false,
  },
  {
    name: "crema_reap_stuck_enrichment_tasks",
    description:
      "Heal enrichment_tasks rows stuck at state='llm_pending'. " +
      "Sister to the L1 stuck-claim reaper (which heals llm_jobs " +
      "in_progress claims after 300s) — this one operates on the " +
      "higher-level enrichment_tasks state machine. Use when a " +
      "post-sweep audit surfaces stuck-pending rows (e.g. the " +
      "2026-05-26 audit found 21). Tasks where result_table + " +
      "result_id are set AND the target row exists get flipped to " +
      "'enriched' (state-machine straggler — the upsert DID land); " +
      "all others get flipped to 'failed' with last_error indicating " +
      "the reap. Idempotent — safe to run repeatedly. Run with " +
      "dry_run=true first to preview.",
    schema: reapStuckEnrichmentTasksSchema,
    handler: reapStuckEnrichmentTasks,
    readOnly: false,
  },
  {
    name: "crema_reap_stuck_catalog_operations",
    description:
      "Heal `catalog_operations` rows stuck at status='running'. " +
      "Sister to crema_reap_stuck_enrichment_tasks (which heals the " +
      "lower-level state machine) — this one operates on the parent " +
      "audit rows that wrap full_reenrich_roaster, sync_tab*, " +
      "standardize, scrape_one_roaster, etc. Symptom: bulk runs " +
      "accumulate phantom 'running' rows when the parent-op-" +
      "finalization step is missed (kids drain, parent marker " +
      "lingers). Default older_than_minutes=30 is conservative " +
      "because a real full_reenrich_roaster on a large roaster " +
      "takes 10+ minutes. Idempotent. Run with dry_run=true first " +
      "to preview which rows + per-kind counts get reaped.",
    schema: reapStuckCatalogOperationsSchema,
    handler: reapStuckCatalogOperations,
    readOnly: false,
  },
  {
    name: "crema_grade_articles",
    description:
      "Fire-and-forget editorial grading for a batch of roaster_articles. " +
      "Composes a 0-100 editorial_score per article from 5 sub-components: " +
      "Haiku-rated prose quality + sourcing specificity, plus deterministic " +
      "image richness + product cross-links (to this roaster's own catalog) " +
      "+ internal article cross-links (to other Crema articles). " +
      "Score drives the consumer 'Featured Articles' rail and roaster-" +
      "page article ordering. Optional slug scopes to one roaster; " +
      "only_unscored=true (default) skips articles that already have a " +
      "score. Returns a job_id you can poll via crema_list_jobs " +
      "(kind='grade_articles'). Each article blocks on the LLM queue " +
      "for one Haiku call (~3-5s), so spawn 3-5 drainer subagents in " +
      "parallel for any batch with 20+ articles. See " +
      "services/article_grader.py for the rubric.",
    schema: gradeArticlesSchema,
    handler: gradeArticles,
    readOnly: false,
  },
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
    name: "crema_set_product_available",
    description:
      "Set products.available to 1 or 0. The companion to " +
      "crema_mark_product_sold_out (which only hides, available=0): this " +
      "can also UN-HIDE an in-stock bean (available=1) that was wrongly " +
      "hidden, without a full re-enrich. Logged as a catalog_operations " +
      "row (kind='manual_set_available') with a pre-mutation snapshot so " +
      "it's undoable via crema_rollback_catalog_operation.",
    schema: setProductAvailableSchema,
    handler: setProductAvailable,
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
    name: "crema_catalog_quality_audit",
    description:
      "Single-shot cosmetic-bug audit across the products table. " +
      "Returns six categories: coffee_name junk (HTML entities, pipe-tails, " +
      "weight suffixes, ALL-CAPS), absurd prices (>100k INR for <500g — the " +
      "Vithai 9-lakh class), missing image_url per roaster, missing price_inr " +
      "per roaster, silent-empty (≥5 of 10 enrichment fields null on " +
      "enriched rows), denorm name drift (products.roaster_name vs " +
      "roaster_profiles.name). Each category carries a total + top sample " +
      "rows. Optional `slug` scopes to one roaster — useful to verify a " +
      "per-roaster re-enrich landed clean (cosmetic_bug_total → 0). " +
      "Replaces the prior session's habit of dumping a 122k-char " +
      "crema_list_thin_products payload to see what's broken.",
    schema: catalogQualityAuditSchema,
    handler: catalogQualityAudit,
    readOnly: true,
  },
  {
    name: "crema_catalog_price_per_gram",
    description:
      "Price-per-gram (₹/g) distribution + outlier audit over " +
      "consumer-visible beans (available=1). ₹/g is the normalized 'how " +
      "expensive is this bean really' axis that makes a 250g bag and a " +
      "100g micro-lot comparable. The catalog's ₹/g is heavy-tailed, so " +
      "outliers are flagged by DECILE BANDS (top/bottom band_pct%), not " +
      "Tukey fences. Returns: distribution (min/p10/q1/median/q3/p90/max + " +
      "band cuts); upper_band ('why so expensive per gram?' — usually " +
      "legit Geisha/small-lot, a blend here is the anomaly); lower_band " +
      "('why so cheap per gram?' — drip-bag/sample/wrong-variant-weight, " +
      "defect-rich); uncomputable (available=1 with ₹0/no-weight — the " +
      "real card defects, split by missing field). Read-only; pair with " +
      "crema_get_product_detail + fetch probes to root-cause each flag.",
    schema: catalogPricePerGramSchema,
    handler: catalogPricePerGram,
    readOnly: true,
  },
  {
    name: "crema_list_thin_products",
    description:
      "Find products with thin information content — N+ of 10 enrichment " +
      "fields null (origin, varietal, process, process_raw, roast_level, " +
      "tasting_notes, flavor_notes, altitude_masl, producer, roaster_blurb). " +
      "Surfaces the SILENT-EMPTY subset: status='enriched' rows that look " +
      "landed but contain nothing useful, because the scraper-side source " +
      "(body_html, page text) was too thin for Haiku to extract from. " +
      "Pair with status='enriched' to find these; status='failed' is the " +
      "loud subset already in crema_proposal_breakdown. Returns per-product " +
      "detail + per-platform + per-roaster rollups. Filling the MCP-purity " +
      "gap — earlier sessions had to SQL this directly.",
    schema: listThinProductsSchema,
    handler: listThinProducts,
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
  // ── Per-tier debug fetchers (probe one product, no re-enrich) ──────────
  {
    name: "crema_fetch_shopify_product",
    description:
      "Tier 1 probe — fetch one Shopify product's canonical " +
      "/products/{handle}.json. Returns title, vendor, body_html, tags, " +
      "variants, images, and the full raw product JSON. Resolves the " +
      "storefront base from `slug` (via roaster_sources) or accepts " +
      "explicit `website`. Use to verify body_html exists + has content " +
      "before suspecting a deeper enrichment issue. Returns 404 if the " +
      "handle doesn't exist on the store.",
    schema: fetchShopifyProductSchema,
    handler: fetchShopifyProduct,
    readOnly: true,
  },
  {
    name: "crema_fetch_page_text",
    description:
      "Tier 2-3 probe — fetch a product page, return combined JSON-LD " +
      "structured data + cleaned visible body text (same string the " +
      "ladder feeds to Haiku). Length is the key signal: 0 = page " +
      "UNREACHABLE (timeout/4xx/parse error), low hundreds = sparse " +
      "merchant copy, thousands+ = rich source the ladder can work with. " +
      "Wix URLs auto-route through the hybrid Wix fetcher.",
    schema: fetchPageTextSchema,
    handler: fetchPageText,
    readOnly: true,
  },
  {
    name: "crema_render_page",
    description:
      "Tier 4 probe — Playwright headless render with 4s post-DOM " +
      "settle. Bounded to 3 concurrent renders process-wide. Use SPARINGLY " +
      "— this is the expensive escalation when Tiers 1-3 yielded thin " +
      "content (custom JS-rendered descriptions, metafield-driven blocks). " +
      "Returns the rendered HTML; 0 length means render failed (Playwright " +
      "not installed, timeout, or page hard-refused). 503 if all 3 render " +
      "slots are busy after 120s.",
    schema: renderPageSchema,
    handler: renderPage,
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
  {
    name: "crema_get_runbook",
    description:
      "Fetch the catalog-ops runbook (full or by verb slug). The " +
      "runbook lives outside the auto-loaded session-start context to " +
      "keep the orchestrator's working memory budget cheap; this tool " +
      "fetches sections on demand. Without args: returns full doc + " +
      "list of available slugs. With verb: returns matching section(s) " +
      "by slug or title substring. Use when you hit an unfamiliar " +
      "verb in the user's prompt OR when you need depth on a verb the " +
      "TOC in CLAUDE.md mentions.",
    schema: getRunbookSchema,
    handler: getRunbook,
    readOnly: true,
  },
  {
    name: "crema_search_agent_memory",
    description:
      "Top-k lazy lookup against agent_memory. PREFER this over " +
      "crema_get_agent_memory for context-rot reasons — returning 3 " +
      "matching lessons (default k=3) costs ~10x less working memory " +
      "than dumping all 50+ rows. Use a 3-7 word query describing the " +
      "lesson you need. e.g. 'wix sold-out variant', 'standardize lock " +
      "regression', 'haiku barrel-aged varietal'. Scope/tag pre-filters " +
      "narrow the search. Reading bumps reference_count so the " +
      "operator can later see which lessons are still load-bearing.",
    schema: searchAgentMemorySchema,
    handler: searchAgentMemory,
    readOnly: true,
  },
];

const SERVER_INSTRUCTIONS = `
Crema catalog-ops MCP. Operates the catalog for an Indian specialty
coffee discovery platform. EVERY catalog operation goes through this
server — no shell, no curl, no direct SQL, no file reads of catalog
state. If a capability you need isn't surfaced as a tool here, surface
that to the user rather than bypassing.

## How the queue + drainer pattern works

Enrichment routes (crema_enrich_roaster, crema_enrich_all,
crema_sync_*, crema_reenrich_product) enqueue Haiku LLM tasks in
llm_jobs and return quickly. You — the agent — drain those jobs.
Spawn 3-5 drainer subagents in parallel, each capped at ~8-10 jobs,
each looping crema_haiku_next_job → produce structured output
matching the job's tool_schema → crema_haiku_submit. Atomic claim is
race-safe across drainers. There is NO server-side SDK fallback —
that path is reserved for the human admin's UI button clicks.
Drainers must produce the FULL structured output (every schema field)
per claim, not under-emit.

## Common workflows

Refresh today's catalog:
  crema_diff_sweep → crema_enrich_all({filter:{has_diff:true}}) →
  spawn drainers → crema_auto_approve_proposals →
  crema_resolve_held_proposals → crema_log_agent_summary

Onboard a roaster:
  crema_onboard_roaster({website,...}) →
  crema_enrich_roaster({slug}) → drain →
  crema_auto_approve_proposals({slug}) → crema_publish_roaster

Investigate a thin or problematic product:
  crema_list_thin_products → crema_fetch_shopify_product or
  crema_fetch_page_text or crema_render_page → crema_reenrich_product
  if the source actually has recoverable data

## Voice for journal entries

Plain English, narrating to a colleague. Good: "Refreshed 12 stale
roasters; three came back with no specs because their product pages
don't list origin or altitude. The rest enriched cleanly." Bad:
"Triggered enrich_all over has_diff=true filter; spawned 4 BG tasks;
drainer-A processed 8 jobs..."

One entry per meaningful phase, not per tool call. severity='warn'
for crawl failures or unexpected skips; 'error' for hard blockers.

## On session start

Call crema_get_agent_memory({scope: "catalog-ops"}) and
crema_get_session_actions({limit: 30}) to inherit prior work and
durable lessons before planning your moves.
`.trim();

async function main() {
  const server = new Server(
    { name: "crema-catalog-ops", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
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
