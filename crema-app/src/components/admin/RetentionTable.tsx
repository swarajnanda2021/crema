/**
 * CRUD Utopia — all visual values from design-tokens via useTokens.
 * See CRUD_UTOPIA.md at repo root.
 *
 * RetentionTable — weekly cohort grid. Rows = signup week,
 * columns = D1 / D7 / D30 active-user retention (both absolute and %).
 * Heat-tone: percentages above 50% tint the cell with the accent (purple).
 */

import { View, Text, StyleSheet } from "react-native";

import { t } from "../../tokens/useTokens";
import type { RetentionCohort } from "../../resources/types";

interface RetentionTableProps {
  cohorts: RetentionCohort[];
}

function heatColor(pct: number): string {
  if (pct <= 0) return "transparent";
  // Linear alpha from 0% (clear) to 100% (full accent). Purple #D798DA.
  const clamped = Math.max(0, Math.min(100, pct));
  const alpha = (clamped / 100) * 0.35;
  return `rgba(215,152,218,${alpha.toFixed(2)})`;
}

export default function RetentionTable({ cohorts }: RetentionTableProps) {
  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <Text style={[s.headerCell, s.weekCol]}>Cohort</Text>
        <Text style={[s.headerCell, s.numCol]}>Signups</Text>
        <Text style={[s.headerCell, s.numCol]}>D1</Text>
        <Text style={[s.headerCell, s.numCol]}>D7</Text>
        <Text style={[s.headerCell, s.numCol]}>D30</Text>
      </View>
      {cohorts.length === 0 ? (
        <Text style={s.empty}>No cohorts yet.</Text>
      ) : (
        cohorts.map((c, idx) => (
          <View
            key={c.week}
            style={[s.row, idx < cohorts.length - 1 && s.rowDivider]}
          >
            <View style={s.weekCol}>
              <Text style={s.weekLabel}>
                {c.week_start || c.week}
              </Text>
              <Text style={s.weekSub}>Week {c.week.split("-")[1]}</Text>
            </View>
            <Text style={[s.numCell, s.numCol]}>{c.signups}</Text>
            <View
              style={[
                s.numCol,
                s.cohortCell,
                { backgroundColor: heatColor(c.d1_pct) },
              ]}
            >
              <Text style={s.numCell}>{c.d1}</Text>
              <Text style={s.pctCell}>{c.d1_pct.toFixed(0)}%</Text>
            </View>
            <View
              style={[
                s.numCol,
                s.cohortCell,
                { backgroundColor: heatColor(c.d7_pct) },
              ]}
            >
              <Text style={s.numCell}>{c.d7}</Text>
              <Text style={s.pctCell}>{c.d7_pct.toFixed(0)}%</Text>
            </View>
            <View
              style={[
                s.numCol,
                s.cohortCell,
                { backgroundColor: heatColor(c.d30_pct) },
              ]}
            >
              <Text style={s.numCell}>{c.d30}</Text>
              <Text style={s.pctCell}>{c.d30_pct.toFixed(0)}%</Text>
            </View>
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
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: t.spacing.sm,
    marginBottom: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  headerCell: {
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
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  weekCol: { flex: 1.3, paddingRight: t.spacing.md },
  numCol: { flex: 1, alignItems: "flex-end" } as any,
  weekLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  weekSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: 2,
  },
  numCell: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  pctCell: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    marginTop: 2,
  },
  cohortCell: {
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  empty: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    paddingVertical: t.spacing.md,
  },
});
