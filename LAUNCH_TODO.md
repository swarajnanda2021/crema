# LAUNCH_TODO — Friends & Family deploy

This file is scoped to the **Friends & Family tier** — getting Crema
online for ~10-30 weekly-active users in one city, with near-zero
monthly cost. Full public launch prep (App Store, legal review,
moderation, Postgres, object storage, etc.) is deliberately parked
in Part 3 until we actually outgrow this tier.

See `NORTH_STAR.md` §3 for the phase plan. F&F sits comfortably
below Phase 1 targets (500 registered / 50 WAU).

## Target

- ~10-30 WAU
- 2-3 concurrent users at peak
- 5-10 uploads/day
- Single city (Goa pilot)
- Cost ceiling: <$5/mo runtime + ~$10/yr domain

## Architecture

One Fly.io app, one Cloudflare zone. Same container serves:
- `/api/*` — FastAPI backend
- `/*`     — Expo web export (static, mounted inside the app)

SQLite + local uploads live on a mounted Fly volume. No Postgres,
no object storage, no second server. When we outgrow this — Postgres
and object storage come back (see Part 3).

```
cremabrews.com ─▶ Cloudflare (DNS + edge cache)
                      │
                      ▼
           Fly app (bom region, 1× shared-cpu-1x)
           ├── FastAPI routes on /api/*
           ├── Expo web static on /*
           └── /data volume ── SQLite + uploads
```

## How this file works

Status key:
- `[ ]` — not started
- `[~]` — in progress (flip when you start)
- `[x]` — done (leave a commit hash or short note)
- `[!]` — blocked (reason on the line below)

Part 1 is mine — no credentials needed. Part 2 is yours — sign-ups,
DNS, deploy commands. Part 3 is the parked backlog; don't touch
unless the trigger fires.

---

# Part 1 — Code prep (I ship these; no credentials needed)

Goal: get the repo into a state where `fly deploy` just works.

### 1.1 Secrets sweep `[ ]`
Audit every committed file for hardcoded passwords, tokens, API
keys, seed UUIDs. Scrub `seed_admin.py`'s `crema/crema` fallback so
a fresh prod DB doesn't ship with an admin password printed in the
repo. Add `.env.example` documenting every key the backend and
frontend read.

### 1.2 Env lockdown `[~]`
Four env vars, nothing more. All default to current localhost
behavior so dev stays unchanged:
- `CORS_ORIGINS` — comma-separated list. Prod:
  `https://cremabrews.com`. Dev fallback: `*`.
- `DB_PATH` — path to the SQLite file. Prod:
  `/data/coffee_community.db` (mounted volume). Dev fallback:
  `./coffee_community.db` (cwd).
- `UPLOADS_DIR` — upload write path. Prod: `/data/uploads`. Dev
  fallback: `./uploads`.
- `ANTHROPIC_API_KEY` — Sonnet key the Catalog Ops bio enrichment,
  per-product enrichment, and SCA tag classification all read.
  Missing key degrades gracefully (`enrichment_status='deferred'`),
  not a hard failure. Local dev loads from
  `Community/coffee-community-api/.env` via `python-dotenv` (added
  to `requirements.txt`, wired in `main.py` before any service
  imports). Prod injection via `fly secrets set ANTHROPIC_API_KEY=...`
  — Fly stores it encrypted, never on disk in the image. Same
  `os.environ.get(...)` read-path in both worlds. `.env` is
  gitignored at repo root (line 11) and `.env.example` documents
  the full list. If a real key ever lands in git history, **rotate
  at console.anthropic.com immediately** — making the repo private
  doesn't fix already-committed secrets, only rotation does.

`main.py`, `database.py`, `routes/uploads.py` each read one of
these. No config framework, no pydantic-settings — four lines of
`os.environ.get()`.

### 1.3 Dockerfile + static mount `[ ]`
Multi-stage Dockerfile:
1. **Stage 1 — Expo web build.** `node:20-alpine`, `cd crema-app`,
   `npm ci`, `npx expo export -p web`. Output lands in `dist/`.
2. **Stage 2 — Python runtime.** `python:3.11-slim`, install
   `Community/coffee-community-api/requirements.txt`, copy the
   backend source, copy Stage 1's `dist/` into `/app/static/`.
3. Entrypoint: `uvicorn main:app --host 0.0.0.0 --port 8080`.

In `main.py`, mount the static dir at `/` AFTER the router include:
`app.mount("/", StaticFiles(directory="static", html=True))`. The
`html=True` flag makes unknown paths fall through to `index.html`
so Expo Router's client-side routing keeps working.

