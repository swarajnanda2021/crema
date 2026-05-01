# Design Language — Crema

The single source of truth for the visual look. Every new UI surface
runs through this checklist before it ships. Read it whenever you're
writing or proposing a new screen / component / icon / pill /
illustration.

The token catalog is `crema-app/src/tokens/design-tokens.json`. This
file documents the *intent* behind those tokens.

---

## 1. Primary palette — three colors only

The brand identity is three colors. Everything else is functional
neutral or derived alpha.

| Name | Hex | Token | Used as |
|---|---|---|---|
| **Espresso** | `#351101` | `t.color["text.primary"]`, `t.color["accent.cta"]`, `t.color["navbar.bg"]`, `t.color.shadow` | Body text, headings, primary CTA fill, navbar background, sold-out pill, error / destructive emphasis, negative deltas |
| **Crema** | `#D798DA` | `t.color.accent`, `t.color["accent.positive"]`, `t.color["accent.gold"]`, `t.color["shelf.open_bags"]`, `t.color["shelf.on_the_list"]` | Brand accent, "looking-for" pink, active-tab dot, like-pulse, save-as-draft hint, positive deltas |
| **Crema White** | `#FAF8F0` | `t.color.bg`, `t.color["text.on-dark"]`, `t.color["navbar.text"]` (close cousin), `RoasterLogo` background | Page bg, on-dark text, card-front variants |

**These three are non-negotiable.** No new vivid colors get
introduced. If a UI needs "alert / warning" emphasis, use Espresso
on cream (formal, low-contrast version) or Crema on Espresso (the
inverse for high-attention overlays). Don't reach for red, green,
gold, orange, blue.

### Functional neutrals — LIGHT MODE

Light mode has an established set of functional neutrals tonally
consistent with the brand (warm browns + creams). These are the
**approved** light-mode values. Use them, don't add new ones.

| Token | Hex | Role |
|---|---|---|
| `text.secondary` | `#684F44` | Body sub-text, location lines, meta |
| `text.muted` | `#A09580` | Time stamps, hint text, empty-state copy, **inactive tab labels** |
| `card.front` | `#FFFFFF` | Card surface (post card, modal card) |
| `card.info` | `#EFE9DB` | Card info panel (CoffeeCard bottom half), tag bg |
| `card.subtle` | `#FEFDFB` | Subtle elevated card (article overlay, repost inner) |
| `card.back` | `#2C1810` | Dark card variant (rare, e.g. CoffeeCard back face) |
| `border` / `border.light` / `divider` | `#D7D1C4` | **Every line element** — post separators, card outlines, tab-bar borders, section breaks, hairlines. Single-value tier (collapsed 2026-05-01). |
| `unavailable` | `#B0A89F` | Disabled control bg |
| `tag.bg` | `#EFE9DB` | Chip background |
| `tag.text` | `#5D4E42` | Chip text |
| `nav.mobile.bar.bg` | `#FFFAED` | Mobile bottom-tab bar surface (warm cream, brighter than page bg so the bar reads as elevated chrome rather than blending in) |
| `navbar.text` | `#E7D5B8` | Navbar link text on Espresso navbar |
| `roaster.panel` | `#2a0d00` | Dark roaster hero strip |
| `roaster.hero.fallback` | `#1a0800` | Even darker roaster hero gradient stop |
| `flash` | `rgba(215,152,218,0.25)` | Press-state highlight (Crema with alpha) |
| `overlay` | `rgba(104,79,68,0.6)` | Modal backdrop |

**These are the only legal hex literals in light mode.** Anything
outside this set + the three brand colors is a violation. If a
regression introduces a new hex, fix it at the token VALUE — don't
add a new token to legitimise it.

### Functional neutrals — DARK MODE

Dark mode previously enforced a strict "rgba opacity variants of
brand colors only" rule. That rule was relaxed 2026-05-01 in favor
of explicit warm-brown tokens for line and inactive-secondary
surfaces — the strict-rgba approach produced lines that were
either invisible (cream-on-cream over the persistently-light
CoffeeCard) or muddy (dark-warm-on-dark-Espresso) in too many
contexts. The current dual-track rule:

- **Brand identity in dark mode is still strictly the three brand
  hexes** (Espresso, Crema, Crema White). New brand-color tonal
  experiments (warm grey, light brown, etc.) are still forbidden.
- **Line and inactive-secondary surfaces in dark mode use the
  approved warm-brown set** below — these are the only opaque
  hexes allowed in dark mode beyond the three brand colors.

