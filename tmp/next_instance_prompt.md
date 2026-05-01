# Prompt for next Claude instance — content moderation + legal de-risking

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. Branch: `feat/mobile-readiness`
> (still — we may cut a sub-branch off it if the moderation/legal work
> ends up spanning more than a single PR).
> Don't open with a recap; pick up the task directly.

---

## TL;DR

Two adjacent workstreams for this session:

1. **Content moderation** — the social feed has zero moderation
   surface today. Posts go up unfiltered, comments aren't reviewed,
   reports go nowhere. Before we open Crema to a wider audience we
   need: (a) a reporting / blocking flow that already feels real to
   the user, (b) admin queue for reviewing reports, (c) automated
   filtering for the obvious failure modes (slurs, spam links, NSFW
   image upload).
2. **Legal de-risking** — Phase 1 doesn't move money, but it does
   host UGC, store user data, and link out to roaster e-commerce.
   The minimum we need to ship to a public audience:
   Privacy Policy, Terms of Service, Community Guidelines, an
   Acceptable Use Policy, plus the surfaces that reference them
   (sign-up consent, footer links, account-deletion flow).

These two are bundled because they share the same legal exposure:
"the platform hosts content from users we don't know personally."
The moderation tooling is what makes the policies enforceable, and
the policies are what give the moderation tooling teeth.

This is a substantial session — plan for 6-10 hours. Both
workstreams have a "ship the minimum so we can launch" interpretation
and a "build it properly" interpretation. Default to ship-minimum
unless the user asks otherwise.

---

## Hard rules — read first

1. **Do not start dev servers from Bash or `preview_start`.** The user
   runs their own Metro on device. The PostToolUse hook will nag about
   preview servers — ignore it explicitly with a one-line acknowledgement
   and continue.
2. **Palette discipline is dual-track** (recently re-asserted by the
   user, see `CLAUDE.md` "Hard rule" section). Brand identity is 3
   colors (Espresso `#351101` / Crema `#D798DA` / Crema White `#FAF8F0`).
   Light mode keeps the established functional neutrals; dark mode is
   strict — only rgba opacity variants of brand colors. Don't invent
   browns. **Re-read `DESIGN_LANGUAGE.md` §1 before touching any color
   token.**
3. **Phase-1 wireframe fidelity** (per `NORTH_STAR.md`). No animations
   beyond what's already shipped. No gold accents, alert reds, success
   greens. Moderation surfaces still need to feel native to the app.
4. **No legal advice.** Anything that materially affects how Crema
   handles user data, IP claims, or India-specific regulation
   (especially the 2021 IT Rules for "social media intermediaries"
   and the DPDP Act) needs the user to either a) have already
   consulted a lawyer, or b) explicitly accept that the draft is a
   placeholder pending review. Don't invent jurisdictional claims.
   **Surface every assumption back to the user before drafting.**

---

## Workstream 1 — Content moderation

### Where the social feed lives

- Posts: `Community/coffee-community-api/routes/posts.py` (or wherever
  the post CRUD landed — verify before assuming).
- PostCard render: `crema-app/src/components/domain/PostCard.tsx`.
- Composer: `crema-app/src/components/ComposePost.tsx`.
- Comment thread: `crema-app/src/components/primitives/CommentThread.tsx`.
- Existing post-menu actions (hide/report/dislike) live in
  `crema-app/src/utils/postMenuActions.ts` — already wired to
  three-dots menus on PostCard.

### What's already shipped (don't redo)

- The three-dots menu on every PostCard surfaces Hide / Report /
  Dislike (`postMenuActions.ts` + `PostMenu.tsx`).
- Recycle bin (`RecycleBinModal.tsx`) — soft-delete + restore for the
  user's own content.
- A `posts_hidden` table (or equivalent — verify) records the user's
  per-user hide list so hidden posts don't reappear in their feed.

### What's missing (the actual work)

Moderation has three actors that need surfaces:

#### A. The reporting user (consumer-facing)

- The current "Report" menu item probably no-ops or shows a toast.
  Wire it to a real backend endpoint that records `(post_id,
  reporter_user_id, reason, free_text, created_at)`.
- A small modal between tap-Report and submit: 4–6 reason chips
  (Spam, Off-topic, Hateful, Sexual content, Impersonation, Other)
  + an optional 280-char free text. Mirror Instagram / Twitter's
  reporting flow at the wireframe level.
- Confirmation toast: "Thanks — we'll review this within 48h." Don't
  promise faster than the team can deliver.
- "Block @user" surface: lives on the user profile + on the
  three-dots menu. Backend records a `user_blocks` row; reader-side
  hide logic respects it across feed, comments, search, DMs.

#### B. The admin reviewer

- A new admin tab `Reports` parallel to the existing `Catalog Ops` /
  `Standardize` / `Traction` tabs in the admin profile.
