/**
 * FlavorWheelModal — page-shape host for the v3 single-tier flavor
 * wheel. Renders inline inside browse.tsx in place of the search bar +
 * BEANS list when the user opens the Flavor filter.
 *
 * Layout (top to bottom):
 *   - Header bar: ArrowLeft (left, dismisses) + RefreshCw (right,
 *     clears flavor + body picks; disabled when nothing's picked).
 *   - Title block — schema label + sub-line.
 *   - Full-circle wheel (FlavorWheel) — single-select; tap a sector
 *     to filter; the bullseye in the middle shows the live coffee
 *     count for the current selection.
 *   - Body strip — 5 mouthfeel chips (Smooth / Bold / Crisp / Creamy
 *     / Mellow). Each chip carries a count for its bucket so users
 *     know what to expect before they tap. Single-select, AND-filters
 *     with the wheel pick.
 *   - Result carousel — horizontal scroll of CoffeeCards matching the
 *     active filter intersection.
 *
 * Schema source: /api/sca/tree returns the active flavor schema. The
 * wheel renders whichever sectors come back; admin can flip the active
 * schema in Catalog Ops > Schema Manager and the next focus on this
 * surface picks it up.
 */
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import FlavorWheel, { WHEEL_HEIGHT_RATIO, bullseyeBoxPx } from "./FlavorWheel";
import FlavorBodyStrip, { BODY_CHIPS, type BodySelection } from "./FlavorBodyStrip";
import CoffeeCard from "./CoffeeCard";
import HapticPressable from "./primitives/HapticPressable";
import { t, makeStyles } from "../tokens/useTokens";
import * as haptics from "../utils/haptics";
import { apiFetchRaw } from "../api/client";
import {
  coffeeMatchesSelection,
  FALLBACK_SCHEMA,
  type Address,
  type FlavorSchema,
  type SelectedFlavor,
} from "../utils/scaTree";

interface Props {
  onClose: () => void;
  selected: SelectedFlavor;
  onSelectedChange: (next: SelectedFlavor) => void;
  /** Map<product_id, addresses[]> built once on the host. */
  addressesByProduct: Map<string, Address[]>;
  /** In-stock products from the host — used to compute the live
   *  matching set for both the bullseye count and the carousel. */
  inStockProducts: any[];
}

