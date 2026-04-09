import { useMemo, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { MapPin, Globe } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { colors, fonts } from "../../src/theme/colors";
import CoffeeList from "../../src/components/CoffeeList";

const H_PAD = "6.25%";

export default function RoasterDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { products, roasters } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const roaster = roasters.find((r: any) => r.slug === slug);
  const profile = getProfile(slug, roaster?.website, roaster?.name);
  const coffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);

  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
  const [searchBarHidden, setSearchBarHidden] = useState(false);

  const roastLevels = useMemo(() => {
    const levels = new Set<string>();
    coffees.forEach((c: any) => { if (c.roast_level && c.roast_level !== "Unknown") levels.add(c.roast_level); });
    return Array.from(levels);
  }, [coffees]);

  const processes = useMemo(() => {
    const procs = new Set<string>();
    coffees.forEach((c: any) => { if (c.process) procs.add(c.process); });
    return Array.from(procs);
  }, [coffees]);

  const filtered = useMemo(() => {
    return coffees.filter((c: any) => {
      if (selectedRoasts.length > 0 && !selectedRoasts.includes(c.roast_level)) return false;
      if (selectedProcesses.length > 0 && !selectedProcesses.includes(c.process)) return false;
      return true;
    });
  }, [coffees, selectedRoasts, selectedProcesses]);

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const handleScrollDirection = useCallback((dir: "up" | "down") => {
    setSearchBarHidden(dir === "down");
  }, []);

  if (!roaster) {
    return (
      <View style={s.notFound}>
        <Text>Roaster not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        {/* Hero */}
        <View style={s.hero}>
          <View style={{ paddingHorizontal: H_PAD as any }}>
            <Text style={s.roasterName}>{roaster.name}</Text>
            {(roaster.city || profile?.city) && (
              <View style={s.locationRow}>
                <MapPin size={11} color="#A09580" />
                <Text style={s.locationText}>
                  {roaster.city || profile?.city}{(roaster.state || profile?.state) ? `, ${roaster.state || profile?.state}` : ""}
                </Text>
              </View>
            )}
            {profile?.about_blurb && (
              <Text style={s.heroAbout} numberOfLines={3}>{profile.about_blurb}</Text>
            )}
            {(roaster.website || profile?.website) && (
              <Pressable onPress={() => Linking.openURL(roaster.website || profile.website)} style={s.websiteBtn}>
                <Globe size={12} color={colors.accent} />
                <Text style={s.websiteText}>Visit website</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Body: sidebar + grid */}
        <View style={[s.body, { paddingHorizontal: H_PAD as any }]}>
          {isDesktop && (
            <ScrollView
              style={s.sidebar}
              contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.sidebarCount}>{filtered.length} COFFEES</Text>

              {roastLevels.length > 0 && (
                <View style={s.filterSection}>
                  <View style={s.filterDivider} />
                  <Text style={s.filterTitle}>Roast</Text>
                  {roastLevels.map(level => (
                    <Pressable key={level} onPress={() => toggleArray(selectedRoasts, setSelectedRoasts, level)} style={s.checkRow}>
                      <View style={[s.checkbox, selectedRoasts.includes(level) && s.checkboxChecked]}>
                        {selectedRoasts.includes(level) && <Text style={s.checkmark}>✓</Text>}
                      </View>
                      <Text style={s.checkLabel}>{level}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {processes.length > 0 && (
                <View style={s.filterSection}>
                  <View style={s.filterDivider} />
                  <Text style={s.filterTitle}>Process</Text>
                  {processes.map(proc => (
                    <Pressable key={proc} onPress={() => toggleArray(selectedProcesses, setSelectedProcesses, proc)} style={s.checkRow}>
                      <View style={[s.checkbox, selectedProcesses.includes(proc) && s.checkboxChecked]}>
                        {selectedProcesses.includes(proc) && <Text style={s.checkmark}>✓</Text>}
                      </View>
                      <Text style={s.checkLabel}>{proc}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          {isDesktop && <View style={s.verticalDivider} />}

          {/* Coffee grid */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <CoffeeList
              coffees={filtered}
              onScrollDirection={handleScrollDirection}
              ListHeaderComponent={
                <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
                  <Text style={s.gridCount}>{filtered.length} {filtered.length === 1 ? "coffee" : "coffees"}</Text>
                </View>
              }
            />
          </View>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },

  // Hero
  hero: {
    paddingTop: 48,
    paddingBottom: 36,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderColor: "#D7D1C4",
  },
  roasterName: {
    fontFamily: fonts.displayRegular,
    fontSize: 52,
    color: "#351101",
    lineHeight: 58,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  locationText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
  },
  heroAbout: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: "#684F44",
    marginTop: 16,
    lineHeight: 22,
  },
  websiteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
  },
  websiteText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.accent,
  },

  // Body
  body: {
    flex: 1,
    flexDirection: "row",
  },

  // Sidebar
  sidebar: {
    width: 195,
    minWidth: 195,
    maxWidth: 195,
    flexShrink: 0,
    flexGrow: 0,
    position: "sticky" as any,
    top: 0,
    height: "calc(100vh - 200px)" as any,
    overflow: "hidden" as any,
  },
  sidebarCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#351101",
    textTransform: "uppercase" as any,
    marginBottom: 4,
  },
  filterDivider: { height: 1, backgroundColor: "#D7D1C4", marginVertical: 12 },
  filterSection: { marginBottom: 8 },
  filterTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    letterSpacing: -0.375,
    color: "#351101",
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minHeight: 24,
    marginBottom: 4,
  },
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
  checkLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    letterSpacing: -0.336,
    color: "#351101",
    flex: 1,
    lineHeight: 21,
  },

  // Vertical divider
  verticalDivider: {
    width: 1,
    backgroundColor: "#D7D1C4",
  } as any,

  // Grid header
  gridCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
    marginBottom: 8,
  },
});
