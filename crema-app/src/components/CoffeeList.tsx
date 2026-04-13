import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, StyleSheet, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { t } from "../tokens/useTokens";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;
const GAP = 20;                    // Figma: 20px between cards
const TARGET_CARD_W = 240;         // Figma target card width
const CARD_ASPECT = 400 / 240;     // Figma 372 + ~28px for bean_type row
const GRID_PAD = 16;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  onScrollDirection?: (direction: "up" | "down", scrollY: number) => void;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent, onScrollDirection }: CoffeeListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [containerW, setContainerW] = useState(0);
  const lastScrollY = useRef(0);
  const visible = (Array.isArray(coffees) ? coffees : []).slice(0, visibleCount);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.min(8, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const currentY = contentOffset.y;

    // Scroll direction detection
    if (onScrollDirection) {
      const direction = currentY > lastScrollY.current ? "down" : "up";
      onScrollDirection(direction, currentY);
    }
    lastScrollY.current = currentY;

    const distanceFromBottom = contentSize.height - layoutMeasurement.height - currentY;
    if (distanceFromBottom < 400 && visibleCount < coffees.length) {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, coffees.length));
    }
  }, [visibleCount, coffees.length, onScrollDirection]);

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
          <View key={item.product_id} style={{ width: cardWidth, height: cardHeight }}>
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

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  emptyContainer: { alignItems: "center", paddingVertical: 80, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontFamily: t.font["body.semibold"], fontSize: 20, marginBottom: 8, color: "#351101" },
  emptySubtitle: { fontFamily: t.font["body.regular"], fontSize: 14, color: "#684F44" },
});
