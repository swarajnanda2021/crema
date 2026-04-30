/**
 * FlavorWheel — the SCA-tree pick surface for Discover.
 *
 * Three concentric rings:
 *   - T1 (inner) — 9 fixed sectors, the SCA tier-1 categories.
 *     Always visible. Picked sectors fill with the brand accent;
 *     unpicked are outlined.
 *   - T2 (middle) — children of currently picked T1s. Fills 360°
 *     and re-divides every time a T1 pick is added or removed,
 *     so existing T2 pills shrink to make room.
 *   - T3 (outer) — same rule, one ring further out, populated from
 *     children of currently picked T2s.
 *
 * Each pill is a rounded-cap arc (stroke + stroke-linecap="round").
 * Tap to pick. Cap is 3 picks per tier — a 4th attempt fires a
 * warn haptic and is rejected. Deselecting a parent cascades to
 * its descendants.
 *
 * Pure presentation: no fetch, no business state. The host (the
 * modal) owns `picks` and re-renders when they change.
 */
import { useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable, type GestureResponderEvent } from "react-native";
import Svg, { Path, G, Text as SvgText } from "react-native-svg";
import { t } from "../tokens/useTokens";
import * as haptics from "../utils/haptics";
import {
  CANONICAL_TREE,
  TIER_1_ORDER,
  keyT1, keyT2, keyT3,
  listChildrenOfPicks,
  displayLabel,
  type Picks,
  type TreeDict,
} from "../utils/scaTree";

const MAX_PICKS_PER_TIER = 3;

// Layout — bottom semicircle. viewBox tightened to 480 × 250 and
// CY pulled up from 30 → 10 so the flat edge sits higher on the
// page; the wheel's screen height drops accordingly, leaving room
// for the result carousel without vertical scrolling.
//
// Angle convention (chosen so deg=0 is the bottommost point and
// pills can be encoded symmetrically):
//   deg = -90  → leftmost point of the half-disc
//   deg =   0  → bottommost point
//   deg = +90  → rightmost point
const VIEWBOX_W = 480;
const VIEWBOX_H = 250;
const CX = 240;
const CY = 10;

// T1 stays thick for the radial spoke labels; T2/T3 thinned to 30
// each (was 40) to compact the wheel. Total wheel radius drops from
// 250 → 230.
const T1_INNER_R = 90;
const T1_OUTER_R = 170;   // T1 ring 80 thick
const T2_INNER_R = 170;
const T2_OUTER_R = 200;   // T2 ring 30 thick
const T3_INNER_R = 200;
const T3_OUTER_R = 230;   // T3 ring 30 thick — matches T2

/** Semicircle pills span [-90, 90]. Half-circle total = 180°. */
const SEMI_HALF_DEG = 180;
const SEMI_START_DEG = -90;

/** Aspect ratio of the wheel — caller multiplies its `size` (the
 *  width) by this to get the SVG height. viewBox is 480×290 so
 *  height = width × 0.6042. */
export const WHEEL_HEIGHT_RATIO = VIEWBOX_H / VIEWBOX_W;

/** Width and height of the inscribed rectangle inside the empty
 *  half-disc at the top of the wheel — used by the modal to size
 *  the count + "coffees" overlay so it never overflows into T1. For
 *  a half-disc of radius R with the diameter at the top, the
 *  area-maximising top-edge-anchored rectangle has w = R√2 (~1.41R)
 *  and h = R/√2 (~0.71R) — corners sit exactly on the curved edge.
 *  Returned in screen px. */
export function bullseyeBoxPx(wheelSize: number): { w: number; h: number; flatEdgeY: number } {
  const scale = wheelSize / VIEWBOX_W;
  return {
    w: T1_INNER_R * Math.SQRT2 * scale,
    h: T1_INNER_R * (1 / Math.SQRT2) * scale,
    flatEdgeY: CY * scale,
  };
}

