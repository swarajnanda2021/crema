import { useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { Search, X } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { colors } from "../../src/theme/colors";
import { filterCoffees } from "../../src/utils/filterCoffees";
import CoffeeList from "../../src/components/CoffeeList";
import { apiFetch } from "../../src/api/client";

export default function BrowsePage() {
  const { products, roasters } = useCoffeeData();
  const [query, setQuery] = useState("");
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"beans" | "roasters">("beans");

  useEffect(() => {
    apiFetch("/products/popularity").then(setPopularity).catch(() => {});
  }, []);

  const filters = useMemo(() => ({
    roasters: [],
    roastLevels: [],
    origins: [],
    processes: [],
    priceMin: null,
    priceMax: null,
    showUnavailable: false,
    sortBy: "newest",
    query,
  }), [query]);

  const filtered = useMemo(() => {
    let result = filterCoffees(products, filters);
    if (filters.sortBy === "newest" && Object.keys(popularity).length > 0) {
      result = [...result].sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    }
    return result;
  }, [products, filters, popularity]);

  return (
    <View style={styles.container}>
      {/* Sub-tabs */}
      <View style={styles.tabBar}>
        <TabButton label="Beans" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
        <TabButton label="Roasters" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
      </View>

      {activeTab === "beans" ? (
        <CoffeeList
          coffees={filtered}
          popularity={popularity}
          ListHeaderComponent={
            <View style={styles.searchSection}>
              {/* Search bar */}
              <View style={styles.searchBar}>
                <Search size={18} color={colors.textSecondary} />
                <TextInput
                  placeholder="Search coffees..."
                  placeholderTextColor={colors.unavailable}
                  value={query}
                  onChangeText={setQuery}
                  style={styles.searchInput}
                />
                {query ? <Pressable onPress={() => setQuery("")}><X size={18} color={colors.textSecondary} /></Pressable> : null}
              </View>
              <Text style={styles.countText}>
                <Text style={styles.countBold}>{filtered.length}</Text> coffees from{" "}
                <Text style={styles.countBold}>{roasters.length}</Text> roasters
              </Text>
            </View>
          }
        />
      ) : (
        <RoastersList />
      )}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, { borderBottomColor: active ? colors.accent : "transparent" }]}
    >
      <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function RoastersList() {
  const { roasters } = useCoffeeData();
  const router = require("expo-router").useRouter();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return roasters;
    const q = search.toLowerCase();
    return roasters.filter((r: any) => r.name.toLowerCase().includes(q) || (r.city || "").toLowerCase().includes(q));
  }, [roasters, search]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.roasterSearchWrap}>
        <View style={styles.searchBar}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            placeholder="Search roasters..."
            placeholderTextColor={colors.unavailable}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>
      <View style={styles.roasterList}>
        {filtered.map((r: any) => (
          <Pressable
            key={r.slug}
            onPress={() => router.push(`/roaster/${r.slug}`)}
            style={styles.roasterRow}
          >
            <View style={styles.roasterAvatar}>
              <Text style={styles.roasterAvatarText}>{(r.name || "?")[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roasterName}>{r.name}</Text>
              {r.city && <Text style={styles.roasterCity}>{r.city}{r.state ? `, ${r.state}` : ""}</Text>}
            </View>
            <Text style={styles.roasterCount}>{r.coffeeCount} coffees</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    borderColor: colors.border,
    backgroundColor: colors.cardFront,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: colors.textPrimary,
  },
  countText: {
    fontSize: 14,
    marginBottom: 8,
    color: colors.textSecondary,
  },
  countBold: {
    fontWeight: "600",
    color: colors.textPrimary,
  },
  roasterSearchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  roasterList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  roasterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  roasterAvatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  roasterAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.tagText,
  },
  roasterName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  roasterCity: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  roasterCount: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
