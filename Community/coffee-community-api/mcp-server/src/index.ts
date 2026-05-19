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
  listProposalsSchema, approveProposalsSchema, rejectProposalsSchema,
  getHintsSchema, setDiffHintSchema, regenerateHintSchema,
  listJobsSchema, listAgentRunsSchema,
  // impls
  listRoasters, getAllStatus, syncRoaster, syncAll, getSnapshot,
  enrichRoaster, enrichAll, listProposals, approveProposals,
  rejectProposals, getHints, setDiffHint, regenerateHint, listJobs,
  listAgentRuns,
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
      "the Sonnet meta-call that produces the fresh hint.",
    schema: regenerateHintSchema,
    handler: regenerateHint,
    idempotent: true,
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
