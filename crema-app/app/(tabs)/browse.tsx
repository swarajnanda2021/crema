import { useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Search, X, ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { colors } from "../../src/theme/colors";
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
    priceMin: null,
    priceMax: null,
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

  return (
    <View style={s.container}>
      {/* Sub-tabs */}
      <View style={s.tabBar}>
        <TabButton label="Beans" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
        <TabButton label="Roasters" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
        {/* Greyed-out future tabs */}
        <Text style={s.greyTab}>Apparatus</Text>
        <Text style={s.greyTab}>Coffee Spots</Text>
      </View>

      {activeTab === "beans" ? (
        <View style={[s.browseLayout, { maxWidth: 1600 }]}>
          {/* Desktop filter sidebar */}
          {isDesktop && (
            <ScrollView style={s.sidebarDesktop} showsVerticalScrollIndicator={false}>
              <FilterSection title="Roaster" items={roasters.map((r: any) => ({ key: r.slug, label: r.name }))} selected={selectedRoasters} onToggle={(v) => toggleArray(selectedRoasters, setSelectedRoasters, v)} />
              <FilterSection title="Roast Level" items={(roastLevels as string[]).map((r) => ({ key: r, label: r }))} selected={selectedRoasts} onToggle={(v) => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
              <FilterSection title="Process" items={(processes as string[]).map((p) => ({ key: p, label: p }))} selected={selectedProcesses} onToggle={(v) => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
              {hasActiveFilters && (
                <Pressable onPress={() => { setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); setQuery(""); }} style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: 12, color: colors.accent, fontWeight: "500" }}>Clear all filters</Text>
                </Pressable>
              )}
            </ScrollView>
          )}

          {/* Card grid */}
          <View style={{ flex: 1 }}>
            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              ListHeaderComponent={
                <View style={s.searchSection}>
                  <View style={s.searchBar}>
                    <Search size={18} color={colors.textSecondary} />
                    <TextInput
                      placeholder="Search coffees..."
                      placeholderTextColor={colors.unavailable}
                      value={query}
                      onChangeText={setQuery}
                      style={s.searchInput}
                    />
                    {query ? <Pressable onPress={() => setQuery("")}><X size={18} color={colors.textSecondary} /></Pressable> : null}
                  </View>
                  <Text style={s.countText}>
                    <Text style={s.countBold}>{filtered.length}</Text> coffees from{" "}
                    <Text style={s.countBold}>{roasters.length}</Text> roasters
                  </Text>
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

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tabBtn, { borderBottomColor: active ? colors.accent : "transparent" }]}>
      <Text style={[s.tabLabel, { color: active ? colors.accent : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function FilterSection({ title, items, selected, onToggle }: { title: string; items: { key: string; label: string }[]; selected: string[]; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <View style={{ marginBottom: 16 }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, color: colors.textSecondary }}>{title}</Text>
        {open ? <ChevronUp size={14} color={colors.textSecondary} /> : <ChevronDown size={14} color={colors.textSecondary} />}
      </Pressable>
      {open && items.slice(0, 15).map(({ key, label }) => (
        <Pressable key={key} onPress={() => onToggle(key)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
          <View style={{ width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: colors.border, backgroundColor: selected.includes(key) ? colors.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
            {selected.includes(key) && <Text style={{ color: "white", fontSize: 10, fontWeight: "700" }}>{"\u2713"}</Text>}
          </View>
          <Text style={{ fontSize: 13, color: colors.textPrimary }} numberOfLines={1}>{label}</Text>
        </Pressable>
      ))}
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
      <View style={s.searchBar}>
        <Search size={18} color={colors.textSecondary} />
        <TextInput placeholder="Search roasters..." placeholderTextColor={colors.unavailable} value={search} onChangeText={setSearch} style={s.searchInput} />
      </View>
      {filtered.map((r: any) => (
        <Pressable key={r.slug} onPress={() => router.push(`/roaster/${r.slug}`)} style={s.roasterRow}>
          <View style={s.roasterAvatar}><Text style={s.roasterAvatarText}>{(r.name || "?")[0]}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.roasterName}>{r.name}</Text>
            {r.city && <Text style={s.roasterCity}>{r.city}{r.state ? `, ${r.state}` : ""}</Text>}
          </View>
          <Text style={s.roasterCount}>{r.coffeeCount} coffees</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, paddingHorizontal: 16, borderColor: colors.border, backgroundColor: colors.cardFront },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2 },
  tabLabel: { fontSize: 14, fontWeight: "500" },
  greyTab: { paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, opacity: 0.3, color: colors.textSecondary },
  browseLayout: { flex: 1, flexDirection: "row", alignSelf: "center" as any, width: "100%" as any },
  sidebarDesktop: {
    width: 260,
    padding: 24,
    position: "sticky" as any,
    top: 64,
    height: "calc(100vh - 64px)" as any,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  searchSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  searchBar: {
    flexDirection: "row", alignItems: "center", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8,
    backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: colors.textPrimary },
  countText: { fontSize: 14, marginBottom: 8, color: colors.textSecondary },
  countBold: { fontWeight: "600", color: colors.textPrimary },
  roasterRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border },
  roasterAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.tagBg },
  roasterAvatarText: { fontSize: 14, fontWeight: "700", color: colors.tagText },
  roasterName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  roasterCity: { fontSize: 12, color: colors.textSecondary },
  roasterCount: { fontSize: 12, color: colors.textSecondary },
});
