/**
 * FlavorWheel — full-circle single-select pick surface for Discover.
 *
 * One ring of N sectors arranged around a full circle. Tap a sector to
 * pick it; tap again to clear; tap another to switch (radio behavior).
 * Reads its sector list from props so the host can hot-swap schemas
 * (admin Catalog Ops > Schema Manager flips active row → wheel
 * re-renders).
 *
 * Pure presentation: no fetch, no business state. The host owns
 * `selected` and re-renders when it changes.
 */
import { useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable, type GestureResponderEvent } from "react-native";
import Svg, { Path, G, Text as SvgText } from "react-native-svg";
import { t, makeStyles } from "../tokens/useTokens";
import * as haptics from "../utils/haptics";
import type { FlavorSchema, SelectedFlavor } from "../utils/scaTree";

// ── Geometry ────────────────────────────────────────────────────────────────

// viewBox is a square so the wheel renders 1:1 inside its container.
// CX/CY at the centre of the square; sectors fill 360° around it.
const VIEWBOX = 480;
const CX = 240;
const CY = 240;

const RING_INNER_R = 90;   // radius of the bullseye centre disc
const RING_OUTER_R = 230;  // outer edge of the wheel

/** Aspect ratio = 1 (square). Caller multiplies its `size` by this to
 *  get the SVG height. Kept as an export for parity with the prior API
 *  the modal still imports. */
export const WHEEL_HEIGHT_RATIO = 1;

/** Width and height of the inscribed square inside the bullseye disc.
 *  Used by the modal to size the count + "coffees" overlay so it never
 *  overflows into the rings. The largest axis-aligned square inside a
 *  circle of radius R has side R·√2. Returned in screen px. */
export function bullseyeBoxPx(wheelSize: number): { w: number; h: number; cy: number } {
  const scale = wheelSize / VIEWBOX;
  const side = RING_INNER_R * Math.SQRT2 * scale;
  return {
    w: side,
    h: side,
    cy: CY * scale,
  };
}

const TAU = Math.PI * 2;
const degToRad = (deg: number) => (deg * Math.PI) / 180;

/** Polar → cartesian. deg=0 is 12 o'clock; clockwise positive. */
function polar(r: number, deg: number) {
  const a = degToRad(deg - 90); // shift so 0° = top instead of right
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

/** Annular-sector ("donut wedge") path. */
function annularSectorPath(rIn: number, rOut: number, startDeg: number, endDeg: number): string {
  const p1 = polar(rOut, startDeg);
  const p2 = polar(rOut, endDeg);
  const p3 = polar(rIn, endDeg);
  const p4 = polar(rIn, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOut} ${rOut} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rIn} ${rIn} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

// ── Pill type ──────────────────────────────────────────────────────────────

type Sector = {
  name: string;
  startDeg: number;
  endDeg: number;
  picked: boolean;
};

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  schema: FlavorSchema;
  selected: SelectedFlavor;
  onSelectedChange: (next: SelectedFlavor) => void;
  /** Render width in px; height is the same (square aspect). */
  size?: number;
}

export default function FlavorWheel({ schema, selected, onSelectedChange, size = 320 }: Props) {
  const styles = useStyles();
  // Build sectors evenly around 360° in declaration order.
  const sectors: Sector[] = useMemo(() => {
    const names = schema.sectors.map((s) => s.name);
    const slot = 360 / names.length;
    return names.map((name, i) => ({
      name,
      startDeg: i * slot,
      endDeg: (i + 1) * slot,
      picked: name === selected,
    }));
  }, [schema, selected]);

  const handleSectorPress = useCallback((name: string) => {
    if (name === selected) {
      // Tapping the picked sector clears it.
      haptics.tap();
      onSelectedChange(null);
      return;
    }
    haptics.select();
    onSelectedChange(name);
  }, [selected, onSelectedChange]);

  /** Polar hit test. Tap → (locX, locY) → polar (r, deg) → which
   *  sector. Routing every tap through one outer Pressable instead of
   *  per-Path onPress avoids react-native-svg's hit-test quirks with
   *  re-rendered trees. */
  const findSectorAt = useCallback((locX: number, locY: number): Sector | null => {
    if (size <= 0) return null;
    const scale = VIEWBOX / size;
    const dx = locX * scale - CX;
    const dy = locY * scale - CY;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < RING_INNER_R || r > RING_OUTER_R) return null;
    // atan2(y, x) returns radians from +x axis CCW. Convert to "0° at
    // top, clockwise positive" so it matches the sector layout.
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    if (deg >= 360) deg -= 360;
    for (const sector of sectors) {
      if (deg >= sector.startDeg && deg < sector.endDeg) return sector;
    }
    return null;
  }, [size, sectors]);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    const sector = findSectorAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (sector) handleSectorPress(sector.name);
  }, [findSectorAt, handleSectorPress]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Pressable
        onPress={handlePress}
        style={{ width: size, height: size }}
        accessibilityRole="button"
        accessibilityLabel="Flavor wheel — tap a sector to filter"
      >
        <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
          <G>
            {sectors.map((sector) => {
              const d = annularSectorPath(RING_INNER_R, RING_OUTER_R, sector.startDeg, sector.endDeg);
              return (
                <G key={sector.name}>
                  <Path
                    d={d}
                    fill={sector.picked ? t.color.accent : t.color.bg}
                    stroke={t.color["text.primary"]}
                    strokeWidth={1.25}
                  />
                  {renderRadialLabel(sector)}
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

/** RADIAL straight-text label. Baseline runs along the spoke
 *  (perpendicular to the arc tangent), rotation clamped to [-90°, 90°]
 *  so glyphs stay upright at every position. Truncation budget bounded
 *  by ring thickness. */
function renderRadialLabel(sector: Sector): any {
  const fill = sector.picked ? t.color["text.on-cta"] : t.color["text.primary"];
  const PX_PER_CHAR = 6;
  const midDeg = (sector.startDeg + sector.endDeg) / 2;
  const midR = (RING_INNER_R + RING_OUTER_R) / 2;
  const midPoint = polar(midR, midDeg);

  // Spoke direction in math coords: a label at angle θ (measured from
  // 12 o'clock, clockwise) has its spoke pointing outward at θ. In the
  // SVG transform we want the text rotated so its baseline lies along
  // that spoke and its "top" faces the centre. Math:
  //   rotation = midDeg - 90  (so 0°=top renders horizontally)
  //   then clamp to [-90, 90] so glyphs never read upside-down.
  let rotDeg = midDeg - 90;
  if (rotDeg > 90) rotDeg -= 180;
  else if (rotDeg < -90) rotDeg += 180;

  const ringThickness = RING_OUTER_R - RING_INNER_R;
  const maxChars = Math.max(3, Math.floor(ringThickness / PX_PER_CHAR));

  return (
    <SvgText
      x={midPoint.x}
      y={midPoint.y}
      fontSize={13}
      fontFamily={t.font["body.semibold"]}
      fill={fill}
      textAnchor="middle"
      alignmentBaseline="middle"
      transform={`rotate(${rotDeg} ${midPoint.x} ${midPoint.y})`}
    >
      {shortLabel(sector.name, maxChars)}
    </SvgText>
  );
}

const useStyles = makeStyles((_t) => ({
  wrap: {
    alignSelf: "center",
  },
}));
