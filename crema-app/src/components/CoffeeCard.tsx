/**
 * CoffeeCard — Exact Figma specs from node 8:1615.
 * Card: 240×372. Image: 240×160. Info: 240×212.
 * Top corners: 3.624px. Bottom corners: 5px.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Coffee, Package } from "lucide-react-native";
import Svg, { Circle, Path, G } from "react-native-svg";
import { t, cardShadow, SHELF_LABELS, ShelfKey } from "../tokens/useTokens";
import { HeartIcon, HeartFilledIcon, ShareIcon, CartIcon, UsersIcon } from "./icons/FigmaIcons";
import CoffeeLabel, { CoffeeLabelPrice } from "./CoffeeLabel";
import { trackClick } from "../api/client";
import { useShare } from "../hooks/useShare";
import { useShelves } from "../hooks/useShelves";
import { useAuth } from "../hooks/useAuth";
import PopularityModal from "./PopularityModal";

interface CoffeeCardProps {
  coffee: any;
  userCount?: number;
  compact?: boolean;
  width?: number;
  height?: number;
  shelfMode?: boolean;
  isOwner?: boolean;
  currentShelf?: ShelfKey;
  onMoveShelf?: (productId: string, shelf: string) => void;
  onRemove?: () => void;
  onAddToShelf?: (productId: string) => void;
}

// Figma: image 160/372, info 212/372
const IMAGE_RATIO = 160 / 372;
const SHELF_KEYS: ShelfKey[] = ["open_bags", "on_the_list"];
const BTN_SIZE = 31;

export default function CoffeeCard({ coffee, userCount, compact, width: cardW = 240, height: cardH = 372, shelfMode, isOwner = true, currentShelf, onMoveShelf, onRemove, onAddToShelf }: CoffeeCardProps) {
  const [showPopularity, setShowPopularity] = useState(false);
  const [showShelfPicker, setShowShelfPicker] = useState(false);
  const [shelvedAs, setShelvedAs] = useState<ShelfKey | null>(currentShelf || null);
  const { share } = useShare();
  const { addToShelf } = useShelves();
  const { user } = useAuth();
  // Phase 1 §2.2 — café viewers see the wholesale signal; nobody else
  // does. The field itself is public in the API; the visibility gate
  // lives here. Cafés don't have a personal shelf, so for café viewers
  // the wholesale affordance replaces the heart / shelf-add slot.
  const isCafeViewer = user?.account_type === "cafe";
  const showWholesale = isCafeViewer && coffee.wholesale_available === 1;

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

      {/* Top-left overlay. Order of precedence:
         1. Café viewer with a wholesale-flagged bean → wholesale chip
            (displaces the heart because cafés don't have a personal
            shelf — the heart's target)
         2. Shelf mode + owner → bin
         3. Shelf mode + non-owner non-café → heart to add to own shelf
         4. Someone else has this on a shelf → friends badge
         5. Otherwise nothing
      */}
      {isCafeViewer && showWholesale ? (
        <View style={s.wholesaleBtn}>
          <View style={s.wholesaleCircle}>
            <Package size={15} color="#351101" strokeWidth={1.7} />
          </View>
          {coffee.wholesale_minimum_kg != null && coffee.wholesale_minimum_kg > 0 && (
            <Text style={s.wholesaleMinText}>{coffee.wholesale_minimum_kg}kg</Text>
          )}
        </View>
      ) : shelfMode && isOwner && onRemove ? (
        <Pressable onPress={onRemove} style={s.binBtn}>
          <Svg width={BTN_SIZE} height={BTN_SIZE} viewBox="0 0 29.1645 29.1645" fill="none">
            <G>
              <Circle cx={14.5822} cy={14.5822} r={14.5822} fill="#EFE9DB" />
              <Path
                d="M11.25 10.7724V17.9835C11.25 18.668 11.25 19.0101 11.3862 19.2715C11.5061 19.5015 11.6972 19.6888 11.9324 19.806C12.1995 19.9391 12.5494 19.9391 13.2481 19.9391H16.7519C17.4506 19.9391 17.8 19.9391 18.0671 19.806C18.3023 19.6888 18.494 19.5015 18.6139 19.2715C18.75 19.0103 18.75 18.6686 18.75 17.9854V10.7724M11.25 10.7724H12.5M11.25 10.7724H10M12.5 10.7724H17.5M12.5 10.7724C12.5 10.2029 12.5 9.91833 12.5952 9.69373C12.722 9.39425 12.9652 9.15617 13.2715 9.03212C13.5012 8.93909 13.7926 8.93909 14.375 8.93909H15.625C16.2074 8.93909 16.4986 8.93909 16.7284 9.03212C17.0346 9.15617 17.2779 9.39425 17.4048 9.69373C17.4999 9.91833 17.5 10.2029 17.5 10.7724M17.5 10.7724H18.75M18.75 10.7724H20"
                stroke="#351101"
                strokeWidth={1.37}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </G>
          </Svg>
        </Pressable>
      ) : shelfMode && !isOwner && !isCafeViewer && onAddToShelf ? (
        <Pressable onPress={() => { setShowShelfPicker(!showShelfPicker); }} style={s.binBtn}>
          {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
        </Pressable>
      ) : userCount != null && userCount > 0 ? (
        <Pressable onPress={() => setShowPopularity(true)} style={s.friendsBadge}>
          <UsersIcon size={15} color="#351101" />
          <Text style={s.friendsCount}>{userCount}</Text>
        </Pressable>
      ) : null}

      {/* Social badge — top-right in shelf mode (alongside delete/heart on top-left) */}
      {shelfMode && userCount != null && userCount > 0 && (
        <Pressable onPress={() => setShowPopularity(true)} style={s.socialBadge}>
          <UsersIcon size={15} color="#351101" />
          <Text style={s.friendsCount}>{userCount}</Text>
        </Pressable>
      )}

      {/* Top-right. On browse/discover this is the heart (shelf-add)
         for regular users. Cafés don't have a shelf, so for them we
         hide the heart entirely; the wholesale chip on the top-left
         covers the café-relevant signal. */}
      {!shelfMode && !isCafeViewer && (
        <Pressable onPress={() => setShowShelfPicker(!showShelfPicker)} style={s.heartBtn}>
          {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
        </Pressable>
      )}

      {/* Shelf picker dropdown */}
      {showShelfPicker && (
        <View style={s.shelfPicker}>
          {SHELF_KEYS.map((key) => (
            <Pressable key={key} onPress={() => handleShelfSelect(key)} style={[s.shelfOption, shelvedAs === key && s.shelfOptionActive]}>
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
          flavor_notes={coffee.flavor_notes}
          origin={coffee.origin}
          process={coffee.process}
          varietal={coffee.varietal}
          altitude_masl={coffee.altitude_masl}
          price_inr={coffee.price_inr}
          weight_grams={coffee.weight_grams}
          roaster_name={coffee.roaster_name}
          roaster_slug={coffee.roaster_slug}
          bean_type={coffee.bean_type}
        />

        {/* Bottom row: price left, share+cart right — same baseline */}
        <View style={s.bottomRow}>
          <CoffeeLabelPrice price_inr={coffee.price_inr} weight_grams={coffee.weight_grams} />
          <View style={s.bottomButtons}>
            <Pressable onPress={() => share(coffee)}>
              <ShareIcon size={BTN_SIZE} />
            </Pressable>
            <Pressable
              onPress={() => { if (coffee.product_url) { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); Linking.openURL(coffee.product_url); } }}
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

  // Bin button — Figma 243:3079, exact SVG asset, top-left overlay
  binBtn: {
    position: "absolute",
    top: 10,
    left: 12,
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
    fontFamily: t.font["body.semibold"],
    fontSize: 10.2,
    color: "#351101",
  },

  // Social badge — top right in shelf mode
  // Wholesale chip — same top-left slot as the bin / heart, same 31px
  // circle + cream fill + dark icon language as the rest of the card's
  // overlay buttons. A tiny kg tag sits beneath when a minimum is set.
  wholesaleBtn: {
    position: "absolute",
    top: 10,
    left: 12,
    alignItems: "center",
  } as any,
  wholesaleCircle: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  wholesaleMinText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 9,
    color: "#351101",
    letterSpacing: 0.3,
    marginTop: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: "#EFE9DB",
    borderRadius: 4,
  } as any,
  socialBadge: {
    position: "absolute",
    top: 10,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFE9DB",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 10,
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
  shelfOptionText: { fontFamily: t.font["body.medium"], fontSize: 13, color: "#351101" },
  shelfOptionTextActive: { fontFamily: t.font["body.semibold"] },

  // Info section — padding matches Figma, bottom radius matches card
  infoSection: {
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 12,
    backgroundColor: "#EFE9DB",
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
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
