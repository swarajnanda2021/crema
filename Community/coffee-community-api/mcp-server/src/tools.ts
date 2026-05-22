/**
 * Catalog ops tool implementations. Each tool is a thin wrapper over
 * an existing FastAPI endpoint, with audit logging baked in.
 *
 * Tool naming convention: `crema_<verb>_<resource>` — same prefix
 * across the whole org's MCP surface so future moderation /
 * onboarding / curation tools sit cleanly alongside these.
 *
 * Schema is Zod-defined for input validation. Output is the unwrapped
 * `data` payload from the FastAPI envelope. Errors propagate as MCP
 * tool errors (caller sees the actionable message).
 */

import { z } from "zod";
import { call, unwrap } from "./client.js";
import { audited } from "./audit.js";

// ── Roaster discovery ──────────────────────────────────────────────────────

export const listRoastersSchema = z.object({
  search: z.string().optional().describe("Substring match on name/slug/website"),
  limit: z.number().int().min(1).max(500).default(500).describe("Max rows to return"),
});
export type ListRoastersInput = z.infer<typeof listRoastersSchema>;

export async function listRoasters(input: ListRoastersInput) {
  return audited("crema_list_roasters", input, async () => {
    const rows = unwrap<any[]>(
      await call("/roaster_profiles", { query: { limit: input.limit } }),
    );
    const q = (input.search || "").trim().toLowerCase();
    const published = rows.filter((r) => r.published === 1);
    const filtered = q
      ? published.filter(
          (r) =>
            (r.name || "").toLowerCase().includes(q) ||
            (r.roaster_slug || "").toLowerCase().includes(q) ||
            (r.website || "").toLowerCase().includes(q),
        )
      : published;
    return filtered.map((r) => ({
      slug: r.roaster_slug,
      name: r.name,
      city: r.city,
      state: r.state,
      website: r.website,
      products_count: r.products_count || 0,
      published: !!r.published,
    }));
  });
}

// ── Orchestrator dashboard ─────────────────────────────────────────────────

export const getAllStatusSchema = z.object({
  has_diff: z.boolean().optional().describe("Filter to roasters with non-zero diff vs prev snapshot"),
  has_snapshot: z.boolean().optional().describe("Filter to roasters that have been synced at least once"),
  platform: z.string().optional().describe("Filter to one platform (shopify, wordpress, generic, unknown)"),
  missing_article_hint: z.boolean().optional().describe("Filter to roasters without article_enrichment_prompt_hint"),
});
export type GetAllStatusInput = z.infer<typeof getAllStatusSchema>;

export async function getAllStatus(input: GetAllStatusInput) {
  return audited(
    "crema_get_all_status",
    input,
    async () => {
      const rows = unwrap<{ roasters: any[] }>(
        await call("/admin/sync/all-status"),
      ).roasters;
      const filtered = rows.filter((r) => {
        if (input.has_snapshot !== undefined && r.has_snapshot !== input.has_snapshot) return false;
        if (input.platform && (r.platform || "unknown") !== input.platform) return false;
        if (input.missing_article_hint === true && r.article_hint_present) return false;
        if (input.missing_article_hint === false && !r.article_hint_present) return false;
        const totalDiff =
          r.products_added + r.products_updated + r.products_removed +
          r.articles_added + r.articles_updated + r.articles_removed +
          (r.bio_changed ? 1 : 0);
        if (input.has_diff === true && totalDiff === 0) return false;
        if (input.has_diff === false && totalDiff > 0) return false;
        return true;
      });
      return { count: filtered.length, roasters: filtered };
    },
    (r) => `${r.count} roasters matched`,
  );
}

// ── Sync (crawl + snapshot + stage bundles) ────────────────────────────────

export const syncRoasterSchema = z.object({
  slug: z.string().describe("Roaster slug to sync"),
  mode: z.enum(["tab1", "tab2"]).default("tab2").describe(
    "tab1 = full crawl + stage every entity (cold start / re-baseline). " +
    "tab2 = diff vs last snapshot + stage only changes (steady-state).",
  ),
});
export type SyncRoasterInput = z.infer<typeof syncRoasterSchema>;

export async function syncRoaster(input: SyncRoasterInput) {
  return audited("crema_sync_roaster", input, async () =>
    unwrap(await call(`/admin/sync/${encodeURIComponent(input.slug)}`, {
      method: "POST",
      body: { mode: input.mode },
    })),
  );
}

export const syncAllSchema = z.object({
  slugs: z.array(z.string()).optional().describe(
    "Roasters to sync. If omitted, syncs every published roaster.",
  ),
  mode: z.enum(["tab1", "tab2"]).default("tab2").describe(
    "tab1 = full crawl + stage everything. tab2 = diff vs prev (default).",
  ),
});
export type SyncAllInput = z.infer<typeof syncAllSchema>;

export async function syncAll(input: SyncAllInput) {
  return audited(
    "crema_sync_all",
    input,
    async () => {
      let slugs = input.slugs;
      if (!slugs || slugs.length === 0) {
        const rows = unwrap<any[]>(
          await call("/roaster_profiles", { query: { limit: 500 } }),
        );
        slugs = rows.filter((r) => r.published === 1).map((r) => r.roaster_slug);
      }
      return unwrap(
        await call("/admin/sync-bulk", {
          method: "POST",
          body: { slugs, mode: input.mode },
        }),
      );
    },
    (r: any) => `accepted ${r.accepted} slugs in ${r.mode} mode`,
  );
}

export const getSnapshotSchema = z.object({
  slug: z.string().describe("Roaster slug"),
});
export type GetSnapshotInput = z.infer<typeof getSnapshotSchema>;

export async function getSnapshot(input: GetSnapshotInput) {
  return audited("crema_get_snapshot", input, async () =>
    unwrap(await call(`/admin/sync/${encodeURIComponent(input.slug)}/snapshot`)),
  );
}

// ── Enrichment (bio Sonnet + catalog Haiku + article Haiku) ────────────────

export const enrichRoasterSchema = z.object({
  slug: z.string().describe("Roaster slug to refresh end-to-end"),
  regenerate_prompt: z.boolean().default(false).describe(
    "Force regeneration of the per-roaster bio+bean site prompt addendum after the run.",
  ),
  regenerate_article_hint: z.boolean().default(false).describe(
    "Force regeneration of the per-roaster article (journal) prompt addendum after the run.",
  ),
});
export type EnrichRoasterInput = z.infer<typeof enrichRoasterSchema>;

export async function enrichRoaster(input: EnrichRoasterInput) {
  return audited("crema_enrich_roaster", input, async () =>
    unwrap(await call(`/admin/roasters/${encodeURIComponent(input.slug)}/refresh-all`, {
      method: "POST",
      body: {
        regenerate_prompt: input.regenerate_prompt,
        regenerate_article_hint: input.regenerate_article_hint,
      },
    })),
  );
}

export const enrichAllSchema = z.object({
  slugs: z.array(z.string()).optional().describe(
    "Roasters to refresh. If omitted, refreshes every published roaster.",
  ),
  filter: z.object({
    has_diff: z.boolean().optional(),
    has_snapshot: z.boolean().optional(),
    platform: z.string().optional(),
    missing_article_hint: z.boolean().optional(),
  }).optional().describe("Alternative to passing slugs: derive slugs from all-status with these filters."),
  regenerate_prompt: z.boolean().default(false),
  regenerate_article_hint: z.boolean().default(false),
});
export type EnrichAllInput = z.infer<typeof enrichAllSchema>;

export async function enrichAll(input: EnrichAllInput) {
  return audited(
    "crema_enrich_all",
    input,
    async () => {
      let slugs = input.slugs;
      if (!slugs || slugs.length === 0) {
        // Derive from filter
        const f = input.filter || {};
        const filtered = await getAllStatus(f);
        slugs = (filtered.roasters as any[]).map((r) => r.slug);
      }
      if (slugs.length === 0) {
        return { accepted: 0, slugs: [], note: "no roasters matched filter" };
      }
      return unwrap(
        await call("/admin/roasters/refresh-all-bulk", {
          method: "POST",
          body: {
            slugs,
            regenerate_prompt: input.regenerate_prompt,
            regenerate_article_hint: input.regenerate_article_hint,
          },
        }),
      );
    },
    (r: any) => `accepted ${r.accepted} slugs for full refresh`,
  );
}

// ── Proposals (the approve/reject queue) ───────────────────────────────────

