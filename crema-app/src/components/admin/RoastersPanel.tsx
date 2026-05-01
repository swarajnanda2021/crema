/**
 * Catalog Ops · ROASTERS sub-tab.
 *
 * Single entry point for managing every roaster card the rest of the
 * system sees. Three concerns:
 *   1. Add a new roaster by URL → backend runs Sonnet enrichment →
 *      profile drops in as a draft (`published=0`).
 *   2. Browse the existing catalog as a vertical list of `RoasterRow`s
 *      (the same row component the consumer Discover ROASTERS tab
 *      uses), with two filter axes — Lifecycle (All / Published /
 *      Unpublished / In catalog) and Location — both lifted into a
 *      right-side slide-in `SlidePanel` behind the SlidersHorizontal
 *      trigger so the panel header stays uncluttered.
 *   3. Tap any row → navigates to `/admin/roaster/{slug}` (a real
 *      route, not a modal) where the synthesized bio, publish flip,
 *      re-enrich, scrape settings, and Remove all live. The route
 *      page is the natural surface to "progressively fill" as more
 *      Catalog Ops sub-tabs touch the same roaster.
 *
 * Every visual value reads from `useTokens` per CRUD_UTOPIA Rule 4.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal, Undo2, X } from "lucide-react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { useResource } from "../../resources/useResource";
import type { CatalogJob, DeletedRoaster, RoasterProfile, RoasterSource } from "../../resources/types";
import RoasterRow from "../RoasterRow";
import SlidePanel from "../mobile/SlidePanel";
import { formatRelative, RecentEnrichmentRuns } from "./JobHistory";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";

type RoasterFilter = "all" | "published" | "drafts" | "has_products" | "no_products";
type ScrapedBucket = "any" | "over_1d" | "over_7d" | "over_30d";

// Staleness ladder — the admin uses this to surface roasters whose
// catalogs need a fresh pull, not to find ones that were just
// refreshed. Each bucket includes never-enriched roasters because
// those are the most extreme form of stale.
const BUCKET_OPTIONS: { key: ScrapedBucket; label: string }[] = [
  { key: "any", label: "Any time" },
  { key: "over_1d", label: "Older than 24 hours" },
  { key: "over_7d", label: "Older than 7 days" },
  { key: "over_30d", label: "Older than 30 days, or never" },
];

function ageHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!ms) return null;
  return Math.max(0, (Date.now() - ms) / (1000 * 60 * 60));
}

export default function RoastersPanel() {
  const router = useRouter();
  const s = useStyles();
  const roasters = useResource<RoasterProfile>("roaster_profiles", { limit: 500 });
  // Source rows give us `last_scraped_at` for the bean-context
  // "Last enriched" filter — joined per-profile via website match.
  const sources = useResource<RoasterSource>("roaster_sources", { limit: 500 });
  // Audit log of admin-deleted roasters — surfaces website + name so a
  // mistaken removal can be re-enriched without retyping the URL.
  const deletedRoasters = useResource<DeletedRoaster>("deleted_roasters", { limit: 50 });
  // Jobs feed — used to track in-flight `roaster_enrich` runs so the
  // panel can survive sub-tab flips, app reloads, and reconnects.
  // Mirrors StandardizationPanel's poll-while-live pattern.
  const jobs = useResource<CatalogJob>("jobs", { limit: 50 });

  // Re-fetch every time the admin returns from the per-roaster detail
  // page (publish flips, re-enrichment, deletes all happen there now,
  // so the panel must be ready to show the new state on the way back).
  useFocusEffect(
    useCallback(() => {
      roasters.refetch();
      sources.refetch();
      deletedRoasters.refetch();
      jobs.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  // Track which URL the in-flight enrichment was submitted for so the
  // deleted-row spinner stays on the right row across the async hop.
  // (Only ONE roaster_enrich can be live at a time — backend enforces
  // via JobConflict — so a single string suffices.)
  const [inflightWebsite, setInflightWebsite] = useState<string | null>(null);

  const [filter, setFilter] = useState<RoasterFilter>("all");
  const [scraped, setScraped] = useState<ScrapedBucket>("any");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [deletedExpanded, setDeletedExpanded] = useState(false);

  // Live `roaster_enrich` job (queued or running) — derived from the
  // shared jobs feed. Lets the panel resume polling after a sub-tab
  // flip / reload / reconnect without holding any local promise.
  const liveEnrichJob = useMemo(
    () =>
      (jobs.data ?? []).find(
        (j) =>
          j.kind === "roaster_enrich" &&
          (j.status === "queued" || j.status === "running"),
      ),
    [jobs.data],
  );
  const enriching = submitting || !!liveEnrichJob;
  const reEnrichingUrl = liveEnrichJob ? inflightWebsite : null;

  // Poll while a job is live — same 2s cadence as StandardizationPanel.
  useEffect(() => {
    if (!liveEnrichJob) return;
    const id = setInterval(() => {
      jobs.refetch();
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEnrichJob?.id]);

  // Track which job we're attached to so we only act on transitions
  // that happened while we were watching. Without this, re-mounting
  // the panel after a job already finished would re-trigger the
  // success route — confusing the admin (they'd be bounced into a
  // roaster page they didn't just enrich).
  const trackedJobIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (liveEnrichJob) {
      trackedJobIdRef.current = liveEnrichJob.id;
    }
  }, [liveEnrichJob]);

  // When the tracked job leaves the live state, look up its terminal
  // status and either route (succeeded) or surface the error (failed).
  useEffect(() => {
    if (liveEnrichJob) return;
    const trackedId = trackedJobIdRef.current;
    if (!trackedId) return;
    const finished = (jobs.data ?? []).find((j) => j.id === trackedId);
    if (!finished) return;
    if (finished.status === "queued" || finished.status === "running") return;

    trackedJobIdRef.current = null;
    setInflightWebsite(null);

    if (finished.status === "succeeded") {
      const summary =
        typeof finished.result_summary === "object" && finished.result_summary
          ? (finished.result_summary as Record<string, any>)
          : null;
      const slug = summary?.slug;
      // Refresh both panels' data so the route arrives at a clean
      // detail page and the deleted-roasters list (in case this was
      // a re-enrich-from-trash) reflects the new live row.
      roasters.refetch();
      deletedRoasters.refetch();
      if (slug) {
        setWebsite("");
        router.push(`/admin/roaster/${slug}`);
      }
    } else if (finished.status === "failed") {
      setEnrichError(finished.error_message || "Enrichment failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEnrichJob, jobs.data]);

  // Lifecycle radio options live in the slide-in drawer alongside the
  // bean-context filters (Last enriched + Location). Labels say what
  // they actually gate, not the schema-side term: "published=1" →
  // "Live in Discover"; "published=0" → "Hidden from Discover".
  // "No beans yet" / "In catalog" surface bean pipeline state at the
  // identity level — the merged Roasters & Beans tab uses these to
  // route the admin's attention.
  const FILTER_OPTIONS: { key: RoasterFilter; label: (n: number) => string }[] = [
    { key: "all", label: (n) => `All ${n}` },
    { key: "published", label: (n) => `Live in Discover ${n}` },
    { key: "drafts", label: (n) => `Hidden from Discover ${n}` },
    { key: "has_products", label: (n) => `In catalog ${n}` },
    { key: "no_products", label: (n) => `No beans yet ${n}` },
  ];

  const counts = useMemo(() => {
    const list = roasters.data || [];
    return {
      total: list.length,
      published: list.filter((r) => r.published === 1).length,
      drafts: list.filter((r) => r.published === 0).length,
      has_products: list.filter((r) => (r.products_count || 0) > 0).length,
      no_products: list.filter((r) => (r.products_count || 0) === 0).length,
    };
  }, [roasters.data]);

  // Cities list for the Location filter — derived from every roaster
  // profile that carries a `city`. Sorted alphabetically; "—" rows
  // (no city) just don't appear here.
  const cities = useMemo(() => {
    const set = new Set<string>();
    (roasters.data || []).forEach((r) => {
      if (r.city) set.add(r.city);
    });
    return Array.from(set).sort();
  }, [roasters.data]);

  // Index sources by website so each profile can look up its scrape
  // state in O(1) — `last_scraped_at` lives on the source row and
  // drives the "Last enriched" filter.
  const sourceByWebsite = useMemo(() => {
    const map = new Map<string, RoasterSource>();
    (sources.data || []).forEach((s) => {
      if (s.website) map.set(s.website, s);
    });
    return map;
  }, [sources.data]);

  const filtered = useMemo(() => {
    let list = roasters.data || [];
    if (filter === "published") list = list.filter((r) => r.published === 1);
    else if (filter === "drafts") list = list.filter((r) => r.published === 0);
    else if (filter === "has_products") list = list.filter((r) => (r.products_count || 0) > 0);
    else if (filter === "no_products") list = list.filter((r) => (r.products_count || 0) === 0);
    if (selectedCities.length > 0) {
      list = list.filter((r) => r.city && selectedCities.includes(r.city));
    }
    if (scraped !== "any") {
      list = list.filter((r) => {
        const src = r.website ? sourceByWebsite.get(r.website) : null;
        const h = ageHours(src?.last_scraped_at || null);
        // Predicate is "stale-by-at-least-X" — `h == null` (never
        // enriched) satisfies every bucket since never-enriched is
        // the most-stale case the admin wants to surface.
        if (scraped === "over_1d") return h == null || h > 24;
        if (scraped === "over_7d") return h == null || h > 24 * 7;
        return h == null || h > 24 * 30;
      });
    }
    return [...list].sort((a, b) => {
      const ap = a.products_count || 0;
      const bp = b.products_count || 0;
      if (ap !== bp) return bp - ap;
      return (a.name || a.roaster_slug).localeCompare(b.name || b.roaster_slug);
    });
  }, [roasters.data, filter, selectedCities, scraped, sourceByWebsite]);

  const activeFilterCount =
    (filter !== "all" ? 1 : 0) +
    (scraped !== "any" ? 1 : 0) +
    selectedCities.length;
  const resetFilters = () => {
    setFilter("all");
    setScraped("any");
    setSelectedCities([]);
  };

  const toggleCity = (city: string) => {
    setSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city],
    );
  };

  const enrichFromUrl = async (url: string, _opts?: { fromHero?: boolean; fromDeleted?: boolean }) => {
    if (!url) return;
    setSubmitting(true);
    setEnrichError(null);
    setInflightWebsite(url);
    try {
      // POST returns `{ job_id, status: 'queued' }` (202). The actual
      // Sonnet work runs as a BackgroundTask; success / failure lands
      // on the job row and the polling effect above picks it up. The
      // per-row spinner stays on this URL via `inflightWebsite` until
      // the job clears.
      await apiFetchRaw("/admin/roasters/enrich", {
        method: "POST",
        body: JSON.stringify({ website: url }),
      });
      // Refetch jobs immediately so the live job appears in the feed
      // before the next 2s poll tick — keeps the CTA spinner from
      // flickering off between submit and first poll.
      await jobs.refetch();
    } catch (e: any) {
      setInflightWebsite(null);
      setEnrichError(e?.message || "Failed to start enrichment");
    } finally {
      setSubmitting(false);
    }
  };

  const enrich = () => {
    hapticCommit();
    return enrichFromUrl(website.trim(), { fromHero: true });
  };

  return (
    <View style={{ gap: t.spacing["2xl"] }}>
      {/* ── Onboard hero — single CTA that runs bio enrich + catalog
         scrape in one shot (mirrors per-roaster Refresh Roaster).
         The `+` icon submits the URL; the runner queues a
         `roaster_enrich` job, chains a `scrape` job after bio
         succeeds, and the panel polls both via the shared jobs
         feed. Drops to a draft for review on the per-roaster admin
         page when bio lands. */}
      <View style={s.hero}>
        <Text style={s.heroTitle}>Onboard Roaster</Text>
        <View style={s.heroInputRow}>
          <TextInput
            value={website}
            onChangeText={setWebsite}
            placeholder="https://newroaster.example.com"
            placeholderTextColor={t.color["text.muted"]}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.urlInput}
            editable={!enriching}
            onSubmitEditing={enrich}
          />
          <Pressable
            onPress={enrich}
            disabled={enriching || !website.trim()}
            style={({ pressed }) => [
              s.ctaIcon,
              pressed && !enriching && s.ctaPressed,
            ]}
            accessibilityLabel={enriching ? "Onboarding…" : "Onboard roaster"}
            accessibilityRole="button"
          >
            {/* Plus glyph uses `text.on-cta` to track the button bg
                (cream on dark Espresso in light mode; Espresso on
                cream in dark mode) — exact mirror of the feed FAB. */}
            {enriching ? (
              <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
            ) : (
              <Plus
                size={22}
                color={t.color["text.on-cta"]}
                strokeWidth={2.5}
              />
            )}
          </Pressable>
        </View>
        {enrichError ? <Text style={s.errorText}>{enrichError}</Text> : null}
      </View>

      {/* ── "Roasters" header — delineates the enrichment hero (above)
         from the actual roaster list (below). Lifecycle + Location
         filters both live behind the SlidersHorizontal trigger to
         the right; the inline chip + search row was retired because
         the filters cover both axes already. */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Catalog</Text>
        <Pressable
          onPress={() => {
            hapticTap();
            setFilterDrawerOpen(true);
          }}
          style={({ pressed }) => [s.filterIconBtn, pressed && s.filterIconBtnPressed]}
          hitSlop={8}
          accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
          accessibilityRole="button"
        >
          <SlidersHorizontal size={t.size["icon.lg"]} color={t.color["text.primary"]} strokeWidth={1.75} />
          {activeFilterCount > 0 ? <View style={s.filterIconDot} /> : null}
        </Pressable>
      </View>

      {/* ── Roaster rows ───────────────────────────────────────────────── */}
      {roasters.loading && filtered.length === 0 ? (
        <View style={s.emptyBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={s.emptyText}>Nothing here yet.</Text>
      ) : (
        <View style={s.rowList}>
          {filtered.map((r, idx) => (
            <RoasterRow
              key={r.roaster_slug}
              imageUrl={r.logo_url || r.hero_image_url || undefined}
              name={r.name || r.roaster_slug}
              city={r.city}
              state={r.state}
              productsCount={r.products_count || 0}
              pillLabel={r.published === 0 ? "Hidden" : undefined}
              showDivider={idx < filtered.length - 1}
              onPress={() => router.push(`/admin/roaster/${r.roaster_slug}`)}
            />
          ))}
        </View>
      )}

      {/* ── Recently deleted (collapsible audit log) ─────────────────── */}
      {(deletedRoasters.data || []).length > 0 ? (
        <View style={s.deletedBlock}>
          <Pressable
            onPress={() => {
              hapticTap();
              setDeletedExpanded((v) => !v);
            }}
            style={({ pressed }) => [s.deletedHead, pressed && s.iconBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={
              deletedExpanded
                ? "Collapse recently deleted roasters"
                : "Expand recently deleted roasters"
            }
          >
            {deletedExpanded ? (
              <ChevronDown size={t.size["icon.sm"]} color={t.color["text.secondary"]} />
            ) : (
              <ChevronRight size={t.size["icon.sm"]} color={t.color["text.secondary"]} />
            )}
            <Text style={s.deletedTitle}>
              Recently deleted ({(deletedRoasters.data || []).length})
            </Text>
            <Text style={s.deletedHelper}>
              Re-enrich to re-create from the original URL
            </Text>
          </Pressable>
          {deletedExpanded ? (
            <View style={s.deletedList}>
              {(deletedRoasters.data || []).map((d) => {
                const url = d.website || "";
                const busy = reEnrichingUrl === url && url.length > 0;
                return (
                  <View key={d.id} style={s.deletedRow}>
                    <View style={s.deletedRowText}>
                      <Text style={s.deletedRowName} numberOfLines={1}>
                        {d.name || d.roaster_slug}
                      </Text>
                      <Text style={s.deletedRowMeta} numberOfLines={1}>
                        {[
                          [d.city, d.state].filter(Boolean).join(", "),
                          d.deleted_at ? `deleted ${formatRelative(d.deleted_at)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      {url ? (
                        <Text style={s.deletedRowUrl} numberOfLines={1}>
                          {url}
                        </Text>
                      ) : (
                        <Text style={s.deletedRowUrlMissing}>No website on record</Text>
                      )}
                    </View>
                    <Pressable
                      onPress={() => {
                        if (!url) return;
                        hapticCommit();
                        enrichFromUrl(url, { fromDeleted: true });
                      }}
                      disabled={!url || busy || enriching}
                      style={({ pressed }) => [
                        s.deletedReBtn,
                        (!url || busy) && s.deletedReBtnDisabled,
                        pressed && s.iconBtnPressed,
                      ]}
                      accessibilityLabel={`Re-enrich ${d.name || d.roaster_slug}`}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={t.color["text.primary"]} />
                      ) : (
                        <Undo2 size={14} color={t.color["text.primary"]} strokeWidth={1.8} />
                      )}
                      <Text style={s.deletedReBtnText}>Re-enrich</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Recent enrichment runs (operational diagnostics) ─────────
         Bottom collapsible mirrors the "Recently deleted" pattern
         above. Was the BEANS sub-tab's home; now lives under the
         merged Roasters & Beans surface so the operational chrome
         stays out of the way of the browse list. */}
      <RecentEnrichmentRuns />

      {/* ── Filter drawer (mobile-first, works on web too) ──────────────
         CONDITIONALLY rendered. Earlier this slot was wrapped in a
         sibling `absoluteFillObject` using the (deprecated in
         RN-Web 0.21) `pointerEvents` prop to stay transparent when
         closed; if that prop isn't honored the wrapper silently
         swallows every click on the rows beneath it. SlidePanel
         itself returns null while closed, but to take any remaining
         doubt off the table we only mount it when the admin
         actually opens the filter. */}
        {filterDrawerOpen ? (
        <SlidePanel
          visible={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          side="right"
          widthPercent={88}
          dimBackdrop={false}
        >
          <View style={s.locDrawer}>
            <View style={s.locDrawerHeader}>
              <Text style={s.locDrawerTitle}>Filter</Text>
              <Pressable
                onPress={() => setFilterDrawerOpen(false)}
                hitSlop={10}
                accessibilityLabel="Close filter"
                accessibilityRole="button"
                style={s.locDrawerClose}
              >
                <X size={t.size["icon.lg"]} color={t.color["text.primary"]} strokeWidth={1.75} />
              </Pressable>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.locDrawerBody}
              showsVerticalScrollIndicator={false}
            >
              {/* Lifecycle — single-select radios. Replaces the inline
                 chip row that used to sit above the rows. */}
              <CollapsibleSection
                title="Lifecycle"
                activeCount={filter !== "all" ? 1 : 0}
              >
              {FILTER_OPTIONS.map((opt) => {
                const count =
                  opt.key === "all" ? counts.total
                  : opt.key === "published" ? counts.published
                  : opt.key === "drafts" ? counts.drafts
                  : opt.key === "has_products" ? counts.has_products
                  : counts.no_products;
                const active = filter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setFilter(opt.key)}
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

              {/* Last enriched — bean-context filter pulled in from
                 the merged Beans tab. Surfaces stale roasters whose
                 catalogs need a fresh pull. */}
              <CollapsibleSection
                title="Last enriched"
                activeCount={scraped !== "any" ? 1 : 0}
              >
              {BUCKET_OPTIONS.map((opt) => {
                const active = scraped === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setScraped(opt.key)}
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

              <CollapsibleSection
                title="Location"
                activeCount={selectedCities.length}
              >
              {cities.length === 0 ? (
                <Text style={s.emptyText}>No cities yet.</Text>
              ) : (
                cities.map((city) => {
                  const checked = selectedCities.includes(city);
                  return (
                    <Pressable
                      key={city}
                      onPress={() => toggleCity(city)}
                      style={s.checkRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                    >
                      <View style={[s.checkBox, checked && s.checkBoxOn]}>
                        {checked ? <Text style={s.checkBoxTick}>{"\u2713"}</Text> : null}
                      </View>
                      <Text style={s.checkLabel}>{city}</Text>
                    </Pressable>
                  );
                })
              )}
              </CollapsibleSection>
            </ScrollView>
            <View style={s.locDrawerFooter}>
              <Pressable
                onPress={() => {
                  hapticTap();
                  resetFilters();
                }}
                disabled={activeFilterCount === 0}
                style={({ pressed }) => [
                  s.locResetBtn,
                  activeFilterCount === 0 && s.locResetBtnDisabled,
                  pressed && s.iconBtnPressed,
                ]}
              >
                <Text style={s.locResetText}>
                  Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  hapticCommit();
                  setFilterDrawerOpen(false);
                }}
                style={({ pressed }) => [s.locApplyBtn, pressed && s.ctaPressed]}
              >
                <Text style={s.locApplyText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </SlidePanel>
        ) : null}
    </View>
  );
}

// ── Collapsible filter section ─────────────────────────────────────────────
// Wraps each filter group inside the admin location-drawer so the ops
// person can scan all available filter groups at a glance and only
// expand the ones they want to act on. A section auto-opens when its
// `activeCount` rises above 0 — the active selection is the strongest
// signal that the operator cares about this dimension.

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
          <ChevronDown size={t.size["icon.sm"]} color={t.color["text.muted"]} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={t.size["icon.sm"]} color={t.color["text.muted"]} strokeWidth={1.75} />
        )}
      </Pressable>
      {open ? children : null}
    </View>
  );
}


// ── Styles — every value is a token reference ────────────────────────────

const useStyles = makeStyles((t) => ({
  // Hero strip
  hero: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.lg,
    gap: t.spacing.md,
  } as any,
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 30,
    color: t.color["text.primary"],
  } as any,
  heroInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  },
  urlInput: {
    flex: 1,
    minWidth: 240,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    minHeight: 56,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  // Circular `+` button next to the URL input — colour-matched to
  // the sitewide feed FAB (`app/(tabs)/index.tsx` `s.fab`) so every
  // "create / onboard" CTA in the app reads as the same affordance.
  // Bg flips with theme via `text.primary` (Espresso in light, Crema
  // White in dark); the `+` glyph uses `text.on-cta` which flips the
  // opposite way (Crema White on Espresso in light, Espresso on Crema
  // White in dark). Diameter matches the input's `minHeight` (56) so
  // they align flush in the row.
  ctaIcon: {
    width: t.size["fab.size"],
    height: t.size["fab.size"],
    borderRadius: t.size["fab.size"] / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color["text.primary"],
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  } as any,
  ctaDisabled: { opacity: 0.5 } as any,
  ctaPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.97 }],
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
  },

  // "Roasters" header row — title + filter trigger.
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.md,
  },
  sectionTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
  },
  // SlidersHorizontal trigger — same circular cream-disc geometry the
  // marketplace uses for compact actions, with a pink dot when any
  // filter (lifecycle or location) is active.
  filterIconBtn: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  } as any,
  filterIconBtnPressed: {
    opacity: 0.7,
  } as any,
  filterIconDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,

  // Vertical list — rows stack with their own hairline dividers
  // (handled inside RoasterRow), so the parent only needs vertical
  // breathing room.
  rowList: {
    paddingBottom: t.spacing.xl,
  } as any,

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
  } as any,

  // Location drawer — mirrors the consumer Discover mobile drawer
  // shell so the admin and consumer surfaces share one filter UX.
  locDrawer: {
    flex: 1,
    backgroundColor: t.color.bg,
  } as any,
  locDrawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  locDrawerTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  },
  locDrawerClose: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  locDrawerBody: {
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.xl,
    gap: t.spacing.xs,
  } as any,
  drawerSectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.xs,
  } as any,
  // Collapsible section header — gestures to collapse/expand the
  // filter group; inherits drawerSectionLabel styling for the title.
  collapsibleHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  collapsibleBadge: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.on-cta"],
    backgroundColor: t.color.accent,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    textAlign: "center",
    lineHeight: 18,
    overflow: "hidden",
  } as any,
  drawerSectionDivider: {
    height: 1,
    backgroundColor: t.color["border.light"],
    marginVertical: t.spacing.md,
  } as any,
  radio: {
    width: 20,
    height: 20,
    borderRadius: t.radius.full,
    borderWidth: 1.5,
    borderColor: t.color.border,
    backgroundColor: t.color["card.front"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  radioOn: {
    borderColor: t.color["text.primary"],
  } as any,
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: t.radius.full,
    backgroundColor: t.color["text.primary"],
  } as any,
  locDrawerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    gap: t.spacing.md,
  },

  // Checkbox row — Figma 40:3087 spec (24-tall row, 20-px box, 1.5-px
  // border, 14-px label).
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingVertical: t.spacing.xs,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: t.radius.sm,
    borderWidth: 1.5,
    borderColor: t.color.border,
    backgroundColor: t.color["card.front"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  checkBoxOn: {
    backgroundColor: t.color["text.primary"],
    borderColor: t.color["text.primary"],
  } as any,
  checkBoxTick: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    lineHeight: t.lineHeight.tight,
  } as any,
  checkLabel: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },

  // Drawer footer buttons
  locResetBtn: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.info"],
  } as any,
  locResetBtnDisabled: {
    opacity: 0.4,
  } as any,
  locResetText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locApplyBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.color["text.primary"],
  } as any,
  locApplyText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  iconBtnPressed: {
    opacity: 0.7,
  } as any,

  // Recently deleted audit log — collapsible block at the bottom of
  // the ROASTERS panel.
  deletedBlock: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    overflow: "hidden",
  } as any,
  deletedHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    flexWrap: "wrap",
  } as any,
  deletedTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  deletedHelper: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "right",
    minWidth: 200,
  } as any,
  deletedList: {
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
  } as any,
  deletedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  deletedRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  } as any,
  deletedRowName: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  deletedRowMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
  },
  deletedRowUrl: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  deletedRowUrlMissing: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["accent.cta"],
    fontStyle: "italic",
  },
  deletedReBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color["card.info"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  deletedReBtnDisabled: {
    opacity: 0.4,
  } as any,
  deletedReBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
}));
