/**
 * BusinessAnalytics — the lightweight per-business dashboard. Lives
 * inside roaster and café profile pages as an owner-gated "Analytics"
 * tab. Shape is deliberately small: two subtabs, three cards each,
 * one chart. Cards act as chart selectors — tap a card, the line
 * chart above re-plots that metric.
 *
 * Backend: GET /api/stats/business/{kind}/{slug} returns a payload
 * shaped { [sectionKey]: { cards: [...], series: {...}, hero_key } }.
 * See services/business_stats.py.
 */

import { useEffect, useMemo, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
} from "react-native";
import { t } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import LineChart, { LineDatum } from "../admin/LineChart";
import InfoModal, { InfoButton } from "../admin/InfoModal";

type Kind = "roaster" | "cafe";

interface Card {
  key: string;
  label: string;
  value: string | number;
  hint?: string | null;
  delta_pct?: number | null;
  info?: string;
  tone?: "default" | "positive" | "negative";
  charts?: boolean;
}

interface Section {
  cards: Card[];
  series: Record<string, Array<{ date: string; count: number }>>;
  hero_key: string;
  error?: string;
}

interface Props {
  kind: Kind;
  slug: string;
}

// Section labels + order per account type. Keep this small — each
// business only gets two subtabs in V1.
const SECTIONS: Record<Kind, { key: string; label: string }[]> = {
  roaster: [
    { key: "wholesale", label: "Wholesale" },
    { key: "audience",  label: "Audience" },
  ],
  cafe: [
    { key: "loyalty",   label: "Loyalty" },
    { key: "menu",      label: "Menu" },
  ],
};

function formatDelta(pct: number | null | undefined): { arrow: string; text: string; color: string } | null {
  if (pct === null || pct === undefined) return null;
  if (Math.abs(pct) < 0.5) return { arrow: "→", text: "flat", color: t.color["text.muted"] };
  if (pct > 0) return { arrow: "↑", text: `${pct}%`, color: t.color["accent.positive"] };
  return { arrow: "↓", text: `${Math.abs(pct)}%`, color: t.color["accent.cta"] };
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch { return iso.slice(5); }
}