export const listProposalsSchema = z.object({
  slug: z.string().optional().describe(
    "Filter to one roaster — backend filters via product_id LIKE 'slug_%'. " +
    "Now actually honored (was silently ignored pre-2026-05-21).",
  ),
  status: z.enum(["pending", "applied", "rejected", "reverted"]).default("pending"),
  limit: z.number().int().min(1).max(5000).default(100).describe(
    "Cap on rows. Default 100; max 5000. Now actually honored by backend.",
  ),
});
export type ListProposalsInput = z.infer<typeof listProposalsSchema>;

export async function listProposals(input: ListProposalsInput) {
  return audited("crema_list_proposals", input, async () => {
    const q: Record<string, string | number> = {
      status: input.status,
      limit: input.limit,
    };
    if (input.slug) q.roaster_slug = input.slug;
    const rows = unwrap<any[]>(await call("/admin/scrape/proposals", { query: q }));
    return rows;
  });
}

// ── Aggregate observability tools (eliminate SQLite-bypass leaks) ────────
//
// These four tools surface aggregate state previously only accessible via
// direct SQL queries — closing the gap that broke MCP-purity in earlier
// sessions. Provider-portable: any LLM operator using the MCP gets the
// same aggregate signal without needing DB access.

export const catalogStatsSchema = z.object({
  slug: z.string().optional().describe(
    "Optional roaster slug — scope stats to that roaster's products only. " +
    "Empty = catalog-wide.",
  ),
});
export type CatalogStatsInput = z.infer<typeof catalogStatsSchema>;

export async function catalogStats(input: CatalogStatsInput) {
  return unwrap(
    await call("/admin/catalog/stats", {
      query: input.slug ? { roaster_slug: input.slug } : {},
    }),
  );
}

export const listThinProductsSchema = z.object({
  slug: z.string().optional().describe(
    "Filter to one roaster. Empty = catalog-wide.",
  ),
  min_null_count: z.number().int().min(0).max(10).default(5).describe(
    "Threshold for 'thin' across 10 enrichment fields (origin, varietal, " +
    "process, process_raw, roast_level, tasting_notes, flavor_notes, " +
    "altitude_masl, producer, roaster_blurb). Default 5 = half empty. " +
    "Bump to 6+ for majority-null, 8+ for catastrophically empty.",
  ),
  status: z.enum(["enriched", "failed", "pending"]).optional().describe(
    "Filter by enrichment_status. " +
    "'enriched' = silent empties (status looks done but row is hollow). " +
    "'failed' = loud empties (same set crema_proposal_breakdown surfaces). " +
    "Omit to see everything.",
  ),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type ListThinProductsInput = z.infer<typeof listThinProductsSchema>;

export async function listThinProducts(input: ListThinProductsInput) {
  return audited(
    "crema_list_thin_products",
    input,
    async () =>
      unwrap(await call("/admin/catalog/thin-products", {
        query: {
          slug: input.slug,
          min_null_count: input.min_null_count,
          status: input.status,
          limit: input.limit,
        },
      })),
    (r: any) =>
      `${r?.total ?? 0} thin products; top platforms: ` +
      (r?.rollups?.by_platform ?? []).slice(0, 3)
        .map((b: any) => `${b.platform}=${b.count}`).join(" "),
  );
}

// ── Per-tier debug fetchers (Tier 1-4 ladder, individually probeable) ──
//
// The dynamic extraction ladder runs as one fused pipeline during
// enrichment. These three tools expose each tier as a standalone
// diagnostic surface — probe one product end-to-end without burning a
// re-enrich cycle. Use when crema_list_thin_products surfaces a
// silent-empty row and you need to know WHY: is the page reachable?
// Does it have a body_html? Does Tier 4 render unlock anything Tier 3
// missed?

export const fetchShopifyProductSchema = z.object({
  handle: z.string().describe(
    "Shopify product handle (the slug after /products/ in the URL). " +
    "E.g. for https://store.com/products/brown-gold the handle is 'brown-gold'.",
  ),
  slug: z.string().optional().describe(
    "Roaster slug — looks up the storefront base from roaster_sources. " +
    "Either slug OR website is required.",
  ),
  website: z.string().optional().describe(
    "Explicit storefront base URL (e.g. https://store.com). " +
    "Use when probing a roaster not yet in roaster_profiles. " +
    "Either slug OR website is required.",
  ),
});
export type FetchShopifyProductInput = z.infer<typeof fetchShopifyProductSchema>;

export async function fetchShopifyProduct(input: FetchShopifyProductInput) {
  return audited(
    "crema_fetch_shopify_product",
    input,
    async () =>
      unwrap(await call("/admin/scrape/shopify-product", {
        query: {
          handle: input.handle,
          slug: input.slug,
          website: input.website,
        },
      })),
    (r: any) =>
      `${r?.title ?? "?"} from ${r?.vendor ?? "?"}; ` +
      `body_html=${(r?.body_html ?? "").length}ch, ` +
      `${(r?.variants ?? []).length} variants, ` +
      `${(r?.images ?? []).length} images`,
  );
}

export const fetchPageTextSchema = z.object({
  url: z.string().describe(
    "Full product detail page URL. Runs Tier 2-3 of the ladder: " +
    "JSON-LD extraction + cleaned visible body text. Wix URLs auto-route " +
    "through the Wix hybrid fetcher (Playwright fallback built in there).",
  ),
});
export type FetchPageTextInput = z.infer<typeof fetchPageTextSchema>;

export async function fetchPageText(input: FetchPageTextInput) {
  return audited(
    "crema_fetch_page_text",
    input,
    async () =>
      unwrap(await call("/admin/scrape/page-text", {
        query: { url: input.url },
      })),
    (r: any) => {
      const n = r?.length ?? 0;
      const label = n === 0 ? "UNREACHABLE" :
        n < 500 ? "sparse" :
        n < 2000 ? "moderate" : "rich";
      return `${n}ch (${label})`;
    },
  );
}

export const renderPageSchema = z.object({
  url: z.string().describe(
    "Full page URL. Tier 4 — Playwright headless render with 4s post-DOM " +
    "settle. Bounded to 3 concurrent renders process-wide; a flood will " +
    "queue. Use sparingly — this is the expensive escalation when Tiers " +
    "1-3 yielded thin content (custom JS-rendered descriptions, " +
    "metafield-driven blocks that don't surface in body_html).",
  ),
});
export type RenderPageInput = z.infer<typeof renderPageSchema>;

export async function renderPage(input: RenderPageInput) {
  return audited(
    "crema_render_page",
    input,
    async () =>
      unwrap(await call("/admin/scrape/render-page", {
        method: "POST",
        body: { url: input.url },
      })),
    (r: any) => {
      const n = r?.length ?? 0;
      const label = n === 0 ? "RENDER FAILED" :
        n < 5000 ? "small" :
        n < 50000 ? "medium" : "large";
      return `${n}ch HTML (${label})`;
    },
  );
}

export const proposalBreakdownSchema = z.object({
  group_by: z.enum([
    "roaster_slug", "change_type", "enrichment_status", "status",
  ]).default("roaster_slug").describe(
    "Aggregation key. 'roaster_slug' = group by roaster (most common use). " +
    "'enrichment_status' = bucket by Haiku outcome embedded in the proposed " +
    "state — useful to count held-with-failed vs ready-to-approve.",
  ),
  status: z.string().optional().describe(
    "Proposal status filter. Default 'pending'. Empty = all statuses.",
  ),
  change_type: z.string().optional().describe(
    "Filter by change_type: insert | update | mark_sold_out | restore_available.",
  ),
  enrichment_filter: z.enum(["enriched", "failed", "null"]).optional().describe(
    "Filter to proposals whose embedded enrichment_status matches. " +
    "Most useful: enrichment_filter='failed' returns proposals stuck due to Haiku errors.",
  ),
});
export type ProposalBreakdownInput = z.infer<typeof proposalBreakdownSchema>;

export async function proposalBreakdown(input: ProposalBreakdownInput) {
  return audited(
    "crema_proposal_breakdown",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/breakdown", {
        query: {
          group_by: input.group_by,
          status: input.status ?? "pending",
          change_type: input.change_type,
          enrichment_filter: input.enrichment_filter,
        },
      })),
    (r: any) =>
      `${r?.total ?? 0} proposals across ${r?.buckets?.length ?? 0} buckets ` +
      `grouped by ${r?.group_by}`,
  );
}

export const freshnessReportSchema = z.object({});
export type FreshnessReportInput = z.infer<typeof freshnessReportSchema>;

