import { useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Search, X, ChevronDown, ChevronUp, Bean, Users as UsersIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { colors, fonts } from "../../src/theme/colors";
import { filterCoffees } from "../../src/utils/filterCoffees";
import CoffeeList from "../../src/components/CoffeeList";
import { apiFetch } from "../../src/api/client";

export default function BrowsePage() {
  const { products, roasters, roastLevels, processes } = useCoffeeData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const [query, setQuery] = useState("");
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"beans" | "roasters">("beans");
  const [sortBy, setSortBy] = useState<string>("featured");
  const [selectedRoasters, setSelectedRoasters] = useState<string[]>([]);
  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);

  useEffect(() => { apiFetch("/products/popularity").then(setPopularity).catch(() => {}); }, []);

  const filters = useMemo(() => ({
    roasters: selectedRoasters,
    roastLevels: selectedRoasts,
    origins: [],
    processes: selectedProcesses,
    priceMin: null, priceMax: null,
    showUnavailable: false,
    sortBy: "newest",
    query,
  }), [query, selectedRoasters, selectedRoasts, selectedProcesses]);

  const filtered = useMemo(() => {
    let result = filterCoffees(products, filters);
    if (sortBy === "featured" && Object.keys(popularity).length > 0) {
      result = [...result].sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    } else if (sortBy === "price_low") {
      result = [...result].sort((a, b) => (a.price_inr || 0) - (b.price_inr || 0));
    } else if (sortBy === "price_high") {
      result = [...result].sort((a, b) => (b.price_inr || 0) - (a.price_inr || 0));
    }
    return result;
  }, [products, filters, popularity, sortBy]);

  const hasActiveFilters = selectedRoasters.length > 0 || selectedRoasts.length > 0 || selectedProcesses.length > 0 || !!query;

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const clearAll = () => { setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); setQuery(""); };

  return (
    <View style={s.container}>
      {/* Sub-tabs — Figma "Sticky Tabs" */}
      <View style={s.tabBar}>
        <View style={s.tabBarInner}>
          {/* Left: "LOOKING FOR" aligned with filter sidebar */}
          <View style={s.tabBarLeft}>
            <Text style={s.lookingForLabel}>LOOKING FOR</Text>
          </View>
          {/* Right: tabs aligned with card grid */}
          <View style={s.tabBarRight}>
            <TabButton label="BEANS" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
            <TabButton label="ROASTERS" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
            <Text style={s.greyTab}>COFFEE SPOTS</Text>
          </View>
        </View>
      </View>

      {activeTab === "beans" ? (
        <View style={s.browseLayout}>
          {/* Narrow filter sidebar — ~200px, not 50% */}
          {isDesktop && (
            <ScrollView
              style={s.sidebar}
              contentContainerStyle={{ padding: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.sidebarTitle}>{filtered.length} COFFEES</Text>
              {hasActiveFilters && (
                <Pressable onPress={clearAll} style={{ marginBottom: 12 }}>
                  <Text style={s.clearText}>Clear all</Text>
                </Pressable>
              )}
              {/* Sort By — radio buttons */}
              <View style={s.filterSection}>
                <Text style={s.filterTitle}>Sort By</Text>
                {[
                  { key: "featured", label: "Featured" },
                  { key: "newest", label: "Newest" },
                  { key: "price_low", label: "Price: Low-High" },
                  { key: "price_high", label: "Price: High-Low" },
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
              <FilterSection title="Roasters" items={roasters.map((r: any) => ({ key: r.slug, label: r.name }))} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
              <View style={s.filterDivider} />
              <FilterSection title="Process" items={(processes as string[]).map(p => ({ key: p, label: p }))} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
            </ScrollView>
          )}

          {/* Vertical divider between sidebar and cards */}
          {isDesktop && <View style={s.verticalDivider} />}

          {/* Card grid */}
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Sticky search bar */}
            <View style={s.stickySearchWrap}>
              <View style={s.searchBar}>
                <Search size={16} color={colors.textMuted} />
                <TextInput
                  placeholder="Search"
                  placeholderTextColor={colors.textMuted}
                  value={query}
                  onChangeText={setQuery}
                  style={s.searchInput}
                />
                {query ? <Pressable onPress={() => setQuery("")}><X size={16} color={colors.textSecondary} /></Pressable> : null}
              </View>
            </View>

            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              ListHeaderComponent={
                <View style={s.listHeader}>
                  {/* Count */}
                  <Text style={s.countText}>
                    <Text style={s.countBold}>{filtered.length}</Text> coffees from{" "}
                    <Text style={s.countBold}>{roasters.length}</Text> roasters
                  </Text>
                  {/* Active filter chips */}
                  {hasActiveFilters && (
                    <View style={s.activeChips}>
                      {selectedRoasts.map(v => <ActiveChip key={v} label={v} onRemove={() => toggleArray(selectedRoasts, setSelectedRoasts, v)} />)}
                      {selectedProcesses.map(v => <ActiveChip key={v} label={v} onRemove={() => toggleArray(selectedProcesses, setSelectedProcesses, v)} />)}
                      {selectedRoasters.map(slug => {
                        const r = roasters.find((r: any) => r.slug === slug);
                        return <ActiveChip key={slug} label={r?.name || slug} onRemove={() => toggleArray(selectedRoasters, setSelectedRoasters, slug)} />;
                      })}
                    </View>
                  )}
                </View>
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
      <Pressable onPress={onRemove}><X size={10} color={colors.tagText} /></Pressable>
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

function FilterSection({ title, items, selected, onToggle, maxVisible = 10 }: { title: string; items: { key: string; label: string }[]; selected: string[]; onToggle: (key: string) => void; maxVisible?: number }) {
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

function RoastersList() {
  const { roasters } = useCoffeeData();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return roasters;
    const q = search.toLowerCase();
    return roasters.filter((r: any) => r.name.toLowerCase().includes(q) || (r.city || "").toLowerCase().includes(q));
  }, [roasters, search]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ maxWidth: 800, alignSelf: "center" as any, width: "100%" as any, padding: 16 }}>
      <View style={s.searchBar}>
        <Search size={16} color={colors.textMuted} />
        <TextInput placeholder="Search roasters..." placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} style={s.searchInput} />
      </View>
      {filtered.map((r: any) => (
        <Pressable key={r.slug} onPress={() => router.push(`/roaster/${r.slug}`)} style={s.roasterRow}>
          <View style={s.roasterAvatar}>
            <Text style={s.roasterAvatarText}>{(r.name || "?")[0]}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.roasterName}>{r.name}</Text>
            {r.city && <Text style={s.roasterCity}>{r.city}{r.state ? `, ${r.state}` : ""}</Text>}
          </View>
          <View style={s.roasterCountBadge}>
            <Text style={s.roasterCountText}>{r.coffeeCount}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Sub-tabs — Figma "Sticky Tabs" (node 8:644)
  tabBar: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FAF8F0",
    height: 80,
    justifyContent: "center",
  },
  tabBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 90,
    paddingRight: 90,
    maxWidth: 1600,
    alignSelf: "center" as any,
    width: "100%" as any,
  },
  // sidebar content starts at padding 16 inside the 195px sidebar → left=88+16=104
  // cards start at 88+195=283 but with the grid's 16px pad → content at 299
  // tab left should match the sidebar padding start
  tabBarLeft: {
    width: 195,
    flexShrink: 0,
    paddingLeft: 16,
    justifyContent: "center",
  } as any,
  tabBarRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    gap: 48,
  } as any,
  // Inter Medium 14px, #351101, uppercase — vertically aligned with tab text
  lookingForLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#351101",
    textTransform: "uppercase",
    paddingVertical: 10,
    borderBottomWidth: 4,
    borderBottomColor: "transparent",
  } as any,
  tabBtn: {
    paddingVertical: 10,
    borderBottomWidth: 4,
    borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: "#351101" },
  tabLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#A09580" },
  tabLabelActive: { fontFamily: fonts.bodySemiBold, color: "#351101" },
  greyTab: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#A09580", paddingVertical: 10, borderBottomWidth: 4, borderBottomColor: "transparent" },

  // Browse layout — Figma: filters start at x=88, cards start at x=330
  browseLayout: {
    flex: 1,
    flexDirection: "row",
    maxWidth: 1600,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingLeft: 90,
    paddingRight: 90,
  },

  // Vertical divider between sidebar and cards
  verticalDivider: {
    width: 1,
    backgroundColor: "#D7D1C4",
    marginHorizontal: 0,
  } as any,

  // Filter sidebar — Figma: width 195px
  sidebar: {
    width: 195,
    minWidth: 195,
    maxWidth: 195,
    flexShrink: 0,
    flexGrow: 0,
    position: "sticky" as any,
    top: 56,
    height: "calc(100vh - 100px)" as any,
    overflow: "hidden" as any,
  },
  // Figma: "472 COFFEES" Inter Semi Bold 14px #351101 uppercase
  sidebarTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
    textTransform: "uppercase",
    marginBottom: 20,
  } as any,
  clearText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.accent },
  // Figma: 1px line, #D7D1C4, width 193px
  filterDivider: { height: 1, backgroundColor: "#D7D1C4", marginVertical: 12 },
  filterSection: { marginBottom: 8 },
  // Figma: Inter Semi Bold 15px, #351101, tracking -0.375px
  filterTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    letterSpacing: -0.375,
    color: "#351101",
    marginBottom: 12,
  },
  // Figma: 14px gap checkbox→label, 4px between rows
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minHeight: 24,
    marginBottom: 4,
  },
  // Figma: 20px checkbox, border #D7D1C4, 1.5px, rounded 6px, bg white
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#D7D1C4",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: "#351101", borderColor: "#351101" },
  checkmark: { color: "white", fontSize: 11, fontWeight: "700" as any },
  // Figma: Inter Regular 14px, #351101, tracking -0.336px, lineHeight 1.5 (21px)
  checkLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    letterSpacing: -0.336,
    color: "#351101",
    flex: 1,
    lineHeight: 21,
  },
  showMoreText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.accent, marginTop: 6 },

  // Radio buttons for Sort By — Figma: 20px circle, #351101 fill when selected
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 32,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#D7D1C4",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  radioSelected: {
    borderColor: "#351101",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#351101",
  },

  // Search bar above card grid
  stickySearchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  // List header — same paddingHorizontal as card grid (GRID_PAD=16)
  listHeader: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  searchInput: { flex: 1, marginLeft: 8, fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textPrimary },
  countText: { fontFamily: fonts.bodySemiBold, fontSize: 14, marginBottom: 8, color: colors.textPrimary },
  countBold: { fontFamily: fonts.bodySemiBold, color: colors.textPrimary },
  activeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8, marginTop: 4 },
  activeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.tagBg,
  },
  activeChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.tagText },

  // Roasters list
  roasterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  roasterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  roasterAvatarText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.tagText },
  roasterName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary },
  roasterCity: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  roasterCountBadge: {
    backgroundColor: colors.tagBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roasterCountText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.tagText },
});
