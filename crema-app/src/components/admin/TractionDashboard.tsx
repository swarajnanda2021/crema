/**
 * CRUD Utopia — admin-only analytics surface. Every visual value reads from
 * design-tokens.json via useTokens. Data comes from /api/stats/traction
 * (services/admin_stats.py) gated on is_admin=1 + username="crema".
 * See CRUD_UTOPIA.md at repo root.
 *
 * TractionDashboard — renders one of six sections (engagement, commerce,
 * loyalty, network, retention, supply) using MetricCard / MetricTable /
 * RetentionTable. Designed to be embedded as tab content on the Crema
 * admin's own profile; one admin tab → one section.
 */

import { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { RefreshCw } from "lucide-react-native";

import { t } from "../../tokens/useTokens";
import { useTractionStats } from "../../hooks/useTractionStats";
import MetricCard from "./MetricCard";
import MetricTable from "./MetricTable";
import RetentionTable from "./RetentionTable";

export type AdminSection =
  | "engagement"
  | "commerce"
  | "loyalty"
  | "network"
  | "retention"
  | "supply";

const SECTION_TITLES: Record<AdminSection, string> = {
  engagement: "Engagement",
  commerce: "Commerce",
  loyalty: "Loyalty",
  network: "Network",
  retention: "Retention",
  supply: "Supply",
};

const SECTION_BLURBS: Record<AdminSection, string> = {
  engagement: "Who's active and how deeply.",
  commerce: "Buy-intent clicks, funnel, and top products.",
  loyalty: "Stamps, reward conversion, and repeat visits.",
  network: "Follower graph density and implicit community signals.",
  retention: "Weekly cohort grids and writer recurrence.",
  supply: "Roasters, products, cafés, and ecosystem density.",
};

interface TractionDashboardProps {
  section: AdminSection;
}

export default function TractionDashboard({ section }: TractionDashboardProps) {
  const { stats, loading, error, refresh } = useTractionStats(true);
  const { width } = useWindowDimensions();
  const columns = width >= 1280 ? 4 : width >= 960 ? 3 : width >= 600 ? 2 : 1;
  const cardBasis = useMemo(() => {
    // Percent width approximation honouring gap visually (flex grid with wrap)
    if (columns === 1) return "100%";
    if (columns === 2) return "48%";
    if (columns === 3) return "31%";
    return "23%";
  }, [columns]);

  const header = (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{SECTION_TITLES[section]}</Text>
        <Text style={s.blurb}>{SECTION_BLURBS[section]}</Text>
      </View>
      <Pressable onPress={refresh} style={s.refreshBtn} disabled={loading}>
        {loading ? (
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        ) : (
          <RefreshCw size={14} color={t.color["text.primary"]} />
        )}
        <Text style={s.refreshText}>Refresh</Text>
      </Pressable>
    </View>
  );

  if (error) {
    return (
      <View style={s.wrap}>
        {header}
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
        <View style={s.loadingBox}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
          <Text style={s.loadingText}>Crunching numbers…</Text>
        </View>
      </View>
    );
  }

  const body = (() => {
    switch (section) {
      case "engagement":
        return renderEngagement(stats, cardBasis);
      case "commerce":
        return renderCommerce(stats, cardBasis);
      case "loyalty":
        return renderLoyalty(stats, cardBasis);
      case "network":
        return renderNetwork(stats, cardBasis);
      case "retention":
        return renderRetention(stats, cardBasis);
      case "supply":
        return renderSupply(stats, cardBasis);
    }
  })();

  return (
    <View style={s.wrap}>
      {header}
      {body}
      <Text style={s.footer}>
        Generated at {stats.generated_at?.replace("T", " ").replace("Z", " UTC")}
      </Text>
    </View>
  );
}

// ── Section renderers ──────────────────────────────────────────────────────

function grid(children: React.ReactNode) {
  return <View style={s.grid}>{children}</View>;
}

function renderEngagement(stats: any, basis: any) {
  const e = stats.engagement;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Users" value={e.total_users} hint={`${e.total_roasters} roasters · ${e.total_cafe_accounts} cafés`} />
          <Card basis={basis} label="DAU" value={e.dau} hint="Active in last 24h" />
          <Card basis={basis} label="WAU" value={e.wau} hint="Active in last 7d" />
          <Card basis={basis} label="MAU" value={e.mau} hint="Active in last 30d" />
        </>,
      )}
      <Text style={s.sectionHead}>Depth</Text>
      {grid(
        <>
          <Card basis={basis} label="Tasting-Note Writers" value={e.writers} hint={`${e.writer_pct}% of all users`} />
          <Card basis={basis} label="Notes / Writer · mean" value={e.mean_notes_per_writer} />
          <Card basis={basis} label="Notes / Writer · median" value={e.median_notes_per_writer} />
          <Card basis={basis} label="Posts / Active User / Week" value={e.posts_per_active_user_per_week} hint="Last 30d" />
        </>,
      )}
      <Text style={s.sectionHead}>Social</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Posts" value={e.total_posts} />
          <Card basis={basis} label="Comments / Post" value={e.comments_per_post} hint={`${e.total_comments} comments total`} />
          <Card basis={basis} label="Reposts" value={e.total_reposts} hint={`${e.repost_rate_pct}% of posts`} />
          <Card basis={basis} label="Posts w/ 0 Likes" value={e.like_distribution["0"] ?? 0} hint={`${e.like_distribution["1-5"] ?? 0} · 1–5  |  ${e.like_distribution["6-20"] ?? 0} · 6–20  |  ${e.like_distribution["21+"] ?? 0} · 21+`} />
        </>,
      )}
    </View>
  );
}

