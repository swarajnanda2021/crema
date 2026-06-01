# Maestro E2E flows

Mobile end-to-end tests for the Crema app. Run on a booted iOS
Simulator, Android Emulator, or USB-connected real device — Maestro
auto-detects whichever target is live.

## One-time setup

1. **Install Maestro CLI:**
   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   export PATH="$PATH:$HOME/.maestro/bin"
   ```
2. **Install Java 17+** (Maestro is a JVM tool):
   ```bash
   brew install openjdk@17
   # then add JAVA_HOME / openjdk to PATH per the brew caveats
   ```
3. **Install the dev client on a target.** Crema uses `expo-secure-store`,
   `expo-haptics`, etc., which Expo Go doesn't expose.
   ```bash
   cd crema-app
   npx expo run:ios       # iOS Simulator (needs full Xcode)
   npx expo run:android   # Android Emulator (needs Android Studio + AVD)
   ```

## Running a flow

```bash
maestro test crema-app/.maestro/01_login_as_crema.yaml
maestro test crema-app/.maestro/05_discover_bean_inspect_buy.yaml
```

Run the whole suite:
```bash
maestro test crema-app/.maestro/
```

The simulator window animates each tap so you can watch the journey
unfold. Pass: green output. Fail: a per-step screenshot + final video
land in `~/.maestro/tests/<timestamp>/`.

## Studio (visual flow recorder)

```bash
maestro studio
```

Opens a browser UI at `http://localhost:9999` mirroring the connected
device. Click through the app; Studio records every tap and input as
YAML you can copy into a new flow file. Use this when adding new
journeys instead of hand-writing YAML.

## What's instrumented

The flows depend on these `testID` props in the source. Group them by
the surface they live on so it's obvious which file to open when a
flow breaks because the markup changed.

**Auth + nav chrome**

| testID | File | Purpose |
|---|---|---|
| `auth-username`, `auth-displayname`, `auth-password` | `app/auth.tsx` | Form inputs |
| `auth-submit` | `app/auth.tsx` | Sign-in / Create-account button |
| `auth-toggle-mode` | `app/auth.tsx` | Login ↔ Register toggle |
| `tab-discover`, `tab-search`, `tab-profile` | `src/components/MobileFooter.tsx` | Bottom-nav tabs |
| `browse-screen`, `search-screen`, `profile-screen` | `app/(tabs)/*.tsx` | Tab screen markers |

**Article engagement** (JOURNAL articles — likes + comments are the
surviving engagement surface after the catalog-only pivot)

| testID | File | Purpose |
|---|---|---|
| `action-like-<id>` | `src/components/primitives/ActionBar.tsx` | Like toggle on an article |
| `action-comment-<id>` | `src/components/primitives/ActionBar.tsx` | Comment opener |
| `action-share-<id>` | `src/components/primitives/ActionBar.tsx` | Copy-share-URL button |
| `comment-input`, `comment-send` | `src/components/primitives/CommentThread.tsx` | Comment composer |

**Coffee discovery**

| testID | File | Purpose |
|---|---|---|
| `coffee-card-<product_id>` | `src/components/CoffeeCard.tsx` | Card root |
| `coffee-buy-<product_id>` | `src/components/CoffeeCard.tsx` | In-card cart icon |
| `coffee-detail-screen` | `app/coffee/[id].tsx` | Detail page |
| `coffee-detail-buy` | `app/coffee/[id].tsx` | Detail-page Buy CTA |
| `coffee-detail-sheet`, `detail-sheet-close` | `src/components/CoffeeDetailSheet.tsx` | Long-press provenance sheet |
| `browse-tab-roasters`, `browse-tab-journals` | `app/(tabs)/browse.tsx` | Discover sub-tabs |
| `roaster-row-<slug>`, `roaster-screen` | `src/components/RoasterRow.tsx`, `app/roaster/[slug].tsx` | Roaster list row + storefront |
| `article-row-<id>`, `article-screen` | `src/components/domain/ArticleListRow.tsx`, `app/article/[id].tsx` | Journals list row + reader |

**Search**

| testID | File | Purpose |
|---|---|---|
| `search-input` | `src/components/SearchDropdown.tsx` | Sitewide search field |
| `search-result-bean-<product_id>` | `src/components/SearchDropdown.tsx` | Beans result row |

Adding a new flow that touches a different surface? Add a `testID` to
the relevant primitive first; flows that select by visible text alone
break the moment copy changes.

## CI later

When the local suite is green for a week, options:

- **Maestro Cloud** (mobile.dev) — managed iOS + Android infra. Free
  tier is ~100 runs/month; paid plans start ~$99/mo. Upload the
  `.app` (iOS) / `.apk` (Android) artifact + the flow files.
- **Self-hosted Linux runner** — Android emulator only. GitHub
  Actions with a KVM-enabled runner, ~10 min per job. Free if the
  repo is public; metered for private.
- **macOS GitHub runner** — iOS Simulator. Significantly slower +
  more expensive than the alternatives. Avoid until you must.