| Token | Dark-mode value | Role |
|---|---|---|
| `text.primary` | `#FAF8F0` | Body text, **active tab labels**, **active tab underline** |
| `text.secondary` | `rgba(250,248,240,0.7)` | Body sub-text, meta |
| `text.muted` | `#C7BAA5` | Time stamps, hint text, **inactive tab labels** |
| `card.front` / `card.info` / `card.subtle` / `card.back` | `#351101` | All page-level surfaces collapse to bg (use `card.product.*` for the persistently-light CoffeeCard surfaces) |
| `border` / `border.light` / `divider` | `#684F44` | **Every line element** — post separators, card outlines, tab-bar borders, section breaks, hairlines. Single-value tier (collapsed 2026-05-01). |
| `tag.bg` | `rgba(250,248,240,0.08)` | Chip bg |
| `unavailable` | `rgba(250,248,240,0.4)` | Disabled |
| `nav.mobile.bar.bg` | `#351101` | Bottom bar collapses into bg (no separation, on-palette) |
| `navbar.text` | `#FAF8F0` | Crema White on Espresso navbar |
| `accent.cta` | `#D798DA` | Pink CTA pops on dark Espresso bg |
| `roaster.panel` / `roaster.hero.fallback` | `#351101` | Collapses into bg |
| `overlay` | `rgba(0,0,0,0.7)` | Black scrim |

The non-flipping `bg.identity` (`#FAF8F0` always) and `card.product.*`
tokens (always-light cream/white set, used by CoffeeCard and avatars)
keep their brand-identity surfaces consistent across both modes.

### Tab labels — explicit pairing

Every tab implementation (top-level BEANS/ROASTERS, profile sub-tabs,
admin sub-tabs, mobile footer) shares one rule, enforced via tokens
so no per-component override drifts:

| State | Light | Dark | Token |
|---|---|---|---|
| **Active label** | `#351101` | `#FAF8F0` | `text.primary` |
| **Active underline** | `#351101` | `#FAF8F0` | `text.primary` |
| **Inactive label** | `#A09580` | `#C7BAA5` | `text.muted` |

**No tab underline uses `accent.cta`** — that token flips to Crema
pink in dark mode, which doesn't read as "this tab is active." The
active underline is always `text.primary`.

### Reserved — Crema pink for post action icons

`accent` (`#D798DA`) is the post-action icon color: like, comment,
share, save, the active tasting-note score chip, the post FAB. Don't
repurpose it for line elements, tab underlines, or general accents
elsewhere — the pink is the *post engagement* signal.

### Forbidden

- **Inline hex** outside `design-tokens.json`. Run
  `grep -rEn "#[0-9A-Fa-f]{6}" crema-app/src crema-app/app | grep -v node_modules`
  and verify every result is a brand hex or an approved neutral from
  the tables above.
- **Inline rgba** for line / border / divider colors. Use
  `t.color.border` (or `t.color.divider` / `t.color["border.light"]` —
  same single-tier value) instead. The 2026-05-01 line standardization
  collapsed all three line tokens to one value per mode; any
  `rgba(215,209,196,0.x)` or `rgba(250,248,240,0.0x)` line color in
  code is a leftover regression.
- Off-brand reds (`#C8553D`, `#B5393C`), greens (`#2F7A48`,
  `#5A8F5A`), golds (`#E8C07A`). Retired in `9c20f43`.
- **`accent.cta` as a tab underline.** It flips to Crema pink in
  dark mode, which mis-reads. Use `text.primary` for active-tab
  underlines.
- **Inventing a new dark-mode hex.** Beyond the three brand colors
  and the explicitly-named warm-brown tokens (`#684F44` for lines,
  `#C7BAA5` for `text.muted`), no new opaque hex enters the dark
  tree. Tonal variants of brand colors continue to be `rgba(...)`
  opacity passes only.

---

## 2. Typography

| Family | File | Token | Use |
|---|---|---|---|
| **New Spirit Light** | `NewSpiritTRIAL-Regular.otf` | `t.font.display` | Coffee names, profile names, page titles, hero headings, empty-state H1, large numerics on metric cards, the Crema wordmark anywhere it's typed (not the SVG) |
| **Inter Regular** | `Inter_400Regular.ttf` | `t.font["body.regular"]` | Body text, descriptions, captions |
| **Inter Medium** | `Inter_500Medium.ttf` | `t.font["body.medium"]` | Pill labels, meta-line emphasis, button labels (where Semibold feels heavy) |
| **Inter Semibold** | `Inter_600SemiBold.ttf` | `t.font["body.semibold"]` | Section labels, primary button text, navbar links, tab labels |
| **Inter Bold** | `Inter_700Bold.ttf` | `t.font["body.bold"]` | Rare. High-attention numerics in admin only. |

`NewSpiritTRIAL-Regular.otf` ships under a trial license at the
moment. When the production license arrives, swap the file
in-place and update the token-loaded family name in
`app/_layout.tsx` + `t.font.display`. Every call-site references
`t.font.display`, so the swap is one config change.

**Sizes** must come from `t.size.font.*` ladder:

