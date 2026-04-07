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
        {/* -- Front Face -- */}
        <Animated.View style={[styles.face, { backgroundColor: colors.cardFront }, frontStyle]}>
          {/* Image */}
          <View style={{ height: compact ? 140 : 180, backgroundColor: colors.border, overflow: "hidden" }}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
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
          <View style={styles.frontContent}>
            <View>
              <Text style={styles.coffeeName} numberOfLines={2}>
                {coffee.coffee_name}
              </Text>
              <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
                <Text style={styles.roasterName} numberOfLines={1}>
                  {coffee.roaster_name}
                </Text>
              </Pressable>
            </View>

            {/* Chips */}
            <View style={styles.chipRow}>
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
              {coffee.altitude_masl && <Chip>{`${coffee.altitude_masl.toLocaleString()}m`}</Chip>}
            </View>

            {/* Price row */}
            <View style={styles.priceRow}>
              <View style={styles.priceLeft}>
                <Text style={styles.price}>
                  {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
                </Text>
                <Text style={styles.priceUnit}>/ 250g</Text>
              </View>
              <Pressable
                onPress={() => {
                  trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                  Linking.openURL(coffee.product_url);
                }}
                style={styles.buyBtn}
              >
                <ShoppingCart size={14} color="white" />
                <Text style={styles.buyText}>Buy</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* -- Back Face -- */}
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
          <View style={styles.backContent}>
            <View style={styles.backMetaList}>
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
            <View style={styles.backActions}>
              <Pressable onPress={() => share(coffee)} style={styles.shareBtn}>
                <Share2 size={18} color="rgba(255,255,255,0.8)" />
                <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>Share</Text>
              </Pressable>
            </View>
            <Text style={styles.flipHint}>Tap to flip back</Text>
          </View>
        </Animated.View>
      </Pressable>

      {/* Popularity Modal */}
      <Modal visible={showPopularity} transparent animationType="fade" onRequestClose={() => setShowPopularity(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPopularity(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{coffee.coffee_name}</Text>
            <Text style={styles.modalBody}>
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
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  frontContent: {
    flex: 1,
    padding: 12,
    justifyContent: "space-between",
  },
  coffeeName: {
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    color: colors.textPrimary,
  },
  roasterName: {
    fontSize: 14,
    marginTop: 2,
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  priceLeft: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  priceUnit: {
    fontSize: 14,
    marginLeft: 4,
    opacity: 0.6,
    color: colors.textSecondary,
  },
  buyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  buyText: {
    fontSize: 14,
    fontWeight: "500",
    color: "white",
  },
  backContent: {
    flex: 1,
    padding: 16,
    justifyContent: "space-between",
    zIndex: 10,
  },
  backMetaList: {
    gap: 12,
    flex: 1,
  },
  backActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flipHint: {
    textAlign: "center",
    fontSize: 12,
    marginTop: 8,
    color: "rgba(255,255,255,0.4)",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    width: "100%",
    maxWidth: 400,
    maxHeight: "70%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    padding: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  modalBody: {
    padding: 16,
    textAlign: "center",
    fontSize: 14,
    color: colors.textSecondary,
  },
});
