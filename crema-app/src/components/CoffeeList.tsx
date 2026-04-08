import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { colors, fonts } from "../theme/colors";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;
const GAP = 20;                    // Figma: 20px between cards
const MIN_CARD_W = 220;            // allows 4 cols at typical widths
const CARD_ASPECT = 372 / 240;     // exact Figma ratio
const GRID_PAD = 16;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent }: CoffeeListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [containerW, setContainerW] = useState(0);
  const visible = coffees.slice(0, visibleCount);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.floor((availableWidth + GAP) / (MIN_CARD_W + GAP)));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom < 400 && visibleCount < coffees.length) {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, coffees.length));
    }
  }, [visibleCount, coffees.length]);

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
      scrollEventThrottle={200}
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
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 20, marginBottom: 8, color: "#351101" },
  emptySubtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: "#684F44" },
});
