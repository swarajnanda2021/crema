# Prompt for next Claude instance — swap Discover Flavor wheel T2/T3 labels to react-native-skia

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. Branch: `feat/mobile-readiness`.
> Don't open with a recap; pick up the task directly.

---

## TL;DR

The Discover Flavor wheel (a bottom-semicircle SCA flavor picker
that surfaces under BEANS) is fully built and shipping correctly on
device. Geometry, tap-routing, picks state, live BEANS filter, and
the result-carousel underneath all work.

**The one remaining defect:** T2 and T3 sector labels render as
straight chords across each sector instead of curving along the
ring's actual arc. Inside `react-native-svg` we hit a hard ceiling
— it can give us either kerning OR curved layout, never both. The
fix is to swap T2/T3 labels (and T2/T3 only) to render via
`@shopify/react-native-skia`'s `<TextPath>`, which renders curved
text with the native font kerning engine.

The reference demo
[`amarjanica/react-native-skia-expo-demo`](https://github.com/amarjanica/react-native-skia-expo-demo)
confirms Skia works in **Expo Go** on SDK 50+ without any custom
dev client / EAS build. The user is on SDK 54.0.33. `expo install`
is enough; Skia is bundled in Expo Go natively. Web needs an extra
postinstall step to ship CanvasKit WASM.

---

## Hard rules — read first

1. **Do not start dev servers from Bash or `preview_start`.** The
   user runs their own Metro on device. We previously broke their
   workflow by spawning competing servers — they were *very* clear:
   *"bro, this shell shit, you need to stop, I am unable to run my
   app."* Edit code; let them reload. The PostToolUse hook will
   nag about preview servers — ignore it explicitly with a one-line
   acknowledgement.
2. **Do not touch the SVG ring rendering, the hit-test, the
   bullseye overlay, the carousel, the modal layout, the
   `selectedFlavors` state plumbing, or T1 label rendering.** All
   of those are working; the user has approved them. Only the
   T2/T3 label render path changes.
3. **Token-only styling.** Palette = Espresso `#351101` / Crema
   pink `#D798DA` / Crema White `#FAF8F0`. Fonts: NewSpirit
   display / Inter body. Match colors via the existing token
   system, not hex literals.
4. **Phase-1 wireframe.** No animations, no flourish — just
   curved kerned labels.

---

## Current state of the wheel

### Files

| Path | Role |
|---|---|
| `crema-app/src/components/FlavorWheel.tsx` | The SVG wheel + label rendering. **Edit here.** |
| `crema-app/src/components/FlavorWheelModal.tsx` | The page host (header bar, bullseye stat, carousel). Don't edit. |
| `crema-app/app/(tabs)/browse.tsx` | Mounts the modal inline in BEANS body. Don't edit. |
| `crema-app/src/utils/scaTree.ts` | Tree constants + helpers (`displayLabel` collapses `<word>/<word>` to first word). Don't edit. |

### Geometry (don't change unless asked)

```
viewBox = 480 × 250
CX, CY = 240, 10               // wheel centre at top
polar(r, deg) = (CX + r*sin(deg), CY + r*cos(deg))
                              // deg=-90 leftmost, 0 bottommost, +90 rightmost

T1_INNER_R = 90,  T1_OUTER_R = 170   // 80px thick (T1 inner ring)
T2_INNER_R = 170, T2_OUTER_R = 200   // 30px thick
T3_INNER_R = 200, T3_OUTER_R = 230   // 30px thick

WHEEL_HEIGHT_RATIO = 250/480 ≈ 0.521
```

### Label render functions

- `renderRadialLabel(pill, ringInner, ringOuter)` — T1 only. Single
  SvgText, baseline along the spoke, rotation clamped to `[-90°,
  90°]` so glyphs stay upright. **Keep as-is.**
- `renderTangentialLabel(pill, ringInner, ringOuter)` — T2/T3.
  Single SvgText, `transform="rotate(${-midDeg})"`. This is the
  straight chord. **REPLACE this with Skia.**

### Why react-native-svg can't do curved kerned text

We tried four approaches inside react-native-svg and exhausted them:

1. `<TextPath>` with `side="right"` — react-native-svg silently
   ignores or mis-applies `side` on bottom-semicircle paths;
   glyphs render upside-down.
2. `<TextPath>` with reversed path direction + reversed input
   string — same renderer normalises path direction; visible text
   reads as the reversed string.
3. Per-glyph `<SvgText>` array (one element per character) — works
   for the curve but loses font kerning between adjacent glyphs.
   No `PX_PER_CHAR` value satisfies both narrow (`i`) and wide (`M`)
   characters.
4. Single `<SvgText>` with rotation transform — proper kerning,
   but the text is a chord through the sector midpoint, not on the
   arc. Chord-vs-arc divergence reaches ~54px at the edges of a 90°
   sector — visually wrong.

This is the bug history; do not re-tread it.

---

## What to build

### Step 1 — install Skia

From `crema-app/`:

```bash
npx expo install @shopify/react-native-skia
```

This drops the package into `package.json`. In Expo Go on SDK 54
the native binary is already bundled; nothing to rebuild on device.

For web, add this postinstall to `crema-app/package.json` so
CanvasKit WASM ships with the web bundle:

```json
"scripts": {
  "postinstall": "npx setup-skia-web public"
}
```

(The reference demo also runs a path-fix script after that — check
what's needed once on the user's setup. Native devices won't care
about the postinstall.)

### Step 2 — Skia overlay for T2/T3 labels

Inside the wheel SVG today there's already a wrapping `<View>` →
`<Pressable>` → `<Svg>` stack. The cleanest move is a sibling Skia
`<Canvas>` rendered AFTER the SVG inside the same Pressable, sized
identically (same `width: size, height: renderH`), absolutely
positioned to overlap the SVG.

```jsx
<View style={[styles.wrap, { width: size, height: renderH }]}>
  <Pressable onPress={handlePress} style={{ width: size, height: renderH }}>
    <Svg width={size} height={renderH} viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
      {/* unchanged: T1 + T2 + T3 ring paths + T1 SvgText labels */}
    </Svg>
    <Canvas
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width: size, height: renderH,
      }}
      pointerEvents="none"
    >
      {/* T2 + T3 labels via Skia <TextPath> */}
    </Canvas>
  </Pressable>
</View>
```

`pointerEvents="none"` on the Canvas keeps taps flowing through to
the Pressable so `findPillAt` continues to work unchanged.

### Step 3 — render each T2/T3 label

Skia's `<TextPath>` API (current as of `@shopify/react-native-skia`
~v1.x):

