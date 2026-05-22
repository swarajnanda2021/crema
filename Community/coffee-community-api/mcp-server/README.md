# crema-catalog-ops MCP server

Exposes Crema's catalog ops as MCP tools agents (Claude Desktop, Claude Code, future LLM clients) can call directly. Wraps the existing FastAPI backend; adds no business logic. Every tool call is logged to `agent_runs` so the admin can see what each agent did.

## What this is for

Catalog ops in Crema is routine work that an agent should drive — refreshing snapshots, running enrichment, approving high-confidence proposals, generating per-roaster site quirks. The web UI handles per-roaster visual judgment work. The MCP is for bulk + scheduled + agentic operations.

Same backend, two clients:

```
   FastAPI backend (services/ — sync_runner, catalog_ops, roaster_enricher)
       │                    │
       ▼                    ▼
   Web UI               This MCP server
   (humans)             (agents — Claude / cron / future LLMs)
```

## Tools

**56 tools** across the catalog-ops surface (as of 2026-05-21). Grouped
by verb-class; full per-tool catalog in
[`specs/CATALOG_OPS_AGENT_WORKPLAN.md`](../../../specs/CATALOG_OPS_AGENT_WORKPLAN.md)
§2.

| Group | Count | Examples |
|---|---:|---|
| **Discovery (read-only)** | 7 | `crema_list_roasters`, `crema_get_all_status`, `crema_get_snapshot`, `crema_list_proposals`, `crema_get_hints`, `crema_list_jobs`, `crema_list_agent_runs` |
| **Sync (LLM-free, cheap)** | 3 | `crema_sync_roaster`, `crema_sync_all`, `crema_diff_sweep` (daily heartbeat) |
| **Enrichment (LLM)** | 2 | `crema_enrich_roaster`, `crema_enrich_all` |
| **Proposals** | 4 | `crema_auto_approve_proposals`, `crema_approve_proposals`, `crema_reject_proposals`, `crema_undo_scrape_job` |
| **Hints** | 2 | `crema_set_diff_hint`, `crema_regenerate_hint` |
| **Drainer-only** (`llm_jobs` queue) | 3 | `crema_haiku_next_job`, `crema_haiku_submit`, `crema_list_llm_jobs` |
| **Roaster lifecycle** | 5 | `crema_onboard_roaster`, `crema_delete_roaster`, `crema_publish_roaster`, `crema_update_scrape_settings`, `crema_test_source_url` |
| **Standardization** | 4 | `crema_standardize_stats`, `crema_standardize_exemplars`, `crema_standardize_run`, `crema_regenerate_exemplars` |
| **Flavor schemas** | 3 | `crema_list_flavor_schemas`, `crema_upload_flavor_schema`, `crema_activate_flavor_schema` |
| **Journal/articles** | 5 | `crema_bulk_scrape_articles`, `crema_scrape_roaster_articles`, `crema_list_articles`, `crema_set_article_published`, `crema_delete_article` |
| **Per-product** | 3 | `crema_get_product_detail`, `crema_reenrich_product`, `crema_mark_product_sold_out`, `crema_delete_product` |
| **Job inspect/control** | 6 | `crema_get_scrape_run_log`, `crema_cancel_running_job`, `crema_get_raw_snapshot`, `crema_get_llm_job_detail`, `crema_requeue_llm_job`, `crema_list_scrape_runs` |
| **Aggregate observability** | 3 | `crema_catalog_stats`, `crema_proposal_breakdown`, `crema_freshness_report` |
| **Agent working journal** | 4 | `crema_log_agent_action`, `crema_get_session_actions`, `crema_log_agent_memory`, `crema_get_agent_memory` |
| **Agent summaries** | 1 | `crema_log_agent_summary` (boss-man end-of-session report) |

## The agent's working pattern

A session typically follows this shape:

```
START → crema_get_agent_memory({scope: "catalog-ops"})    # institutional knowledge
       → crema_get_session_actions({limit: 20})           # what did previous agents do?

DURING → crema_diff_sweep / crema_enrich_all / drainer rounds / auto-approve
       → crema_log_agent_action(...) after each meaningful phase  # 10-20 entries per session

END   → crema_log_agent_summary(...)                       # boss-man report
       → crema_log_agent_memory(...) × N (optional)        # new lessons worth keeping
```

The action log is INTENTIONALLY coarser-grain than `agent_runs` (which logs every tool call). One `log_agent_action` per phase — `"diff_sweep"`, `"enrich_all on 10 stale roasters"`, `"spawned drainer L"`, `"investigated humble-express deletions"`. The `reasoning` field is the human-readable WHY, not just what happened.

