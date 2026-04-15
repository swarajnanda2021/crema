# LAUNCH_TODO — to-do admin

This is a controlled backlog for everything between "works on my laptop"
and "shipped to the App Store." Two sections:

- **Part 1 — Dev todos.** Code I can build right now. No accounts, no
  credit card, no external dependencies. These can move while you
  figure out the money side.
- **Part 2 — Company / infra todos.** Needs accounts, subscriptions, or
  a decision from you. I can't complete these alone.

## How this file works

Every item requires your explicit green light before I start. Format:

```
- [ ] Item title
  Short description of scope, files touched, caveats.
  ASK: should I pursue this now?
```

Status key:
- `[ ]` — not started
- `[~]` — in progress
- `[x]` — done (with commit hash or note)
- `[!]` — blocked (reason after the line)

I won't silently start on anything here. When you want to pursue an
item, say "do item 1.2" or similar and I'll flip it to `[~]` and begin.

---

# Part 1 — Dev todos (buildable now, no money)

## 1. Launch-blocking

These are the things Apple / Google will reject the app for, or that
real users will hit and complain about within the first hour.

### 1.1 Password reset flow
Backend: `POST /auth/request-reset` (generates a token, logs or emails
it), `POST /auth/reset-password` (consumes the token, sets new
password). Frontend: a "Forgot password" link on the auth screen + a
reset form. Token TTL 30 min, same pattern as the QR token table.
Works without a real email provider — just logs the link to the
console during dev.
ASK: pursue now?

### 1.2 Rate limiting on auth endpoints
Only `/cafes/{slug}/stamp` has it right now. Add a simple in-memory or
DB-backed limiter to `/auth/register`, `/auth/login`, and
`/auth/request-reset` (~5 attempts per IP per 5 min). Cheap insurance
against bot signups and brute-force login attempts.
ASK: pursue now?

### 1.3 Report post button + moderation schema
Every social app needs an abuse-reporting loop before it can launch.
Minimal scope:
- `reports` table (id, reporter_user_id, post_id, reason, status,
  created_at)
- `POST /api/posts/{id}/report` endpoint
- A "Report" item in PostCard's overflow menu
- A moderation tab on the Crema admin profile (list of pending
  reports, approve/dismiss)
ASK: pursue now?

### 1.4 Account deletion flow
Apple explicitly requires in-app account deletion as of 2022. Without
it, the app is rejected. Backend: `DELETE /auth/me` that purges user
rows + their content + cascades. Frontend: a "Delete account" item in
ProfileDropdown with a confirmation modal + password re-entry.
ASK: pursue now?

### 1.5 Privacy Policy + Terms of Service pages (stubs)
Stub pages at `/legal/privacy` and `/legal/terms`, linked from the
footer and the auth screen. Generators (Termly, GetTerms) give you a
serviceable first draft. These are required at registration.
Replacing the stubs with legally-reviewed versions is a Part 2 item
(costs money).
ASK: pursue now? (stubs, not legal review)

### 1.6 Contact Us / feedback widget
A single floating button in the navbar (or in the profile dropdown)
that opens a modal with a textarea + email field. Posts to a new
`feedback` table. Even during pilot this is the main way users will
reach you — don't rely on Instagram DMs.
ASK: pursue now?

### 1.7 Env-based config lockdown
Right now the backend hardcodes:
- `CORS allow_origins=["*"]` — must be an env list before prod
- `DB_PATH` from `os.path.dirname` — must be `DATABASE_URL`
- Upload path literal — must be `UPLOADS_DIR` env

Frontend hardcodes:
- `http://<hostname>:8000/api` in `getBaseUrl()` — already respects
  `EXPO_PUBLIC_API_URL`, but the fallback runs on localhost, which
  breaks the phone-on-LAN case (see iOS section).

ASK: pursue now?

### 1.8 Error boundary + 404 route
Expo Router's `ErrorBoundary` is exported but not explicitly wired to
user-friendly copy. A proper 404 page and a generic "Something went
wrong" fallback are both quick and both visible during pilot.
ASK: pursue now?

## 2. Nice-to-have pre-pilot

These raise the ceiling on the pilot experience without being
launch-blocking.

