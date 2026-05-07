/**
 * Catalog Ops · ARTICLES sub-tab.
 *
 * Mirrors the structural moves of Roasters & Beans (Onboard hero +
 * roaster-row list + collapsible "recent runs" feed) but the actions
 * scope to the journal-scrape pipeline:
 *
 *   • Hero "Refresh ALL article feeds" CTA — bulk POSTs
 *     /admin/articles/scrape-all. The same conflict gate as the
 *     catalog scrape: only one article_scrape can be live at a time.
 *
 *   • Per-roaster rows — show how many articles we've scraped, when
 *     the feed was last refreshed, and a per-row Refresh button
 *     that POSTs /admin/roasters/{slug}/scrape-articles. Tap the
 *     row to drop into the per-roaster admin page (where article-
 *     level curation will live in a follow-up).
 *
 *   • RecentEnrichmentRuns — same widget as Roasters & Beans, scoped
 *     to kind='article_scrape' so the live-job badge + result
 *     summaries surface journal runs only.
 *
 * Every visual value reads from useTokens. Token discipline matches
 * the rest of the admin surface (brand colors only + approved
 * neutrals + the Crema-pink Refresh accent that already lives in
 * RoastersPanel's hero CTA pattern).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { RefreshCw } from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { useResource } from "../../resources/useResource";
import type {
  CatalogJob,
  RoasterProfile,
  RoasterSource,
} from "../../resources/types";
import RoasterLogo from "../primitives/RoasterLogo";
import { formatRelative, RecentEnrichmentRuns } from "./JobHistory";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";

export default function ArticlesPanel() {
  const router = useRouter();
  const s = useStyles();

  const roasters = useResource<RoasterProfile>("roaster_profiles", {
    limit: 500,
  });
  const sources = useResource<RoasterSource>("roaster_sources", {
    limit: 500,
  });
  const jobs = useResource<CatalogJob>("jobs", { limit: 50 });

  // Silent refetch on focus — same SWR pattern Catalog Ops uses
  // throughout. The admin can run a refresh, switch tabs, come
  // back, and see the new state without a loading flicker.
  useFocusEffect(
    useCallback(() => {
      roasters.refetch({ silent: true });
      sources.refetch({ silent: true });
      jobs.refetch({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Live = an in-flight article_scrape job. The bulk Refresh CTA
  // below disables itself while one is live, and the Refresh button
  // on each row also disables — only one article_scrape at a time
  // (backend enforces via JobConflict 409, but we hide the UI state
  // upfront so the admin never gets to see the conflict).
  const liveJob = useMemo(
    () =>
      (jobs.data ?? []).find(
        (j) =>
          (j.kind as any) === "article_scrape" &&
          (j.status === "queued" || j.status === "running"),
      ),
    [jobs.data],
  );
  const isLive = !!liveJob;

  // Poll while live so the per-roaster row counts update in
  // near-real-time as the runner upserts articles. Mirrors the
  // pattern in StandardizationPanel + RoastersPanel.
  useEffect(() => {
    if (!liveJob) return;
    const id = setInterval(() => {
      jobs.refetch({ silent: true });
      sources.refetch({ silent: true });
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJob?.id]);

  // Track which slug's per-row Refresh button kicked off a job, so
  // the spinner stays on the right row while the request is in
  // flight (the response comes back before `jobs` re-polls).
  const [submittingSlug, setSubmittingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = async () => {
    if (isLive) return;
    hapticCommit();
    setError(null);
    setSubmittingSlug("__all__");
    try {
      await apiFetchRaw("/admin/articles/scrape-all", { method: "POST" });
      jobs.refetch({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Failed to start article scrape");
    } finally {
      setSubmittingSlug(null);
    }
  };

  const refreshOne = async (slug: string) => {
    if (isLive) return;
    hapticCommit();
    setError(null);
    setSubmittingSlug(slug);
    try {
      await apiFetchRaw(
        `/admin/roasters/${encodeURIComponent(slug)}/scrape-articles`,
        { method: "POST" },
      );
      jobs.refetch({ silent: true });
    } catch (e: any) {
      setError(e?.message || `Failed to scrape ${slug}`);
    } finally {
      setSubmittingSlug(null);
    }
  };

  // Join sources to profiles by website. Profiles without a matching
  // source row (the legacy 121-roaster seed that predates the
  // sources table) appear with all article fields null — which the
  // row component renders as "Never scraped". Sort: sources whose
  // last_articles_scraped_at is oldest (or null) first, so the
  // admin's eye lands on the staleest roasters at the top.
  const rows = useMemo(() => {
    const byWebsite = new Map<string, RoasterSource>();
    for (const src of sources.data ?? []) {
      if (src.website) byWebsite.set(src.website, src);
    }
    type Row = {
      slug: string;
      name: string;
      city: string | null;
      state: string | null;
      logo_url: string | null;
      articles_count: number;
      last_articles_scraped_at: string | null;
      articles_feed_kind: string | null;
    };
    const list: Row[] = (roasters.data ?? []).map((p) => {
      const src = p.website ? byWebsite.get(p.website) : undefined;
      return {
        slug: p.roaster_slug,
        name: p.name || p.roaster_slug,
        city: p.city,
        state: p.state,
        logo_url: p.logo_url || null,
        articles_count: src?.articles_count ?? 0,
        last_articles_scraped_at: src?.last_articles_scraped_at ?? null,
        articles_feed_kind: src?.articles_feed_kind ?? null,
      };
    });
    list.sort((a, b) => {
      // Never-scraped first, then oldest-scraped first.
      const ta = a.last_articles_scraped_at
        ? Date.parse(a.last_articles_scraped_at)
        : -1;
      const tb = b.last_articles_scraped_at
        ? Date.parse(b.last_articles_scraped_at)
        : -1;
      return ta - tb;
    });
    return list;
  }, [roasters.data, sources.data]);

  const totalArticles = useMemo(
    () => rows.reduce((acc, r) => acc + (r.articles_count || 0), 0),
    [rows],
  );

  return (
    <View style={{ gap: t.spacing["2xl"] }}>
      {/* ── Hero: Refresh ALL article feeds ───────────────────────────── */}
      <View style={s.hero}>
        <View style={{ flex: 1 }}>
          <Text style={s.heroTitle}>Refresh Articles</Text>
          <Text style={s.heroBlurb}>
            {totalArticles > 0
              ? `${totalArticles} article${totalArticles === 1 ? "" : "s"} stored across ${rows.length} roaster${rows.length === 1 ? "" : "s"}.`
              : "No articles stored yet — kick a refresh to discover roaster blogs and journals."}
          </Text>
        </View>
        <Pressable
          onPress={refreshAll}
          disabled={isLive || submittingSlug !== null}
          style={({ pressed }) => [
            s.heroCta,
            (isLive || submittingSlug !== null) && s.heroCtaDisabled,
            pressed && !isLive && s.heroCtaPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Refresh all article feeds"
        >
          {isLive || submittingSlug === "__all__" ? (
            <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
          ) : (
            <RefreshCw
              size={t.size["icon.md"]}
              color={t.color["text.on-cta"]}
              strokeWidth={2}
            />
          )}
          <Text style={s.heroCtaLabel}>
            {isLive ? "Running…" : "Refresh ALL"}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={s.errorText}>{error}</Text> : null}

      {/* ── Per-roaster list ──────────────────────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Roasters</Text>
        <Text style={s.sectionMeta}>
          {rows.length} roaster{rows.length === 1 ? "" : "s"}
        </Text>
      </View>

      {roasters.loading && rows.length === 0 ? (
        <View style={s.emptyBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : rows.length === 0 ? (
        <Text style={s.emptyText}>Nothing here yet.</Text>
      ) : (
        <View style={s.rowList}>
          {rows.map((r, idx) => (
            <ArticleRoasterRow
              key={r.slug}
              row={r}
              isLastRow={idx === rows.length - 1}
              isSubmitting={submittingSlug === r.slug}
              isLive={isLive}
              onTap={() =>
                router.push(`/admin/roaster/${encodeURIComponent(r.slug)}`)
              }
              onRefresh={() => refreshOne(r.slug)}
            />
          ))}
        </View>
      )}

      {/* ── Recent article runs ───────────────────────────────────────── */}
      <RecentEnrichmentRuns
        kinds={["article_scrape"]}
        title="Recent article runs"
      />
    </View>
  );
}


