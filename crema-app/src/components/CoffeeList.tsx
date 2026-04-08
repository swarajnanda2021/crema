import { useState, useCallback } from "react";
import { FlatList, View, Text, useWindowDimensions, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;

interface CoffeeListProps {
  coffees: any[];
  popularity?: Record<string, number>;
  compact?: boolean;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
}

export default function CoffeeList({ coffees, popularity = {}, compact, ListHeaderComponent }: CoffeeListProps) {
  const { width } = useWindowDimensions();
  const numColumns = Math.max(1, Math.floor(width / 350));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, coffees.length));
  }, [coffees.length]);

  const visible = coffees.slice(0, visibleCount);

  if (coffees.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyEmoji}>{"☕"}</Text>
        <Text style={styles.emptyTitle}>No coffees match your filters.</Text>
        <Text style={styles.emptySubtitle}>Try broadening your search or clearing some filters.</Text>
      </View>
    );
  }

  return (
    <FlatList
      key={numColumns}
      data={visible}
      numColumns={numColumns}
      keyExtractor={(item) => item.product_id}
      ListHeaderComponent={ListHeaderComponent}
      renderItem={({ item }) => (
        <View style={{ flex: 1, alignItems: "center", padding: 8 }}>
          <CoffeeCard coffee={item} userCount={popularity[item.product_id]} compact={compact} />
        </View>
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 100 }}
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 80,
    paddingHorizontal: 16,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