export default function BusinessAnalytics({ kind, slug }: Props) {
  const [data, setData] = useState<Record<string, Section> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const tabs = SECTIONS[kind];
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  // Which card inside the active section is the chart-source. Reset
  // when the section changes so each subtab lands on its hero.
  const [activeCardByTab, setActiveCardByTab] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    apiFetchRaw<any>(`/stats/business/${kind}/${slug}`)
      .then((raw) => {
        if (cancelled) return;
        const d = raw?.data ?? raw;
        setData(d);
        // seed per-tab active-card to each section's hero
        const seeds: Record<string, string> = {};
        for (const tab of tabs) {
          const sec: Section | undefined = d?.[tab.key];
          if (sec?.hero_key) seeds[tab.key] = sec.hero_key;
        }
        setActiveCardByTab(seeds);
      })
      .catch((e: any) => { if (!cancelled) setErr(e?.message || "Couldn't load analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // slug + kind are static per mount — this only fires once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug]);

  const section: Section | undefined = data?.[activeTab];
  const activeCardKey = activeCardByTab[activeTab] || section?.hero_key;
  const activeCard = section?.cards.find((c) => c.key === activeCardKey);
  const chartData: LineDatum[] = useMemo(() => {
    const series = activeCardKey ? section?.series?.[activeCardKey] : undefined;
    if (!series || series.length === 0) return [];
    return series.map((p) => ({ label: shortDate(p.date), value: p.count }));
  }, [section, activeCardKey]);

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="small" color={t.color.accent} />
      </View>
    );
  }
  if (err || !data) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyText}>{err || "No analytics yet"}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {/* ── Subtab strip ── */}
      <View style={s.subTabRow}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={s.subTabBtn}
            >
              <Text style={[s.subTabText, active && s.subTabTextActive]}>{tab.label}</Text>
              {active && <View style={s.subTabUnderline} />}
            </Pressable>
          );
        })}
      </View>

      {/* ── Chart + cards ── */}
      {!section || section.cards.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>Nothing here yet</Text>
        </View>
      ) : (
        <>
          <View style={s.chartWrap}>
            {chartData.length > 0 ? (
              <LineChart
                title={activeCard?.label || ""}
                data={chartData}
                valueLabel={typeof activeCard?.value === "number" ? "Count" : "Value"}
                height={180}
              />
            ) : (
              <View style={s.chartPlaceholder}>
                <Text style={s.chartPlaceholderText}>
                  No daily history yet for {activeCard?.label || "this metric"}.
                </Text>
              </View>
            )}
          </View>

          <View style={s.cardRow}>
            {section.cards.map((card) => {
              const selected = activeCardKey === card.key;
              const clickable = card.charts !== false;
              return (
                <MiniCard
                  key={card.key}
                  card={card}
                  selected={selected}
                  onPress={clickable
                    ? () => setActiveCardByTab((p) => ({ ...p, [activeTab]: card.key }))
                    : undefined}
                />
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}


// ── MiniCard ────────────────────────────────────────────────────────

function MiniCard({
  card,
  selected,
  onPress,
}: {
  card: Card;
  selected: boolean;
  onPress?: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const delta = formatDelta(card.delta_pct);

  const valueColor =
    card.tone === "positive"
      ? t.color["accent.positive"]
      : card.tone === "negative"
      ? t.color["accent.cta"]
      : t.color.accent;

  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[
          cs.card,
          selected && cs.cardSelected,
          !onPress && cs.cardStatic,
        ]}
      >
        <View style={cs.header}>
          <Text style={cs.label} numberOfLines={2}>{card.label}</Text>
          {card.info ? (
            <InfoButton
              onPress={() => setShowInfo(true)}
              accessibilityLabel={`What does "${card.label}" mean?`}
            />
          ) : null}
        </View>
        <Text style={[cs.value, { color: valueColor }]} numberOfLines={1}>
          {card.value}
        </Text>
        <View style={cs.footer}>
          {delta ? (
            <Text style={[cs.delta, { color: delta.color }]}>
              {delta.arrow} {delta.text}
            </Text>
          ) : null}
          {card.hint ? <Text style={cs.hint} numberOfLines={1}>{card.hint}</Text> : null}
        </View>
      </Pressable>
      {card.info ? (
        <InfoModal
          visible={showInfo}
          title={card.label}
          body={card.info}
          onClose={() => setShowInfo(false)}
        />
      ) : null}
    </>
  );
}


// ── styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Horizontal padding mirrors the Beans tab's GRID_PAD (20) so the
  // analytics subtab/chart/cards sit at the same inset from the left
  // column divider as the coffee grid. Top padding gives the first
  // subtab some breathing room away from the top tab-bar underline.
  wrap: {
    gap: t.spacing.lg,
    paddingHorizontal: 20,
    paddingTop: t.spacing.md,
  } as any,
  loadingWrap: { paddingVertical: 40, alignItems: "center" } as any,
  emptyWrap: { paddingVertical: 40, alignItems: "center" } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,

  // Same pattern the roaster profile uses — underline is a separate
  // absolute-positioned View at `bottom: -1`, so the active-tab bar
  // rides the parent's borderBottom line instead of sitting inside
  // the button's own border box.
  subTabRow: {
    flexDirection: "row",
    gap: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
    marginBottom: t.spacing.md,
  } as any,
  subTabBtn: {
    position: "relative",
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 8,
  } as any,
  subTabUnderline: {
    position: "absolute",
    bottom: -1, left: 0, right: 0,
    height: 2,
    backgroundColor: t.color.accent,
  } as any,
  subTabText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    letterSpacing: 0.3,
    textTransform: "uppercase",
  } as any,
  subTabTextActive: {
    color: t.color.accent,
    fontFamily: t.font["body.semibold"],
  } as any,

  chartWrap: {
    // Chart has its own title — no wrapper frame needed. Just padding
    // around it.
    paddingVertical: t.spacing.sm,
  } as any,
  chartPlaceholder: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color["card.info"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xl,
  } as any,
  chartPlaceholderText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center" as any,
  } as any,

  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.md,
  } as any,
});

const cs = StyleSheet.create({
  card: {
    // Friendly aspect — ~180px wide, ~140px tall.
    minWidth: 170,
    maxWidth: 220,
    flexBasis: 180,
    flexShrink: 1,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.md,
    gap: 6,
  } as any,
  cardSelected: {
    borderColor: t.color.accent,
    // A gentle lift to signal "this is the chart source"
    backgroundColor: t.color["accent.soft"],
  } as any,
  cardStatic: {
    // Cards that can't drive the chart (no series) show without the
    // hover cursor / selected-state affordance.
    opacity: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    minHeight: 28,
  } as any,
  label: {
    fontFamily: t.font["body.medium"],
    fontSize: 10.5,
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
    lineHeight: 14,
  } as any,
  value: {
    fontFamily: t.font.display,
    fontSize: 30,
    lineHeight: 34,
  } as any,
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    flexWrap: "wrap",
  } as any,
  delta: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    letterSpacing: 0.2,
  } as any,
  hint: {
    fontFamily: t.font["body.regular"],
    fontSize: 11,
    color: t.color["text.secondary"],
    flexShrink: 1,
    minWidth: 0,
  } as any,
});
