import { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
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
import { Coffee, MapPin, Mountain, Leaf, Settings, ShoppingCart, Users, Share2 } from "lucide-react-native";
import { colors } from "../theme/colors";
import IndiaMap from "./IndiaMap";
import MetaRow from "./MetaRow";
import Chip from "./Chip";
import { resolveOriginCoords } from "../data/coffeeRegions";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";
import { useShelves } from "../hooks/useShelves";
import { useShare } from "../hooks/useShare";

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
  const { getShelfForProduct, addToShelf, removeFromShelf } = useShelves();
  const { share } = useShare();

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

  const cardHeight = compact ? 300 : 360;

  return (
    <View style={{ width: "100%", maxWidth: 300, height: cardHeight }}>
      <Pressable onPress={handleFlip} style={{ flex: 1 }}>
        {/* ── Front Face ── */}
        <Animated.View style={[styles.face, { backgroundColor: colors.cardFront }, frontStyle]}>
          {/* Image */}
          <View style={{ height: compact ? 140 : 180, backgroundColor: colors.border, overflow: "hidden" }}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <View className="flex-1 items-center justify-center">
                <Coffee size={48} color={colors.border} />
              </View>
            )}
            {/* Popularity badge */}
            {userCount != null && userCount > 0 && (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); setShowPopularity(true); }}
                style={styles.popularityBadge}
              >
                <Users size={14} color="white" />
                <Text style={{ color: "white", fontSize: 12, fontWeight: "700", marginLeft: 4 }}>{userCount}</Text>
              </Pressable>
            )}
          </View>

          {/* Content */}
          <View className="flex-1 p-3 justify-between">
            <View>
              <Text className="text-lg font-semibold leading-snug" numberOfLines={2} style={{ color: colors.textPrimary }}>
                {coffee.coffee_name}
              </Text>
              <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
                <Text className="text-sm mt-0.5" numberOfLines={1} style={{ color: colors.textSecondary }}>
                  {coffee.roaster_name}
                </Text>
              </Pressable>
            </View>

            {/* Chips */}
            <View className="flex-row flex-wrap gap-1 mt-1.5">
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
              {coffee.altitude_masl && <Chip>{`${coffee.altitude_masl.toLocaleString()}m`}</Chip>}
            </View>

            {/* Price row */}
            <View className="flex-row items-center justify-between mt-2">
              <View className="flex-row items-baseline">
                <Text className="text-xl font-bold" style={{ color: colors.textPrimary }}>
                  {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
                </Text>
                <Text className="text-sm ml-1 opacity-60" style={{ color: colors.textSecondary }}>/ 250g</Text>
              </View>
              <Pressable
                onPress={() => {
                  trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                  Linking.openURL(coffee.product_url);
                }}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: colors.accent }}
              >
                <ShoppingCart size={14} color="white" />
                <Text className="text-sm font-medium" style={{ color: "white" }}>Buy</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* ── Back Face ── */}
        <Animated.View style={[styles.face, styles.backFace, backStyle]}>
          {/* Map layer */}
          <IndiaMap
            originLat={originCoords?.lat}
            originLng={originCoords?.lng}
            roasterLat={coffee.roaster_lat}
            roasterLng={coffee.roaster_lng}
          />
          {/* Gradient overlay */}
          <View style={styles.mapOverlay} />
          {/* Content */}
          <View className="flex-1 p-4 justify-between" style={{ zIndex: 10 }}>
            <View className="gap-3 flex-1">
              <MetaRow icon={<Coffee size={16} color={colors.textOnDark} />} label="Tasting Notes" value={coffee.tasting_notes || "Not listed"} muted={!coffee.tasting_notes} />
              <MetaRow icon={<MapPin size={16} color={colors.textOnDark} />} label="Origin" value={coffee.origin || "Not listed"} muted={!coffee.origin} />
              {coffee.altitude_masl && (
                <MetaRow icon={<Mountain size={16} color={colors.textOnDark} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />
              )}
              {coffee.varietal && (
                <MetaRow icon={<Leaf size={16} color={colors.textOnDark} />} label="Varietal" value={coffee.varietal} />
              )}
              {coffee.process && (
                <MetaRow icon={<Settings size={16} color={colors.textOnDark} />} label="Process" value={coffee.process} />
              )}
            </View>

            {/* Actions */}
            <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-white/10">
              <Pressable onPress={() => share(coffee)} className="flex-row items-center gap-1.5">
                <Share2 size={18} color="rgba(255,255,255,0.8)" />
                <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>Share</Text>
              </Pressable>
            </View>
            <Text className="text-center text-xs mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              Tap to flip back
            </Text>
          </View>
        </Animated.View>
      </Pressable>

      {/* Popularity Modal */}
      <Modal visible={showPopularity} transparent animationType="fade" onRequestClose={() => setShowPopularity(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPopularity(false)}>
          <View style={styles.modalContent}>
            <Text className="text-base font-semibold p-4 border-b" style={{ borderColor: colors.border, color: colors.textPrimary }}>
              {coffee.coffee_name}
            </Text>
            <Text className="p-4 text-center text-sm" style={{ color: colors.textSecondary }}>
              {userCount} {userCount === 1 ? "person has" : "people have"} this on their shelf.
            </Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#2C1810",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  backFace: {
    backgroundColor: "#1A0F0A",
  },
  mapOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1,
    backgroundColor: "rgba(26, 15, 10, 0.7)",
  },
  popularityBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#C8553D",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#FAF7F2",
    borderRadius: 12,
    width: "100%",
    maxWidth: 400,
    maxHeight: "70%",
  },
});
