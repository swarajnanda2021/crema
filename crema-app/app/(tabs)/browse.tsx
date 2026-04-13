/**
 * Browse/Shop page — CRUD Utopia edition.
 *
 * Data: useCoffeeData for products, apiFetchRaw for popularity.
 * Tokens: all colors/fonts from design-tokens.json.
 * Tabs: Beans (with filters + sort) / Roasters
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
  const lastScrollY = useRef(0);
  const router = useRouter();

  useEffect(() => {
    apiFetchRaw("/products/popularity").then((r) => {
      const d = r?.data ?? r;
      setPopularity(typeof d === "object" && !Array.isArray(d) ? d : {});
    }).catch(() => {});
  }, []);

  // Filter products
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
    return list;
  }, [products, query, selectedRoasters, selectedRoasts, selectedProcesses]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "featured") list.sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    else if (sortBy === "price_low") list.sort((a, b) => (a.price_inr || 0) - (b.price_inr || 0));
    else if (sortBy === "price_high") list.sort((a, b) => (b.price_inr || 0) - (a.price_inr || 0));
    return list;
  }, [filtered, sortBy, popularity]);

  const uniqueRoasters = useMemo(() => [...new Set(products.map((p: any) => p.roaster_slug).filter(Boolean))], [products]);
  const activeFilters = selectedRoasters.length + selectedRoasts.length + selectedProcesses.length;

  const toggleFilter = (list: string[], setList: any, val: string) => {
    setList((prev: string[]) => prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]);
  };

  const clearAll = () => { setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]); };

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setSearchBarHidden(y > lastScrollY.current + 10 && y > 100);
    lastScrollY.current = y;
  }, []);

  // Tab header
  const tabHeader = (
    <View style={s.tabHeader}>
      <Text style={s.tabLabel}>LOOKING FOR</Text>
      <Pressable onPress={() => setActiveTab("beans")} style={s.tabBtn}>
        <Text style={[s.tabBtnText, activeTab === "beans" && s.tabBtnActive]}>BEANS</Text>
        {activeTab === "beans" && <View style={s.tabBtnLine} />}
      </Pressable>
      <Pressable onPress={() => setActiveTab("roasters")} style={s.tabBtn}>
        <Text style={[s.tabBtnText, activeTab === "roasters" && s.tabBtnActive]}>ROASTERS</Text>
        {activeTab === "roasters" && <View style={s.tabBtnLine} />}
      </Pressable>
    </View>
  );

  if (activeTab === "roasters") {
    return (
      <View style={s.container}>
        {tabHeader}
        <ScrollView contentContainerStyle={s.roasterList}>
          {roasters.map((r: any) => (
            <Pressable key={r.slug} onPress={() => router.push(`/roaster/${r.slug}` as any)} style={s.roasterRow}>
              {r.logo_url ? <Image source={{ uri: resolveUploadUrl(r.logo_url) }} style={s.roasterLogo} contentFit="contain" /> :
                <View style={s.roasterLogoFb}><Text style={s.roasterLogoL}>{(r.name || "?")[0]}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.roasterName}>{r.name}</Text>
                {r.city && <Text style={s.roasterCity}>{r.city}</Text>}
              </View>
              <Text style={s.roasterCount}>{r.coffeeCount} beans</Text>
              <ArrowRight size={14} color={t.color["text.muted"]} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {tabHeader}
      <View style={s.body}>
        {/* Sidebar (desktop only) */}
        {isDesktop && (
          <View style={[s.sidebar, { width: sidebarW }]}>
            <Text style={s.sidebarCount}><Text style={s.sidebarCountBold}>{sorted.length}</Text> coffees from <Text style={s.sidebarCountBold}>{uniqueRoasters.length}</Text> roasters</Text>
            {activeFilters > 0 && <Pressable onPress={clearAll}><Text style={s.clearAll}>Clear all</Text></Pressable>}

            <Text style={s.sidebarHeading}>Sort By</Text>
            {["featured", "newest", "price_low", "price_high"].map((opt) => (
              <Pressable key={opt} onPress={() => setSortBy(opt)} style={s.radioRow}>
                <View style={[s.radio, sortBy === opt && s.radioActive]} />
                <Text style={s.radioText}>{{featured:"Featured",newest:"Newest",price_low:"Price: Low\u2013High",price_high:"Price: High\u2013Low"}[opt]}</Text>
              </Pressable>
            ))}

            <View style={s.sidebarDivider} />
            <Text style={s.sidebarHeading}>Roasters</Text>
            {roasters.slice(0, 10).map((r: any) => (
              <Pressable key={r.slug} onPress={() => toggleFilter(selectedRoasters, setSelectedRoasters, r.slug)} style={s.checkRow}>
                <View style={[s.check, selectedRoasters.includes(r.slug) && s.checkActive]} />
                <Text style={s.checkText} numberOfLines={1}>{r.name}</Text>
              </Pressable>
            ))}

            <View style={s.sidebarDivider} />
            <Text style={s.sidebarHeading}>Roast</Text>
            {roastLevels.map((lvl: string) => (
              <Pressable key={lvl} onPress={() => toggleFilter(selectedRoasts, setSelectedRoasts, lvl)} style={s.checkRow}>
                <View style={[s.check, selectedRoasts.includes(lvl) && s.checkActive]} />
                <Text style={s.checkText}>{lvl}</Text>
              </Pressable>
            ))}

            <View style={s.sidebarDivider} />
            <Text style={s.sidebarHeading}>Process</Text>
            {processes.map((proc: string) => (
              <Pressable key={proc} onPress={() => toggleFilter(selectedProcesses, setSelectedProcesses, proc)} style={s.checkRow}>
                <View style={[s.check, selectedProcesses.includes(proc) && s.checkActive]} />
                <Text style={s.checkText}>{proc}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Main content */}
        <ScrollView style={s.main} contentContainerStyle={s.mainContent} showsVerticalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={100}>
          {/* Search */}
          {!searchBarHidden && (
            <View style={s.searchWrap}>
              <Search size={16} color={t.color["text.muted"]} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={t.color["text.muted"]} style={s.searchInput} />
              {query.length > 0 && <Pressable onPress={() => setQuery("")}><X size={14} color={t.color["text.muted"]} /></Pressable>}
            </View>
          )}

          {/* Active filter chips */}
          {activeFilters > 0 && (
            <View style={s.chipRow}>
              {selectedRoasters.map((slug) => {
                const r = roasters.find((r: any) => r.slug === slug);
                return <Pressable key={slug} onPress={() => toggleFilter(selectedRoasters, setSelectedRoasters, slug)} style={s.chip}><Text style={s.chipText}>{r?.name || slug} ×</Text></Pressable>;
              })}
              {selectedRoasts.map((v) => <Pressable key={v} onPress={() => toggleFilter(selectedRoasts, setSelectedRoasts, v)} style={s.chip}><Text style={s.chipText}>{v} ×</Text></Pressable>)}
              {selectedProcesses.map((v) => <Pressable key={v} onPress={() => toggleFilter(selectedProcesses, setSelectedProcesses, v)} style={s.chip}><Text style={s.chipText}>{v} ×</Text></Pressable>)}
            </View>
          )}

          <CoffeeList coffees={sorted} popularity={popularity} />
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.color.bg },
  tabHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: "6.25%" as any, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.color["border.light"], gap: 32 } as any,
  tabLabel: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 1 },
  tabBtn: { alignItems: "center" } as any,
  tabBtnText: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.muted"] },
  tabBtnActive: { color: t.color["text.primary"] },
  tabBtnLine: { height: 3, backgroundColor: t.color["text.primary"], borderRadius: 1.5, marginTop: 6, width: "100%" } as any,
  body: { flex: 1, flexDirection: "row" } as any,

  // Sidebar
  sidebar: { paddingHorizontal: 16, paddingTop: 20, borderRightWidth: 1, borderRightColor: t.color["border.light"] } as any,
  sidebarCount: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"], marginBottom: 12 },
  sidebarCountBold: { fontFamily: t.font["body.semibold"], color: t.color["text.primary"] },
  clearAll: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color.accent, marginBottom: 12 },
  sidebarHeading: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"], marginBottom: 8, marginTop: 4 },
  sidebarDivider: { height: 1, backgroundColor: t.color["border.light"], marginVertical: 12 },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 } as any,
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: t.color.border } as any,
  radioActive: { borderColor: t.color["text.primary"], backgroundColor: t.color["text.primary"] },
  radioText: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 } as any,
  check: { width: 14, height: 14, borderRadius: 2, borderWidth: 1.5, borderColor: t.color.border } as any,
  checkActive: { borderColor: t.color["text.primary"], backgroundColor: t.color["text.primary"] },
  checkText: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.primary"] },

  // Main
  main: { flex: 1 },
  mainContent: { paddingHorizontal: "3%" as any, paddingTop: 16, paddingBottom: 100 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.color["card.front"], borderRadius: 20, borderWidth: 1, borderColor: t.color["border.light"], paddingHorizontal: 16, paddingVertical: 10, marginBottom: 16 } as any,
  searchInput: { flex: 1, fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.primary"] },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 } as any,
  chip: { backgroundColor: t.color.accent, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.primary"] },

  // Roasters tab
  roasterList: { paddingHorizontal: "6.25%" as any, paddingTop: 16, paddingBottom: 100 },
  roasterRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  roasterLogo: { width: 40, height: 40, borderRadius: 6 } as any,
  roasterLogoFb: { width: 40, height: 40, borderRadius: 6, backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" } as any,
  roasterLogoL: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  roasterName: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.md"], color: t.color["text.primary"] },
  roasterCity: { fontFamily: t.font["body.regular"], fontSize: t.size["font.sm"], color: t.color["text.muted"], marginTop: 2 },
  roasterCount: { fontFamily: t.font["body.regular"], fontSize: t.size["font.sm"], color: t.color["text.muted"] },
});
