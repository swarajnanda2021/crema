import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
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
    return (
      <View style={styles.notFound}>
        <Text>Coffee not found</Text>
      </View>
    );
  }

  const price250 = pricePer250g(coffee.price_per_gram);
  const related = products.filter((p: any) => p.roaster_slug === coffee.roaster_slug && p.product_id !== coffee.product_id).slice(0, 6);

  return (
    <>
      <Stack.Screen options={{ title: coffee.coffee_name, headerTintColor: colors.accent }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Hero image */}
        {coffee.image_url && (
          <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: 280 }} contentFit="cover" />
        )}

        <View style={styles.body}>
          <Text style={styles.title}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={styles.roasterLink}>{coffee.roaster_name}</Text>
          </Pressable>

          {/* Chips */}
          <View style={styles.chipRow}>
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
          </View>

          {/* Price + Buy */}
          <View style={styles.priceSection}>
            <View>
              <Text style={styles.price}>
                {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              </Text>
              <Text style={styles.priceLabel}>per 250g</Text>
            </View>
            <View style={styles.actionRow}>
              <Pressable onPress={() => share(coffee)} style={styles.shareBtn}>
                <Share2 size={18} color={colors.tagText} />
              </Pressable>
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "coffee_page"); Linking.openURL(coffee.product_url); }}
                style={styles.buyBtn}
              >
                <ShoppingCart size={16} color="white" />
                <Text style={styles.buyText}>Buy</Text>
              </Pressable>
            </View>
          </View>

          {/* Details */}
          <View style={styles.detailsSection}>
            {coffee.tasting_notes && <DetailRow icon={<Coffee size={18} color={colors.accent} />} label="Tasting Notes" value={coffee.tasting_notes} />}
            {coffee.origin && <DetailRow icon={<MapPin size={18} color={colors.accent} />} label="Origin" value={coffee.origin} />}
            {coffee.altitude_masl && <DetailRow icon={<Mountain size={18} color={colors.accent} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />}
            {coffee.varietal && <DetailRow icon={<Leaf size={18} color={colors.accent} />} label="Varietal" value={coffee.varietal} />}
            {coffee.process && <DetailRow icon={<Settings size={18} color={colors.accent} />} label="Process" value={coffee.process} />}
            {coffee.grind_options?.length > 0 && <DetailRow icon={<Settings size={18} color={colors.accent} />} label="Grinds" value={coffee.grind_options.join(", ")} />}
          </View>

          {/* Related coffees */}
          {related.length > 0 && (
            <View style={styles.relatedSection}>
              <Text style={styles.relatedTitle}>More from {coffee.roaster_name}</Text>
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
    <View style={detailStyles.row}>
      <View style={{ marginTop: 2 }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={detailStyles.label}>{label}</Text>
        <Text style={detailStyles.value}>{value}</Text>
      </View>
    </View>
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
  body: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  roasterLink: {
    fontSize: 16,
    marginTop: 4,
    color: colors.accent,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  priceSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  price: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  priceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  shareBtn: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  buyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: colors.accent,
  },
  buyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  detailsSection: {
    marginTop: 16,
    gap: 12,
  },
  relatedSection: {
    marginTop: 24,
  },
  relatedTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    color: colors.textPrimary,
  },
});

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  label: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  value: {
    fontSize: 14,
    marginTop: 2,
    color: colors.textPrimary,
  },
});
