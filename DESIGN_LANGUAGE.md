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
- **`#2a0d00` is the dark-mode page-body hex.** All page-level
  surfaces (`bg`, `card.front` / `card.back` / `card.info` /
  `card.subtle`, and `roaster.panel`) resolve to `#2a0d00` in dark
  mode. This is the same hex light mode uses for the Roaster bio
  panel — extending it to the page body in dark mode (refined
  2026-05-01) makes the feed read as a slightly-darker-than-Espresso
  body that the Espresso chrome (`navbar.bg`, `nav.mobile.bar.bg`)
  floats above as a distinct brand strip. Without this, the page
  bg and the chrome were the same Espresso, with no visible layering.
- **Line and inactive-secondary surfaces in dark mode use the
  approved opaque set** below: `#684F44` for lines and `#C7BAA5`
  for `text.muted`. Combined with the page-body `#2a0d00` and
  the brand `#351101` chrome, those are the only opaque hexes
  allowed in dark mode beyond the three brand colors.

| Token | Dark-mode value | Role |
|---|---|---|
| `bg` | `#2a0d00` | Page body in dark mode — the feed, profile, browse, etc. all paint here. Same hex as the Roaster bio panel (in both modes) and as the page-level cards below. |
| `card.front` / `card.info` / `card.subtle` / `card.back` | `#2a0d00` | All page-level card surfaces collapse into `bg` — same `#2a0d00` as the page body. Use `card.product.*` for the persistently-light CoffeeCard surfaces that don't flip. |
| `roaster.panel` | `#2a0d00` | **Roaster bio panel** on the consumer roaster page (Discover → roaster slug) and any surface marked as the dark identity band (Business-track auth, profile edit banner). Same exact hex as light mode and as the dark-mode page bg — the band merges with the page body in dark mode (no extra separation needed) but stays distinct in light mode. |
| `text.primary` | `#FAF8F0` | Body text, **active tab labels**, **active tab underline** |
| `text.secondary` | `rgba(250,248,240,0.7)` | Body sub-text, meta |
| `text.muted` | `#C7BAA5` | Time stamps, hint text, **inactive tab labels** |
| `border` / `border.light` / `divider` | `#684F44` | **Every line element** — post separators, card outlines, tab-bar borders, section breaks, hairlines. Single-value tier (collapsed 2026-05-01). |
| `tag.bg` | `rgba(250,248,240,0.08)` | Chip bg |
| `unavailable` | `rgba(250,248,240,0.4)` | Disabled |
| `navbar.bg` | `#351101` | Espresso brand chrome — the top navbar floats as a distinct strip above the slightly-darker `#2a0d00` page body. |
| `nav.mobile.bar.bg` | `#351101` | Espresso brand chrome — the mobile bottom tab bar mirrors `navbar.bg` so chrome reads as one band on both edges. |
| `navbar.text` | `#FAF8F0` | Crema White on Espresso navbar |
| `accent.cta` | `#D798DA` | Pink CTA pops on dark Espresso bg |
| `roaster.hero.fallback` | `#351101` | Espresso fallback under the hero image — only seen if the image fails to load. |
| `overlay` | `rgba(0,0,0,0.7)` | Black scrim |

The non-flipping `bg.identity` (`#FAF8F0` always) and `card.product.*`
tokens (always-light cream/white set, used by CoffeeCard and avatars)
keep their brand-identity surfaces consistent across both modes.

