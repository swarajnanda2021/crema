/**
 * CoffeeCard — Exact Figma specs from node 8:1615.
 * Card: 240×372. Image: 240×160. Info: 240×212.
 * Top corners: 3.624px. Bottom corners: 5px.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { openExternal } from "../utils/openExternal";
import { Coffee, Pencil, Trash2 } from "lucide-react-native";
import { t, tLight, cardShadow, makeStyles, SHELF_LABELS, ShelfKey } from "../tokens/useTokens";
import { HeartIcon, HeartFilledIcon, ShareIcon, CartIcon, UsersIcon } from "./icons/FigmaIcons";
import CoffeeLabel, { CoffeeLabelPrice } from "./CoffeeLabel";
import { trackClick } from "../api/client";
import { useShare } from "../hooks/useShare";
import { useShelves } from "../hooks/useShelves";
import { thumbnailUrl } from "../utils/imageUrl";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { openPopularityModal } from "./primitives";
import * as Haptics from "expo-haptics";

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
  /** Force the landscape variant regardless of viewport. Used by the
   *  admin Catalog Ops carousels — they need horizontal cards on web
   *  too, not just the mobile breakpoint. */
  forceLandscape?: boolean;
}

// ── Canonical card geometry (Figma 66:6267 + 66:6268) ─────────────────
// Exported so every call-site gets the same numbers — no magic 240 /
// 372 / 400 sprinkled around the codebase. The card flips landscape
// on mobile and portrait on wide via internal `useBreakpoint`; the
// caller only controls width and is expected to allocate the
// matching height with `coffeeCardHeight(width, isMobile)`.
//
// See DESIGN_LANGUAGE.md §8 for the rendering directive — every coffee-
// card surface (Discover grid, roaster page, related-coffees rail,
// JOURNAL article carousel) is required to follow this rule.
export const CARD_TARGET_WIDTH = 240;
// Discover BEANS uses 400/240 (the wrapper uses this exact aspect
// for the grid cell). Slightly taller than the bare Figma 372 so
// the info column has its full breathing room with no clipped
// last-line. Used by every portrait-mode call-site.
export const CARD_PORTRAIT_ASPECT = 400 / 240;
// Landscape mobile (Figma 66:6267 + 66:6268): 370 × 251 frame.
export const CARD_LANDSCAPE_ASPECT = 251 / 370;

/** Compute the card height a wrapper should allocate for the
 *  current viewport. Mobile gets the landscape frame; wide gets
 *  the portrait frame. Use at every CoffeeCard call-site so the
 *  wrapper doesn't reserve dead vertical space when the card flips
 *  variant. */
export function coffeeCardHeight(width: number, isMobile: boolean): number {
  return Math.round(
    width * (isMobile ? CARD_LANDSCAPE_ASPECT : CARD_PORTRAIT_ASPECT),
  );
}

// Figma: image 160/372, info 212/372 (portrait, web wide)
const IMAGE_RATIO = 160 / 372;
const LANDSCAPE_ASPECT = CARD_LANDSCAPE_ASPECT;
const LANDSCAPE_IMG_RATIO = 180 / 370;
const SHELF_KEYS: ShelfKey[] = ["open_bags", "on_the_list"];
const BTN_SIZE = 31;

