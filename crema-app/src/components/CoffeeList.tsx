import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent, Platform } from "react-native";
import { t } from "../tokens/useTokens";
import { useBreakpoint } from "../hooks/useBreakpoint";
import CoffeeCard from "./CoffeeCard";
import CoffeeDetailSheet from "./CoffeeDetailSheet";
import * as Haptics from "expo-haptics";

const PAGE_SIZE = 24;
const GAP = 20;                    // Figma: 20px between cards
const TARGET_CARD_W = 240;         // Figma target card width
const CARD_ASPECT = 400 / 240;     // Portrait (web wide): Figma 372 + ~28px
const LANDSCAPE_ASPECT = 251 / 370; // Landscape (mobile): Figma 66:6267/6268
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
  const [detailCoffee, setDetailCoffee] = useState<any>(null);
  const { isMobile } = useBreakpoint();
  const visible = (Array.isArray(coffees) ? coffees : []).slice(0, visibleCount);

  // Long-press → CoffeeDetailSheet. Owns the modal state here so the
  // sheet is mounted once for the whole grid, not per card.
  const openDetail = useCallback((c: any) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setDetailCoffee(c);
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.min(8, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
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
          <Pressable
            key={item.product_id}
            onLongPress={() => openDetail(item)}
            delayLongPress={350}
            style={{ width: cardWidth, height: cardHeight }}
            accessibilityHint="Long-press to inspect every detail the roaster shared about this coffee"
          >
            <CoffeeCard
              coffee={item}
              userCount={popularity[item.product_id]}
              compact={compact}
              width={cardWidth}
              height={cardHeight}
            />
          </Pressable>
        ))}
      </View>
      <CoffeeDetailSheet
        coffee={detailCoffee}
        visible={detailCoffee !== null}
        onClose={() => setDetailCoffee(null)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  emptyContainer: { alignItems: "center", paddingVertical: 80, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontFamily: t.font["body.semibold"], fontSize: 20, marginBottom: 8, color: "#351101" },
  emptySubtitle: { fontFamily: t.font["body.regular"], fontSize: 14, color: "#684F44" },
});
