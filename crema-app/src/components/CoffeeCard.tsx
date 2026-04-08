/**
 * CoffeeCard — Exact Figma specs from node 8:1615.
 * Card: 240×372. Image: 240×160. Info: 240×212.
 * Top corners: 3.624px. Bottom corners: 5px.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Coffee, Trash2 } from "lucide-react-native";
import { colors, fonts, cardShadow, SHELF_LABELS, ShelfKey } from "../theme/colors";
import { HeartIcon, HeartFilledIcon, ShareIcon, CartIcon, UsersIcon } from "./icons/FigmaIcons";
import CoffeeLabel, { CoffeeLabelPrice } from "./CoffeeLabel";
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
  shelfMode?: boolean;
  currentShelf?: ShelfKey;
  onMoveShelf?: (productId: string, shelf: string) => void;
  onRemove?: () => void;
}

// Figma: image 160/372, info 212/372
const IMAGE_RATIO = 160 / 372;
const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];
const BTN_SIZE = 31;

export default function CoffeeCard({ coffee, userCount, compact, width: cardW = 240, height: cardH = 372, shelfMode, currentShelf, onMoveShelf, onRemove }: CoffeeCardProps) {
  const [showPopularity, setShowPopularity] = useState(false);
  const [showShelfPicker, setShowShelfPicker] = useState(false);
  const [shelvedAs, setShelvedAs] = useState<ShelfKey | null>(currentShelf || null);
  const { share } = useShare();
  const { addToShelf } = useShelves();

  const imageH = Math.round(cardH * IMAGE_RATIO);
  const infoH = cardH - imageH;

  const handleShelfSelect = (key: ShelfKey) => {
    if (shelfMode && onMoveShelf) {
      onMoveShelf(coffee.product_id, key);
      setShelvedAs(key);
    } else if (shelvedAs === key) {
      setShelvedAs(null);
    } else {
      setShelvedAs(key);
      addToShelf(coffee.product_id, key);
    }
    setShowShelfPicker(false);
  };

  return (
    <View style={[s.card, { width: cardW, height: cardH }]}>
      {/* Image area — 160px at 240w, clips to top corners */}
      <View style={[s.imageArea, { height: imageH }]}>
        {coffee.image_url ? (
          <Image source={{ uri: coffee.image_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
        ) : (
          <View style={s.imagePlaceholder}><Coffee size={40} color="rgba(53,17,1,0.12)" /></View>
        )}
      </View>

      {/* Overlay buttons — positioned from card level */}
      {shelfMode && onRemove ? (
        <Pressable onPress={onRemove} style={s.binBtn}>
          <Trash2 size={14} color={colors.accent} />
        </Pressable>
      ) : userCount != null && userCount > 0 ? (
        <Pressable onPress={() => setShowPopularity(true)} style={s.friendsBadge}>
          <UsersIcon size={15} color="#351101" />
          <Text style={s.friendsCount}>{userCount}</Text>
        </Pressable>
      ) : null}

      {/* Heart — top right, 31px (SVG includes circle bg) */}
      <Pressable onPress={() => setShowShelfPicker(!showShelfPicker)} style={s.heartBtn}>
        {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
      </Pressable>

      {/* Shelf picker dropdown */}
      {showShelfPicker && (
        <View style={s.shelfPicker}>
          {SHELF_KEYS.map((key) => (
            <Pressable key={key} onPress={() => handleShelfSelect(key)} style={[s.shelfOption, shelvedAs === key && s.shelfOptionActive]}>
              <View style={[s.shelfDot, { backgroundColor: SHELF_LABELS[key].color }]} />
              <Text style={[s.shelfOptionText, shelvedAs === key && s.shelfOptionTextActive]}>{SHELF_LABELS[key].label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Info section — 212px at 240w, bg #EFE9DB */}
      <View style={[s.infoSection, { height: infoH }]}>
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

        {/* Bottom row: price left, share+cart right — same baseline */}
        <View style={s.bottomRow}>
          <CoffeeLabelPrice price_inr={coffee.price_inr} weight_grams={coffee.weight_grams} />
          <View style={s.bottomButtons}>
            <Pressable onPress={() => share(coffee)}>
              <ShareIcon size={BTN_SIZE} />
            </Pressable>
            <Pressable
              onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); Linking.openURL(coffee.product_url); }}
            >
              <CartIcon size={BTN_SIZE} />
            </Pressable>
          </View>
        </View>
      </View>

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
  card: {
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: "#EFE9DB",
    position: "relative",
    ...cardShadow,
  },
  imageArea: {
    backgroundColor: "#d4c5b8",
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    overflow: "hidden",
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8e0d0",
  },

  // Bin button — shelf mode, top-left
  binBtn: {
    position: "absolute",
    top: 10,
    left: 12,
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },

  // Friends badge — top left, bg #EFE9DB, rounded 20px
  friendsBadge: {
    position: "absolute",
    top: 10,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFE9DB",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 10,
  },
  // Inter Semi Bold, 10.165px, #351101
  friendsCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10.2,
    color: "#351101",
  },

  // Heart — top right (SVG includes its own 31px circle bg)
  heartBtn: {
    position: "absolute",
    top: 10,
    right: 12,
    zIndex: 10,
  },

  // Shelf picker
  shelfPicker: {
    position: "absolute",
    top: 10 + BTN_SIZE + 6,
    right: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 20,
    minWidth: 130,
  },
  shelfOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shelfOptionActive: { backgroundColor: "#EFE9DB" },
  shelfDot: { width: 8, height: 8, borderRadius: 4 },
  shelfOptionText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },
  shelfOptionTextActive: { fontFamily: fonts.bodySemiBold },

  // Info section — padding matches Figma (name starts ~13px from info top)
  infoSection: {
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 12,
  },

  // Bottom row — price left, buttons right
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto" as any,
  },
  bottomButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
