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
  include_unpublished: z.boolean().optional().describe(
    "Default false (consumer-facing scope). Set true to also return " +
    "roasters with published=0. Use for catalog-wide ops where " +
    "hidden roasters still deserve enrichment cycles — under the " +
    "absolute-cause visibility rule (services/sync_runner.py), a " +
    "hidden roaster gets auto-republished on the next sync that " +
    "finds its storefront alive with coffee. Bulk-enrich verbs " +
    "should set this true so hidden roasters get a chance to be " +
    "rescued.",
  ),
});
export type ListRoastersInput = z.infer<typeof listRoastersSchema>;

export async function listRoasters(input: ListRoastersInput) {
  return audited("crema_list_roasters", input, async () => {
    const rows = unwrap<any[]>(
      await call("/roaster_profiles", { query: { limit: input.limit } }),
    );
    const q = (input.search || "").trim().toLowerCase();
    const scoped = input.include_unpublished
      ? rows
      : rows.filter((r) => r.published === 1);
    const filtered = q
      ? scoped.filter(
          (r) =>
            (r.name || "").toLowerCase().includes(q) ||
            (r.roaster_slug || "").toLowerCase().includes(q) ||
            (r.website || "").toLowerCase().includes(q),
        )
      : scoped;
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
  summary: z.boolean().default(false).describe(
    "When true, project each row to lean fields only (id, job_id, " +
    "product_id, change_type, status, created_at, roaster_slug, " +
    "coffee_name, enrichment_status). Drops the full proposed_state_json " +
    "+ prev_state_json blobs that bloat the response. Use this for " +
    "bucketing / counting workflows — fetch the full row via /api/" +
    "scrape_proposals/{id} once you've picked the IDs to act on.",
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
    if (input.summary) q.summary = "true";
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

export const catalogPricePerGramSchema = z.object({
  slug: z.string().optional().describe(
    "Optional roaster slug — scope to one roaster. Empty = catalog-wide.",
  ),
  band_pct: z.number().min(0.5).max(49).default(10).describe(
    "Outlier band width as a percentile. 10 = flag the top 10% and " +
    "bottom 10% of ₹/g. Default 10.",
  ),
  limit: z.number().int().min(1).max(200).default(25).describe(
    "Per-bucket sample cap. Default 25.",
  ),
});
export type CatalogPricePerGramInput = z.infer<typeof catalogPricePerGramSchema>;

export async function catalogPricePerGram(input: CatalogPricePerGramInput) {
  return audited(
    "crema_catalog_price_per_gram",
    input,
    async () =>
      unwrap(
        await call("/admin/catalog-price-per-gram", {
          query: {
            ...(input.slug ? { slug: input.slug } : {}),
            band_pct: String(input.band_pct ?? 10),
            limit: String(input.limit ?? 25),
          },
        }),
      ),
    () => `price-per-gram audit (${input.slug ?? "all"})`,
  );
}

export const catalogQualityAuditSchema = z.object({
  slug: z.string().optional().describe(
    "Optional roaster slug — scope the audit to one roaster's products. " +
    "Empty = catalog-wide. Use slug-scoped after a per-roaster re-enrich " +
    "to verify the cosmetic-bug count collapsed to zero.",
  ),
  limit: z.number().int().min(1).max(200).default(20).describe(
    "Per-category sample / rollup row cap. Default 20.",
  ),
});
export type CatalogQualityAuditInput = z.infer<typeof catalogQualityAuditSchema>;

export async function catalogQualityAudit(input: CatalogQualityAuditInput) {
  return audited(
    "crema_catalog_quality_audit",
    input,
    async () =>
      unwrap(
        await call("/admin/catalog-quality-audit", {
          query: {
            ...(input.slug ? { slug: input.slug } : {}),
            limit: String(input.limit ?? 20),
          },
        }),
      ),
    (r: any) => {
      const top_hi = (r?.price_extremes?.top_high_priced ?? [])[0];
      const top_lo = (r?.price_extremes?.top_low_priced ?? [])[0];
      return (
        `cosmetic_bug_total=${r?.cosmetic_bug_total ?? 0} (scope=${r?.scope}): ` +
        `name_junk_html=${r?.coffee_name_junk?.html_entities?.total ?? 0}, ` +
        `name_junk_pipe=${r?.coffee_name_junk?.pipe_tails?.total ?? 0}, ` +
        `name_junk_weight=${r?.coffee_name_junk?.weight_suffixes?.total ?? 0}, ` +
        `name_allcaps=${r?.coffee_name_junk?.all_caps?.total ?? 0}, ` +
        `absurd_prices=${r?.absurd_prices?.total ?? 0}, ` +
        `missing_image=${r?.missing_image_url?.total ?? 0}, ` +
        `missing_price=${r?.missing_price_inr?.total ?? 0}, ` +
        `silent_empty=${r?.silent_empty?.total ?? 0}, ` +
        `denorm_drift=${r?.denorm_name_drift?.total ?? 0}` +
        (top_hi ? `; top_high=${top_hi.coffee_name}@₹${top_hi.price_inr}` : "") +
        (top_lo ? `; top_low=${top_lo.coffee_name}@₹${top_lo.price_inr}` : "")
      );
    },
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
    "Short plain-English label — what you just did. Good: 'Refreshed " +
    "stale roasters', 'Onboarded Kruti Coffee', 'Investigated thin " +
    "Panduranga products'. Bad: 'diff_sweep + enrich_all over " +
    "has_diff=true filter, spawned drainer-A and drainer-B'. One " +
    "entry per meaningful phase, not per tool call.",
  ),
  reasoning: z.string().min(1).describe(
    "Plain English, like narrating to a colleague. What happened, " +
    "what came out of it, anything notable. Good: 'Refreshed 12 stale " +
    "roasters today. Three came back with no specs because their " +
    "product pages don't list origin or altitude — those landed as " +
    "source_thin which is fine. The other nine enriched cleanly.' " +
    "Bad: 'Triggered enrich_all over has_diff=true; spawned 4 BG " +
    "tasks; drainer-A processed 8 jobs, drainer-B processed 6 jobs; " +
    "drainer-A exited on 15 empty polls...' The narrative is the " +
    "value — without it the log is noise.",
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
    "for things that went sideways but you handled (crawl failures, " +
    "products that needed special attention), 'error' for hard " +
    "blockers the operator must look at. UIs render warn/error " +
    "entries prominently.",
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
    "One or two plain-English sentences that a future agent can act " +
    "on. Write the takeaway, not the incident. Good: 'When Shopify " +
    "products.json comes back empty, retry once with a 2-second wait " +
    "— it's usually a rate-limit blip, not a real empty store.' " +
    "Good: 'Panduranga products don't list origin / altitude / " +
    "varietal on their pages. Don't keep re-enriching them expecting " +
    "different output — they belong as source_thin.' Bad: 'On " +
    "2026-05-22 the diff_sweep returned 14 stale; drainer-K processed " +
    "8 of them; humble-express had products_removed=39...' That's a " +
    "log entry, not a lesson.",
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

export const getRunbookSchema = z.object({
  verb: z.string().optional().describe(
    "Section slug to fetch (e.g. 'bulk_enrich', 'dedupe', 'rollback', " +
    "'drainer_template', 't3'). Substring-matched against runbook " +
    "section slugs + titles. Omit to fetch the full runbook + TOC of " +
    "available slugs.",
  ),
});
export type GetRunbookInput = z.infer<typeof getRunbookSchema>;

export async function getRunbook(input: GetRunbookInput) {
  return audited(
    "crema_get_runbook",
    input,
    async () => {
      const qs = new URLSearchParams();
      if (input.verb) qs.set("verb", input.verb);
      return unwrap(await call(`/admin/runbook?${qs.toString()}`));
    },
    (r: any) =>
      r?.verb
        ? `runbook section${r?.section_count > 1 ? "s" : ""}: ${
            r?.matched ? `${r?.section_count} matched` : "no match — see available_slugs"
          }`
        : `runbook (${r?.byte_size ?? 0} bytes, ${(r?.available_slugs || []).length} sections)`,
  );
}

export const searchAgentMemorySchema = z.object({
  query: z.string().describe(
    "Free-text query (3-7 words is the sweet spot). The route " +
    "tokenizes on whitespace, does case-insensitive substring " +
    "match against lesson + scope + tags, and ranks by hit count. " +
    "Boosts: scope-match +2, tag-match +1 per term. Use this " +
    "INSTEAD of crema_get_agent_memory when you need a specific " +
    "lesson — it returns 3 hits, not 50 rows.",
  ),
  scope: z.string().optional().describe(
    "Pre-filter to one scope. e.g. 'catalog-ops'.",
  ),
  tag: z.string().optional().describe(
    "Pre-filter to lessons with this tag.",
  ),
  k: z.number().int().min(1).max(20).default(3).describe(
    "Top-k results. Default 3 — keeps the orchestrator's working " +
    "memory cost ~10x lower than a full memory dump.",
  ),
});
export type SearchAgentMemoryInput = z.infer<typeof searchAgentMemorySchema>;

export async function searchAgentMemory(input: SearchAgentMemoryInput) {
  return audited(
    "crema_search_agent_memory",
    input,
    async () =>
      unwrap(await call("/admin/agent-memory/search", {
        query: {
          query: input.query,
          scope: input.scope,
          tag: input.tag,
          k: input.k,
        },
      })),
    (r: any) =>
      `top-${r?.total ?? 0} lessons matched query=${JSON.stringify(input.query)} ` +
      `(${r?.candidates_scored ?? 0} candidates scored)`,
  );
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
        `${r.skipped_live_enriched ?? 0} skipped_live_enriched, ` +
        `${r.errored} errored`
      );
    },
  );
}

export const revertProposalsAppliedSinceSchema = z.object({
  applied_at_after: z.string().describe(
    "ISO8601 timestamp. Every proposal with applied_at >= this is " +
    "reverted: prev_state_json replayed onto the products row (or " +
    "INSERT undone), proposal flipped back to status='pending', " +
    "applied_at cleared. Use to undo a bad bulk apply.",
  ),
  slug: z.string().optional().describe(
    "Optional roaster slug filter (matches product_id LIKE '<slug>_%').",
  ),
  limit: z.number().int().min(1).max(5000).default(1000).describe(
    "Cap on rows to revert per call. Default 1000, max 5000.",
  ),
  dry_run: z.boolean().default(false).describe(
    "List candidates without mutating.",
  ),
});
export type RevertProposalsAppliedSinceInput = z.infer<typeof revertProposalsAppliedSinceSchema>;

export async function revertProposalsAppliedSince(input: RevertProposalsAppliedSinceInput) {
  return audited(
    "crema_revert_proposals_applied_since",
    input,
    async () =>
      unwrap(await call("/admin/scrape/proposals/revert-applied-since", {
        method: "POST",
        body: {
          applied_at_after: input.applied_at_after,
          slug: input.slug,
          limit: input.limit,
          dry_run: input.dry_run,
        },
      })),
    (r: any) => {
      if (r.dry_run) return `would revert ${r.would_revert}`;
      return `reverted ${r.reverted} of ${r.total_processed} (skipped ${r.skipped})`;
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
  limit: z.number().int().min(1).max(1000).default(50),
  kind: z.string().optional().describe(
    "Filter by job kind: scrape | article_scrape | roaster_enrich | " +
    "resolve_held | standardize | geolocate. Empty = all kinds. " +
    "Only honored when summary=true (the lean route supports it).",
  ),
  status: z.string().optional().describe(
    "Filter by status: queued | running | succeeded | failed | cancelled. " +
    "Only honored when summary=true.",
  ),
  since: z.string().optional().describe(
    "ISO8601 — only jobs with started_at >= this value. " +
    "Only honored when summary=true.",
  ),
  summary: z.boolean().default(false).describe(
    "When true, hit the lean /admin/jobs/summary endpoint that drops " +
    "log_tail + result_summary (the two heavy columns). Returns " +
    "{id, kind, status, started_by, started_at, finished_at, " +
    "error_message, created_at}. Use this for orchestrator-style " +
    "polling over 100s of jobs without blowing the MCP response " +
    "truncation threshold. Fetch the full row via /api/jobs/{id} " +
    "once you've picked one to inspect.",
  ),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;

export async function listJobs(input: ListJobsInput) {
  return audited("crema_list_jobs", input, async () => {
    if (input.summary) {
      const q: Record<string, string | number> = { limit: input.limit };
      if (input.kind) q.kind = input.kind;
      if (input.status) q.status = input.status;
      if (input.since) q.since = input.since;
      return unwrap(await call("/admin/jobs/summary", { query: q }));
    }
    return unwrap(await call("/jobs", { query: { limit: input.limit } }));
  });
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
    "Short noun phrase that becomes the journal entry TITLE on the " +
    "admin card. Examples: 'Refreshed Caaraabi catalog', " +
    "'Drained Black Baza queue', 'Patched korebi Bourbon " +
    "disambiguation'. Under ~60 chars.",
  ),
  summary: z.string().min(1).describe(
    "EXCERPT shown on the card under the title. 1-3 sentences of plain " +
    "English — the teaser version of what happened. Under ~200 chars. " +
    "Frame as if briefing a colleague who'll click for the full read.",
  ),
  body_html: z.string().optional().describe(
    "OPTIONAL long-form journal body, rendered when the user clicks " +
    "the card to expand. HTML subset: h2, h3, p, ul/ol/li, blockquote, " +
    "strong, em, a. Write as a journal article would — paragraphs + " +
    "subheadings + colleague-briefing voice (NOT a technical log dump). " +
    "Examples of structure: 'What I did', 'What I found', 'What's left', " +
    "'Loose threads'. Per AGENTIC_UTOPIA: agent log is by the " +
    "orchestrator, in plain English, for human readability.",
  ),
  outcome: z.enum(["success", "partial", "failed", "aborted"]).optional()
    .describe("Overall outcome. Defaults to 'success' if omitted. Drives card badge color."),
  prompt_excerpt: z.string().optional().describe(
    "Optional first ~500 chars of the prompt this agent received. " +
    "Surfaces in the reader's meta sidebar.",
  ),
  tool_calls_count: z.number().int().optional().describe(
    "MCP tool calls made. Shown in the meta row.",
  ),
  scope_slugs: z.array(z.string()).optional().describe(
    "Roaster slugs touched. Render as roaster-name chips in the " +
    "reader header.",
  ),
  metrics: z.record(z.unknown()).optional().describe(
    "Free-form counters: {jobs_processed: 12, approved: 9, " +
    "products_enriched: 47}. Surface in meta.",
  ),
  started_at: z.string().optional().describe(
    "ISO8601 agent start time. If omitted, started_at = ended_at = now.",
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

// ── enrichment_tasks (v2 per-URL state machine — observability) ───────────

export const listEnrichmentTasksSchema = z.object({
  kind: z.enum(["product", "article"]).optional().describe(
    "Restrict to one entity kind.",
  ),
  state: z.enum([
    "discovered", "fetching", "llm_pending",
    "enriched", "failed", "skipped",
  ]).optional().describe(
    "Restrict to one task state. Use 'failed' to surface stuck work, " +
    "'skipped' to inspect what the two-stage filter rejected, etc.",
  ),
  roaster_slug: z.string().optional().describe(
    "Scope to one roaster.",
  ),
  extraction_provenance: z.enum([
    "haiku", "haiku_site_hinted", "admin_manual", "bs4_fallback",
  ]).optional().describe(
    "Filter by provenance. 'bs4_fallback' surfaces rows where Haiku " +
    "failed and the deterministic extractor took over — admin review " +
    "recommended.",
  ),
  since: z.string().optional().describe(
    "ISO8601 — only rows with state_changed_at >= since.",
  ),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ListEnrichmentTasksInput = z.infer<typeof listEnrichmentTasksSchema>;

export async function listEnrichmentTasks(input: ListEnrichmentTasksInput) {
  return audited(
    "crema_list_enrichment_tasks",
    input,
    async () =>
      unwrap(await call("/admin/enrichment-tasks", {
        query: {
          kind: input.kind,
          state: input.state,
          roaster_slug: input.roaster_slug,
          extraction_provenance: input.extraction_provenance,
          since: input.since,
          limit: input.limit,
        },
      })),
  );
}

export const enrichmentTasksBreakdownSchema = z.object({
  roaster_slug: z.string().optional().describe(
    "Scope to one roaster.",
  ),
  since: z.string().optional().describe(
    "ISO8601 — only rows with state_changed_at >= since.",
  ),
});
export type EnrichmentTasksBreakdownInput = z.infer<typeof enrichmentTasksBreakdownSchema>;

export async function enrichmentTasksBreakdown(input: EnrichmentTasksBreakdownInput) {
  return audited(
    "crema_enrichment_tasks_breakdown",
    input,
    async () =>
      unwrap(await call("/admin/enrichment-tasks/breakdown", {
        query: {
          roaster_slug: input.roaster_slug,
          since: input.since,
        },
      })),
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
      const bulkResp = unwrap<{
        accepted: number;
        slugs: string[];
        unknown_slugs: string[];
        mode: string;
      }>(
        await call("/admin/sync-bulk", {
          method: "POST",
          body: { slugs, mode: "tab2" },
        }),
      );
      // Use the server's filtered `slugs` (= the ones that actually
      // ran) for everything downstream. `unknown_slugs` is surfaced
      // separately in the response so the agent knows what was
      // dropped (e.g. a typo, or an orphan source row without a
      // profile — re-onboard the URL to fix).
      const acceptedSlugs = bulkResp.slugs || [];
      const unknownSlugs = bulkResp.unknown_slugs || [];

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
        (r: any) => acceptedSlugs.includes(r.slug),
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

      const staleList = stale.map((r: any) => ({
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
      }));

      // next_steps — structurally encode the orchestrator's
      // follow-on workflow into the tool response, so it's in
      // working memory at the exact moment the orchestrator picks
      // the next action.
      const nextSteps: Array<{tool: string; args: any; why: string}> = [];
      if (stale.length > 0) {
        nextSteps.push({
          tool: "crema_enrich_all",
          args: {
            slugs: staleList.map((r) => r.slug),
            regenerate_prompt: false,
          },
          why: `${stale.length} roasters changed since last snapshot. ` +
               `Refresh ONLY those slugs (skip the rest — they're current).`,
        });
      }
      if (crawlErrors.length > 0) {
        nextSteps.push({
          tool: "crema_test_source_url",
          args: { slug: crawlErrors[0].slug },
          why: `${crawlErrors.length} roasters had crawl failures (non-ok ` +
               `scrape_status). Probe ONE to diagnose: storefront down, ` +
               `Cloudflare gate, IP block, or schema change.`,
        });
      }
      if (stale.length === 0 && crawlErrors.length === 0) {
        nextSteps.push({
          tool: "crema_log_agent_summary",
          args: {
            action: "diff sweep — no changes",
            reasoning: "All in-scope roasters were current. No enrichment needed.",
          },
          why: "log the no-op so the activity trail captures the sweep.",
        });
      }

      return {
        scope_count: acceptedSlugs.length,
        unknown_slugs: unknownSlugs,
        stale_count: stale.length,
        no_change_count: acceptedSlugs.length - stale.length - crawlErrors.length,
        crawl_error_count: crawlErrors.length,
        waited_seconds: input.wait_seconds,
        stale: staleList,
        crawl_errors: crawlErrors,
        next_steps: nextSteps,
      };
    },
    (r: any) =>
      `${r.stale_count} stale of ${r.scope_count} swept` +
      (r.unknown_slugs && r.unknown_slugs.length > 0
        ? ` (⚠️ ${r.unknown_slugs.length} unknown slugs dropped: ${r.unknown_slugs.slice(0, 3).join(", ")}${r.unknown_slugs.length > 3 ? "…" : ""})`
        : "") +
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
    async () => {
      const raw = unwrap<any>(
        await call("/admin/scrape/sources", { method: "POST", body: input }),
      );
      // Augment with structural next_steps. Onboarding is a
      // multi-step pipeline; without these the orchestrator
      // typically stops at "queued" without verifying bio
      // extraction landed, products were discovered, or the
      // chained scrape actually fired.
      const jobId = raw?.job_id;
      raw.next_steps = [
        ...(jobId != null
          ? [{
              tool: "crema_list_jobs",
              args: { limit: 5 },
              why: `poll for job ${jobId} until status='succeeded'. ` +
                   "The bio enrich + chained scrape run in BG; this " +
                   "is the only signal they completed.",
            }]
          : []),
        {
          tool: "crema_list_catalog_operations",
          args: { kind: "onboard_roaster", limit: 3 },
          why: "audit the onboarding op — confirm status='succeeded' " +
               "+ summary shows the discovered URL graph from bio.",
        },
        {
          tool: "crema_list_quality_reviews",
          args: {
            target_table: "roaster_profiles",
            verdict: "confirmed",
            limit: 10,
          },
          why: "bio T1 findings on the new roaster — generic " +
               "specialties, short blurb, no URLs discovered " +
               "(indicates extraction issue worth investigating " +
               "BEFORE the new roaster ships to consumers).",
        },
      ];
      return raw;
    },
    (r: any) =>
      r?.job_id != null
        ? `onboarding queued — source ${r?.source_id} (created=${r?.source_created}), enrich job ${r?.job_id}; poll /api/jobs/${r?.job_id} for slug`
        : `onboarded ${r?.name || r?.website} (source id=${r?.source_id || r?.id})`,
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

export const listSourcesSchema = z.object({
  enabled: z.boolean().optional().describe(
    "Filter to enabled / disabled sources only. Omit for all.",
  ),
  has_profile: z.boolean().optional().describe(
    "true → only sources with a linked roaster_profiles row " +
    "(joined by website). false → orphan source rows (no profile " +
    "yet — typically incomplete onboards). Omit for all.",
  ),
  search: z.string().optional().describe(
    "Substring match on name + website + shop_url.",
  ),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type ListSourcesInput = z.infer<typeof listSourcesSchema>;

export async function listSources(input: ListSourcesInput) {
  return audited("crema_list_sources", input, async () => {
    const q: Record<string, string | number> = { limit: input.limit };
    if (input.enabled !== undefined) q.enabled = input.enabled ? "true" : "false";
    if (input.has_profile !== undefined) q.has_profile = input.has_profile ? "true" : "false";
    if (input.search) q.search = input.search;
    return unwrap(await call("/admin/scrape/sources", { query: q }));
  });
}

export const deleteSourceSchema = z.object({
  source_id: z.number().int().positive().describe(
    "Numeric `roaster_sources.id` to delete. Use crema_list_sources " +
    "to find ids. Hard-deletes the source row — does NOT touch " +
    "roaster_profiles or products. Safe to call on orphan source " +
    "rows from incomplete onboards.",
  ),
});
export type DeleteSourceInput = z.infer<typeof deleteSourceSchema>;

export async function deleteSource(input: DeleteSourceInput) {
  return audited(
    "crema_delete_source",
    input,
    async () =>
      unwrap(await call(`/admin/scrape/sources/${input.source_id}`, {
        method: "DELETE",
      })),
    (r: any) => `deleted source ${r?.source_id} (${r?.website})`,
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

export const bulkReenrichRoasterSchema = z.object({
  slug: z.string().describe(
    "Roaster slug to bulk re-enrich. Required.",
  ),
  only_status: z.enum(["failed", "enriched", "pre_v2"]).optional().describe(
    "Filter products in the roaster: 'failed' (status='failed' rows only), " +
    "'enriched' (silent-empty sweep — touches enriched rows again), " +
    "'pre_v2' (rows where enriched_at IS NULL — the most common target " +
    "after the 2026-05-25 stack). Omit to re-enrich every product in the " +
    "roaster.",
  ),
});
export type BulkReenrichRoasterInput = z.infer<typeof bulkReenrichRoasterSchema>;

export async function bulkReenrichRoaster(input: BulkReenrichRoasterInput) {
  return audited(
    "crema_bulk_reenrich_roaster",
    input,
    async () =>
      unwrap(
        await call(
          `/admin/roasters/${encodeURIComponent(input.slug)}/bulk-reenrich`,
          {
            method: "POST",
            body: { only_status: input.only_status },
          },
        ),
      ),
    (r: any) =>
      `bulk_reenrich queued: slug=${r?.slug}, products=${r?.product_count}, ` +
      `job_id=${r?.job_id ?? "n/a"}, filter=${r?.only_status ?? "all"}`,
  );
}

export const fullReenrichRoasterSchema = z.object({
  slug: z.string().describe(
    "Roaster slug to fully re-enrich. Required.",
  ),
  mode: z.enum(["tab1", "tab2"]).optional().describe(
    "Sync mode. 'tab1' = full crawl (use for new or re-baseline). " +
    "'tab2' = diff-only sync against the previous snapshot — the " +
    "right default for steady-state refresh. Default 'tab2'.",
  ),
  regenerate_prompt: z.boolean().optional().describe(
    "Regenerate the per-roaster product-enrichment hint as part of " +
    "the scrape. Default true (the whole point of full-reenrich is " +
    "to refresh quirk hints alongside the catalog).",
  ),
  regenerate_article_hint: z.boolean().optional().describe(
    "Regenerate the per-roaster article-enrichment hint as part of " +
    "the article scrape. Default true.",
  ),
  force_enrich: z.boolean().optional().describe(
    "Re-run Haiku enrichment on EVERY product even if the page " +
    "content is unchanged since the last scrape. Default false " +
    "(content-unchanged rows skip). Set true to force re-processing — " +
    "required to apply enricher/classifier code changes to " +
    "content-stable rows (e.g. clearing stale silent_empty after a " +
    "classifier fix).",
  ),
});
export type FullReenrichRoasterInput = z.infer<typeof fullReenrichRoasterSchema>;

export async function fullReenrichRoaster(input: FullReenrichRoasterInput) {
  return audited(
    "crema_full_reenrich_roaster",
    input,
    async () =>
      unwrap(
        await call(
          `/admin/roasters/${encodeURIComponent(input.slug)}/full-reenrich`,
          {
            method: "POST",
            body: {
              mode: input.mode,
              regenerate_prompt: input.regenerate_prompt,
              regenerate_article_hint: input.regenerate_article_hint,
              force_enrich: input.force_enrich,
            },
          },
        ),
      ),
    (r: any) =>
      `full_reenrich queued: slug=${r?.slug}, sync_mode=${r?.sync_mode}, ` +
      `regen_prompt=${r?.regenerate_prompt}, ` +
      `regen_article_hint=${r?.regenerate_article_hint}, ` +
      `force_enrich=${r?.force_enrich}`,
  );
}

// ── Quality reviewer (T1+T2+T3) ───────────────────────────────────────────

export const listQualityReviewsSchema = z.object({
  target_table: z.enum(["products", "roaster_articles", "roaster_profiles", "catalog_operations"]).optional().describe(
    "Scope to products or articles. Omit for all.",
  ),
  verdict: z.enum(["pending", "confirmed", "cleared", "overridden"]).optional().describe(
    "'pending' = T1 flagged, T2 not yet run (rare — should be transient). " +
    "'confirmed' = T2 Haiku reviewer confirmed hallucination — ready for T3 " +
    "Opus override. 'cleared' = T2 said T1 was a false positive (no action). " +
    "'overridden' = T3 already corrected; preserved as history + lesson.",
  ),
  tier: z.number().int().min(1).max(3).optional().describe(
    "Filter by which tier raised the flag.",
  ),
  roaster_slug: z.string().optional().describe(
    "Scope to one roaster's rows.",
  ),
  limit: z.number().int().min(1).max(500).optional().describe(
    "Max rows. Default 100.",
  ),
});
export type ListQualityReviewsInput = z.infer<typeof listQualityReviewsSchema>;

export async function listQualityReviews(input: ListQualityReviewsInput) {
  return audited(
    "crema_list_quality_reviews",
    input,
    async () => {
      const qs = new URLSearchParams();
      if (input.target_table) qs.set("target_table", input.target_table);
      if (input.verdict) qs.set("verdict", input.verdict);
      if (input.tier !== undefined) qs.set("tier", String(input.tier));
      if (input.roaster_slug) qs.set("roaster_slug", input.roaster_slug);
      if (input.limit !== undefined) qs.set("limit", String(input.limit));
      return unwrap(await call(`/admin/quality-reviews?${qs.toString()}`));
    },
    (r: any) =>
      `${r?.returned ?? 0} quality_reviews returned. Rollup: ${
        JSON.stringify(r?.rollup || {})
      }`,
  );
}

export const prepareT3ReviewSchema = z.object({
  target_table: z.enum(["products", "roaster_articles", "roaster_profiles", "catalog_operations"]).describe(
    "Which entity table to fetch context for. Required.",
  ),
  target_id: z.string().optional().describe(
    "Scope to one row. Omit to fetch a batch over all rows with " +
    "verdict='confirmed'.",
  ),
  roaster_slug: z.string().optional().describe(
    "Scope to one roaster's confirmed-flag rows.",
  ),
  limit: z.number().int().min(1).max(50).optional().describe(
    "Max bundles to return. Default 10.",
  ),
});
export type PrepareT3ReviewInput = z.infer<typeof prepareT3ReviewSchema>;

export async function prepareT3Review(input: PrepareT3ReviewInput) {
  return audited(
    "crema_prepare_t3_review",
    input,
    async () =>
      unwrap(
        await call("/admin/quality-reviews/prepare-t3", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `T3 prepare: ${r?.bundle_count ?? 0} bundles returned for ` +
      `orchestrator reasoning`,
  );
}

// ── Operation-level QC + rollback ─────────────────────────────────────────

export const listCatalogOperationsSchema = z.object({
  kind: z.string().optional().describe(
    "Filter by operation kind: 'dedupe' | 'delete_product' | " +
    "'full_reenrich_roaster' | 'sync_tab1' | 'sync_tab2' | " +
    "'enrich_all' | 'onboard_roaster' | 'standardize' | etc. Free-form.",
  ),
  status: z.enum(["running", "succeeded", "failed", "rolled_back"]).optional().describe(
    "Filter by terminal status. 'running' = still in flight " +
    "(check for stragglers). 'failed' = errored. 'rolled_back' = " +
    "admin reverted.",
  ),
  target_slug: z.string().optional().describe(
    "Scope to one roaster's operations.",
  ),
  since: z.string().optional().describe(
    "ISO timestamp; only ops started_at >= since.",
  ),
  limit: z.number().int().min(1).max(500).optional().describe(
    "Max rows. Default 50.",
  ),
});
export type ListCatalogOperationsInput = z.infer<typeof listCatalogOperationsSchema>;

export async function listCatalogOperations(input: ListCatalogOperationsInput) {
  return audited(
    "crema_list_catalog_operations",
    input,
    async () => {
      const qs = new URLSearchParams();
      if (input.kind) qs.set("kind", input.kind);
      if (input.status) qs.set("status", input.status);
      if (input.target_slug) qs.set("target_slug", input.target_slug);
      if (input.since) qs.set("since", input.since);
      if (input.limit !== undefined) qs.set("limit", String(input.limit));
      return unwrap(await call(`/admin/catalog-operations?${qs.toString()}`));
    },
    (r: any) =>
      `${r?.returned ?? 0} operations returned. Rollup: ${
        JSON.stringify(r?.rollup || {})
      }`,
  );
}

export const rollbackCatalogOperationSchema = z.object({
  operation_id: z.number().int().describe(
    "catalog_operations.id to roll back. Required.",
  ),
  reason: z.string().optional().describe(
    "Free-form note recorded on the operation row + lesson trail. " +
    "e.g. 'dedupe over-collapsed Wix products', 'mass-delete on " +
    "Nandan was a 503 transient'.",
  ),
});
export type RollbackCatalogOperationInput = z.infer<typeof rollbackCatalogOperationSchema>;

export async function rollbackCatalogOperation(input: RollbackCatalogOperationInput) {
  return audited(
    "crema_rollback_catalog_operation",
    input,
    async () =>
      unwrap(
        await call(`/admin/catalog-operations/${input.operation_id}/rollback`, {
          method: "POST",
          body: { reason: input.reason },
        }),
      ),
    (r: any) =>
      `rolled back op ${r?.operation_id}: ${r?.rows_restored ?? 0} restored, ` +
      `${r?.rows_deleted ?? 0} deleted (tables: ${
        (r?.tables_touched || []).join(",")
      })`,
  );
}

export const dedupeProductsSchema = z.object({
  strategy: z.enum(["url_exact", "url_normalized", "content_similarity"]).optional().describe(
    "How to identify duplicates. Default 'url_normalized' — matches " +
    "after stripping scheme/www/collections-all/trailing-slash. " +
    "Catches Class A (same URL different product_id) AND Class B " +
    "(URL-variant duplicates like www vs no-www). Use 'url_exact' " +
    "for the conservative path — only same-string URLs consolidate. " +
    "Use 'content_similarity' for Class D: same coffee published as " +
    "multiple SKUs differing only by grind / brew preference / region " +
    "tag (Curious Life Gachatha × 6, Nandan Espresso × 5 — the " +
    "URL-normalized strategy can't see these because the handles are " +
    "genuinely distinct). Content-similarity groups by " +
    "(roaster_slug, normalized_coffee_name, price_inr, image_url) " +
    "— requires non-null price + image to participate.",
  ),
  slug: z.string().optional().describe(
    "Scope dedup to one roaster's products.",
  ),
  limit: z.number().int().min(1).max(5000).optional().describe(
    "Cap on duplicate groups to consolidate per call. Default " +
    "unlimited. Useful for batch-by-batch progress on a large dedup.",
  ),
  dry_run: z.boolean().optional().describe(
    "Default true. Always preview before committing — the dry-run " +
    "report shows per-group: canonical chosen, sibling product_ids " +
    "to delete, fields that would be merged. Re-fire with " +
    "dry_run=false to apply.",
  ),
});
export type DedupeProductsInput = z.infer<typeof dedupeProductsSchema>;

export async function dedupeProducts(input: DedupeProductsInput) {
  return audited(
    "crema_dedupe_products",
    input,
    async () =>
      unwrap(
        await call("/admin/products/dedupe", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `dedup ${r?.dry_run ? "dry-run" : "applied"}: ` +
      `${r?.groups_found ?? 0} groups found, ` +
      `${r?.groups_consolidated ?? 0} consolidated, ` +
      `${r?.rows_deleted ?? 0} rows deleted (${r?.rows_kept ?? 0} kept)`,
  );
}


export const applyFiltersRetroSchema = z.object({
  slug: z.string().optional().describe(
    "Scope the sweep to one roaster.",
  ),
  limit: z.number().int().min(1).max(50000).optional().describe(
    "Cap on rows scanned. Omit for unbounded (be careful catalog-wide).",
  ),
  dry_run: z.boolean().optional().describe(
    "Default true. Preview which rows would flip to filter_reject; " +
    "re-fire with dry_run=false to apply.",
  ),
});
export type ApplyFiltersRetroInput = z.infer<typeof applyFiltersRetroSchema>;

export async function applyFiltersRetro(input: ApplyFiltersRetroInput) {
  return audited(
    "crema_apply_filters_retro",
    input,
    async () =>
      unwrap(
        await call("/admin/catalog/filter-retro-sweep", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `filter sweep ${r?.dry_run ? "dry-run" : "applied"}: ` +
      `${r?.scanned ?? 0} scanned, ${r?.matched ?? 0} matched` +
      (r?.dry_run ? "" : `, ${r?.affected ?? 0} flagged filter_reject`),
  );
}


export const urlHealthAuditSchema = z.object({
  slug: z.string().optional().describe(
    "Scope the audit to one roaster.",
  ),
  limit: z.number().int().min(1).max(50000).optional().describe(
    "Cap on rows scanned. Omit for unbounded (catalog-wide).",
  ),
  concurrency: z.number().int().min(1).max(32).optional().describe(
    "Parallel HEAD requests. Default 8. Higher values finish " +
    "faster but stress some storefront origins more.",
  ),
  dry_run: z.boolean().optional().describe(
    "Default true. Preview the 404'd URLs; re-fire with " +
    "dry_run=false to flip them to url_dead.",
  ),
});
export type UrlHealthAuditInput = z.infer<typeof urlHealthAuditSchema>;

export async function urlHealthAudit(input: UrlHealthAuditInput) {
  return audited(
    "crema_url_health_audit",
    input,
    async () =>
      unwrap(
        await call("/admin/catalog/url-health-audit", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `url health ${r?.dry_run ? "dry-run" : "applied"}: ` +
      `${r?.scanned ?? 0} scanned, ${r?.dead ?? 0} dead (404), ` +
      `${r?.transient_failures ?? 0} transient` +
      (r?.dry_run ? "" : `, ${r?.affected ?? 0} flagged url_dead`),
  );
}

export const runQualityReviewSweepSchema = z.object({
  target_table: z.enum(["products", "roaster_articles", "roaster_profiles", "catalog_operations"]).optional().describe(
    "Default 'products'.",
  ),
  slug: z.string().optional().describe(
    "Scope to one roaster.",
  ),
  since: z.string().optional().describe(
    "ISO timestamp; only rows enriched_at >= since.",
  ),
  limit: z.number().int().min(1).max(10000).optional().describe(
    "Cap on rows scanned. Omit for unbounded (be careful catalog-wide).",
  ),
  run_t2: z.boolean().optional().describe(
    "Default true. When false, run T1 only (free, no LLM). When true, " +
    "fire the T2 Haiku adversarial reviewer on T1-flagged rows — " +
    "requires Haiku drainers to be active to make progress.",
  ),
  skip_already_reviewed: z.boolean().optional().describe(
    "Default true. When true, skip rows that already have a " +
    "quality_reviews entry (pending or resolved). Set false to force " +
    "a re-scan — useful after extending T1 heuristics, to re-evaluate " +
    "the whole catalog under the new rule set.",
  ),
});
export type RunQualityReviewSweepInput = z.infer<typeof runQualityReviewSweepSchema>;

export async function runQualityReviewSweep(input: RunQualityReviewSweepInput) {
  return audited(
    "crema_run_quality_review_sweep",
    input,
    async () =>
      unwrap(
        await call("/admin/quality-reviews/run-sweep", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `sweep: scanned=${r?.rows_scanned ?? 0}, T1 flagged=` +
      `${r?.rows_flagged_by_t1 ?? 0} (${r?.total_t1_flags ?? 0} total flags), ` +
      `T2 confirmed=${r?.t2_confirmed ?? 0}/cleared=${r?.t2_cleared ?? 0}/` +
      `unsure=${r?.t2_unsure ?? 0}`,
  );
}

export const applyT3CorrectionSchema = z.object({
  target_table: z.enum(["products", "roaster_articles", "roaster_profiles", "catalog_operations"]).describe(
    "Which entity table to write to. Required.",
  ),
  target_id: z.string().describe(
    "Target row id (product_id for products, id for roaster_articles).",
  ),
  corrections: z.array(z.object({
    field: z.string().describe(
      "Field name being corrected. Must be in the allowlist " +
      "(coffee_name, origin, varietal, process_raw, producer, " +
      "altitude_masl, roast_level, roast_level_name, tasting_notes, " +
      "roaster_blurb, bean_type, origin_region for products; " +
      "title, excerpt, topic_category, tags for articles).",
    ),
    corrected_value: z.string().nullable().describe(
      "The corrected value, or null to clear the field entirely. " +
      "Clearing is preferable to leaving wrong data when the page " +
      "supports no replacement value.",
    ),
    reasoning: z.string().describe(
      "1-2 sentences explaining the correction with page-text " +
      "citation when possible. The reasoning isn't persisted (the " +
      "lesson string captures the durable insight); it's for the " +
      "orchestrator's own audit trail.",
    ),
  })).describe(
    "List of field-level corrections the orchestrator decided.",
  ),
  lesson: z.string().describe(
    "Required. 1-3 sentences capturing what the original enricher " +
    "got wrong and what rule (T1 heuristic or prompt-hardening edit) " +
    "would have caught it. Persisted to every overridden " +
    "quality_reviews row for the continuous-hardening loop. The " +
    "lesson is T3's durable output — without it, the cycle doesn't " +
    "close.",
  ),
});
export type ApplyT3CorrectionInput = z.infer<typeof applyT3CorrectionSchema>;

export async function applyT3Correction(input: ApplyT3CorrectionInput) {
  return audited(
    "crema_apply_t3_correction",
    input,
    async () =>
      unwrap(
        await call("/admin/quality-reviews/apply-t3", {
          method: "POST",
          body: input,
        }),
      ),
    (r: any) =>
      `T3 applied to ${r?.target_id}: ${r?.applied ?? 0} corrections, ` +
      `${r?.skipped ?? 0} skipped`,
  );
}

export const resolveQualityReviewSchema = z.object({
  review_id: z.number().int().describe(
    "quality_reviews.id of the row to resolve. Required.",
  ),
  verdict: z.enum(["cleared", "confirmed", "overridden"]).describe(
    "Verdict to set. 'cleared' = T1 false positive, clear it. " +
    "'confirmed' = mark for later T3 attention (skip T2). " +
    "'overridden' = admin manually corrected the value (set corrected_value " +
    "+ lesson too).",
  ),
  corrected_value: z.string().optional().describe(
    "Only for 'overridden'. The corrected value the admin is setting. " +
    "Pass empty string to clear the field entirely.",
  ),
  lesson: z.string().optional().describe(
    "Only for 'overridden'. A short note capturing what was wrong and " +
    "what rule would have caught it. Becomes training material for the " +
    "next prompt-hardening iteration.",
  ),
});
export type ResolveQualityReviewInput = z.infer<typeof resolveQualityReviewSchema>;

export async function resolveQualityReview(input: ResolveQualityReviewInput) {
  return audited(
    "crema_resolve_quality_review",
    input,
    async () =>
      unwrap(
        await call(`/admin/quality-reviews/${input.review_id}/resolve`, {
          method: "POST",
          body: {
            verdict: input.verdict,
            corrected_value: input.corrected_value,
            lesson: input.lesson,
          },
        }),
      ),
    (r: any) =>
      `quality_review ${r?.id} → verdict=${r?.verdict}`,
  );
}

export const reapStuckEnrichmentTasksSchema = z.object({
  older_than_minutes: z.number().int().min(1).max(1440).optional().describe(
    "Minimum age (in minutes) a task must be stuck at state='llm_pending' " +
    "before reaping. Default 5. Use higher values to be conservative on " +
    "fresh sweeps (where some tasks legitimately sit at llm_pending for " +
    "a few minutes while waiting on the drainer pool).",
  ),
  dry_run: z.boolean().optional().describe(
    "Default false. When true, return what WOULD be reaped without " +
    "actually changing state. Use to preview the reap before committing.",
  ),
});
export type ReapStuckEnrichmentTasksInput = z.infer<typeof reapStuckEnrichmentTasksSchema>;

export async function reapStuckEnrichmentTasks(input: ReapStuckEnrichmentTasksInput) {
  return audited(
    "crema_reap_stuck_enrichment_tasks",
    input,
    async () =>
      unwrap(
        await call(`/admin/enrichment-tasks/reap-stuck`, {
          method: "POST",
          body: {
            older_than_minutes: input.older_than_minutes,
            dry_run: input.dry_run,
          },
        }),
      ),
    (r: any) =>
      `${r?.dry_run ? "would_reap" : "reaped"}: ` +
      `${r?.advanced_to_enriched?.length ?? 0} → enriched, ` +
      `${r?.advanced_to_failed?.length ?? 0} → failed ` +
      `(stuck > ${r?.older_than_minutes}m)`,
  );
}

export const reapStuckCatalogOperationsSchema = z.object({
  older_than_minutes: z.number().int().min(1).max(1440).optional().describe(
    "Minimum age (in minutes) a `catalog_operations` row must be stuck " +
    "at status='running' before reaping. Default 30. Conservative " +
    "default because legitimate long-running ops (full_reenrich_roaster " +
    "on a 50-product roaster) can take 10+ minutes. Use 5-10 only " +
    "during interactive debugging when you know all real work is done.",
  ),
  dry_run: z.boolean().optional().describe(
    "Default false. When true, return what WOULD be reaped without " +
    "actually changing state. Use to preview the reap before committing.",
  ),
});
export type ReapStuckCatalogOperationsInput = z.infer<typeof reapStuckCatalogOperationsSchema>;

export async function reapStuckCatalogOperations(input: ReapStuckCatalogOperationsInput) {
  return audited(
    "crema_reap_stuck_catalog_operations",
    input,
    async () =>
      unwrap(
        await call(`/admin/catalog-operations/reap-stuck`, {
          method: "POST",
          body: {
            older_than_minutes: input.older_than_minutes,
            dry_run: input.dry_run,
          },
        }),
      ),
    (r: any) => {
      const byKind = r?.by_kind ?? {};
      const kindStr = Object.entries(byKind)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none";
      return (
        `${r?.dry_run ? "would_reap" : "reaped"}: ` +
        `${r?.reaped_count ?? 0} stuck>${r?.older_than_minutes}m ` +
        `(${kindStr})`
      );
    },
  );
}

export const gradeArticlesSchema = z.object({
  slug: z.string().optional().describe(
    "Roaster slug to scope the grading batch to one roaster's articles. " +
    "Omit for catalog-wide.",
  ),
  only_unscored: z.boolean().optional().describe(
    "Default true. Skip articles that already have a non-null " +
    "editorial_score. Set false to re-grade everything (use after a " +
    "rubric change in services/article_grader.py).",
  ),
  limit: z.number().int().min(1).max(5000).optional().describe(
    "Max articles per batch. Default 500. The worker is fire-and-forget; " +
    "for a multi-thousand backfill, run multiple batches.",
  ),
});
export type GradeArticlesInput = z.infer<typeof gradeArticlesSchema>;

export async function gradeArticles(input: GradeArticlesInput) {
  return audited(
    "crema_grade_articles",
    input,
    async () =>
      unwrap(
        await call(
          `/admin/articles/grade-batch`,
          {
            method: "POST",
            body: {
              slug: input.slug,
              only_unscored: input.only_unscored,
              limit: input.limit,
            },
          },
        ),
      ),
    (r: any) =>
      `grade_articles queued: scope=${r?.slug ?? "catalog-wide"}, ` +
      `articles=${r?.article_count}, job_id=${r?.job_id ?? "n/a"}, ` +
      `only_unscored=${r?.only_unscored}`,
  );
}

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

export const setProductAvailableSchema = z.object({
  product_id: z.string().describe(
    "products.product_id to set available on.",
  ),
  available: z.boolean().describe(
    "true → un-hide the product (available=1); false → hide it " +
    "(available=0). Logged as a catalog_operations row " +
    "(kind='manual_set_available') with a pre-mutation snapshot so it's " +
    "undoable via crema_rollback_catalog_operation. Use available=true to " +
    "restore an in-stock bean that was wrongly hidden without a full " +
    "re-enrich — the gap crema_mark_product_sold_out (which only sets " +
    "available=0) couldn't fill.",
  ),
});
export type SetProductAvailableInput = z.infer<typeof setProductAvailableSchema>;

export async function setProductAvailable(input: SetProductAvailableInput) {
  return audited(
    "crema_set_product_available",
    input,
    async () =>
      unwrap(await call(`/admin/products/${encodeURIComponent(input.product_id)}/set-available`, {
        method: "POST",
        body: JSON.stringify({ available: input.available }),
      })),
    () => `set ${input.product_id} available=${input.available ? 1 : 0}`,
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
