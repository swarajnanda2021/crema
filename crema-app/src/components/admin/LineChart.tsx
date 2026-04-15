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

import { t } from "../../tokens/useTokens";
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
        {valueLabel ? <Text style={s.valueHeader}>{valueLabel}</Text> : null}
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

          {/* X axis baseline */}
          <Line
            x1={leftPad}
            x2={leftPad + plotWidth}
            y1={topPad + plotHeight}
            y2={topPad + plotHeight}
            stroke={t.color.divider}
            strokeWidth={1}
          />

          {/* X axis labels */}
          {data.map((d, i) => (
            <SvgText
              key={`xl-${i}`}
              x={pointXs[i]}
              y={topPad + plotHeight + 18}
              fontSize={10}
              fontFamily={t.font["body.medium"]}
              fill={t.color["text.secondary"]}
              textAnchor="middle"
            >
              {d.label}
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
                {active ? (
                  <G>
                    <Rect
                      x={Math.min(pointXs[i] + 10, leftPad + plotWidth - 120)}
                      y={pointYs[i] - 28}
                      width={110}
                      height={26}
                      rx={4}
                      fill={t.color["text.primary"]}
                    />
                    <SvgText
                      x={Math.min(pointXs[i] + 10, leftPad + plotWidth - 120) + 10}
                      y={pointYs[i] - 11}
                      fontSize={11}
                      fontFamily={t.font["body.semibold"]}
                      fill={t.color["text.on-dark"]}
                    >
                      {d.label}: {d.value}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}
        </Svg>
        <Text style={s.hint}>Hover a point to see its value.</Text>
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

function formatTick(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
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
