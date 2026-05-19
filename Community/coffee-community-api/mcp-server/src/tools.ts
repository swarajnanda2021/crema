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
  slug: z.string().optional().describe("Filter to one roaster"),
  status: z.enum(["pending", "applied", "rejected"]).default("pending"),
  limit: z.number().int().min(1).max(500).default(100),
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