export async function freshnessReport(_input: FreshnessReportInput) {
  return audited(
    "crema_freshness_report",
    {},
    async () => unwrap(await call("/admin/roasters/freshness")),
    (r: any) => {
      const s = r?.summary ?? {};
      return `fresh≤1d: ${s.fresh_le_1d ?? 0}, stale>1d: ${s.stale_gt_1d ?? 0}, ` +
             `stale>7d: ${s.stale_gt_7d ?? 0}, never: ${s.never_scraped ?? 0}`;
    },
  );
}

// ── Agent action log + memory ──────────────────────────────────────────────
//
// The working journal: timestamped per-phase log within a session +
// durable lessons across sessions. Granularity for actions is
// INTENTIONALLY coarser than crema_list_agent_runs (which captures
// every tool call). One log_agent_action per meaningful decision.
// 10-20 entries per session, not 250.

export const logAgentActionSchema = z.object({
  action: z.string().min(1).describe(
    "Short label — what the agent did. Examples: 'diff_sweep', " +
    "'enrich_all on 10 stale roasters', 'spawned drainer L', " +
    "'investigated humble-express deletions'. Aim for one entry per " +
    "meaningful phase, not per MCP tool call.",
  ),
  reasoning: z.string().min(1).describe(
    "Agent's own prose explaining WHY this action was taken. Examples: " +
    "'Diff sweep showed 14 stale, 10 non-Wix actionable. These had real " +
    "product/article deltas worth processing.' " +
    "or 'Drainer K left 3 in_progress claims that blocked scrapes for 30 min. " +
    "Requeueing to clear the bottleneck.' " +
    "The reasoning is the value — without it the action log is just noise.",
  ),
  metadata: z.record(z.unknown()).optional().describe(
    "Optional structured payload — slugs touched, counts, decision " +
    "inputs, anything that adds quantitative context to the prose.",
  ),
  session_id: z.string().optional().describe(
    "Session identifier. If omitted, the MCP server's CREMA_SESSION_ID " +
    "is used. Same value across all calls in one session so the " +
    "timeline can be reconstructed.",
  ),
  agent_identity: z.string().optional().describe(
    "Optional override of the MCP server's CREMA_AGENT_IDENTITY.",
  ),
  severity: z.enum(["info", "warn", "error"]).optional().describe(
    "Importance level — 'info' (default) for normal progress, 'warn' " +
    "for recoverable issues (crawl failures, drainer-fallback events, " +
    "held proposals retried), 'error' for hard failures the operator " +
    "should investigate. Used by UIs and crema_get_session_actions to " +
    "highlight entries the agent should re-read.",
  ),
});
export type LogAgentActionInput = z.infer<typeof logAgentActionSchema>;

export async function logAgentAction(input: LogAgentActionInput) {
  // Not audited — logging an action shouldn't itself produce an
  // audit row, otherwise we recurse into noise.
  const { identity: id } = await import("./client.js");
  return unwrap(await call("/admin/agent-actions", {
    method: "POST",
    body: {
      session_id: input.session_id ?? id.session,
      agent_identity: input.agent_identity ?? id.agent,
      action: input.action,
      reasoning: input.reasoning,
      metadata: input.metadata,
      severity: input.severity,
    },
  }));
}

export const getSessionActionsSchema = z.object({
  session_id: z.string().optional().describe(
    "Filter to one session. If omitted, returns recent actions across " +
    "all sessions (use to scan recent activity).",
  ),
  agent_identity: z.string().optional().describe(
    "Filter to one agent identity (e.g. 'crema-catalog-ops@claude-haiku-4-5').",
  ),
  since: z.string().optional().describe(
    "ISO8601 timestamp — only entries with ts >= since.",
  ),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type GetSessionActionsInput = z.infer<typeof getSessionActionsSchema>;

export async function getSessionActions(input: GetSessionActionsInput) {
  return unwrap(await call("/admin/agent-actions", {
    query: {
      session_id: input.session_id,
      agent_identity: input.agent_identity,
      since: input.since,
      limit: input.limit,
    },
  }));
}

export const logAgentMemorySchema = z.object({
  scope: z.string().min(1).describe(
    "Domain bucket for the lesson. Conventions: 'catalog-ops', " +
    "'scrape-noise', 'wix-routing', 'drainer-discipline', " +
    "'enrichment-quality'. Free-form but be consistent so future " +
    "agents can filter by scope.",
  ),
  lesson: z.string().min(1).describe(
    "Short actionable takeaway, one or two sentences. Future agents " +
    "read this and inherit the lesson without needing the original " +
    "incident report. Examples: 'Shopify /products.json sometimes " +
    "returns empty under rate-limit; retry once with 2s backoff before " +
    "treating as authoritative.' or 'Wix homepages from this IP block " +
    "have intermittent TLS failures — leave them for tomorrow rather " +
    "than retrying same-day.'",
  ),
  tags: z.array(z.string()).optional().describe(
    "Finer-grained slicing within scope. Lower-case, short. Example " +
    "tags: 'shopify', 'rate-limit', 'wix', 'tls', 'drainer'.",
  ),
  source_session_id: z.string().optional().describe(
    "Link to the session where this lesson was learned.",
  ),
  source_summary_id: z.number().int().optional().describe(
    "FK to agent_summaries(id) — the summary that produced this lesson.",
  ),
});
export type LogAgentMemoryInput = z.infer<typeof logAgentMemorySchema>;

export async function logAgentMemory(input: LogAgentMemoryInput) {
  return audited(
    "crema_log_agent_memory",
    { scope: input.scope, tag_count: input.tags?.length ?? 0 },
    async () => unwrap(await call("/admin/agent-memory", {
      method: "POST",
      body: input,
    })),
    (r: any) => `logged memory id=${r?.id} scope=${r?.scope}`,
  );
}

export const getAgentMemorySchema = z.object({
  scope: z.string().optional().describe(
    "Filter to one scope. Omit to scan all scopes (read at session " +
    "start for full institutional context).",
  ),
  tag: z.string().optional().describe(
    "Filter to lessons containing this tag.",
  ),
  limit: z.number().int().min(1).max(500).default(50),
});
export type GetAgentMemoryInput = z.infer<typeof getAgentMemorySchema>;

export async function getAgentMemory(input: GetAgentMemoryInput) {
  // Reading bumps reference_count on each returned row — track which
  // lessons are still load-bearing.
  return unwrap(await call("/admin/agent-memory", {
    query: {
      scope: input.scope,
      tag: input.tag,
      limit: input.limit,
    },
  }));
}

export const approveProposalsSchema = z.object({
  ids: z.array(z.number().int()).min(1).describe("Scrape-proposal IDs to approve (merge to live products)"),
});
export type ApproveProposalsInput = z.infer<typeof approveProposalsSchema>;

export async function approveProposals(input: ApproveProposalsInput) {
  return audited(
    "crema_approve_proposals",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/approve", {
        method: "POST",
        body: { ids: input.ids },
      })),
    (r: any) => `applied ${r.applied}, skipped ${r.skipped}`,
  );
}

export const autoApproveProposalsSchema = z.object({
  slug: z.string().optional().describe(
    "Scope to one roaster (default: all). Matches via product_id LIKE '<slug>_%'.",
  ),
  since: z.string().optional().describe(
    "ISO8601 — only proposals created at/after this timestamp.",
  ),
  dry_run: z.boolean().default(false).describe(
    "Return counts only, don't mutate. Use to preview the policy outcome.",
  ),
});
export type AutoApproveProposalsInput = z.infer<typeof autoApproveProposalsSchema>;

export async function autoApproveProposals(input: AutoApproveProposalsInput) {
  return audited(
    "crema_auto_approve_proposals",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/auto-approve", {
        method: "POST",
        body: {
          slug: input.slug,
          since: input.since,
          dry_run: input.dry_run,
        },
      })),
    (r: any) =>
      `approved ${r.approved}, applied_thin ${r.applied_thin ?? 0}, ` +
      `rejected ${r.rejected}, held ${r.held_for_review ?? 0}, ` +
      `skipped ${r.skipped}${r.dry_run ? " (dry-run)" : ""}`,
  );
}

