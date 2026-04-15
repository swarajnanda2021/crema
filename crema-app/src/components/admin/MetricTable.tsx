/**
 * CRUD Utopia — all visual values from design-tokens via useTokens.
 * See CRUD_UTOPIA.md at repo root.
 *
 * MetricTable — simple ranked rows (rank, label, optional sublabel, value).
 * Used for Top-N lists: top cafés by stamps, top-clicked products, top
 * followed roasters. Mirrors the browse-page roaster-list row styling.
 */

import { View, Text, StyleSheet } from "react-native";

import { t } from "../../tokens/useTokens";

export interface MetricRow {
  label: string;
  sub?: string | null;
  value: string | number;
}

interface MetricTableProps {
  title: string;
  rows: MetricRow[];
  /** Column header shown above the value column (e.g. "Clicks"). */
  valueHeader?: string;
  emptyLabel?: string;
}

export default function MetricTable({
  title,
  rows,
  valueHeader,
  emptyLabel = "No data yet.",
}: MetricTableProps) {
  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        {valueHeader ? <Text style={s.valueHeader}>{valueHeader}</Text> : null}
      </View>
      {rows.length === 0 ? (
        <Text style={s.empty}>{emptyLabel}</Text>
      ) : (
        rows.map((row, idx) => (
          <View key={`${row.label}-${idx}`} style={s.row}>
            <Text style={s.rank}>{String(idx + 1).padStart(2, "0")}</Text>
            <View style={s.labelCol}>
              <Text style={s.label} numberOfLines={1}>
                {row.label}
              </Text>
              {row.sub ? (
                <Text style={s.sub} numberOfLines={1}>
                  {row.sub}
                </Text>
              ) : null}
            </View>
            <Text style={s.value}>{row.value}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    flex: 1,
    minWidth: 280,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: t.spacing.md,
    marginBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueHeader: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.sm,
    gap: t.spacing.md,
  },
  rank: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    minWidth: 22,
  },
  labelCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  sub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  value: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    minWidth: 40,
    textAlign: "right",
  },
  empty: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    paddingVertical: t.spacing.md,
  },
});
