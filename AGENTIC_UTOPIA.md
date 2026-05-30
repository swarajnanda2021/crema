# Agentic Utopia — The Directive

This codebase is **agent-orchestrated**. Catalog refreshes, roaster
onboarding, article scraping, and every other recurring catalog-ops
task is driven by an Opus / GPT-5.5 / Kimi-grade orchestrator that
calls MCP tools, spawns Haiku-grade subagents for bounded execution,
and writes an activity log when it's done. Humans drive the same
MCP tools from the admin UI for one-off tasks; the SDK path exists
for that case alone.

This sits alongside `CRUD_UTOPIA.md` (declarations over code) and
`DESIGN_LANGUAGE.md` (tokens over hex). Where CRUD Utopia is the
shape of the codebase and Design Language is the shape of the UI,
Agentic Utopia is the shape of **how work actually gets done.**

## The Six Rules

1. **Operator-based routing is the spine.**
   `services/llm_router.get_provider()` checks the running process's
   agent identity. If an agent is in scope (env `CREMA_AGENT_IDENTITY`
   starts with `claude-`, or `CLAUDECODE=1`, or `AI_AGENT` starts
   with `claude-`), every LLM call is forced through the queue
   (`llm_jobs` table). The SDK path is reserved for human-triggered
   admin work — UI buttons, manual re-enrichment. An agent that
   explicitly requests SDK is treated as misconfiguration and the
   call still goes through the queue. Same prompt + same tool schema
   = same output, regardless of which executor runs it.

2. **MCP tools, not REST routes, are the agent-facing surface.**
   Every catalog-ops capability lives as an MCP tool under the
   `crema-catalog-ops` server. If an orchestrator can't drive a
   workflow end-to-end through MCP tools, the workflow doesn't
   belong in catalog-ops yet — build the MCP tool first, then expose
   it to humans via a UI button that hits the same handler.

3. **Opus orchestrates; Haiku executes.**
   Orchestration = high-stakes-per-decision reasoning. Picking which
   roasters need attention. Deciding whether a coverage flag warrants
   admin escalation. Summarizing what a run actually did, in plain
   English, for the human-facing digest. Execution = bounded,
   well-defined structured tasks. Extract a product. Classify an
   article. Normalize a flavor tag. Generate a site-quirk hint.
   Don't put Opus-grade reasoning in a Haiku prompt; don't burn
   Opus tokens on extraction work Haiku does cleanly.

4. **Activity log over approval queue.**
   When provenance is `haiku` and the data passes its gates, changes
   land directly. The admin sees an **activity log** of what
   happened (what was added, refreshed, removed) — not a queue
   waiting on them. Exceptions still route to review: first-time
   roaster onboarding, coverage-flagged runs (`< ~70%` sitemap
   coverage), `bs4_fallback` rows where Haiku failed, attempts to
   overwrite `admin_manual` provenance. Autonomous in the common
   case; human in the loop only where the decision matters.

5. **Suggest the agentic path on every new feature.**
   Before writing a UI handler that wraps a complex multi-step
   workflow, ask: "What MCP tools would an Opus orchestrator need to
   do this without me?" Often the answer is one or two new tools and
   a fully autonomous version of the same workflow becomes nearly
   free. **Suggest in the PR — don't auto-build.** The user decides
   whether to take the agentic version now, defer it, or skip it.
   The point is that the option is on the table for every new
   surface; nothing ships as UI-only by default.

**Before starting any catalog-ops session, read the Memory
section at the top of the admin Activity Log tab (or via
`crema_get_agent_memory`).** That surface is the living system
prompt for catalog-ops — accumulated lessons across sessions,
grouped by scope (architecture, drainer ops, filter design,
dev hazards, voice). Don't relearn the same mistakes; check
memory first. End each session by writing 1-3 fresh lessons
worth keeping via `crema_log_agent_memory` — the surface only
stays useful if it grows.

6. **Agent log is a journal, not a log file.**
   Every `crema_log_agent_summary` entry is written by the
   ORCHESTRATOR (you), in plain English, as if briefing a colleague.
   Not a technical dump. The admin UI renders the surface like the
   consumer JOURNAL: a card with title + 1-3 sentence excerpt,
   click to expand into a journal-style reader with the
   long-form `body_html`.

   **Voice rules:**
   - `task_label` = short noun phrase ("Refreshed Caaraabi catalog",
     not "Sweep job 627 with 4 drainer subagents at HH:MM:SS").
   - `summary` = 1-3 sentence teaser. Plain English. Treat as the
     excerpt the human reads on the card.
   - `body_html` = the journal article. Paragraphs + subheadings
     (h2/h3). Walk a colleague through what happened: what you set
     out to do, what you found, what's left. Use prose, not bullet
     lists of timestamps. Allowed HTML: `h2, h3, p, ul/ol/li,
     blockquote, strong, em, a`.
   - Surface real findings. If a roaster had a quirk, name the
     roaster + the quirk. If a filter caught something interesting,
     say so. Concrete > generic.
   - End with what's open if anything: pending follow-ups, edge
     cases that need a human decision, bugs to investigate next
     session. The human's read this to know what to look at.

   **What NOT to do:**
   - Don't paste raw log lines, stack traces, or per-job IDs into
     the body. Those belong in `metrics` / `prompt_excerpt` / the
     underlying `agent_runs` table — not the human-facing journal.
   - Don't write "the orchestrator processed N jobs across M
     roasters." Write "I refreshed Caaraabi's catalog this morning
     — 9 products through the pipeline, 5 of them caught by the
     new bundle filter before they reached Haiku."
   - Don't summarise tool calls. Summarise outcomes + decisions.

