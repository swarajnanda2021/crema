import { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { colors, fonts } from "../theme/colors";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;
const GAP = 8;
const MIN_CARD_W = 200;  // minimum card width before dropping a column
const CARD_ASPECT = 1.36; // height / width ratio (e.g., 272 / 200)
const GRID_PAD = 8;       // horizontal padding on the grid

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
  const hasMore = visibleCount < coffees.length;

  // Calculate how many columns fit, and what width each card gets
  // Available width = screen minus grid padding on both sides
  const availableWidth = screenWidth - GRID_PAD * 2;
  const numCols = Math.max(1, Math.floor((availableWidth + GAP) / (MIN_CARD_W + GAP)));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

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
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
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
      {hasMore && (
        <Pressable onPress={() => setVisibleCount(prev => Math.min(prev + PAGE_SIZE, coffees.length))} style={s.loadMoreBtn}>
          <Text style={s.loadMoreText}>Show more ({coffees.length - visibleCount} remaining)</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  loadMoreBtn: {
    alignSelf: "center",
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.tagBg,
  },
  loadMoreText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.tagText },
  emptyContainer: { alignItems: "center", paddingVertical: 80, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontFamily: fonts.displaySemiBold, fontSize: 20, marginBottom: 8, color: colors.textPrimary },
  emptySubtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary },
});
