/**
 * Browse/Shop page — faithfully ported from main with CRUD Utopia imports/API.
 *
 * Layout, styles, component structure, and responsive patterns are identical to main.
 * Only imports, API calls, and component references are updated for crud-utopia.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { Image } from "expo-image";
import { Search, X, ArrowRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { t } from "../../src/tokens/useTokens";
import CoffeeList from "../../src/components/CoffeeList";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";

export default function BrowsePage() {
  const { products, roasters, roastLevels, processes } = useCoffeeData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [query, setQuery] = useState("");
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"beans" | "roasters">("beans");
  const [sortBy, setSortBy] = useState<string>("featured");
  const [selectedRoasters, setSelectedRoasters] = useState<string[]>([]);
  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
  const [searchBarHidden, setSearchBarHidden] = useState(false);

  useEffect(() => {
    apiFetchRaw("/products/popularity").then((r) => {
      const d = r?.data ?? r;
      setPopularity(typeof d === "object" && !Array.isArray(d) ? d : {});
    }).catch(() => {});
  }, []);

  // Inline filtering (replaces filterCoffees utility)
  const filtered = useMemo(() => {
    let list = products.filter((p: any) => p.available !== false && p.available !== 0);
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
    }
    return list;
  }, [products, query, selectedRoasters, selectedRoasts, selectedProcesses, sortBy, popularity]);

  const filteredRoasterCount = useMemo(() => new Set(filtered.map((p: any) => p.roaster_slug)).size, [filtered]);
  const hasActiveFilters = selectedRoasters.length > 0 || selectedRoasts.length > 0 || selectedProcesses.length > 0 || !!query;

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const clearAll = () => { setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); setQuery(""); };

  const handleScrollDirection = useCallback((dir: "up" | "down") => {
    setSearchBarHidden(dir === "down");
  }, []);

  return (
    <View style={s.container}>
      {/* Sub-tabs */}
      <View style={s.tabBar}>
        <View style={s.tabBarInner}>
          <View style={[s.tabBarLeft, { width: sidebarW }]}>
            <Text style={s.lookingForLabel}>LOOKING FOR</Text>
          </View>
          <View style={s.tabBarRight}>
            <TabButton label="BEANS" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
            <TabButton label="ROASTERS" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
          </View>
        </View>
      </View>

      {activeTab === "beans" ? (
        <View style={s.browseLayout}>
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
            {/* Scroll-aware search bar */}
            <View style={[s.searchBarWrap, searchBarHidden && s.searchBarWrapHidden] as any}>
              <View style={s.stickySearchWrap}>
                <View style={s.searchBar}>
                  <Search size={16} color={t.color["text.muted"]} />
                  <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={query} onChangeText={setQuery} style={s.searchInput} />
                  {query ? <Pressable onPress={() => setQuery("")}><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
                </View>
              </View>
            </View>

            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              onScrollDirection={handleScrollDirection}
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
        <RoastersList />
      )}
    </View>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={s.activeChip}>
      <Text style={s.activeChipText}>{label}</Text>
      <Pressable onPress={onRemove}><X size={10} color={t.color["tag.text"]} /></Pressable>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tabBtn, active && s.tabBtnActive]}>
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
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

function RoasterRow({ roaster, imageUrl }: { roaster: any; imageUrl: string | undefined }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => router.push(`/roaster/${roaster.slug}`)}
        style={[s.rRow, hovered && s.rRowHovered] as any}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
      >
        <View style={s.rImage}>
          {imageUrl ? (
            <Image source={{ uri: resolveUploadUrl(imageUrl) }} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFillObject as any, { alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ fontFamily: t.font.display, fontSize: 28, color: t.color["text.muted"] }}>
                {(roaster.name || "?")[0]}
              </Text>
            </View>
          )}
        </View>
        <View style={s.rInfo}>
          <Text style={s.rName} numberOfLines={1}>{roaster.name}</Text>
          <Text style={s.rSub} numberOfLines={1}>
            {[roaster.city, roaster.state].filter(Boolean).join(", ")}
            {roaster.coffeeCount ? `  \u00B7  ${roaster.coffeeCount} coffees` : ""}
          </Text>
        </View>
        <View style={[s.rArrowBtn, hovered && s.rArrowBtnHovered] as any}>
          <ArrowRight size={18} color={hovered ? t.color["text.primary"] : t.color["text.muted"]} strokeWidth={1.5} />
        </View>
      </Pressable>
      <View style={s.rDivider} />
    </>
  );
}

