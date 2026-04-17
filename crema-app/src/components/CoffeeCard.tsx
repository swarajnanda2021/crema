/**
 * CoffeeCard — Exact Figma specs from node 8:1615.
 * Card: 240×372. Image: 240×160. Info: 240×212.
 * Top corners: 3.624px. Bottom corners: 5px.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { openExternal } from "../utils/openExternal";
import { Coffee, Package, Pencil, Trash2 } from "lucide-react-native";
import { t, cardShadow, SHELF_LABELS, ShelfKey } from "../tokens/useTokens";
import { HeartIcon, HeartFilledIcon, ShareIcon, CartIcon, UsersIcon } from "./icons/FigmaIcons";
import CoffeeLabel, { CoffeeLabelPrice } from "./CoffeeLabel";
import { trackClick } from "../api/client";
import { useShare } from "../hooks/useShare";
import { useShelves } from "../hooks/useShelves";
import { useAuth } from "../hooks/useAuth";
import PopularityModal from "./PopularityModal";
import InterestedButton from "./InterestedButton";

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
  /** §2.9 — roaster-owner edit affordance. When set, a pencil
   *  button renders on the card and the parent is expected to open
   *  its edit modal with this bean pre-filled. */
  onEdit?: () => void;
}

// Figma: image 160/372, info 212/372
const IMAGE_RATIO = 160 / 372;
const SHELF_KEYS: ShelfKey[] = ["open_bags", "on_the_list"];
const BTN_SIZE = 31;