`xs (10) · sm (11) · base (13) · md (14) · lg (16) · xl (18) · 2xl (24) · display (32) · price (20)`

Never `fontSize: 14` inline. Never invent a new number. If you
genuinely need one, extend the ladder in `design-tokens.json` —
that's a deliberate token-system decision, not a per-component
hack.

---

## 3. Spacing, radius, shadow

- **Spacing**: `t.spacing.*` ladder
  (`2xs (2) · xs (4) · sm (8) · md (12) · lg (16) · xl (20) · 2xl (24) · 3xl (32) · 4xl (40) · 5xl (64)`).
  Never `padding: 14` inline. Always pick a ladder value.
- **Radius**: `t.radius.*`
  (`xs (2) · sm (4) · md (8) · lg (12) · xl (16) · 2xl (20) · full (9999)`).
- **Shadow**: `cardShadow` from `useTokens.ts`. Don't compose
  `shadowOffset` / `shadowOpacity` / `elevation` inline.

---

## 4. Identity surfaces (avatars, logos)

There are **two** visual languages for "who is this":

| Surface | Treatment | Component |
|---|---|---|
| **Person / user identity** — feed posts, comments, notifications, messages, profile dropdown, follow rows, message picker | **Circular** | `CroppedAvatar` (`src/components/primitives/Avatar.tsx`) |
| **Roaster / brand identity** — Discover ROASTERS row, search results, consumer roaster page hero, admin roaster page, Catalog Ops list | **Rounded square** (`t.radius.lg`) on a cream box | `RoasterLogo` (`src/components/primitives/RoasterLogo.tsx`) |

The split is **semantic**, not bitmap-driven. A roaster posting in
the feed renders circular (their post is from a person — the
roaster account user) — even though the underlying image is the
roaster's logo. The `sync_roaster_logo_to_user` hook keeps the
bitmap in sync between `roaster_profiles.logo_url` and
`users.avatar_url`.

`RoasterLogo` has two variants:

- `default` — bare rounded-square box.
- `hero-overlap` — adds a 4-px cream ring so the square pops off a
  colored hero band. Use on the consumer + admin roaster page when
  the logo straddles the hero/about seam.

**Never invent a third variant.** A new identity surface picks
one of these two.

---

## 5. Layout branching

Wide vs. mobile is determined by `useBreakpoint().isMobile`, NEVER
by `Platform.OS === "web"`. A narrow web viewport counts as mobile.

`Platform.OS` checks are reserved for genuinely platform-specific
behavior (e.g. `position: "fixed"` on web, `position: "absolute"` on
native; SecureStore vs. localStorage). Visual decisions branch on
viewport width, not host platform.

---

## 6. House patterns (the "nearest existing screen" rule)

Before writing a new screen, open the closest existing one of the
same type and mirror its moves — header spacing, first row, where
body copy sits. If a new screen lays out fundamentally differently
from its peers, stop and justify.

Quick lookups:

- **Detail page (consumer)** — `app/coffee/[id].tsx`,
  `app/roaster/[slug].tsx`. Hero on top, info column below, FAB
  bottom-right where applicable.
- **List page** — `app/(tabs)/browse.tsx` (BEANS / ROASTERS tabs).
  Filter sidebar (wide) or filter drawer (mobile), sticky search.
- **Modal** — `PostModal.tsx`, `CoffeeDetailSheet.tsx`. Cream card
  centered, blur backdrop overlay, X to close, ScrollView body
  with concrete height via `useWindowDimensions`.
- **Form** — `EditableCoffeeCard.tsx`, `ComposePost.tsx`.
  Floating modal, field rows with consistent label width,
  Submit-style primary button bottom-right.
- **Empty state** — `"Nothing here yet."` line in
  `t.font["body.regular"]` at `t.size["font.md"]` in
  `t.color["text.muted"]`, centered. No big illustrations, no
  hero headings; the parent header already names the surface.

---

## 7. Pre-flight checklist

Run this in your head before any UI commit:

- [ ] Every color is `t.color.*` (no inline hex outside the
      palette family).
- [ ] Every font is `t.font.*` (`display` for Crema-named display
      surfaces, `body.*` for everything else).
- [ ] Every fontSize is from `t.size.font.*` ladder.
- [ ] Every spacing is from `t.spacing.*` ladder.
- [ ] Every radius is from `t.radius.*`.
- [ ] Shadows go through `cardShadow` helper.
- [ ] Icons are `lucide-react-native` at `t.size.icon.*` sizes.
- [ ] Layout branches on `useBreakpoint`, not `Platform.OS`.
- [ ] Identity treatment: `CroppedAvatar` for people, `RoasterLogo`
      for roasters.
- [ ] House-pattern check: looked at the nearest existing peer
      screen and mirrored its structural moves.
- [ ] Empty state uses the canonical "Nothing here yet" line.

If any box is unchecked, fix before review.
