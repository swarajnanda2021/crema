import { View, Text, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { Coffee, MapPin, Mountain, Leaf, Settings, ShoppingCart, Share2 } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useShare } from "../../src/hooks/useShare";
import { trackClick } from "../../src/api/client";
import { colors } from "../../src/theme/colors";
import { pricePer250g } from "../../src/utils/formatPrice";
import Chip from "../../src/components/Chip";
import CoffeeCard from "../../src/components/CoffeeCard";

export default function CoffeeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { productMap, products } = useCoffeeData();
  const { share } = useShare();
  const router = useRouter();

  const coffee = productMap?.get(id);
  if (!coffee) {
    return <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}><Text>Coffee not found</Text></View>;
  }

  const price250 = pricePer250g(coffee.price_per_gram);
  const related = products.filter((p: any) => p.roaster_slug === coffee.roaster_slug && p.product_id !== coffee.product_id).slice(0, 6);

  return (
    <>
      <Stack.Screen options={{ title: coffee.coffee_name, headerTintColor: colors.accent }} />
      <ScrollView className="flex-1" style={{ backgroundColor: colors.bg }} showsVerticalScrollIndicator={false}>
        {/* Hero image */}
        {coffee.image_url && (
          <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: 280 }} contentFit="cover" />
        )}

        <View className="px-4 py-4">
          <Text className="text-2xl font-bold" style={{ color: colors.textPrimary }}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text className="text-base mt-1" style={{ color: colors.accent }}>{coffee.roaster_name}</Text>
          </Pressable>

          {/* Chips */}
          <View className="flex-row flex-wrap gap-2 mt-3">
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
          </View>

          {/* Price + Buy */}
          <View className="flex-row items-center justify-between mt-4 py-4 border-t border-b" style={{ borderColor: colors.border }}>
            <View>
              <Text className="text-2xl font-bold" style={{ color: colors.textPrimary }}>
                {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              </Text>
              <Text className="text-xs" style={{ color: colors.textSecondary }}>per 250g</Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable onPress={() => share(coffee)} className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
                <Share2 size={18} color={colors.tagText} />
              </Pressable>
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "coffee_page"); Linking.openURL(coffee.product_url); }}
                className="flex-row items-center gap-2 px-5 py-2.5 rounded-full"
                style={{ backgroundColor: colors.accent }}
              >
                <ShoppingCart size={16} color="white" />
                <Text className="text-base font-semibold" style={{ color: "white" }}>Buy</Text>
              </Pressable>
            </View>
          </View>

          {/* Details */}
          <View className="mt-4 gap-3">
            {coffee.tasting_notes && <DetailRow icon={<Coffee size={18} color={colors.accent} />} label="Tasting Notes" value={coffee.tasting_notes} />}
            {coffee.origin && <DetailRow icon={<MapPin size={18} color={colors.accent} />} label="Origin" value={coffee.origin} />}
            {coffee.altitude_masl && <DetailRow icon={<Mountain size={18} color={colors.accent} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />}
            {coffee.varietal && <DetailRow icon={<Leaf size={18} color={colors.accent} />} label="Varietal" value={coffee.varietal} />}
            {coffee.process && <DetailRow icon={<Settings size={18} color={colors.accent} />} label="Process" value={coffee.process} />}
            {coffee.grind_options?.length > 0 && <DetailRow icon={<Settings size={18} color={colors.accent} />} label="Grinds" value={coffee.grind_options.join(", ")} />}
          </View>

          {/* Related coffees */}
          {related.length > 0 && (
            <View className="mt-6">
              <Text className="text-lg font-semibold mb-3" style={{ color: colors.textPrimary }}>More from {coffee.roaster_name}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {related.map((r: any) => (
                  <View key={r.product_id} style={{ width: 200, marginRight: 12 }}>
                    <CoffeeCard coffee={r} compact />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="mt-0.5">{icon}</View>
      <View className="flex-1">
        <Text className="text-xs uppercase tracking-wider font-semibold" style={{ color: colors.textSecondary }}>{label}</Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textPrimary }}>{value}</Text>
      </View>
    </View>
  );
}
