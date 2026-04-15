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

import { t } from "../../tokens/useTokens";
import { useTractionStats } from "../../hooks/useTractionStats";
import LineChart from "./LineChart";
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

const SECTIONS: AdminSection[] = [
  "engagement",
  "commerce",
  "loyalty",
  "network",
  "retention",
  "supply",
];

const SECTION_LABELS: Record<AdminSection, string> = {
  engagement: "ENGAGEMENT",
  commerce: "COMMERCE",
  loyalty: "LOYALTY",
  network: "NETWORK",
  retention: "RETENTION",
  supply: "SUPPLY",
};

const SECTION_BLURBS: Record<AdminSection, string> = {
  engagement: "Who's active and how deeply.",
  commerce: "Buy-intent clicks, funnel, and top products.",
  loyalty: "Stamps, reward conversion, and repeat visits.",
  network: "Follower graph and implicit community signals.",
  retention: "Weekly cohort grids and writer recurrence.",
  supply: "Roasters, products, cafés, and ecosystem density.",
};

const SECTION_NICE: Record<AdminSection, string> = {
  engagement: "Engagement",
  commerce: "Commerce",
  loyalty: "Loyalty",
  network: "Network",
  retention: "Retention",
  supply: "Supply",
};

export default function TractionDashboard() {
  const [section, setSection] = useState<AdminSection>("engagement");
  const { stats, loading, error, refresh } = useTractionStats(true);
  const { width } = useWindowDimensions();

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
          <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
        ) : (
          <RefreshCw size={18} color={t.color["text.on-dark"]} strokeWidth={2} />
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

  let body: React.ReactNode = null;
  switch (section) {
    case "engagement":
      body = renderEngagement(stats, headlineBasis);
      break;
    case "commerce":
      body = renderCommerce(stats, headlineBasis);
      break;
    case "loyalty":
      body = renderLoyalty(stats, headlineBasis);
      break;
    case "network":
      body = renderNetwork(stats, headlineBasis);
      break;
    case "retention":
      body = renderRetention(stats, headlineBasis);
      break;
    case "supply":
      body = renderSupply(stats, headlineBasis);
      break;
  }

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
    </View>
  );
}

// ── PlotCarousel — swipe-only horizontal paginated carousel. ───────────────

