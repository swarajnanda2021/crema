import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { Coffee, Check, Star } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useRecommendations } from "../../src/hooks/useRecommendations";
import { colors, SHELF_LABELS, ShelfKey } from "../../src/theme/colors";
import ProfileCard from "../../src/components/ProfileCard";
import ShelfIsland from "../../src/components/ShelfIsland";
import RecommendationPanel from "../../src/components/RecommendationPanel";

const SHELF_ICONS: Record<string, any> = {
  currently_drinking: Coffee,
  drank: Check,
  want_to_try: Star,
};

export default function MyShelfPage() {
  const { user } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const [activeShelf, setActiveShelf] = useState<ShelfKey>("currently_drinking");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchShelves();
    fetchRecommendations("self", null, 5);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShelves();
    setRefreshing(false);
  };

  if (!user) return null;

  const totalCoffees = Object.values(shelves).reduce((sum, entries) => sum + (entries as any[]).length, 0);

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Card */}
      <View className="px-4 pt-4">
        <ProfileCard user={user} coffeeCount={totalCoffees} isOwner />
      </View>

      {/* Shelf Tabs */}
      <View className="flex-row mx-4 mt-4 rounded-xl overflow-hidden" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
        {(Object.keys(SHELF_LABELS) as ShelfKey[]).map((key) => {
          const meta = SHELF_LABELS[key];
          const Icon = SHELF_ICONS[key];
          const count = (shelves[key] || []).length;
          const isActive = activeShelf === key;
          return (
            <Pressable
              key={key}
              onPress={() => setActiveShelf(key)}
              className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5"
              style={{ backgroundColor: isActive ? colors.accent : "transparent" }}
            >
              <Icon size={14} color={isActive ? "white" : meta.color} />
              <Text className="text-xs font-medium" style={{ color: isActive ? "white" : colors.textSecondary }}>
                {meta.label}
              </Text>
              <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: isActive ? "rgba(255,255,255,0.25)" : colors.tagBg }}>
                <Text className="text-[10px] font-bold" style={{ color: isActive ? "white" : colors.tagText }}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Shelf Content */}
      <View className="px-4 mt-4">
        {(shelves[activeShelf] || []).length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-3xl mb-2">{"☕"}</Text>
            <Text className="text-sm" style={{ color: colors.textSecondary }}>No coffees in this shelf yet.</Text>
          </View>
        ) : (
          (shelves[activeShelf] as any[]).map((entry: any) => (
            <ShelfIsland
              key={entry.id}
              entry={entry}
              isOwner
              onRemove={() => removeFromShelf(entry.id)}
            />
          ))
        )}
      </View>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <View className="px-4 mt-4 mb-8">
          <RecommendationPanel
            recommendations={recommendations}
            onAddToShelf={(id) => addToShelf(id, "want_to_try")}
          />
        </View>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}
