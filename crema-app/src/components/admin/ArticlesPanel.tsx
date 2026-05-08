/**
 * Catalog Ops · JOURNALS sub-tab (v3).
 *
 * Layout shape:
 *
 *   1. Section header — "{N} articles stored across {M} roasters" line
 *      + Filter trigger (SlidersHorizontal) on the right. When any
 *      checkboxes are ticked, a selection strip shows below it with
 *      "{K} selected" + a Clear pill.
 *
 *   2. Roaster list — one row per published roaster (filtered via
 *      drawer). Each row: multi-select checkbox · logo · name/meta ·
 *      per-row Refresh button · expand chevron. Tap row body =
 *      expand inline.
 *
 *   3. Inline expand on row tap — drops below the row, no navigation.
 *      Site-quirk hint card with a perpetual "Regenerate on next
 *      scrape" toggle (server-side flag, persists across admins) +
 *      per-article controls (publish / re-enrich / delete).
 *
 *   4. Recent runs feed — RecentEnrichmentRuns scoped to
 *      kind='article_scrape'.
 *
 *   5. Floating Refresh FAB — pinned to the bottom-right of this
 *      sub-tab while it's mounted. position:fixed on web (sticks to
 *      viewport), position:absolute on native (anchors to panel root).
 *      When selectedSlugs is empty → POST /admin/articles/scrape-all
 *      with no body (= every published roaster). Non-empty → POST
 *      `roaster_slugs`. Hidden on other sub-tabs because the panel
 *      unmounts.
 *
 *   6. Filter drawer — SlidePanel mirrored from RoastersPanel,
 *      with four axes: article volume, last scraped staleness, hint
 *      state, and feed kind.
 *
 * Token discipline: every visual value reads from useTokens. No hex
 * literals inline. Brand pink (`accent.cta`) is reserved for the
 * "selected" checkbox tick + the FAB fill (mirroring RoastersPanel's
 * Onboard CTA style). Off-topic / failed badges use neutral textual
 * styling — no red signal, admin decides what's wrong.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  Trash2,
  X,
  SlidersHorizontal,
} from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../../api/client";
import { useResource } from "../../resources/useResource";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { thumbnailUrl } from "../../utils/imageUrl";
import type {
  ArticleHint,
  CatalogJob,
  RoasterArticle,
  RoasterProfile,
  RoasterSource,
} from "../../resources/types";
import RoasterLogo from "../primitives/RoasterLogo";
import SlidePanel from "../mobile/SlidePanel";
import { formatRelative, RecentEnrichmentRuns } from "./JobHistory";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";
import { useFloatingFab } from "../../contexts/FloatingFabContext";
import FabPill from "../primitives/FabPill";


// ── Filter axis types ─────────────────────────────────────────────────
//
// Each axis is single-select except feed-kind (multi). Drawer matches
// RoastersPanel's three-axis pattern; we have four axes because the
// Journals sub-tab cares more about source-state (no feed → can't
// scrape, has hint → enrichment is steady) than RoastersPanel does.
type VolumeFilter = "any" | "has_articles" | "no_articles";
type ScrapedFilter =
  | "any" | "recent_7d" | "stale_7d" | "stale_30d" | "never";
type HintFilter = "any" | "has_hint" | "no_hint";

const VOLUME_OPTIONS: { key: VolumeFilter; label: (n: number) => string }[] = [
  { key: "any", label: (n) => `Any (${n})` },
  { key: "has_articles", label: (n) => `Has articles (${n})` },
  { key: "no_articles", label: (n) => `No articles (${n})` },
];

const SCRAPED_OPTIONS: { key: ScrapedFilter; label: string }[] = [
  { key: "any", label: "Any time" },
  { key: "recent_7d", label: "Within last 7 days" },
  { key: "stale_7d", label: "Older than 7 days" },
  { key: "stale_30d", label: "Older than 30 days" },
  { key: "never", label: "Never scraped" },
];

const HINT_OPTIONS: { key: HintFilter; label: (n: number) => string }[] = [
  { key: "any", label: (n) => `Any (${n})` },
  { key: "has_hint", label: (n) => `Has site hint (${n})` },
  { key: "no_hint", label: (n) => `No site hint (${n})` },
];

export default function ArticlesPanel() {
  const s = useStyles();
  const { isMobile } = useBreakpoint();

  const roasters = useResource<RoasterProfile>("roaster_profiles", {
    limit: 500,
  });
  const sources = useResource<RoasterSource>("roaster_sources", {
    limit: 500,
  });
  const jobs = useResource<CatalogJob>("jobs", { limit: 50 });

  useFocusEffect(
    useCallback(() => {
      roasters.refetch({ silent: true });
      sources.refetch({ silent: true });
      jobs.refetch({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Live = an in-flight article_scrape job. The bulk Refresh CTA and
  // every per-row Refresh button disable while one's live.
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

  // Poll while live so the per-roaster row counts + expanded article
  // lists update in near-real-time.
  useEffect(() => {
    if (!liveJob) return;
    const id = setInterval(() => {
      jobs.refetch({ silent: true });
      sources.refetch({ silent: true });
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJob?.id]);

  const [submittingSlug, setSubmittingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multi-select state. Set of roaster slugs currently checked. Empty
  // = nothing selected → FAB scopes to "all published". Non-empty →
  // FAB scopes to those slugs.
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  // Expanded-row state. Single-row expansion — opening a second
  // collapses the first, so the admin always sees one expanded panel
  // at a time.
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  // Filter drawer state — mirrors RoastersPanel's filter pattern
  // (see crema-app/src/components/admin/RoastersPanel.tsx). Each
  // axis is single-select; the drawer's "active" dot lights up when
  // any axis is non-default.
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [volumeFilter, setVolumeFilter] = useState<VolumeFilter>("any");
  const [scrapedFilter, setScrapedFilter] = useState<ScrapedFilter>("any");
  const [hintFilter, setHintFilter] = useState<HintFilter>("any");
  const [feedKindFilter, setFeedKindFilter] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleSelect = useCallback((slug: string) => {
    hapticTap();
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedSlugs(new Set());
  }, []);

  const toggleExpand = useCallback((slug: string) => {
    hapticTap();
    setExpandedSlug((prev) => (prev === slug ? null : slug));
  }, []);

  const refreshScoped = useCallback(
    async (slugs: string[] | null) => {
      if (isLive) return;
      hapticCommit();
      setError(null);
      const tag = slugs && slugs.length === 1 ? slugs[0] : "__bulk__";
      setSubmittingSlug(tag);
      try {
        await apiFetchRaw("/admin/articles/scrape-all", {
          method: "POST",
          body: JSON.stringify(
            slugs && slugs.length > 0
              ? { roaster_slugs: slugs }
              : {},
          ),
          headers: { "Content-Type": "application/json" },
        });
        clearSelection();
        jobs.refetch({ silent: true });
      } catch (e: any) {
        setError(e?.message || "Failed to start article scrape");
      } finally {
        setSubmittingSlug(null);
      }
    },
    [isLive, jobs, clearSelection],
  );

  // Join sources to profiles by website (only for `articles_feed_kind`
  // and the source-side scrape attempt time — those have no equivalent
  // on `roaster_articles`). Article count + most-recent scraped-at time
  // come from the new `articles_count_live` / `last_article_scraped_at`
  // subfields on `roaster_profiles`, which are computed live from
  // `roaster_articles` keyed by `roaster_slug` — that bypasses the
  // `roaster_sources.articles_count` cache that can fall out of sync
  // with reality (articles written via paths that don't stamp the
  // cache leave the row at 0 forever).
  const rows = useMemo(() => {
    const byWebsite = new Map<string, RoasterSource>();
    for (const src of sources.data ?? []) {
      if (src.website) byWebsite.set(src.website, src);
    }
    const list: Row[] = (roasters.data ?? []).map((p) => {
      const src = p.website ? byWebsite.get(p.website) : undefined;
      const liveCount = (p as any).articles_count_live ?? 0;
      const liveLast = (p as any).last_article_scraped_at ?? null;
      return {
        slug: p.roaster_slug,
        name: p.name || p.roaster_slug,
        city: p.city,
        state: p.state,
        logo_url: p.logo_url || null,
        articles_count: liveCount,
        last_articles_scraped_at: liveLast,
        // Source-side scrape-attempt time, distinct from the
        // article-side max(scraped_at). Used to differentiate
        // "scrape was attempted but landed nothing" from "scrape
        // never ran at all".
        source_last_scrape_attempt: src?.last_articles_scraped_at ?? null,
        articles_feed_kind: src?.articles_feed_kind ?? null,
        has_feed_discovered: !!(src?.articles_index_url),
        has_article_hint: !!(p as any).article_enrichment_prompt_hint,
      };
    });
    // Sort surfaces stale-or-empty first: roasters with NO articles AND
    // a feed discovered (the actionable case) → roasters with no feed →
    // roasters with articles, oldest first.
    list.sort((a, b) => {
      const aMissing = a.articles_count === 0;
      const bMissing = b.articles_count === 0;
      if (aMissing !== bMissing) return aMissing ? -1 : 1;
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

  // Filter axis evaluation. Each axis closes over its own setter +
  // current value; we apply them in order so counts can roll up.
  const filteredRows = useMemo(() => {
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    return rows.filter((r) => {
      // Volume axis.
      if (volumeFilter === "has_articles" && r.articles_count <= 0) return false;
      if (volumeFilter === "no_articles" && r.articles_count > 0) return false;
      // Scraped-staleness axis.
      const scrapedAt = r.last_articles_scraped_at
        ? Date.parse(r.last_articles_scraped_at)
        : null;
      if (scrapedFilter === "never" && scrapedAt !== null) return false;
      if (scrapedFilter === "recent_7d") {
        if (scrapedAt === null) return false;
        if (now - scrapedAt > SEVEN_DAYS) return false;
      }
      if (scrapedFilter === "stale_7d") {
        if (scrapedAt === null) return false;
        if (now - scrapedAt < SEVEN_DAYS) return false;
      }
      if (scrapedFilter === "stale_30d") {
        if (scrapedAt === null) return false;
        if (now - scrapedAt < THIRTY_DAYS) return false;
      }
      // Hint-state axis.
      if (hintFilter === "has_hint" && !r.has_article_hint) return false;
      if (hintFilter === "no_hint" && r.has_article_hint) return false;
      // Feed-kind axis (multi-select; empty set = "any").
      if (feedKindFilter.size > 0) {
        const kind = r.articles_feed_kind || "unknown";
        if (!feedKindFilter.has(kind)) return false;
      }
      return true;
    });
  }, [rows, volumeFilter, scrapedFilter, hintFilter, feedKindFilter]);

  // Counts for drawer labels — pre-filter, so each axis shows how
  // many rows would be visible if it were the only active filter.
  // Same shape as RoastersPanel's `counts` map.
  const counts = useMemo(() => {
    return {
      total: rows.length,
      has_articles: rows.filter((r) => r.articles_count > 0).length,
      no_articles: rows.filter((r) => r.articles_count <= 0).length,
      has_hint: rows.filter((r) => r.has_article_hint).length,
      no_hint: rows.filter((r) => !r.has_article_hint).length,
    };
  }, [rows]);

  // Distinct feed kinds present in the corpus. Sorted for stable
  // drawer order; "unknown" is always last so it doesn't bury the
  // real platforms.
  const feedKinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.articles_feed_kind || "unknown");
    const arr = Array.from(set);
    arr.sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return a.localeCompare(b);
    });
    return arr;
  }, [rows]);

  const activeFilterCount =
    (volumeFilter !== "any" ? 1 : 0) +
    (scrapedFilter !== "any" ? 1 : 0) +
    (hintFilter !== "any" ? 1 : 0) +
    (feedKindFilter.size > 0 ? 1 : 0);

  const resetFilters = useCallback(() => {
    setVolumeFilter("any");
    setScrapedFilter("any");
    setHintFilter("any");
    setFeedKindFilter(new Set());
  }, []);

  const toggleFeedKind = useCallback((kind: string) => {
    hapticTap();
    setFeedKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const totalArticles = useMemo(
    () => rows.reduce((acc, r) => acc + (r.articles_count || 0), 0),
    [rows],
  );

  const selectedCount = selectedSlugs.size;
  // Section meta sentence — "179 articles stored across 102 roasters",
  // or the selection state when checkboxes are ticked. The user's
  // explicit ask: where the old hero title was, surface this count.
  const sectionMeta =
    selectedCount > 0
      ? `${selectedCount} of ${rows.length} selected`
      : totalArticles > 0
        ? `${totalArticles.toLocaleString()} article${totalArticles === 1 ? "" : "s"} stored across ${rows.length} roaster${rows.length === 1 ? "" : "s"}`
        : "No articles stored yet";

  // Register the floating Refresh FAB at the root-layout
  // FloatingFabProvider (§2.40.18). The hook clears on unmount,
  // so flipping to a different admin sub-tab takes the FAB with
  // it. Anchored to the relative wrapper's stable bottom edge so
  // the prior chrome-scroll jitter is gone.
  //
  // Visual: matches the home/profile/roaster "Create post" pill —
  // Crema-pink bg, "Refresh" label, RefreshCw icon (or
  // ActivityIndicator while in flight). The selection count is
  // already shown above the rows in the selection strip ("{K}
  // selected · Clear"); the pill itself stays simple per the
  // user's "in the same fashion as the create post button" spec.
  const fabDisabled = isLive || submittingSlug !== null;
  const isBulkSubmitting = isLive || submittingSlug === "__bulk__";

  // Live cancel state. The Stop button writes `jobs.cancel_requested=1`
  // optimistically (server is the source of truth — `liveJob.cancel_requested`
  // is the authoritative read). While the request is in flight, both
  // are true and the button shows "Stopping…".
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const liveCancelRequested =
    (liveJob?.cancel_requested ?? 0) === 1 || cancelInFlight;
  const cancelLiveJob = useCallback(async () => {
    if (!liveJob || liveCancelRequested) return;
    hapticCommit();
    setCancelInFlight(true);
    try {
      await apiFetchRaw(`/admin/jobs/${liveJob.id}/cancel`, { method: "POST" });
      jobs.refetch({ silent: true });
    } catch {
      // Server rejected (e.g. already finished) — clear in-flight so
      // the banner re-syncs from the next poll.
    } finally {
      setCancelInFlight(false);
    }
  }, [liveJob, liveCancelRequested, jobs]);
  useFloatingFab(
    <FabPill
      icon={
        isBulkSubmitting ? (
          <ActivityIndicator size="small" color={t.color["text.on-light"]} />
        ) : (
          <RefreshCw
            size={17}
            color={t.color["text.on-light"]}
            strokeWidth={2.25}
          />
        )
      }
      label="Refresh"
      onPress={() =>
        refreshScoped(
          selectedCount > 0 ? Array.from(selectedSlugs) : null,
        )
      }
      disabled={fabDisabled}
      style={{ position: "absolute" as any, bottom: 28, right: 28 }}
      accessibilityLabel={
        selectedCount > 0
          ? `Refresh ${selectedCount} selected roasters`
          : "Refresh all article feeds"
      }
    />,
  );

  return (
    <View style={s.panelRoot}>
      {/* ── Section header — count + filter trigger ───────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{sectionMeta}</Text>
        <Pressable
          onPress={() => {
            hapticTap();
            setFilterDrawerOpen(true);
          }}
          style={({ pressed }) => [
            s.filterIconBtn,
            pressed && s.filterIconBtnPressed,
          ]}
          hitSlop={8}
          accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
          accessibilityRole="button"
        >
          <SlidersHorizontal
            size={t.size["icon.lg"]}
            color={t.color["text.primary"]}
            strokeWidth={1.75}
          />
          {activeFilterCount > 0 ? <View style={s.filterIconDot} /> : null}
        </Pressable>
      </View>

      {/* ── Live progress banner — replaces the opaque "running" badge
           with the current roaster + a Stop button. Renders only while
           a job is in flight. The runner stamps `jobs.current_target`
           per-source, so the label updates with each iteration. ─── */}
      {isLive ? (
        <View style={s.liveBanner}>
          <View style={s.livePulseDot} />
          <Text style={s.liveBannerLabel} numberOfLines={1}>
            {liveJob?.current_target
              ? `Looking at ${liveJob.current_target}`
              : liveJob?.status === "queued"
                ? "Queued — starting soon"
                : "Starting…"}
          </Text>
          <Pressable
            onPress={cancelLiveJob}
            disabled={liveCancelRequested}
            style={({ pressed }) => [
              s.stopPill,
              liveCancelRequested && s.stopPillDisabled,
              pressed && !liveCancelRequested && s.stopPillPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              liveCancelRequested ? "Stopping…" : "Stop scrape"
            }
          >
            {liveCancelRequested ? (
              <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
            ) : (
              <X
                size={t.size["icon.sm"]}
                color={t.color["text.on-cta"]}
                strokeWidth={2.25}
              />
            )}
            <Text style={s.stopPillLabel}>
              {liveCancelRequested ? "Stopping" : "Stop"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Selection strip — only when something's checked.
           Sits inline above the row list so the user can clear without
           hunting for a button at the bottom of the FAB. ──────────── */}
      {selectedCount > 0 ? (
        <View style={s.selectionStrip}>
          <Text style={s.selectionLabel}>
            {selectedCount} selected
          </Text>
          <Pressable
            onPress={clearSelection}
            style={({ pressed }) => [
              s.clearPill,
              pressed && s.clearPillPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear selection"
          >
            <Text style={s.clearPillLabel}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={s.errorText}>{error}</Text> : null}

      {/* ── Roaster rows ─────────────────────────────────────────────── */}
      {roasters.loading && filteredRows.length === 0 ? (
        <View style={s.emptyBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : filteredRows.length === 0 ? (
        <Text style={s.emptyText}>
          {activeFilterCount > 0
            ? "No roasters match the current filters."
            : "Nothing here yet."}
        </Text>
      ) : (
        <View style={s.rowList}>
          {filteredRows.map((r, idx) => (
            <ArticleRoasterRow
              key={r.slug}
              row={r}
              isLastRow={idx === filteredRows.length - 1}
              isSelected={selectedSlugs.has(r.slug)}
              isExpanded={expandedSlug === r.slug}
              onToggleSelect={() => toggleSelect(r.slug)}
              onToggleExpand={() => toggleExpand(r.slug)}
            />
          ))}
        </View>
      )}

      {/* ── Recent article runs ───────────────────────────────────────── */}
      <RecentEnrichmentRuns
        kinds={["article_scrape"]}
        title="Recent article runs"
      />

      {/* The FAB is registered via useFloatingFab above (see hook
           call in the panel body). It's rendered by FloatingFabProvider
           in profile.tsx as a sibling of the page ScrollView, so
           position:absolute on it anchors to the viewport-filling
           container. Symbol-only (no text), same espresso fill +
           cream icon as the post FAB on `app/(tabs)/index.tsx`. */}

      {/* ── Filter drawer ──────────────────────────────────────────────
           Conditionally mounted (mirrors RoastersPanel's pattern — the
           pointerEvents-related opacity wrapper bug only manifested
           when SlidePanel was always-mounted). */}
      {filterDrawerOpen ? (
        <SlidePanel
          visible={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          side="right"
          widthPercent={88}
          dimBackdrop={false}
        >
          <View style={s.drawer}>
            <View style={s.drawerHeader}>
              <Text style={s.drawerTitle}>Filter</Text>
              <Pressable
                onPress={() => setFilterDrawerOpen(false)}
                hitSlop={10}
                accessibilityLabel="Close filter"
                accessibilityRole="button"
                style={s.drawerClose}
              >
                <X
                  size={t.size["icon.lg"]}
                  color={t.color["text.primary"]}
                  strokeWidth={1.75}
                />
              </Pressable>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.drawerBody}
              showsVerticalScrollIndicator={false}
            >
              {/* Article volume */}
              <CollapsibleSection
                title="Article volume"
                activeCount={volumeFilter !== "any" ? 1 : 0}
              >
                {VOLUME_OPTIONS.map((opt) => {
                  const count =
                    opt.key === "any" ? counts.total
                    : opt.key === "has_articles" ? counts.has_articles
                    : counts.no_articles;
                  const active = volumeFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setVolumeFilter(opt.key)}
                      style={s.checkRow}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                    >
                      <View style={[s.radio, active && s.radioOn]}>
                        {active ? <View style={s.radioDot} /> : null}
                      </View>
                      <Text style={s.checkLabel}>{opt.label(count)}</Text>
                    </Pressable>
                  );
                })}
              </CollapsibleSection>

              <View style={s.drawerSectionDivider} />

              {/* Last scraped */}
              <CollapsibleSection
                title="Last scraped"
                activeCount={scrapedFilter !== "any" ? 1 : 0}
              >
                {SCRAPED_OPTIONS.map((opt) => {
                  const active = scrapedFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setScrapedFilter(opt.key)}
                      style={s.checkRow}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                    >
                      <View style={[s.radio, active && s.radioOn]}>
                        {active ? <View style={s.radioDot} /> : null}
                      </View>
                      <Text style={s.checkLabel}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </CollapsibleSection>

              <View style={s.drawerSectionDivider} />

              {/* Hint state */}
              <CollapsibleSection
                title="Site enrichment hint"
                activeCount={hintFilter !== "any" ? 1 : 0}
              >
                {HINT_OPTIONS.map((opt) => {
                  const count =
                    opt.key === "any" ? counts.total
                    : opt.key === "has_hint" ? counts.has_hint
                    : counts.no_hint;
                  const active = hintFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setHintFilter(opt.key)}
                      style={s.checkRow}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                    >
                      <View style={[s.radio, active && s.radioOn]}>
                        {active ? <View style={s.radioDot} /> : null}
                      </View>
                      <Text style={s.checkLabel}>{opt.label(count)}</Text>
                    </Pressable>
                  );
                })}
              </CollapsibleSection>

              <View style={s.drawerSectionDivider} />

              {/* Feed kind — multi-select. Same checkbox shape as
                 RoastersPanel's Location axis. */}
              <CollapsibleSection
                title="Feed kind"
                activeCount={feedKindFilter.size}
              >
                {feedKinds.length === 0 ? (
                  <Text style={s.emptyText}>No feeds yet.</Text>
                ) : (
                  feedKinds.map((kind) => {
                    const checked = feedKindFilter.has(kind);
                    return (
                      <Pressable
                        key={kind}
                        onPress={() => toggleFeedKind(kind)}
                        style={s.checkRow}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <View style={[s.checkBox, checked && s.checkBoxOn]}>
                          {checked ? (
                            <Text style={s.checkBoxTick}>{"✓"}</Text>
                          ) : null}
                        </View>
                        <Text style={s.checkLabel}>{kind}</Text>
                      </Pressable>
                    );
                  })
                )}
              </CollapsibleSection>
            </ScrollView>
            <View style={s.drawerFooter}>
              <Pressable
                onPress={() => {
                  hapticTap();
                  resetFilters();
                }}
                disabled={activeFilterCount === 0}
                style={({ pressed }) => [
                  s.drawerResetBtn,
                  activeFilterCount === 0 && s.drawerResetBtnDisabled,
                  pressed && s.drawerBtnPressed,
                ]}
              >
                <Text style={s.drawerResetText}>
                  Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  hapticCommit();
                  setFilterDrawerOpen(false);
                }}
                style={({ pressed }) => [
                  s.drawerApplyBtn,
                  pressed && s.drawerBtnPressed,
                ]}
              >
                <Text style={s.drawerApplyText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </SlidePanel>
      ) : null}
    </View>
  );
}

// Row shape — kept here so it's reachable from filteredRows + the
// row component below.
type Row = {
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  /** Live count from `roaster_articles`, NOT the `roaster_sources`
   *  cache — see the explanatory comment on the rows useMemo above. */
  articles_count: number;
  /** Most-recent `scraped_at` across this roaster's articles. Null
   *  only when the roaster has zero articles. */
  last_articles_scraped_at: string | null;
  /** Most-recent scrape ATTEMPT timestamp from `roaster_sources`.
   *  Distinguishes "scrape ran but no articles found" (this is set,
   *  count is 0) from "scrape never attempted" (this is null too). */
  source_last_scrape_attempt: string | null;
  articles_feed_kind: string | null;
  has_feed_discovered: boolean;
  has_article_hint: boolean;
};

// Collapsible drawer section — direct copy of the pattern from
// RoastersPanel (section auto-opens when its activeCount rises so the
// admin doesn't lose track of which axes they've set).
function CollapsibleSection({
  title,
  activeCount,
  children,
}: {
  title: string;
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(activeCount > 0);
  const s = useStyles();
  useEffect(() => {
    if (activeCount > 0) setOpen(true);
  }, [activeCount]);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={s.collapsibleHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={s.drawerSectionLabel}>{title}</Text>
        {activeCount > 0 ? (
          <Text style={s.collapsibleBadge}>{activeCount}</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {open ? (
          <ChevronDown
            size={t.size["icon.sm"]}
            color={t.color["text.muted"]}
            strokeWidth={1.75}
          />
        ) : (
          <ChevronRight
            size={t.size["icon.sm"]}
            color={t.color["text.muted"]}
            strokeWidth={1.75}
          />
        )}
      </Pressable>
      {open ? children : null}
    </View>
  );
}


// ── Per-roaster row ────────────────────────────────────────────────────────

type ArticleRoasterRowProps = {
  row: Row;
  isLastRow: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
};

function ArticleRoasterRow({
  row,
  isLastRow,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: ArticleRoasterRowProps) {
  const s = useStyles();
  const { isMobile } = useBreakpoint();
  // Match RoasterRow's thumb scale exactly: 96 mobile / 110 wide. Same
  // breakpoint logic, same RoasterLogo primitive — the two admin sub-
  // tabs read as one consistent list.
  const thumbSize = isMobile ? 96 : 110;
  const cityState = [row.city, row.state].filter(Boolean).join(", ");
  // Meta line — informative, no more contradictory "Never scraped"
  // when articles actually exist. Three signals: live count, latest
  // article time, source-side scrape attempt time. Cases:
  //   articles>0 → "{N} articles · Latest {relative}"
  //   articles=0 + scrape attempt logged → "Scraped {relative} · 0 articles"
  //   articles=0 + feed discovered + no scrape yet → "Feed found · awaiting scrape"
  //   articles=0 + no feed → "No feed discovered yet"
  const metaLine = ((): string => {
    if (row.articles_count > 0) {
      const latest = row.last_articles_scraped_at
        ? `Latest ${formatRelative(row.last_articles_scraped_at)}`
        : null;
      const kind = row.articles_feed_kind ? `via ${row.articles_feed_kind}` : null;
      return [
        `${row.articles_count} article${row.articles_count === 1 ? "" : "s"}`,
        latest,
        kind,
      ].filter(Boolean).join(" · ");
    }
    if (row.source_last_scrape_attempt) {
      return `Scraped ${formatRelative(row.source_last_scrape_attempt)} · 0 articles`;
    }
    if (row.has_feed_discovered) {
      return `Feed found${row.articles_feed_kind ? ` (${row.articles_feed_kind})` : ""} · awaiting scrape`;
    }
    return "No feed discovered yet";
  })();

  return (
    <View style={{ width: "100%" }}>
      <Pressable
        onPress={() => {
          // Tapping the row body toggles expansion. Checkbox stops
          // propagation so it doesn't double-fire.
          onToggleExpand();
        }}
        style={({ pressed }) => [s.row, pressed && s.rowActive]}
        accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} ${row.name}`}
      >
        {/* Checkbox — leading. */}
        <Pressable
          onPress={(e) => {
            (e as any)?.stopPropagation?.();
            onToggleSelect();
          }}
          style={({ pressed }) => [
            s.checkbox,
            isSelected && s.checkboxChecked,
            pressed && s.checkboxPressed,
          ]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`Select ${row.name}`}
          hitSlop={6}
        >
          {isSelected ? (
            <Check
              size={t.size["icon.sm"]}
              color={t.color["text.on-cta"]}
              strokeWidth={3}
            />
          ) : null}
        </Pressable>

        <RoasterLogo
          url={row.logo_url}
          size={thumbSize}
          fallbackInitial={row.name}
        />

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
            {metaLine}
          </Text>
        </View>

        {/* Chevron — affordance for the inline expand. Replaces the
           old per-row Refresh button; refresh now lives only on the
           bulk FAB (multi-select → tap FAB). */}
        <View style={s.chevron}>
          {isExpanded ? (
            <ChevronUp
              size={t.size["icon.sm"]}
              color={t.color["text.muted"]}
              strokeWidth={1.75}
            />
          ) : (
            <ChevronDown
              size={t.size["icon.sm"]}
              color={t.color["text.muted"]}
              strokeWidth={1.75}
            />
          )}
        </View>

        {!isLastRow ? <View style={s.divider} /> : null}
      </Pressable>

      {isExpanded ? <ExpandedRow slug={row.slug} name={row.name} /> : null}
    </View>
  );
}


// ── Inline expanded panel: hint card + article list ───────────────────────

function ExpandedRow({ slug, name }: { slug: string; name: string }) {
  const s = useStyles();

  // Hint fetch — one-shot per expand. Re-runs after a regenerate.
  // The `article_hint_force_regenerate` field on this object is the
  // perpetual server-side flag the toggle below mutates.
  const [hint, setHint] = useState<ArticleHint | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  // Tracks an in-flight POST to /article-hint/regenerate-flag so the
  // toggle disables itself between the optimistic UI flip and the
  // server confirmation. Without this, fast double-taps fire two
  // mutations.
  const [regenSaving, setRegenSaving] = useState(false);

  // Per-roaster admin article list — bypasses useResource because
  // /admin/articles isn't a CRUD-Utopia resource path. The same
  // shape (data array + loading flag) keeps the rendering uniform.
  const [articleList, setArticleList] = useState<RoasterArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState<string | null>(null);

  const loadArticles = useCallback(
    async (silent = false) => {
      if (!silent) setArticlesLoading(true);
      setArticlesError(null);
      try {
        const qs = new URLSearchParams({
          roaster_slug: slug,
          limit: "200",
          include_hidden: "1",
        }).toString();
        const res = await apiFetchRaw(`/admin/articles?${qs}`);
        const data = (res as any)?.data ?? res;
        setArticleList(Array.isArray(data) ? (data as RoasterArticle[]) : []);
      } catch (e: any) {
        setArticlesError(e?.message || "Failed to load articles");
      } finally {
        setArticlesLoading(false);
      }
    },
    [slug],
  );

  const loadHint = useCallback(async () => {
    setHintLoading(true);
    setHintError(null);
    try {
      const res = await apiFetchRaw(
        `/admin/roasters/${encodeURIComponent(slug)}/article-hint`,
      );
      const data = (res as any)?.data ?? res;
      setHint(data as ArticleHint);
    } catch (e: any) {
      setHintError(e?.message || "Failed to load hint");
    } finally {
      setHintLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadHint();
    loadArticles();
  }, [loadHint, loadArticles]);

  // The toggle is the source of truth for the perpetual server flag.
  // Optimistic flip first (so the UI feels instant), then POST. On
  // failure, we revert. The flag never auto-clears server-side — the
  // admin's choice persists across sessions and across admins.
  const regenOn = (hint?.article_hint_force_regenerate ?? 0) === 1;
  const handleRegenerateToggle = useCallback(async () => {
    if (regenSaving) return;
    hapticTap();
    const next = regenOn ? 0 : 1;
    // Optimistic update so the checkbox flips immediately.
    setHint((prev) =>
      prev ? { ...prev, article_hint_force_regenerate: next } : prev,
    );
    setRegenSaving(true);
    try {
      await apiFetchRaw(
        `/admin/roasters/${encodeURIComponent(slug)}/article-hint/regenerate-flag`,
        {
          method: "POST",
          body: JSON.stringify({ enabled: next }),
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      // Revert on failure. We don't surface the error inline here —
      // the next loadHint() call (e.g. on next expand) will reconcile
      // truth, and the optimistic revert keeps the UI consistent.
      setHint((prev) =>
        prev ? { ...prev, article_hint_force_regenerate: regenOn ? 1 : 0 } : prev,
      );
    } finally {
      setRegenSaving(false);
    }
  }, [regenOn, regenSaving, slug]);

  const enrichedCount = articleList.filter(
    (a) => a.enrichment_status === "enriched",
  ).length;

  return (
    <View style={s.expanded}>
      {/* ── Site-quirk hint card ────────────────────────────────────── */}
      <View style={s.hintCard}>
        <View style={s.hintHeader}>
          <Text style={s.hintTitle}>Site enrichment hint</Text>
          {hint?.article_enrichment_prompt_hint_updated_at ? (
            <Text style={s.hintMeta}>
              Updated{" "}
              {formatRelative(
                hint.article_enrichment_prompt_hint_updated_at,
              )}
            </Text>
          ) : null}
        </View>
        {hintLoading ? (
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        ) : hintError ? (
          <Text style={s.hintBodyMuted}>{hintError}</Text>
        ) : hint?.article_enrichment_prompt_hint ? (
          <Text style={s.hintBody}>{hint.article_enrichment_prompt_hint}</Text>
        ) : (
          <Text style={s.hintBodyMuted}>
            No hint generated yet. Crema will write one automatically
            after the next scrape that lands at least one enriched
            article for {name}.
          </Text>
        )}
        <Pressable
          onPress={handleRegenerateToggle}
          disabled={regenSaving}
          style={[s.hintToggleRow, regenSaving && s.hintToggleRowSaving]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: regenOn }}
          accessibilityLabel="Regenerate this hint on every scrape"
        >
          <View
            style={[
              s.hintToggleBox,
              regenOn && s.hintToggleBoxChecked,
            ]}
          >
            {regenOn ? (
              <Check
                size={t.size["icon.sm"]}
                color={t.color["text.on-cta"]}
                strokeWidth={3}
              />
            ) : null}
          </View>
          <Text style={s.hintToggleLabel}>
            Regenerate hint on every scrape
          </Text>
          {regenSaving ? (
            <ActivityIndicator size="small" color={t.color["text.muted"]} />
          ) : null}
        </Pressable>
      </View>

      {/* ── Articles list ───────────────────────────────────────────── */}
      <View style={s.articleListHeader}>
        <Text style={s.articleListTitle}>
          Articles ({articleList.length})
        </Text>
        <Text style={s.articleListMeta}>
          {enrichedCount} enriched
        </Text>
      </View>
      {articlesLoading && articleList.length === 0 ? (
        <ActivityIndicator size="small" color={t.color["text.primary"]} />
      ) : articlesError ? (
        <Text style={s.emptyText}>{articlesError}</Text>
      ) : articleList.length === 0 ? (
        <Text style={s.emptyText}>
          No articles scraped yet for {name}.
        </Text>
      ) : (
        <View style={s.articleList}>
          {articleList.map((a, idx) => (
            <ArticleRow
              key={a.id}
              article={a}
              isLast={idx === articleList.length - 1}
              onChange={() => loadArticles(true)}
            />
          ))}
        </View>
      )}
    </View>
  );
}


// ── Per-article row inside the inline expand ──────────────────────────────

function ArticleRow({
  article,
  isLast,
  onChange,
}: {
  article: RoasterArticle;
  isLast: boolean;
  onChange: () => void;
}) {
  const s = useStyles();
  const [busy, setBusy] = useState<"publish" | "delete" | "reenrich" | null>(
    null,
  );

  const isPublished = (article.published ?? 1) === 1;
  const isOffTopic = (article.is_about_coffee ?? 1) === 0;
  const status = (article.enrichment_status || "pending").toLowerCase();

  const togglePublish = useCallback(async () => {
    hapticTap();
    setBusy("publish");
    try {
      await apiFetchRaw(
        `/admin/articles/${article.id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ published: isPublished ? 0 : 1 }),
          headers: { "Content-Type": "application/json" },
        },
      );
      onChange();
    } finally {
      setBusy(null);
    }
  }, [article.id, isPublished, onChange]);

  const removeArticle = useCallback(async () => {
    hapticCommit();
    setBusy("delete");
    try {
      await apiFetchRaw(`/admin/articles/${article.id}`, {
        method: "DELETE",
      });
      onChange();
    } finally {
      setBusy(null);
    }
  }, [article.id, onChange]);

  const reEnrich = useCallback(async () => {
    hapticCommit();
    setBusy("reenrich");
    try {
      // Re-enrich is a per-roaster article scrape with force_enrich.
      // It re-runs Haiku on every URL — including this one. Cheaper
      // than building a per-article re-enrich endpoint and the user
      // can stay on the panel since the polling picks up new state.
      await apiFetchRaw(
        `/admin/roasters/${encodeURIComponent(article.roaster_slug)}/scrape-articles`,
        {
          method: "POST",
          body: JSON.stringify({ force_enrich: true }),
          headers: { "Content-Type": "application/json" },
        },
      );
    } finally {
      setBusy(null);
    }
  }, [article.roaster_slug]);

  return (
    <View style={s.articleRow}>
      {article.image_url ? (
        <Image
          source={{
            uri:
              thumbnailUrl(resolveUploadUrl(article.image_url), 240) ||
              undefined,
          }}
          style={s.articleThumb}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={[s.articleThumb, s.articleThumbBlank]} />
      )}
      <View style={s.articleInfo}>
        <Text style={s.articleTitle} numberOfLines={2}>
          {article.title || "(untitled)"}
        </Text>
        <View style={s.articleBadgesRow}>
          {isOffTopic ? (
            <View style={[s.badge, s.badgeOffTopic]}>
              <X size={10} color={t.color["text.muted"]} strokeWidth={2.25} />
              <Text style={s.badgeOffTopicLabel}>Off-topic</Text>
            </View>
          ) : status === "enriched" ? (
            <View style={[s.badge, s.badgeCoffee]}>
              <Check
                size={10}
                color={t.color["text.primary"]}
                strokeWidth={3}
              />
              <Text style={s.badgeCoffeeLabel}>Coffee</Text>
            </View>
          ) : null}
          {status === "failed" ? (
            <View style={[s.badge, s.badgeFailed]}>
              <Text style={s.badgeFailedLabel}>Enrich failed</Text>
            </View>
          ) : null}
          {status === "pending" ? (
            <View style={[s.badge, s.badgePending]}>
              <Text style={s.badgePendingLabel}>Pending</Text>
            </View>
          ) : null}
          {article.topic_category ? (
            <View style={[s.badge, s.badgeTopic]}>
              <Text style={s.badgeTopicLabel}>
                {article.topic_category.replace(/_/g, " ")}
              </Text>
            </View>
          ) : null}
          {article.word_count ? (
            <Text style={s.articleMeta}>
              {article.word_count.toLocaleString()} words
            </Text>
          ) : null}
        </View>
        {Array.isArray(article.tags) && article.tags.length > 0 ? (
          <Text style={s.articleTags} numberOfLines={1}>
            {article.tags.map((tag) => `#${tag}`).join(" · ")}
          </Text>
        ) : null}
      </View>

      <View style={s.articleActions}>
        <Pressable
          onPress={togglePublish}
          disabled={busy !== null}
          style={({ pressed }) => [
            s.iconBtn,
            busy !== null && s.iconBtnDisabled,
            pressed && busy === null && s.iconBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPublished ? "Hide article" : "Publish article"}
          hitSlop={6}
        >
          {busy === "publish" ? (
            <ActivityIndicator size="small" color={t.color["text.primary"]} />
          ) : isPublished ? (
            <Eye
              size={t.size["icon.sm"]}
              color={t.color["text.primary"]}
              strokeWidth={1.75}
            />
          ) : (
            <EyeOff
              size={t.size["icon.sm"]}
              color={t.color["text.muted"]}
              strokeWidth={1.75}
            />
          )}
        </Pressable>
        <Pressable
          onPress={reEnrich}
          disabled={busy !== null}
          style={({ pressed }) => [
            s.iconBtn,
            busy !== null && s.iconBtnDisabled,
            pressed && busy === null && s.iconBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Re-enrich article"
          hitSlop={6}
        >
          {busy === "reenrich" ? (
            <ActivityIndicator size="small" color={t.color["text.primary"]} />
          ) : (
            <RefreshCw
              size={t.size["icon.sm"]}
              color={t.color["text.primary"]}
              strokeWidth={1.75}
            />
          )}
        </Pressable>
        <Pressable
          onPress={removeArticle}
          disabled={busy !== null}
          style={({ pressed }) => [
            s.iconBtn,
            busy !== null && s.iconBtnDisabled,
            pressed && busy === null && s.iconBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Delete article"
          hitSlop={6}
        >
          {busy === "delete" ? (
            <ActivityIndicator size="small" color={t.color["text.primary"]} />
          ) : (
            <Trash2
              size={t.size["icon.sm"]}
              color={t.color["text.muted"]}
              strokeWidth={1.75}
            />
          )}
        </Pressable>
      </View>

      {!isLast ? <View style={s.articleDivider} /> : null}
    </View>
  );
}


// ── Styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  // Panel root — `position: relative` is the default in React Native,
  // which is what we need so the FAB anchors here on native (and
  // `position: 'fixed'` on web ignores it but stays viewport-anchored).
  // Top gap so the section header doesn't kiss the sub-tab divider.
  panelRoot: {
    width: "100%" as any,
    gap: t.spacing["2xl"],
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    fontStyle: "italic",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.md,
  },
  sectionTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  } as any,
  // Filter trigger — same circular cream-disc geometry as
  // RoastersPanel's filterIconBtn so the two admin sub-tabs feel
  // identical to use.
  filterIconBtn: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  } as any,
  filterIconBtnPressed: { opacity: 0.7 } as any,
  filterIconDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,

  // Live progress banner — surfaces what the runner is doing while
  // a job is in flight, with a Stop button. Espresso fill + cream
  // copy so it reads as live chrome, not a static notice. Pink dot
  // pulses (well — we'd add an Animated.View later; for now a static
  // pink disc is enough signal).
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.color["text.primary"],
    borderRadius: t.radius.md,
  } as any,
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color["accent.cta"],
    flexShrink: 0,
  } as any,
  liveBannerLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    // Banner bg is `text.primary` (Espresso/Crema White). Use
    // `text.on-dark` (constant Crema White) so the label reads on
    // the Espresso bg in light mode — text.on-cta flipped to
    // constant Espresso in §2.40.19 and would be invisible here.
    color: t.color["text.on-dark"],
    letterSpacing: 0.3,
  } as any,
  stopPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing["2xs"],
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["text.on-cta"],
  } as any,
  stopPillDisabled: { opacity: 0.6 } as any,
  stopPillPressed: { opacity: 0.75 } as any,
  stopPillLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color["text.on-cta"],
  },

  // Selection strip — sits between the section header and the row
  // list when the admin has checked anything. Cream-tinted band so
  // the user can find the Clear pill quickly.
  selectionStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.color.flash,
    borderRadius: t.radius.md,
  } as any,
  selectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  clearPill: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing["2xs"],
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["text.primary"],
  } as any,
  clearPillPressed: { opacity: 0.7 } as any,
  clearPillLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color["text.primary"],
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
  rowList: { width: "100%" as any } as any,
  // Row geometry mirrors `RoasterRow` exactly so the Roasters & Beans
  // sub-tab and the Journals sub-tab read as one consistent list.
  // Same paddings, same gap, same press-state flash. The thumb size
  // (96 mobile / 110 wide), name + sub fonts, and lineHeight come
  // from the row component itself, also matching RoasterRow.
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
  // Name = `font.xl` body.regular w/ relaxed line height (matches
  // `RoasterRow.name`). Sub-lines = `font.md` body.regular w/ relaxed
  // line height (matches `RoasterRow.sub` / `subCount`).
  rowName: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  rowSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  chevron: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  divider: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,

  // Multi-select checkbox.
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    flexShrink: 0,
  } as any,
  checkboxChecked: {
    backgroundColor: t.color["accent.cta"],
    borderColor: t.color["accent.cta"],
  } as any,
  checkboxPressed: { opacity: 0.7 },

  // Inline expanded panel.
  expanded: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.lg,
    gap: t.spacing.md,
    backgroundColor: t.color.flash,
  } as any,
  hintCard: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    gap: t.spacing.sm,
  } as any,
  hintHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  } as any,
  hintTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hintMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  hintBody: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: 20,
  },
  hintBodyMuted: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    lineHeight: 20,
  },
  hintToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  } as any,
  hintToggleBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  hintToggleBoxChecked: {
    backgroundColor: t.color["accent.cta"],
    borderColor: t.color["accent.cta"],
  } as any,
  hintToggleLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    flex: 1,
  },
  hintToggleRowSaving: { opacity: 0.6 } as any,

  // Articles list (inside expanded panel).
  articleListHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing["2xs"],
  } as any,
  articleListTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  articleListMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  articleList: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    overflow: "hidden",
  } as any,
  articleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    position: "relative",
  } as any,
  articleThumb: {
    width: 64,
    height: 48,
    borderRadius: t.radius.sm,
    flexShrink: 0,
    backgroundColor: t.color.flash,
  } as any,
  articleThumbBlank: {
    borderWidth: 1,
    borderColor: t.color.divider,
  } as any,
  articleInfo: { flex: 1, minWidth: 0, gap: t.spacing["2xs"] } as any,
  articleTitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: 18,
  },
  articleBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: t.spacing["2xs"],
  } as any,
  articleMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  articleTags: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  articleActions: {
    flexDirection: "row",
    gap: t.spacing["2xs"],
    flexShrink: 0,
  } as any,
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  } as any,
  iconBtnDisabled: { opacity: 0.4 },
  iconBtnPressed: { backgroundColor: t.color.flash },
  articleDivider: {
    position: "absolute",
    left: t.spacing.md,
    right: t.spacing.md,
    bottom: 0,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,

  // Badges.
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  } as any,
  badgeCoffee: {
    borderColor: t.color["text.primary"],
    backgroundColor: "transparent",
  } as any,
  badgeCoffeeLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    letterSpacing: 0.3,
  },
  badgeOffTopic: {
    borderColor: t.color["text.muted"],
    backgroundColor: "transparent",
  } as any,
  badgeOffTopicLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.3,
  },
  badgeFailed: {
    borderColor: t.color["text.muted"],
    backgroundColor: t.color.flash,
  } as any,
  badgeFailedLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    letterSpacing: 0.3,
  },
  badgePending: {
    borderColor: t.color.divider,
    backgroundColor: "transparent",
  } as any,
  badgePendingLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.3,
  },
  badgeTopic: {
    borderColor: t.color.divider,
    backgroundColor: "transparent",
  } as any,
  badgeTopicLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    letterSpacing: 0.3,
    textTransform: "lowercase",
  },

  // (The previous `fab` / `fabDisabled` / `fabPressed` /
  //  `fabBadge` / `fabBadgeText` styles were retired in §2.40.18.
  //  The Refresh FAB now uses the shared <FabPill /> primitive —
  //  same Crema-pink pill the home / profile / roaster pages use
  //  for "Create post". The selection count is shown above the
  //  rows in the selection strip, not on the pill, per the user's
  //  "in the same fashion as the create post button" spec.)

  // ── Filter drawer ───────────────────────────────────────────────────
  // Same shell as RoastersPanel's drawer (header → ScrollView body →
  // footer with Reset + Apply). Token-only.
  drawer: {
    flex: 1,
    backgroundColor: t.color.bg,
  } as any,
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
  } as any,
  drawerTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
  },
  drawerClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  drawerBody: {
    paddingHorizontal: t.spacing.xl,
    paddingBottom: t.spacing.xl,
    gap: t.spacing.md,
  },
  drawerSectionDivider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginVertical: t.spacing.sm,
  } as any,
  drawerSectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color["text.primary"],
  },
  collapsibleHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.sm,
    gap: t.spacing.sm,
  } as any,
  collapsibleBadge: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["accent.cta"],
    minWidth: 18,
    textAlign: "center",
  },
  drawerFooter: {
    flexDirection: "row",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: t.color.divider,
  } as any,
  drawerResetBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  drawerResetBtnDisabled: { opacity: 0.4 } as any,
  drawerResetText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color["text.primary"],
  },
  drawerApplyBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.color.accent,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  drawerApplyText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color["text.on-cta"],
  },
  drawerBtnPressed: { opacity: 0.8 } as any,

  // Single radio + checkbox primitives used by every drawer section.
  // Same look as RoastersPanel's drawer rows so the two admin filter
  // surfaces feel identical.
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingVertical: t.spacing["2xs"],
  } as any,
  checkLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    flex: 1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: t.color["text.muted"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  radioOn: { borderColor: t.color["text.primary"] } as any,
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color["text.primary"],
  } as any,
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.color["text.muted"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  checkBoxOn: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  } as any,
  checkBoxTick: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.on-cta"],
  },
}));
