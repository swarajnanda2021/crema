# Maestro Ops — running and extending the E2E suite

> Companion to [crema-app/.maestro/README.md](crema-app/.maestro/README.md).
> The README is the testID reference table. This file is the operational
> playbook for actually *running* the suite, *triaging* failures, and
> *extending* it with new user journeys. Pull this in whenever the user
> asks to run Maestro flows, debug one, or add a journey.

## Where things live

- **Flows**: `crema-app/.maestro/0[1-9]_<slug>.yaml` + `10_<slug>.yaml`.
  Sequential numeric prefix is load-bearing (flow 01 sets up the auth
  state every later flow inherits — see "Run sequentially" below).
- **testID reference**: [crema-app/.maestro/README.md](crema-app/.maestro/README.md).
- **xcrun shim**: `tmp/maestro-shims/xcrun`. Required on macOS 12 +
  Xcode 14.2 — Maestro 2.5.1 calls `xcrun devicectl device list
  devices --json-output` which doesn't exist there; the shim returns
  an empty device list so Maestro falls back to the Android emulator
  path. Must be on PATH ahead of `/usr/bin` when running maestro.
- **Per-run output**: `~/.maestro/tests/<timestamp>/`. Each run dir
  has `maestro.log`, `commands-(...).json`, and a per-failure
  `screenshot-❌-*.png` (read with the Read tool — the heart in the
  filename copies fine).

## Prereqs — verify before running anything

These three blockers are what I keep hitting; check them first.

1. **Backend up on port 8000.** Flows hit the real API.
   ```bash
   curl -sS -X POST http://127.0.0.1:8000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"crema","password":"crema"}' | head -c 60
   ```
   Expect `{"data":{"user":{"id":144,...`. If the backend isn't
   running, ask the user to start it — per `CLAUDE.md`, don't start
   dev servers yourself.

2. **Android emulator + app installed.**
   ```bash
   export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
   adb devices                                # expect emulator-XXXX device
   adb shell pm list packages | grep crema    # expect com.crema.app
   ```

3. **Metro running.** `ps aux | grep "expo start"` should show one.
   Same rule — don't start it yourself.

4. **Maestro on PATH.**
   ```bash
   export PATH="/Users/swarajnanda/Coffee_Aggregator/tmp/maestro-shims:$HOME/.maestro/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
   maestro -v   # 2.5.1 is the known-working version
   ```

## Run the suite — sequentially, in pinned order

**Don't** run `maestro test crema-app/.maestro/`. Maestro 2.5.1's
directory walk is non-deterministic — `01_login_as_crema` (the only
flow that establishes auth state) ends up running fifth and the
preceding four cascade to red. Confirm by reading
`maestro.log`'s `Created execution plan: ExecutionPlan(flowsToRun=[...])`
line — if the order isn't `01, 02, ..., 10`, the directory mode bit you.

The pattern that works: a shell loop invoking `maestro test` per file
in sorted order:

```bash
cat > /tmp/run-maestro-suite.sh << 'EOF'
#!/bin/bash
set -u
export PATH="/Users/swarajnanda/Coffee_Aggregator/tmp/maestro-shims:$HOME/.maestro/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
cd /Users/swarajnanda/Coffee_Aggregator
RESULTS=/tmp/maestro-results.tsv
: > "$RESULTS"
# 0*.yaml first (01–09), then 10_*.yaml — keeps 10 last lexicographically.
for f in crema-app/.maestro/0*.yaml crema-app/.maestro/10_*.yaml; do
  base=$(basename "$f" .yaml)
  start=$(date +%s)
  maestro test "$f" --no-ansi > "/tmp/maestro-flow-$base.log" 2>&1
  rc=$?
  dur=$(( $(date +%s) - start ))
  [ "$rc" = "0" ] && echo "PASS	$base	${dur}s" | tee -a "$RESULTS" \
                  || echo "FAIL	$base	${dur}s	rc=$rc" | tee -a "$RESULTS"
done
EOF
chmod +x /tmp/run-maestro-suite.sh
bash /tmp/run-maestro-suite.sh
```

Run it via Bash with `run_in_background: true`, then arm a `Monitor`
on `/tmp/maestro-results.tsv` (or the progress log) to get per-flow
PASS/FAIL signals. The whole suite typically takes 12–18 minutes —
flow 01 alone is ~3.5 min because typing on the Android emulator is
glacial.

To re-run a subset (post-failure triage), run named files in a loop:

```bash
for f in 02_feed_like_and_comment 04_compose_post; do
  maestro test "crema-app/.maestro/${f}.yaml" --no-ansi \
    > "/tmp/maestro-flow-${f}.log" 2>&1
done
```

## Hard-won rules

Every one of these bit me during the initial 10-flow buildout. Encode
them, don't relearn them.