export default function CoffeeCard({ coffee, userCount, compact, width: cardW = 240, height: cardH = 372, shelfMode, isOwner = true, currentShelf, onMoveShelf, onRemove, onAddToShelf, onEdit }: CoffeeCardProps) {
  const [showPopularity, setShowPopularity] = useState(false);
  const [showShelfPicker, setShowShelfPicker] = useState(false);
  const [showWholesaleInquiry, setShowWholesaleInquiry] = useState(false);
  const [shelvedAs, setShelvedAs] = useState<ShelfKey | null>(currentShelf || null);
  const { share } = useShare();
  const { addToShelf } = useShelves();
  const { user } = useAuth();
  // Phase 1 §2.2 — wholesale visibility. Both cafés and roasters are
  // "business" viewers that see the wholesale affordance; regular
  // users don't. Neither business type has a personal shelf, so for
  // them the Package chip replaces the heart in the top-right slot.
  const isCafeViewer = user?.account_type === "cafe";
  const isRoasterViewer = user?.account_type === "roaster";
  const isBusinessViewer = isCafeViewer || isRoasterViewer;
  const showWholesale = isBusinessViewer && coffee.wholesale_available === 1;

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

      {/* Top overlay layout:
         - **Owner** (roaster viewing own product): bin + pencil stack
           on the RIGHT (per user request — "mirror the delete and
           pencil buttons to the right"). Social dot sits on the LEFT
           when applicable. Social stays clickable without being
           hidden behind owner affordances.
         - **Non-owner add-to-shelf** (regular user in shelf mode): heart
           stays in the top-left add-to-shelf slot.
         - **Everyone else**: social dot top-left when userCount > 0.
         Top-right for non-owner viewers keeps the heart / Package
         chip (rendered further down).
      */}
      {shelfMode && isOwner && onRemove ? (
        <Pressable onPress={onRemove} style={s.binBtnRight}>
          {/* Swapped from the custom 12×13px SVG trash to lucide's
             Trash2 at 16px inside the cream disc. The old SVG only
             filled ~35% of the disc and read as "dots on a circle"
             at screen scale — visually indistinguishable from the
             social UsersIcon. Lucide's Trash2 is shaped more clearly
             (lid + body + vertical lines) and at 16px fills the
             disc properly. Colour stays the site's dark primary
             per the delete-button spec. */}
          <View style={s.binCircleRight}>
            <Trash2 size={16} color="#351101" strokeWidth={1.8} />
          </View>
        </Pressable>
      ) : shelfMode && !isOwner && !isBusinessViewer && onAddToShelf ? (
        <Pressable onPress={() => { setShowShelfPicker(!showShelfPicker); }} style={s.binBtn}>
          {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
        </Pressable>
      ) : null}

      {/* §2.9 — edit pencil for roaster owners. Stacks below the bin
         on the RIGHT. */}
      {shelfMode && isOwner && onEdit && (
        <Pressable onPress={onEdit} style={s.editPencilBtnRight} accessibilityLabel="Edit bean">
          <View style={s.editPencilCircle}>
            <Pencil size={14} color="#351101" strokeWidth={1.7} />
          </View>
        </Pressable>
      )}

      {/* Social dot — circular cream disc, count-free. Lives on the
         LEFT by default. Hidden only when the non-owner add-to-shelf
         heart occupies the same slot. */}
      {!(shelfMode && !isOwner && !isBusinessViewer && onAddToShelf)
        && userCount != null && userCount > 0 && (
          <Pressable
            onPress={() => setShowPopularity(true)}
            style={s.socialCircle}
            accessibilityLabel={`${userCount} people have this on a shelf`}
          >
            <UsersIcon size={15} color="#351101" />
          </Pressable>
        )}

      {/* Top-right. Business viewers (roaster / café) see the
         wholesale Package chip here when the bean is flagged
         available — it displaces the heart because neither account
         type has a personal shelf. If the bean is NOT wholesale, the
         slot stays empty for them. Regular users always see the
         heart. */}
      {!shelfMode && isBusinessViewer && showWholesale ? (
        <Pressable
          onPress={() => setShowWholesaleInquiry(true)}
          style={s.wholesaleBtn}
          accessibilityLabel={`See wholesale details for ${coffee.coffee_name}`}
        >
          <View style={s.wholesaleCircle}>
            <Package size={15} color="#351101" strokeWidth={1.7} />
          </View>
        </Pressable>
      ) : !shelfMode && !isBusinessViewer ? (
        <Pressable onPress={() => setShowShelfPicker(!showShelfPicker)} style={s.heartBtn}>
          {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
        </Pressable>
      ) : null}

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
              onPress={() => { if (coffee.product_url) { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); openExternal(coffee.product_url); } }}
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
        roasterName={coffee.roaster_name}
        roastLevel={coffee.roast_level}
        process={coffee.process}
        productUrl={coffee.product_url}
        onClose={() => setShowPopularity(false)}
      />

      {/* Controlled wholesale inquiry modal — opens when a café viewer
         taps the Package chip on the card. Renders nothing for non-café
         viewers (gated inside InterestedButton). */}
      <InterestedButton
        roaster_slug={coffee.roaster_slug}
        roaster_name={coffee.roaster_name}
        product_id={coffee.product_id}
        product_name={coffee.coffee_name}
        wholesale_minimum_kg={coffee.wholesale_minimum_kg}
        wholesale_note={coffee.wholesale_note}
        controlledOpen={showWholesaleInquiry}
        onControlledClose={() => setShowWholesaleInquiry(false)}
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

  // Bin button — Figma 243:3079. Top-LEFT variant is kept for the
  // non-owner add-to-shelf heart pattern; top-RIGHT variant is used
  // for roaster-owner cards (per the §2.9 layout rework — owner
  // affordances live on the right so the social dot owns the left).
  binBtn: {
    position: "absolute",
    top: 10,
    left: 12,
    zIndex: 10,
  },
  binBtnRight: {
    position: "absolute",
    top: 10,
    right: 12,
    zIndex: 10,
  } as any,
  // Companion disc for the right-side bin — fills the full 31px
  // circle so the lucide Trash2 icon at 16px actually reads as a
  // trash can and not as a tiny abstract glyph.
  binCircleRight: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // Edit pencil — stacks directly below the bin. Right-side variant
  // used on roaster-owner cards. Same 31px cream disc so the owner
  // kit reads as a coherent pair.
  editPencilBtn: {
    position: "absolute",
    top: 10 + BTN_SIZE + 6,
    left: 12,
    zIndex: 10,
  } as any,
  editPencilBtnRight: {
    position: "absolute",
    top: 10 + BTN_SIZE + 6,
    right: 12,
    zIndex: 10,
  } as any,
  editPencilCircle: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // Social dot — same disc geometry as the other top-overlay buttons
  // (31px, cream fill, dark icon). Replaces the pill-shaped friends
  // badge; the numeric count moved into the PopularityModal.
  socialCircle: {
    position: "absolute",
    top: 10,
    left: 12,
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  } as any,
  // Wholesale chip — top-right slot for business (roaster / café)
  // viewers. Displaces the heart because neither account type uses
  // the shelf. Same 31px disc + cream fill + dark Package icon as
  // the rest of the card's overlay buttons.
  wholesaleBtn: {
    position: "absolute",
    top: 10,
    right: 12,
    zIndex: 10,
  } as any,
  wholesaleCircle: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
  } as any,

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