function PlotCarousel({ slides }: { slides: React.ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const [slideWidth, setSlideWidth] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

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

const cs = StyleSheet.create({
  wrap: { gap: t.spacing.md },
  dotsRow: { flexDirection: "row", gap: t.spacing.sm, alignSelf: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: t.color["text.primary"] },
  dotInactive: { backgroundColor: t.color["border.light"] },
});

// ── Section renderers ──────────────────────────────────────────────────────

function grid(children: React.ReactNode) {
  return <View style={s.grid}>{children}</View>;
}

function toLineData(series: Array<{ date: string; count: number }>) {
  return series.map((pt) => ({
    // Strip the year to keep axis labels compact (MM-DD)
    label: pt.date.slice(5),
    value: pt.count,
  }));
}

// ── Explanations ──────────────────────────────────────────────────────────
// Kept as strings so the dashboard stays a single file; a future version
// could move these into a JSON file alongside design-tokens.

const E = {
  totalUsers:
    "Every registered account with account_type='user'. Excludes roaster and café seller accounts.",
  dau: "Unique users who did at least one action in the last 24h. Actions = tasting note, post, comment, like, shelf entry, or stamp.",
  wau: "Unique users active at least once in the last 7 days, using the same action set as DAU.",
  mau: "Unique users active at least once in the last 30 days, same action set as DAU/WAU.",
  writers:
    "Users who have written at least one tasting note. The hardest engagement tier — creation, not consumption.",
  meanNotes: "Mean tasting notes per writer (sum / writer count).",
  medianNotes:
    "Median tasting notes per writer. Less sensitive to power-writers than the mean.",
  postsPerWeek:
    "(Posts in last 30d) ÷ (posters in last 30d) ÷ (30/7). A per-active-poster weekly rate.",
  totalPosts: "Every row in roaster_posts, including reposts and tasting-note posts.",
  commentsPerPost: "Total post_comments ÷ total posts.",
  reposts:
    "Posts whose repost_of_id is set. Organic virality proxy — our Twitter RT.",
  likeDistribution:
    "Posts bucketed by how many likes they've earned. 0-like bucket is the 'zero box' — posts nobody hearted.",
  dailySignups:
    "New user_account registrations per day, last 90 days. Shows onboarding rate.",
  dailyActive:
    "Distinct active users per day, last 30 days. Activity = any action (tasting note, post, comment, like, shelf entry, stamp).",
  dailyPosts:
    "Posts created per day, last 30 days. Includes articles, notes, reposts, tasting-note posts.",

  totalClicks:
    "Outbound 'Buy' clicks the app has logged across all time. The explicit proxy for revenue-intent.",
  funnelClicked: "Distinct users who clicked Buy on any product.",
  funnelShelved: "Distinct users who added at least one product to any shelf.",
  funnelRated: "Distinct users who wrote at least one tasting note.",
  funnelFull:
    "Users who clicked Buy AND shelved AND rated the SAME product. The complete loop: intent → ownership → reflection.",
  dailyClicks:
    "Outbound Buy clicks per day, last 30 days. Spikes often coincide with launches or highlighted content.",
  monthlyClicks:
    "Outbound Buy clicks aggregated by calendar month, last 6 months. Useful for seasonality.",
  clicksBySource:
    "Where on the product card each click originated — front (card face), back (details), detail page, etc.",
  topProducts:
    "Top 20 products by lifetime Buy-clicks. Ties broken by insertion order; most-clicked first.",

  totalStamps: "Every row in stamps — one per barista-awarded visit.",
  stamps7: "Stamps scanned in the last 7 days.",
  stamps30: "Stamps scanned in the last 30 days.",
  stamps90: "Stamps scanned in the last 90 days.",
  uniqueStamped: "Distinct users who have ever received a stamp at any café.",
  avgStampsPerUser:
    "(Total stamps) ÷ (unique stamped users). A rough repeat-visit rate across all cafés.",
  avgBetween:
    "Average days between consecutive stamps at the SAME café for the same user. Measures how often loyal users come back.",
  loyalCohort:
    "Users with 3+ stamps at any single café. The engaged base for reward economics.",
  rewardsRedeemed: "Reward rows created (free coffee claimed) all-time.",
  rewardConversion:
    "% of stamped users who reached at least one café's stamp target.",
  topCafes:
    "Cafés ranked by total stamps scanned. Scrollable — the list grows as the network does.",
  dailyStamps: "Stamps scanned per day, last 90 days.",

  totalFollows: "Every row in the follows table — each follower→target edge.",
  uniqueFollowers: "Distinct users who follow at least one entity.",
  avgFollowsPerUser: "(Total follows) ÷ (users who follow anyone).",
  reciprocal:
    "User-to-user pairs who mutually follow each other. A friend-graph signal — the strongest organic connection.",
  sharedShelf:
    "Pairs of users who share ≥3 products on their shelves. An implicit taste-community signal even without a direct follow.",
  topRoasters: "Roasters ranked by lifetime follower count.",
  topFollowedCafes: "Cafés ranked by lifetime follower count.",

  writerRetention:
    "% of tasting-note writers who wrote a second note within 30 days of their first. Creator-mode retention.",
  firstToSecondStamp:
    "Average days from a user's first stamp at a café to their second stamp at the same café.",
  weeklyCohorts:
    "Weekly signup cohorts with D1 / D7 / D30 activity retention. Each row = users who signed up that week; cells show what % were still active at each day-offset.",
  d7Series:
    "D7 retention percentage per weekly cohort. Trending up means new signups are sticking around longer.",
  d30Series:
    "D30 retention percentage per weekly cohort. The hardest retention cliff — who's here after a month.",
  signupsSeries: "Users signing up per week, plotted over the last ~12 weeks.",

  roastersTotal: "Every roaster slug known to the catalog (scraped + seeded + self-registered).",
  roastersProfiles:
    "Roasters who have a row in roaster_profiles (the editable overrides table).",
  roastersProducts: "Roasters with at least one available product row.",
  roastersFollowers:
    "Roasters who have at least one follower — the signal that an audience cares.",
  productsTotal: "Every product_id in the unified products table.",
  productsAvailable: "Products whose 'available' flag is 1 (in-stock or scrapable).",
  productsShelf: "Distinct products someone has added to their shelf.",
  productsNote: "Distinct products at least one user has written a tasting note for.",
  cafesTotal: "Café profiles seeded or self-registered.",
  cafesStamps: "Cafés whose loyalty program (stamps_enabled=1) is switched on.",
  cafesAnyStamp: "Cafés that have issued at least one stamp.",
  avgMenu: "Average number of menu items per café (per cafe_menu_items).",
  cafesCatalog:
    "Cafés whose menu mentions at least one roaster in our catalog — an ecosystem-density signal.",
  ecosystemDensity:
    "% of cafés pouring at least one catalog roaster. 100% = the whole network is plugged together.",
};

function renderEngagement(stats: any, basis: any) {
  const e = stats.engagement;
  const likeBuckets = [
    { label: "0", value: e.like_distribution["0"] ?? 0 },
    { label: "1–5", value: e.like_distribution["1-5"] ?? 0 },
    { label: "6–20", value: e.like_distribution["6-20"] ?? 0 },
    { label: "21+", value: e.like_distribution["21+"] ?? 0 },
  ];
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Users" value={e.total_users} hint={`${e.total_roasters} roasters · ${e.total_cafe_accounts} cafés`} info={E.totalUsers} />
          <Card basis={basis} label="DAU" value={e.dau} hint="Active in last 24h" info={E.dau} />
          <Card basis={basis} label="WAU" value={e.wau} hint="Active in last 7d" info={E.wau} />
          <Card basis={basis} label="MAU" value={e.mau} hint="Active in last 30d" info={E.mau} />
          <Card basis={basis} label="Writers" value={e.writers} hint={`${e.writer_pct}% of all users`} info={E.writers} />
          <Card basis={basis} label="Notes / Writer · mean" value={e.mean_notes_per_writer} info={E.meanNotes} />
          <Card basis={basis} label="Notes / Writer · median" value={e.median_notes_per_writer} info={E.medianNotes} />
          <Card basis={basis} label="Posts / Week / User" value={e.posts_per_active_user_per_week} hint="Active users, last 30d" info={E.postsPerWeek} />
          <Card basis={basis} label="Total Posts" value={e.total_posts} info={E.totalPosts} />
          <Card basis={basis} label="Comments / Post" value={e.comments_per_post} hint={`${e.total_comments} total`} info={E.commentsPerPost} />
          <Card basis={basis} label="Reposts" value={e.total_reposts} hint={`${e.repost_rate_pct}% of posts`} info={E.reposts} />
        </>,
      )}
      <Text style={s.sectionHead}>Plots</Text>
      <PlotCarousel
        slides={[
          <LineChart
            key="dau-series"
            title="Daily active users (30d)"
            valueLabel="Users"
            data={toLineData(e.daily_active_users || [])}
            info={E.dailyActive}
          />,
          <LineChart
            key="signups-series"
            title="Daily signups (90d)"
            valueLabel="Signups"
            data={toLineData(e.daily_signups || [])}
            info={E.dailySignups}
          />,
          <LineChart
            key="posts-series"
            title="Daily posts (30d)"
            valueLabel="Posts"
            data={toLineData(e.daily_posts || [])}
            info={E.dailyPosts}
          />,
          <MetricTable
            key="like-dist"
            title="Like distribution"
            valueHeader="Posts"
            info={E.likeDistribution}
            rows={likeBuckets.map((b) => ({ label: b.label, value: b.value }))}
          />,
        ]}
      />
    </View>
  );
}