### 2.1 Email verification
After registration, send a verification email with a token.
Unverified accounts can browse but not post. Reduces fake accounts
10×. Needs email provider (Part 2), but the code can be written
against a local stub.
ASK: pursue now? (stub; live when email provider is set up)

### 2.2 Data export
`GET /auth/me/export` returns a zip of the user's data (profile,
posts, tasting notes, shelf, stamps). DPDP Act / GDPR hygiene. Good
to have for the first user who asks. ~1 endpoint, 100 lines.
ASK: pursue now?

### 2.3 Admin moderation dashboard
Extends the existing "Site Analytics" admin tabs with a "Moderation"
sub-tab: list of reports, list of flagged users, one-click
approve/dismiss. Depends on 1.3 landing first.
ASK: pursue now? (after 1.3)

### 2.4 Onboarding nudges
Currently a new user lands on a mostly-empty profile. Add empty-state
hooks:
- Profile posts: "Share your first coffee moment"
- Shelf: "Pick a bean from the Discover page"
- Following: "Follow a roaster to see their updates"
Each is one Pressable with a copy-and-a-chevron to the relevant
surface.
ASK: pursue now?

### 2.5 Accessibility pass
aria-labels / accessibilityLabel on icon-only buttons (we've been
good about this but there are gaps). Focus rings on web. Alt text on
uploaded images.
ASK: pursue now?

### 2.6 Dark mode scaffold
`design-tokens.json` gains a `dark` variant layer; `useTokens`
switches on `prefers-color-scheme`. Non-trivial — every component
using `t.color` needs re-auditing. Skip for pilot unless you care.
ASK: pursue now? (recommend no for pilot)

### 2.7 i18n scaffolding (English + Hindi)
Wrap user-facing strings in a `t("key")` helper backed by
`locales/en.json` + `locales/hi.json`. Even if Hindi copy is empty
for now, the scaffolding is much cheaper to add before 100 strings
are hardcoded.
ASK: pursue now?

## 3. Post-pilot iteration

Things to build once there's real user feedback.

- [ ] 3.1 Full-text search on products + posts + cafés
- [ ] 3.2 Feed ranking (beyond chronological)
- [ ] 3.3 Push notifications via Expo Push
- [ ] 3.4 Invite codes / referral credit
- [ ] 3.5 Stamp-card UI visual polish (coffee-beans-as-stamps)
- [ ] 3.6 More locales

---

# Part 2 — Company / infra todos (money or external)

## 4. Accounts to create

Each of these is an external signup. I can prepare the code for each
but can't complete the setup without you entering credentials.

### 4.1 Supabase
Database + storage. Free tier covers pilot (500 MB DB, 1 GB storage).
Needed for: postgres migration (5.1), object storage (5.2).
Cost: $0 pilot → $25/mo at ~1k users.
ASK: create account + project when ready?

### 4.2 Railway (or Fly.io / Render)
Hosts the FastAPI backend. Railway has the best GitHub-deploy UX.
Cost: $5/mo credit free tier → $20/mo Hobby.
ASK: which host do you want? Railway / Fly / Render / other?

### 4.3 Cloudflare Pages
Hosts the Expo web export. Already have the registrar in your
Cloudflare account — Pages is the same login.
Cost: free.
ASK: go ahead when we're ready to deploy web?

### 4.4 Resend (transactional email)
For password reset, email verification, moderation notifications.
Free tier: 100 emails/day.
Alternative: Postmark, AWS SES.
ASK: approve Resend?

### 4.5 Sentry
Error tracking for both backend and Expo app. Priceless during pilot
— you'll know about crashes before users report them.
Cost: free tier (5k events/mo).
ASK: approve Sentry?

### 4.6 Apple Developer Program
Required for TestFlight + App Store. Pays for itself many times over
in dev experience.
Cost: $99 / year (one account per organization).
ASK: sign up now or when closer to pilot?

### 4.7 Google Play Console
For the Android side. One-time fee, no renewal.
Cost: $25 once.
ASK: sign up alongside Apple, or later?

### 4.8 Expo EAS
Expo's cloud build service. Same Expo account you already have
implicitly. Free tier allows limited builds per month.
Cost: $0 for pilot frequency; $99/mo if you hit rate limits.
ASK: approve EAS for iOS builds?

## 5. Migration work (your time, not $)