function renderCommerce(stats: any, basis: any) {
  const c = stats.commerce;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Buy Intent</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Clicks" value={c.total_clicks} hint="All-time outbound Buy intents" />
          <Card basis={basis} label="Users Who Clicked" value={c.funnel.clicked} />
          <Card basis={basis} label="Users Who Shelved" value={c.funnel.shelved} />
          <Card basis={basis} label="Users Who Rated" value={c.funnel.rated} />
        </>,
      )}
      <Text style={s.sectionHead}>Full Funnel</Text>
      {grid(
        <>
          <Card basis="100%" label="Click → Shelf → Tasting Note (same product)" value={c.funnel.full_funnel} hint="Users who completed the full journey on one product" />
        </>,
      )}
      <Text style={s.sectionHead}>Trends</Text>
      <View style={s.twoCol}>
        <MetricTable
          title="Clicks by source"
          valueHeader="Clicks"
          rows={(c.clicks_by_source || []).map((r: any) => ({
            label: r.source_page,
            value: r.clicks,
          }))}
        />
        <MetricTable
          title="Monthly clicks (last 6 mo)"
          valueHeader="Clicks"
          rows={(c.monthly_clicks || []).map((m: any) => ({
            label: m.month,
            value: m.clicks,
          }))}
        />
      </View>
      <MetricTable
        title="Top-clicked products"
        valueHeader="Clicks"
        rows={(c.top_products || []).map((p: any) => ({
          label: p.coffee_name || p.product_id,
          sub: p.roaster_name || p.roaster_slug,
          value: p.clicks,
        }))}
      />
    </View>
  );
}

function renderLoyalty(stats: any, basis: any) {
  const l = stats.loyalty;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Volume</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Stamps" value={l.total_stamps} />
          <Card basis={basis} label="Last 7 days" value={l.stamps_7d} />
          <Card basis={basis} label="Last 30 days" value={l.stamps_30d} />
          <Card basis={basis} label="Last 90 days" value={l.stamps_90d} />
        </>,
      )}
      <Text style={s.sectionHead}>Cohort</Text>
      {grid(
        <>
          <Card basis={basis} label="Unique Stamped Users" value={l.unique_stamped_users} />
          <Card basis={basis} label="Avg Stamps / User" value={l.avg_stamps_per_user} />
          <Card basis={basis} label="Loyal (3+ at a café)" value={l.loyal_cohort_3_plus} />
          <Card basis={basis} label="Avg Days Between Stamps" value={l.avg_days_between_stamps || "—"} />
        </>,
      )}
      <Text style={s.sectionHead}>Rewards</Text>
      {grid(
        <>
          <Card basis={basis} label="Rewards Redeemed" value={l.rewards_redeemed} />
          <Card basis={basis} label="Reward Conversion" value={`${l.reward_conversion_pct}%`} hint="% of stamped users who reached target" />
        </>,
      )}
      <MetricTable
        title="Top cafés by stamp volume"
        valueHeader="Stamps"
        rows={(l.top_cafes || []).map((c: any) => ({
          label: c.name,
          sub: c.city,
          value: c.stamps,
        }))}
      />
    </View>
  );
}

