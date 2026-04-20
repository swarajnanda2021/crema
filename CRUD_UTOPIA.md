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

## Design-language directive (non-negotiable)

Every new screen or component must pass through this checklist before it lands. Rule 4 says "every visual value lives in tokens" — this is what "every" means in practice:

- **Colors:** `t.color.*` only. No hex inline anywhere outside `design-tokens.json` (even subtle shades).
- **Fonts:** `t.font.*` only. `CanelaText_Regular` is the display font; `Inter_*` the body family. No web-font-stack strings, no inline family names.
- **Font sizes:** **pick from `t.size.font.*`** — do not invent numbers. The ladder is `xs 10 · sm 11 · base 13 · md 14 · lg 16 · xl 18 · 2xl 24 · display 32 · price 20`. If the design calls for something that doesn't exist, extend the ladder in `design-tokens.json`, don't inline the number.
- **Spacing:** `t.spacing.*` for padding / margin / gap — `2xs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · 2xl 24 · 3xl 32 · 4xl 40 · 5xl 64`. Again, extend the scale if you need a new value; never inline `padding: 14`.
- **Radius:** `t.radius.*`. Same rule.
- **Shadow:** `shadow("card")` / `shadow("card.hover")` — the helper in `useTokens.ts`. Don't compose `shadowOffset` / `shadowOpacity` inline.
- **Icons:** `lucide-react-native` only (matches what Navbar / tabs / composers already use). Icon sizes from `t.size.icon.*`. No custom SVGs for concepts lucide already covers.

**Before you write a new screen:** open the nearest existing screen of the same type (feed / detail / form / empty-state) and mirror its structural moves — how the header is spaced, what the first row looks like, where body copy sits. If your new screen lays out fundamentally differently from its peers, stop and justify.

**Empty states** specifically: match the feed's "Nothing here yet." language — `t.font["body.regular"]` at `t.size["font.md"]` in `t.color["text.muted"]`, centered on `t.color.bg`. No big icons, no bespoke illustrations, no headings; the Stack header / tab label already names the surface.

**Mobile-vs-wide branches** must go through `useBreakpoint().isMobile`. Never branch on `Platform.OS === "web"` for visual decisions — a narrow web browser counts as mobile too.

The grep test (above) applies here: if a new screen breaks any of these rules, `grep` for the offending pattern (`fontSize: \d+`, `#[0-9a-fA-F]{3,6}`, `padding: \d+` outside style-token definitions) across the codebase and you should find one violation, not many. If it's already one of many, that's tech debt — flag it, don't compound it.

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