### 5.1 SQLite → Postgres
Biggest single task. Involves:
- `database.py` rewrites for asyncpg
- `services/admin_stats.py` — SQLite-specific functions
  (`strftime`, `julianday`, `date('now', '-89 days')`) swapped for
  Postgres equivalents (`date_trunc`, `to_char`, `now() - interval`)
- Alembic setup + initial migration captured from the current
  schema
- Local dev loop: docker-compose with a Postgres service, or a
  personal Supabase project
Estimate: 1-2 focused days.
ASK: when to start? (realistically, right before 4.1 / 4.2 setup)

### 5.2 Local uploads → Supabase Storage (or R2)
Every `/uploads/...` URL in the codebase gets replaced by a signed /
public Storage URL. `resolveUploadUrl()` in `src/api/client.ts`
becomes the single swap point. Existing photos need a one-off migrate
script.
ASK: when to start? (after 5.1)

### 5.3 Image → webp conversion pipeline
Pillow already in requirements. Add a conversion step on upload:
original → webp (quality 85) → stored. Roughly 15 lines in the
uploads route. Video (webm) waits for when you actually add video.
ASK: pursue alongside 5.2?

### 5.4 Secrets sweep
Make sure there's no hardcoded UUID or seeded password committed to
the repo that would become a security issue in production. Rotate
anything obvious. Add `.env.example` and document what each key is.
ASK: pursue before 4.1?

## 6. Legal / compliance

### 6.1 Real Privacy Policy (legal review)
Replace the 1.5 stub. In India you want DPDP Act coverage. Typical
path: a generator like Termly ($10/mo) + a lawyer consult ($200-500
one-off) before App Store submission.
Cost: $200-500 one-off.
ASK: approve when we approach pilot?

### 6.2 Real Terms of Service
Same pattern. Covers liability, user-generated content ownership,
moderation policy, termination rights.
Cost: $200-500 one-off (can bundle with Privacy Policy).
ASK: approve when we approach pilot?

### 6.3 App Store privacy nutrition label
Requires you to declare what data you collect. 15-minute form in App
Store Connect, but you need to know what you actually collect —
worth doing the audit before submission.
ASK: I can prepare a draft when you have the Apple account.

### 6.4 Age gate
If you allow < 13 (or < 16 in some regions), COPPA / GDPR-K rules
apply. Simplest path: require 13+ at signup, say so in TOS.
ASK: approve "13+" at signup?

### 6.5 Copyright / DMCA policy
Cafés and roasters will upload product photos. You need a takedown
path for infringement claims.
ASK: approve a simple abuse@cremabrews.com mailbox policy?

## 7. Launch phases

Each phase has its own approval. These are sequential — don't approve
"full launch" while phase 1 is still a fresh fire.

### 7.1 Internal alpha (5-10 people)
Just you + close friends. TestFlight internal testers (no review
needed). Backend on Railway. Main purpose: catch showstopper bugs in
real use.
Duration: 1-2 weeks.
ASK: approve when 4.1 / 4.2 / 5.1 / 5.2 are done.

### 7.2 Closed beta (~100 people)
TestFlight public link. Real feedback loop. Admin dashboard becomes
your North Star metric — DAU, WAU, retention cohorts.
Duration: 4-8 weeks.
ASK: approve after 7.1 is stable.

### 7.3 Soft launch (India-only, App Store)
Public listing, India region only. Marketing push to one city
(Goa / Bangalore). Partner with 2-3 cafés for in-store signage.
Duration: 4-6 weeks.
ASK: approve after 7.2 shows ≥ 20% D7 retention.

### 7.4 Full launch
All regions. Assumes 7.3 went well enough that scaling costs are
justified.
ASK: approve when numbers are there.

## 8. Cost snapshot

For reference, not a todo:

| Stage                | Monthly | One-off |
|----------------------|---------|---------|
| Pilot (100-500 MAU)  | $10-15  | $99/yr  |
| Scaling (~1k MAU)    | $60-80  | $99/yr  |
| Growth (~10k MAU)    | $200-300| $99/yr  |

The $99 is Apple. Google Play Console is a one-time $25. Domain
(`cremabrews.com`) is ~$10/year through Cloudflare.

---

*This file is canonical. When in doubt about what's next, consult here.
When a request comes up that belongs in Part 1 or Part 2, add it here
first rather than acting on it.*
