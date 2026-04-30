/**
 * FlavorWheelModal — page-shape host for the SCA flavor wheel.
 *
 * Renders inline inside browse.tsx in place of the search bar +
 * BEANS list when the user opens the Flavor filter. No RN Modal,
 * no absolute positioning — the host's flex layout naturally puts
 * this between the BEANS/ROASTERS tab bar and the MobileFooter.
 *
 * Layout (top to bottom):
 *   - Header bar: ArrowLeft (left, dismisses) + RefreshCw (right,
 *     clears all picks; disabled when nothing's picked).
 *   - Title: "Flavor" + sub-line "N picks · up to 3 per ring".
 *   - Semicircle wheel (FlavorWheel) — taps on the rings update
 *     `picks`, which the host (browse.tsx) reads for the BEANS
 *     filter chain.
 *   - Stat line: "692 coffees · 5 farms · 9 processes" — sits in
 *     the freed bottom half of the wheel area.
 *   - Result carousel: horizontal scroll of CoffeeCards matching
 *     the current picks (or all in-stock when no picks yet).
 *
 * Cap is 3 picks per tier, enforced inside FlavorWheel via a warn
 * haptic on a 4th-tap attempt.
 */
import { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import FlavorWheel, { WHEEL_HEIGHT_RATIO, bullseyeBoxPx } from "./FlavorWheel";
import CoffeeCard from "./CoffeeCard";
import HapticPressable from "./primitives/HapticPressable";
import { t } from "../tokens/useTokens";
import * as haptics from "../utils/haptics";
import {
  emptyPicks,
  totalPicks,
  coffeeMatchesPicks,
  type Picks,
  type Address,
} from "../utils/scaTree";

interface Props {
  onClose: () => void;
  picks: Picks;
  /** Accepts a Picks value or a `(prev) => next` updater. The wheel
   *  uses the updater form for race-free toggles; the page also
   *  passes a value for Reset. The host's `setSelectedFlavors` from
   *  useState accepts both natively. */
  onPicksChange: (update: Picks | ((prev: Picks) => Picks)) => void;
  /** Map<product_id, addresses[]> built once on the host. */
  addressesByProduct: Map<string, Address[]>;
  /** In-stock products from the host — used to compute the live
   *  matching set for both the count line and the carousel. */
  inStockProducts: any[];
}

export default function FlavorWheelModal({
  onClose, picks, onPicksChange,
  addressesByProduct, inStockProducts,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  // Semicircle wheel: width fits the screen, height is roughly half
  // (480×270 viewBox ratio). Cap width so it doesn't bleed on tablet.
  const wheelSize = Math.min(440, screenW - 16);
  const wheelHeight = Math.round(wheelSize * WHEEL_HEIGHT_RATIO);
  // Bullseye is the empty half-disc at the TOP of the wheel — count
  // and farms/processes line render here so the bottom half stays
  // free for the carousel.
  const bullseye = bullseyeBoxPx(wheelSize);

  // Live matching set — same algorithm the BEANS filter uses, scoped
  // to flavour picks only. Drives both the count + farms/processes
  // line AND the carousel underneath.
  const matching = useMemo(() => {
    if (totalPicks(picks) === 0) return inStockProducts;
    return inStockProducts.filter((p: any) => {
      const addrs = addressesByProduct.get(p.product_id);
      if (!addrs) return false;
      return coffeeMatchesPicks(addrs, picks);
    });
  }, [picks, inStockProducts, addressesByProduct]);

  const stats = useMemo(() => deriveStats(matching), [matching]);
  const totalP = totalPicks(picks);
  // Card width matches the canonical horizontal-carousel pattern from
  // JobProposalsCarousel (cardSlot width=370, forceLandscape,
  // isOwner=false). Mirroring exactly so the card reads identical to
  // the admin carousel rather than a one-off variant.

  return (
    <View style={s.page}>
      {/* Header bar */}
      <View style={s.header}>
        <HapticPressable
          haptic="tap"
          onPress={onClose}
          hitSlop={10}
          style={s.headerBtn}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <ArrowLeft size={22} color={t.color["text.primary"]} strokeWidth={2} />
        </HapticPressable>
        <View style={{ flex: 1 }} />
        <HapticPressable
          haptic="tap"
          onPress={() => {
            if (totalP === 0) return;
            haptics.tap();
            onPicksChange(emptyPicks());
          }}
          disabled={totalP === 0}
          hitSlop={10}
          style={[s.headerBtn, totalP === 0 && s.headerBtnDisabled]}
          accessibilityLabel={`Reset flavor picks${totalP > 0 ? ` (${totalP})` : ""}`}
          accessibilityRole="button"
        >
          <RefreshCw size={20} color={t.color["text.primary"]} strokeWidth={2} />
        </HapticPressable>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollPad}
        showsVerticalScrollIndicator={false}
      >
        {/* Semicircle wheel + bullseye count overlay. Just the number
            and "coffees" inside the half-disc — farms/processes moved
            to a fixed row above the carousel below so the count text
            doesn't get crammed. pointerEvents=none so taps pass
            through to the rings. */}
        <View style={[s.wheelWrap, { width: wheelSize, height: wheelHeight }]}>
          <FlavorWheel
            picks={picks}
            onPicksChange={onPicksChange}
            size={wheelSize}
          />
          <View
            style={[
              s.centerStat,
              {
                top: bullseye.flatEdgeY,
                height: bullseye.h,
                width: bullseye.w,
                left: (wheelSize - bullseye.w) / 2,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={s.statCount} numberOfLines={1} adjustsFontSizeToFit>
              {stats.count}
            </Text>
            <Text style={s.statCountLabel} numberOfLines={1}>
              {stats.count === 1 ? "coffee" : "coffees"}
            </Text>
          </View>
        </View>

        {/* Stat row — sits above the carousel with farms/processes
            right-aligned so it reads as a fixed label over the cards
            below. Hidden when the matching set has no resolved farm
            or process metadata. */}
        {matching.length > 0 && stats.line ? (
          <View style={s.statRow}>
            <Text style={s.statRowText}>{stats.line.replace(/\n/g, "  ·  ")}</Text>
          </View>
        ) : null}

        {/* Result carousel — horizontal scroll of matching coffees.
            Verbatim recipe from JobProposalsCarousel: cardSlot width
            370, gap=16, forceLandscape isOwner=false on CoffeeCard. */}
        {matching.length > 0 ? (
          <View style={s.carouselBlock}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.carouselInner}
              decelerationRate="fast"
            >
              {matching.slice(0, 60).map((coffee: any) => (
                <View key={coffee.product_id} style={s.cardSlot}>
                  <CoffeeCard
                    coffee={coffee}
                    width={370}
                    forceLandscape
                    isOwner={false}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={s.emptyBlock}>
            <Text style={s.emptyText}>
              No coffees match these picks. Try unpicking a leaf.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Stat derivation ─────────────────────────────────────────────────────────

interface DerivedStats {
  count: number;
  /** "X farms" / "Y processes" — newline-joined. The render code
   *  rewrites the newlines to dot-separators when laying out as a
   *  single horizontal line. */
  line: string;
}

function deriveStats(matching: any[]): DerivedStats {
  const count = matching.length;
  if (count === 0) return { count: 0, line: "" };
  const farms = new Set<string>();
  const processes = new Set<string>();
  for (const p of matching) {
    const e = p?.origin_estate_canonical;
    if (e && e !== "Unknown" && e !== "Multi-estate" && e !== "International") farms.add(e);
    const pr = p?.process;
    if (pr && pr !== "<UNKNOWN>") processes.add(pr);
  }
  const bits: string[] = [];
  if (farms.size > 0) bits.push(`${farms.size} ${farms.size === 1 ? "farm" : "farms"}`);
  if (processes.size > 0) bits.push(`${processes.size} ${processes.size === 1 ? "process" : "processes"}`);
  return { count, line: bits.join("\n") };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: t.color.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnDisabled: {
    opacity: 0.35,
  },
  scrollPad: {
    paddingBottom: 24,
  },
  wheelWrap: {
    alignSelf: "center",
    marginTop: 8,
    position: "relative",
  } as any,
  // Bullseye overlay — sized + positioned inline by the caller using
  // bullseyeBoxPx(). Just count + "coffees" stacked vertically; the
  // farms/processes line moved to a separate row above the carousel
  // so the count text doesn't get crammed.
  centerStat: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 6,
  } as any,
  statCount: {
    fontFamily: t.font.display,
    fontSize: 32,
    color: t.color["text.primary"],
    letterSpacing: -0.5,
    lineHeight: 34,
    textAlign: "center",
  },
  statCountLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: 10,
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase" as any,
    marginTop: 0,
  },
  // Farms/processes line — sits above the carousel as a fixed label
  // band, right-aligned so it reads like a header label for the rail.
  statRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    marginTop: 12,
  },
  statRowText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 12,
    color: t.color["text.muted"],
    letterSpacing: 0.4,
  },
  carouselBlock: {
    marginTop: 12,
  },
  // Mirrors JobProposalsCarousel.railScrollInner — gap between cards
  // is 16, with 16 horizontal padding to indent the rail.
  carouselInner: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  // Mirrors JobProposalsCarousel.cardSlot — fixed 370 width, items
  // start-aligned. The actual CoffeeCard inside also uses width=370
  // forceLandscape, so the slot is exactly card-sized.
  cardSlot: {
    width: 370,
    alignItems: "flex-start",
  } as any,
  emptyBlock: {
    marginTop: 24,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    color: t.color["text.muted"],
    textAlign: "center",
  },
});