- Queue UI: each row is `report_count`, `post_preview`, `reasons`,
  `most_recent_report_time`, with row tap → full post + comment
  thread + every report.
- Action buttons per post: Dismiss (clears all reports), Hide-from-
  feed (soft-hide globally — visible only to author), Delete
  (hard-delete via existing soft-delete path so it's recoverable from
  recycle bin), Suspend-author (24h post-write block), Ban-author
  (full hard-block; flips `users.is_banned`).
- Audit log: every admin action records who did it, when, and why.
  The user's previous `audit_log` table (if it exists — verify) is
  the right home.

#### C. The automated filter

The cheapest first cut:

- **Slur list** — a static blocklist (Indian + English; user has
  opinions about which lists to use, ask). Pre-publish check on
  every post body / comment; if matched, block submission with
  "This post contains language that's not allowed on Crema. See
  Community Guidelines."
- **Link rate-limit** — non-roaster accounts capped at e.g. 1 link
  per post and 3 link-bearing posts per 24h. Combats the most
  obvious spammer pattern.
- **NSFW image check** — Phase 1 ship: flag for admin review (don't
  auto-block) using a free hosted classifier (Sightengine free tier,
  or run a small on-device CoreML / TF-Lite model — ask user about
  the cost / latency tradeoff).

#### Backend additions

New tables — verify column names against
`Community/coffee-community-api/database.py` conventions before
writing migrations:

```sql
post_reports       (id, post_id, reporter_user_id, reason, free_text, created_at, resolved_at, resolved_by, resolution)
user_blocks        (id, blocker_user_id, blocked_user_id, created_at)
moderation_actions (id, target_type, target_id, action, actor_user_id, reason, created_at)
users.is_banned    (existing or new column)
users.suspended_until (existing or new column)
```

Migrations should be gated on `PRAGMA user_version` per the existing
pattern (see `Community/coffee-community-api/database.py` for the
convention — migrations 1..N, idempotent).

### Suggested order of attack

1. Backend tables + endpoints first (`post_reports`, `user_blocks`,
   the moderation_actions audit log, the admin queue endpoint).
2. Wire the consumer-side Report flow (modal + endpoint).
3. Wire Block (profile menu + reader-side filtering across feed /
   comments / DMs / search).
4. Build the admin Reports queue UI as a sibling tab in admin
   profile.
5. Slur list filter (cheapest, biggest legal-cover-up).
6. Link rate-limit.
7. NSFW image flagging — last, since it has external-API decisions
   the user needs to weigh in on.

---

## Workstream 2 — Legal de-risking

### Where the legal docs go

There's no `legal/` directory yet — propose adding one at repo root
with markdown sources (`legal/PRIVACY.md`, `legal/TERMS.md`,
`legal/COMMUNITY_GUIDELINES.md`, `legal/ACCEPTABLE_USE.md`). The
in-app screens render these via `react-native-markdown-display` (add
the dep) so a single source of truth ships to both the legal site
and the app.

### Required documents

Each draft is a placeholder pending the user's lawyer review. Mark
every assumption explicitly with a `> [ASSUMPTION: ...]` blockquote
so the user can grep the doc for things to confirm with counsel.

#### A. Privacy Policy

Must cover, at minimum:
- What we collect: account info (name, email, optional phone),
  profile info (avatar, bio, location), behavioural (posts, likes,
  follows, Buy clicks), device info (push tokens, app version).
- Why: serve the feed, surface relevant roasters, send notifications,
  prevent abuse.
- Legal basis (under DPDP Act): consent at sign-up (note the
  granular consent UX — Phase-1-acceptable to bundle as a single
  toggle, but flag the granular-consent ask for Phase 2).
- Data sharing: roasters see aggregate analytics on followers + Buy
  clicks; the platform shares no PII with third parties beyond what
  the user posts publicly.
- Retention: account deletion within 30 days; soft-delete for posts
  via existing recycle bin pattern.
- User rights: access, correction, deletion. Concrete in-app surfaces
  for each.
- Contact: a real `privacy@crema.<domain>` mailbox (USER NEEDS to
  confirm the address).
- Children: 13+ minimum (or 16+ if the user wants stricter under
  DPDP — needs decision).

#### B. Terms of Service

Standard structure:
- Eligibility, account responsibility, prohibited uses (links into
  Acceptable Use Policy below).
- Content ownership: user owns their content; platform gets a
  worldwide, non-exclusive, royalty-free license to display +
  distribute it within Crema (standard UGC license language).
- Roaster-specific terms: roasters own their product info, brand
  marks; platform gets the right to display them.
- DMCA-equivalent / IP takedown: real takedown email + a 14-day
  counter-notice window (India uses IT Rules 2021, not DMCA — drafts
  should reflect that).
- Termination: platform reserves the right to suspend / ban for
  violations; user can delete account at any time.
