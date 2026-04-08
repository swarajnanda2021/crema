/**
 * CoffeeCard — Product image background + typographic label overlay + action buttons.
 * Taps flip to India map back face.
 *
 * Layout (front):
 *   ┌─────────────────────────┐
 *   │  Product Image (fill)   │
 *   │  ┌───────────────────┐  │
 *   │  │  CoffeeLabel      │  │
 *   │  │  (overlay island)  │  │
 *   │  └───────────────────┘  │
 *   ├─────────────────────────┤
 *   │  [+] [🛒] [👥 4] ₹938  │
 *   └─────────────────────────┘
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
import { ShoppingCart, Users as UsersIcon, Plus, Coffee, MapPin, Mountain, Leaf, Settings, Share2 } from "lucide-react-native";
import { colors, fonts, cardShadow } from "../theme/colors";
import IndiaMap from "./IndiaMap";
import MetaRow from "./MetaRow";
import CoffeeLabel from "./CoffeeLabel";
import { resolveOriginCoords } from "../data/coffeeRegions";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";
import { useShare } from "../hooks/useShare";
import { useShelves } from "../hooks/useShelves";
import PopularityModal from "./PopularityModal";

const CARD_W = 320;
const CARD_H = 460; // image area + label overlay + button row

interface CoffeeCardProps {
  coffee: any;
  userCount?: number;
  compact?: boolean;
}

export default function CoffeeCard({ coffee, userCount, compact }: CoffeeCardProps) {
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
    rotation.value = withTiming(next ? 180 : 0, {
      duration: 600,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
  };

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${interpolate(rotation.value, [0, 180], [0, 180])}deg` },
    ],
    backfaceVisibility: "hidden",
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${interpolate(rotation.value, [0, 180], [180, 360])}deg` },
    ],
    backfaceVisibility: "hidden",
  }));

  return (
    <View style={s.container}>
      <Pressable onPress={handleFlip} style={s.pressable}>

        {/* ════════ FRONT FACE ════════ */}
        <Animated.View style={[s.face, frontStyle]}>
          {/* 1. Product image — fills the top area */}
          <View style={s.imageArea}>
            {coffee.image_url ? (
              <Image
                source={{ uri: coffee.image_url }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={s.imagePlaceholder}>
                <Coffee size={48} color="rgba(42,42,42,0.15)" />
              </View>
            )}

            {/* 2. CoffeeLabel overlaid as a card island */}
            <View style={s.labelOverlay}>
              <CoffeeLabel
                coffee_name={coffee.coffee_name}
                roast_level={coffee.roast_level || "Unknown"}
                tasting_notes={coffee.tasting_notes}
                origin={coffee.origin}
                process={coffee.process}
                varietal={coffee.varietal}
                price_inr={coffee.price_inr}
                weight_grams={coffee.weight_grams}
                roaster_name={coffee.roaster_name}
              />
            </View>
          </View>

          {/* 3. Button row — uniform buttons below the image */}
          <View style={s.buttonRow}>
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); addToShelf(coffee.product_id, "want_to_try"); }}
              style={s.btn}
            >
              <Plus size={16} color="#2a2a2a" />
            </Pressable>

            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                Linking.openURL(coffee.product_url);
              }}
              style={[s.btn, s.btnAccent]}
            >
              <ShoppingCart size={16} color="white" />
            </Pressable>

            {userCount != null && userCount > 0 ? (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); setShowPopularity(true); }}
                style={s.btn}
              >
                <UsersIcon size={14} color="#2a2a2a" />
                <Text style={s.btnCountText}>{userCount}</Text>
              </Pressable>
            ) : (
              <View style={s.btn}>
                <UsersIcon size={14} color="rgba(42,42,42,0.3)" />
              </View>
            )}

            {/* Price — right-aligned */}
            <View style={s.priceArea}>
              <Text style={s.priceText}>
                {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              </Text>
              <Text style={s.priceUnit}>/250g</Text>
            </View>
          </View>
        </Animated.View>

        {/* ════════ BACK FACE ════════ */}
        <Animated.View style={[s.face, s.backFace, backStyle]}>
          <IndiaMap
            originLat={originCoords?.lat}
            originLng={originCoords?.lng}
            roasterLat={coffee.roaster_lat}
            roasterLng={coffee.roaster_lng}
          />
          <View style={s.mapOverlay} />
          <View style={s.backContent}>
            <View style={s.backMeta}>
              <MetaRow icon={<Coffee size={14} color={colors.textOnDark} />} label="Tasting Notes" value={coffee.tasting_notes || "Not listed"} muted={!coffee.tasting_notes} />
              <MetaRow icon={<MapPin size={14} color={colors.textOnDark} />} label="Origin" value={coffee.origin || "Not listed"} muted={!coffee.origin} />
              {coffee.altitude_masl && <MetaRow icon={<Mountain size={14} color={colors.textOnDark} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />}
              {coffee.varietal && <MetaRow icon={<Leaf size={14} color={colors.textOnDark} />} label="Varietal" value={coffee.varietal} />}
              {coffee.process && <MetaRow icon={<Settings size={14} color={colors.textOnDark} />} label="Process" value={coffee.process} />}
            </View>
            <View style={s.backFooter}>
              <Pressable onPress={() => share(coffee)} style={s.shareRow}>
                <Share2 size={16} color="rgba(255,255,255,0.7)" />
                <Text style={s.shareText}>Share</Text>
              </Pressable>
              <Text style={s.flipHint}>Tap to flip back</Text>
            </View>
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

const BTN_SIZE = 36;

const s = StyleSheet.create({
  container: {
    width: CARD_W,
    height: CARD_H,
  },
  pressable: {
    width: CARD_W,
    height: CARD_H,
  },
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    ...cardShadow,
  },
  backFace: {
    backgroundColor: "#1A0F0A",
  },

  /* ── Front face layout ── */

  // Image fills the top, label floats on top
  imageArea: {
    flex: 1,
    backgroundColor: "#d4c5b8",
    position: "relative",
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8e0d0",
  },

  // Label overlay — centered on top of the image
  labelOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  // Button row — clean uniform strip
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: colors.cardFront,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },

  // All buttons are the same size square
  btn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 3,
    backgroundColor: colors.tagBg,
  },
  btnAccent: {
    backgroundColor: colors.accent,
  },
  btnCountText: {
    fontFamily: Platform.select({ web: "ui-monospace, monospace", default: "monospace" }),
    fontSize: 11,
    fontWeight: "700",
    color: "#2a2a2a",
  },

  // Price right-aligned
  priceArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "flex-end",
  },
  priceText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  priceUnit: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: 2,
  },

  /* ── Back face ── */
  mapOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1,
    backgroundColor: "rgba(26, 15, 10, 0.72)",
  },
  backContent: {
    flex: 1,
    padding: 16,
    justifyContent: "space-between",
    zIndex: 10,
  },
  backMeta: { gap: 10, flex: 1 },
  backFooter: { marginTop: 8 },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  shareText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "rgba(255,255,255,0.7)" },
  flipHint: { fontFamily: fonts.bodyRegular, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 },
});
