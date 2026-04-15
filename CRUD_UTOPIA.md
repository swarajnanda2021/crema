# CRUD Utopia — The Directive

This codebase is **registry-driven**. Before you write code, understand the pattern. Before you add a file, check if the work belongs in an existing declaration.

## The Six Rules

1. **Backend resources are declared, not coded.** Every CRUD resource lives in `Community/coffee-community-api/resources/registry.py`. The generic engine in `resources/crud.py` turns declarations into SQL. Adding a new resource means ~20 lines of registry, not a new router file.

2. **Every API response is envelope-wrapped.** The shape is `{ data: ..., meta: { resource, total?, limit?, offset? } }`. Wrap with `ok()` from `resources/envelope.py` on the backend. Unwrap with `res?.data ?? res` on the frontend. No exceptions.

3. **Every frontend data fetch uses `useResource<T>` or `apiFetchRaw`.** No raw `fetch()` calls to the API. The generic hook handles envelope unwrapping, pagination, mutations. `apiFetchRaw` is the escape hatch for one-offs.

4. **Every visual value lives in `design-tokens.json`.** Colors, fonts, sizes, spacing, radius, shadows. Components read via `t.color.*`, `t.font.*`, etc. from `useTokens.ts`. No hex codes inline, no magic numbers. This file is platform-agnostic — Swift and Kotlin apps read the same JSON.

5. **Every hook-driven side effect lives in `services/`.** Notifications on like/comment/follow, catalog sync, anything triggered declaratively via `on_create`/`on_toggle_on` in the registry. The hook name is just a string; the implementation is discovered by name in `services/notifications.py` or adjacent service files.

6. **Every composite action that can't be declared lives in `routes/specific.py`.** Custom SQL joins, signed tokens, rate limits, file uploads, streaming. If it fits the generic engine, declare it. If it doesn't, isolate it and comment why.

## When to Break the Rules

You will have to. Some actions can't be declared:

- **Signed tokens** (QR tokens, reset tokens) — use `services/qr_tokens.py` pattern: UUID in DB with expiry
- **Composite queries** (cross-table filters like "posts liked by user X") — use `build_select` + `row_to_dict` helpers from `crud.py` to stay close to the registry while hand-writing the join
- **Rate limits** — enforce in the specific endpoint, not the registry
- **File uploads** — `routes/uploads.py` is the exception; multipart isn't CRUD
- **External APIs** (link preview, third-party integrations) — specific endpoints, clearly isolated

The rule: **if you can declare it, declare it. If you can't, isolate it and mark it.**

## The Grep Test

If a new contributor (or Claude session) greps for any of these patterns, they should find consistent behavior:

- `apiFetchRaw` → ~20 call sites, all using `res?.data ?? res` pattern
- `t.color` / `t.font` → used everywhere, never a hex literal inline
- `ok(` in backend → every API response, no unwrapped dicts
- `useResource` → every data-fetch screen, never bespoke fetch logic
- Registry entries → every CRUD resource

When you write new code, it should grep-match the existing patterns. If it doesn't, you're breaking the contract.

## Adding a Feature — Checklist

Before writing any code, walk through this:

| Need | Destination |
|------|-------------|
| New CRUD resource | Add to `resources/registry.py` |
| New visual value | Add to `src/tokens/design-tokens.json` |
| New data fetch | Use `useResource<T>` or `apiFetchRaw` |
| New API response | Wrap with `ok()` |
| New side effect on create | Add hook to registry + implement in `services/` |
| New composite action | Add to `routes/specific.py` with comment |
| New type | Add to `src/resources/types.ts` |
| New screen | File in `app/` following Expo Router conventions |

If you're tempted to add something that doesn't fit any of these — stop. The pattern exists for a reason. Either you're solving the wrong problem, or you need to extend one of the declaration systems instead of bypassing them.

## Why This Exists

The backend went from 1,416 lines in `main.py` to 57 lines because resources are declared once and generated many times. The frontend has zero duplicate shelf-color constants because tokens are declared once and consumed everywhere. This is not an accident — it's the architecture.

Breaking the pattern has a cost that isn't immediately visible: the next contributor won't know whether to follow your new convention or the old one. Within three months, you have two patterns. Within a year, five. The codebase becomes a museum of half-abandoned approaches.

CRUD Utopia works as long as everyone holds the line. That's what this directive is for.

## Platform Migration

The architecture is designed for cross-platform portability:

- `design-tokens.json` — a Swift or Kotlin app reads the same file, maps to `UIColor` / `Color`
- `registry.py` — resource definitions are language-agnostic; a Swift code generator could produce `Codable` structs and API client methods from this file
- Response envelope — one `Envelope<T>` generic decoder works for every endpoint
- `useResource<T>` — maps 1:1 to a Swift `@Observable class Resource<T>`

When the iOS app is built, these three contracts carry over. The remaining work is platform-specific UI.

## Reference Files

These are the load-bearing files. They each carry a directive header pointing back here:

- `Community/coffee-community-api/resources/registry.py` — resource declarations
- `Community/coffee-community-api/resources/crud.py` — generic SQL engine
- `Community/coffee-community-api/resources/envelope.py` — response wrapper
- `crema-app/src/resources/useResource.ts` — generic data-fetch hook
- `crema-app/src/tokens/useTokens.ts` — token provider
- `crema-app/src/api/client.ts` — API client

Read these six files and you have the whole architecture.

---

*This file is canonical. If code contradicts it, the code is wrong.*
