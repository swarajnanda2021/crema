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

## Tools (v1)

| Tool | Purpose | Read-only |
|---|---|---|
| `crema_list_roasters` | Substring search across published roasters | yes |
| `crema_get_all_status` | Orchestrator dashboard: snapshot age + diffs per roaster | yes |
| `crema_get_snapshot` | Drill into one roaster's snapshot + diff | yes |
| `crema_list_proposals` | List scrape proposals (pending / applied / rejected) | yes |
| `crema_get_hints` | Read all 3 site quirks for one roaster | yes |
| `crema_list_jobs` | Recent catalog-ops jobs | yes |
| `crema_list_agent_runs` | Read the audit log (filter by agent/tool/session) | yes |
| `crema_sync_roaster` | Crawl + snapshot ONE roaster (no LLM) | idempotent |
| `crema_sync_all` | Bulk crawl + snapshot every roaster | idempotent |
| `crema_enrich_roaster` | Full pipeline: bio + catalog + article (Sonnet + Haiku) | no |
| `crema_enrich_all` | Bulk full-pipeline refresh | no |
| `crema_approve_proposals` | Approve proposals by id (merge to live products) | no |
| `crema_reject_proposals` | Reject proposals by id | no |
| `crema_set_diff_hint` | Admin-write the diff quirk for one roaster | idempotent |
| `crema_regenerate_hint` | Flag bio or journal hint for regeneration | idempotent |

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
- **Provider abstraction.** Anthropic-first. Adding Ollama / local Llama / OpenAI-compatible runners happens when we wire the agent_runner config layer.
- **Admin "Agent activity" UI.** The data lands in `agent_runs`; the admin tab that visualizes it is the next clone of the orchestrator surface pattern.
- **Daily ops digest endpoint.** Aggregated per-day stats for the morning email.

## Architectural decisions

- **TypeScript over Python**: backend Python is 3.9, MCP SDK requires 3.10+. TS is officially recommended by Anthropic and the MCP server doesn't share code with the Python backend anyway (it just makes HTTP calls).
- **Audit via FastAPI endpoint, not direct DB write**: the MCP server stays a thin HTTP wrapper. If the audit logic ever needs a hook (rate-limit, alert on destructive op), the FastAPI middleware is the right place.
- **No business logic in the MCP**: every tool is a wrapper. Drift between MCP and web UI is impossible because both call the same endpoints.