function renderNetwork(stats: any, basis: any) {
  const n = stats.network;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Graph</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Follow Edges" value={n.total_follows} />
          <Card basis={basis} label="Users Following Anyone" value={n.unique_followers} />
          <Card basis={basis} label="Avg Follows / User" value={n.avg_follows_per_user} />
          <Card basis={basis} label="Reciprocal Pairs" value={n.reciprocal_pairs} hint="Friend-graph signal" />
        </>,
      )}
      <Text style={s.sectionHead}>Implicit Community</Text>
      {grid(
        <>
          <Card basis="100%" label="User pairs sharing ≥3 shelf products" value={n.shared_shelf_pairs_3_plus} hint="Candidate friend-pairs by taste overlap" />
        </>,
      )}
      <View style={s.twoCol}>
        <MetricTable
          title="Top roasters by followers"
          valueHeader="Followers"
          rows={(n.top_roasters || []).map((r: any) => ({
            label: r.name,
            sub: r.city,
            value: r.followers,
          }))}
        />
        <MetricTable
          title="Top cafés by followers"
          valueHeader="Followers"
          rows={(n.top_cafes || []).map((c: any) => ({
            label: c.name,
            sub: c.city,
            value: c.followers,
          }))}
        />
      </View>
    </View>
  );
}

function renderRetention(stats: any, basis: any) {
  const r = stats.retention;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Writers (≥1 note)" value={r.writers_total} />
          <Card basis={basis} label="Writer Retention · 30d" value={`${r.writer_retention_30d_pct}%`} hint="% who wrote a second note within 30d" />
          <Card basis={basis} label="First → Second Stamp · avg days" value={r.avg_first_to_second_stamp_days || "—"} />
          <Card basis={basis} label="Cohorts Tracked" value={(r.cohorts || []).length} />
        </>,
      )}
      <Text style={s.sectionHead}>Weekly signup cohorts</Text>
      <RetentionTable cohorts={r.cohorts || []} />
    </View>
  );
}

function renderSupply(stats: any, basis: any) {
  const sup = stats.supply;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Roasters</Text>
      {grid(
        <>
          <Card basis={basis} label="Roasters in Catalog" value={sup.roasters_total} />
          <Card basis={basis} label="With Profile" value={sup.roasters_with_profiles} />
          <Card basis={basis} label="With Active Products" value={sup.roasters_with_products} />
          <Card basis={basis} label="With Followers" value={sup.roasters_with_followers} />
        </>,
      )}
      <Text style={s.sectionHead}>Products</Text>
      {grid(
        <>
          <Card basis={basis} label="Products Total" value={sup.products_total} />
          <Card basis={basis} label="Available" value={sup.products_available} />
          <Card basis={basis} label="On a Shelf" value={sup.products_with_shelf_entry} />
          <Card basis={basis} label="With Tasting Note" value={sup.products_with_tasting_note} />
        </>,
      )}
      <Text style={s.sectionHead}>Cafés</Text>
      {grid(
        <>
          <Card basis={basis} label="Cafés Total" value={sup.cafes_total} />
          <Card basis={basis} label="Stamps Enabled" value={sup.cafes_stamps_enabled} />
          <Card basis={basis} label="With Any Stamp" value={sup.cafes_with_any_stamp} />
          <Card basis={basis} label="Avg Menu Items" value={sup.avg_menu_items_per_cafe} />
        </>,
      )}
      <Text style={s.sectionHead}>Ecosystem</Text>
      {grid(
        <>
          <Card basis={basis} label="Cafés Sourcing from Catalog" value={sup.cafes_using_catalog_roasters} />
          <Card basis={basis} label="Ecosystem Density" value={`${sup.ecosystem_density_pct}%`} hint="% of cafés pouring a catalog roaster" />
        </>,
      )}
    </View>
  );
}

// ── Card helper that applies responsive basis ─────────────────────────────

function Card({
  basis,
  label,
  value,
  hint,
}: {
  basis: string;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <View style={{ flexBasis: basis as any, flexGrow: 1, minWidth: 180 } as any}>
      <MetricCard label={label} value={value} hint={hint} wide={basis === "100%"} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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
  twoCol: {
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
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.color["card.front"],
  },
  refreshText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  footer: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textAlign: "right",
  },
});