export default function CoffeeCard({ coffee, userCount, compact, width: cardW = 240, height: cardH = 372, shelfMode, isOwner = true, currentShelf, onMoveShelf, onRemove, onAddToShelf, onEdit, forceLandscape = false }: CoffeeCardProps) {
  const router = useRouter();
  const [showShelfPicker, setShowShelfPicker] = useState(false);
  const [shelvedAs, setShelvedAs] = useState<ShelfKey | null>(currentShelf || null);
  // Tap → full-page reader at `/coffee/{id}`. Replaces the prior
  // long-press → CoffeeDetailSheet floating modal: the modal was
  // data-rich but lacked the hero, the page had the hero but lacked
  // the rich detail sections — the page now carries both. One press
  // type sitewide. Haptic medium-impact on native to mirror the old
  // long-press tactile cue.
  const openDetail = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    router.push(`/coffee/${coffee.product_id}` as any);
  };
  const { share } = useShare();
  const { addToShelf } = useShelves();
  const { isMobile } = useBreakpoint();
  const s = useStyles();

  const imageH = Math.round(cardH * IMAGE_RATIO);
  const infoH = cardH - imageH;
  // Landscape (mobile): ignore the parent-passed height — the card
  // sizes itself by aspect so every call-site gets a consistent
  // landscape frame regardless of how much vertical space the
  // container allocated. The CoffeeList / carousel wrappers that
  // still allocate portrait height on mobile get a bit of empty
  // space below; a follow-up on those call-sites tightens this.
  const lsCardW = cardW;
  const lsCardH = Math.round(cardW * LANDSCAPE_ASPECT);
  const lsImgW = Math.round(cardW * LANDSCAPE_IMG_RATIO);
  const lsInfoW = cardW - lsImgW;

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

  // ── Landscape fork (mobile only) ──────────────────────────────────
  // Figma 66:6267 + 66:6268 + 66:6297. Every variant from the portrait
  // button matrix (owner bin + pencil, non-owner add-to-shelf heart,
  // business Package chip, default shelf-picker heart, social dot,
  // wholesale inquiry modal, shelf-picker dropdown) maps to landscape
  // one-for-one — only the anchors change:
  //   • Image top-left: friends badge OR add-to-shelf heart
  //   • Image top-right: heart / bin / Package
  //   • Image second-right (below bin): pencil
  //   • Image bottom-left: share disc (moved off the info row)
  //   • Info bottom-right: cart disc (stays on info, same as portrait)
  // Sold-out lens — true when the bean is out of stock. Currently
  // both `available === 0` (SQLite) and `available === false`
  // (legacy JSON path) need handling. Used to render a pink pill
  // overlay on the image so the card is visually distinct in
  // both Discover (when the user toggles "Sold out" filter) and
  // any other surface that mixes available + retired stock.
  const isSoldOut = coffee.available === 0 || coffee.available === false;

  if (isMobile || forceLandscape) {
    return (
      <Pressable
        testID={`coffee-card-${coffee.product_id}`}
        onPress={openDetail}
        accessibilityHint="Open the full coffee page with origin, roast, brew guide, and tasting notes"
        style={{ width: lsCardW, height: lsCardH }}
      >
      <View style={[s.cardLs, { width: lsCardW, height: lsCardH }]}>
        {/* ── IMAGE (left half) ── */}
        <View style={[s.imageAreaLs, { width: lsImgW, height: lsCardH }]}>
          {coffee.image_url ? (
            <Image source={{ uri: thumbnailUrl(coffee.image_url, 480) || undefined }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
          ) : (
            <View style={s.imagePlaceholder}><Coffee size={40} color="rgba(53,17,1,0.12)" /></View>
          )}
          {isSoldOut ? (
            <View style={s.soldOutPill} pointerEvents="none">
              <Text style={s.soldOutPillText}>Sold out</Text>
            </View>
          ) : null}

          {/* Top-left slot: add-to-shelf heart (non-owner, shelfMode) OR
             social dot (userCount > 0). Same rule as portrait. */}
          {shelfMode && !isOwner && onAddToShelf ? (
            <Pressable onPress={() => { setShowShelfPicker(!showShelfPicker); }} style={s.tlSlot}>
              {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
            </Pressable>
          ) : userCount != null && userCount > 0 ? (
            <Pressable
              onPress={() => openPopularityModal({
                productId: coffee.product_id,
                coffeeName: coffee.coffee_name,
                roasterName: coffee.roaster_name,
                roastLevel: coffee.roast_level,
                process: coffee.process,
                productUrl: coffee.product_url,
              })}
              style={[s.tlSlot, s.socialCircleLs]}
              accessibilityLabel={`${userCount} people have this on a shelf`}
            >
              <UsersIcon size={15} color={t.color["text.on-light"]} />
            </Pressable>
          ) : null}

          {/* Top-right slot: owner bin or default heart. */}
          {shelfMode && isOwner && onRemove ? (
            <Pressable onPress={onRemove} style={s.trSlot} accessibilityLabel="Remove bean">
              <View style={s.trashCircleLs}>
                <Trash2 size={16} color={t.color["text.on-light"]} strokeWidth={1.8} />
              </View>
            </Pressable>
          ) : !shelfMode ? (
            <Pressable onPress={() => setShowShelfPicker(!showShelfPicker)} style={s.trSlot}>
              {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
            </Pressable>
          ) : null}

          {/* Second row right: pencil stacked below bin (owner only). */}
          {shelfMode && isOwner && onEdit && (
            <Pressable onPress={onEdit} style={s.trStackSlot} accessibilityLabel="Edit bean">
              <View style={s.trashCircleLs}>
                <Pencil size={14} color={t.color["text.on-light"]} strokeWidth={1.7} />
              </View>
            </Pressable>
          )}

          {/* Shelf picker dropdown — anchored under the top-right
             heart. Appears over the info panel; acceptable since
             dropdowns float above siblings. */}
          {showShelfPicker && (
            <View style={s.shelfPickerLs}>
              {SHELF_KEYS.map((key) => (
                <Pressable key={key} onPress={() => handleShelfSelect(key)} style={[s.shelfOption, shelvedAs === key && s.shelfOptionActive]}>
                  <Text style={[s.shelfOptionText, shelvedAs === key && s.shelfOptionTextActive]}>{SHELF_LABELS[key].label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Bottom-left: share disc (lifted off the info bottom row
             since landscape moves buttons onto the image). */}
          <Pressable onPress={() => share(coffee)} style={s.blSlot} accessibilityLabel="Share">
            <ShareIcon size={BTN_SIZE} />
          </Pressable>
        </View>

        {/* ── INFO (right half) ── */}
        <View style={[s.infoSectionLs, { width: lsInfoW, height: lsCardH }]}>
          <CoffeeLabel
            coffee_name={coffee.coffee_name}
            roast_level={coffee.roast_level || "Unknown"}
            tasting_notes={coffee.tasting_notes}
            flavor_notes={coffee.flavor_notes}
            process={coffee.process}
            varietal={coffee.varietal}
            altitude_masl={coffee.altitude_masl}
            price_inr={coffee.price_inr}
            weight_grams={coffee.weight_grams}
            roaster_name={coffee.roaster_name}
            roaster_slug={coffee.roaster_slug}
            bean_type={coffee.bean_type}
          />

          {/* Bottom row: price left, cart right. Share lives on the
             image now, so the info row is lighter than portrait. */}
          <View style={s.bottomRowLs}>
            <CoffeeLabelPrice price_inr={coffee.price_inr} weight_grams={coffee.weight_grams} />
            <Pressable
              testID={`coffee-buy-${coffee.product_id}`}
              onPress={() => { if (coffee.product_url) { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); openExternal(coffee.product_url); } }}
              accessibilityLabel="Open product page"
            >
              <CartIcon size={BTN_SIZE} />
            </Pressable>
          </View>
        </View>
      </View>
      </Pressable>
    );
  }

  // ── Portrait (web wide) — unchanged ───────────────────────────────

  return (
    <Pressable
      testID={`coffee-card-${coffee.product_id}`}
      onPress={openDetail}
      accessibilityHint="Open the full coffee page with origin, roast, brew guide, and tasting notes"
      style={{ width: cardW, height: cardH }}
    >
    <View style={[s.card, { width: cardW, height: cardH }]}>
      {/* Image area — 160px at 240w, clips to top corners */}
      <View style={[s.imageArea, { height: imageH }]}>
        {coffee.image_url ? (
          <Image source={{ uri: thumbnailUrl(coffee.image_url, 480) || undefined }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
        ) : (
          <View style={s.imagePlaceholder}><Coffee size={40} color="rgba(53,17,1,0.12)" /></View>
        )}
        {isSoldOut ? (
          <View style={s.soldOutPill} pointerEvents="none">
            <Text style={s.soldOutPillText}>Sold out</Text>
          </View>
        ) : null}
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
          <View style={s.binCircleRight}>
            <Trash2 size={16} color={t.color["text.on-light"]} strokeWidth={1.8} />
          </View>
        </Pressable>
      ) : shelfMode && !isOwner && onAddToShelf ? (
        <Pressable onPress={() => { setShowShelfPicker(!showShelfPicker); }} style={s.binBtn}>
          {shelvedAs ? <HeartFilledIcon size={BTN_SIZE} /> : <HeartIcon size={BTN_SIZE} />}
        </Pressable>
      ) : null}

      {/* §2.9 — edit pencil for roaster owners. Stacks below the bin
         on the RIGHT. */}
      {shelfMode && isOwner && onEdit && (
        <Pressable onPress={onEdit} style={s.editPencilBtnRight} accessibilityLabel="Edit bean">
          <View style={s.editPencilCircle}>
            <Pencil size={14} color={t.color["text.on-light"]} strokeWidth={1.7} />
          </View>
        </Pressable>
      )}

      {/* Social dot — circular cream disc, count-free. Lives on the
         LEFT by default. Hidden only when the non-owner add-to-shelf
         heart occupies the same slot. */}
      {!(shelfMode && !isOwner && onAddToShelf)
        && userCount != null && userCount > 0 && (
          <Pressable
            onPress={() => openPopularityModal({
              productId: coffee.product_id,
              coffeeName: coffee.coffee_name,
              roasterName: coffee.roaster_name,
              roastLevel: coffee.roast_level,
              process: coffee.process,
              productUrl: coffee.product_url,
            })}
            style={s.socialCircle}
            accessibilityLabel={`${userCount} people have this on a shelf`}
          >
            <UsersIcon size={15} color={t.color["text.on-light"]} />
          </Pressable>
        )}

      {/* Top-right: heart for non-shelf views (consumer + roaster
         alike — Phase 1 has no business-flavored top-right
         affordance). */}
      {!shelfMode ? (
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
              testID={`coffee-buy-${coffee.product_id}`}
              onPress={() => { if (coffee.product_url) { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); openExternal(coffee.product_url); } }}
              accessibilityLabel="Open product page"
            >
              <CartIcon size={BTN_SIZE} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* PopularityModal is no longer mounted here; we emit
         `crema:open-popularity` via the helper above and the sitewide
         GlobalPopularityModal at root layout handles presentation
         (mid-band on mobile, centered card on web). (§2.40.3) */}
    </View>
    </Pressable>
  );
}

// CoffeeCard intentionally pins to the LIGHT-MODE token snapshot
// regardless of active theme — product cards retain their cream-on-
// white identity in night mode (per the brand-identity rule, like
// roaster logos always sitting on a Crema White surface). The factory
// signature is retained so the makeStyles registry still rebuilds the
// sheet when other surfaces flip; the values just don't change.
const useStyles = makeStyles(() => {
  const t = tLight;
  return ({
  card: {
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: t.color["card.info"],
    position: "relative",
    shadowColor: t.shadow.card.color,
    shadowOffset: { width: t.shadow.card.offset[0], height: t.shadow.card.offset[1] },
    shadowOpacity: t.shadow.card.opacity,
    shadowRadius: t.shadow.card.radius,
    elevation: t.shadow.card.elevation,
  },
  imageArea: {
    backgroundColor: "rgba(53,17,1,0.06)",
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    overflow: "hidden",
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,17,1,0.04)",
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
    backgroundColor: t.color["card.info"],
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
    backgroundColor: t.color["card.info"],
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
    backgroundColor: t.color["card.info"],
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
    backgroundColor: t.color["card.info"],
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
    backgroundColor: t.color["card.front"],
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
  shelfOptionActive: { backgroundColor: t.color["card.info"] },
  shelfOptionText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  shelfOptionTextActive: { fontFamily: t.font["body.semibold"] },

  // Info section — padding matches Figma, bottom radius matches card
  infoSection: {
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 12,
    backgroundColor: t.color["card.info"],
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

  // ── Landscape (mobile) ─────────────────────────────────────────────
  // Figma 66:6267 + 66:6268. Card is a 50/50 row — left image, right
  // info — both with radius on the outer edges only so the inner
  // edge reads as one continuous surface.
  cardLs: {
    flexDirection: "row",
    borderRadius: 5,
    backgroundColor: t.color["card.info"],
    position: "relative",
    overflow: "hidden",
    shadowColor: t.shadow.card.color,
    shadowOffset: { width: t.shadow.card.offset[0], height: t.shadow.card.offset[1] },
    shadowOpacity: t.shadow.card.opacity,
    shadowRadius: t.shadow.card.radius,
    elevation: t.shadow.card.elevation,
  } as any,
  imageAreaLs: {
    backgroundColor: "rgba(53,17,1,0.06)",
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
    overflow: "hidden",
    position: "relative",
  } as any,
  // Sold-out pill — overlaid on the image area, centered. Pink fill
  // with white text reads as a clear "this is retired" signal at
  // any card size. `pointerEvents=none` so the pill doesn't steal
  // taps from the heart / cart / social affordances around it.
  soldOutPill: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -12 }],
  } as any,
  // Sold-out pill — informational badge (NOT a button), so it
  // stays on `text.primary` (Espresso in light, Crema White in
  // dark) rather than following the §2.40.19 accent.cta → pink
  // rule. Pink would imply "available / branded" rather than
  // "unavailable / blocked," which is the wrong signal here.
  soldOutPillText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-dark"],
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.full,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    overflow: "hidden",
  } as any,
  infoSectionLs: {
    backgroundColor: t.color["card.info"],
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 12,
    flexDirection: "column",
  } as any,

  // Overlay anchors on the image half.
  tlSlot: { position: "absolute", top: 10, left: 12, zIndex: 10 } as any,
  trSlot: { position: "absolute", top: 10, right: 12, zIndex: 10 } as any,
  trStackSlot: { position: "absolute", top: 10 + BTN_SIZE + 6, right: 12, zIndex: 10 } as any,
  blSlot: { position: "absolute", bottom: 10, left: 12, zIndex: 10 } as any,

  // Companion disc for lucide icons (bin / Package / pencil) — the
  // lucide glyphs ship without the cream background ring that the
  // Figma heart / cart SVGs include.
  trashCircleLs: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // Social dot — same disc geometry as the portrait socialCircle,
  // just anchored inline-position instead of absolute-from-card.
  socialCircleLs: {
    width: BTN_SIZE, height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // Dropdown anchored below the top-right heart/pencil on the image.
  shelfPickerLs: {
    position: "absolute",
    top: 10 + BTN_SIZE + 6,
    right: 12,
    backgroundColor: t.color["card.front"],
    borderRadius: 10,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 20,
    minWidth: 130,
  } as any,

  // Bottom row on the info side — price left, cart right. Share
  // lives on the image now, so this row is lighter than portrait.
  bottomRowLs: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto" as any,
  } as any,
  });
});
