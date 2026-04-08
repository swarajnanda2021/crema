import { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { colors, fonts } from "../theme/colors";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent }: CoffeeListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = coffees.slice(0, visibleCount);
  const hasMore = visibleCount < coffees.length;

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
      <View style={s.grid}>
        {visible.map((item) => {
          try {
            return (
              <View key={item.product_id} style={s.cardSlot}>
                <CoffeeCard
                  coffee={item}
                  userCount={popularity[item.product_id]}
                  compact={compact}
                />
              </View>
            );
          } catch (e: any) {
            // Render a fallback if CoffeeCard crashes
            return (
              <View key={item.product_id} style={s.errorCard}>
                <Text style={{ color: "red", fontSize: 10 }}>Error: {e.message}</Text>
                <Text style={{ fontSize: 12 }}>{item.coffee_name}</Text>
              </View>
            );
          }
        })}
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
    paddingHorizontal: 8,
    gap: 12,
  },
  cardSlot: {
    width: 250,
    height: 340,
  },
  errorCard: {
    width: 320,
    height: 400,
    backgroundColor: "#ffe0e0",
    borderRadius: 8,
    padding: 12,
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