// ── Geometry helpers ────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const degToRad = (deg: number) => (deg * Math.PI) / 180;
// Bottom-semicircle polar: x uses sin(deg), y uses cos(deg). With
// CY pinned near the top of the viewBox, this places:
//   deg = -90 at (CX-r, CY)   ← leftmost
//   deg =   0 at (CX, CY+r)   ← bottommost
//   deg = +90 at (CX+r, CY)   ← rightmost
// Increasing deg traces clockwise visually along the bottom half.
const polar = (r: number, deg: number) => {
  const a = degToRad(deg);
  return { x: CX + r * Math.sin(a), y: CY + r * Math.cos(a) };
};

/** Annular-sector ("donut wedge") path used for each ring. Outer arc
 *  sweep = 0 and inner arc sweep = 1 because they traverse the same
 *  ring in OPPOSITE angular directions: outer goes startDeg → endDeg
 *  (math-CW = visually-CCW around the wheel centre, sweep=0); inner
 *  goes endDeg → startDeg back to close the wedge (math-CCW = visually
 *  CW, sweep=1). Using the wrong sweep flag here was the cause of the
 *  earlier "sectors drawn around random centres" rendering bug. */
function annularSectorPath(rIn: number, rOut: number, startDeg: number, endDeg: number): string {
  const p1 = polar(rOut, startDeg);
  const p2 = polar(rOut, endDeg);
  const p3 = polar(rIn, endDeg);
  const p4 = polar(rIn, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOut} ${rOut} 0 ${largeArc} 0 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rIn} ${rIn} 0 ${largeArc} 1 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

// ── Picks helpers ───────────────────────────────────────────────────────────

function clonePicks(p: Picks): Picks {
  return { t1: new Set(p.t1), t2: new Set(p.t2), t3: new Set(p.t3) };
}

/** Return a new Picks with the given key toggled at the given tier,
 *  honouring the cap and cascading deselects to descendants. Returns
 *  null when the toggle is rejected (cap hit on an add). */
function togglePick(picks: Picks, tier: 1 | 2 | 3, key: string): Picks | null {
  const next = clonePicks(picks);
  const set = tier === 1 ? next.t1 : tier === 2 ? next.t2 : next.t3;
  if (set.has(key)) {
    set.delete(key);
    if (tier === 1) {
      // Drop T2/T3 picks whose T1 ancestor is no longer chosen.
      for (const k of Array.from(next.t2)) {
        if (k.split(">")[0] === key) next.t2.delete(k);
      }
      for (const k of Array.from(next.t3)) {
        if (k.split(">")[0] === key) next.t3.delete(k);
      }
    } else if (tier === 2) {
      for (const k of Array.from(next.t3)) {
        const [k1, k2] = k.split(">");
        if (`${k1}>${k2}` === key) next.t3.delete(k);
      }
    }
    return next;
  }
  if (set.size >= MAX_PICKS_PER_TIER) return null;
  set.add(key);
  return next;
}

// ── Pill type ───────────────────────────────────────────────────────────────

type Pill = {
  /** Pick-key identifying this pill (for picks Set membership and tap
   *  routing). */
  key: string;
  /** What to render on the pill if it fits. */
  label: string;
  /** Tier this pill belongs to. */
  tier: 1 | 2 | 3;
  /** Geometry. */
  startDeg: number;
  endDeg: number;
  /** Whether the pill is currently in the picks set. */
  picked: boolean;
};

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  picks: Picks;
  /** Accepts either a Picks value or a `(prev) => next` updater. The
   *  updater form is what the wheel actually uses internally — it
   *  routes every toggle through the parent's setState's functional
   *  form so back-to-back taps can't race on a stale `picks` prop. */
  onPicksChange: (update: Picks | ((prev: Picks) => Picks)) => void;
  tree?: TreeDict;
  /** Render width in px; height is set 1:1 from this. */
  size?: number;
}