**Backend Python dependencies** (`Community/coffee-community-api/requirements.txt`
is the source of truth — Stage 2 just `pip install -r`s it):
- `fastapi`, `uvicorn[standard]` — HTTP server.
- `passlib[bcrypt]` — auth password hashing.
- `python-multipart` — file uploads.
- `python-dotenv` — local-dev `.env` loader (Fly secrets bypass it; safe in prod).
- `anthropic` — Sonnet / Haiku SDK for Catalog Ops bio enrichment + per-product enrichment + SCA tag classification.
- `requests`, `beautifulsoup4` — HTML fetch + parse for the bio enrichment hero (homepage + about-page scrape).

If you ever add a new Python dep to a `services/` file, **always**
add it to this requirements.txt — otherwise the local M1 dev runs on
the user's `(base)` venv (which has half-installed packages) and the
prod Fly build fails on first deploy because `pip install` only
sees what's declared. Symptom in the wild: `503 anthropic SDK isn't
installed` after the API key is set — that's the test that catches
missing-dep regressions.

The backend `Makefile` (`make dev`, `make install`, `make seed-cafes`)
is dev-only — Fly bypasses it via the Dockerfile entrypoint above.
Don't try to invoke `make` inside the container.

### 1.4 Error boundary + 404 route `[ ]`
Expo Router's `ErrorBoundary` export with user-friendly copy, plus
a 404 screen. Cheap to write, meaningful the first time an F&F user
mistypes a URL.

### 1.5 Docker compose for local parity `[ ]`
Optional but high-leverage. `docker-compose.yml` that runs the same
image locally with a bind-mounted volume. Lets us verify the
production-shaped build works before pushing to Fly.

---

# Part 2 — Deploy (you drive; credentials needed)

Do these in order, in one sitting. Expected total: ~45 min.

### 2.1 Register `cremabrews.com` at Cloudflare `[ ]` YOU
Dashboard → Domain Registration → search → register (~$10/yr,
at-cost). Domain auto-lands in your Cloudflare DNS with an empty
zone. Nothing else to configure yet.

### 2.2 Fly.io account `[ ]` YOU
Sign up at fly.io, add a card, then:
```
brew install flyctl
fly auth login
```

### 2.3 `fly launch` from repo root `[ ]` YOU
Generates `fly.toml`. Prompts:
- App name → `crema` (or whatever; becomes `<name>.fly.dev`)
- Region → **bom** (Mumbai, closest to India)
- Postgres → **no** (we use SQLite)
- Redis → **no**
- Deploy now → **no** (need to add volume first)

### 2.4 Create + mount the persistent volume `[ ]` YOU
```
fly volumes create crema_data --size 1 --region bom
```
Then add to `fly.toml`:
```toml
[[mounts]]
  source = "crema_data"
  destination = "/data"
```

### 2.5 Set env vars `[ ]` YOU
```
fly secrets set \
  CORS_ORIGINS="https://cremabrews.com" \
  DB_PATH="/data/coffee_community.db" \
  UPLOADS_DIR="/data/uploads" \
  ANTHROPIC_API_KEY="sk-ant-..."
```
The local-dev `.env` file is **not** uploaded — Fly secrets are the
prod injection path. Same `os.environ.get(...)` read-path in the
Python code, so no code changes between dev and prod.

When you scale past F&F (think Phase 1+ with 1–5k weekly actives,
where Sonnet usage is non-trivial), consider rotating
`ANTHROPIC_API_KEY` to a separate prod-only key with its own usage
cap so a runaway scrape can't drain the dev quota. Same `fly secrets
set` flow, just a different key value — no code or infra change.

### 2.6 First deploy `[ ]` YOU
```
fly deploy
```
First build takes 5-10 min (Node + Python toolchain). Subsequent
deploys are 1-2 min. Logs: `fly logs`.

### 2.7 SSL cert + DNS `[ ]` YOU
```
fly certs create cremabrews.com
fly certs create www.cremabrews.com
```
Fly prints the DNS records (typically `CNAME` → `<app>.fly.dev`).
Paste into Cloudflare DNS — start with **gray cloud (DNS only)**
so the cert can validate. Once
`fly certs show cremabrews.com` says "Ready", flip to **orange
cloud** for edge caching.

### 2.8 Smoke test `[ ]` YOU
Open `https://cremabrews.com` on phone + laptop.
- Sign in as your existing user account.
- Open a coffee card, like a post, comment, write a tasting note.
- Upload an image from the composer.
- Check `/profile` → Recycle bin opens.
- Admin dashboard loads if you're `crema`.

