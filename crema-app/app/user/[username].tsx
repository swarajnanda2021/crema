import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Coffee, Check, Star } from "lucide-react-native";
import { apiFetch } from "../../src/api/client";
import { useShelves } from "../../src/hooks/useShelves";
import { useRecommendations } from "../../src/hooks/useRecommendations";
import { colors, SHELF_LABELS, ShelfKey } from "../../src/theme/colors";
import ProfileCard from "../../src/components/ProfileCard";
import ShelfIsland from "../../src/components/ShelfIsland";
import RecommendationPanel from "../../src/components/RecommendationPanel";

const SHELF_ICONS: Record<string, any> = { currently_drinking: Coffee, drank: Check, want_to_try: Star };

export default function UserProfilePage() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { fetchUserShelves } = useShelves();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const [user, setUser] = useState<any>(null);
  const [shelves, setShelves] = useState<any>({ currently_drinking: [], drank: [], want_to_try: [] });
  const [activeShelf, setActiveShelf] = useState<ShelfKey>("currently_drinking");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [userData, shelfData] = await Promise.all([
          apiFetch(`/auth/users/${username}`).catch(() => null),
          fetchUserShelves(username!),
        ]);
        if (userData) setUser(userData);
        setShelves(shelfData || { currently_drinking: [], drank: [], want_to_try: [] });
        fetchRecommendations("user", username, 5);
      } catch {} finally { setLoading(false); }
    })();
  }, [username]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ color: colors.textSecondary }}>Loading...</Text>
      </View>
    );
  }

  const totalCoffees = Object.values(shelves).reduce((sum: number, entries: any) => sum + entries.length, 0);

  return (
    <>
      <Stack.Screen options={{ title: user?.display_name || username, headerTintColor: colors.accent }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {user && (
          <View style={styles.profileWrap}>
            <ProfileCard user={user} coffeeCount={totalCoffees} />
          </View>
        )}

        {/* Shelf tabs */}
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

        <View style={styles.shelfContent}>
          {(shelves[activeShelf] || []).length === 0 ? (
            <View style={styles.emptyShelf}>
              <Text style={styles.emptyText}>No coffees here yet.</Text>
            </View>
          ) : (
            (shelves[activeShelf] as any[]).map((entry: any) => (
              <ShelfIsland key={entry.id || entry.product_id} entry={entry} coffee={entry.coffee || entry} />
            ))
          )}
        </View>

        {recommendations.length > 0 && (
          <View style={styles.recSection}>
            <RecommendationPanel recommendations={recommendations} />
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
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
