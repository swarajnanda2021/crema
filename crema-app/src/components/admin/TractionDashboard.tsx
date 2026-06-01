/**
 * CRUD Utopia — admin-only analytics surface. Every visual value reads from
 * design-tokens.json via useTokens. Data comes from /api/stats/traction
 * (services/admin_stats.py) gated on is_admin=1 + username="crema".
 * See CRUD_UTOPIA.md at repo root.
 *
 * TractionDashboard — mounted inside the profile "SITE ANALYTICS" tab.
 *   • Sub-tab bar (same design language as the top profile tab bar).
 *   • MetricCard grid up top (heterogeneous — snapshot metrics).
 *   • Plots carousel below — ONLY for time-series metrics (things whose
 *     trajectory over time matters). Rankings and distributions stay as
 *     MetricTables so the visualization matches the data's shape.
 *   • Every card / chart / table has an optional "?" info button that
 *     opens a floating modal (same pattern as PostModal) explaining what
 *     the metric represents.
 */

import { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Pressable,
  ScrollView,
} from "react-native";
import { RefreshCw } from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { useTractionStats } from "../../hooks/useTractionStats";
import LineChart from "./LineChart";
import MetricCard from "./MetricCard";
import MetricSeriesModal from "./MetricSeriesModal";
import MetricTable from "./MetricTable";

export type AdminSection =
  | "catalog"
  | "demand"
  | "roasters"
  | "audience";

const SECTIONS: AdminSection[] = [
  "catalog",
  "demand",
  "roasters",
  "audience",
];

const SECTION_LABELS: Record<AdminSection, string> = {
  catalog: "CATALOG",
  demand: "DEMAND",
  roasters: "ROASTERS",
  audience: "AUDIENCE",
};

const SECTION_BLURBS: Record<AdminSection, string> = {
  catalog: "Supply readiness — beans, roasters, completeness, freshness.",
  demand: "Consumer intent — shelf saves, Buy clicks, top beans.",
  roasters: "Marketplace matching — who's discovered, who's cold.",
  audience: "Growth — users, activity, returning, journal engagement.",
};

const SECTION_NICE: Record<AdminSection, string> = {
  catalog: "Catalog readiness",
  demand: "Demand",
  roasters: "Roasters",
  audience: "Audience",
};