```jsx
import { Canvas, Path, Skia, TextPath, useFont } from "@shopify/react-native-skia";

const font = useFont(require("path/to/Inter-SemiBold.ttf"), 11);

// Inside the Canvas, for each pill:
const arcPath = Skia.Path.Make();
// Build the centerline arc — same math as the existing labelArcPath
// helper we deleted, but using Skia's Path API:
//   - start at polar(midR, startDeg) (in screen px, scaled from viewBox)
//   - addArc(rect, startAngle, sweepAngle) using Skia's degrees
arcPath.moveTo(p1.x, p1.y);
arcPath.arcTo(boundingRect, startAngleDeg, sweepAngleDeg, false);

<TextPath path={arcPath} font={font} text={pill.label} />
```

Important details:

- **Skia path coordinates are in screen pixels, not viewBox units.**
  Multiply every viewBox coord by `scale = size / VIEWBOX_W` before
  passing to Skia.
- **Skia's arc angles are measured from +x axis CCW** (standard math
  convention), not from 12 o'clock like the wheel's polar. Convert.
- **Skia's `TextPath` does NOT have the `side="right"` bug.** It
  uses the native Skia text-on-path engine; glyphs orient
  correctly relative to path direction. If labels render
  upside-down on first try, reverse the path direction (swap
  start/end and flip the sweep sign) — that's the standard knob.