function renderCommerce(stats: any, basis: any) {
  const c = stats.commerce;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Clicks" value={c.total_clicks} hint="All-time outbound Buy intents" info={E.totalClicks} />
          <Card basis={basis} label="Users Who Clicked" value={c.funnel.clicked} info={E.funnelClicked} />
          <Card basis={basis} label="Users Who Shelved" value={c.funnel.shelved} info={E.funnelShelved} />
          <Card basis={basis} label="Users Who Rated" value={c.funnel.rated} info={E.funnelRated} />
          <Card basis="100%" label="Full Funnel (Click → Shelf → Note)" value={c.funnel.full_funnel} hint="Users who completed the full journey on one product" info={E.funnelFull} />
        </>,
      )}
      <Text style={s.sectionHead}>Plots</Text>
      <PlotCarousel
        slides={[
          <LineChart
            key="clicks-30d"
            title="Daily clicks (30d)"
            valueLabel="Clicks"
            data={toLineData(c.daily_clicks || [])}
            info={E.dailyClicks}
          />,
          <LineChart
            key="clicks-6mo"
            title="Monthly clicks (last 6 mo)"
            valueLabel="Clicks"
            data={(c.monthly_clicks || []).map((m: any) => ({
              label: m.month?.slice(5) || m.month,
              value: m.clicks,
            }))}
            info={E.monthlyClicks}
          />,
          <MetricTable
            key="sources"
            title="Clicks by source"
            valueHeader="Clicks"
            info={E.clicksBySource}
            rows={(c.clicks_by_source || []).map((r: any) => ({
              label: r.source_page,
              value: r.clicks,
            }))}
            maxHeight={360}
          />,
          <MetricTable
            key="top-products"
            title="Top-clicked products"
            valueHeader="Clicks"
            info={E.topProducts}
            rows={(c.top_products || []).map((p: any) => ({
              label: p.coffee_name || p.product_id,
              sub: p.roaster_name || p.roaster_slug,
              value: p.clicks,
            }))}
            maxHeight={360}
          />,
        ]}
      />
    </View>
  );
}

