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

### 1.2 Env lockdown `[ ]`
Three env vars, nothing more. All default to current localhost
behavior so dev stays unchanged:
- `CORS_ORIGINS` — comma-separated list. Prod:
  `https://cremabrews.com`. Dev fallback: `*`.
- `DB_PATH` — path to the SQLite file. Prod:
  `/data/coffee_community.db` (mounted volume). Dev fallback:
  `./coffee_community.db` (cwd).
- `UPLOADS_DIR` — upload write path. Prod: `/data/uploads`. Dev
  fallback: `./uploads`.

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
  UPLOADS_DIR="/data/uploads"
```

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

## 3.4 Moderation pack (trigger: open signups)
- `reports` table + `POST /api/posts/{id}/report`.
- "Report" in PostCard overflow menu.
- Admin moderation sub-tab on the traction dashboard.
- Rate limiting on `/auth/register`, `/auth/login`,
  `/auth/request-reset` (~5/IP/5min).
- Email verification (needs email provider — Resend free 100/day).

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

## 3.8 Nice-to-haves (no trigger; pick up during slow weeks)
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
