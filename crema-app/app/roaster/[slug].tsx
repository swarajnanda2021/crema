import { View, Text, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { MapPin, Star, Calendar, Globe, ExternalLink } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { colors } from "../../src/theme/colors";
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
    return <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}><Text>Roaster not found</Text></View>;
  }

  return (
    <>
      <Stack.Screen options={{ title: roaster.name, headerTintColor: colors.accent }} />
      <ScrollView className="flex-1" style={{ backgroundColor: colors.bg }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="px-4 pt-4 pb-6" style={{ backgroundColor: colors.cardFront, borderBottomWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center gap-4">
            {profile?.logo_url ? (
              <Image source={{ uri: profile.logo_url }} style={{ width: 56, height: 56, borderRadius: 12 }} contentFit="contain" />
            ) : (
              <View className="w-14 h-14 rounded-xl items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
                <Text className="text-xl font-bold" style={{ color: colors.tagText }}>{(roaster.name || "?")[0]}</Text>
              </View>
            )}
            <View className="flex-1">
              <Text className="text-xl font-bold" style={{ color: colors.textPrimary }}>{roaster.name}</Text>
              {(roaster.city || profile?.city) && (
                <View className="flex-row items-center gap-1 mt-0.5">
                  <MapPin size={12} color={colors.textSecondary} />
                  <Text className="text-sm" style={{ color: colors.textSecondary }}>
                    {roaster.city || profile?.city}{(roaster.state || profile?.state) ? `, ${roaster.state || profile?.state}` : ""}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {profile?.tagline && <Text className="text-sm mt-3 italic" style={{ color: colors.textSecondary }}>{profile.tagline}</Text>}

          {/* Meta row */}
          <View className="flex-row flex-wrap gap-4 mt-3">
            {profile?.rating && (
              <View className="flex-row items-center gap-1">
                <Star size={14} color="#E8C07A" fill="#E8C07A" />
                <Text className="text-sm font-medium" style={{ color: colors.textPrimary }}>{profile.rating}</Text>
              </View>
            )}
            {profile?.founding_year && (
              <View className="flex-row items-center gap-1">
                <Calendar size={14} color={colors.textSecondary} />
                <Text className="text-sm" style={{ color: colors.textSecondary }}>Est. {profile.founding_year}</Text>
              </View>
            )}
            {(roaster.website || profile?.website) && (
              <Pressable onPress={() => Linking.openURL(roaster.website || profile.website)} className="flex-row items-center gap-1">
                <Globe size={14} color={colors.accent} />
                <Text className="text-sm" style={{ color: colors.accent }}>Website</Text>
              </Pressable>
            )}
          </View>

          {/* Specialties */}
          {profile?.specialties?.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5 mt-3">
              {profile.specialties.map((s: string) => <Chip key={s}>{s.replace(/-/g, " ")}</Chip>)}
            </View>
          )}

          {profile?.about_blurb && (
            <Text className="text-sm mt-3 leading-relaxed" numberOfLines={6} style={{ color: colors.textPrimary }}>
              {profile.about_blurb}
            </Text>
          )}
        </View>

        {/* Coffees */}
        <View className="px-4 pt-4">
          <Text className="text-lg font-semibold mb-3" style={{ color: colors.textPrimary }}>
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