If any step fails, `fly logs` → reproduce → fix → `fly deploy`.

### 2.9 Daily volume snapshots `[ ]` YOU
In `fly.toml`:
```toml
[[mounts]]
  source = "crema_data"
  destination = "/data"
  snapshot_retention = 5
```
Then `fly deploy` once more. Costs ~$0.05/mo; protects against
accidental wipe.

### 2.10 Invite 3-5 friends `[ ]` YOU
The whole point of F&F. Send them the link, ask for honest
reactions in a group chat, take notes.

---

# Part 3 — Parked until we outgrow F&F

Don't touch anything below unless the trigger on its line has
fired. These are all legitimate work, they're just wrong for F&F
scale.

## 3.1 Scale triggers

| Trigger | Unlocks |
|---------|---------|
| SQLite file > 500 MB OR write contention on multi-replica | §3.2 Postgres migration |
| Uploads > 5-10 GB on Fly volume | §3.3 Object storage |
| Strangers signing up (not hand-invited) | §3.4 Moderation pack |
| Submitting to App Store / Play Store | §3.5 App Store pack |
| Any paying transaction (Phase 2) | §3.6 Legal pack |

## 3.2 Postgres migration (trigger: DB > 500 MB)
- Rewrite `database.py` to use `psycopg` + connection pool.
- Port `services/admin_stats.py` off SQLite-specific funcs:
  - `strftime('%Y-%m-%d', ...)` → `to_char(..., 'YYYY-MM-DD')`
  - `julianday(...)` → `extract(epoch from ...)`
  - `date('now', '-89 days')` → `now() - interval '89 days'`
- Add Alembic; capture current schema as migration `0001`.
- Neon free 0.5 GB, or `fly postgres create` (~$2-7/mo small).
- One-shot data migration script: read SQLite, write Postgres,
  verify row counts.
- Budget: ~1 focused day.

## 3.3 Object storage (trigger: uploads > 5-10 GB)
- `resolveUploadUrl()` in `src/api/client.ts` is the single swap
  point.
- Backend: `routes/uploads.py` writes to Tigris (on Fly) or R2
  (Cloudflare, free 10 GB + zero egress).
- Front R2/Tigris with Cloudflare CDN for edge caching — neutralizes
  Class B op costs at scale.
- Migrate script: iterate `/data/uploads`, upload each to storage,
  update DB paths.

## 3.4 Moderation + legal-docs pack (trigger: opening to strangers / iOS launch)

