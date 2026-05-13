import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { t, makeStyles } from "../tokens/useTokens";
import { useBreakpoint } from "../hooks/useBreakpoint";
import CoffeeCard, {
  CARD_TARGET_WIDTH,
  CARD_PORTRAIT_ASPECT,
  CARD_LANDSCAPE_ASPECT,
} from "./CoffeeCard";

const PAGE_SIZE = 24;
const GAP = 20;                          // Figma: 20px between cards
const TARGET_CARD_W = CARD_TARGET_WIDTH; // Canonical 240 (DESIGN_LANGUAGE §8)
const CARD_ASPECT = CARD_PORTRAIT_ASPECT;
const LANDSCAPE_ASPECT = CARD_LANDSCAPE_ASPECT;
const GRID_PAD = 16;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  // Raw scroll passthrough. The search-bar hide logic now lives in
  // `useSearchBarAutoHide` (§2.16); passing the bare event lets
  // callers chain that hook without re-implementing direction
  // heuristics per-tab.
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent, onScroll }: CoffeeListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [containerW, setContainerW] = useState(0);
  const s = useStyles();
  const { isMobile } = useBreakpoint();
  const visible = (Array.isArray(coffees) ? coffees : []).slice(0, visibleCount);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  // Mobile is always 1 column — the card flips landscape on mobile
  // and a single landscape card per row is the canonical layout
  // (DESIGN_LANGUAGE §7). Wide viewports use the target-width math
  // to pack 2-N portrait cards per row.
  const numCols = isMobile
    ? 1
    : Math.max(1, Math.min(8, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  // Landscape flip on mobile — the card sizes itself landscape
  // internally, so the wrapper has to allocate the landscape height
  // to avoid dead space below each row.
  const cardHeight = Math.floor(cardWidth * (isMobile ? LANDSCAPE_ASPECT : CARD_ASPECT));

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    onScroll?.(e);

    // End-of-list pagination (unchanged).
    const currentY = contentOffset.y;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - currentY;
    if (distanceFromBottom < 400 && visibleCount < coffees.length) {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, coffees.length));
    }
  }, [visibleCount, coffees.length, onScroll]);

  if (coffees.length === 0) {
    return (
      <View style={s.emptyContainer}>
        <Text style={s.emptyEmoji}>{"\u2615"}</Text>
        <Text style={s.emptyTitle}>No coffees match your filters.</Text>
        <Text style={s.emptySubtitle}>Try broadening your search or clearing some filters.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      onLayout={onLayout}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 100 }}
      onScroll={handleScroll}
      scrollEventThrottle={50}
    >
      {ListHeaderComponent}
      <View style={[s.grid, { gap: GAP, paddingHorizontal: GRID_PAD }]}>
        {visible.map((item) => (
          // CoffeeCard owns its tap → /coffee/[id] navigation
          // internally (DESIGN_LANGUAGE §7); the wrapper just sizes
          // the cell so the variant has matching height to render.
          <View
            key={item.product_id}
            style={{ width: cardWidth, height: cardHeight }}
          >
            <CoffeeCard
              coffee={item}
              userCount={popularity[item.product_id]}
              compact={compact}
              width={cardWidth}
              height={cardHeight}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  emptyContainer: { alignItems: "center", paddingVertical: 80, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontFamily: t.font["body.semibold"], fontSize: 20, marginBottom: 8, color: t.color["text.primary"] },
  emptySubtitle: { fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.secondary"] },
}));
