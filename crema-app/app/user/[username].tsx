import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
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
    return <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}><Text style={{ color: colors.textSecondary }}>Loading...</Text></View>;
  }

  const totalCoffees = Object.values(shelves).reduce((sum: number, entries: any) => sum + entries.length, 0);

  return (
    <>
      <Stack.Screen options={{ title: user?.display_name || username, headerTintColor: colors.accent }} />
      <ScrollView className="flex-1" style={{ backgroundColor: colors.bg }} showsVerticalScrollIndicator={false}>
        {user && <View className="px-4 pt-4"><ProfileCard user={user} coffeeCount={totalCoffees} /></View>}

        {/* Shelf tabs */}
        <View className="flex-row mx-4 mt-4 rounded-xl overflow-hidden" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
          {(Object.keys(SHELF_LABELS) as ShelfKey[]).map((key) => {
            const meta = SHELF_LABELS[key];
            const Icon = SHELF_ICONS[key];
            const count = (shelves[key] || []).length;
            const isActive = activeShelf === key;
            return (
              <Pressable key={key} onPress={() => setActiveShelf(key)} className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5" style={{ backgroundColor: isActive ? colors.accent : "transparent" }}>
                <Icon size={14} color={isActive ? "white" : meta.color} />
                <Text className="text-xs font-medium" style={{ color: isActive ? "white" : colors.textSecondary }}>{meta.label}</Text>
                <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: isActive ? "rgba(255,255,255,0.25)" : colors.tagBg }}>
                  <Text className="text-[10px] font-bold" style={{ color: isActive ? "white" : colors.tagText }}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View className="px-4 mt-4">
          {(shelves[activeShelf] || []).length === 0 ? (
            <View className="items-center py-12"><Text className="text-sm" style={{ color: colors.textSecondary }}>No coffees here yet.</Text></View>
          ) : (
            (shelves[activeShelf] as any[]).map((entry: any) => <ShelfIsland key={entry.id} entry={entry} />)
          )}
        </View>

        {recommendations.length > 0 && (
          <View className="px-4 mt-4 mb-8">
            <RecommendationPanel recommendations={recommendations} />
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );
}
