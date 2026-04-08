/**
 * CoffeeCard — Product image + label overlay + action buttons.
 * Front: image bg, CoffeeLabel island, button row with share + MASL.
 * Back: full India map with origin/roaster pins, coffee name overlay.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
import { ShoppingCart, Users as UsersIcon, Plus, Coffee, Share2 } from "lucide-react-native";
import { colors, fonts, cardShadow } from "../theme/colors";
import IndiaMap from "./IndiaMap";
import CoffeeLabel from "./CoffeeLabel";
import { resolveOriginCoords } from "../data/coffeeRegions";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";
import { useShare } from "../hooks/useShare";
import { useShelves } from "../hooks/useShelves";
import PopularityModal from "./PopularityModal";

interface CoffeeCardProps {
  coffee: any;
  userCount?: number;
  compact?: boolean;
  width?: number;
  height?: number;
}

export default function CoffeeCard({ coffee, userCount, compact, width: cardW = 250, height: cardH = 340 }: CoffeeCardProps) {
  const router = useRouter();
  const rotation = useSharedValue(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showPopularity, setShowPopularity] = useState(false);
  const { share } = useShare();
  const { addToShelf } = useShelves();

  const originCoords = resolveOriginCoords(coffee.origin, coffee.coffee_name);
  const price250 = pricePer250g(coffee.price_per_gram);

  const handleFlip = () => {
    const next = !isFlipped;
    setIsFlipped(next);
    rotation.value = withTiming(next ? 180 : 0, { duration: 600, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  };

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(rotation.value, [0, 180], [0, 180])}deg` }],
    backfaceVisibility: "hidden",
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(rotation.value, [0, 180], [180, 360])}deg` }],
    backfaceVisibility: "hidden",
  }));

  return (
    <View style={{ width: cardW, height: cardH }}>
      <Pressable onPress={handleFlip} style={{ width: cardW, height: cardH }}>

        {/* ═══ FRONT ═══ */}
        <Animated.View style={[s.face, frontStyle]}>
          {/* Product image background */}
          <View style={s.imageArea}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
            ) : (
              <View style={s.imagePlaceholder}><Coffee size={48} color="rgba(42,42,42,0.15)" /></View>
            )}
            {/* Label overlay island */}
            <View style={s.labelOverlay}>
              <CoffeeLabel
                coffee_name={coffee.coffee_name}
                roast_level={coffee.roast_level || "Unknown"}
                tasting_notes={coffee.tasting_notes}
                origin={coffee.origin}
                process={coffee.process}
                varietal={coffee.varietal}
                altitude_masl={coffee.altitude_masl}
                price_inr={coffee.price_inr}
                weight_grams={coffee.weight_grams}
                roaster_name={coffee.roaster_name}
              />
            </View>
          </View>

          {/* Button row: [+] [cart] [people N] [share] | MASL | price */}
          <View style={s.buttonRow}>
            <Pressable onPress={(e) => { e.stopPropagation?.(); addToShelf(coffee.product_id, "want_to_try"); }} style={s.btn}>
              <Plus size={13} color="#2a2a2a" />
            </Pressable>

            <Pressable onPress={(e) => { e.stopPropagation?.(); trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); Linking.openURL(coffee.product_url); }} style={[s.btn, s.btnAccent]}>
              <ShoppingCart size={13} color="white" />
            </Pressable>

            {userCount != null && userCount > 0 ? (
              <Pressable onPress={(e) => { e.stopPropagation?.(); setShowPopularity(true); }} style={s.btn}>
                <UsersIcon size={12} color="#2a2a2a" />
                <Text style={s.btnCountText}>{userCount}</Text>
              </Pressable>
            ) : (
              <View style={s.btn}><UsersIcon size={12} color="rgba(42,42,42,0.25)" /></View>
            )}

            <Pressable onPress={(e) => { e.stopPropagation?.(); share(coffee); }} style={s.btn}>
              <Share2 size={12} color="#2a2a2a" />
            </Pressable>

            {/* Spacer pushes price to right */}
            <View style={{ flex: 1 }} />

            {/* Price */}
            <Text style={s.priceText}>
              {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
            </Text>
            <Text style={s.priceUnit}>/250g</Text>
          </View>
        </Animated.View>

        {/* ═══ BACK — full India map + legend ═══ */}
        <Animated.View style={[s.face, s.backFace, backStyle]}>
          <IndiaMap
            originLat={originCoords?.lat}
            originLng={originCoords?.lng}
            roasterLat={coffee.roaster_lat}
            roasterLng={coffee.roaster_lng}
            fullMap
          />
          <View style={s.mapTint} />

          {/* Legend — top right */}
          <View style={s.legend}>
            <View style={s.legendRow}>
              <View style={[s.legendDot, { backgroundColor: "#C8553D" }]} />
              <Text style={s.legendText}>Bean source</Text>
            </View>
            <View style={s.legendRow}>
              <View style={[s.legendDot, { backgroundColor: "#E8C07A" }]} />
              <Text style={s.legendText}>Roastery</Text>
            </View>
          </View>

          {/* Flip hint — bottom center */}
          <View style={s.flipHintArea}>
            <Text style={s.flipHint}>Tap to flip back</Text>
          </View>
        </Animated.View>

      </Pressable>

      <PopularityModal
        visible={showPopularity}
        productId={coffee.product_id}
        coffeeName={coffee.coffee_name}
        onClose={() => setShowPopularity(false)}
      />
    </View>
  );
}

const BTN_SIZE = 28;

const s = StyleSheet.create({
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    ...cardShadow,
  },
  backFace: { backgroundColor: "#1A0F0A" },

  // Front
  imageArea: { flex: 1, backgroundColor: "#d4c5b8", position: "relative" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#e8e0d0" },
  labelOverlay: { position: "absolute", top: "5%", left: "5%", right: "5%", bottom: "5%" } as any,

  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: colors.cardFront,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },
  btn: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 2,
    backgroundColor: colors.tagBg,
  },
  btnAccent: { backgroundColor: colors.accent },
  btnCountText: {
    fontFamily: Platform.select({ web: "ui-monospace, monospace", default: "monospace" }),
    fontSize: 10, fontWeight: "700", color: "#2a2a2a",
  },
  priceText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textPrimary },
  priceUnit: { fontFamily: fonts.bodyRegular, fontSize: 9, color: colors.textMuted, marginLeft: 1 },

  // Back
  mapTint: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1, backgroundColor: "rgba(26, 15, 10, 0.25)",
  },
  legend: {
    position: "absolute", top: 10, right: 10, zIndex: 10,
    backgroundColor: "rgba(26, 15, 10, 0.6)",
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, gap: 4,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontFamily: fonts.bodyRegular, fontSize: 8, color: "rgba(245,240,235,0.8)",
  },
  flipHintArea: {
    position: "absolute", bottom: 10, left: 0, right: 0, zIndex: 10,
    alignItems: "center",
  },
  flipHint: {
    fontFamily: fonts.bodyRegular, fontSize: 9,
    color: "rgba(255,255,255,0.35)",
  },
});