Originally a 5-bullet sketch; expanded 2026-05-01 after a code-state
audit. The two workstreams are bundled because they share legal
exposure ("the platform hosts content from users we don't know
personally") — moderation tooling is what makes the policies
enforceable, the policies are what give the moderation tooling
teeth. **Don't start without confirming the trigger has fired** —
this section sits behind the dual gate of (a) iOS submission
window approaching and (b) opening signups to strangers (vs F&F
hand-invites).

### Code-state audit (truth as of 2026-05-01)

What's already there:
- The PostCard three-dots menu already POSTs to `/post_reports`,
  `/post_hides/{id}/toggle`, `/post_dislikes/{id}/toggle`
  (`crema-app/src/utils/postMenuActions.ts:22-47`). The frontend
  swallows network errors silently, which is why these *feel*
  wired — they're 404ing, not no-oping.
- The matching tables already exist (`database.py:600-633`):
  `post_hides`, `post_dislikes`, `post_reports`. Schemas are
  fine for v1; reports are intentionally non-unique per
  (user, post) so admin can count pile-ons.
- `_require_admin` gate (`routes/specific.py:23-29`) checks
  `is_admin=1 AND username="crema"` — defense-in-depth pattern
  to reuse for the admin moderation panel.
- Migration pattern: `_MIGRATIONS` list in `database.py:129+`
  with `PRAGMA user_version` gate. Idempotent.

What's missing: zero routes wired to those tables, no
`user_blocks`, no audit log, no admin queue UI, no legal docs at
all (no `legal/` directory).

### 3.4.1 Wire what exists `[ ]` (~1.5h)
- Add `POST /post_reports`, `POST /post_hides/{post_id}/toggle`,
  `POST /post_dislikes/{post_id}/toggle` to `routes/specific.py`
  (matches prevailing pattern; or factor a `routes/moderation.py`
  if scope grows).
- Reports carry an optional `reason` (one of the chip values) and
  free-text `note` (≤280 chars). Hide / dislike are idempotent
  toggles; reports record a new row each tap so the admin queue
  can count pile-ons.
- Frontend: replace the bare `Alert.alert("Report this post?")`
  in `confirmAndReport` with a reason-chip modal. Default chips:
  `Spam · Off-topic · Hateful · Sexual content · Impersonation
  · Other` + optional 280-char free text. Confirmation toast:
  "Thanks — we'll review this within 48h." (don't promise faster
  than the team can deliver).

### 3.4.2 Block-user `[ ]` (~1.5h)
- New table:
  ```sql
  user_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(blocker_user_id, blocked_user_id)
  )
  ```
- Endpoints: `POST /users/{username}/block`,
  `DELETE /users/{username}/block`,
  `GET /my-blocks` (consumer-facing list to unblock from settings).
- Reader-side filtering: `feed_timeline`, comments, search, DMs
  all `LEFT JOIN user_blocks` and exclude rows where the requester
  has blocked the author. Follower / followee tables don't get
  scrubbed — a blocked user just becomes invisible to the blocker.
- Surface: profile menu + three-dots menu on PostCard.

### 3.4.3 Admin Reports queue `[ ]` (~2h)
- New panel under the admin profile, sibling to
  `StandardizationPanel` and `RoastersPanel` in
  `crema-app/src/components/admin/`. Mirror the jobs-poll pattern
  rewired in `RoastersPanel` (commit `e3d3eb8`).
- Backend: `GET /admin/reports?status=open&limit=50` returns posts
  ordered by report count, each with the underlying report rows
  expandable per post.
- Action buttons per post: `Dismiss` · `Hide-from-feed`
  (soft-hide globally — visible only to author) · `Delete`
  (via existing soft-delete path so it's recoverable from recycle
  bin) · `Suspend-author` (24h post-write block) ·
  `Ban-author` (full hard-block; flips `users.is_banned`).
- New columns added via `_MIGRATIONS`:
  ```sql
  ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN suspended_until TEXT;  -- ISO datetime or NULL
  ```
- Post-create / comment-create endpoints check both fields and
  return 403 with a `reason` payload.

### 3.4.4 Audit log `[ ]` (~30m)
- New table:
  ```sql
  moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,    -- 'post' | 'comment' | 'user'
    target_id INTEGER NOT NULL,
    action TEXT NOT NULL,         -- 'dismiss'|'hide'|'delete'|'suspend'|'ban'|'unban'
    actor_user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TEXT NOT NULL
  )
  ```
- Every admin button writes one row.

### 3.4.5 Auth rate-limiting `[ ]` (~30m)
- `slowapi` to `requirements.txt`; cap `/auth/register`,
  `/auth/login`, `/auth/request-reset` at ~5/IP/5min.

### 3.4.6 Email verification `[ ]` (~1h, needs provider)
- Pick provider: Resend (free 100/day, 3000/mo) or Mailgun
  pay-as-you-go.
- New `users.email_verified INTEGER NOT NULL DEFAULT 0` column +
  `email_verification_tokens` table (`token, user_id, expires_at`).
- `POST /auth/send-verification`, `GET /auth/verify?token=...`.
- Gate post-creation + commenting on `email_verified=1` once we
  open to strangers; F&F path keeps `email_verified=1` seeded.

### 3.4.7 Legal docs — Privacy / ToS / Community Guidelines / AUP `[ ]` (~3-4h)

Output: `legal/PRIVACY.md`, `legal/TERMS.md`,
`legal/COMMUNITY_GUIDELINES.md`, `legal/ACCEPTABLE_USE.md` at repo
root. Same markdown source ships to:
- The legal site (web only — `cremabrews.com/legal/*` rendered
  via Expo Router static export).
- The in-app readers (`react-native-markdown-display` added to
  `package.json`).

In-app surfaces:
- Sign-up flow: "I agree to Terms + Privacy Policy" checkbox blocks
  submit until checked. Inline links to in-app readers.
- Account screen: 4 entries linking to each doc.
- Footer of every web page: same 4 links + © Crema + year.

Drafting approach (decision pending):
- **Option A — handwritten markdown** (~3h). Every assumption marked
  `> [ASSUMPTION: ...]` so the user can grep before lawyer review.
  Tighter, more on-tone with the rest of the app.
- **Option B — Termly stubs** (faster, more boilerplate). What §3.5
  endorses today. Cheaper to maintain when the laws move; more
  generic in voice.

Standing legal questions to resolve before drafting:
1. **Entity name + registered address** — for first paragraph of
   Privacy / ToS. Default if not provided: mark
   `[ASSUMPTION: sole proprietorship / Swaraj Nanda]` and let counsel
   correct on review.
2. **Jurisdiction city** — venue clause. Defaults to the user's
   city of operation; needs confirmation.
3. **Lawyer status** — drafts ship with `REVIEWED BY: pending
   counsel review` regardless. Confirms the marker is intentional.
4. **Email mailboxes** — `privacy@cremabrews.com`,
   `grievance@cremabrews.com`. India uses IT Rules 2021, not DMCA;
   the docs draft as "Grievance Officer" workflow with 24h ack
   / 15-day resolution.
5. **Children's age** — 13+ (US-style) or 18+ (DPDP "child" =
   under 18). DPDP makes 18+ the safer default.
