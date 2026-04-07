import { useState, useCallback } from "react";
import { FlatList, View, Text, useWindowDimensions } from "react-native";
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
  const numColumns = Math.max(1, Math.floor(width / 320));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, coffees.length));
  }, [coffees.length]);

  const visible = coffees.slice(0, visibleCount);

  if (coffees.length === 0) {
    return (
      <View className="items-center py-20 px-4">
        <Text className="text-5xl mb-4">{"☕"}</Text>
        <Text className="text-xl font-semibold mb-2" style={{ color: "#1A1A1A" }}>No coffees match your filters.</Text>
        <Text className="text-sm" style={{ color: "#6B5B4F" }}>Try broadening your search or clearing some filters.</Text>
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