export const resolveHeldProposalsSchema = z.object({
  slug: z.string().optional().describe(
    "Scope to one roaster. Matches via product_id LIKE '<slug>_%'.",
  ),
  limit: z.number().int().min(1).max(200).default(50).describe(
    "Cap on proposals to process per call. Default 50, max 200. " +
    "Each held proposal triggers one re-enrich attempt through the " +
    "Tier 1-4 ladder, so latency scales linearly with limit.",
  ),
  dry_run: z.boolean().default(false).describe(
    "Return what WOULD be processed without mutating. Use to scope a " +
    "session before committing.",
  ),
});
export type ResolveHeldProposalsInput = z.infer<typeof resolveHeldProposalsSchema>;

export async function resolveHeldProposals(input: ResolveHeldProposalsInput) {
  return audited(
    "crema_resolve_held_proposals",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/resolve-held", {
        method: "POST",
        body: {
          slug: input.slug,
          limit: input.limit,
          dry_run: input.dry_run,
        },
      })),
    (r: any) => {
      if (r.dry_run) return `would process ${r.would_process}`;
      return (
        `processed ${r.processed}: ` +
        `${r.succeeded_on_retry} succeeded_on_retry, ` +
        `${r.applied_thin} applied_thin, ` +
        `${r.errored} errored`
      );
    },
  );
}

export const rejectProposalsSchema = z.object({
  ids: z.array(z.number().int()).min(1).describe("Scrape-proposal IDs to reject (discard pending)"),
});
export type RejectProposalsInput = z.infer<typeof rejectProposalsSchema>;

export async function rejectProposals(input: RejectProposalsInput) {
  return audited(
    "crema_reject_proposals",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/reject", {
        method: "POST",
        body: { ids: input.ids },
      })),
    (r: any) => `rejected ${r.rejected}, skipped ${r.skipped}`,
  );
}

// ── Hints (bio + journal + diff quirks) ────────────────────────────────────

export const getHintsSchema = z.object({
  slug: z.string().describe("Roaster slug"),
});
export type GetHintsInput = z.infer<typeof getHintsSchema>;

export async function getHints(input: GetHintsInput) {
  return audited("crema_get_hints", input, async () => {
    const slug = encodeURIComponent(input.slug);
    const [bio, journal, diff] = await Promise.all([
      call(`/admin/roasters/${slug}/prompt-hint`).then(unwrap).catch(() => null),
      call(`/admin/roasters/${slug}/article-hint`).then(unwrap).catch(() => null),
      call(`/admin/roasters/${slug}/diff-hint`).then(unwrap).catch(() => null),
    ]);
    return { slug: input.slug, bio_hint: bio, journal_hint: journal, diff_hint: diff };
  });
}

export const setDiffHintSchema = z.object({
  slug: z.string().describe("Roaster slug"),
  hint: z.string().nullable().describe(
    "The free-text diff-prompt hint Haiku reads when interpreting this roaster's storefront diff. Pass null to clear.",
  ),
});
export type SetDiffHintInput = z.infer<typeof setDiffHintSchema>;

export async function setDiffHint(input: SetDiffHintInput) {
  return audited(
    "crema_set_diff_hint",
    input,
    async () =>
      unwrap(await call(`/admin/roasters/${encodeURIComponent(input.slug)}/diff-hint`, {
        method: "PUT",
        body: { hint: input.hint },
      })),
    () => "saved",
  );
}

export const regenerateHintSchema = z.object({
  slug: z.string().describe("Roaster slug"),
  kind: z.enum(["bio", "journal"]).describe(
    "Which hint to flag for regeneration on the next enrichment run. " +
    "`bio` = Sonnet meta-call inside the next catalog scrape job (one-shot regenerate_prompt). " +
    "`journal` = Sonnet meta-call inside the next article scrape job (perpetual force-regenerate flag).",
  ),
});
export type RegenerateHintInput = z.infer<typeof regenerateHintSchema>;

export async function regenerateHint(input: RegenerateHintInput) {
  return audited(
    "crema_regenerate_hint",
    input,
    async () => {
      const slug = encodeURIComponent(input.slug);
      if (input.kind === "journal") {
        return unwrap(await call(`/admin/roasters/${slug}/article-hint/regenerate-flag`, {
          method: "POST",
          body: { value: true },
        }));
      }
      // bio: there's no separate endpoint — the regenerate_prompt flag
      // is forwarded into the next enrich_roaster / scrape job. Set a
      // shim record by calling enrich_roaster with regenerate_prompt=true.
      return unwrap(await call(`/admin/roasters/${slug}/refresh-all`, {
        method: "POST",
        body: { regenerate_prompt: true },
      }));
    },
    () => `${input.kind} hint flagged for regeneration`,
  );
}

// ── Jobs (in-flight scrape/enrichment polling) ─────────────────────────────

export const listJobsSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;

export async function listJobs(input: ListJobsInput) {
  return audited("crema_list_jobs", input, async () =>
    unwrap(await call("/jobs", { query: { limit: input.limit } })),
  );
}

// ── LLM-jobs queue (agent-fallback execution path) ─────────────────────────
//
// When a Claude operator drives `crema_enrich_roaster` /
// `crema_enrich_all`, the FastAPI runner (with LLM_PROVIDER=
// claude_code_agent OR auto-detected from CREMA_AGENT_IDENTITY)
// enqueues every LLM-equivalent step as a row in `llm_jobs` instead
// of calling the Anthropic SDK. Claude then loops:
//
//   1. `crema_haiku_next_job` → claim oldest pending row, get the
//       canonical system + tool_schema + user_content.
//   2. Produce the structured tool_use output ITSELF (acting as
//      production Haiku per CLAUDE.md hard rule).
//   3. `crema_haiku_submit` → write the output back; the awaiting
//      enricher picks it up on next poll tick.
//
// Three tools: next-claim, submit, list (read-only).

export const haikuNextJobSchema = z.object({
  step: z.string().optional().describe(
    "Optional step filter — claim only jobs of this type. Common values: " +
    "bio | bio_hint | journal_hint | article_enrich | product_enrich | " +
    "standardize_tasting | standardize_origin | standardize_varietal | " +
    "standardize_roast | standardize_process | geolocate_tasting. " +
    "Open string — any value backend accepts.",
  ),
  roaster_slug: z.string().optional().describe(
    "Optional roaster filter — claim only jobs for this slug. Lets you " +
    "drain one roaster's queue before moving on.",
  ),
  agent_identity: z.string().optional().describe(
    "Identity stamped on the claimed row. Defaults to the calling " +
    "user's username for human-driven pulls; agent operators pass " +
    "their own identity (e.g. 'claude-haiku-4-5@anthropic-via-claude-code').",
  ),
});
export type HaikuNextJobInput = z.infer<typeof haikuNextJobSchema>;

export async function haikuNextJob(input: HaikuNextJobInput) {
  return audited(
    "crema_haiku_next_job",
    input,
    async () => {
      const job = unwrap<any | null>(
        await call("/admin/llm-jobs/next", {
          method: "POST",
          body: {
            step: input.step,
            roaster_slug: input.roaster_slug,
            agent_identity: input.agent_identity,
          },
        }),
      );
      return job;
    },
    (r: any) => (r ? `claimed job ${r.id} (${r.step}, ${r.roaster_slug})` : "queue empty"),
  );
}

export const haikuSubmitSchema = z.object({
  job_id: z.number().int().describe("ID of the llm_job to submit a response for (from crema_haiku_next_job)."),
  output: z.unknown().optional().describe(
    "The structured tool_use input dict the model produced — MUST match " +
    "the job's tool_schema. Required when status=complete; omit when " +
    "status=failed.",
  ),
  status: z.enum(["complete", "failed"]).default("complete").describe(
    "Whether the job completed or failed. Failed jobs surface as " +
    "LLMCallError on the awaiting enricher side, which typically falls " +
    "back to the pipeline's null-output behaviour.",
  ),
  error: z.string().optional().describe(
    "Error message — required when status=failed.",
  ),
});
export type HaikuSubmitInput = z.infer<typeof haikuSubmitSchema>;

export async function haikuSubmit(input: HaikuSubmitInput) {
  return audited(
    "crema_haiku_submit",
    { job_id: input.job_id, status: input.status, error: input.error },
    async () =>
      unwrap(await call(`/admin/llm-jobs/${input.job_id}/respond`, {
        method: "POST",
        body: {
          output: input.output,
          status: input.status,
          error: input.error,
        },
      })),
    (r: any) => `job ${r.id} marked ${r.status}`,
  );
}

