/**
 * CRUD Utopia — all colors, fonts, spacings from design-tokens via useTokens.
 * No hex literals, no magic numbers. See CRUD_UTOPIA.md at repo root.
 *
 * MetricCard — single-value tile (Canela big number + Inter uppercase label,
 * card.front bg, border.light border, matches CoffeeCard info section).
 */

import { View, Text, StyleSheet } from "react-native";

import { t } from "../../tokens/useTokens";

interface MetricCardProps {
  label: string;
  value: string | number;
  /** Optional sub-line below the value (e.g. "of 247 total", "+12% WoW"). */
  hint?: string;
  /** Accent tone. "default" is primary text; "positive" green; "negative" rust. */
  tone?: "default" | "positive" | "negative";
  /** When true the card spans the full grid row (e.g. headline metric). */
  wide?: boolean;
}

export default function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  wide = false,
}: MetricCardProps) {
  const valueColor =
    tone === "positive"
      ? t.color["accent.positive"]
      : tone === "negative"
      ? t.color["accent.cta"]
      : t.color["text.primary"];
  return (
    <View style={[s.card, wide && s.cardWide]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.lg,
    flex: 1,
    minWidth: 180,
    gap: t.spacing.sm,
  },
  cardWide: {
    flexBasis: "100%",
  } as any,
  label: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontFamily: t.font.display,
    fontSize: 48,
    lineHeight: 54,
    color: t.color["text.primary"],
  },
  hint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
});
