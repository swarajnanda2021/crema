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
 * Wrap a tool's async work with audit logging. The wrapped function
 * sees its own result; the audit row gets a short summary derived
 * from it.
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
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { error: errMsg.slice(0, 1000) });
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