export default function FlavorWheel({ picks, onPicksChange, tree = CANONICAL_TREE, size = 320 }: Props) {
  // ── T1 ring — fixed 9 sectors at canonical positions ─────────────────────
  const t1Pills: Pill[] = useMemo(() => {
    const sectorWidth = SEMI_HALF_DEG / TIER_1_ORDER.length;
    return TIER_1_ORDER.map((name, i) => ({
      key: keyT1(name),
      // Display label honours T1_LABEL_OVERRIDES so long names like
      // "Green/Vegetative" / "Sour/Fermented" render as "Green" /
      // "Fermented" — fits the 20° wedge cleanly. The pick-key + the
      // sca_addresses join still use the canonical name.
      label: displayLabel(name, 1),
      tier: 1 as const,
      startDeg: SEMI_START_DEG + i * sectorWidth,
      endDeg: SEMI_START_DEG + (i + 1) * sectorWidth,
      picked: picks.t1.has(name),
    }));
  }, [picks.t1]);

  // ── T2 ring — semicircle 180°, divided among children of picked T1s ──────
  // Sectors share borders (no angular gap) — the dark stroke between
  // adjacent pills carries the visual separation, same as T1.
  const t2Pills: Pill[] = useMemo(() => {
    const children = listChildrenOfPicks(tree, picks.t1, 1);
    if (children.length === 0) return [];
    const slot = SEMI_HALF_DEG / children.length;
    return children.map((c, i) => {
      const k = keyT2(c.address[0], c.address[1] as string);
      return {
        key: k,
        label: displayLabel(c.child, 2),
        tier: 2 as const,
        startDeg: SEMI_START_DEG + i * slot,
        endDeg: SEMI_START_DEG + (i + 1) * slot,
        picked: picks.t2.has(k),
      };
    });
  }, [tree, picks.t1, picks.t2]);

  // ── T3 ring — semicircle 180°, divided among children of picked T2s ──────
  const t3Pills: Pill[] = useMemo(() => {
    const children = listChildrenOfPicks(tree, picks.t2, 2);
    if (children.length === 0) return [];
    const slot = SEMI_HALF_DEG / children.length;
    return children.map((c, i) => {
      const k = keyT3(c.address[0], c.address[1] as string, c.address[2] as string);
      return {
        key: k,
        label: displayLabel(c.child, 3),
        tier: 3 as const,
        startDeg: SEMI_START_DEG + i * slot,
        endDeg: SEMI_START_DEG + (i + 1) * slot,
        picked: picks.t3.has(k),
      };
    });
  }, [tree, picks.t2, picks.t3]);

  const handlePillPress = useCallback((pill: Pill) => {
    // Decide haptic optimistically against the current `picks` prop.
    // Off-by-one in a tight double-tap is invisible to the user; the
    // real state mutation below is race-free.
    const optimistic = togglePick(picks, pill.tier, pill.key);
    if (!optimistic) { haptics.warn(); return; }
    haptics.select();
    // Route the actual mutation through the parent's setState updater
    // form so back-to-back taps each see the LATEST picks (rather than
    // a stale prop snapshot). togglePick returns null on cap — fall
    // back to prev so the state stays a Picks even in the rejected
    // branch.
    onPicksChange((prev: Picks) => togglePick(prev, pill.tier, pill.key) ?? prev);
  }, [picks, onPicksChange]);

  /** Polar hit test. Per-Path onPress on react-native-svg's `Path`
   *  drops events after the SVG tree changes (the T2 ring blooming on
   *  the first T1 pick is enough to trigger it). Routing every tap
   *  through one outer `Pressable` + math removes the entire class of
   *  Svg hit-test quirks — the press event is just (locationX,
   *  locationY) and we work out which pill it hit. */
  const findPillAt = useCallback((locX: number, locY: number): Pill | null => {
    if (size <= 0) return null;
    const scale = VIEWBOX_W / size;
    const dx = locX * scale - CX;
    const dy = locY * scale - CY;
    // Bottom semicircle hangs DOWN from the flat edge at y=CY. Only
    // taps below the flat edge (dy > 0) hit any ring — anything
    // above is outside the wheel.
    if (dy < 0) return null;
    const r = Math.sqrt(dx * dx + dy * dy);
    // Convert (dx, dy) to the polar's deg convention: -90 leftmost,
    // 0 bottommost, +90 rightmost. Inverse of `polar()` — a point at
    // angle deg has sin(deg) = dx/r and cos(deg) = dy/r, so deg =
    // atan2(dx, dy).
    const angleSym = Math.atan2(dx, dy) * 180 / Math.PI;

    // Rings are attached: T1 [T1_INNER, T1_OUTER], T2 (T1_OUTER,
    // T2_OUTER], T3 (T2_OUTER, T3_OUTER]. Taps exactly on a shared
    // border fall into the inner ring (strict <=).
    let ring: Pill[] = [];
    if (r >= T1_INNER_R && r <= T1_OUTER_R) {
      ring = t1Pills;
    } else if (r > T2_INNER_R && r <= T2_OUTER_R) {
      ring = t2Pills;
    } else if (r > T3_INNER_R && r <= T3_OUTER_R) {
      ring = t3Pills;
    } else {
      return null;
    }
    for (const pill of ring) {
      if (angleSym >= pill.startDeg && angleSym < pill.endDeg) return pill;
    }
    return null;
  }, [size, t1Pills, t2Pills, t3Pills]);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    const pill = findPillAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (pill) handlePillPress(pill);
  }, [findPillAt, handlePillPress]);

  // The wheel's intrinsic aspect is 480×270 (semicircle viewBox); the
  // wrapping View + Pressable + Svg all use the same width and a height
  // computed from the ratio so taps on the empty bottom margin (none, in
  // a tight crop) and on actual rings line up exactly.
  const renderH = Math.round(size * WHEEL_HEIGHT_RATIO);

  return (
    <View style={[styles.wrap, { width: size, height: renderH }]}>
      <Pressable
        onPress={handlePress}
        style={{ width: size, height: renderH }}
        accessibilityRole="button"
        accessibilityLabel="Flavor wheel — tap a sector to pick"
      >
        <Svg width={size} height={renderH} viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
          {/* T1 sectors — annular wedges + RADIAL straight text
              (baseline along the spoke). T1 is the inner ring with
              narrow 20° wedges; radial uses the full 80px ring
              thickness for label length. */}
          <G>
            {t1Pills.map((pill) => {
              const d = annularSectorPath(T1_INNER_R, T1_OUTER_R, pill.startDeg, pill.endDeg);
              return (
                <G key={pill.key}>
                  <Path
                    d={d}
                    fill={pill.picked ? t.color.accent : t.color.bg}
                    stroke={t.color["text.primary"]}
                    strokeWidth={1.25}
                  />
                  {renderRadialLabel(pill, T1_INNER_R, T1_OUTER_R)}
                </G>
              );
            })}
          </G>

          {/* T2 sectors — wedges + CURVED text along the centreline
              arc. Each glyph is positioned at its own angular
              offset and rotated to its local tangent, so the line
              of text follows the ring's circle. */}
          <G>
            {t2Pills.map((pill) => {
              const d = annularSectorPath(T2_INNER_R, T2_OUTER_R, pill.startDeg, pill.endDeg);
              const arcDeg = pill.endDeg - pill.startDeg;
              return (
                <G key={pill.key}>
                  <Path
                    d={d}
                    fill={pill.picked ? t.color.accent : t.color.bg}
                    stroke={t.color["text.primary"]}
                    strokeWidth={1.25}
                  />
                  {arcDeg > 6 ? renderTangentialLabel(pill, T2_INNER_R, T2_OUTER_R) : null}
                </G>
              );
            })}
          </G>

          {/* T3 sectors — same recipe as T2, one ring further out. */}
          <G>
            {t3Pills.map((pill) => {
              const d = annularSectorPath(T3_INNER_R, T3_OUTER_R, pill.startDeg, pill.endDeg);
              const arcDeg = pill.endDeg - pill.startDeg;
              return (
                <G key={pill.key}>
                  <Path
                    d={d}
                    fill={pill.picked ? t.color.accent : t.color.bg}
                    stroke={t.color["text.primary"]}
                    strokeWidth={1.25}
                  />
                  {arcDeg > 6 ? renderTangentialLabel(pill, T3_INNER_R, T3_OUTER_R) : null}
                </G>
              );
            })}
          </G>
        </Svg>
      </Pressable>
    </View>
  );
}

