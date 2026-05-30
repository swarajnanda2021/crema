"""Provider-routed LLM call helper.

Catalog-ops enrichment (bio, articles, products, hints) call
`call_llm()` instead of the Anthropic SDK directly. The router picks
one of two backends per the current operator:

  - "anthropic"          — direct SDK call. Default for human-
                           initiated work (admin clicks an admin
                           button — the FastAPI process talks to the
                           Anthropic API with the user's credits).
  - "claude_code_agent"  — enqueue a row in `llm_jobs`, poll until
                           status=complete, return response_payload.
                           Used when Claude is driving (sweep,
                           scheduled refresh, autonomous backlog).
                           Claude polls the queue via the MCP tools
                           `crema_haiku_next_job` + `crema_haiku_submit`.

Routing decision:
  1. Explicit `LLM_PROVIDER` env wins (set per-process when the
     FastAPI is invoked by a Claude agent).
  2. Otherwise, auto-detect from `CREMA_AGENT_IDENTITY` (set by the
     MCP server boot env): if it starts with "claude-", route to
     claude_code_agent. Otherwise SDK.

Same prompt + same tool schema = same output, regardless of
backend. See feedback_mcp_dual_use_routing.md in the agent memory.
"""

from __future__ import annotations

import contextvars
import json
import os
import sqlite3
import time
import datetime as _dt
from typing import Any, Optional, Union

from database import DB_PATH


class LLMCallError(RuntimeError):
    """Raised when the routed LLM call fails (after retries / timeouts)."""


# Caller context — set by the orchestrating FastAPI route before
# invoking any enricher. Enrichers don't need to thread `slug` /
# `parent_run_id` through their internal calls; the router reads
# from contextvars at queue-write time.
_current_roaster_slug: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "crema_current_roaster_slug", default=None,
)
_current_parent_run_id: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "crema_current_parent_run_id", default=None,
)


def set_pipeline_context(
    *, roaster_slug: Optional[str], parent_run_id: Optional[int] = None,
) -> None:
    """Stamp the current pipeline run's roaster + parent agent_runs row.
    Downstream `call_llm()` invocations inherit these unless overridden.
    """
    _current_roaster_slug.set(roaster_slug)
    _current_parent_run_id.set(parent_run_id)


def get_provider() -> str:
    """Return 'anthropic' or 'claude_code_agent'.

    Hard rule (per the agent-first operating model): if any agent
    identity is in scope — env `CREMA_AGENT_IDENTITY` starts with
    `claude-` or the running process sets `CLAUDECODE=1` — the
    queue path WINS regardless of what `LLM_PROVIDER` is set to.
    Explicit `LLM_PROVIDER=anthropic` (the SDK path that burns
    paid API credits) is reserved for humans driving manual
    enrichment from the admin UI. An agent that explicitly sets
    `anthropic` is treated as a misconfiguration and the call is
    forced through the queue anyway. Don't honor the override.
    """
    identity = (os.environ.get("CREMA_AGENT_IDENTITY") or "").strip()
    agent_in_scope = (
        identity.startswith("claude-")
        or os.environ.get("CLAUDECODE") == "1"
        or (os.environ.get("AI_AGENT") or "").startswith("claude-")
    )
    if agent_in_scope:
        return "claude_code_agent"
    explicit = (os.environ.get("LLM_PROVIDER") or "").strip()
    if explicit in ("anthropic", "claude_code_agent"):
        return explicit
    return "anthropic"


def call_llm(
    *,
    step: str,
    system: Union[str, list],
    tool: dict,
    user_content: str,
    max_tokens: int,
    model: str,
    roaster_slug: Optional[str] = None,
    target_id: Optional[str] = None,
    parent_run_id: Optional[int] = None,
    timeout_seconds: int = 600,
    poll_interval_seconds: float = 1.0,
    max_retries: int = 3,
    apply_context: Optional[dict] = None,
) -> Optional[dict]:
    """Provider-routed LLM call.

    apply_context (queue path only): an optional JSON-serialisable dict
    persisted on the llm_jobs row so the drainer's /respond submit can
    apply the result itself (background applier) — decoupling the apply
    from this process's inline poll. Ignored on the SDK path (no job
    row is created there). Only product/article enrich pass it.

    Returns the structured tool_use input dict (matching
    `tool["input_schema"]`), or None if the call succeeded but
    returned no tool_use block. Raises `LLMCallError` for actionable
    failures (timeout, queue-path error).

    Args:
        roaster_slug: e.g. "93-degrees-coffee-roasters". Stored on
            the queue row so a consumer can poll slug-scoped.
        step: bio | bio_hint | journal_hint | article_enrich |
            product_enrich. Stored on the queue row for step-scoped
            polling.
        system: System prompt — string or list-of-blocks (anthropic
            cache_control form). The queue path serialises a list to
            a joined string (cache_control is SDK-only).
        tool: The single tool dict (name + description + input_schema).
            The router synthesises tool_choice from tool["name"].
        user_content: The single user message content.
        max_tokens: anthropic max_tokens.
        model: Model identifier (e.g. claude-haiku-4-5-20251001).
        target_id: Optional per-item identifier (article id, product
            url) — debugging aid in the queue.
        parent_run_id: Optional FK to agent_runs (the orchestrating
            MCP tool call).
        timeout_seconds: Queue-path polling timeout. Default 10 min.
        poll_interval_seconds: How often to re-check the queue row.
        max_retries: SDK-path retries via the anthropic client.
    """
    provider = get_provider()
    if provider == "anthropic":
        return _call_via_sdk(
            system=system,
            tool=tool,
            user_content=user_content,
            max_tokens=max_tokens,
            model=model,
            max_retries=max_retries,
        )
    if provider == "claude_code_agent":
        slug = roaster_slug or _current_roaster_slug.get() or "unknown"
        parent = parent_run_id if parent_run_id is not None else _current_parent_run_id.get()
        return _call_via_queue(
            roaster_slug=slug,
            step=step,
            target_id=target_id,
            system=system,
            tool=tool,
            user_content=user_content,
            max_tokens=max_tokens,
            model=model,
            parent_run_id=parent,
            timeout_seconds=timeout_seconds,
            poll_interval_seconds=poll_interval_seconds,
            apply_context=apply_context,
        )
    raise LLMCallError(f"Unknown LLM_PROVIDER: {provider!r}")


