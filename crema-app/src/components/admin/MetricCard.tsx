/**
 * CRUD Utopia — all colors, fonts, spacings from design-tokens via useTokens.
 * No hex literals, no magic numbers. See CRUD_UTOPIA.md at repo root.
 *
 * MetricCard — single-value tile (Canela big number + Inter uppercase label,
 * card.front bg, border.light border, matches CoffeeCard info section).
 * Optional "?" info button in the top-right opens a floating modal
 * explaining what the metric represents.
 */

import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import { t } from "../../tokens/useTokens";
import InfoModal, { InfoButton } from "./InfoModal";

interface MetricCardProps {
  label: string;
  value: string | number;
  /** Optional sub-line below the value (e.g. "of 247 total", "+12% WoW"). */
  hint?: string;
  /** Accent tone. "default" is primary text; "positive" green; "negative" rust. */
  tone?: "default" | "positive" | "negative";
  /** When true the card spans the full grid row (e.g. headline metric). */
  wide?: boolean;
  /** Explanation shown in a floating modal when the "?" icon is tapped. */
  info?: string;
}

export default function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  wide = false,
  info,
}: MetricCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const valueColor =
    tone === "positive"
      ? t.color["accent.positive"]
      : tone === "negative"
      ? t.color["accent.cta"]
      : t.color["text.primary"];
  return (
    <>
      <View style={[s.card, wide && s.cardWide]}>
        <View style={s.header}>
          <Text style={s.label} numberOfLines={2}>{label}</Text>
          {info ? (
            <InfoButton
              onPress={() => setShowInfo(true)}
              accessibilityLabel={`What does "${label}" mean?`}
            />
          ) : null}
        </View>
        <Text style={[s.value, { color: valueColor }]} numberOfLines={1}>
          {value}
        </Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      {info ? (
        <InfoModal
          visible={showInfo}
          title={label}
          body={info}
          onClose={() => setShowInfo(false)}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.lg,
    flex: 1,
    minWidth: 180,
    gap: t.spacing.sm,
  },
  cardWide: {
    flexBasis: "100%",
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
  },
  label: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
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
