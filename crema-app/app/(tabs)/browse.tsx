/**
 * Browse/Shop page — faithfully ported from main with CRUD Utopia imports/API.
 *
 * Layout, styles, component structure, and responsive patterns are identical to main.
 * Only imports, API calls, and component references are updated for crud-utopia.
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { Image } from "expo-image";
import { Search, X, ArrowRight } from "lucide-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useResource } from "../../src/resources/useResource";
import { useSearchBarAutoHide } from "../../src/hooks/useSearchBarAutoHide";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import { t, cardShadow } from "../../src/tokens/useTokens";
import CoffeeList from "../../src/components/CoffeeList";
import RoasterRow from "../../src/components/RoasterRow";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import type { RoasterProfile } from "../../src/resources/types";
import SlidePanel from "../../src/components/mobile/SlidePanel";
import { SlidersHorizontal } from "lucide-react-native";

export default function BrowsePage() {
  const { products, roasters, roastLevels, processes, fetchProducts } = useCoffeeData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const { isMobile } = useBreakpoint();

  // Re-fetch products every time the user lands on Discover. Admin
  // approvals on a fresh enrichment land in `products`; without this
  // hook the consumer-side cache stays stale until app reload.
  useFocusEffect(
    useCallback(() => {
      fetchProducts();
    }, [fetchProducts]),
  );
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [query, setQuery] = useState("");
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"beans" | "roasters">("beans");
  const [sortBy, setSortBy] = useState<string>("featured");
  const [selectedRoasters, setSelectedRoasters] = useState<string[]>([]);
  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
  // Roasters tab — Location filter. Lifted to BrowsePage so the
  // mobile filter drawer (rendered here) can edit the same array
  // that the desktop sidebar inside RoastersList reads.
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  // §2.16 — stable search-bar hide that doesn't thrash at
  // end-of-list. Replaces the old raw `y > lastY && y > 10` toggle.
  const { hidden: searchBarHidden, handleScroll: handleBeansScroll } = useSearchBarAutoHide();
  // Two new lens-style toggles for catalog freshness
  // filter: `newOnly` narrows to beans created in the last 30 days
  // (catalog-freshness signal — useful right after an enrichment
  // run); `showSoldOut` flips the default available-only view to
  // show ONLY sold-out beans (admin-y diagnostic — pre-launch the
  // soft plan is to drop sold-outs from the catalog entirely; for
  // now this lens lets us see them).
  const [newOnly, setNewOnly] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(false);
  // 30 days expressed in milliseconds — `created_at` is ISO so a
  // single Date.parse + arithmetic gets the cutoff. Defined once
  // outside the filter useMemo so it stays cheap.
  const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  // §2.34 — mobile filter drawer. On narrow screens the sidebar is
  // hidden; a Filters button next to the search bar slides this in
  // from the right using the shared SlidePanel primitive.
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  useEffect(() => {
    apiFetchRaw("/products/popularity").then((r) => {
      const d = r?.data ?? r;
      setPopularity(typeof d === "object" && !Array.isArray(d) ? d : {});
    }).catch(() => {});
  }, []);

  // Inline filtering (replaces filterCoffees utility)
  const filtered = useMemo(() => {
    // Default lens: in-stock only. `showSoldOut` flips it to
    // sold-out only — the two are exclusive, never overlapping
    // (consumer browsing wants either fresh stock or the "what's
    // gone missing" lens, not a mix).
    let list = showSoldOut
      ? products.filter((p: any) => p.available === false || p.available === 0)
      : products.filter((p: any) => p.available !== false && p.available !== 0);
    if (newOnly) {
      const cutoff = Date.now() - NEW_WINDOW_MS;
      list = list.filter((p: any) => {
        const ts = Date.parse(p.created_at || "");
        return Number.isFinite(ts) && ts >= cutoff;
      });
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p: any) =>
        (p.coffee_name || "").toLowerCase().includes(q) ||
        (p.roaster_name || "").toLowerCase().includes(q) ||
        (p.origin || "").toLowerCase().includes(q) ||
        (p.tasting_notes || "").toLowerCase().includes(q)
      );
    }
    if (selectedRoasters.length > 0) list = list.filter((p: any) => selectedRoasters.includes(p.roaster_slug));
    if (selectedRoasts.length > 0) list = list.filter((p: any) => selectedRoasts.includes(p.roast_level));
    if (selectedProcesses.length > 0) list = list.filter((p: any) => selectedProcesses.includes(p.process));

    // Sort
    if (sortBy === "featured" && Object.keys(popularity).length > 0) {
      list = [...list].sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    } else if (sortBy === "price_low") {
      list = [...list].sort((a, b) => (a.price_inr || 0) - (b.price_inr || 0));
    } else if (sortBy === "price_high") {
      list = [...list].sort((a, b) => (b.price_inr || 0) - (a.price_inr || 0));
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => {
        const ta = Date.parse(a.created_at || "") || 0;
        const tb = Date.parse(b.created_at || "") || 0;
        return tb - ta;
      });
    }
    return list;
  }, [products, query, selectedRoasters, selectedRoasts, selectedProcesses, sortBy, popularity, newOnly, showSoldOut]);

  const filteredRoasterCount = useMemo(() => new Set(filtered.map((p: any) => p.roaster_slug)).size, [filtered]);

  // Cities derived once for the mobile drawer — same shape the
  // RoastersList sidebar uses, kept in sync because both consume the
  // same `roasters` from useCoffeeData.
  const cities = useMemo(() => {
    const set = new Set<string>();
    (roasters as any[]).forEach((r: any) => { if (r.city) set.add(r.city); });
    return Array.from(set).sort();
  }, [roasters]);

  // Per-tab filter activity. The drawer + the filter-icon dot need
  // to reflect what's actually editable from the current tab, not
  // the union of bean + roaster filters.
  const beansFilterCount =
    selectedRoasters.length +
    selectedRoasts.length +
    selectedProcesses.length +
    (newOnly ? 1 : 0) +
    (showSoldOut ? 1 : 0);
  const roastersFilterCount = selectedCities.length;
  const activeFilterCount = activeTab === "roasters" ? roastersFilterCount : beansFilterCount;
  const hasActiveFilters = activeTab === "roasters"
    ? roastersFilterCount > 0
    : (beansFilterCount > 0 || !!query);

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const clearAll = () => {
    if (activeTab === "roasters") {
      setSelectedCities([]);
    } else {
      setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); setQuery("");
      setNewOnly(false); setShowSoldOut(false);
    }
  };

  return (
    <View style={s.container}>
      {/* Sub-tabs. Mobile layout mirrors Figma 63:4890 exactly:
         60-px tall cream strip, BEANS + ROASTERS + CAFÉS
         left-aligned with a 26-px gap between them, and a
         FadersHorizontal filter icon pinned to the right INSIDE
         the same row. The filter icon toggles the §2.34
         FilterDrawer. The wide-web layout keeps the old
         LOOKING FOR prefix + evenly-spaced tabs. */}
      <View style={[s.tabBar, isMobile && s.tabBarMobile]}>
        <View style={s.tabBarInner}>
          {!isMobile && (
            <View style={[s.tabBarLeft, { width: sidebarW }]}>
              <Text style={s.lookingForLabel}>LOOKING FOR</Text>
            </View>
          )}
          <View style={[s.tabBarRight, isMobile && s.tabBarRightMobile]}>
            <TabButton label="BEANS" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
            <TabButton label="ROASTERS" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
            {isMobile && (
              <Pressable
                onPress={() => setFilterDrawerOpen(true)}
                style={s.tabBarFilterBtn}
                hitSlop={8}
                accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
                accessibilityRole="button"
              >
                <SlidersHorizontal size={24} color={t.color["text.primary"]} strokeWidth={1.75} />
                {activeFilterCount > 0 && <View style={s.tabBarFilterDot} />}
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {activeTab === "beans" ? (
        <View style={[s.browseLayout, isMobile && s.browseLayoutMobile]}>
          {isDesktop && (
            <ScrollView
              style={[s.sidebar, { width: sidebarW, minWidth: sidebarW, maxWidth: sidebarW }]}
              contentContainerStyle={{ paddingRight: 16, paddingTop: 20, paddingBottom: 60 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.sidebarCount}>
                <Text style={s.sidebarCountBold}>{filtered.length}</Text> coffees from{" "}
                <Text style={s.sidebarCountBold}>{filteredRoasterCount}</Text> roasters
              </Text>

              {hasActiveFilters && (
                <Pressable onPress={clearAll} style={{ marginBottom: 12 }}>
                  <Text style={s.clearText}>Clear all</Text>
                </Pressable>
              )}


              {/* Catalog freshness lenses \u2014 `New` narrows to beans
                 created in the last 30 days; `Sold out` flips the
                 default in-stock lens to show only retired stock.
                 Same checkbox geometry as the wholesale row above. */}
              <View style={s.filterSection}>
                <Pressable
                  onPress={() => setNewOnly((v) => !v)}
                  style={s.wholesaleRow}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: newOnly }}
                >
                  <View style={[s.wholesaleBox, newOnly && s.wholesaleBoxOn]}>
                    {newOnly && <Text style={s.wholesaleBoxTick}>{"\u2713"}</Text>}
                  </View>
                  <Text style={s.wholesaleLabel}>New (last 30 days)</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowSoldOut((v) => !v)}
                  style={s.wholesaleRow}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: showSoldOut }}
                >
                  <View style={[s.wholesaleBox, showSoldOut && s.wholesaleBoxOn]}>
                    {showSoldOut && <Text style={s.wholesaleBoxTick}>{"\u2713"}</Text>}
                  </View>
                  <Text style={s.wholesaleLabel}>Sold out</Text>
                </Pressable>
              </View>
              <View style={s.filterDivider} />

              <View style={s.filterSection}>
                <Text style={s.filterTitle}>Sort By</Text>
                {[
                  { key: "featured", label: "Featured" },
                  { key: "newest", label: "Newest" },
                  { key: "price_low", label: "Price: Low\u2013High" },
                  { key: "price_high", label: "Price: High\u2013Low" },
                ].map(opt => (
                  <Pressable key={opt.key} onPress={() => setSortBy(opt.key)} style={s.radioRow}>
                    <View style={[s.radio, sortBy === opt.key && s.radioSelected]}>
                      {sortBy === opt.key && <View style={s.radioDot} />}
                    </View>
                    <Text style={s.checkLabel}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.filterDivider} />
              <FilterSection title="Roast" items={roastLevels.map((l: string) => ({ key: l, label: l }))} selected={selectedRoasts} onToggle={v => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
              <View style={s.filterDivider} />
              <FilterSection title="Roasters" items={roasters.map((r: any) => ({ key: r.slug, label: r.name }))} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
              <View style={s.filterDivider} />
              <FilterSection title="Process" items={processes.map((p: string) => ({ key: p, label: p }))} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
            </ScrollView>
          )}

          {isDesktop && <View style={s.verticalDivider} />}

          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Scroll-aware search bar. On mobile the filter icon
                lives INSIDE the tab bar (§Figma 63:5934) — the
                search row is input-only. */}
            {/* Search bar. On mobile the MobileHeader + chrome-scroll
                already hides out of the way — running BOTH hide
                animations in parallel caused jitter (setState reflow
                on every scroll event fighting the chrome anim), so
                we skip the state-based collapse here on mobile and
                leave the search row sticky. Web wide still runs the
                §2.16 useSearchBarAutoHide pattern. */}
            <View style={[s.searchBarWrap, !isMobile && searchBarHidden && s.searchBarWrapHidden] as any}>
              <View style={s.stickySearchWrap}>
                <View style={s.searchBar}>
                  <Search size={16} color={t.color["text.muted"]} />
                  <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={query} onChangeText={setQuery} style={s.searchInput} />
                  {query ? <Pressable onPress={() => setQuery("")} hitSlop={14} accessibilityLabel="Clear search"><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
                </View>
                {/* Live coffee + roaster count under the search bar.
                   Always visible (not just on desktop sidebar) so the
                   admin can watch numbers move as enrichment runs
                   land new beans. Reflects whatever filter lens is
                   active (sold-out, new, wholesale, etc.). */}
                <Text style={s.beansCount}>
                  <Text style={s.beansCountBold}>{filtered.length}</Text>{" "}
                  {filtered.length === 1 ? "coffee" : "coffees"} from{" "}
                  <Text style={s.beansCountBold}>{filteredRoasterCount}</Text>{" "}
                  {filteredRoasterCount === 1 ? "roaster" : "roasters"}
                  {showSoldOut ? " · sold-out lens" : ""}
                  {newOnly ? " · added in last 30 days" : ""}
                </Text>
              </View>
            </View>

            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              onScroll={(e) => { onChromeScroll(e); if (!isMobile) handleBeansScroll(e); }}
              ListHeaderComponent={
                hasActiveFilters ? (
                  <View style={s.listHeader}>
                    <View style={s.activeChips}>
                      {selectedRoasts.map(v => <ActiveChip key={v} label={v} onRemove={() => toggleArray(selectedRoasts, setSelectedRoasts, v)} />)}
                      {selectedProcesses.map(v => <ActiveChip key={v} label={v} onRemove={() => toggleArray(selectedProcesses, setSelectedProcesses, v)} />)}
                      {selectedRoasters.map(slug => {
                        const r = roasters.find((r: any) => r.slug === slug);
                        return <ActiveChip key={slug} label={r?.name || slug} onRemove={() => toggleArray(selectedRoasters, setSelectedRoasters, slug)} />;
                      })}
                    </View>
                  </View>
                ) : null
              }
            />
          </View>
        </View>
      ) : (
        <RoastersList
          cities={cities}
          selectedCities={selectedCities}
          setSelectedCities={setSelectedCities}
        />
      )}

      {/* §2.34 — Mobile filter drawer. Reuses the SlidePanel primitive
          and binds to the exact same state the desktop sidebar does,
          so toggling between narrow and wide viewports mid-session
          never resets a filter. */}
      {!isDesktop && (
        <View style={StyleSheet.absoluteFillObject as any} pointerEvents={filterDrawerOpen ? "auto" : "none"}>
          <SlidePanel
            visible={filterDrawerOpen}
            onClose={() => setFilterDrawerOpen(false)}
            side="right"
            widthPercent={88}
          >
            <View style={s.filterDrawerBody}>
              <View style={s.filterDrawerHeader}>
                <Text style={s.filterDrawerTitle}>Filter</Text>
                <Pressable
                  onPress={() => setFilterDrawerOpen(false)}
                  hitSlop={10}
                  accessibilityLabel="Close filters"
                  accessibilityRole="button"
                  style={s.filterDrawerClose}
                >
                  <X size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
                </Pressable>
              </View>
              <View style={s.filterDivider} />
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {activeTab === "roasters" ? (
                  // ROASTERS tab — Location only, per the Figma 40:2769
                  // sidebar spec. Bean-attribute filters belong to the
                  // BEANS tab and have nothing to say about a roaster.
                  <FilterSection
                    title="Location"
                    items={cities.map(c => ({ key: c, label: c }))}
                    selected={selectedCities}
                    onToggle={v => toggleArray(selectedCities, setSelectedCities, v)}
                    maxVisible={20}
                  />
                ) : (
                  <>
                    {/* Catalog freshness lenses \u2014 same checkboxes as
                       the desktop sidebar, bound to the same state
                       so toggling between viewports never resets. */}
                    <View style={s.filterSection}>
                      <Pressable
                        onPress={() => setNewOnly((v) => !v)}
                        style={s.wholesaleRow}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: newOnly }}
                      >
                        <View style={[s.wholesaleBox, newOnly && s.wholesaleBoxOn]}>
                          {newOnly && <Text style={s.wholesaleBoxTick}>{"\u2713"}</Text>}
                        </View>
                        <Text style={s.wholesaleLabel}>New (last 30 days)</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setShowSoldOut((v) => !v)}
                        style={s.wholesaleRow}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: showSoldOut }}
                      >
                        <View style={[s.wholesaleBox, showSoldOut && s.wholesaleBoxOn]}>
                          {showSoldOut && <Text style={s.wholesaleBoxTick}>{"\u2713"}</Text>}
                        </View>
                        <Text style={s.wholesaleLabel}>Sold out</Text>
                      </Pressable>
                    </View>
                    <View style={s.filterDivider} />
                    <View style={s.filterSection}>
                      <Text style={s.filterTitle}>Sort By</Text>
                      {[
                        { key: "featured", label: "Featured" },
                        { key: "newest", label: "Newest" },
                        { key: "price_low", label: "Price: Low\u2013High" },
                        { key: "price_high", label: "Price: High\u2013Low" },
                      ].map(opt => (
                        <Pressable key={opt.key} onPress={() => setSortBy(opt.key)} style={s.radioRow}>
                          <View style={[s.radio, sortBy === opt.key && s.radioSelected]}>
                            {sortBy === opt.key && <View style={s.radioDot} />}
                          </View>
                          <Text style={s.checkLabel}>{opt.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={s.filterDivider} />
                    <FilterSection title="Roast" items={roastLevels.map((l: string) => ({ key: l, label: l }))} selected={selectedRoasts} onToggle={v => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Roasters" items={roasters.map((r: any) => ({ key: r.slug, label: r.name }))} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Process" items={processes.map((p: string) => ({ key: p, label: p }))} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
                  </>
                )}
              </ScrollView>
              {/* Footer actions — reset (with per-tab count) on the
                  left, apply on the right. */}
              <View style={s.filterDrawerFooter}>
                <Pressable
                  onPress={clearAll}
                  disabled={!hasActiveFilters}
                  style={[s.filterResetBtn, !hasActiveFilters && s.filterResetBtnDisabled]}
                >
                  <Text style={s.filterResetText}>
                    Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setFilterDrawerOpen(false)} style={s.filterApplyBtn}>
                  <Text style={s.filterApplyText}>Apply</Text>
                </Pressable>
              </View>
            </View>
          </SlidePanel>
        </View>
      )}
    </View>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={s.activeChip}>
      <Text style={s.activeChipText}>{label}</Text>
      <Pressable onPress={onRemove} hitSlop={14} accessibilityLabel={`Remove ${label}`}><X size={10} color={t.color["tag.text"]} /></Pressable>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.tabBtn}>
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
      {active && <View style={s.tabUnderline} />}
    </Pressable>
  );
}

