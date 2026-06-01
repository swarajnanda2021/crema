# Catalog-Ops Workspace

Autonomous orchestrator for the Crema catalog. **MCP only** —
`mcp__crema-catalog-ops__crema_*`. No SQL, no curl, no file reads of
catalog state, no Python over returned JSON to compute a rollup. If a
needed operation isn't exposed as an MCP tool, surface that to the
human — don't bypass.

## How to act

1. **Read the user's verb.** Pick ONE entry from the TOC below.
2. **Fire the tool.** Read the response's `next_steps` array. Execute
   the appropriate follow-on action. The workflow is structurally
   encoded in the response — you don't need to remember it.
3. **Need more detail?** `crema_get_runbook("<verb_slug>")` returns
   the deep doc for that verb. Don't preload the runbook.

## Verb → first tool (TOC)

| Verb | First tool | Runbook slug |
|---|---|---|
| "bulk enrich" / "force re-enrich" / "nuclear" | `crema_list_roasters({include_unpublished:true})` → `crema_full_reenrich_roaster` per slug | `bulk_enrich` |
| "refresh" / "weekly" / "heartbeat" | `crema_diff_sweep` → `crema_enrich_all({filter:{has_diff:true}})` | `refresh` |
| "onboard <url>" | `crema_onboard_roaster({website})` | `onboard` |
| "post-sweep QC" / "review the catalog" | `crema_run_quality_review_sweep` | `quality_review` |
| "check bio quality" / "find URL drift" | `crema_run_quality_review_sweep({target_table:"roaster_profiles"})` | `bio_review` |
| "what's flagged?" / "review queue" | `crema_list_quality_reviews({verdict:"confirmed"})` | `quality_review` |
| "fix the hallucinations" / "T3" | `crema_prepare_t3_review` → reason → `crema_apply_t3_correction` | `t3` |
| "dedupe" / "consolidate duplicates" | `crema_dedupe_products({dry_run:true})` | `dedupe` |
| "what just happened?" / "audit ops" | `crema_list_catalog_operations` | `audit_ops` |
| "rollback" / "undo that op" | `crema_rollback_catalog_operation` | `rollback` |
| "investigate <product>" | `crema_get_product_detail` | `investigate` |
| "grade articles" | `crema_grade_articles` | `grade_articles` |
| "re-touch existing products only" (rare) | `crema_bulk_reenrich_roaster` | `bulk_reenrich_legacy` |

## Hard rule — drainer identity

Spawned Haiku drainer subagents MUST pass `agent_identity` containing
"haiku" (case-insensitive). The server rejects orchestrator drains
with 403 — drainers only. `crema_get_runbook("drainer_template")` for
the full template + sequencing rules.

## Memory is lazy

Use `crema_search_agent_memory("3-7 word query")` for top-k lookups.
Avoid the bulk `crema_get_agent_memory` dump unless you genuinely need
everything. Memory exists to help when stuck on an unfamiliar pattern
— it's a lookup, not a session-start preload.

## After meaningful phases

- `crema_log_agent_action` (10-20 per session, narrative reasoning)
- `crema_log_agent_summary` (1-3 per session, human-readable card)

Plain English. Outcomes + decisions. No timestamps, no job IDs.

---

**Why this file is short on purpose:** context rot. Every byte of
auto-loaded doc compounds against the orchestrator's working memory
budget. The full cheat-sheet lives in `RUNBOOK.md` and is fetched on
demand via `crema_get_runbook`. The `next_steps` array on every tool
response carries the workflow itself — you read the next action from
the previous tool's response, not from documentation.
