/**
 * MetricSeriesModal — daily-chart drill-down for an admin dashboard
 * metric (§2.18).
 *
 * A metric `<Card>` in TractionDashboard wraps in a Pressable that
 * opens this modal with a metric key. The modal fetches
 * `/api/stats/series?key={key}` and renders the series in the
 * shared LineChart component. For metrics that don't have a series
 * defined on the backend yet, an empty state sits in place of the
 * chart so the modal remains useful — you still see the definition
 * + current value.
 *
 * Shell matches the site's floating-modal language (blur backdrop,
 * token overlay, Canela title) — same shape as the composer and
 * popularity modals.
 */

import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { X } from "lucide-react-native";

import { apiFetchRaw } from "../../api/client";
import { t } from "../../tokens/useTokens";
import LineChart from "./LineChart";

interface Props {
  visible: boolean;
  metricKey: string;
  label: string;
  /** Current headline value — rendered big under the title. */
  value: string | number;
  /** Optional one-line definition (reuses the `E` explanation map). */
  info?: string;
  onClose: () => void;
}

interface SeriesPoint { date: string; count: number; }

function prettyLabel(iso: string): string {
  // "2026-04-08" → "Apr 8" — matches the existing dashboard charts.
  const d = new Date(iso + "T00:00:00");
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  return `${mo} ${d.getDate()}`;
}

export default function MetricSeriesModal({ visible, metricKey, label, value, info, onClose }: Props) {
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !metricKey) return;
    let cancelled = false;
    setLoading(true);
    apiFetchRaw<any>(`/stats/series?key=${encodeURIComponent(metricKey)}&range=30d`)
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setSeries(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) setSeries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, metricKey]);

  const chartData = useMemo(
    () => series.map((p) => ({ label: prettyLabel(p.date), value: p.count })),
    [series],
  );

  // Prior-period delta: sum of the most recent half vs the prior
  // half. Cheap proxy for "trending up" — not a true WoW when the
  // series is < 14 days, but at that length the number isn't
  // meaningful anyway.
  const delta = useMemo(() => {
    if (series.length < 4) return null;
    const half = Math.floor(series.length / 2);
    const recent = series.slice(-half).reduce((s, p) => s + p.count, 0);
    const prior = series.slice(0, half).reduce((s, p) => s + p.count, 0);
    if (prior === 0) return null;
    const pct = Math.round((recent - prior) / prior * 100);
    return pct;
  }, [series]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={2}>{label}</Text>
              {info ? <Text style={s.subtitle}>{info}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={s.closeBtn}>
              <X size={18} color={t.color["text.secondary"]} />
            </Pressable>
          </View>

          <View style={s.summaryRow}>
            <Text style={s.summaryValue}>{value}</Text>
            {delta != null && (
              <Text style={[s.summaryDelta, delta >= 0 ? s.deltaUp : s.deltaDown]}>
                {delta >= 0 ? "+" : ""}{delta}% vs prior period
              </Text>
            )}
          </View>

          <View style={s.chartWrap}>
            {loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator size="small" color={t.color.accent} />
              </View>
            ) : chartData.length > 1 ? (
              <LineChart
                title=""
                data={chartData}
                valueLabel={label}
                height={220}
              />
            ) : (
              <View style={s.emptyWrap}>
                <Text style={s.emptyText}>
                  {"Daily history not yet captured for this metric."}
                </Text>
                <Text style={s.emptyHint}>
                  {"Once the backend series is defined for "}
                  <Text style={s.emptyHintKey}>{metricKey}</Text>
                  {" this card will show the full 30-day trend."}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlayWrap: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any) : {}),
  } as any,
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  card: {
    width: "92%", maxWidth: 680,
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    overflow: "hidden",
    paddingTop: 20, paddingBottom: 20,
    maxHeight: "85%",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between", gap: 12,
    paddingHorizontal: 24,
  } as any,
  title: {
    fontFamily: t.font.display, fontSize: 26,
    color: t.color["text.primary"],
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.muted"],
    marginTop: 4, lineHeight: 17,
  },
  closeBtn: { padding: 4, marginTop: 2 } as any,

  summaryRow: {
    flexDirection: "row", alignItems: "baseline", gap: 12,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8,
  } as any,
  summaryValue: {
    fontFamily: t.font.display, fontSize: 38,
    color: t.color["text.primary"], lineHeight: 44,
  },
  summaryDelta: {
    fontFamily: t.font["body.semibold"], fontSize: 12,
    letterSpacing: 0.3,
  },
  deltaUp: { color: t.color["accent.positive"] || "#5A8F5A" },
  deltaDown: { color: t.color["accent.cta"] || "#B5393C" },

  chartWrap: {
    paddingTop: 6, paddingBottom: 4,
    paddingHorizontal: 12,
  } as any,
  loadingWrap: { paddingVertical: 48, alignItems: "center" } as any,
  emptyWrap: {
    paddingHorizontal: 24, paddingVertical: 36,
    alignItems: "center", gap: 6,
  } as any,
  emptyText: {
    fontFamily: t.font["body.medium"], fontSize: 13,
    color: t.color["text.secondary"],
    textAlign: "center",
  },
  emptyHint: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: t.color["text.muted"],
    textAlign: "center", lineHeight: 16,
    maxWidth: 380,
  },
  emptyHintKey: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.secondary"],
  },
});