Memory entries are durable lessons across sessions: `"Shopify /products.json sometimes returns empty under rate-limit; retry once with 2s backoff."` Future agents read these at session start and inherit the lesson without needing the original incident report.

## The MCP-purity rule

Every read or write to catalog state goes through an MCP tool. When a needed read isn't surfaced, **add a new MCP tool first**, then use it. Direct SQL, ad-hoc Bash, file reads of saved tool output are not allowed for catalog ops — they break provider portability (a different LLM operator drops in and can't replicate the workflow).

The 4 aggregate-observability tools + the working-journal tools above (added 2026-05-21) were built precisely to close every SQLite-bypass that crept into earlier sessions.

## Setup

```bash
cd Community/coffee-community-api/mcp-server
npm install
npm run build
```

You need an admin bearer token. Mint one against the local FastAPI:

```bash
python3 - <<'PY'
import sqlite3, secrets, datetime
c = sqlite3.connect("../coffee_community.db")
admin = c.execute("SELECT id FROM users WHERE username='crema'").fetchone()
assert admin, "no admin user — seed via Community/coffee-community-api/seed_admin.py first"
token = secrets.token_urlsafe(32)
now = datetime.datetime.now(datetime.timezone.utc)
expires = (now + datetime.timedelta(days=30)).isoformat().replace("+00:00","Z")
c.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
          (token, admin[0], now.isoformat().replace("+00:00","Z"), expires))
c.commit()
print("CREMA_ADMIN_TOKEN=" + token)
PY
```

Export the token (and optionally pin an agent identity + session id):

```bash
export CREMA_ADMIN_TOKEN=<...>
export CREMA_AGENT_IDENTITY="claude-opus-4-7@anthropic-via-claude-code"
export CREMA_SESSION_ID="ops-$(date +%Y-%m-%d)"  # optional, groups a batch
```

## Register with Claude Code

```bash
claude mcp add \
  -s project \
  -e CREMA_ADMIN_TOKEN=$CREMA_ADMIN_TOKEN \
  -e CREMA_AGENT_IDENTITY="claude-opus-4-7@anthropic-via-claude-code" \
  -e CREMA_API_BASE=http://localhost:8000 \
  crema-catalog-ops \
  -- node $(pwd)/dist/index.js
```

Then restart Claude Code. The tools appear as `mcp__crema-catalog-ops__crema_*` in future sessions.

## Test it without Claude Code

Manual stdio call:

```bash
CREMA_ADMIN_TOKEN=$TOKEN node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"crema_get_all_status","arguments":{"has_diff":true}}}
EOF
```

Or use the MCP Inspector:

```bash
npm run inspect
# opens http://localhost:5173 — interactive tool UI
```

## How audit logging works

Every tool call wraps execution with INSERT-before / UPDATE-after on the `agent_runs` table. Read the trail back via:

```bash
crema_list_agent_runs(agent_identity="...", tool_name="...", session_id="...", limit=100)
```

Each row carries `agent_identity` (which LLM ran the call), `operator_user_id` (which admin's token was used), `session_id` (which batch), `args_json` + `result_summary`, plus `started_at` / `finished_at` so the run duration is queryable. Future "Agent activity" admin view reads this table directly.

## What's deliberately NOT in v1

These are LAUNCH_TODO items, not today's work:

- **HTTP/SSE transport.** stdio only for now; cloud deployment + bearer-token auth come when the backend moves to cloud.
- **Provider abstraction.** Anthropic-first via the agent-fallback queue (`LLM_PROVIDER=claude_code_agent` routes enrichment to `llm_jobs`; drainers running as Claude Code agents answer). Adding Ollama / local Llama / OpenAI-compatible drainers is a drainer-side change — the MCP surface stays the same.
- **Origin/varietal/roast/process tree mutation tools.** Those four trees are hardcoded Python enums in `services/sca_geolocator.py`. Mutating them needs a backend write API first. The flavor (SCA) tree IS mutable today (`crema_upload_flavor_schema` + `_activate_*`).
- **Daily ops digest endpoint.** The agent journal (`agent_actions` + `agent_memory` + `agent_summaries`) is the substrate. The morning-email aggregator on top of it is still to build.

## Architectural decisions

- **TypeScript over Python**: backend Python is 3.9, MCP SDK requires 3.10+. TS is officially recommended by Anthropic and the MCP server doesn't share code with the Python backend anyway (it just makes HTTP calls).
- **Audit via FastAPI endpoint, not direct DB write**: the MCP server stays a thin HTTP wrapper. If the audit logic ever needs a hook (rate-limit, alert on destructive op), the FastAPI middleware is the right place.
- **No business logic in the MCP**: every tool is a wrapper. Drift between MCP and web UI is impossible because both call the same endpoints.