### 1. Android `inputText` is ~10s/char with a 120s gRPC timeout

Anything over ~10 characters hangs and times out. `"First pour of the
morning"` (25 chars) → DEADLINE_EXCEEDED. `"brew"` (4 chars) → fine.

If the timeout fires mid-typing, the app is left in a half-input
state. The next flow's `launchApp` can come back to a black screen
because Metro hasn't recovered. Force-stop and let Metro settle:

```bash
adb shell am force-stop com.crema.app
sleep 5
```

For long strings (URLs, sentences), there's no fast workaround on this
emulator — Android's `cmd clipboard` shell isn't implemented and
Maestro's `pasteText` needs a populated clipboard we can't set from
adb. Document those legs as manual-only checks. (Flow 10's article-URL
share is a documented example.)

### 2. Absolute-positioned overlays silently swallow taps

The footgun:

```tsx
<View style={s.topBar}>
  <Pressable testID="cancel">Cancel</Pressable>
  <Text style={[s.title, { pointerEvents: "none" }]}>New post</Text>  // ❌
  <Pressable testID="submit">Share</Pressable>
</View>
```

`pointerEvents` set as a **style** is silently ignored on `<Text>` in
this RN version. The absolute-positioned title's invisible hitbox
spans the whole top-bar and covers Cancel + Share. Maestro
`tapOn: cancel` reports `COMPLETED` but the React `onPress` never
fires.

**Fix:** wrap the title in a View and pass `pointerEvents="none"` as
a **prop** (RN honors that reliably):

```tsx
<View pointerEvents="none" style={s.titleWrap}>
  <Text style={s.title}>New post</Text>
</View>
```

When `tapOn` says COMPLETED but the screen doesn't change, look for
absolute overlays at the same z-level first.

### 3. ScrollView over tappable rows needs `keyboardShouldPersistTaps`

When a screen auto-focuses an input, the keyboard pops up. The first
tap on any tappable inside an ungated `ScrollView` is then eaten as
"dismiss keyboard" instead of firing onPress. Maestro reports
COMPLETED, the row doesn't navigate.

```tsx
<ScrollView keyboardShouldPersistTaps="handled">
  {results.map(r => <Pressable testID={...}>...</Pressable>)}
</ScrollView>
```

This is also a real-user UX bug — they tap, nothing happens, they
tap again. Fix in the app, not the test.

### 4. testID regex collisions

`tapOn: { id: "coffee-card-.*" }` matches **both** `coffee-card-<id>`
AND `coffee-card-buy-<id>` because `.*` is greedy and Maestro's pick
between collisions isn't stable. Real bug from the buildout: long-press
on a card triggered the in-card cart icon → opened Chrome.

