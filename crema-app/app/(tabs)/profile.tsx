import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
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
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Card */}
      <View style={styles.profileWrap}>
        <ProfileCard user={user} coffeeCount={totalCoffees} isOwner />
      </View>

      {/* Shelf Tabs */}
      <View style={styles.shelfTabs}>
        {(Object.keys(SHELF_LABELS) as ShelfKey[]).map((key) => {
          const meta = SHELF_LABELS[key];
          const Icon = SHELF_ICONS[key];
          const count = (shelves[key] || []).length;
          const isActive = activeShelf === key;
          return (
            <Pressable
              key={key}
              onPress={() => setActiveShelf(key)}
              style={[styles.shelfTab, { backgroundColor: isActive ? colors.accent : "transparent" }]}
            >
              <Icon size={14} color={isActive ? "white" : meta.color} />
              <Text style={[styles.shelfTabLabel, { color: isActive ? "white" : colors.textSecondary }]}>
                {meta.label}
              </Text>
              <View style={[styles.countBadge, { backgroundColor: isActive ? "rgba(255,255,255,0.25)" : colors.tagBg }]}>
                <Text style={[styles.countBadgeText, { color: isActive ? "white" : colors.tagText }]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Shelf Content */}
      <View style={styles.shelfContent}>
        {(shelves[activeShelf] || []).length === 0 ? (
          <View style={styles.emptyShelf}>
            <Text style={styles.emptyEmoji}>{"☕"}</Text>
            <Text style={styles.emptyText}>No coffees in this shelf yet.</Text>
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
        <View style={styles.recSection}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  profileWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  shelfTabs: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shelfTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  shelfTabLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  shelfContent: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  emptyShelf: {
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyEmoji: {
    fontSize: 30,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  recSection: {
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 32,
  },
});