**Page body vs. brand chrome — the dark-mode layering.** Dark mode
splits the brand into two opaque tones: page-body surfaces use
`#2a0d00` (slightly darker than Espresso) and chrome surfaces use
`#351101` (Espresso, the brand color). The 2026-05-01 refinement
adopted this split because pre-refinement, page bg and chrome were
both `#351101` — the navbar and bottom bar disappeared into the
page with no visible boundary. Pulling the page to `#2a0d00`
floats the Espresso chrome as a distinct identity strip on both
edges, while keeping the Roaster bio panel (`#2a0d00` in light
mode) consistent in dark mode (it merges with the page body, which
is the desired dark-mode behaviour). Don't reach for `#2a0d00`
outside these named tokens (`bg`, `card.front`/`card.back`/`card.info`/
`card.subtle`, `roaster.panel`); it's role-bound, not a free
elevation tone.

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
  and the explicitly-named opaque tokens (`#684F44` for lines,
  `#C7BAA5` for `text.muted`, `#2a0d00` for the page body +
  page-level cards + `roaster.panel`), no new opaque hex enters the
  dark tree. Tonal variants of brand colors continue to be
  `rgba(...)` opacity passes only.

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

## 7. CoffeeCard rendering — single canonical surface

`CoffeeCard` is the only coffee surface anywhere in the app —
Discover BEANS grid, roaster page, profile shelves, related-
coffees rail on `/coffee/[id]`, the JOURNAL article's "More
from {roaster}" rail, the admin scrape-proposals carousel, and
every future buy-this-bean affordance. There must not be a
parallel "lighter" or "carousel-only" variant. **Every coffee
card the user sees follows the rules below.**

### Geometry (Figma 66:6267 + 66:6268)

The constants live in `crema-app/src/components/CoffeeCard.tsx`
and are exported for every call-site:

| Constant | Value | Used for |
|---|---|---|
| `CARD_TARGET_WIDTH` | `240` | Default card width on every surface — both grids and carousels. |
| `CARD_PORTRAIT_ASPECT` | `400 / 240` | Wide / web height = `width × 1.667`. |
| `CARD_LANDSCAPE_ASPECT` | `251 / 370` | Mobile height = `width × 0.679`. |

The card flips landscape on mobile and portrait on wide via its
internal `useBreakpoint().isMobile` check. **The wrapper's job
is to allocate matching height** so the variant doesn't sit
inside dead vertical space. Use the helper:

```ts
import CoffeeCard, {
  CARD_TARGET_WIDTH,
  coffeeCardHeight,
} from "../../src/components/CoffeeCard";

const cardW = CARD_TARGET_WIDTH;
const cardH = coffeeCardHeight(cardW, isMobile);

<View style={{ width: cardW, height: cardH }}>
  <CoffeeCard coffee={c} width={cardW} height={cardH} />
</View>
```

`CoffeeList.tsx` is the canonical reference implementation —
its grid does the same calc per cell.

### What you may NOT do

- Hardcode `width: 240, height: 372` (or any literal). The card
  will render landscape on mobile and leave 200+ px of dead space
  below. Always go through `coffeeCardHeight()`.
- Wrap the card in a smaller frame to "make it tighter". The
  Figma frame is 240 wide for a reason — narrower cards clip the
  info column and make the price chip overflow.
- Override the variant manually with `forceLandscape` outside
  admin Catalog Ops. That prop exists only because the admin
  carousel needs landscape on web wide too; consumer surfaces
  must let the viewport decide.
- Build a parallel `<MiniCoffeeCard />` / `<CarouselCoffeeCard />`
  / `<RelatedCoffeesCard />`. Every card surface ships through
  `<CoffeeCard />`. Compose, don't fork.

### Pre-flight check (additive to §8 below)

Before adding a coffee card to any surface, the wrapper code MUST
import `coffeeCardHeight` and apply it. If you find yourself
typing `height: 372` literally, stop — read this section.

---

## 8. Pre-flight checklist

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
- [ ] CoffeeCard surfaces use `<CoffeeCard />` directly (no fork);
      wrapper allocates `coffeeCardHeight(width, isMobile)`,
      never a hardcoded literal — see §7.
- [ ] House-pattern check: looked at the nearest existing peer
      screen and mirrored its structural moves.
- [ ] Empty state uses the canonical "Nothing here yet" line.

If any box is unchecked, fix before review.
