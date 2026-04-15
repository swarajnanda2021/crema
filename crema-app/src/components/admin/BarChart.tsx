/**
 * CRUD Utopia — ggplot-style bar chart. Clean plot area, faint horizontal
 * gridlines, accent-coloured bars, hover-to-reveal value tooltips. Built
 * with react-native-svg so it renders identically on web and native.
 * All colors / fonts / radii from design-tokens via useTokens.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";

import { t } from "../../tokens/useTokens";
import InfoModal, { InfoButton } from "./InfoModal";

export interface BarDatum {
  label: string;
  value: number;
  sub?: string | null;
}

interface BarChartProps {
  title: string;
  data: BarDatum[];
  /** Y-axis label (e.g. "Clicks", "Posts"). */
  valueLabel?: string;
  /** Height of the plot area (px). Total card is slightly taller. */
  height?: number;
  /** Optional per-bar secondary metric shown in tooltip (e.g. "27 of 33"). */
  showRatio?: boolean;
  /** Explanation shown in a floating modal when the "?" icon is tapped. */
  info?: string;
}

export default function BarChart({
  title,
  data,
  valueLabel = "Value",
  height = 200,
  showRatio = false,
  info,
}: BarChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const {
    max,
    ticks,
    plotWidth,
    plotHeight,
    barWidth,
    barGap,
    leftPad,
    topPad,
    bottomPad,
    total,
  } = useMemo(() => {
    const total = data.reduce((acc, d) => acc + d.value, 0);
    const values = data.map((d) => d.value);
    const rawMax = Math.max(1, ...values);
    // Round up to a nice tick value
    const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const niceMax = Math.ceil(rawMax / pow) * pow;
    const leftPad = 42;
    const rightPad = 14;
    const topPad = 12;
    const bottomPad = 38;
    const chartW = 520;
    const plotWidth = chartW - leftPad - rightPad;
    const plotHeight = height;
    const gap = 10;
    const n = data.length;
    const barWidth = n > 0 ? Math.max(18, (plotWidth - gap * (n - 1)) / n) : 0;
    const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
    return {
      max: niceMax,
      ticks,
      plotWidth,
      plotHeight,
      barWidth,
      barGap: gap,
      leftPad,
      topPad,
      bottomPad,
      total,
    };
  }, [data, height]);

  const chartW = 520;
  const chartH = topPad + plotHeight + bottomPad;

  return (
    <>
    <View style={s.wrap}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>{title}</Text>
          {info ? (
            <InfoButton
              onPress={() => setShowInfo(true)}
              accessibilityLabel={`What does "${title}" mean?`}
            />
          ) : null}
        </View>
        {valueLabel ? (
          <Text style={s.valueHeader}>{valueLabel}</Text>
        ) : null}
      </View>

      <View style={{ width: "100%", alignItems: "flex-start" } as any}>
        <Svg width="100%" height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
          {/* Y gridlines + tick labels */}
          {ticks.map((tickVal, i) => {
            const y = topPad + plotHeight - (tickVal / max) * plotHeight;
            return (
              <G key={`tick-${i}`}>
                <Line
                  x1={leftPad}
                  x2={leftPad + plotWidth}
                  y1={y}
                  y2={y}
                  stroke={t.color["border.light"]}
                  strokeWidth={1}
                />
                <SvgText
                  x={leftPad - 8}
                  y={y + 4}
                  fontSize={10}
                  fontFamily={t.font["body.medium"]}
                  fill={t.color["text.muted"]}
                  textAnchor="end"
                >
                  {formatTick(tickVal)}
                </SvgText>
              </G>
            );
          })}

          {/* Axis (x) */}
          <Line
            x1={leftPad}
            x2={leftPad + plotWidth}
            y1={topPad + plotHeight}
            y2={topPad + plotHeight}
            stroke={t.color.divider}
            strokeWidth={1}
          />

          {/* Bars */}
          {data.map((d, i) => {
            const barH = max > 0 ? (d.value / max) * plotHeight : 0;
            const x = leftPad + i * (barWidth + barGap);
            const y = topPad + plotHeight - barH;
            const active = hoverIdx === i;
            return (
              <G key={`bar-${i}`}>
                <Rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(1, barH)}
                  rx={3}
                  fill={active ? t.color["text.primary"] : t.color.accent}
                  {...(Platform.OS === "web"
                    ? ({
                        onMouseEnter: () => setHoverIdx(i),
                        onMouseLeave: () => setHoverIdx(null),
                      } as any)
                    : {})}
                />
                {/* x-axis label */}
                <SvgText
                  x={x + barWidth / 2}
                  y={topPad + plotHeight + 16}
                  fontSize={10}
                  fontFamily={t.font["body.medium"]}
                  fill={t.color["text.secondary"]}
                  textAnchor="middle"
                >
                  {truncate(d.label, 14)}
                </SvgText>
                {/* Hover tooltip */}
                {active ? (
                  <G>
                    <Rect
                      x={x + barWidth / 2 - 58}
                      y={y - 36}
                      width={116}
                      height={28}
                      rx={4}
                      fill={t.color["text.primary"]}
                    />
                    <SvgText
                      x={x + barWidth / 2}
                      y={y - 18}
                      fontSize={11}
                      fontFamily={t.font["body.semibold"]}
                      fill={t.color["text.on-dark"]}
                      textAnchor="middle"
                    >
                      {d.label}: {d.value}
                      {showRatio && total > 0
                        ? `  (${Math.round((d.value / total) * 100)}%)`
                        : ""}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}
        </Svg>
        <Text style={s.hint}>Hover a bar to see its value.</Text>
      </View>
    </View>
    {info ? (
      <InfoModal
        visible={showInfo}
        title={title}
        body={info}
        onClose={() => setShowInfo(false)}
      />
    ) : null}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTick(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrap: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    flex: 1,
    minWidth: 320,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: t.spacing.md,
    marginBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
    gap: t.spacing.md,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flex: 1,
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
  hint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: t.spacing.xs,
  },
});
