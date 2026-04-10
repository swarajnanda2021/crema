import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Sparkles, ShoppingCart, Plus, Coffee, MapPin, Mountain, Settings, Share2 } from "lucide-react-native";
import { colors } from "../theme/colors";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";
import { useShelves } from "../hooks/useShelves";
import { resolveOriginCoords } from "../data/coffeeRegions";
import IndiaMap from "./IndiaMap";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate, Easing } from "react-native-reanimated";

interface Props {
  recommendations: any[];
  onAddToShelf?: (productId: string, shelf: string) => void;
  count?: number;
}

export default function RecommendationPanel({ recommendations, onAddToShelf, count = 3 }: Props) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <Sparkles size={12} color={colors.textSecondary} />
        <Text style={s.heading}>You might like</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {recommendations.slice(0, count).map((coffee: any) => (
          <MiniCard key={coffee.product_id} coffee={coffee} onAddToShelf={onAddToShelf} />
        ))}
      </ScrollView>

      {/* Ad placeholder */}
      <View style={s.adPlaceholder}>
        <Text style={s.adText}>Ad space</Text>
      </View>
    </View>
  );
}

/** MiniCard — 200px tall, horizontal layout with flip, matching main branch */
function MiniCard({ coffee, onAddToShelf }: { coffee: any; onAddToShelf?: (id: string, shelf: string) => void }) {
  const router = useRouter();
  const rotation = useSharedValue(0);
  const [flipped, setFlipped] = useState(false);
  const price250 = pricePer250g(coffee?.price_per_gram);
  const originCoords = resolveOriginCoords(coffee?.origin, coffee?.coffee_name);
  if (!coffee) return null;

  const handleFlip = () => {
    const next = !flipped;
    setFlipped(next);
    rotation.value = withTiming(next ? 180 : 0, { duration: 500, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  };

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${interpolate(rotation.value, [0, 180], [0, 180])}deg` }],
    backfaceVisibility: "hidden" as any,
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${interpolate(rotation.value, [0, 180], [180, 360])}deg` }],
    backfaceVisibility: "hidden" as any,
  }));

  return (
    <Pressable onPress={handleFlip} style={mc.container}>
      {/* Front */}
      <Animated.View style={[mc.face, frontStyle]}>
        <View style={mc.frontRow}>
          {/* Left: image */}
          <View style={mc.imageCol}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <View style={mc.imagePlaceholder}><Coffee size={20} color={colors.border} /></View>
            )}
          </View>
          {/* Right: details */}
          <View style={mc.detailCol}>
            <View>
              {coffee._novel && (
                <View style={mc.novelBadge}><Text style={mc.novelText}>New to you</Text></View>
              )}
              <Text style={mc.coffeeName} numberOfLines={2}>{coffee.coffee_name}</Text>
              <Pressable onPress={(e) => { e.stopPropagation?.(); router.push(`/roaster/${coffee.roaster_slug}`); }}>
                <Text style={mc.roasterName} numberOfLines={1}>{coffee.roaster_name}</Text>
              </Pressable>
              <View style={mc.chipRow}>
                {coffee.roast_level && coffee.roast_level !== "Unknown" && <MiniChip>{coffee.roast_level}</MiniChip>}
                {coffee.process && <MiniChip>{coffee.process}</MiniChip>}
              </View>
            </View>
            <View style={mc.priceRow}>
              <Text style={mc.price}>
                {price250 != null ? `\u20B9${price250}` : "\u2014"}
                <Text style={mc.priceUnit}>/250g</Text>
              </Text>
              <View style={mc.actionRow}>
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); onAddToShelf?.(coffee.product_id, "want_to_try"); }}
                  style={mc.actionBtn}
                >
                  <Plus size={10} color={colors.accent} />
                </Pressable>
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); trackClick(coffee.product_id, coffee.roaster_slug, "recommendation"); Linking.openURL(coffee.product_url); }}
                  style={[mc.actionBtn, { backgroundColor: colors.accent }]}
                >
                  <ShoppingCart size={10} color="white" />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Back */}
      <Animated.View style={[mc.face, mc.backFace, backStyle]}>
        <IndiaMap originLat={originCoords?.lat} originLng={originCoords?.lng} roasterLat={coffee.roaster_lat} roasterLng={coffee.roaster_lng} />
        <View style={mc.mapOverlay} />
        <View style={mc.backContent}>
          <View style={{ gap: 8, flex: 1 }}>
            {coffee.tasting_notes && <MiniMeta icon={<Coffee size={10} color={colors.textOnDark} />} label="Tasting Notes" value={coffee.tasting_notes} />}
            {coffee.origin && <MiniMeta icon={<MapPin size={10} color={colors.textOnDark} />} label="Origin" value={coffee.origin} />}
            {coffee.altitude_masl && <MiniMeta icon={<Mountain size={10} color={colors.textOnDark} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />}
            {coffee.process && <MiniMeta icon={<Settings size={10} color={colors.textOnDark} />} label="Process" value={coffee.process} />}
          </View>
          <Text style={mc.flipHint}>Tap to flip</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function MiniChip({ children }: { children: string }) {
  return (
    <View style={{ paddingHorizontal: 4, paddingVertical: 1, borderRadius: 9999, backgroundColor: colors.tagBg }}>
      <Text style={{ fontSize: 8, color: colors.tagText }}>{children}</Text>
    </View>
  );
}

function MiniMeta({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
      <View style={{ marginTop: 2, opacity: 0.6 }}>{icon}</View>
      <View>
        <Text style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.5, fontWeight: "600", color: colors.textOnDark }}>{label}</Text>
        <Text style={{ fontSize: 10, lineHeight: 14, color: colors.textOnDark }}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  heading: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, color: colors.textSecondary },
  adPlaceholder: {
    borderRadius: 8, padding: 16, marginTop: 12,
    alignItems: "center",
    borderWidth: 2, borderStyle: "dashed" as any, borderColor: colors.border,
  },
  adText: { fontSize: 10, color: colors.textSecondary },
});

const mc = StyleSheet.create({
  container: {
    height: 200,
    marginBottom: 12,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#2C1810",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 16,
    overflow: "hidden",
  },
  backFace: { backgroundColor: "#1A0F0A" },
  frontRow: { flexDirection: "row", flex: 1, backgroundColor: colors.cardFront },
  imageCol: { width: 100, overflow: "hidden" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.tagBg },
  detailCol: { flex: 1, padding: 10, justifyContent: "space-between" },
  novelBadge: { backgroundColor: colors.accent, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 9999, alignSelf: "flex-start", marginBottom: 4 },
  novelText: { fontSize: 8, fontWeight: "600", color: "white" },
  coffeeName: { fontSize: 11, fontWeight: "600", lineHeight: 14, color: colors.textPrimary },
  roasterName: { fontSize: 10, marginTop: 2, color: colors.textSecondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  price: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  priceUnit: { fontSize: 8, fontWeight: "400", color: colors.textSecondary },
  actionRow: { flexDirection: "row", gap: 4 },
  actionBtn: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.tagBg },
  mapOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, backgroundColor: "rgba(26,15,10,0.7)" },
  backContent: { flex: 1, padding: 10, justifyContent: "space-between", zIndex: 10 },
  flipHint: { textAlign: "center", fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 4 },
});
