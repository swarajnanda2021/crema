import { useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Search, X, SlidersHorizontal } from "lucide-react-native";
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
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      {/* Sub-tabs */}
      <View className="flex-row border-b px-4" style={{ borderColor: colors.border, backgroundColor: colors.cardFront }}>
        <TabButton label="Beans" active={activeTab === "beans"} onPress={() => setActiveTab("beans")} />
        <TabButton label="Roasters" active={activeTab === "roasters"} onPress={() => setActiveTab("roasters")} />
      </View>

      {activeTab === "beans" ? (
        <CoffeeList
          coffees={filtered}
          popularity={popularity}
          ListHeaderComponent={
            <View className="px-4 pt-3 pb-1">
              {/* Search bar */}
              <View className="flex-row items-center rounded-xl px-3 py-2 mb-2" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
                <Search size={18} color={colors.textSecondary} />
                <TextInput
                  placeholder="Search coffees..."
                  placeholderTextColor={colors.unavailable}
                  value={query}
                  onChangeText={setQuery}
                  className="flex-1 ml-2 text-sm"
                  style={{ color: colors.textPrimary }}
                />
                {query ? <Pressable onPress={() => setQuery("")}><X size={18} color={colors.textSecondary} /></Pressable> : null}
              </View>
              <Text className="text-sm mb-2" style={{ color: colors.textSecondary }}>
                <Text className="font-semibold" style={{ color: colors.textPrimary }}>{filtered.length}</Text> coffees from{" "}
                <Text className="font-semibold" style={{ color: colors.textPrimary }}>{roasters.length}</Text> roasters
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
    <Pressable onPress={onPress} className="px-4 py-2.5" style={{ borderBottomWidth: 2, borderBottomColor: active ? colors.accent : "transparent" }}>
      <Text className="text-sm font-medium" style={{ color: active ? colors.accent : colors.textSecondary }}>{label}</Text>
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
    <View className="flex-1">
      <View className="px-4 pt-3">
        <View className="flex-row items-center rounded-xl px-3 py-2 mb-2" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput placeholder="Search roasters..." placeholderTextColor={colors.unavailable} value={search} onChangeText={setSearch} className="flex-1 ml-2 text-sm" style={{ color: colors.textPrimary }} />
        </View>
      </View>
      <View className="flex-1 px-4">
        {filtered.map((r: any) => (
          <Pressable
            key={r.slug}
            onPress={() => router.push(`/roaster/${r.slug}`)}
            className="flex-row items-center gap-3 py-3 border-b"
            style={{ borderColor: colors.border }}
          >
            <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
              <Text className="text-sm font-bold" style={{ color: colors.tagText }}>{(r.name || "?")[0]}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: colors.textPrimary }}>{r.name}</Text>
              {r.city && <Text className="text-xs" style={{ color: colors.textSecondary }}>{r.city}{r.state ? `, ${r.state}` : ""}</Text>}
            </View>
            <Text className="text-xs" style={{ color: colors.textSecondary }}>{r.coffeeCount} coffees</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