6. **Data residency** — India-only is the default (Fly bom region
   per §1.3). Confirms no third-party processors that move data
   abroad without explicit consent.

India-specific anchors the drafts must hit:
- **IT Rules 2021** require a published Grievance Officer (name +
  email) with 24-hour acknowledgement and 15-day resolution
  windows. Replaces DMCA-style takedown.
- **DPDP Act 2023** requires explicit consent at sign-up, granular
  per data-use category. Phase 1 can bundle as a single toggle
  but flag the granular ask for Phase 2.
- Both require a published privacy contact and grievance
  redressal flow.

### 3.4.8 Hardening (DEFER post-launch unless real abuse signal)
- **Slur list** — static blocklist (Indian + English; user input
  needed on which lists to use). Pre-publish check on every post
  body / comment; matched submissions return 422 with "This post
  contains language not allowed on Crema." Most "AI moderation in
  5 min" libs are western-trained and miss Indian-language
  failure modes — slur lists remain the highest-leverage first cut.
- **Link rate-limit** — non-roaster accounts capped at 1 link
  per post and 3 link-bearing posts / 24h. Combats the dominant
  spammer pattern.
- **NSFW image check** — flag for admin review (don't auto-block).
  Candidate classifiers: Sightengine free tier (~1k/mo), or a
  small CoreML / TF-Lite model on-device. Decision pending user
  input on cost / latency tradeoff.

### Total estimate
- Phases 3.4.1 → 3.4.5: ~5-6h focused work.
- Phase 3.4.6 (email verification): +1h once provider chosen.
- Phase 3.4.7 (legal docs): +3-4h pending the 6 standing
  questions above.
- Phase 3.4.8 (hardening): defer until real abuse signal — likely
  weeks after public launch.

**Suggested order**: 3.4.1 → 3.4.4 → 3.4.3 → 3.4.2 → 3.4.5 →
3.4.7 → 3.4.6. Wire-existing first because it's cheap and
unblocks user testing of the report flow; audit log second
because every later admin action depends on it; queue UI third
to give the admin reviewer a real surface; block-user fourth
since it's the consumer-side companion to reporting; rate
limiting fifth as a one-shot library install; legal docs sixth
once moderation has teeth; email verification last because the
provider decision can take time and signups are gated on F&F
domain whitelist until §3.4.6 lands.

## 3.5 App Store pack (trigger: App Store submission) — **UNPARKED**

The §3.1 trigger for this section fired when the decision was made
that iOS ships **before** public launch, not after. All items below
are now pre-launch blockers, not post-launch polish. Pair with the
design / native-interaction work tracked in
[BUILD_ROADMAP.md "Mobile (iOS / Android) readiness" block
(§2.31-2.39)](BUILD_ROADMAP.md) — that block covers the product
side; this bucket covers the submission / legal / auth side.

Dev-loop note: the build-out phase runs against Expo Go (physical
device, QR scan, live reload — no signed binary needed). EAS builds
are only required at the end of this bucket, once everything below
is ready and the first TestFlight invite goes out.

- Password reset flow (`POST /auth/request-reset`,
  `POST /auth/reset-password`, 30-min token TTL).
- Account deletion (`DELETE /auth/me` with password re-entry).
  Apple requires this as of 2022.
- Data export (`GET /auth/me/export` — DPDP / GDPR hygiene).
- Privacy Policy + ToS pages (stubs via Termly, then legal review).
  → See §3.4.7 for the full legal-docs plan (4 documents, in-app
  reader, sign-up consent, India-specific anchors).
- App Store privacy nutrition label.
- Apple Developer Program ($99/yr), Google Play Console ($25
  one-off), Expo EAS for builds.
- Contact us / feedback widget.
- Accessibility pass (aria-labels, focus rings, alt text — pairs
  with BUILD_ROADMAP §2.37 hit-slop / accessibilityLabel sweep).

## 3.6 Legal pack (trigger: real money moves through Crema)
- Real Privacy Policy + ToS (lawyer review, ~$200-500 one-off).
- DMCA takedown mailbox policy (free via Cloudflare Email Routing).
- Age gate (13+ at signup).
- Payment provider compliance (KYC etc.) — Phase 2 concern.

## 3.7 Reliability pack (trigger: "site is down" from a user)
- Sentry for backend + frontend error tracking (free 5k events/mo).
- Uptime monitoring (Better Stack / Cronitor free tiers).
- Daily automated Postgres dumps to R2/B2 offsite.

## 3.8 Catalog-ops jobs in prod (trigger: Fly.io deploy with admin tabs shipped)

**Context.** The admin profile carries two tabs (built locally on the M1
first):

- **Scraper tab** — list of roaster URLs, button to run the scrape, button to
  add a new URL. Wraps the existing `Scraper/` Python module.
- **Taste Graph tab** — count of unclassified flavor-note tags, button to run
  Haiku classification on only the new ones, upload-new-tree (SCA JSON) with
  validation diff. Wraps `tag_resolver_test.py` etc.

In v0 these run synchronously on the M1: admin presses button → FastAPI
spawns a background task in the same process → writes results to the local
SQLite. That's fine for one admin user on one machine.

The moment we cross into Fly.io (per §3.1 / §3.2 triggers), the same code
path has new failure modes that this task addresses:

- **Resource starvation.** A 5-30 min scrape on `shared-cpu-1x` starves
  every other request. Need a separate worker process — arq / dramatiq /
  rq, on the same container, with the API still answering on the main
  process.
- **Restart safety.** Fly machines restart on deploy / OOM. Job state in
  process memory disappears. Need a `jobs` table: `id, kind, status,
  started_at, finished_at, log_tail, started_by_user_id`. Worker reads
  from queue, writes status back. Admin tab polls the table.
- **Log persistence.** `print()` to stdout works locally; on Fly,
  `fly logs` rotates and the admin can't view past runs from the app.
  Pipe stdout into the `log_tail` column (or a `/data/job-logs/` file)
  so the admin tab can render it.
- **API-key handling.** `ANTHROPIC_API_KEY` moves from local shell env
  to `fly secrets set ANTHROPIC_API_KEY=...`. Same code, different
  injection point.
- **Concurrency guard.** Only one scrape / one classification at a time.
  DB-level lock on the `jobs` table (status='running' row blocks new
  enqueues for that kind).
- **Cron cadence.** Decide whether scrapes stay manual-only, or auto-fire
  weekly via Fly's scheduled machines. If auto, the admin tab still shows
  the last cron run with override controls.

**When this trigger fires:** rewrite the v0 sync background-task path into
a queue-backed worker, add the `jobs` table + endpoints, move secrets, add
log capture. Estimated 1-2 days. Do not pre-build any of this for v0 —
it's wasted complexity until we actually have a server to run on.

## 3.9 Nice-to-haves (no trigger; pick up during slow weeks)
- Dark mode scaffold (non-trivial; every `t.color` call needs
  re-audit).
- i18n scaffolding (English + Hindi) via `t("key")`.
- Onboarding nudges (empty-state CTAs on Profile posts / Shelf /
  Following).
- Push notifications via Expo Push.
- Full-text search on products + posts + cafés.
- Feed ranking beyond chronological.
- Stamp-card UI polish (coffee-beans-as-stamps).

---

# Cost snapshot at F&F scale

| Line item | Monthly | One-off |
|-----------|---------|---------|
| `cremabrews.com` | — | $10/yr (~$0.85/mo amortized) |
| Fly shared-cpu-1x 24/7 | ~$1.94 | — |
| Fly 1 GB volume | $0.15 | — |
| Fly volume snapshots | ~$0.05 | — |
| Cloudflare DNS + CDN + Email Routing | $0 | — |
| **Effective total** | **$0** (under $5 Hobby credit) | **$10/yr** |

First monthly bill outside the Hobby credit arrives when we cross
into §3.2 or §3.3. At that point we're also outgrowing the F&F
assumption — come back here and revise the file.

---

*When a build item lands, move it into `BUILD_ROADMAP.md` §1.x with
the commit hash. This file stays focused on getting Crema online
for 10-30 users, nothing more.*
