import { useMemo, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, LayoutChangeEvent, Platform } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { fonts } from "../../src/theme/colors";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";

// Web-only: flushed lining numerals (same as CoffeeLabel.tsx)
const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

// ─── Figma icons (exact SVG paths from Figma assets) ──────────────────────────

function BackArrowIcon() {
  return (
    <Svg width={9} height={16} viewBox="0 0 9 16" fill="none">
      <Path
        d="M8 15L1 8L8 1"
        stroke="#C7BAA5"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MapPinIcon() {
  return (
    <Svg width={12} height={14} viewBox="0 0 13.9221 17.2462" fill="none">
      <Path
        d="M0.75 6.89265C0.75 11.1977 4.51612 14.7577 6.18311 16.1227C6.42168 16.318 6.54239 16.4168 6.72038 16.467C6.85898 16.506 7.06296 16.506 7.20155 16.467C7.37988 16.4167 7.49975 16.3189 7.73922 16.1228C9.4062 14.7579 13.1721 11.1981 13.1721 6.89304C13.1721 5.26386 12.5178 3.70121 11.353 2.5492C10.1882 1.39719 8.60846 0.75 6.96117 0.75C5.31389 0.75 3.734 1.39729 2.56919 2.5493C1.40438 3.7013 0.75 5.26346 0.75 6.89265Z"
        stroke="#D798DA"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.1865 6.0738C5.1865 7.05388 5.98101 7.8484 6.9611 7.8484C7.94118 7.8484 8.7357 7.05388 8.7357 6.0738C8.7357 5.09372 7.94118 4.2992 6.9611 4.2992C5.98101 4.2992 5.1865 5.09372 5.1865 6.0738Z"
        stroke="#D798DA"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ExternalLinkIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 15.5 15.5" fill="none">
      <Path
        d="M5.41685 1.68333H3.73685C2.69142 1.68333 2.16831 1.68333 1.76901 1.88679C1.41778 2.06575 1.13242 2.35111 0.953455 2.70234C0.750001 3.10165 0.750001 3.62475 0.750001 4.67018V11.7635C0.750001 12.8089 0.750001 13.3314 0.953455 13.7307C1.13242 14.0819 1.41778 14.3678 1.76901 14.5467C2.16792 14.75 2.69039 14.75 3.73378 14.75H10.8329C11.8763 14.75 12.398 14.75 12.7969 14.5467C13.1481 14.3678 13.4344 14.0817 13.6134 13.7304C13.8167 13.3315 13.8167 12.8096 13.8167 11.7662V10.0833M14.75 5.41667V0.75M14.75 0.75H10.0833M14.75 0.75L8.21667 7.28333"
        stroke="#D798DA"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Inline coffee grid (no inner ScrollView — works inside page ScrollView) ───

const GAP = 20;
const TARGET_CARD_W = 240;
const CARD_ASPECT = 400 / 240;
const GRID_PAD = 16;

function CoffeeGrid({ coffees }: { coffees: any[] }) {
  const [containerW, setContainerW] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.min(5, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  if (coffees.length === 0) {
    return (
      <View style={g.empty}>
        <Text style={g.emptyText}>No coffees match your filters.</Text>
      </View>
    );
  }

  return (
    <View onLayout={onLayout} style={[g.grid, { gap: GAP, paddingHorizontal: GRID_PAD }]}>
      {coffees.map((coffee) => (
        <View key={coffee.product_id} style={{ width: cardWidth, height: cardHeight }}>
          <CoffeeCard coffee={coffee} width={cardWidth} height={cardHeight} />
        </View>
      ))}
    </View>
  );
}

const g = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { paddingVertical: 60, alignItems: "center" },
  emptyText: { fontFamily: fonts.bodyRegular, fontSize: 14, color: "#684F44" },
});

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function RoasterDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  // Use global filter lists from context (full set, not subset of this roaster)
  const { products, roasters, roastLevels: globalRoastLevels, processes: globalProcesses } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const roaster = roasters.find((r: any) => r.slug === slug);
  const profile = getProfile(slug, roaster?.website, roaster?.name);
  const coffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);

  // Hero image: prefer hero photo, then logo, then first product image
  const heroImageUrl = useMemo(
    () => profile?.hero_image_url || profile?.logo_url || coffees.find((c: any) => c.image_url)?.image_url || null,
    [profile, coffees]
  );

  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  const ABOUT_LIMIT = 300;

  // Dynamic specialty tags from enriched profile, fallback to generic
  const specialtyTags: string[] = (profile?.specialties && profile.specialties.length > 0)
    ? profile.specialties.slice(0, 4)
    : ["Single Origin", "Estate Grown", "Specialty Grade"];

  const filtered = useMemo(() => coffees.filter((c: any) => {
    if (selectedRoasts.length > 0 && !selectedRoasts.includes(c.roast_level)) return false;
    if (selectedProcesses.length > 0 && !selectedProcesses.includes(c.process)) return false;
    return true;
  }), [coffees, selectedRoasts, selectedProcesses]);

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const heroH = Math.max(300, Math.min(528, Math.round(width * 0.367)));

  if (!roaster) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Navbar />
        <View style={s.notFound}>
          <Text style={s.notFoundText}>Roaster not found</Text>
        </View>
      </>
    );
  }

  const city = roaster.city || profile?.city;
  const website = roaster.website || profile?.website;
  const aboutBlurb = profile?.about_blurb;
  // Only city, no state
  const locationLine = city ? city.toUpperCase() : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <View style={[s.hero, { height: heroH }]}>

          {/* Left content — 42% of viewport */}
          <View style={s.heroLeft}>

            {/* Back — Figma arrow, #C7BAA5 */}
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <BackArrowIcon />
              <Text style={s.backText}>Back</Text>
            </Pressable>

            {/* Roaster name — Canela Text Regular 56.8px #FAF8F0 */}
            <Text style={[s.roasterName, liningNumerals]}>{roaster.name}</Text>

            {/* About blurb — Inter Regular 12px #C7BAA5, narrower, 300 char limit */}
            {aboutBlurb ? (
              <View style={s.aboutBlock}>
                <Text style={s.heroAbout}>
                  {aboutExpanded || aboutBlurb.length <= ABOUT_LIMIT
                    ? aboutBlurb
                    : aboutBlurb.slice(0, ABOUT_LIMIT) + "..."}
                  {!aboutExpanded && aboutBlurb.length > ABOUT_LIMIT ? (
                    <Text onPress={() => setAboutExpanded(true)} style={s.heroAboutMore}> more</Text>
                  ) : null}
                </Text>
              </View>
            ) : null}

            <View style={{ flex: 1 }} />

            {/* Tagline band — dynamic specialties from enriched profile */}
            <View style={s.tagBand}>
              <View style={s.tagBandRule} />
              <Text style={s.tagBandText}>{specialtyTags.join(" / ")}</Text>
              <View style={s.tagBandRule} />
            </View>

            {/* Location + founding year + website */}
            <View style={s.heroFooterRow}>
              {locationLine ? (
                <View style={s.heroFooterItem}>
                  <MapPinIcon />
                  <Text style={s.heroFooterText}>{locationLine}</Text>
                </View>
              ) : null}
              {profile?.founding_year ? (
                <View style={s.heroFooterItem}>
                  <Text style={s.heroFooterText}>EST. {profile.founding_year}</Text>
                </View>
              ) : null}
              {website ? (
                <Pressable onPress={() => Linking.openURL(website)} style={s.heroFooterItem}>
                  <Text style={s.heroFooterText}>WEBSITE</Text>
                  <ExternalLinkIcon />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Right image — 58% of viewport */}
          <View style={s.heroRight}>
            {heroImageUrl ? (
              <Image
                source={{ uri: heroImageUrl }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#1a0800" }]} />
            )}
          </View>
        </View>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <View style={s.body}>

          {/* Sidebar — sticky at 72px, full global filter lists */}
          {isDesktop && (
            <View style={s.sidebarOuter}>
              <View style={s.sidebarInner}>
                <Text style={s.sidebarCount}>
                  <Text style={s.sidebarCountBold}>{filtered.length}</Text>
                  {` ${filtered.length === 1 ? "coffee" : "coffees"}`}
                </Text>

                {(globalRoastLevels as string[]).length > 0 && (
                  <View style={s.filterSection}>
                    <View style={s.filterDivider} />
                    <Text style={s.filterTitle}>Roast</Text>
                    {(globalRoastLevels as string[]).map(level => (
                      <Pressable
                        key={level}
                        onPress={() => toggleArray(selectedRoasts, setSelectedRoasts, level)}
                        style={s.checkRow}
                      >
                        <View style={[s.checkbox, selectedRoasts.includes(level) && s.checkboxChecked]}>
                          {selectedRoasts.includes(level) ? <Text style={s.checkmark}>✓</Text> : null}
                        </View>
                        <Text style={s.checkLabel}>{level}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {(globalProcesses as string[]).length > 0 && (
                  <View style={s.filterSection}>
                    <View style={s.filterDivider} />
                    <Text style={s.filterTitle}>Process</Text>
                    {(globalProcesses as string[]).map(proc => (
                      <Pressable
                        key={proc}
                        onPress={() => toggleArray(selectedProcesses, setSelectedProcesses, proc)}
                        style={s.checkRow}
                      >
                        <View style={[s.checkbox, selectedProcesses.includes(proc) && s.checkboxChecked]}>
                          {selectedProcesses.includes(proc) ? <Text style={s.checkmark}>✓</Text> : null}
                        </View>
                        <Text style={s.checkLabel}>{proc}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Vertical divider — starts 20px below hero bottom, semi-transparent */}
          {isDesktop && <View style={s.verticalDivider} />}

          {/* Coffee grid */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.gridHeading, liningNumerals]} numberOfLines={1}>
              {`Explore ${filtered.length} ${filtered.length === 1 ? "coffee" : "coffees"} from ${roaster.name}`}
            </Text>
            <CoffeeGrid coffees={filtered} />
          </View>
        </View>

      </ScrollView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FAF8F0" },
  notFoundText: { fontFamily: fonts.bodyRegular, fontSize: 16, color: "#351101" },

  scroll: { flex: 1, backgroundColor: "#FAF8F0" },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    flexDirection: "row",
    backgroundColor: "#2a0d00",
    overflow: "hidden",
  },

  heroLeft: {
    flex: 42,
    paddingLeft: "6.25%" as any,
    paddingRight: "6.25%" as any,
    paddingTop: 52,
    paddingBottom: 32,
    flexDirection: "column",
    overflow: "hidden",
  } as any,

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  backText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#C7BAA5",
  },

  roasterName: {
    fontFamily: fonts.displayRegular,
    fontSize: 56.8,
    color: "#FAF8F0",
    lineHeight: 62,
    marginTop: 16,
  },

  // About block — slightly narrower than name (Figma: 387px vs 425px wide)
  aboutBlock: {
    marginTop: 6,
    paddingRight: 38,
  },
  heroAbout: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: "#C7BAA5",
    lineHeight: 18,
  },
  heroAboutMore: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "#FAF8F0",
  },

  tagBand: {
    marginBottom: 14,
  },
  tagBandRule: {
    height: 1,
    backgroundColor: "rgba(250,248,240,0.35)",
  },
  tagBandText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#FAF8F0",
    lineHeight: 18,
    paddingVertical: 7,
  },

  heroFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  // Icon LEFT for location, text RIGHT; icon RIGHT for website, text LEFT
  heroFooterItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroFooterText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#C7BAA5",
  },

  heroRight: {
    flex: 58,
    overflow: "hidden",
    position: "relative",
  } as any,

  // ── Body ──────────────────────────────────────────────────────────
  body: {
    flexDirection: "row",
    paddingLeft: "6.25%" as any,
    paddingRight: "6.25%" as any,
    paddingTop: 40,
    alignItems: "flex-start",
  } as any,

  sidebarOuter: {
    width: 195,
    minWidth: 195,
    maxWidth: 195,
    flexShrink: 0,
    position: "sticky" as any,
    top: 72,
    alignSelf: "flex-start",
  } as any,

  sidebarInner: {
    paddingTop: 20,
    paddingRight: 16,
    paddingBottom: 40,
  },

  sidebarCount: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: "#351101",
    marginBottom: 4,
  },
  sidebarCountBold: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#351101",
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
  checkmark: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" as any },

  checkLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    letterSpacing: -0.336,
    color: "#351101",
    flex: 1,
    lineHeight: 21,
  },

  // Vertical divider — marginTop keeps it away from hero bottom
  verticalDivider: {
    width: 1,
    backgroundColor: "rgba(215,209,196,0.5)",
    alignSelf: "stretch",
    marginTop: 20,
  } as any,

  // Grid heading — Canela Text Regular 28px, #351101
  gridHeading: {
    fontFamily: fonts.displayRegular,
    fontSize: 28,
    color: "#351101",
    lineHeight: 33.6,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
  },
});