export default function FlavorWheelModal({
  onClose, selected, onSelectedChange,
  addressesByProduct, inStockProducts,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  // Full-circle wheel: square aspect, capped so it doesn't bleed on tablet.
  const wheelSize = Math.min(380, screenW - 16);
  const wheelHeight = Math.round(wheelSize * WHEEL_HEIGHT_RATIO);
  const bullseye = bullseyeBoxPx(wheelSize);
  const s = useStyles();

  // Active schema. Falls back to FALLBACK_SCHEMA on cold-start so the
  // wheel renders something while the fetch resolves.
  const [schema, setSchema] = useState<FlavorSchema>(FALLBACK_SCHEMA);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res: any = await apiFetchRaw("/sca/tree");
        const data = res?.data ?? res;
        if (!cancelled && data && data.kind === "single_tier") {
          setSchema(data as FlavorSchema);
        }
      } catch {
        // keep fallback; wheel still works for picking
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Body chip selection — local to the modal (not the host) for now;
  // the host still reads `selected` for cross-tab BEANS filtering, but
  // body filtering is wheel-modal-scoped until users prove they want
  // it elsewhere.
  const [bodyPick, setBodyPick] = useState<BodySelection>(null);

  // First filter: wheel pick (or pass-all if nothing picked). Used
  // as the base set for BOTH the body chip counts AND the carousel.
  // Without this, body counts would stay frozen against the entire
  // in-stock universe and never reflect the wheel selection.
  const flavorFilteredProducts = useMemo(() => {
    if (!selected) return inStockProducts;
    return inStockProducts.filter((p: any) => {
      const addrs = addressesByProduct.get(p.product_id);
      return addrs ? coffeeMatchesSelection(addrs, selected) : false;
    });
  }, [selected, inStockProducts, addressesByProduct]);

  // Body buckets from BODY_CHIPS — counts computed against the
  // flavor-filtered set so chips show "how many of THESE coffees
  // also feel this way." Updates live as the wheel pick changes.
  const bodyCounts = useMemo(
    () => computeBodyCounts(flavorFilteredProducts),
    [flavorFilteredProducts],
  );

  // Final matching set — flavor-filtered set further narrowed by the
  // body chip if any. AND-filter semantics.
  const matching = useMemo(() => {
    if (!bodyPick) return flavorFilteredProducts;
    const absorbs = BODY_CHIPS.find((c) => c.name === bodyPick)?.absorbs ?? [];
    return flavorFilteredProducts.filter((p: any) => {
      const tags = harvestTagsLowercase(p);
      return absorbs.some((w) => tags.has(w));
    });
  }, [flavorFilteredProducts, bodyPick]);

  const stats = useMemo(() => deriveStats(matching), [matching]);
  const anyActive = selected !== null || bodyPick !== null;

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
            if (!anyActive) return;
            haptics.tap();
            onSelectedChange(null);
            setBodyPick(null);
          }}
          disabled={!anyActive}
          hitSlop={10}
          style={[s.headerBtn, !anyActive && s.headerBtnDisabled]}
          accessibilityLabel="Reset flavor + body picks"
          accessibilityRole="button"
        >
          <RefreshCw size={20} color={t.color["text.primary"]} strokeWidth={2} />
        </HapticPressable>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollPad}
        showsVerticalScrollIndicator={false}
      >
        {/* Wheel + bullseye count overlay. The count sits in the
            inscribed-square box at the wheel's centre. */}
        <View style={[s.wheelWrap, { width: wheelSize, height: wheelHeight }]}>
          <FlavorWheel
            schema={schema}
            selected={selected}
            onSelectedChange={onSelectedChange}
            size={wheelSize}
          />
          <View
            style={[
              s.centerStat,
              {
                width: bullseye.w,
                height: bullseye.h,
                top: bullseye.cy - bullseye.h / 2,
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
            {selected ? (
              <Text style={s.statSelected} numberOfLines={1}>
                {selected}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Body chip strip — counts shown per chip so users see bucket
            size before tapping. AND-filters with the wheel pick. */}
        <FlavorBodyStrip
          selected={bodyPick}
          onSelectedChange={setBodyPick}
          counts={bodyCounts}
        />

        {/* Result carousel */}
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
              No coffees match this combination. Try clearing the body chip
              or picking a different sector.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface DerivedStats {
  count: number;
}

function deriveStats(matching: any[]): DerivedStats {
  return { count: matching.length };
}

function harvestTagsLowercase(product: any): Set<string> {
  const out = new Set<string>();
  const fn = product?.flavor_notes;
  if (Array.isArray(fn)) {
    for (const x of fn) {
      if (typeof x === "string") out.add(x.trim().toLowerCase());
    }
  } else if (typeof fn === "string") {
    for (const x of fn.split(/[,;|]/)) {
      const t = x.trim().toLowerCase();
      if (t) out.add(t);
    }
  }
  const tn = product?.tasting_notes;
  if (typeof tn === "string") {
    for (const x of tn.split(/[,;|]/)) {
      const t = x.trim().toLowerCase();
      if (t) out.add(t);
    }
  }
  return out;
}

function computeBodyCounts(products: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const chip of BODY_CHIPS) counts[chip.name] = 0;
  for (const p of products) {
    const tags = harvestTagsLowercase(p);
    for (const chip of BODY_CHIPS) {
      if (chip.absorbs.some((w) => tags.has(w))) {
        counts[chip.name] += 1;
      }
    }
  }
  return counts;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
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
  centerStat: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  statCount: {
    fontFamily: t.font.display,
    fontSize: 36,
    color: t.color["text.primary"],
    letterSpacing: -0.5,
    lineHeight: 38,
    textAlign: "center",
  },
  statCountLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: 10,
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase" as any,
    marginTop: 2,
  },
  statSelected: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color.accent,
    letterSpacing: 0.4,
    marginTop: 4,
    textAlign: "center",
  },
  carouselBlock: {
    marginTop: 12,
  },
  carouselInner: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
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
}));