export const listLLMJobsSchema = z.object({
  status: z.enum(["pending", "in_progress", "complete", "failed"]).optional().describe(
    "Filter by status.",
  ),
  roaster_slug: z.string().optional().describe("Filter by roaster."),
  step: z.string().optional().describe(
    "Filter by step (bio | bio_hint | journal_hint | article_enrich | product_enrich).",
  ),
  include_payloads: z.boolean().default(false).describe(
    "Include system_prompt + user_content + tool_schema_json + response_payload " +
    "on each row. Big response; use only when drilling into a specific failed " +
    "or completed step to inspect what was actually submitted.",
  ),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ListLLMJobsInput = z.infer<typeof listLLMJobsSchema>;

export async function listLLMJobs(input: ListLLMJobsInput) {
  // Not audited — reading the queue shouldn't itself write a row,
  // same convention as listAgentRuns.
  return unwrap(
    await call("/admin/llm-jobs", {
      query: {
        status: input.status,
        roaster_slug: input.roaster_slug,
        step: input.step,
        include_payloads: input.include_payloads ? "true" : undefined,
        limit: input.limit,
      },
    }),
  );
}

// ── Audit log self-inspection (read agent_runs) ────────────────────────────

export const listAgentRunsSchema = z.object({
  agent_identity: z.string().optional(),
  tool_name: z.string().optional(),
  session_id: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ListAgentRunsInput = z.infer<typeof listAgentRunsSchema>;

export async function listAgentRuns(input: ListAgentRunsInput) {
  // Not audited — reading the audit log shouldn't itself write an
  // audit row, otherwise we recurse into noise.
  return unwrap(
    await call("/admin/agent-runs", {
      query: {
        agent_identity: input.agent_identity,
        tool_name: input.tool_name,
        session_id: input.session_id,
        limit: input.limit,
      },
    }),
  );
}

// ── Agent summary log (explicit session-end log for daily digest) ──────────

export const logAgentSummarySchema = z.object({
  task_label: z.string().min(1).describe(
    "Free-text label for what this agent run accomplished. Examples: " +
    "'Drain held-roaster re-enrich queue', 'Auto-approve clean proposals " +
    "after sweep', 'Patch korebi bio_hint for Bourbon disambiguation'.",
  ),
  summary: z.string().min(1).describe(
    "3-5 sentence narrative in your own voice — what scope you covered, " +
    "how many items you processed, key outcomes, any surprises worth " +
    "flagging to the human operator. Plain prose; this is the boss-man " +
    "report.",
  ),
  outcome: z.enum(["success", "partial", "failed", "aborted"]).optional()
    .describe("Overall outcome. Defaults to 'success' if omitted."),
  prompt_excerpt: z.string().optional().describe(
    "Optional first ~500 chars of the prompt this agent received. Useful " +
    "for retro-debugging.",
  ),
  tool_calls_count: z.number().int().optional().describe(
    "How many MCP tool calls you made. Cheaper than aggregating " +
    "agent_runs at read time.",
  ),
  scope_slugs: z.array(z.string()).optional().describe(
    "Roaster slugs this agent touched. Stored as a JSON array for the " +
    "Activity Log UI to chip + filter on.",
  ),
  metrics: z.record(z.unknown()).optional().describe(
    "Free-form counter object. Examples: {jobs_processed: 12, " +
    "approved: 9, held: 3, products_enriched: 47}.",
  ),
  started_at: z.string().optional().describe(
    "ISO8601 timestamp of when you began. If omitted, the server " +
    "treats started_at and ended_at as ~now.",
  ),
});
export type LogAgentSummaryInput = z.infer<typeof logAgentSummarySchema>;

export async function logAgentSummary(input: LogAgentSummaryInput) {
  return audited(
    "crema_log_agent_summary",
    input,
    async () =>
      unwrap(await call("/admin/agent-summaries", {
        method: "POST",
        body: input,
      })),
    (r: any) => `logged session id=${r?.id} task="${input.task_label.slice(0, 60)}"`,
  );
}

// ── Diff sweep (LLM-free deterministic change detection) ──────────────────

export const diffSweepSchema = z.object({
  slugs: z.array(z.string()).optional().describe(
    "Roaster slugs to sweep. If omitted, sweeps every published roaster.",
  ),
  wait_seconds: z.number().int().min(0).max(180).default(45).describe(
    "How long to wait between dispatching the sync and querying the " +
    "stale list. Sync BG tasks finish in ~10-30s per roaster; default 45s " +
    "is enough for a small batch, bump up to 120-180s for a full 96-roaster " +
    "sweep. Set to 0 to fire-and-forget (returns empty list).",
  ),
});
export type DiffSweepInput = z.infer<typeof diffSweepSchema>;

export async function diffSweep(input: DiffSweepInput) {
  return audited(
    "crema_diff_sweep",
    input,
    async () => {
      // Step 1 — dispatch the bulk sync (zero-LLM, just crawl + snapshot).
      let slugs = input.slugs;
      if (!slugs || slugs.length === 0) {
        const rows = unwrap<any[]>(
          await call("/roaster_profiles", { query: { limit: 500 } }),
        );
        slugs = rows
          .filter((r: any) => r.published === 1)
          .map((r: any) => r.roaster_slug);
      }
      await call("/admin/sync-bulk", {
        method: "POST",
        body: { slugs, mode: "tab2" },
      });

      // Step 2 — wait for the BG tasks to settle. Each roaster's
      // sync is ~10-30s; default wait of 45s covers small batches.
      if (input.wait_seconds > 0) {
        await new Promise((r) => setTimeout(r, input.wait_seconds * 1000));
      }

      // Step 3 — pull the stale list (has_diff=true) from all-status.
      const all = unwrap<{ count: number; roasters: any[] }>(
        await call("/admin/sync/all-status"),
      );
      const inScope = (all.roasters || []).filter(
        (r: any) => !slugs || slugs.includes(r.slug),
      );
      const stale = inScope.filter((r: any) => {
        const total =
          (r.products_added || 0) +
          (r.products_updated || 0) +
          (r.products_removed || 0) +
          (r.articles_added || 0) +
          (r.articles_updated || 0) +
          (r.articles_removed || 0) +
          (r.bio_changed ? 1 : 0);
        return total > 0;
      });

      // Step 4 — detect crawl failures from each roaster's scrape_status.
      // Anything other than 'ok' / 'empty_retry_confirmed' indicates the
      // crawl couldn't be trusted (network error, HTTP 4xx/5xx, parse
      // failure, etc.). Write one warn-level agent_actions entry per
      // failed roaster so the agent's session journal flags them. This
      // closes the "silent crawl failures" gap — previously these
      // roasters just sat in the no-change bucket as if everything was
      // fine.
      const crawlErrors: Array<{ slug: string; product_status: string; bio_status: string }> = [];
      for (const r of inScope) {
        const ss = r.scrape_status || {};
        const productStatus = ss.products || "ok";
        const bioStatus = ss.bio || "ok";
        const productFailed = productStatus.startsWith("failed_");
        const bioFailed = bioStatus.startsWith("failed_");
        if (productFailed || bioFailed) {
          crawlErrors.push({
            slug: r.slug,
            product_status: productStatus,
            bio_status: bioStatus,
          });
        }
      }
      if (crawlErrors.length > 0) {
        const { identity: id } = await import("./client.js");
        try {
          await call("/admin/agent-actions", {
            method: "POST",
            body: {
              session_id: id.session,
              agent_identity: id.agent,
              action: `crawl failures during diff_sweep (${crawlErrors.length} roasters)`,
              reasoning:
                "These roasters' scrape_status was non-ok. They are NOT " +
                "in the stale list because no real diff could be computed " +
                "from a failed crawl. Investigate: site is down, IP " +
                "blocked, Cloudflare interstitial, schema changed. List: " +
                crawlErrors
                  .map((e) =>
                    `${e.slug} (products=${e.product_status}, bio=${e.bio_status})`,
                  )
                  .join("; "),
              metadata: { crawl_errors: crawlErrors },
              severity: "warn",
            },
          });
        } catch {
          // Best-effort logging — never block the diff_sweep response.
        }
      }

      return {
        scope_count: slugs.length,
        stale_count: stale.length,
        no_change_count: slugs.length - stale.length - crawlErrors.length,
        crawl_error_count: crawlErrors.length,
        waited_seconds: input.wait_seconds,
        stale: stale.map((r: any) => ({
          slug: r.slug,
          name: r.name,
          platform: r.platform,
          last_sync: r.last_sync,
          products_added: r.products_added || 0,
          products_updated: r.products_updated || 0,
          products_removed: r.products_removed || 0,
          articles_added: r.articles_added || 0,
          articles_updated: r.articles_updated || 0,
          articles_removed: r.articles_removed || 0,
          bio_changed: !!r.bio_changed,
        })),
        crawl_errors: crawlErrors,
      };
    },
    (r: any) =>
      `${r.stale_count} stale of ${r.scope_count} swept` +
      (r.crawl_error_count > 0
        ? ` (⚠️ ${r.crawl_error_count} crawl failures logged)`
        : ""),
  );
}

// ── Roaster lifecycle (onboard / publish / update / delete) ────────────────
//
// Phase 1 parity with the human admin: every action the admin UI can take
// on a roaster row, the agent can take via MCP. Endpoints all pre-existed —
// the MCP layer just exposes them.

export const onboardRoasterSchema = z.object({
  website: z.string().describe(
    "Roaster homepage URL. Required. If no scheme, https:// is prepended " +
    "server-side. Used as the natural key — duplicates trip a 409.",
  ),
  name: z.string().optional().describe(
    "Display name. If omitted, a best-effort <title>-tag fetch fills it. " +
    "Pass explicitly when the title is generic or missing.",
  ),
  shop_url: z.string().optional().describe(
    "Direct catalog URL if it differs from website/. Used as the scrape " +
    "entry point. Empty = scraper discovers from homepage.",
  ),
  platform: z.string().optional().describe(
    "Storefront platform if known: shopify, wordpress, wix, generic. " +
    "Empty = auto-detected on first sync.",
  ),
  city: z.string().optional().describe("City of operations."),
  state: z.string().optional().describe("State of operations."),
});
export type OnboardRoasterInput = z.infer<typeof onboardRoasterSchema>;

export async function onboardRoaster(input: OnboardRoasterInput) {
  return audited(
    "crema_onboard_roaster",
    input,
    async () =>
      unwrap(await call("/admin/scrape/sources", { method: "POST", body: input })),
    (r: any) => `onboarded ${r?.name || r?.website} (source id=${r?.id})`,
  );
}

export const deleteRoasterSchema = z.object({
  slug: z.string().describe("Roaster slug to delete. Soft-archives via deleted_roasters table; existing products survive."),
});
export type DeleteRoasterInput = z.infer<typeof deleteRoasterSchema>;

export async function deleteRoaster(input: DeleteRoasterInput) {
  return audited(
    "crema_delete_roaster",
    input,
    async () =>
      unwrap(await call(`/admin/roasters/${encodeURIComponent(input.slug)}`, {
        method: "DELETE",
      })),
    (r: any) => `deleted ${r?.deleted}`,
  );
}

export const publishRoasterSchema = z.object({
  slug: z.string().describe("Roaster slug"),
  published: z.boolean().describe(
    "true = visible on Discover, false = hidden (still queryable for admin / scrape).",
  ),
});
export type PublishRoasterInput = z.infer<typeof publishRoasterSchema>;

export async function publishRoaster(input: PublishRoasterInput) {
  return audited(
    "crema_publish_roaster",
    input,
    async () =>
      unwrap(await call(`/admin/roasters/${encodeURIComponent(input.slug)}/publish`, {
        method: "POST",
        body: { published: input.published ? 1 : 0 },
      })),
    (r: any) => `${r?.roaster_slug} → published=${r?.published}`,
  );
}

export const updateScrapeSettingsSchema = z.object({
  slug: z.string().describe("Roaster slug"),
  shop_url: z.string().optional().describe("Direct catalog URL; the scraper uses this as entry point if set."),
  platform: z.string().optional().describe("shopify | wordpress | wix | generic. Auto-detect if null."),
  enabled: z.boolean().optional().describe(
    "Master switch — false disables BEANS-tab scraping for this roaster. " +
    "Newly-onboarded sources land at enabled=false until explicitly turned on.",
  ),
});
export type UpdateScrapeSettingsInput = z.infer<typeof updateScrapeSettingsSchema>;

export async function updateScrapeSettings(input: UpdateScrapeSettingsInput) {
  const { slug, ...patch } = input;
  const body: Record<string, unknown> = {};
  if (patch.shop_url !== undefined) body.shop_url = patch.shop_url;
  if (patch.platform !== undefined) body.platform = patch.platform;
  if (patch.enabled !== undefined) body.enabled = patch.enabled ? 1 : 0;
  return audited(
    "crema_update_scrape_settings",
    input,
    async () =>
      unwrap(await call(`/admin/roasters/${encodeURIComponent(slug)}/scrape-settings`, {
        method: "PUT",
        body,
      })),
    () => `updated scrape settings for ${slug}`,
  );
}

// ── Standardization (origin / varietal / roast / process / tasting) ────────
//
// Read stats + exemplars, kick off a run, flag exemplar regen. The five
// trees themselves live in code (origin/varietal/roast/process are Python
// enums; tasting reads the active flavor schema) and aren't mutable through
// this MCP surface — that's a separate build per the workplan.

export const standardizeStatsSchema = z.object({});
export type StandardizeStatsInput = z.infer<typeof standardizeStatsSchema>;

export async function standardizeStats(_input: StandardizeStatsInput) {
  return audited(
    "crema_standardize_stats",
    {},
    async () => unwrap(await call("/admin/standardize/stats")),
    (r: any) => {
      const stats = r || {};
      const totals = Object.entries(stats)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]: [string, any]) => `${k}=${v?.unclassified ?? "?"}`)
        .join(" ");
      return totals || "stats fetched";
    },
  );
}

export const standardizeExemplarsSchema = z.object({});
export type StandardizeExemplarsInput = z.infer<typeof standardizeExemplarsSchema>;

export async function standardizeExemplars(_input: StandardizeExemplarsInput) {
  return audited(
    "crema_standardize_exemplars",
    {},
    async () => unwrap(await call("/admin/standardize/exemplars")),
    (r: any) => {
      const tasks = Object.keys(r || {});
      return `exemplars for ${tasks.length} tasks: ${tasks.join(", ")}`;
    },
  );
}

export const standardizeRunSchema = z.object({
  tasks: z.array(z.enum(["tasting", "origin", "varietal", "roast", "process"]))
    .optional()
    .describe("Subset to run. Empty/omitted = all five."),
  regenerate_exemplars: z.boolean().default(false).describe(
    "Force-resample every selected task's exemplars before the call.",
  ),
  force_reclassify: z.boolean().default(false).describe(
    "Re-classify every input string regardless of existing address rows. " +
    "Use after a prompt change. Default false = skip already-classified inputs.",
  ),
});
export type StandardizeRunInput = z.infer<typeof standardizeRunSchema>;

export async function standardizeRun(input: StandardizeRunInput) {
  return audited(
    "crema_standardize_run",
    input,
    async () =>
      unwrap(await call("/admin/standardize/run", {
        method: "POST",
        body: {
          tasks: input.tasks,
          regenerate_exemplars: input.regenerate_exemplars,
          force_reclassify: input.force_reclassify,
        },
      })),
    (r: any) => `enqueued standardization job ${r?.id ?? "?"}`,
  );
}

export const regenerateExemplarsSchema = z.object({
  task: z.enum(["tasting", "origin", "varietal", "roast", "process", "all"]).default("all")
    .describe("Which task's exemplars to flag for regeneration on next run."),
  value: z.boolean().default(true).describe("true = flag for regen; false = clear the flag."),
});
export type RegenerateExemplarsInput = z.infer<typeof regenerateExemplarsSchema>;

export async function regenerateExemplars(input: RegenerateExemplarsInput) {
  return audited(
    "crema_regenerate_exemplars",
    input,
    async () =>
      unwrap(await call("/admin/standardize/exemplars/regenerate", {
        method: "POST",
        body: { task: input.task, value: input.value },
      })),
    (r: any) => `${r?.updated?.join(", ") ?? input.task} regen=${r?.value}`,
  );
}

// ── Flavor schemas (the tasting-note tree) ─────────────────────────────────
//
// Single-tier flavor schemas live in `sca_tree_versions`. One is active at
// a time; activating a new one renders the Discover wheel against fresh
// sectors but leaves prior `sca_addresses` rows stale until standardization
// tasting is re-run.

export const listFlavorSchemasSchema = z.object({});
export type ListFlavorSchemasInput = z.infer<typeof listFlavorSchemasSchema>;

export async function listFlavorSchemas(_input: ListFlavorSchemasInput) {
  return audited(
    "crema_list_flavor_schemas",
    {},
    async () => unwrap(await call("/admin/flavor-schemas")),
    (r: any) =>
      `${r?.schemas?.length ?? 0} schemas, active=${r?.active_id ?? "none"}, ` +
      `${r?.stale_address_count ?? 0} stale addresses`,
  );
}

export const uploadFlavorSchemaSchema = z.object({
  tree_json: z.string().describe(
    "The flavor schema as a JSON string. Must parse to the single_tier shape " +
    "({ kind: 'single_tier', label, version, sectors: [{name, ...}, ...] }). " +
    "Validation runs server-side; bad shapes raise 400.",
  ),
  notes: z.string().optional().describe("Free-text changelog for this version."),
  activate: z.boolean().default(false).describe(
    "If true, the new schema becomes active immediately (any prior active row " +
    "is flipped off). The Discover wheel renders new sectors on next refresh; " +
    "existing addresses go stale until standardization tasting is re-run.",
  ),
});
export type UploadFlavorSchemaInput = z.infer<typeof uploadFlavorSchemaSchema>;

export async function uploadFlavorSchema(input: UploadFlavorSchemaInput) {
  return audited(
    "crema_upload_flavor_schema",
    { notes: input.notes, activate: input.activate, tree_size: input.tree_json.length },
    async () =>
      unwrap(await call("/admin/flavor-schemas", {
        method: "POST",
        body: input,
      })),
    (r: any) =>
      `uploaded schema id=${r?.id} v=${r?.version} sectors=${r?.sector_count}` +
      (r?.is_active ? " (active)" : ""),
  );
}

export const activateFlavorSchemaSchema = z.object({
  schema_id: z.number().int().describe("Row id from crema_list_flavor_schemas."),
});
export type ActivateFlavorSchemaInput = z.infer<typeof activateFlavorSchemaSchema>;

export async function activateFlavorSchema(input: ActivateFlavorSchemaInput) {
  return audited(
    "crema_activate_flavor_schema",
    input,
    async () =>
      unwrap(await call(`/admin/flavor-schemas/${input.schema_id}/activate`, {
        method: "POST",
      })),
    (r: any) =>
      `activated id=${r?.id} v=${r?.version}; ${r?.stale_address_count ?? 0} stale addresses`,
  );
}

// ── Journal / articles ─────────────────────────────────────────────────────

export const bulkScrapeArticlesSchema = z.object({
  roaster_slugs: z.array(z.string()).optional().describe(
    "Scope to this list of roasters. Empty/omitted = every published roaster.",
  ),
  force_enrich: z.boolean().default(false).describe(
    "Re-run Haiku enrichment for already-enriched articles. Use after a prompt " +
    "change or when systemic body-extraction issues are observed.",
  ),
  regenerate_article_hint: z.boolean().default(false).describe(
    "Force per-roaster site-quirk hint regeneration during this run.",
  ),
});
export type BulkScrapeArticlesInput = z.infer<typeof bulkScrapeArticlesSchema>;

export async function bulkScrapeArticles(input: BulkScrapeArticlesInput) {
  return audited(
    "crema_bulk_scrape_articles",
    input,
    async () =>
      unwrap(await call("/admin/articles/scrape-all", {
        method: "POST",
        body: {
          force_enrich: input.force_enrich,
          roaster_slugs: input.roaster_slugs,
          regenerate_article_hint: input.regenerate_article_hint,
        },
      })),
    (r: any) => `enqueued article_scrape job ${r?.id ?? "?"}`,
  );
}

export const scrapeRoasterArticlesSchema = z.object({
  slug: z.string().describe("Roaster slug"),
  force_enrich: z.boolean().default(false),
  regenerate_article_hint: z.boolean().default(false),
});
export type ScrapeRoasterArticlesInput = z.infer<typeof scrapeRoasterArticlesSchema>;

export async function scrapeRoasterArticles(input: ScrapeRoasterArticlesInput) {
  return audited(
    "crema_scrape_roaster_articles",
    input,
    async () =>
      unwrap(await call(`/admin/roasters/${encodeURIComponent(input.slug)}/scrape-articles`, {
        method: "POST",
        body: {
          force_enrich: input.force_enrich,
          regenerate_article_hint: input.regenerate_article_hint,
        },
      })),
    (r: any) => `enqueued article_scrape job ${r?.id ?? "?"} for ${input.slug}`,
  );
}

export const listArticlesSchema = z.object({
  roaster_slug: z.string().optional().describe("Filter to one roaster."),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  include_hidden: z.boolean().default(true).describe(
    "true (default for admin) = include published=0 rows. false = consumer-side filter.",
  ),
});
export type ListArticlesInput = z.infer<typeof listArticlesSchema>;

export async function listArticles(input: ListArticlesInput) {
  return audited(
    "crema_list_articles",
    input,
    async () =>
      unwrap(await call("/admin/articles", {
        query: {
          roaster_slug: input.roaster_slug,
          limit: input.limit,
          offset: input.offset,
          include_hidden: input.include_hidden ? 1 : 0,
        },
      })),
    (r: any) => `${(r ?? []).length} articles returned`,
  );
}

export const setArticlePublishedSchema = z.object({
  article_id: z.number().int().describe("Article row id from crema_list_articles."),
  published: z.boolean().describe(
    "true = visible to consumers, false = hidden (admin-only). Article stays in DB either way.",
  ),
});
export type SetArticlePublishedInput = z.infer<typeof setArticlePublishedSchema>;

export async function setArticlePublished(input: SetArticlePublishedInput) {
  return audited(
    "crema_set_article_published",
    input,
    async () =>
      unwrap(await call(`/admin/articles/${input.article_id}/publish`, {
        method: "POST",
        body: { published: input.published ? 1 : 0 },
      })),
    (r: any) => `article ${r?.id} → published=${r?.published}`,
  );
}

export const deleteArticleSchema = z.object({
  article_id: z.number().int().describe(
    "Article row id. Hard-delete; re-scraping the roaster re-inserts if " +
    "the URL still resolves (URL is the dedup key). Use only for truly " +
    "stale entries — for hiding, use crema_set_article_published.",
  ),
});
export type DeleteArticleInput = z.infer<typeof deleteArticleSchema>;

export async function deleteArticle(input: DeleteArticleInput) {
  return audited(
    "crema_delete_article",
    input,
    async () =>
      unwrap(await call(`/admin/articles/${input.article_id}`, { method: "DELETE" })),
    () => `deleted article ${input.article_id}`,
  );
}

// ── Products (re-enrich / sold-out / undo job) ─────────────────────────────

export const reenrichProductSchema = z.object({
  product_id: z.string().describe(
    "products.product_id — composite slug like 'roaster_slug_handle'. " +
    "Re-runs the full enricher (Sonnet path for the named fields). Used " +
    "when the initial scrape's enrichment failed or when prompt changes " +
    "require a one-off refresh.",
  ),
});
export type ReenrichProductInput = z.infer<typeof reenrichProductSchema>;

export async function reenrichProduct(input: ReenrichProductInput) {
  return audited(
    "crema_reenrich_product",
    input,
    async () =>
      unwrap(await call(`/admin/products/${encodeURIComponent(input.product_id)}/re-enrich`, {
        method: "POST",
      })),
    (r: any) => `re-enriched ${r?.product_id}: status=${r?.enrichment_status}`,
  );
}

export const markProductSoldOutSchema = z.object({
  product_id: z.string().describe(
    "products.product_id to flip to available=0. Logged as a proposal " +
    "against a synthetic 'manual_sold_out' job so it's undoable via the " +
    "same crema_undo_scrape_job path as a normal scrape change.",
  ),
});
export type MarkProductSoldOutInput = z.infer<typeof markProductSoldOutSchema>;

export async function markProductSoldOut(input: MarkProductSoldOutInput) {
  return audited(
    "crema_mark_product_sold_out",
    input,
    async () =>
      unwrap(await call(`/admin/products/${encodeURIComponent(input.product_id)}/sold-out`, {
        method: "POST",
      })),
    () => `marked ${input.product_id} sold-out`,
  );
}

export const undoScrapeJobSchema = z.object({
  job_id: z.number().int().describe(
    "jobs.id of the scrape/manual_sold_out run to reverse. Inserts are " +
    "deleted (only if source='scraped' — roaster-claimed rows survive); " +
    "updates replay captured prev_state; sold-out flips back to available=1. " +
    "Backfilled rows lacking prev_state are skipped and reported.",
  ),
});
export type UndoScrapeJobInput = z.infer<typeof undoScrapeJobSchema>;

export async function undoScrapeJob(input: UndoScrapeJobInput) {
  return audited(
    "crema_undo_scrape_job",
    input,
    async () =>
      unwrap(await call(`/admin/scrape/jobs/${input.job_id}/undo`, { method: "POST" })),
    (r: any) =>
      `undone job ${input.job_id}: ` +
      `reverted=${r?.reverted ?? 0}, skipped=${r?.skipped ?? 0}`,
  );
}

// ── Jobs (log tail / cancel) ───────────────────────────────────────────────

export const getScrapeRunLogSchema = z.object({
  job_id: z.number().int().describe(
    "jobs.id whose captured log tail + error_message you want to inspect. " +
    "Pairs with crema_list_jobs (gets the row's metadata) for full debug context.",
  ),
});
export type GetScrapeRunLogInput = z.infer<typeof getScrapeRunLogSchema>;

export async function getScrapeRunLog(input: GetScrapeRunLogInput) {
  return audited(
    "crema_get_scrape_run_log",
    input,
    async () => unwrap(await call(`/admin/jobs/${input.job_id}/log`)),
    (r: any) =>
      `job ${r?.id} (${r?.kind}, ${r?.status}): ` +
      `log=${(r?.log_tail ?? "").length}b error=${r?.error_message ? "yes" : "no"}`,
  );
}

export const cancelRunningJobSchema = z.object({
  job_id: z.number().int().describe(
    "jobs.id to cancel. Sticky-flag: sets cancel_requested=1; the runner " +
    "exits cleanly at its next per-source checkpoint with whatever it has " +
    "already committed (no half-scraped rows). Idempotent on terminal jobs.",
  ),
});
export type CancelRunningJobInput = z.infer<typeof cancelRunningJobSchema>;

export async function cancelRunningJob(input: CancelRunningJobInput) {
  return audited(
    "crema_cancel_running_job",
    input,
    async () =>
      unwrap(await call(`/admin/jobs/${input.job_id}/cancel`, { method: "POST" })),
    (r: any) =>
      r?.noop
        ? `job ${r?.job_id} already in ${r?.current_status}; noop`
        : `job ${r?.job_id} cancel requested`,
  );
}

// ── Phase 2 inspect / diagnose / requeue ──────────────────────────────────
//
// Investigative parity with what a human would do clicking through the
// admin UI: read one product's full state, read a raw snapshot, read an
// llm_job's full payloads, requeue a stuck/failed job, list scrape history
// for a roaster, test a URL before onboarding, delete a broken product row.

export const getProductDetailSchema = z.object({
  product_id: z.string().describe(
    "products.product_id — composite slug like 'roaster_slug_handle'. " +
    "Returns the full products row + the most recent scrape_proposals row " +
    "that touched this product (any status).",
  ),
});
export type GetProductDetailInput = z.infer<typeof getProductDetailSchema>;

export async function getProductDetail(input: GetProductDetailInput) {
  return audited(
    "crema_get_product_detail",
    input,
    async () =>
      unwrap(await call(`/admin/products/${encodeURIComponent(input.product_id)}`)),
    (r: any) =>
      `${r?.product?.product_id} status=${r?.product?.enrichment_status} ` +
      `last_proposal=${r?.latest_proposal?.status ?? "none"}`,
  );
}

export const deleteProductSchema = z.object({
  product_id: z.string().describe(
    "products.product_id to hard-delete. User-side tables (shelf, tasting_notes) " +
    "hold product_id references that go stale — those don't cascade. For " +
    "'hide but keep history', use crema_mark_product_sold_out instead. Use " +
    "delete only for truly broken / mis-scraped rows.",
  ),
});
export type DeleteProductInput = z.infer<typeof deleteProductSchema>;

export async function deleteProduct(input: DeleteProductInput) {
  return audited(
    "crema_delete_product",
    input,
    async () =>
      unwrap(await call(`/admin/products/${encodeURIComponent(input.product_id)}`, {
        method: "DELETE",
      })),
    (r: any) => `deleted ${r?.deleted}`,
  );
}

export const getRawSnapshotSchema = z.object({
  slug: z.string().describe(
    "Roaster slug. Returns the raw crawl_snapshots.payload_json (parsed) — " +
    "the storefront capture BEFORE diff/join enrichment. Use when " +
    "crema_get_snapshot's `unknown` count is high and the question is " +
    "'what did the crawler actually see?'. Response can be large.",
  ),
});
export type GetRawSnapshotInput = z.infer<typeof getRawSnapshotSchema>;

export async function getRawSnapshot(input: GetRawSnapshotInput) {
  return audited(
    "crema_get_raw_snapshot",
    input,
    async () =>
      unwrap(await call(`/admin/sync/${encodeURIComponent(input.slug)}/raw-snapshot`)),
    (r: any) => {
      const p = r?.payload || {};
      const np = (p.products || []).length;
      const na = (p.articles || []).length;
      return `${input.slug} @ ${r?.taken_at ?? "never"}: ${np} products, ${na} articles, platform=${p.platform ?? "?"}`;
    },
  );
}

export const getLLMJobDetailSchema = z.object({
  job_id: z.number().int().describe(
    "llm_jobs.id. Returns the FULL row including system_prompt, user_content, " +
    "tool_schema_json, response_payload. Use to debug a specific job — failed " +
    "(why? error column + payload at-failure) or complete (what did the model " +
    "produce?). Big response: payloads are kilobytes of text.",
  ),
});
export type GetLLMJobDetailInput = z.infer<typeof getLLMJobDetailSchema>;

export async function getLLMJobDetail(input: GetLLMJobDetailInput) {
  // Not audited — reading a single job's full payload is a debug op,
  // same convention as listLLMJobs.
  return unwrap(await call(`/admin/llm-jobs/${input.job_id}`));
}

export const requeueLLMJobSchema = z.object({
  job_id: z.number().int().describe(
    "llm_jobs.id to flip back to status='pending'. Clears claimed_at, " +
    "agent_identity, response_payload, error, completed_at so " +
    "crema_haiku_next_job can claim it fresh. Use for stuck in_progress " +
    "(drainer died mid-task) or transient failures. NOTE: if the parent " +
    "enrichment pipeline died, the eventual output goes nowhere — use " +
    "crema_get_llm_job_detail to read the response in that case.",
  ),
});
export type RequeueLLMJobInput = z.infer<typeof requeueLLMJobSchema>;

export async function requeueLLMJob(input: RequeueLLMJobInput) {
  return audited(
    "crema_requeue_llm_job",
    input,
    async () =>
      unwrap(await call(`/admin/llm-jobs/${input.job_id}/requeue`, {
        method: "POST",
      })),
    (r: any) => `job ${r?.id} → ${r?.status}`,
  );
}

export const listScrapeRunsSchema = z.object({
  roaster_slug: z.string().optional().describe(
    "Filter to runs that produced at least one proposal touching this slug. " +
    "Joins scrape_proposals via product_id LIKE 'slug_%'.",
  ),
  kind: z.string().optional().describe(
    "Filter by job kind: scrape | article_scrape | manual_sold_out | bio_enrich.",
  ),
  limit: z.number().int().min(1).max(500).default(50),
});
export type ListScrapeRunsInput = z.infer<typeof listScrapeRunsSchema>;

export async function listScrapeRuns(input: ListScrapeRunsInput) {
  return audited(
    "crema_list_scrape_runs",
    input,
    async () =>
      unwrap(await call("/admin/scrape-runs", {
        query: {
          roaster_slug: input.roaster_slug,
          kind: input.kind,
          limit: input.limit,
        },
      })),
    (r: any) => `${(r ?? []).length} scrape runs returned`,
  );
}

export const testSourceURLSchema = z.object({
  url: z.string().describe(
    "URL to probe for reachability + HTML title. Scheme prepended (https://) " +
    "if missing. 10s timeout. GET (not HEAD) so SPA shells return enough body " +
    "for title extraction. Use as a pre-flight check before crema_onboard_roaster.",
  ),
});
export type TestSourceURLInput = z.infer<typeof testSourceURLSchema>;

export async function testSourceURL(input: TestSourceURLInput) {
  return audited(
    "crema_test_source_url",
    input,
    async () =>
      unwrap(await call("/admin/sources/test", {
        method: "POST",
        body: { url: input.url },
      })),
    (r: any) =>
      r?.error
        ? `unreachable: ${r.error}`
        : `${r?.status} ${r?.content_type ?? "?"} "${(r?.html_title ?? "").slice(0, 60)}" in ${r?.elapsed_ms}ms`,
  );
}