- **Truncation:** Skia's `TextPath` will overflow the path if the
  text is longer than the path. Reuse the existing `shortLabel`
  helper from FlavorWheel.tsx with `maxChars = floor(arcLengthPx /
  PX_PER_CHAR)` where `PX_PER_CHAR ≈ 6` (Skia kerning will tighten
  it; this is just a truncation budget). Arc length =
  `midR_screenPx * arcDeg * π/180`.
- **Font loading:** `useFont(...)` is async — guard the Canvas
  return with `if (!font) return null;` so we don't render
  half-loaded text. The existing app uses
  `@expo-google-fonts/inter` — find the local Inter SemiBold TTF
  in `node_modules/@expo-google-fonts/inter/Inter_600SemiBold.ttf`
  and load that.
- **Color:** `<TextPath>` accepts a `color` prop. Picked label =
  `t.color["text.on-dark"]` (cream on pink). Unpicked =
  `t.color["text.primary"]` (espresso).

### Step 4 — keep everything else identical

- T1 labels stay on the SVG layer using `renderRadialLabel`. They
  work; the user has approved them.
- The bullseye stat overlay, header bar, and carousel are
  untouched.
- `findPillAt` and the Pressable wrapping are untouched.

### Step 5 — verify on device

After the user reloads Metro, T2 and T3 labels should:

1. Curve along their actual ring centerline (share the wheel centre).
2. Have proper letter spacing — no per-char gaps, no overlap on
   wide letters like `M`.
3. Read upright with caps facing toward the wheel centre at the top.

If the labels render but are upside-down, reverse the Skia path
direction (it's a one-line flip). If the labels don't render, check
that `useFont` resolved (`font !== null`).

---

## State to preserve in the rewrite

- `selectedFlavors: Picks` state in `browse.tsx`.
- `addressesByProduct` map in `browse.tsx`.
- The `FlavorWheelModal` props contract (`picks`, `onPicksChange`,
  `addressesByProduct`, `inStockProducts`, `onClose`).
- `coffeeMatchesPicks` filter rule in `selectedFlavors`-driven
  filtering.
- `/api/sca/addresses` and `/api/sca/tree` consumer endpoints.
- `displayLabel` collapsing `<word>/<word>` to first word.

None of these should change.

---

## Don't get distracted by

- Adding animations to the wheel. Phase 1, wireframe-fidelity.
- Refactoring the hit-test or SVG geometry. Working as-is.
- Replacing the T1 radial labels with Skia "for consistency."
  Keep T1 on SVG — it works and SVG is fine for short upright
  labels.
- Adding any new picks-related features (multi-flavor presets,
  recommendations, etc.). Out of scope.

---

## Files to study before designing

- `crema-app/src/components/FlavorWheel.tsx` — the wheel.
  Specifically `renderTangentialLabel` (the function being
  replaced), `polar()`, the `t2Pills` / `t3Pills` useMemos, and the
  T2/T3 render blocks where `renderTangentialLabel` is called.
- `crema-app/src/components/FlavorWheelModal.tsx` — for the host
  contract; don't edit.
- `crema-app/package.json` — see existing Expo SDK + native
  modules to confirm version alignment before installing Skia.
- The reference demo's `package.json` and `app.json` if you want
  to confirm what (if anything) needs to be added to plugins.
  Spoiler: nothing extra goes in `expo` plugins for Skia in
  Expo Go.

---

## Standing rules (from CLAUDE.md / NORTH_STAR.md)

- Phase 1 surface — Discovery + retention. The wheel is a
  brand-defining surface; Skia gives the curved-text fidelity the
  Figma designer will produce.
- Token-only styling. Don't hard-code hex.
- No new top-level `.md` files unless asked.
- Update `BUILD_ROADMAP.md` when this lands (move "Discover
  Flavor wheel — Skia curved labels" from the next-build queue
  into the "What has been built" section).

When in doubt about scope, ship the minimum: Skia overlay for
T2/T3 labels only, with `<TextPath>` curving along the ring's
arc, kerning preserved. That's the deliverable. Everything else
is a follow-up.