// ── Per-roaster row ────────────────────────────────────────────────────────
//
// Custom layout: logo + name/city/article-stats + Refresh button +
// hairline divider. Closer to RoasterRow than not, but the right side
// is a Refresh action button instead of the standard arrow disclosure
// — the admin's primary verb here is "scrape", not "view profile".
// Tapping the row body still routes to /admin/roaster/{slug} for now
// (where article-level curation will live in a follow-up).

type ArticleRoasterRowProps = {
  row: {
    slug: string;
    name: string;
    city: string | null;
    state: string | null;
    logo_url: string | null;
    articles_count: number;
    last_articles_scraped_at: string | null;
    articles_feed_kind: string | null;
  };
  isLastRow: boolean;
  isSubmitting: boolean;
  isLive: boolean;
  onTap: () => void;
  onRefresh: () => void;
};

function ArticleRoasterRow({
  row,
  isLastRow,
  isSubmitting,
  isLive,
  onTap,
  onRefresh,
}: ArticleRoasterRowProps) {
  const s = useStyles();
  const cityState = [row.city, row.state].filter(Boolean).join(", ");
  const articlesLine =
    row.articles_count > 0
      ? `${row.articles_count} article${row.articles_count === 1 ? "" : "s"}`
      : row.last_articles_scraped_at
        ? "0 articles"
        : "Never scraped";
  const lastLine = row.last_articles_scraped_at
    ? `Refreshed ${formatRelative(row.last_articles_scraped_at)}`
    : null;
  const feedKindLine = row.articles_feed_kind
    ? `via ${row.articles_feed_kind}`
    : null;

  const refreshDisabled = isLive || isSubmitting;

  return (
    <Pressable
      onPress={() => {
        hapticTap();
        onTap();
      }}
      style={({ pressed }) => [s.row, pressed && s.rowActive]}
      accessibilityLabel={`Open ${row.name}`}
    >
      <RoasterLogo url={row.logo_url} size={72} fallbackInitial={row.name} />

      <View style={s.info}>
        <Text style={s.rowName} numberOfLines={1}>
          {row.name}
        </Text>
        {cityState ? (
          <Text style={s.rowSub} numberOfLines={1}>
            {cityState}
          </Text>
        ) : null}
        <Text style={s.rowSub} numberOfLines={1}>
          {articlesLine}
          {lastLine ? ` · ${lastLine}` : ""}
          {feedKindLine ? ` · ${feedKindLine}` : ""}
        </Text>
      </View>

      <Pressable
        onPress={(e) => {
          // Stop the parent row's onPress (don't navigate when the
          // user wanted Refresh).
          (e as any)?.stopPropagation?.();
          if (refreshDisabled) return;
          onRefresh();
        }}
        disabled={refreshDisabled}
        style={({ pressed }) => [
          s.rowCta,
          refreshDisabled && s.rowCtaDisabled,
          pressed && !refreshDisabled && s.rowCtaPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Refresh articles for ${row.name}`}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        ) : (
          <RefreshCw
            size={t.size["icon.sm"]}
            color={t.color["text.primary"]}
            strokeWidth={1.75}
          />
        )}
      </Pressable>

      {!isLastRow ? <View style={s.divider} /> : null}
    </Pressable>
  );
}


// ── Styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.lg,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
  } as any,
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
  },
  heroBlurb: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    marginTop: t.spacing["2xs"],
  },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    backgroundColor: t.color["accent.cta"],
  } as any,
  heroCtaDisabled: { opacity: 0.55 },
  heroCtaPressed: { opacity: 0.8 },
  heroCtaLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: t.color["text.on-cta"],
  },
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    fontStyle: "italic",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: t.spacing.md,
  },
  sectionTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  },
  sectionMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  },
  emptyBlock: {
    alignItems: "center",
    paddingVertical: t.spacing["2xl"],
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing["2xl"],
  },
  rowList: {
    width: "100%" as any,
  } as any,
  row: {
    width: "100%" as any,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    backgroundColor: "transparent",
    position: "relative",
    cursor: "pointer" as any,
  } as any,
  rowActive: { backgroundColor: t.color.flash } as any,
  info: { flex: 1, minWidth: 0, gap: t.spacing["2xs"] } as any,
  rowName: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  },
  rowSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  rowCta: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    flexShrink: 0,
  } as any,
  rowCtaDisabled: { opacity: 0.4 },
  rowCtaPressed: { backgroundColor: t.color.flash },
  divider: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,
}));
