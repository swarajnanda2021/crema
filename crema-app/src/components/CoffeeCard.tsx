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
import { colors, fonts, cardShadow } from "../theme/colors";
import IndiaMap from "./IndiaMap";
import MetaRow from "./MetaRow";
import Chip from "./Chip";
import { resolveOriginCoords } from "../data/coffeeRegions";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";
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
  const { share } = useShare();

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

  const cardHeight = compact ? 280 : 350;
  const imgHeight = compact ? 130 : 170;

  return (
    <View style={[s.container, { height: cardHeight }]}>
      <Pressable onPress={handleFlip} style={{ flex: 1 }}>
        {/* ── Front Face ── */}
        <Animated.View style={[s.face, cardShadow, frontStyle]}>
          {/* Image */}
          <View style={[s.imageContainer, { height: imgHeight }]}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={s.image} contentFit="cover" transition={300} />
            ) : (
              <View style={s.imagePlaceholder}>
                <Coffee size={40} color={colors.border} />
              </View>
            )}
            {/* Popularity badge */}
            {userCount != null && userCount > 0 && (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); setShowPopularity(true); }}
                style={s.badge}
              >
                <Users size={12} color="white" />
                <Text style={s.badgeText}>{userCount}</Text>
              </Pressable>
            )}
          </View>

          {/* Content */}
          <View style={s.content}>
            <View style={{ flex: 1 }}>
              <Text style={s.coffeeName} numberOfLines={2}>{coffee.coffee_name}</Text>
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); router.push(`/roaster/${coffee.roaster_slug}`); }}
              >
                <Text style={s.roasterName} numberOfLines={1}>{coffee.roaster_name}</Text>
              </Pressable>

              {/* Chips */}
              <View style={s.chipRow}>
                {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
                {coffee.process && <Chip>{coffee.process}</Chip>}
                {coffee.altitude_masl && <Chip>{`${coffee.altitude_masl.toLocaleString()}m`}</Chip>}
              </View>
            </View>

            {/* Price + Buy */}
            <View style={s.priceRow}>
              <View style={s.priceGroup}>
                <Text style={s.price}>
                  {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
                </Text>
                <Text style={s.priceUnit}>/ 250g</Text>
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                  Linking.openURL(coffee.product_url);
                }}
                style={s.buyBtn}
              >
                <ShoppingCart size={13} color="white" />
                <Text style={s.buyText}>Buy</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* ── Back Face ── */}
        <Animated.View style={[s.face, s.backFace, cardShadow, backStyle]}>
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
      <Modal visible={showPopularity} transparent animationType="fade" onRequestClose={() => setShowPopularity(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowPopularity(false)}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{coffee.coffee_name}</Text>
            </View>
            <View style={s.modalBody}>
              <View style={s.modalIconCircle}>
                <Users size={24} color={colors.accent} />
              </View>
              <Text style={s.modalCount}>{userCount}</Text>
              <Text style={s.modalLabel}>
                {userCount === 1 ? "person has" : "people have"} this on their shelf
              </Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { width: "100%", maxWidth: 300 },
  face: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
  },
  backFace: { backgroundColor: "#1A0F0A" },
  imageContainer: {
    overflow: "hidden",
    backgroundColor: colors.tagBg,
  },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 20,
  },
  badgeText: { color: "white", fontFamily: fonts.bodyBold, fontSize: 12 },
  content: {
    flex: 1,
    padding: 14,
    justifyContent: "space-between",
  },
  coffeeName: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  roasterName: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    marginTop: 2,
    color: colors.textSecondary,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },
  priceGroup: { flexDirection: "row", alignItems: "baseline" },
  price: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  priceUnit: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    marginLeft: 2,
    color: colors.textMuted,
  },
  buyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  buyText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "white",
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
  shareRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  shareText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "rgba(255,255,255,0.7)" },
  flipHint: { fontFamily: fonts.bodyRegular, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: {
    backgroundColor: colors.bg,
    borderRadius: 20,
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  modalTitle: { fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.textPrimary },
  modalBody: { padding: 32, alignItems: "center" },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalCount: { fontFamily: fonts.displayBold, fontSize: 36, color: colors.textPrimary },
  modalLabel: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary, marginTop: 4 },
});
