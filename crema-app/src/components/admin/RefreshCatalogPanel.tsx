/**
 * Catalog Ops · REFRESH CATALOG sub-tab.
 *
 * Orchestrator command center for diff-based catalog refresh. The
 * agent-first mindset: a human OR Claude (acting as orchestrator)
 * filters the roster, kicks off a bulk Tab-2 sync, and reviews per-
 * roaster diffs before approving the downstream agent enrichments.
 *
 * Filter dimensions specific to this tab — DIFFERENT from ROASTERS &
 * BEANS because the orchestrator's question is "which roasters need
 * a refresh THIS WEEK" not "which roasters exist":
 *   • Region (multi-select cities)
 *   • Platform (multi-select shopify / wordpress / generic / unknown)
 *   • Diff status (any / has-diff / clean / no-snapshot)
 *   • Last sync age (any / >7d / >30d / never)
 *   • Journal hint (any / generated / missing)
 *
 * Bulk action: "Refresh all (N)" runs POST /admin/sync/bulk over the
 * filtered slug set. Each per-roaster sync is a background task; the
 * orchestrator polls /admin/sync/all-status until diffs land.
 *
 * Per-row tap → /admin/refresh/[slug] for the per-roaster diff page
 * (snapshot card, changes card, 3 quirk cards, refresh CTA, approve
 * flow).
 *
 * Every visual value reads from `useTokens`. Diff badge colors use
 * `bg` (not text.on-cta) to stay legible on `text.primary` bg per the
 * §2.40.19 dual-track refinement.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronDown, ChevronRight, RefreshCw, SlidersHorizontal, X } from "lucide-react-native";
import { useRouter } from "expo-router";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { useResource } from "../../resources/useResource";
import type { RoasterProfile } from "../../resources/types";
import RoasterRow from "../RoasterRow";
import SlidePanel from "../mobile/SlidePanel";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";

// ── Filter axes ────────────────────────────────────────────────────────────
type DiffStatus = "any" | "has_diff" | "clean" | "no_snapshot";
type LastSyncBucket = "any" | "over_7d" | "over_30d" | "never";
type JournalHintStatus = "any" | "generated" | "missing";

const DIFF_OPTIONS: { key: DiffStatus; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "has_diff", label: "Has diff vs last sync" },
  { key: "clean", label: "Snapshot clean (no changes)" },
  { key: "no_snapshot", label: "Never synced" },
];

const LAST_SYNC_OPTIONS: { key: LastSyncBucket; label: string }[] = [
  { key: "any", label: "Any time" },
  { key: "over_7d", label: "Older than 7 days" },
  { key: "over_30d", label: "Older than 30 days" },
  { key: "never", label: "Never synced" },
];

const JOURNAL_HINT_OPTIONS: { key: JournalHintStatus; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "generated", label: "Journal quirk generated" },
  { key: "missing", label: "Missing journal quirk" },
];

// ── all-status payload shape ──────────────────────────────────────────────
type SyncStatus = {
  slug: string;
  name: string | null;
  city: string | null;
  state: string | null;
  platform: string | null;
  article_hint_present: boolean;
  has_snapshot: boolean;
  last_sync: string | null;
  bio_chars: number;
  bio_changed: boolean;
  products_added: number;
  products_updated: number;
  products_removed: number;
  articles_added: number;
  articles_updated: number;
  articles_removed: number;
};

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!ms) return null;
  return Math.max(0, (Date.now() - ms) / (1000 * 60 * 60 * 24));
}

function totalDiff(s: SyncStatus): number {
  return (
    s.products_added + s.products_updated + s.products_removed +
    s.articles_added + s.articles_updated + s.articles_removed +
    (s.bio_changed ? 1 : 0)
  );
}

export default function RefreshCatalogPanel() {
  const router = useRouter();
  const s = useStyles();

  // Roaster profile rows give us name/logo/city/state — useResource
  // already caches these and feeds RoasterRow.
  const roasters = useResource<RoasterProfile>("roaster_profiles", { limit: 500 });

  // All-status payload — single bulk call carries every roaster's
  // snapshot age + diff counts. Manual fetch (not registered as a
  // CRUD resource — it's a curated orchestrator dashboard).
  const [status, setStatus] = useState<SyncStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const fetchStatus = useCallback(async () => {
    try {
      const resp: any = await apiFetchRaw("/admin/sync/all-status");
      setStatus(resp?.data?.roasters || []);
    } catch {
      setStatus([]);
    } finally {
      setStatusLoading(false);
    }
  }, []);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Filter state ────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [diffStatus, setDiffStatus] = useState<DiffStatus>("any");
  const [lastSync, setLastSync] = useState<LastSyncBucket>("any");
  const [journalHint, setJournalHint] = useState<JournalHintStatus>("any");

  const toggleCity = (c: string) => setSelectedCities((prev) =>
    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
  );
  const togglePlatform = (p: string) => setSelectedPlatforms((prev) =>
    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
  );
  const resetFilters = () => {
    setSelectedCities([]);
    setSelectedPlatforms([]);
    setDiffStatus("any");
    setLastSync("any");
    setJournalHint("any");
  };
  const activeFilterCount =
    (selectedCities.length > 0 ? 1 : 0) +
    (selectedPlatforms.length > 0 ? 1 : 0) +
    (diffStatus !== "any" ? 1 : 0) +
    (lastSync !== "any" ? 1 : 0) +
    (journalHint !== "any" ? 1 : 0);

  // Index status by slug for fast lookup during filter
  const statusBySlug = useMemo(() => {
    const m: Record<string, SyncStatus> = {};
    for (const r of status) m[r.slug] = r;
    return m;
  }, [status]);

  // Distinct cities + platforms from the status payload
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const r of status) if (r.city) set.add(r.city);
    return Array.from(set).sort();
  }, [status]);
  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of status) set.add(r.platform || "unknown");
    return Array.from(set).sort();
  }, [status]);

  // Apply filters ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (roasters.data || []).filter((r) => r.published === 1);
    return rows.filter((r) => {
      const slug = r.roaster_slug;
      const st = statusBySlug[slug];

      // Search
      if (q) {
        const hit =
          (r.name || "").toLowerCase().includes(q) ||
          (slug || "").toLowerCase().includes(q) ||
          (r.website || "").toLowerCase().includes(q);
        if (!hit) return false;
      }

      // Region
      if (selectedCities.length > 0 && !selectedCities.includes(r.city || "")) {
        return false;
      }

      // Platform
      if (selectedPlatforms.length > 0) {
        const p = st?.platform || "unknown";
        if (!selectedPlatforms.includes(p)) return false;
      }

      // Diff status
      if (diffStatus !== "any") {
        if (!st && diffStatus !== "no_snapshot") return false;
        if (diffStatus === "no_snapshot" && st?.has_snapshot) return false;
        if (diffStatus === "has_diff" && (!st || totalDiff(st) === 0)) return false;
        if (diffStatus === "clean" && (!st || !st.has_snapshot || totalDiff(st) > 0)) return false;
      }

      // Last sync age
      if (lastSync !== "any") {
        const age = ageDays(st?.last_sync || null);
        if (lastSync === "never" && age !== null) return false;
        if (lastSync === "over_7d" && (age === null || age <= 7)) {
          // never-synced counts toward "older than" buckets per
          // RoastersPanel's BUCKET semantics — extreme staleness.
          if (age !== null) return false;
        }
        if (lastSync === "over_30d" && (age === null || age <= 30)) {
          if (age !== null) return false;
        }
      }

      // Journal hint
      if (journalHint !== "any") {
        const has = !!st?.article_hint_present;
        if (journalHint === "generated" && !has) return false;
        if (journalHint === "missing" && has) return false;
      }

      return true;
    });
  }, [
    roasters.data, search, statusBySlug,
    selectedCities, selectedPlatforms, diffStatus, lastSync, journalHint,
  ]);

  // ── Bulk refresh CTA ────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    if (refreshing || filtered.length === 0) return;
    hapticCommit();
    setRefreshing(true);
    try {
      const slugs = filtered.map((r) => r.roaster_slug);
      await apiFetchRaw("/admin/sync-bulk", {
        method: "POST",
        body: JSON.stringify({ slugs, mode: "tab2" }),
        headers: { "Content-Type": "application/json" },
      });
      // Background tasks landed — poll until diffs land. Each sync
      // is a fresh crawl + hash + diff (~3-8s per roaster). For a
      // 96-roaster sweep that's ~5-10 min total wall time.
      const interval = setInterval(async () => {
        await fetchStatus();
      }, 8000);
      // Stop polling after 5 min — if user wants more, manual reload.
      setTimeout(() => clearInterval(interval), 5 * 60_000);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, filtered, fetchStatus]);

  return (
    <View style={s.wrap}>
      {/* ── Hero strip ───────────────────────────────────────────────── */}
      <View style={s.hero}>
        <Text style={s.heroTitle}>Refresh Catalog</Text>
        <Text style={s.heroBlurb}>
          Diff each roaster's website against the last snapshot and re-enrich
          only what changed. Tap a roaster to inspect its current snapshot,
          see what's new since last sync, and run a cheap diff refresh.
        </Text>
        <Text style={s.heroFootnote}>
          Steady-state runs zero LLM calls. Use{" "}
          <Text style={s.heroFootnoteEmph}>Roasters & Beans</Text> for full
          re-baselining (regenerates bio + re-crawls the whole catalog and
          journal).
        </Text>
      </View>

      {/* ── Bulk Refresh CTA — orchestrator's one-button sweep ─────── */}
      <Pressable
        onPress={refreshAll}
        disabled={refreshing || filtered.length === 0}
        style={({ pressed }) => [
          s.bulkCta,
          (refreshing || filtered.length === 0) && s.bulkCtaDisabled,
          pressed && s.bulkCtaPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Refresh all ${filtered.length} roasters`}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
        ) : (
          <RefreshCw size={t.size["icon.md"]} color={t.color["text.on-cta"]} strokeWidth={2} />
        )}
        <Text style={s.bulkCtaText}>
          {refreshing
            ? `Syncing ${filtered.length}…`
            : `Refresh all (${filtered.length})`}
        </Text>
      </Pressable>

      {/* ── Section header + filter trigger ─────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Catalog</Text>
        <Pressable
          onPress={() => { hapticTap(); setFilterDrawerOpen(true); }}
          style={({ pressed }) => [s.filterIconBtn, pressed && s.filterIconBtnPressed]}
          hitSlop={8}
          accessibilityLabel="Filters"
        >
          <SlidersHorizontal size={t.size["icon.lg"]} color={t.color["text.primary"]} strokeWidth={1.75} />
          {activeFilterCount > 0 ? (
            <View style={s.filterIconDot} />
          ) : null}
        </Pressable>
      </View>

      <TextInput
        style={s.search}
        placeholder="Filter by name, slug, or URL…"
        placeholderTextColor={t.color["text.muted"]}
        value={search}
        onChangeText={setSearch}
      />

      {(roasters.loading || statusLoading) && filtered.length === 0 ? (
        <View style={s.emptyBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={s.emptyText}>Nothing here yet.</Text>
      ) : (
        <View style={s.rowList}>
          {filtered.map((r, idx) => {
            const st = statusBySlug[r.roaster_slug];
            const diff = st ? totalDiff(st) : 0;
            return (
              <View key={r.roaster_slug} style={s.rowWrap}>
                <RoasterRow
                  imageUrl={r.logo_url || r.hero_image_url || undefined}
                  name={r.name || r.roaster_slug}
                  city={r.city}
                  state={r.state}
                  productsCount={r.products_count || 0}
                  showDivider={idx < filtered.length - 1}
                  onPress={() => router.push(`/admin/refresh/${r.roaster_slug}` as any)}
                />
                {/* Diff status badge — overlays right side. Cream pill
                   with brand-pink for "has diff", muted for "clean",
                   no-pill for "no snapshot". */}
                {st && diff > 0 ? (
                  <View style={s.diffBadge} pointerEvents="none">
                    <Text style={s.diffBadgeText}>{diff} change{diff === 1 ? "" : "s"}</Text>
                  </View>
                ) : st && st.has_snapshot ? (
                  <View style={s.cleanBadge} pointerEvents="none">
                    <Text style={s.cleanBadgeText}>clean</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Filter drawer ──────────────────────────────────────────── */}
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
                style={s.drawerClose}
              >
                <X size={t.size["icon.lg"]} color={t.color["text.primary"]} strokeWidth={1.75} />
              </Pressable>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.drawerBody}
              showsVerticalScrollIndicator={false}
            >
              <CollapsibleSection
                title="Diff status"
                activeCount={diffStatus !== "any" ? 1 : 0}
              >
                {DIFF_OPTIONS.map((opt) => {
                  const active = diffStatus === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setDiffStatus(opt.key)}
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

              <View style={s.divider} />

              <CollapsibleSection
                title="Last sync"
                activeCount={lastSync !== "any" ? 1 : 0}
              >
                {LAST_SYNC_OPTIONS.map((opt) => {
                  const active = lastSync === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setLastSync(opt.key)}
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

              <View style={s.divider} />

              <CollapsibleSection
                title="Platform"
                activeCount={selectedPlatforms.length}
              >
                {platforms.length === 0 ? (
                  <Text style={s.emptySection}>No platforms detected yet.</Text>
                ) : (
                  platforms.map((p) => {
                    const checked = selectedPlatforms.includes(p);
                    return (
                      <Pressable
                        key={p}
                        onPress={() => togglePlatform(p)}
                        style={s.checkRow}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <View style={[s.checkBox, checked && s.checkBoxOn]}>
                          {checked ? <Text style={s.checkBoxTick}>{"✓"}</Text> : null}
                        </View>
                        <Text style={s.checkLabel}>{p}</Text>
                      </Pressable>
                    );
                  })
                )}
              </CollapsibleSection>

              <View style={s.divider} />

              <CollapsibleSection
                title="Journal quirk"
                activeCount={journalHint !== "any" ? 1 : 0}
              >
                {JOURNAL_HINT_OPTIONS.map((opt) => {
                  const active = journalHint === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setJournalHint(opt.key)}
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

              <View style={s.divider} />

              <CollapsibleSection
                title="Region"
                activeCount={selectedCities.length}
              >
                {cities.length === 0 ? (
                  <Text style={s.emptySection}>No cities yet.</Text>
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
                          {checked ? <Text style={s.checkBoxTick}>{"✓"}</Text> : null}
                        </View>
                        <Text style={s.checkLabel}>{city}</Text>
                      </Pressable>
                    );
                  })
                )}
              </CollapsibleSection>
            </ScrollView>
            <View style={s.drawerFooter}>
              <Pressable
                onPress={() => { hapticTap(); resetFilters(); }}
                disabled={activeFilterCount === 0}
                style={({ pressed }) => [
                  s.resetBtn,
                  activeFilterCount === 0 && s.resetBtnDisabled,
                  pressed && s.iconBtnPressed,
                ]}
              >
                <Text style={s.resetText}>
                  Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { hapticCommit(); setFilterDrawerOpen(false); }}
                style={({ pressed }) => [s.applyBtn, pressed && s.applyBtnPressed]}
              >
                <Text style={s.applyText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </SlidePanel>
      ) : null}
    </View>
  );
}

// ── Collapsible section (matches RoastersPanel pattern) ──────────────────
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
      {open ? <View style={{ paddingTop: t.spacing.xs }}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { gap: t.spacing.lg } as any,

  hero: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.lg,
    gap: t.spacing.sm,
  } as any,
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 30,
    color: t.color["text.primary"],
  } as any,
  heroBlurb: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: 22,
  } as any,
  heroFootnote: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    lineHeight: 20,
    marginTop: t.spacing.xs,
  } as any,
  heroFootnoteEmph: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.secondary"],
  } as any,

  // Bulk refresh CTA — orchestrator's one-button sweep across filtered
  // set. Pink pill (accent.cta) + Espresso text — the canonical primary-
  // button pairing. Same shape as the per-roaster "Refresh diff" CTA on
  // /admin/refresh/[slug] so the orchestrator-level affordance reads
  // as "the bulk version of that one".
  bulkCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.sm,
    backgroundColor: t.color["accent.cta"],
    borderRadius: t.radius.full,
    paddingHorizontal: t.spacing.xl,
    minHeight: 52,
  } as any,
  bulkCtaDisabled: { opacity: 0.5 } as any,
  bulkCtaPressed: { transform: [{ scale: 0.99 }] } as any,
  bulkCtaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-cta"],
    letterSpacing: 0.3,
  } as any,

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.md,
  } as any,
  sectionTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
  } as any,
  filterIconBtn: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    alignItems: "center",
    justifyContent: "center",
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

  search: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    minHeight: 44,
  } as any,

  rowList: { paddingBottom: t.spacing.xl } as any,
  rowWrap: { position: "relative" } as any,
  diffBadge: {
    position: "absolute",
    right: t.spacing.md,
    top: "50%",
    transform: [{ translateY: -10 }],
    backgroundColor: t.color["accent.cta"],
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.full,
  } as any,
  diffBadgeText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    letterSpacing: 0.3,
  } as any,
  cleanBadge: {
    position: "absolute",
    right: t.spacing.md,
    top: "50%",
    transform: [{ translateY: -10 }],
    backgroundColor: t.color["tag.bg"],
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.full,
  } as any,
  cleanBadgeText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.3,
    textTransform: "uppercase",
  } as any,

  emptyBlock: { alignItems: "center", paddingVertical: t.spacing["2xl"] } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing["2xl"],
  } as any,
  emptySection: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    paddingVertical: t.spacing.sm,
  } as any,

  // ── Drawer shell — clones the RoastersPanel locDrawer pattern ────
  drawer: { flex: 1, backgroundColor: t.color.bg } as any,
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  } as any,
  drawerTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  } as any,
  drawerClose: {
    width: 36, height: 36, borderRadius: t.radius.full,
    alignItems: "center", justifyContent: "center",
  } as any,
  drawerBody: {
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
  collapsibleHead: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm } as any,
  collapsibleBadge: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.on-cta"],
    backgroundColor: t.color.accent,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 6,
    textAlign: "center", lineHeight: 18, overflow: "hidden",
  } as any,
  divider: {
    height: 1,
    backgroundColor: t.color["border.light"],
    marginVertical: t.spacing.md,
  } as any,
  checkRow: {
    flexDirection: "row", alignItems: "center",
    gap: t.spacing.md, paddingVertical: t.spacing.xs,
  } as any,
  radio: {
    width: 20, height: 20, borderRadius: t.radius.full,
    borderWidth: 1.5, borderColor: t.color.border,
    backgroundColor: t.color["card.front"],
    alignItems: "center", justifyContent: "center",
  } as any,
  radioOn: { borderColor: t.color.accent } as any,
  radioDot: {
    width: 10, height: 10, borderRadius: t.radius.full,
    backgroundColor: t.color.accent,
  } as any,
  checkBox: {
    width: 20, height: 20, borderRadius: t.radius.sm,
    borderWidth: 1.5, borderColor: t.color.border,
    backgroundColor: t.color["card.front"],
    alignItems: "center", justifyContent: "center",
  } as any,
  checkBoxOn: { backgroundColor: t.color.accent, borderColor: t.color.accent } as any,
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
  } as any,
  drawerFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.lg,
    borderTopWidth: 1, borderTopColor: t.color["border.light"],
    gap: t.spacing.md,
  } as any,
  resetBtn: {
    paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md,
    borderRadius: t.radius.md, backgroundColor: t.color["card.info"],
  } as any,
  resetBtnDisabled: { opacity: 0.4 } as any,
  resetText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  } as any,
  applyBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md,
    borderRadius: t.radius.md, backgroundColor: t.color.accent,
  } as any,
  applyBtnPressed: { opacity: 0.85 } as any,
  applyText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  } as any,
  iconBtnPressed: { opacity: 0.7 } as any,
}));