function FilterSection({ title, items, selected, onToggle, maxVisible = 10 }: {
  title: string; items: { key: string; label: string }[];
  selected: string[]; onToggle: (key: string) => void; maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;

  return (
    <View style={s.filterSection}>
      <Text style={s.filterTitle}>{title}</Text>
      {visible.map(({ key, label }) => (
        <Pressable key={key} onPress={() => onToggle(key)} style={s.checkRow}>
          <View style={[s.checkbox, selected.includes(key) && s.checkboxChecked]}>
            {selected.includes(key) && <Text style={s.checkmark}>{"\u2713"}</Text>}
          </View>
          <Text style={s.checkLabel} numberOfLines={2}>{label}</Text>
        </Pressable>
      ))}
      {hasMore && !expanded && (
        <Pressable onPress={() => setExpanded(true)}>
          <Text style={s.showMoreText}>Show all {items.length}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Roasters tab ────────────────────────────────────────────────────────────

/**
 * Grid-sized roaster / café card. Mirrors CoffeeCard's 240-wide
 * portrait geometry so Discover feels like one consistent browsing
 * surface across BEANS / ROASTERS / CAFÉS. Image on top, info block
 * below on `card.info` cream so the card stacks neatly next to
 * CoffeeCards.
 */
function BrowseCard({
  imageUrl, fallbackInitial, name, subtitle, onPress, width: cardW,
}: {
  imageUrl?: string; fallbackInitial: string; name: string; subtitle: string;
  onPress: () => void; width: number;
}) {
  // Image takes a fixed fraction of the card width (square-ish hero
  // so the bean / cafe photo reads cleanly regardless of aspect),
  // info sits below with just enough height for a 2-line Canela name
  // + 1-line subtitle. No wasted cream — keeps the card feeling
  // tight the way CoffeeCard does.
  const imgH = Math.round(cardW * 0.7);
  return (
    <Pressable onPress={onPress} style={[s.bcCard, { width: cardW }]}>
      <View style={[s.bcImage, { width: cardW, height: imgH }]}>
        {imageUrl ? (
          <Image source={{ uri: resolveUploadUrl(imageUrl) }} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject as any, { alignItems: "center", justifyContent: "center" }]}>
            <Text style={s.bcFallback}>{fallbackInitial.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={[s.bcInfo, { width: cardW }]}>
        <Text style={s.bcName} numberOfLines={2}>{name}</Text>
        {subtitle ? <Text style={s.bcSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function RoastersList({
  cities,
  selectedCities,
  setSelectedCities,
}: {
  cities: string[];
  selectedCities: string[];
  setSelectedCities: (next: string[]) => void;
}) {
  const router = useRouter();
  const { products } = useCoffeeData();
  // Discover ROASTERS now reads `roaster_profiles` directly so the
  // list is 1:1 with what the admin enriched (and published), not a
  // products-derived view that hid every freshly-enriched roaster
  // until at least one bean was scraped + approved. Profiles with
  // `published=0` (unreviewed drafts) stay hidden from consumers.
  const profilesResource = useResource<RoasterProfile>("roaster_profiles", { limit: 500 });
  const { width } = useWindowDimensions();
  const { isMobile } = useBreakpoint();
  const isDesktop = width >= 1024;
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [roasterQuery, setRoasterQuery] = useState("");
  const { hidden: searchBarHidden, handleScroll } = useSearchBarAutoHide();

  // Re-fetch every time the user comes back to Discover. Admin
  // approvals on a fresh enrichment land in `products` /
  // `roaster_profiles`; this hook makes those visible without
  // requiring an app reload.
  useFocusEffect(
    useCallback(() => {
      profilesResource.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Per-roaster fallback image — the profile's own logo / hero takes
  // precedence; the first product image is the fallback for legacy
  // roasters whose profile assets haven't been filled in yet.
  const roasterImages = useMemo(() => {
    const map: Record<string, string> = {};
    (products as any[]).forEach((p: any) => {
      if (p.image_url && !map[p.roaster_slug]) map[p.roaster_slug] = p.image_url;
    });
    return map;
  }, [products]);

  const publishedProfiles = useMemo(() => {
    return (profilesResource.data || []).filter((p) => p.published === 1);
  }, [profilesResource.data]);

  const filteredRoasters = useMemo(() => {
    let result = publishedProfiles;
    if (roasterQuery) {
      const q = roasterQuery.toLowerCase();
      result = result.filter((r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.city || "").toLowerCase().includes(q)
      );
    }
    if (selectedCities.length > 0) {
      result = result.filter((r) => !!r.city && selectedCities.includes(r.city));
    }
    // Sort: most-stocked roasters surface first; alphabetical secondary.
    return [...result].sort((a, b) => {
      const ap = a.products_count || 0;
      const bp = b.products_count || 0;
      if (ap !== bp) return bp - ap;
      return (a.name || a.roaster_slug).localeCompare(b.name || b.roaster_slug);
    });
  }, [publishedProfiles, roasterQuery, selectedCities]);

  const toggleCity = (city: string) => {
    // setSelectedCities arrives from BrowsePage as a plain `(next) =>`
    // setter, so we resolve the new array from the current `selectedCities`
    // prop instead of the functional-setter pattern.
    setSelectedCities(
      selectedCities.includes(city)
        ? selectedCities.filter(c => c !== city)
        : [...selectedCities, city]
    );
  };

  return (
    <View style={[s.browseLayout, isMobile && s.browseLayoutMobile]}>
      {/* City filter sidebar */}
      {isDesktop && (
        <ScrollView
          style={[s.sidebar, { width: sidebarW, minWidth: sidebarW, maxWidth: sidebarW }]}
          contentContainerStyle={{ paddingRight: 16, paddingTop: 20, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sidebarCount}>
            <Text style={s.sidebarCountBold}>{filteredRoasters.length}</Text> roasters
          </Text>
          <View style={s.filterDivider} />
          <FilterSection
            title="Location"
            items={cities.map(c => ({ key: c, label: c }))}
            selected={selectedCities}
            onToggle={toggleCity}
            maxVisible={20}
          />
        </ScrollView>
      )}

      {isDesktop && <View style={s.verticalDivider} />}

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[s.searchBarWrap, !isMobile && searchBarHidden && s.searchBarWrapHidden] as any}>
          <View style={s.stickySearchWrap}>
            <View style={s.searchBar}>
              <Search size={16} color={t.color["text.muted"]} />
              <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={roasterQuery} onChangeText={setRoasterQuery} style={s.searchInput} />
              {roasterQuery ? <Pressable onPress={() => setRoasterQuery("")} hitSlop={14} accessibilityLabel="Clear roaster search"><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
            </View>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { onChromeScroll(e); if (!isMobile) handleScroll(e); }}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {filteredRoasters.map((r, idx) => (
            <RoasterRow
              key={r.roaster_slug}
              imageUrl={
                r.logo_url ||
                r.hero_image_url ||
                roasterImages[r.roaster_slug] ||
                undefined
              }
              name={r.name || r.roaster_slug}
              city={r.city}
              state={r.state}
              productsCount={r.products_count || 0}
              showDivider={idx < filteredRoasters.length - 1}
              onPress={() => router.push(`/roaster/${r.roaster_slug}`)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.color.bg },

  // Tab bar
  tabBar: {
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(215,209,196,0.5)",
    backgroundColor: t.color.bg, height: 80, justifyContent: "center",
  },
  // Mobile: exact Figma 63:5927 geometry — 60 px tall, cream bg,
  // single hairline divider top + bottom (the cross-tab separator
  // plus the navbar/search edge). Paddings are baked into
  // `tabBarRightMobile` (paddingHorizontal 32) so the BEANS text
  // starts at x=32 per Figma 63:4979.
  tabBarMobile: {
    height: (t.size as any)["tabbar.mobile.height"],
  } as any,
  // `height: "100%"` + `alignItems: "stretch"` so the tab buttons
  // span the full tabBar height — this is what lets the
  // tabUnderline's `bottom: -1` ride the parent's borderBottom line
  // instead of hugging the text baseline. Without the explicit
  // height, tabBarInner collapses to content height (~17px) and the
  // underline sits just below the word.
  tabBarInner: { flexDirection: "row", alignItems: "stretch", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, width: "100%" as any, height: "100%" as any },
  tabBarLeft: { width: 195, flexShrink: 0, justifyContent: "center" } as any,
  tabBarRight: { flex: 1, flexDirection: "row", alignItems: "stretch", paddingLeft: 16, gap: 48 } as any,
  // Mobile: BEANS / ROASTERS / CAFÉS left-aligned with a 26 px gap
  // (Figma 63:4979→63:4981 = 58 px center-to-center minus the BEANS
  // text width of 32 = ~26 gap); filter icon pinned to the right
  // inside the same row. Absolute `paddingHorizontal: 32` overrides
  // the parent's percentage paddings on `tabBarInner`.
  tabBarRightMobile: {
    paddingLeft: 0,
    paddingHorizontal: t.spacing["3xl"],
    gap: t.spacing["2xl"],
    justifyContent: "flex-start",
  } as any,
  lookingForLabel: {
    fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"],
    textTransform: "uppercase", alignSelf: "center",
  } as any,
  tabBtn: { justifyContent: "center", position: "relative" } as any,
  tabLabel: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"] },
  tabLabelActive: { fontFamily: t.font["body.semibold"], color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: t.color["text.primary"] } as any,
  // Filter icon pinned to the right of the tab row. `marginLeft:
  // auto` pushes it to flex end regardless of how many sibling tabs
  // render. Dot badge appears when any filter is active.
  tabBarFilterBtn: {
    marginLeft: "auto" as any,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  } as any,
  tabBarFilterDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,

  // Browse layout
  browseLayout: { flex: 1, flexDirection: "row", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, paddingTop: 63 } as any,
  // Mobile: collapse the 63-px top pad entirely. The stickySearchWrap
  // below already brings its own paddingTop (12), so anything added
  // here just doubles up the gap above the search field.
  browseLayoutMobile: { paddingTop: 0, paddingLeft: 0 as any, paddingRight: 0 as any } as any,

  // Vertical divider
  verticalDivider: { width: 1, backgroundColor: "rgba(215,209,196,0.5)" } as any,

  // Sidebar
  sidebar: { width: 195, minWidth: 195, maxWidth: 195, flexShrink: 0, flexGrow: 0 },
  sidebarCount: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"], marginBottom: 16, lineHeight: 18 },
  sidebarCountBold: { fontFamily: t.font["body.semibold"] },
  // Live count under the search bar — visible on every viewport so
  // the admin can watch the catalog grow as enrichment runs land.
  beansCount: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    paddingTop: t.spacing.sm,
  } as any,
  beansCountBold: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.primary"],
  } as any,

  clearText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.accent, marginBottom: 12 },
  filterDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.5)", marginVertical: 12 },
  filterSection: { marginBottom: 8 },
  filterTitle: { fontFamily: t.font["body.semibold"], fontSize: 15, letterSpacing: -0.375, color: t.color["text.primary"], marginBottom: 12 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, minHeight: 24, marginBottom: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", marginTop: 1,
  },
  checkboxChecked: { backgroundColor: t.color["text.primary"], borderColor: t.color["text.primary"] },
  checkmark: { color: "white", fontSize: 11, fontWeight: "700" as any },
  checkLabel: { fontFamily: t.font["body.regular"], fontSize: 14, letterSpacing: -0.336, color: t.color["text.primary"], flex: 1, lineHeight: 21 },
  showMoreText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.accent, marginTop: 6 },

  radioRow: { flexDirection: "row", alignItems: "center", gap: 14, height: 32 },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF",
  },
  radioSelected: { borderColor: t.color["text.primary"] },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color["text.primary"] },

  // Wholesale-only filter (§2.2, café viewers)
  wholesaleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 } as any,
  wholesaleBox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: t.color.border,
    backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center",
  } as any,
  wholesaleBoxOn: { borderColor: t.color["text.primary"], backgroundColor: t.color["text.primary"] } as any,
  // Checkmark tick replaces the earlier minus-sign dot (per user
  // feedback — a check reads as "enabled" rather than "unavailable").
  wholesaleBoxTick: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: "#FAF8F0",
    lineHeight: 13,
  } as any,
  wholesaleLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"],
  } as any,
  wholesaleHint: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"],
    marginTop: 6, marginLeft: 30, lineHeight: 15,
  } as any,

  // Search bar
  stickySearchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBarWrap: {
    overflow: "hidden", maxHeight: 58, opacity: 1,
    transitionProperty: "max-height, opacity",
    transitionDuration: "240ms, 180ms",
    transitionTimingFunction: "ease, ease",
  },
  searchBarWrapHidden: { maxHeight: 0, opacity: 0 },
  searchBar: {
    flexDirection: "row", alignItems: "center", borderRadius: 20, paddingHorizontal: 14, height: 38,
    backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: t.color.border,
    alignSelf: "flex-start" as any, width: 500, maxWidth: "100%" as any,
  },
  searchInput: { flex: 1, marginLeft: 8, fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"] },

  listHeader: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  activeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8, marginTop: 4 },
  activeChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: t.color["tag.bg"],
  },
  activeChipText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["tag.text"] },

  // Roasters tab
  rPageTitle: {
    fontFamily: t.font.display, fontSize: 26, lineHeight: 32, color: t.color["text.primary"],
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20,
  } as any,
  rDivider: { height: 1, backgroundColor: "rgba(160,149,128,0.5)", marginLeft: 16 } as any,

  // Roaster / café grid cards — dimensions mirror CoffeeCard's
  // 240-wide portrait geometry; image claims the top ~43% of the
  // card, info claims the remainder on the site's cream `card.info`
  // fill so they stack cleanly next to CoffeeCards on the BEANS tab.
  browseGrid: { flexDirection: "row", flexWrap: "wrap" } as any,
  bcCard: {
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.md,
    overflow: "hidden",
    ...cardShadow,
  } as any,
  bcImage: {
    position: "relative",
    backgroundColor: t.color["card.info"],
  } as any,
  bcFallback: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    color: t.color["text.muted"],
  } as any,
  bcInfo: {
    backgroundColor: t.color["card.info"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    gap: t.spacing["2xs"],
  } as any,
  bcName: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  bcSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,

  // §2.34 Drawer body (SlidePanel's child — already absolute)
  filterDrawerBody: {
    flex: 1,
    backgroundColor: t.color.bg,
  },
  filterDrawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  } as any,
  filterDrawerTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
  } as any,
  filterDrawerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  filterDrawerFooter: {
    flexDirection: "row",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    backgroundColor: t.color.bg,
  } as any,
  filterResetBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    backgroundColor: t.color.bg,
  } as any,
  filterResetBtnDisabled: {
    opacity: 0.4,
  } as any,
  filterResetText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  filterApplyBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
  } as any,
  filterApplyText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-dark"],
  } as any,

  rRow: {
    height: 104, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 16,
    backgroundColor: "transparent",
    transitionProperty: "background-color", transitionDuration: "150ms", transitionTimingFunction: "ease",
  } as any,
  rRowHovered: { backgroundColor: t.color.accent } as any,
  rImage: { width: 167, height: 76, borderRadius: 2, overflow: "hidden", flexShrink: 0, backgroundColor: t.color["card.info"] } as any,
  rInfo: { flex: 1, minWidth: 0, justifyContent: "center", gap: 4 },
  rName: { fontFamily: t.font["body.regular"], fontSize: 25, lineHeight: 30, color: t.color["text.primary"] },
  rSub: { fontFamily: t.font["body.regular"], fontSize: 14, lineHeight: 22, color: t.color["text.secondary"] },
  rArrowBtn: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: t.color["text.muted"],
    alignItems: "center", justifyContent: "center", flexShrink: 0,
    transitionProperty: "border-color", transitionDuration: "150ms", transitionTimingFunction: "ease",
  } as any,
  rArrowBtnHovered: { borderColor: "transparent" } as any,
});