Rule when adding a child-element testID: use a non-overlapping prefix.
The in-card cart icon is `coffee-buy-<id>`, not `coffee-card-buy-<id>`.
If you must overlap, regex-escape with `\d+` to disambiguate
(`coffee-card-\d+` won't match `coffee-card-buy-...`).

### 5. `assertVisible` against text is racey for async data

Bare `assertVisible: "Speciality Coffees"` against a list that's still
fetching from the API fires immediately and fails. The screenshot
captured 30s later shows the text plainly visible — proof of the race.

**Use `extendedWaitUntil` against a testID:**

```yaml
- extendedWaitUntil:
    visible:
      id: "roaster-row-.*"
    timeout: 15000
```

Forgiving enough for cold-cache fetches, anchored to a stable
identifier that won't drift when copy changes.

## Anatomy of a journey YAML

Every flow except 01 starts the same way — assume `crema/crema` is
already authenticated:

```yaml
appId: com.crema.app
---
- launchApp
- extendedWaitUntil:
    visible:
      id: "feed-screen"
    timeout: 30000

# … journey-specific steps …
```

Naming:

- `0[1-9]_<journey_slug>.yaml` for ordering 01–09.
- `10_<journey_slug>.yaml` for #10. The shell loop globs `0*.yaml`
  first then `10_*.yaml` so 10 runs last (lexicographic 1<10<2 if
  you don't split the glob).
- Slug is `<verb>_<surface>` style: `feed_like_and_comment`,
  `discover_bean_inspect_buy`, `chat_with_aayushi`.

Header comment template (every flow has one):

```yaml
# Journey N — <one-line summary of what real-user behaviour this
# simulates>.
#
# <2–3 lines on what's being verified, why this surface matters, any
# data assumptions (existing thread, fixed username, etc.).>
#
# <Notes on workarounds — short text strings, sequencing assumptions,
# emulator quirks.>
```

## Adding a new journey

1. **Pick the persona moment.** What does a coffee enthusiast do that
   the existing 10 don't cover? (Open a roaster's article from a bean
   detail rail, view own shelf, scroll roaster's coffees grid, etc.)
2. **Audit testID coverage.** Grep `testID=` in the relevant
   components. If a primitive lacks one, **add it before writing the
   YAML.** Naming pattern is `<surface>-<role>-<id>` (e.g.
   `post-card-<id>`, `action-like-<id>`, `thread-row-<username>`).
   Update [crema-app/.maestro/README.md](crema-app/.maestro/README.md)'s
   testID table in the same change.
3. **Check for prefix collisions.** Grep for any existing testID that
   could match the same regex you plan to use.
4. **Type short.** Anything > ~10 chars in `inputText` is risky.
   Coffee enthusiasts write terse comments anyway — `nice`, `yes`,
   `brew`, `hi` are perfectly representative.
5. **Wait on testIDs, not text.** `extendedWaitUntil` with `id` is
   reliable; bare `assertVisible: "Some Text"` is racey.
6. **Run the new flow alone first.** Catches issues in seconds without
   burning 15 min on the prior 9 flows.

## Triage recipes

When a flow fails, work through this in order:

| Symptom | Likely cause | First check |
|---|---|---|
| `assertVisible feed-screen` fails right after `launchApp` | App in bad state from prior flow's mid-typing crash, OR Metro slow to bundle after a code change | `adb shell uiautomator dump && grep resource-id /sdcard/window_dump.xml` — confirms whether the tree is actually rendered. If yes, just re-run; the 30s timeout was tight |
| Black screen | JS bundle still loading | Force-stop, wait 5–10s, retry. After big code changes Metro can take 30s+ to bundle |
| `tapOn` says COMPLETED but the screen doesn't change | Absolute-positioned overlay swallowing taps | Open the parent component, look for `style={..., pointerEvents: "none"}` on a sibling Text/View — convert to `<View pointerEvents="none">` prop |
| `tapOn` fires the wrong handler | testID regex matches an overlapping prefix | Grep for the regex pattern across testIDs; rename so prefixes don't collide |
| `inputText` hangs at exactly 120s | String too long for the emulator | Shorten to ≤ 10 chars |
| `assertVisible "<text>"` fails but the screenshot shows the text visible | Race against async data load | Replace with `extendedWaitUntil` on a testID |
| First tap on a result row dismisses the keyboard instead of selecting | ScrollView lacks `keyboardShouldPersistTaps` | Add `keyboardShouldPersistTaps="handled"` to the wrapping ScrollView |
| Suite runs flows out of order | Maestro 2.5.1 directory walk is non-deterministic | Use the sequential shell-loop runner; never `maestro test <dir>` |
| ADB driver disconnect mid-flow (`Command failed (tcp:7001): closed`) | Transient Maestro driver flake | Re-run the single flow; not a real failure |

To inspect the live UI when debugging:

```bash
# Maestro's hierarchy dump (JSON, deep)
maestro hierarchy

# Faster: native uiautomator dump
adb shell uiautomator dump
adb pull /sdcard/window_dump.xml /tmp/
grep -oE 'resource-id="[^"]+"' /tmp/window_dump.xml | sort -u
```

## Persona + data conventions

- **Test user**: `crema/crema` (id 144, admin). Persistent across runs;
  do NOT switch to a freshly-registered user — flows assume crema's
  shelf, follow graph, and DM thread.
- **Chat counterparty**: `aayushi` (display name "Aayushi Kapadia",
  id 8). `crema` already has thread `id=2` open with her in the dev
  DB. Use this for any DM journey.
- **Real interactions**: every flow leaves real artifacts in the dev
  DB — likes, comments, reposts, sent messages. The DB tolerates the
  noise; don't try to "clean up" with teardown steps that are
  themselves fragile.
- **Article 1220** ("Specialty Coffee: A Complete Guide") is a stable
  hit for any flow that needs to reference an article by id.

## Known gaps

These are documented limitations, not bugs to fix:

- **Article-URL share in chat** (`https://crema.app/article/1220`,
  30 chars): can't be typed on the Android emulator. Flow 10 sends a
  short text message; the unfurl-on-paste logic is exercised by
  `parseArticleShareUrl` separately.
- **Image upload in compose**: skipped because the picker permission
  flow is heavy on a swap-pressured emulator. Flow 04 cancels the
  composer instead of submitting.
- **External browser handoff** (Buy click-through opening Chrome):
  flow 05 fires the click but doesn't follow into Chrome — the
  testID `coffee-buy-<id>` is wired to fire `trackClick` +
  `openExternal`, both of which run before the OS hands off.

If a future flow needs to cover one of these, expect to either change
the test infrastructure (e.g. set Android clipboard via a custom adb
mod) or change the app (e.g. accept a shorter article-share URL form).