- Liability disclaimers (very standard "as is" language).
- Governing law: Indian jurisdiction (USER CONFIRM city for venue).

#### C. Community Guidelines

The plain-English version of the moderation policy. Key categories:
- No hate speech (covers caste, religion, region, gender, sexuality —
  India-specific carveouts the user should weigh in on).
- No harassment of other users or roasters.
- No spam (link rate-limit logic from Workstream 1 is the
  enforcement).
- No off-topic content (this app is about coffee — non-coffee
  content can be removed).
- No deceptive impersonation (claiming to be a roaster you're not,
  etc.).
- No sexual content (Phase 1 strict; Phase N might soften).

Each category links to the consequence ladder (warning → 24h
suspension → permanent ban). Flag clearly that admin discretion
applies.

#### D. Acceptable Use Policy

Tighter, more enumerated than Community Guidelines — the
machine-readable version that the moderation tooling enforces. Lists
the specific behaviours that trigger automated action vs admin
review.

### In-app surfaces

- Sign-up flow: add an "I agree to Terms + Privacy Policy" checkbox
  with inline links to the in-app readers. Block submit until checked.
- Account screen: links to all four documents.
- Footer of every page (web wide only): four links + © Crema + year.
- Account deletion: a real "Delete my account" button in account
  settings. Soft-delete first (30-day recovery), hard-delete after
  the window. Surface this to the user — they may want to defer
  the actual deletion plumbing to a follow-up session.

### Standing legal questions to surface

1. **Entity**: Is Crema operating as an individual proprietorship,
   LLP, or Pvt Ltd? The legal docs need an entity name + address.
2. **Jurisdiction**: India is assumed; user confirm city for venue.
3. **Lawyer review**: Has one been retained? If not, every draft
   ships with a "REVIEWED BY: <pending>" marker.
4. **Data residency**: Are we storing user data in India only, or
   can SQLite / backend run anywhere? DPDP Act preference is for
   Indian residency for sensitive data.
5. **IT Rules 2021 takedown contact**: India's equivalent of the
   DMCA notice. Confirm with the user that the takedown email +
   workflow is acceptable.

---

## Files to study before starting

- `NORTH_STAR.md` §5 ("What we don't do") — confirms the moderation
  philosophy: no algorithmic ranking, no engagement tricks. Moderation
  surfaces should match this restrained tone.
- `BUILD_ROADMAP.md` §1.6 (Design system) — has the night-mode + the
  3-color palette story end-to-end. Don't reintroduce off-palette colors.
- `Community/coffee-community-api/database.py` — migration pattern,
  table naming conventions.
- `Community/coffee-community-api/routes/` — endpoint patterns
  (`@router.post`, response shapes, auth dep).
- `crema-app/src/components/PostMenu.tsx` + `utils/postMenuActions.ts`
  — the shape of the existing report/hide/dislike menu wiring.
- `LAUNCH_TODO.md` — verify whether legal docs / moderation already
  appear on the launch backlog so we don't duplicate intent.

---

## Don't get distracted by

- The night-mode work just shipped — don't touch the palette tokens
  or `useTokens.ts` unless you find a real bug. The dual-track
  palette directive in CLAUDE.md is binding.
- The flavor wheel + Catalog Ops Schema Manager — these were the
  prior session's primary deliverable; if you find loose ends there,
  flag them but don't refactor.
- Open-source moderation libs that promise "AI moderation in 5 min"
  — most are western-content trained and miss the Indian-language
  failure modes. Slur lists are still the highest-leverage first cut.
- DMCA-only takedown language — India uses IT Rules 2021, not DMCA.
  Check with the user before drafting takedown sections.
- Building a full chat-message moderation pipeline (DMs are
  one-to-one; the legal exposure profile differs). Phase 1 moderation
  is for PUBLIC posts + comments. Defer DM moderation unless the
  user explicitly raises it.

---

## Standing rules (from `CLAUDE.md` / `NORTH_STAR.md`)

- Phase-1 surface — Discover + feed + profile are the priority.
- Token-only styling. Don't introduce hex literals. The dual-track
  palette rule applies (light: approved neutrals; dark: rgba opacity
  variants of brand colors only).
- Update `BUILD_ROADMAP.md` when work lands — moderation gets a new
  §1.6 / §1.5 entry depending on whether you classify it as design or
  admin; the legal docs probably warrant a new top-level section.
- The `DESIGN_LANGUAGE.md` pre-flight checklist applies to every new
  surface (reporting modal, admin Reports tab, legal-doc reader).
- When the moderation work touches the social feed, update
  `specs/COMMUNITY_SPEC.md` in the same change.

When in doubt about scope: ship the moderation tooling first
(Workstream 1) — the legal docs are unblocked once moderation
exists, but moderation without policy is harder to justify
soft-deleting content.
