/**
 * Agent-run audit wrapper.
 *
 * Every MCP tool call is wrapped with INSERT-before / UPDATE-after on
 * the `agent_runs` table so the admin can see what each agent did,
 * with what inputs, on what schedule, with what outputs.
 *
 * The wrapper is provider-agnostic: the agent_identity string
 * (`claude-sonnet-4-6@anthropic`, `llama-3.3-70b@macstudio.local`,
 * etc.) comes from env at MCP server boot — the org's catalog ops
 * decouples from any specific LLM provider.
 *
 * The audit log is the trust mechanism: without it, agentic ops are
 * a black box.
 */

import { call, identity } from "./client.js";

export interface AuditStart {
  toolName: string;
  args: unknown;
  promptHash?: string;
  schemaHash?: string;
}

export interface AuditFinish {
  resultSummary?: string;
  error?: string;
}

export async function startRun(start: AuditStart): Promise<number | null> {
  try {
    const resp = await call<{ data: { id: number } }>("/admin/agent-runs", {
      method: "POST",
      body: {
        agent_identity: identity.agent,
        session_id: identity.session,
        tool_name: start.toolName,
        args_json: JSON.stringify(start.args ?? null),
        prompt_hash: start.promptHash,
        schema_hash: start.schemaHash,
      },
    });
    return resp.data.id;
  } catch (err) {
    // Audit log failure must NOT block the tool call. Log to stderr
    // (stdout is the MCP wire). Future improvement: queue audit
    // writes locally and flush on next successful call.
    console.error("agent_runs audit start failed:", err);
    return null;
  }
}

export async function finishRun(runId: number | null, finish: AuditFinish): Promise<void> {
  if (runId === null) return;
  try {
    await call(`/admin/agent-runs/${runId}`, {
      method: "PUT",
      body: {
        result_summary: finish.resultSummary,
        error: finish.error,
      },
    });
  } catch (err) {
    console.error("agent_runs audit finish failed:", err);
  }
}

/**
 * Tool names that mutate catalog state — every call to one of these
 * auto-writes an `agent_actions` row alongside the per-call
 * `agent_runs` audit, so the human can read a chronological narrative
 * of what an agent session did without needing the agent to remember
 * to call `crema_log_agent_action` manually. Per the agent-first
 * operating model: logging is the trust mechanism; an autonomous
 * agent that skips logging is a black box.
 *
 * Read-only tools (list_*, get_*, catalog_stats, haiku_next_job, etc.)
 * do NOT auto-log — they don't change state, and logging every read
 * would drown out the meaningful action stream.
 */
const MUTATING_TOOLS = new Set([
  "crema_onboard_roaster",
  "crema_delete_roaster",
  "crema_delete_source",
  "crema_publish_roaster",
  "crema_update_scrape_settings",
  "crema_enrich_roaster",
  "crema_enrich_all",
  "crema_reenrich_product",
  "crema_sync_roaster",
  "crema_sync_all",
  "crema_diff_sweep",
  "crema_approve_proposals",
  "crema_reject_proposals",
  "crema_auto_approve_proposals",
  "crema_resolve_held_proposals",
  "crema_revert_proposals_applied_since",
  "crema_undo_scrape_job",
  "crema_mark_product_sold_out",
  "crema_set_diff_hint",
  "crema_set_article_published",
  "crema_delete_article",
  "crema_delete_product",
  "crema_bulk_scrape_articles",
  "crema_scrape_roaster_articles",
  "crema_standardize_run",
  "crema_regenerate_exemplars",
  "crema_upload_flavor_schema",
  "crema_activate_flavor_schema",
  "crema_regenerate_hint",
  "crema_cancel_running_job",
  "crema_requeue_llm_job",
  "crema_haiku_submit",
]);

async function autoLogAgentAction(
  toolName: string,
  args: unknown,
  summary: string,
  severity: "info" | "warn" | "error" = "info",
): Promise<void> {
  try {
    await call("/admin/agent-actions", {
      method: "POST",
      body: {
        session_id: identity.session,
        agent_identity: identity.agent,
        action: toolName.replace(/^crema_/, ""),
        reasoning: summary,
        metadata: { args },
        severity,
      },
    });
  } catch (err) {
    console.error("agent_actions auto-log failed:", err);
  }
}

/**
 * Wrap a tool's async work with audit logging. The wrapped function
 * sees its own result; the audit row gets a short summary derived
 * from it.
 *
 * For mutating tools (see MUTATING_TOOLS), ALSO auto-writes an
 * `agent_actions` narrative row so the human can read a session
 * timeline without the agent having to remember to log. Read-only
 * tools skip the agent_actions write — they don't change state.
 */
export async function audited<T>(
  toolName: string,
  args: unknown,
  fn: () => Promise<T>,
  summarize?: (result: T) => string,
): Promise<T> {
  const runId = await startRun({ toolName, args });
  try {
    const result = await fn();
    const summary = summarize ? summarize(result) : defaultSummary(result);
    await finishRun(runId, { resultSummary: summary });
    if (MUTATING_TOOLS.has(toolName)) {
      await autoLogAgentAction(toolName, args, summary, "info");
    }
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { error: errMsg.slice(0, 1000) });
    if (MUTATING_TOOLS.has(toolName)) {
      await autoLogAgentAction(toolName, args, `ERROR: ${errMsg.slice(0, 500)}`, "error");
    }
    throw err;
  }
}

function defaultSummary(result: unknown): string {
  if (result === null || result === undefined) return "ok";
  if (typeof result === "string") return result.slice(0, 200);
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  try {
    const s = JSON.stringify(result);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return "<unstringifiable>";
  }
}
