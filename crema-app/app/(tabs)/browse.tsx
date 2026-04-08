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
    if (filters.sortBy === "newest" && Object.keys(popularity).length > 0) {
      result = [...result].sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    }
    return result;
  }, [products, filters, popularity]);

  const hasActiveFilters = selectedRoasters.length > 0 || selectedRoasts.length > 0 || selectedProcesses.length > 0 || !!query;

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const clearAll = () => { setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); setQuery(""); };

  return (
    <View style={s.container}>
      {/* Sub-tabs */}
      <View style={s.tabBar}>
        <View style={s.tabBarInner}>
          <TabButton label="Beans" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
          <TabButton label="Roasters" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
          <Text style={s.greyTab}>Apparatus</Text>
          <Text style={s.greyTab}>Coffee Spots</Text>
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
              <Text style={s.sidebarTitle}>Filters</Text>
              {hasActiveFilters && (
                <Pressable onPress={clearAll} style={{ marginBottom: 12 }}>
                  <Text style={s.clearText}>Clear all</Text>
                </Pressable>
              )}
              <FilterSection title="Roast Level" items={(roastLevels as string[]).map(r => ({ key: r, label: r }))} selected={selectedRoasts} onToggle={v => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
              <FilterSection title="Process" items={(processes as string[]).map(p => ({ key: p, label: p }))} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
              <FilterSection title="Roaster" items={roasters.map((r: any) => ({ key: r.slug, label: r.name }))} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
            </ScrollView>
          )}

          {/* Card grid */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              ListHeaderComponent={
                <View style={s.listHeader}>
                  {/* Search */}
                  <View style={s.searchBar}>
                    <Search size={16} color={colors.textMuted} />
                    <TextInput
                      placeholder="Search coffees..."
                      placeholderTextColor={colors.textMuted}
                      value={query}
                      onChangeText={setQuery}
                      style={s.searchInput}
                    />
                    {query ? <Pressable onPress={() => setQuery("")}><X size={16} color={colors.textSecondary} /></Pressable> : null}
                  </View>
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

  // Sub-tabs
  tabBar: {
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.cardFront,
  },
  tabBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    maxWidth: 1600,
    alignSelf: "center" as any,
    width: "100%" as any,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: colors.accent },
  tabLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },
  tabLabelActive: { fontFamily: fonts.bodySemiBold, color: colors.accent },
  greyTab: { fontFamily: fonts.bodyRegular, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, opacity: 0.25, color: colors.textSecondary },

  // Browse layout
  browseLayout: {
    flex: 1,
    flexDirection: "row",
    maxWidth: 1600,
    alignSelf: "center" as any,
    width: "100%" as any,
  },

  // Filter sidebar — NARROW (~200px, not 50%)
  sidebar: {
    width: 200,
    borderRightWidth: 1,
    borderColor: colors.borderLight,
    position: "sticky" as any,
    top: 56,
    height: "calc(100vh - 56px)" as any,
  },
  sidebarTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginBottom: 12,
  },
  clearText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.accent },
  filterSection: { marginBottom: 20 },
  filterTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: "white", fontSize: 9, fontWeight: "700" as any },
  checkLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 16,
  },
  showMoreText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.accent, marginTop: 4 },

  // List header
  listHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
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
  countText: { fontFamily: fonts.bodyRegular, fontSize: 13, marginBottom: 4, color: colors.textMuted },
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
  roasterAvatarText: { fontFamily: fonts.displaySemiBold, fontSize: 14, color: colors.tagText },
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
