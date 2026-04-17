# Coffee Aggregator (Crema) — working context for Claude

This file is auto-loaded into every Claude Code session in this repo.
It pins the vision doc to every turn and tells Claude which other docs
to pull in depending on the kind of work being done.

## Always-loaded: the north star

The vision anchor. Everything else is downstream of this.

@NORTH_STAR.md

## Before any dev / implementation work — read these

The moment a request is about writing, modifying, debugging, reviewing,
deploying, or scoping code (anything beyond discussion, research,
docs-only edits, or non-technical planning), Read the full contents of
both before proposing changes or writing code:

- [CRUD_UTOPIA.md](CRUD_UTOPIA.md) — architecture rules (registry-driven backend, design tokens, the non-negotiables)
- [BUILD_ROADMAP.md](BUILD_ROADMAP.md) — what's built, what's next, key files per feature

If unsure whether a request counts as "dev work," err on the side of
reading them. The cost is small; the cost of acting on stale
assumptions is large.

## Read-on-demand

Pull these in only when the task touches their area:

- [README.md](README.md) — repo overview, onboarding, local setup
- [LAUNCH_TODO.md](LAUNCH_TODO.md) — pre-launch backlog. Don't self-direct onto these items; only pull in when the user explicitly asks to work on launch blockers / infra / legal / app-store prep.
- [specs/UI_SPEC.md](specs/UI_SPEC.md) — component structure, page flows, design tokens
- [specs/CATALOG_SPEC.md](specs/CATALOG_SPEC.md) — catalog data model
- [specs/SCRAPER_SPEC.md](specs/SCRAPER_SPEC.md) — scraper architecture
- [specs/COMMUNITY_SPEC.md](specs/COMMUNITY_SPEC.md) — social feed (the retention surface)
- [specs/ENRICHMENT_PROMPT.md](specs/ENRICHMENT_PROMPT.md) — LLM enrichment prompts

## Keeping BUILD_ROADMAP.md current

Living doc. When work lands, update it in the same change (or the
immediate follow-up commit) — don't let reality drift from what's
written.

- When a feature is shipped, move it from "next build targets" into
  the appropriate "What has been built" section with a one-line
  description and the key files touched (match the existing table
  format).
- When an architectural decision changes, update the relevant prose —
  don't just append. The roadmap should read as the current state, not
  a changelog.
- When a new build target appears (user asks for a new feature, scope
  expands), add it to the "next build targets" section so it isn't
  lost.

If it's unclear whether a feature is "done enough" to move into the
shipped section, prefer a brief note over guessing. BUILD_ROADMAP is
read by humans as the project's ground truth — accuracy matters.

## Not doing yet: LAUNCH_TODO.md items

The launch blockers, infra setup, legal review, and app-store prep in
[LAUNCH_TODO.md](LAUNCH_TODO.md) are **not the default workstream**.
Don't self-direct onto them. If status on those items matters to a
specific request, the user will say so explicitly.

When LAUNCH_TODO items do come up:
- `[ ]` → `[~]` when starting, `[~]` → `[x]` when done (with commit
  hash / short note), `[~]` → `[!]` if blocked.
- Part 2 items need the user's credentials/money/decision — leave a
  "YOU: <decision>" line instead of starting those.

## Standing rules

- Don't create new top-level `.md` files without asking. The set above
  is deliberate.
- When a task touches multiple specs, update each spec in the same
  change rather than leaving specs to drift behind code.
- If the code contradicts a spec, surface it — don't silently "fix"
  the spec to match the code or vice versa.
