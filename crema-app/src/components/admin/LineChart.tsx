/**
 * CRUD Utopia — ggplot-style line chart. Clean plot area, faint horizontal
 * gridlines, accent-coloured line + filled dots, hover tooltip at each
 * data point. Built with react-native-svg so it renders on web and native.
 * All visual values from design-tokens via useTokens.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { t, makeStyles } from "../../tokens/useTokens";
import InfoModal, { InfoButton } from "./InfoModal";

export interface LineDatum {
  label: string;
  value: number;
}

interface LineChartProps {
  title: string;
  data: LineDatum[];
  valueLabel?: string;
  height?: number;
  /** Explanation shown in a floating modal when the "?" icon is tapped. */
  info?: string;
}

export default function LineChart({
  title,
  data,
  valueLabel = "Value",
  height = 200,
  info,
}: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const s = useStyles();

  const {
    plotWidth,
    plotHeight,
    leftPad,
    topPad,
    bottomPad,
    ticks,
    max,
    stepX,
    pointXs,
    pointYs,
    pathD,
    xLabelIdxs,
  } = useMemo(() => {
    const values = data.map((d) => d.value);
    const rawMax = Math.max(1, ...values);
    const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const niceMax = Math.ceil(rawMax / pow) * pow;
    const leftPad = 42;
    const rightPad = 18;
    const topPad = 14;
    const bottomPad = 38;
    const chartW = 520;
    const plotWidth = chartW - leftPad - rightPad;
    const plotHeight = height;
    const n = data.length;
    const stepX = n > 1 ? plotWidth / (n - 1) : 0;
    const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];

    const pointXs: number[] = [];
    const pointYs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = leftPad + i * stepX;
      const y =
        topPad + plotHeight - (data[i].value / (niceMax || 1)) * plotHeight;
      pointXs.push(x);
      pointYs.push(y);
    }
    const pathD = pointXs
      .map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${pointYs[i]}`)
      .join(" ");

    // Pick ~6 x-axis labels spaced evenly — first and last always included
    // so readers can anchor the date range at a glance.
    const MAX_LABELS = 6;
    let xLabelIdxs: number[];
    if (n <= MAX_LABELS) {
      xLabelIdxs = Array.from({ length: n }, (_, i) => i);
    } else {
      const stride = (n - 1) / (MAX_LABELS - 1);
      const seen = new Set<number>();
      for (let k = 0; k < MAX_LABELS; k++) {
        seen.add(Math.round(k * stride));
      }
      xLabelIdxs = [...seen].sort((a, b) => a - b);
    }

    return {
      plotWidth,
      plotHeight,
      leftPad,
      topPad,
      bottomPad,
      ticks,
      max: niceMax,
      stepX,
      pointXs,
      pointYs,
      pathD,
      xLabelIdxs,
    };
  }, [data, height]);

  const chartW = 520;
  const chartH = topPad + plotHeight + bottomPad;

  const isEmpty = data.length === 0;

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
        {valueLabel ? <Text style={s.valueHeader}>{valueLabel}</Text> : null}
      </View>

      {isEmpty ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyText}>No activity yet.</Text>
        </View>
      ) : (
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

          {/* X axis baseline */}
          <Line
            x1={leftPad}
            x2={leftPad + plotWidth}
            y1={topPad + plotHeight}
            y2={topPad + plotHeight}
            stroke={t.color.divider}
            strokeWidth={1}
          />

          {/* X axis labels — spaced to ~6 evenly across the range */}
          {xLabelIdxs.map((i) => (
            <SvgText
              key={`xl-${i}`}
              x={pointXs[i]}
              y={topPad + plotHeight + 18}
              fontSize={10}
              fontFamily={t.font["body.medium"]}
              fill={t.color["text.secondary"]}
              textAnchor="middle"
            >
              {data[i].label}
            </SvgText>
          ))}

          {/* Line */}
          <Path
            d={pathD}
            fill="none"
            stroke={t.color.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Dots + hover targets */}
          {data.map((d, i) => {
            const active = hoverIdx === i;
            const r = active ? 6 : 4;
            return (
              <G key={`pt-${i}`}>
                <Circle
                  cx={pointXs[i]}
                  cy={pointYs[i]}
                  r={r}
                  fill={t.color["card.front"]}
                  stroke={active ? t.color["text.primary"] : t.color.accent}
                  strokeWidth={2}
                />
                {/* Invisible wider hit area */}
                <Circle
                  cx={pointXs[i]}
                  cy={pointYs[i]}
                  r={14}
                  fill="transparent"
                  {...(Platform.OS === "web"
                    ? ({
                        onMouseEnter: () => setHoverIdx(i),
                        onMouseLeave: () => setHoverIdx(null),
                      } as any)
                    : {})}
                />
                {active ? (() => {
                  // Boundary-aware positioning:
                  //  • Horizontal: clamp so tooltip never leaves plot area.
                  //  • Vertical: default above the point; flip below when
                  //    too close to the top.
                  const TIP_W = 120;
                  const TIP_H = 26;
                  const xLeft = Math.max(
                    leftPad,
                    Math.min(
                      pointXs[i] - TIP_W / 2,
                      leftPad + plotWidth - TIP_W,
                    ),
                  );
                  const above = pointYs[i] - TIP_H - 10 >= topPad;
                  const yTop = above
                    ? pointYs[i] - TIP_H - 10
                    : pointYs[i] + 10;
                  return (
                    <G>
                      <Rect
                        x={xLeft}
                        y={yTop}
                        width={TIP_W}
                        height={TIP_H}
                        rx={4}
                        fill={t.color["text.primary"]}
                      />
                      <SvgText
                        x={xLeft + TIP_W / 2}
                        y={yTop + 17}
                        fontSize={11}
                        fontFamily={t.font["body.semibold"]}
                        fill={t.color["text.on-cta"]}
                        textAnchor="middle"
                      >
                        {d.label}: {d.value}
                      </SvgText>
                    </G>
                  );
                })() : null}
              </G>
            );
          })}
        </Svg>
        <Text style={s.hint}>Hover a point to see its value.</Text>
      </View>
      )}
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

function formatTick(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const useStyles = makeStyles((t) => ({
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
  emptyBox: {
    paddingVertical: t.spacing["3xl"],
    alignItems: "center",
  },
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  },
}));
