/**
 * BrewMethodCard — Phase 1 §2.5 roaster-submitted recipe card.
 *
 * Sits alongside user-submitted tasting-note cards in the product
 * carousel. Distinguished by:
 *   - Dark card surface (roaster voice, not user voice)
 *   - Method header with a small "By roaster" label
 *   - Method-specific field layout (espresso: dose/yield/ratio/time/
 *     temp/grind; pour-over: dose/water/bloom/brew-time/grind; etc.)
 */

import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Path, G } from "react-native-svg";
import { t, cardShadow, makeStyles } from "../tokens/useTokens";
import type { BrewMethod, BrewMethodKind } from "../resources/types";

interface Props {
  brew: BrewMethod;
  width?: number;
  height?: number;
}

const METHOD_LABELS: Record<BrewMethodKind, string> = {
  espresso: "Espresso",
  pour_over: "Pour Over",
  aeropress: "AeroPress",
  french_press: "French Press",
  cold_brew: "Cold Brew",
  moka: "Moka Pot",
  other: "Recipe",
};

// Which fields are surfaced per method. Unknown methods fall through
// to the full set. The card renders whatever is non-null from the
// method's whitelist plus freeform notes at the bottom.
const METHOD_FIELD_ORDER: Record<BrewMethodKind, Array<keyof BrewMethod>> = {
  espresso: ["dose_grams", "yield_grams", "ratio", "brew_time_secs", "water_temp_celsius", "grind_setting"],
  pour_over: ["dose_grams", "water_ml", "bloom_secs", "brew_time_secs", "water_temp_celsius", "grind_size"],
  aeropress: ["dose_grams", "water_ml", "brew_time_secs", "water_temp_celsius", "grind_size"],
  french_press: ["dose_grams", "water_ml", "brew_time_secs", "water_temp_celsius", "grind_size"],
  cold_brew: ["dose_grams", "water_ml", "ratio", "brew_time_secs", "grind_size"],
  moka: ["dose_grams", "water_ml", "grind_size"],
  other: ["dose_grams", "yield_grams", "water_ml", "ratio", "brew_time_secs", "bloom_secs", "water_temp_celsius", "grind_size", "grind_setting"],
};

const FIELD_LABELS: Partial<Record<keyof BrewMethod, string>> = {
  dose_grams: "Dose",
  yield_grams: "Yield",
  water_ml: "Water",
  ratio: "Ratio",
  brew_time_secs: "Time",
  bloom_secs: "Bloom",
  water_temp_celsius: "Temp",
  grind_size: "Grind",
  grind_setting: "Setting",
};

function formatField(key: keyof BrewMethod, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (key) {
    case "dose_grams":
    case "yield_grams":
      return `${value}g`;
    case "water_ml":
      return `${value}ml`;
    case "brew_time_secs":
    case "bloom_secs": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      if (n < 90) return `${n}s`;
      const m = Math.floor(n / 60);
      const s = n % 60;
      return s === 0 ? `${m}m` : `${m}m ${s}s`;
    }
    case "water_temp_celsius":
      return `${value}°C`;
    default:
      return String(value);
  }
}

export default function BrewMethodCard({ brew, width = 240, height = 372 }: Props) {
  const kind = (brew.method as BrewMethodKind) || "other";
  const order = METHOD_FIELD_ORDER[kind] ?? METHOD_FIELD_ORDER.other;
  const s = useStyles();

  const rows = order
    .map((k) => {
      const v = formatField(k, brew[k] as any);
      return v ? { key: k, label: FIELD_LABELS[k] ?? String(k), value: v } : null;
    })
    .filter((r): r is { key: keyof BrewMethod; label: string; value: string } => r !== null);

  return (
    <View style={[s.card, { width, height }]}>
      {/* Decorative steam + pour motif. Placeholder art — reads as
         "something brewing" without needing a specific illustration. */}
      <View style={s.artWrap} pointerEvents="none">
        <Svg width={72} height={64} viewBox="0 0 72 64" fill="none">
          <G>
            {/* Three wavy steam curls rising from an invisible baseline */}
            <Path
              d="M16 8 Q20 16 16 24 Q12 32 16 40"
              stroke="#FAF8F0" strokeOpacity={0.5}
              strokeWidth={1.4} strokeLinecap="round" fill="none"
            />
            <Path
              d="M36 2 Q40 12 36 22 Q32 32 36 42"
              stroke="#FAF8F0" strokeOpacity={0.75}
              strokeWidth={1.4} strokeLinecap="round" fill="none"
            />
            <Path
              d="M56 8 Q60 16 56 24 Q52 32 56 40"
              stroke="#FAF8F0" strokeOpacity={0.5}
              strokeWidth={1.4} strokeLinecap="round" fill="none"
            />
            {/* Cup rim — a thin horizontal line with subtle cup curvature */}
            <Path
              d="M10 52 Q36 58 62 52"
              stroke="#FAF8F0" strokeOpacity={0.35}
              strokeWidth={1.2} strokeLinecap="round" fill="none"
            />
            {/* Small droplet in the middle, suggesting a pour */}
            <Circle cx={36} cy={48} r={1.6} fill="#FAF8F0" opacity={0.55} />
          </G>
        </Svg>
      </View>

      <View style={s.topStrip}>
        <Text style={s.kindLabel}>{METHOD_LABELS[kind]}</Text>
        <Text style={s.byLine}>By roaster</Text>
      </View>

      <View style={s.fieldsArea}>
        {rows.map((r) => (
          <View key={String(r.key)} style={s.fieldRow}>
            <Text style={s.fieldLabel}>{r.label}</Text>
            <Text style={s.fieldValue}>{r.value}</Text>
          </View>
        ))}
        {rows.length === 0 && (
          <Text style={s.emptyNote}>Recipe details coming soon</Text>
        )}
      </View>

      {brew.notes ? (
        <View style={s.notesArea}>
          <Text style={s.notesText} numberOfLines={4}>{brew.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color["text.primary"],
    borderRadius: 5,
    padding: 18,
    justifyContent: "flex-start",
    overflow: "hidden",
    shadowColor: t.shadow.card.color,
    shadowOffset: { width: t.shadow.card.offset[0], height: t.shadow.card.offset[1] },
    shadowOpacity: t.shadow.card.opacity,
    shadowRadius: t.shadow.card.radius,
    elevation: t.shadow.card.elevation,
  } as any,
  artWrap: {
    position: "absolute",
    top: -6,
    right: -6,
    opacity: 0.9,
  } as any,
  topStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    marginBottom: 14,
    marginTop: 32,
  } as any,
  kindLabel: {
    fontFamily: t.font.display,
    fontSize: 20,
    color: t.color["text.on-cta"],
    letterSpacing: 0.2,
  },
  byLine: {
    fontFamily: t.font["body.medium"],
    fontSize: 10,
    color: "rgba(250,248,240,0.55)",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  } as any,
  fieldsArea: { gap: 10 } as any,
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  } as any,
  fieldLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: 11,
    color: "rgba(250,248,240,0.6)",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  } as any,
  fieldValue: {
    fontFamily: t.font["body.semibold"],
    fontSize: 16,
    color: t.color["text.on-cta"],
  },
  emptyNote: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: "rgba(250,248,240,0.55)",
    fontStyle: "italic",
  } as any,
  notesArea: {
    marginTop: "auto" as any,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  notesText: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: "rgba(250,248,240,0.75)",
    lineHeight: 17,
  } as any,
}));