export default function TractionDashboard() {
  const [section, setSection] = useState<AdminSection>("catalog");
  const { stats, loading, error, refresh } = useTractionStats(true);
  const { width } = useWindowDimensions();
  const s = useStyles();

  // §2.18 drill-down — Card invocations call `_openMetric` (a module
  // ref set here on mount) to open the daily-chart modal for the
  // clicked metric. Using a module ref keeps every Card prop API
  // unchanged; the dashboard is the single parent so there's no
  // cross-tree coordination.
  const [activeMetric, setActiveMetric] = useState<OpenMetric | null>(null);
  if (_openMetric !== setActiveMetric as any) {
    _openMetric = setActiveMetric;
  }

  const headlineBasis = (() => {
    if (width >= 1100) return "31%";
    if (width >= 720) return "48%";
    return "100%";
  })();

  const header = (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{SECTION_NICE[section]}</Text>
        <Text style={s.blurb}>{SECTION_BLURBS[section]}</Text>
      </View>
      <Pressable
        onPress={refresh}
        style={({ pressed }) => [s.refreshBtn, pressed && s.refreshBtnPressed]}
        disabled={loading}
        accessibilityLabel="Refresh stats"
      >
        {loading ? (
          <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
        ) : (
          <RefreshCw size={18} color={t.color["text.on-cta"]} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );

  const subTabs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.subTabRow}
    >
      {SECTIONS.map((key) => {
        const active = key === section;
        return (
          <Pressable key={key} onPress={() => setSection(key)} style={s.subTab}>
            <Text
              style={[
                s.subTabText,
                active ? s.subTabTextActive : s.subTabTextInactive,
              ]}
            >
              {SECTION_LABELS[key]}
            </Text>
            {active ? <View style={s.subTabUnderline} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  if (error) {
    return (
      <View style={s.wrap}>
        {header}
        {subTabs}
        <View style={s.errorBox}>
          <Text style={s.errorTitle}>Couldn't load stats</Text>
          <Text style={s.errorBody}>{error}</Text>
        </View>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={s.wrap}>
        {header}
        {subTabs}
        <View style={s.loadingBox}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
          <Text style={s.loadingText}>Crunching numbers…</Text>
        </View>
      </View>
    );
  }

  // All four sections share the generic { cards, tables, series } shape,
  // so one renderer handles every sub-tab (stats[section] is the payload).
  const body = renderSection((stats as any)[section], headlineBasis, s);

  return (
    <View style={s.wrap}>
      {header}
      {subTabs}
      {/* Keying the body on section forces all internal state — including
          PlotCarousel's current-slide index — to reset when the user
          switches sub-tabs, so "slide 3" on commerce doesn't carry into
          loyalty. */}
      <View key={section} style={{ gap: t.spacing.xl }}>
        {body}
      </View>
      <Text style={s.footer}>
        Generated at {stats.generated_at?.replace("T", " ").replace("Z", " UTC")}
      </Text>

      {/* §2.18 — daily drill-down modal mounted once at the root. */}
      <MetricSeriesModal
        visible={!!activeMetric}
        metricKey={activeMetric?.key || ""}
        label={activeMetric?.label || ""}
        value={activeMetric?.value ?? ""}
        info={activeMetric?.info}
        onClose={() => setActiveMetric(null)}
      />
    </View>
  );
}

// ── PlotCarousel — swipe-only horizontal paginated carousel. ───────────────

function PlotCarousel({ slides }: { slides: React.ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const [slideWidth, setSlideWidth] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const cs = useCsStyles();

  if (slides.length === 0) return null;
  if (slides.length === 1) {
    return <View>{slides[0]}</View>;
  }

  return (
    <View style={cs.wrap}>
      <View
        onLayout={(e) => setSlideWidth(e.nativeEvent.layout.width)}
        style={{ width: "100%" }}
      >
        <ScrollView
          ref={scrollRef as any}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={slideWidth || 1}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={(e) => {
            const w = slideWidth || 1;
            const next = Math.round(e.nativeEvent.contentOffset.x / w);
            if (next !== index) setIndex(next);
          }}
          scrollEventThrottle={80}
        >
          {slides.map((slide, i) => (
            <View key={i} style={{ width: slideWidth }}>
              {slide}
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={cs.dotsRow}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[cs.dot, i === index ? cs.dotActive : cs.dotInactive]}
          />
        ))}
      </View>
    </View>
  );
}

const useCsStyles = makeStyles((t) => ({
  wrap: { gap: t.spacing.md },
  dotsRow: { flexDirection: "row", gap: t.spacing.sm, alignSelf: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: t.color["text.primary"] },
  dotInactive: { backgroundColor: t.color["border.light"] },
}));

// ── Section renderers ──────────────────────────────────────────────────────

function grid(children: React.ReactNode) {
  return <Grid>{children}</Grid>;
}

function Grid({ children }: { children: React.ReactNode }) {
  const s = useStyles();
  return <View style={s.grid}>{children}</View>;
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

// "2026-04-01" → "Apr 1st" — friendlier than MM-DD for non-data-scientists.
function prettyDate(iso: string): string {
  const [_y, mm, dd] = iso.split("-");
  const month = MONTH_NAMES_SHORT[Math.max(0, Math.min(11, parseInt(mm, 10) - 1))];
  return `${month} ${ordinal(parseInt(dd, 10))}`;
}

// "2026-04" → "Apr" (or "Apr '26" when crossing years, but rare in 6-mo window)
function prettyMonth(iso: string): string {
  const [y, mm] = iso.split("-");
  const month = MONTH_NAMES_SHORT[Math.max(0, Math.min(11, parseInt(mm, 10) - 1))];
  // Suffix year only if it differs from the current year
  const now = new Date().getUTCFullYear();
  return parseInt(y, 10) === now ? month : `${month} '${y.slice(2)}`;
}

function toLineData(series: Array<{ date: string; count: number }>) {
  return series.map((pt) => ({
    label: prettyDate(pt.date),
    value: pt.count,
  }));
}

// ── Generic section renderer (catalog-only dashboard) ──────────────────────
// The backend returns each section as { cards, tables, series }, so one
// layout renders all four sub-tabs: cards (each drilling into its
// `series_key` chart) → a swipeable chart carousel for series with data →
// MetricTables. Replaces the four bespoke social-era render functions.

const CHART_TITLES: Record<string, string> = {
  daily_new_beans: "New beans / day",
  daily_saves: "Shelf saves / day",
  daily_clicks: "Buy clicks / day",
  daily_signups: "Signups / day",
  daily_active: "Active users / day",
};

function fmtVal(value: any, suffix?: string): string | number {
  if (value === null || value === undefined || value === "") return "—";
  return suffix ? `${value}${suffix}` : value;
}

function renderSection(sectionData: any, basis: any, _s: any) {
  if (!sectionData) return null;
  const cards: any[] = sectionData.cards || [];
  const tables: any[] = sectionData.tables || [];
  const series: Record<string, any[]> = sectionData.series || {};
  const charts = Object.entries(series).filter(
    ([, v]) => Array.isArray(v) && v.length > 0,
  );
  return (
    <>
      {cards.length > 0 ? (
        <Grid>
          {cards.map((c) => (
            <Card
              key={c.key}
              basis={basis}
              label={c.label}
              value={fmtVal(c.value, c.suffix)}
              hint={c.hint || undefined}
              seriesKey={c.series_key}
            />
          ))}
        </Grid>
      ) : null}
      {charts.length > 0 ? (
        <PlotCarousel
          slides={charts.map(([k, data]) => (
            <LineChart key={k} title={CHART_TITLES[k] || k} data={toLineData(data as any)} />
          ))}
        />
      ) : null}
      {tables.map((tbl, i) => (
        <MetricTable
          key={`${tbl.title}-${i}`}
          title={tbl.title}
          valueHeader={tbl.value_header || undefined}
          rows={tbl.rows || []}
          maxHeight={340}
        />
      ))}
    </>
  );
}


// ── Card helper that applies responsive basis ─────────────────────────────

// §2.18 — global drill-down. Card wraps in a Pressable and fires
// `openMetric` on click; the parent dashboard holds the modal state
// so only one modal is mounted at a time. `seriesKey` is the
// backend dispatcher key (`daily_signups`, `dau`, etc.); cards
// without one still open the modal but hit the empty-state path.
let _openMetric: ((m: OpenMetric) => void) | null = null;
interface OpenMetric { key: string; label: string; value: string | number; info?: string; }

function Card({
  basis,
  label,
  value,
  hint,
  info,
  seriesKey,
}: {
  basis: string;
  label: string;
  value: string | number;
  hint?: string;
  info?: string;
  seriesKey?: string;
}) {
  const key = seriesKey || label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return (
    <Pressable
      onPress={() => _openMetric?.({ key, label, value, info })}
      style={{ flexBasis: basis as any, flexGrow: 1, minWidth: 180 } as any}
      accessibilityRole="button"
      accessibilityLabel={`See daily history for ${label}`}
    >
      <MetricCard
        label={label}
        value={value}
        hint={hint}
        info={info}
        wide={basis === "100%"}
      />
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  wrap: {
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing["4xl"],
    gap: t.spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: t.spacing.md,
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 35,
    lineHeight: 42,
    color: t.color["text.primary"],
  },
  blurb: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    marginTop: t.spacing.xs,
  },
  subTabRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: t.spacing["3xl"],
    borderBottomWidth: 1,
    borderBottomColor: t.color.divider,
    paddingBottom: 0,
    height: 48,
  },
  subTab: {
    justifyContent: "center",
    position: "relative",
  } as any,
  subTabText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  subTabTextInactive: { color: t.color["text.muted"] },
  subTabTextActive: { color: t.color["text.primary"] },
  subTabUnderline: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: t.color["text.primary"],
  } as any,

  sectionHead: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.md,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingVertical: t.spacing["3xl"],
  },
  loadingText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
  },
  errorBox: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["accent.cta"],
    borderRadius: t.radius.md,
    padding: t.spacing.xl,
    gap: t.spacing.sm,
  },
  errorTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["accent.cta"],
  },
  errorBody: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.color.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  } as any,
  refreshBtnPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.96 }],
  } as any,
  footer: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textAlign: "right",
  },
}));