function RoastersList() {
  const { roasters, products } = useCoffeeData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [roasterQuery, setRoasterQuery] = useState("");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [searchBarHidden, setSearchBarHidden] = useState(false);
  const lastScrollY = useRef(0);

  const roasterImages = useMemo(() => {
    const map: Record<string, string> = {};
    (products as any[]).forEach((p: any) => {
      if (p.image_url && !map[p.roaster_slug]) map[p.roaster_slug] = p.image_url;
    });
    return map;
  }, [products]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    roasters.forEach((r: any) => { if (r.city) set.add(r.city); });
    return Array.from(set).sort();
  }, [roasters]);

  const filteredRoasters = useMemo(() => {
    let result = roasters;
    if (roasterQuery) {
      const q = roasterQuery.toLowerCase();
      result = result.filter((r: any) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.city || "").toLowerCase().includes(q)
      );
    }
    if (selectedCities.length > 0) {
      result = result.filter((r: any) => selectedCities.includes(r.city));
    }
    return result;
  }, [roasters, roasterQuery, selectedCities]);

  const toggleCity = (city: string) => {
    setSelectedCities(prev => prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]);
  };

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentY = e.nativeEvent.contentOffset.y;
    setSearchBarHidden(currentY > lastScrollY.current && currentY > 10);
    lastScrollY.current = currentY;
  }, []);

  return (
    <View style={s.browseLayout}>
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
        <View style={[s.searchBarWrap, searchBarHidden && s.searchBarWrapHidden] as any}>
          <View style={s.stickySearchWrap}>
            <View style={s.searchBar}>
              <Search size={16} color={t.color["text.muted"]} />
              <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={roasterQuery} onChangeText={setRoasterQuery} style={s.searchInput} />
              {roasterQuery ? <Pressable onPress={() => setRoasterQuery("")}><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
            </View>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={50}>
          <Text style={s.rPageTitle} numberOfLines={1}>Explore your favourite Indian coffee roasters</Text>
          <View style={s.rDivider} />
          <View>
            {filteredRoasters.map((r: any) => (
              <RoasterRow key={r.slug} roaster={r} imageUrl={roasterImages[r.slug]} />
            ))}
          </View>
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
  tabBarInner: { flexDirection: "row", alignItems: "center", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, width: "100%" as any },
  tabBarLeft: { width: 195, flexShrink: 0, justifyContent: "center" } as any,
  tabBarRight: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 16, gap: 48 } as any,
  lookingForLabel: {
    fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"],
    textTransform: "uppercase", paddingVertical: 10, borderBottomWidth: 4, borderBottomColor: "transparent",
  } as any,
  tabBtn: { paddingVertical: 10, borderBottomWidth: 4, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: t.color["text.primary"] },
  tabLabel: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"] },
  tabLabelActive: { fontFamily: t.font["body.semibold"], color: t.color["text.primary"] },

  // Browse layout
  browseLayout: { flex: 1, flexDirection: "row", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, paddingTop: 63 } as any,

  // Vertical divider
  verticalDivider: { width: 1, backgroundColor: "rgba(215,209,196,0.5)" } as any,

  // Sidebar
  sidebar: { width: 195, minWidth: 195, maxWidth: 195, flexShrink: 0, flexGrow: 0 },
  sidebarCount: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"], marginBottom: 16, lineHeight: 18 },
  sidebarCountBold: { fontFamily: t.font["body.semibold"] },

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