def _call_via_sdk(
    *, system, tool, user_content, max_tokens, model, max_retries
) -> Optional[dict]:
    import anthropic
    client = anthropic.Anthropic(max_retries=max_retries)
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user_content}],
    )
    for block in resp.content:
        if block.type == "tool_use":
            return dict(block.input)
    return None


def _normalize_system_to_string(system) -> str:
    if isinstance(system, str):
        return system
    if isinstance(system, list):
        return "\n\n".join(
            blk.get("text", "")
            for blk in system
            if isinstance(blk, dict) and blk.get("type") == "text"
        )
    return str(system)


def _now_utc_iso() -> str:
    return (
        _dt.datetime.now(_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _call_via_queue(
    *,
    roaster_slug,
    step,
    target_id,
    system,
    tool,
    user_content,
    max_tokens,
    model,
    parent_run_id,
    timeout_seconds,
    poll_interval_seconds,
    apply_context=None,
) -> Optional[dict]:
    """Enqueue an `llm_jobs` row, poll until complete, return payload.

    The submit endpoint (POST /admin/llm-jobs/{id}/respond) is what
    Claude calls via the `crema_haiku_submit` MCP tool to mark a
    job complete — that wakes this poll loop on the next tick.
    """
    sys_str = _normalize_system_to_string(system)
    schema_json = json.dumps(tool["input_schema"])
    tool_name = tool["name"]
    now = _now_utc_iso()
    # default=str so a stray non-JSON value in hints (e.g. a Decimal)
    # degrades to a string instead of raising and failing the enqueue.
    apply_ctx_json = (
        json.dumps(apply_context, default=str) if apply_context else None
    )

    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        cur = db.execute(
            "INSERT INTO llm_jobs "
            "(roaster_slug, step, target_id, parent_run_id, "
            " model, system_prompt, tool_name, tool_schema_json, "
            " user_content, max_tokens, status, created_at, "
            " apply_context_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            (
                roaster_slug,
                step,
                target_id,
                parent_run_id,
                model,
                sys_str,
                tool_name,
                schema_json,
                user_content,
                max_tokens,
                now,
                apply_ctx_json,
            ),
        )
        db.commit()
        job_id = cur.lastrowid
    finally:
        db.close()

    # No SDK fallback in the queue path. The queue path is reserved for
    # agent-driven runs (LLM_PROVIDER=claude_code_agent) where the
    # *agent* is responsible for draining the queue — via parallel
    # subagent launches or scheduled-task drainers. SDK is the human
    # admin's path (button clicks in the UI, LLM_PROVIDER=anthropic).
    # Mixing them would silently bill the wrong account.
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        time.sleep(poll_interval_seconds)
        db = sqlite3.connect(DB_PATH, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            row = db.execute(
                "SELECT status, response_payload, error "
                "FROM llm_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        finally:
            db.close()

        if row is None:
            raise LLMCallError(
                f"llm_job {job_id} disappeared from queue"
            )
        status = row["status"]
        if status == "complete":
            payload = row["response_payload"]
            if not payload:
                return None
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError as e:
                raise LLMCallError(
                    f"llm_job {job_id} response_payload isn't "
                    f"valid JSON: {e}"
                )
            # Defensive: if the MCP submit serialised `output` as a
            # JSON-encoded string (a known bug — our zodToJsonSchema
            # converter maps ZodUnknown → type:"string", so consumers
            # may stringify their dict to comply), the first json.loads
            # returns a string. Attempt one more parse to recover the
            # intended object. If that fails too, return the string —
            # caller will surface a clearer error than AttributeError
            # on `.get()`.
            if isinstance(parsed, str):
                try:
                    re_parsed = json.loads(parsed)
                    if isinstance(re_parsed, (dict, list)):
                        parsed = re_parsed
                except json.JSONDecodeError:
                    pass
            return parsed
        if status == "failed":
            raise LLMCallError(
                f"llm_job {job_id} marked failed: "
                f"{row['error'] or '(no detail)'}"
            )
        # status in ('pending', 'in_progress') → keep polling

    raise LLMCallError(
        f"llm_job {job_id} timed out after {timeout_seconds}s "
        f"(no consumer answered via "
        f"POST /admin/llm-jobs/{job_id}/respond)"
    )