function renderLoyalty(stats: any, basis: any) {
  const l = stats.loyalty;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Stamps" value={l.total_stamps} info={E.totalStamps} />
          <Card basis={basis} label="Last 7 days" value={l.stamps_7d} info={E.stamps7} />
          <Card basis={basis} label="Last 30 days" value={l.stamps_30d} info={E.stamps30} />
          <Card basis={basis} label="Last 90 days" value={l.stamps_90d} info={E.stamps90} />
          <Card basis={basis} label="Unique Stamped Users" value={l.unique_stamped_users} info={E.uniqueStamped} />
          <Card basis={basis} label="Avg Stamps / User" value={l.avg_stamps_per_user} info={E.avgStampsPerUser} />
          <Card basis={basis} label="Loyal (3+ at a café)" value={l.loyal_cohort_3_plus} info={E.loyalCohort} />
          <Card basis={basis} label="Avg Days Between Stamps" value={l.avg_days_between_stamps || "—"} info={E.avgBetween} />
          <Card basis={basis} label="Rewards Redeemed" value={l.rewards_redeemed} info={E.rewardsRedeemed} />
          <Card basis={basis} label="Reward Conversion" value={`${l.reward_conversion_pct}%`} hint="% of stamped users who reached target" info={E.rewardConversion} />
        </>,
      )}
      <Text style={s.sectionHead}>Plots</Text>
      <PlotCarousel
        slides={[
          <LineChart
            key="stamps-90d"
            title="Daily stamps (90d)"
            valueLabel="Stamps"
            data={toLineData(l.daily_stamps || [])}
            info={E.dailyStamps}
          />,
          <MetricTable
            key="top-cafes"
            title="Top cafés by stamp volume"
            valueHeader="Stamps"
            info={E.topCafes}
            rows={(l.top_cafes || []).map((c: any) => ({
              label: c.name,
              sub: c.city,
              value: c.stamps,
            }))}
            maxHeight={360}
          />,
        ]}
      />
    </View>
  );
}

function renderNetwork(stats: any, basis: any) {
  const n = stats.network;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Total Follow Edges" value={n.total_follows} info={E.totalFollows} />
          <Card basis={basis} label="Users Following Anyone" value={n.unique_followers} info={E.uniqueFollowers} />
          <Card basis={basis} label="Avg Follows / User" value={n.avg_follows_per_user} info={E.avgFollowsPerUser} />
          <Card basis={basis} label="Reciprocal Pairs" value={n.reciprocal_pairs} hint="Friend-graph signal" info={E.reciprocal} />
          <Card basis="100%" label="User pairs sharing ≥3 shelf products" value={n.shared_shelf_pairs_3_plus} hint="Candidate friend-pairs by taste overlap" info={E.sharedShelf} />
        </>,
      )}
      <Text style={s.sectionHead}>Rankings</Text>
      <PlotCarousel
        slides={[
          <MetricTable
            key="top-roasters"
            title="Top roasters by followers"
            valueHeader="Followers"
            info={E.topRoasters}
            rows={(n.top_roasters || []).map((r: any) => ({
              label: r.name,
              sub: r.city,
              value: r.followers,
            }))}
            maxHeight={360}
          />,
          ...((n.top_cafes || []).length > 0
            ? [
                <MetricTable
                  key="top-cafes"
                  title="Top cafés by followers"
                  valueHeader="Followers"
                  info={E.topFollowedCafes}
                  rows={(n.top_cafes || []).map((c: any) => ({
                    label: c.name,
                    sub: c.city,
                    value: c.followers,
                  }))}
                  maxHeight={360}
                />,
              ]
            : []),
        ]}
      />
    </View>
  );
}

