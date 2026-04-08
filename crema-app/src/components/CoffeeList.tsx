import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { colors, fonts } from "../theme/colors";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;
const GAP = 8;
const MIN_CARD_W = 200;
const CARD_ASPECT = 1.36;
const GRID_PAD = 8;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent }: CoffeeListProps) {
  const { width: screenWidth } = useWindowDimensions();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = coffees.slice(0, visibleCount);

  const availableWidth = screenWidth - GRID_PAD * 2;
  const numCols = Math.max(1, Math.floor((availableWidth + GAP) / (MIN_CARD_W + GAP)));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  // Auto-load more when scrolling near the bottom
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
  emptyTitle: { fontFamily: fonts.displaySemiBold, fontSize: 20, marginBottom: 8, color: colors.textPrimary },
  emptySubtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary },
});
