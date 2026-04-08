import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { MapPin, Star, Calendar, Globe } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { colors, fonts } from "../../src/theme/colors";
import Chip from "../../src/components/Chip";
import CoffeeCard from "../../src/components/CoffeeCard";

export default function RoasterDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { products, roasters } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();

  const roaster = roasters.find((r: any) => r.slug === slug);
  const profile = getProfile(slug, roaster?.website, roaster?.name);
  const coffees = products.filter((p: any) => p.roaster_slug === slug);

  if (!roaster) {
    return (
      <View style={styles.notFound}>
        <Text>Roaster not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: roaster.name, headerTintColor: colors.accent }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {profile?.logo_url ? (
              <Image source={{ uri: profile.logo_url }} style={{ width: 56, height: 56, borderRadius: 12 }} contentFit="contain" />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoLetter}>{(roaster.name || "?")[0]}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.roasterName}>{roaster.name}</Text>
              {(roaster.city || profile?.city) && (
                <View style={styles.locationRow}>
                  <MapPin size={12} color={colors.textSecondary} />
                  <Text style={styles.locationText}>
                    {roaster.city || profile?.city}{(roaster.state || profile?.state) ? `, ${roaster.state || profile?.state}` : ""}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {profile?.tagline && <Text style={styles.tagline}>{profile.tagline}</Text>}

          {/* Meta row */}
          <View style={styles.metaRow}>
            {profile?.rating && (
              <View style={styles.metaItem}>
                <Star size={14} color="#E8C07A" fill="#E8C07A" />
                <Text style={styles.metaRating}>{profile.rating}</Text>
              </View>
            )}
            {profile?.founding_year && (
              <View style={styles.metaItem}>
                <Calendar size={14} color={colors.textSecondary} />
                <Text style={styles.metaText}>Est. {profile.founding_year}</Text>
              </View>
            )}
            {(roaster.website || profile?.website) && (
              <Pressable onPress={() => Linking.openURL(roaster.website || profile.website)} style={styles.metaItem}>
                <Globe size={14} color={colors.accent} />
                <Text style={styles.metaLink}>Website</Text>
              </Pressable>
            )}
          </View>

          {/* Specialties */}
          {profile?.specialties?.length > 0 && (
            <View style={styles.specialtiesRow}>
              {profile.specialties.map((s: string) => <Chip key={s}>{s.replace(/-/g, " ")}</Chip>)}
            </View>
          )}

          {profile?.about_blurb && (
            <Text style={styles.aboutText} numberOfLines={6}>{profile.about_blurb}</Text>
          )}
        </View>

        {/* Coffees */}
        <View style={styles.coffeesSection}>
          <Text style={styles.coffeesTitle}>
            {coffees.length} {coffees.length === 1 ? "coffee" : "coffees"}
          </Text>
          {coffees.map((c: any) => (
            <View key={c.product_id} style={{ alignItems: "center", marginBottom: 16 }}>
              <CoffeeCard coffee={c} />
            </View>
          ))}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: colors.cardFront,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  logoFallback: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  logoLetter: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.tagText,
  },
  roasterName: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  tagline: {
    fontSize: 14,
    marginTop: 12,
    fontStyle: "italic",
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaRating: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  metaText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  metaLink: {
    fontSize: 14,
    color: colors.accent,
  },
  specialtiesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  aboutText: {
    fontSize: 14,
    marginTop: 12,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  coffeesSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  coffeesTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 18,
    marginBottom: 12,
    color: colors.textPrimary,
  },
});
