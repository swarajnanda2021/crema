/**
 * CoffeeCard — Flip card with typographic label front + India map back.
 *
 * Front: CoffeeLabel (kraft paper roaster label) + action button strip
 * Back: India SVG map with origin pin + metadata overlay
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
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
      <Pressable onPress={handleFlip}>
        {/* ── Front Face: CoffeeLabel + action strip ── */}
        <Animated.View style={[s.face, frontStyle]}>
          {/* The typographic label card */}
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

          {/* Action buttons strip — overlaid at bottom */}
          <View style={s.actionStrip}>
            {/* + Add to shelf */}
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); addToShelf(coffee.product_id, "want_to_try"); }}
              style={s.actionBtn}
            >
              <Plus size={14} color={colors.tagText} />
            </Pressable>

            {/* Shopping cart — Buy */}
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                Linking.openURL(coffee.product_url);
              }}
              style={[s.actionBtn, s.buyBtn]}
            >
              <ShoppingCart size={14} color="white" />
            </Pressable>

            {/* Popularity — people count */}
            {userCount != null && userCount > 0 && (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); setShowPopularity(true); }}
                style={s.peopleBadge}
              >
                <UsersIcon size={12} color="#2a2a2a" />
                <Text style={s.peopleText}>{userCount}</Text>
              </Pressable>
            )}

            {/* Price */}
            <View style={s.priceTag}>
              <Text style={s.priceText}>
                {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "—"}
              </Text>
              <Text style={s.priceUnit}>/250g</Text>
            </View>
          </View>
        </Animated.View>

        {/* ── Back Face: India map + metadata ── */}
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

      {/* Popularity Modal */}
      <PopularityModal
        visible={showPopularity}
        productId={coffee.product_id}
        coffeeName={coffee.coffee_name}
        onClose={() => setShowPopularity(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: 320,
    height: 400, // 360 label + 40 action strip
  },
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 6,
    overflow: "hidden",
    ...cardShadow,
  },
  backFace: {
    backgroundColor: "#1A0F0A",
  },

  // Action strip at bottom of front face
  actionStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: "#2a2a2a",
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(236,229,211,0.9)",
  },
  buyBtn: {
    backgroundColor: colors.accent,
  },
  peopleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(236,229,211,0.9)",
  },
  peopleText: {
    fontFamily: Platform.select({ web: "ui-monospace, monospace", default: "monospace" }),
    fontSize: 12,
    fontWeight: "700",
    color: "#2a2a2a",
  },
  priceTag: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: "auto" as any,
  },
  priceText: {
    fontFamily: Platform.select({ web: "ui-monospace, monospace", default: "monospace" }),
    fontSize: 15,
    fontWeight: "700",
    color: "#ece5d3",
  },
  priceUnit: {
    fontFamily: Platform.select({ web: "ui-monospace, monospace", default: "monospace" }),
    fontSize: 10,
    color: "rgba(236,229,211,0.6)",
    marginLeft: 2,
  },

  // Back face
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
  shareText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
  },
  flipHint: {
    fontFamily: fonts.bodyRegular,
    textAlign: "center",
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    marginTop: 6,
  },
});