function renderRetention(stats: any, basis: any) {
  const r = stats.retention;
  const cohortsOldFirst = [...(r.cohorts || [])].reverse();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Writers (≥1 note)" value={r.writers_total} info={E.writers} />
          <Card basis={basis} label="Writer Retention · 30d" value={`${r.writer_retention_30d_pct}%`} hint="% who wrote a second note within 30d" info={E.writerRetention} />
          <Card basis={basis} label="First → Second Stamp · avg days" value={r.avg_first_to_second_stamp_days || "—"} info={E.firstToSecondStamp} />
          <Card basis={basis} label="Cohorts Tracked" value={(r.cohorts || []).length} info={E.weeklyCohorts} />
        </>,
      )}
      <Text style={s.sectionHead}>Plots</Text>
      <PlotCarousel
        slides={[
          <LineChart
            key="d7"
            title="D7 retention by cohort"
            valueLabel="D7 %"
            data={cohortsOldFirst.map((c: any) => ({
              label: c.week_start?.slice(5) || c.week,
              value: c.d7_pct ?? 0,
            }))}
            info={E.d7Series}
          />,
          <LineChart
            key="d30"
            title="D30 retention by cohort"
            valueLabel="D30 %"
            data={cohortsOldFirst.map((c: any) => ({
              label: c.week_start?.slice(5) || c.week,
              value: c.d30_pct ?? 0,
            }))}
            info={E.d30Series}
          />,
          <LineChart
            key="signups"
            title="Signups per week"
            valueLabel="Signups"
            data={cohortsOldFirst.map((c: any) => ({
              label: c.week_start?.slice(5) || c.week,
              value: c.signups ?? 0,
            }))}
            info={E.signupsSeries}
          />,
          <RetentionTable
            key="grid"
            cohorts={r.cohorts || []}
            info={E.weeklyCohorts}
          />,
        ]}
      />
    </View>
  );
}

function renderSupply(stats: any, basis: any) {
  const sup = stats.supply;
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Text style={s.sectionHead}>Headline</Text>
      {grid(
        <>
          <Card basis={basis} label="Roasters in Catalog" value={sup.roasters_total} info={E.roastersTotal} />
          <Card basis={basis} label="With Profile" value={sup.roasters_with_profiles} info={E.roastersProfiles} />
          <Card basis={basis} label="With Active Products" value={sup.roasters_with_products} info={E.roastersProducts} />
          <Card basis={basis} label="With Followers" value={sup.roasters_with_followers} info={E.roastersFollowers} />
          <Card basis={basis} label="Products Total" value={sup.products_total} info={E.productsTotal} />
          <Card basis={basis} label="Available" value={sup.products_available} info={E.productsAvailable} />
          <Card basis={basis} label="On a Shelf" value={sup.products_with_shelf_entry} info={E.productsShelf} />
          <Card basis={basis} label="With Tasting Note" value={sup.products_with_tasting_note} info={E.productsNote} />
          <Card basis={basis} label="Cafés Total" value={sup.cafes_total} info={E.cafesTotal} />
          <Card basis={basis} label="Stamps Enabled" value={sup.cafes_stamps_enabled} info={E.cafesStamps} />
          <Card basis={basis} label="With Any Stamp" value={sup.cafes_with_any_stamp} info={E.cafesAnyStamp} />
          <Card basis={basis} label="Avg Menu Items" value={sup.avg_menu_items_per_cafe} info={E.avgMenu} />
          <Card basis={basis} label="Sourcing From Catalog" value={sup.cafes_using_catalog_roasters} info={E.cafesCatalog} />
          <Card basis={basis} label="Ecosystem Density" value={`${sup.ecosystem_density_pct}%`} hint="% of cafés pouring a catalog roaster" info={E.ecosystemDensity} />
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
  info,
}: {
  basis: string;
  label: string;
  value: string | number;
  hint?: string;
  info?: string;
}) {
  return (
    <View style={{ flexBasis: basis as any, flexGrow: 1, minWidth: 180 } as any}>
      <MetricCard
        label={label}
        value={value}
        hint={hint}
        info={info}
        wide={basis === "100%"}
      />
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
    backgroundColor: t.color["text.primary"],
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
});
