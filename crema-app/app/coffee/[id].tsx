import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { MapPin, Mountain, Leaf, Settings } from "lucide-react-native";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useShare } from "../../src/hooks/useShare";
import { trackClick } from "../../src/api/client";
import { colors, fonts, cardShadow } from "../../src/theme/colors";
import { pricePer250g } from "../../src/utils/formatPrice";
import { ShareIcon, CartIcon } from "../../src/components/icons/FigmaIcons";
import Chip from "../../src/components/Chip";
import CoffeeCard from "../../src/components/CoffeeCard";

/** Canela lining numerals */
const canelaNumeral = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum' 1, 'pnum' 1" } as any
  : {};

export default function CoffeeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { productMap, products } = useCoffeeData();
  const { share } = useShare();
  const router = useRouter();

  const coffee = productMap?.get(id);
  if (!coffee) {
    return (
      <View style={st.notFound}>
        <Text style={{ fontFamily: fonts.bodyRegular, color: colors.textSecondary }}>Coffee not found</Text>
      </View>
    );
  }

  const price250 = pricePer250g(coffee.price_per_gram);
  const related = products.filter((p: any) => p.roaster_slug === coffee.roaster_slug && p.product_id !== coffee.product_id).slice(0, 6);

  return (
    <>
      <Stack.Screen options={{ title: coffee.coffee_name, headerTintColor: colors.textPrimary, headerStyle: { backgroundColor: colors.bg } }} />
      <ScrollView style={st.container} showsVerticalScrollIndicator={false}>
        {/* Hero image */}
        {coffee.image_url && (
          <View style={st.heroWrap}>
            <Image source={{ uri: coffee.image_url }} style={st.heroImage} contentFit="cover" />
          </View>
        )}

        <View style={st.body}>
          {/* Title + roaster */}
          <Text style={st.title}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={st.roasterLink}>By {coffee.roaster_name}</Text>
          </Pressable>

          {/* Chips */}
          <View style={st.chipRow}>
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
          </View>

          {/* Price + Buy */}
          <View style={st.priceSection}>
            <View>
              <Text style={st.price}>
                {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              </Text>
              <Text style={st.priceLabel}>per 250g</Text>
            </View>
            <View style={st.actionRow}>
              <Pressable onPress={() => share(coffee)} style={st.shareBtn}>
                <ShareIcon size={18} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "coffee_page"); Linking.openURL(coffee.product_url); }}
                style={st.buyBtn}
              >
                <CartIcon size={16} color="#FFFFFF" />
                <Text style={st.buyText}>Buy</Text>
              </Pressable>
            </View>
          </View>

          {/* Divider */}
          <View style={st.divider} />

          {/* Details */}
          <View style={st.detailsSection}>
            {coffee.tasting_notes && <DetailRow label="Tasting Notes" value={coffee.tasting_notes} />}
            {coffee.origin && <DetailRow label="Origin" value={coffee.origin} icon={<MapPin size={14} color={colors.textMuted} />} />}
            {coffee.altitude_masl && <DetailRow label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} icon={<Mountain size={14} color={colors.textMuted} />} />}
            {coffee.varietal && <DetailRow label="Varietal" value={coffee.varietal} icon={<Leaf size={14} color={colors.textMuted} />} />}
            {coffee.process && <DetailRow label="Process" value={coffee.process} icon={<Settings size={14} color={colors.textMuted} />} />}
          </View>

          {/* Related coffees */}
          {related.length > 0 && (
            <View style={st.relatedSection}>
              <Text style={st.relatedTitle}>More from {coffee.roaster_name}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {related.map((r: any) => (
                  <View key={r.product_id} style={{ width: 240, marginRight: 20 }}>
                    <CoffeeCard coffee={r} width={240} height={372} compact />
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

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <View style={dt.row}>
      {icon && <View style={{ marginTop: 2 }}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={dt.label}>{label}</Text>
        <Text style={dt.value}>{value}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  heroWrap: { borderBottomLeftRadius: 5, borderBottomRightRadius: 5, overflow: "hidden" },
  heroImage: { width: "100%" as any, height: 320 },
  body: {
    maxWidth: 1000,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  title: {
    fontFamily: fonts.displayRegular,
    fontSize: 28,
    color: colors.textPrimary,
    lineHeight: 34,
    ...canelaNumeral,
  },
  roasterLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    marginTop: 6,
    color: colors.textSecondary,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  priceSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    paddingVertical: 16,
  },
  price: {
    fontFamily: fonts.displayRegular,
    fontSize: 28,
    color: colors.textPrimary,
    ...canelaNumeral,
  },
  priceLabel: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 10 },
  shareBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  buyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: colors.textPrimary,
  },
  buyText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textOnDark },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  detailsSection: { marginTop: 16, gap: 16 },
  relatedSection: { marginTop: 32 },
  relatedTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, marginBottom: 16, color: colors.textPrimary },
});

const dt = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12, letterSpacing: 0.5, color: colors.textMuted },
  value: { fontFamily: fonts.bodyRegular, fontSize: 14, marginTop: 2, lineHeight: 20, color: colors.textPrimary },
});