/** Trim a label to fit by character count, with an ellipsis if cut. */
function shortLabel(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

/** RADIAL straight-text label — used by T1 only. Baseline runs along
 *  the spoke (perpendicular to the arc tangent), rotation clamped to
 *  [-90°, 90°] so glyphs stay upright on every position around the
 *  wheel. Truncation bounded by ring thickness. */
function renderRadialLabel(
  pill: Pill,
  ringInner: number,
  ringOuter: number,
): any {
  const fill = pill.picked ? t.color["text.on-dark"] : t.color["text.primary"];
  const PX_PER_CHAR = 6;
  const midDeg = (pill.startDeg + pill.endDeg) / 2;
  const midR = (ringInner + ringOuter) / 2;
  const midPoint = polar(midR, midDeg);

  let rotDeg = (Math.atan2(
    Math.cos(degToRad(midDeg)),
    Math.sin(degToRad(midDeg)),
  ) * 180) / Math.PI;
  if (rotDeg > 90) rotDeg -= 180;
  else if (rotDeg < -90) rotDeg += 180;

  const ringThickness = ringOuter - ringInner;
  const maxChars = Math.max(3, Math.floor(ringThickness / PX_PER_CHAR));

  return (
    <SvgText
      x={midPoint.x}
      y={midPoint.y}
      fontSize={11}
      fontFamily={t.font["body.semibold"]}
      fill={fill}
      textAnchor="middle"
      alignmentBaseline="middle"
      transform={`rotate(${rotDeg} ${midPoint.x} ${midPoint.y})`}
    >
      {shortLabel(pill.label, maxChars)}
    </SvgText>
  );
}

/** TANGENTIAL straight-text label for T2/T3 — single `<SvgText>`
 *  per label rendered as one element so the font's kerning table
 *  applies between adjacent glyphs (no manual `PX_PER_CHAR` tuning,
 *  no per-glyph spacing artifacts).
 *
 *  The element sits at the sector midpoint with textAnchor=middle,
 *  rotated so its baseline aligns with the arc tangent at that
 *  point. The text is a CHORD across the sector — for typical
 *  30°–90° T2/T3 sectors the chord and the arc are visually close
 *  near the midpoint (the divergence grows toward the endpoints,
 *  but typical labels don't extend far enough to diverge much).
 *  Trade-off: lose the visible curve in exchange for proper
 *  kerning, which is the readability win.
 *
 *  Truncation by chord length so labels never extend past the
 *  sector edges. */
function renderTangentialLabel(
  pill: Pill,
  ringInner: number,
  ringOuter: number,
): any {
  const fill = pill.picked ? t.color["text.on-dark"] : t.color["text.primary"];
  // Approximate average glyph width for Inter SemiBold at fontSize
  // 11 — used only to bound truncation, not for inter-glyph spacing
  // (the SvgText engine handles that itself).
  const PX_PER_CHAR = 6;
  const midDeg = (pill.startDeg + pill.endDeg) / 2;
  const midR = (ringInner + ringOuter) / 2;
  const midPoint = polar(midR, midDeg);

  const arcDeg = pill.endDeg - pill.startDeg;
  const chordPx = 2 * midR * Math.sin((arcDeg * Math.PI / 180) / 2);
  const maxChars = Math.max(3, Math.floor(chordPx / PX_PER_CHAR));

  return (
    <SvgText
      x={midPoint.x}
      y={midPoint.y}
      fontSize={11}
      fontFamily={t.font["body.semibold"]}
      fill={fill}
      textAnchor="middle"
      alignmentBaseline="middle"
      transform={`rotate(${-midDeg} ${midPoint.x} ${midPoint.y})`}
    >
      {shortLabel(pill.label, maxChars)}
    </SvgText>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
  },
});