## When to Break the Rules

You will have to. Some operations genuinely need the SDK path or sit
outside the queue model:

- **Latency-sensitive UI calls.** An admin clicking "Refresh this
  roaster" expects a synchronous response. The handler runs as the
  admin's identity (no `CREMA_AGENT_IDENTITY` env), routes to SDK,
  returns. Same MCP tool the orchestrator would call — different
  executor.
- **Streaming responses.** SSE / progressive enrichment for a single
  UI interaction. The queue model is poll-based; for streaming, the
  SDK is the right shape.
- **One-shot bootstrap scripts.** A migration script populating data
  once doesn't need to be agentic. Run it inline, log what happened,
  move on.
- **External services without MCP coverage.** When MCP doesn't yet
  wrap a needed capability, **write the tool.** Don't fall back to
  direct API calls in catalog-ops code; that breaks rule 2.

The rule: **if an agent could drive it, expose an MCP tool. If only
a human can drive it, document why and route the handler through the
same MCP tool the agent would have used.**

## The Grep Test

A new contributor (or Claude session) should find consistent
behavior across these:

- `mcp__crema-catalog-ops__crema_*` — every catalog operation an
  agent might run.
- `services/llm_router.call_llm` — every LLM call in catalog-ops,
  never `anthropic.Anthropic(...).messages.create(...)` direct.
- `crema_haiku_next_job` + `crema_haiku_submit` — the only path
  agents use to execute LLM work.
- `agent_summaries` table writes — every autonomous run ends with a
  one-paragraph plain-English summary in the agent's own voice.

When you write a new catalog-ops surface, it should grep-match these
patterns. If it doesn't, you're breaking the contract — either by
going direct to the SDK from agent context (rule 1 violation), or
by skipping the MCP tool that humans + agents both need (rule 2),
or by introducing an approval gate where an activity-log entry
would do (rule 4).

## Adding a Feature — Checklist

| Need | Destination |
|------|-------------|
| New catalog operation | New MCP tool in `mcp-server/src/tools/` + handler in `routes/specific.py` or `services/catalog_ops.py` |
| New LLM call | `services/llm_router.call_llm` — never the SDK directly |
| New autonomous workflow | Compose existing MCP tools from an orchestrator; don't add a one-off Python function |
| New admin UI surface | Build the MCP tool first; wire the UI to the same handler |
| New observability surface | Read from `agent_summaries`, `agent_actions`, `agent_memory`; don't grep `jobs.log_tail` |
| New reasoning task | Decide Opus vs Haiku by per-decision stakes, not by familiarity — orchestration → Opus, execution → Haiku |

If you're tempted to add a workflow that's only reachable from the
UI — stop. Either an agent could drive it (so expose the MCP tool),
or it's genuinely one-off (so it doesn't need agentic
infrastructure). The middle ground — "it would be too hard to make
agentic right now" — is where invisible coupling accumulates.

## Why This Exists

Catalog ops at scale (120+ roasters, 600+ products, weekly refresh)
cannot be a human job. Every operation must be reachable by an
autonomous orchestrator OR it eventually starves: the human
responsible for clicking the button gets tired, the queue grows,
the catalog drifts. The agent-first directive is what prevents that
decay.

The flywheel: every new MCP tool the orchestrator can call → one
more decision the human doesn't have to make → more time for the
human to design new tools and shape policy → faster compounding
autonomy. Breaking the pattern (going direct to the SDK from agent
context, building a UI-only handler, skipping the activity log)
doesn't just add tech debt — it pulls the catalog back into
manual-mode and breaks the flywheel.

The catalog-ops surface should grow toward a state where the human
designs orchestrators and writes new MCP tools; the orchestrators
run the catalog. UI buttons exist for the cases the orchestrator
got wrong, not as the default execution path.

## Reference Files

- `services/llm_router.py` — operator-based routing (rule 1).
- `mcp-server/src/tools/` — MCP tool definitions (rule 2).
- `services/catalog_ops.py` — workflow runners; orchestrator-facing.
- `database.py` — `agent_summaries`, `agent_actions`, `agent_memory`,
  `llm_jobs` tables (rule 4).
- `feedback_mcp_dual_use_routing.md` in agent memory — operator-vs-
  agent routing rationale.

---

*This file is canonical. If code contradicts it, the code is wrong.*
