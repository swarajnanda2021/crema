import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet, useWindowDimensions } from "react-native";
import { Coffee, Check, Star, Plus } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useRecommendations } from "../../src/hooks/useRecommendations";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { colors, SHELF_LABELS, ShelfKey } from "../../src/theme/colors";
import ProfileCard from "../../src/components/ProfileCard";
import ShelfIsland from "../../src/components/ShelfIsland";
import RecommendationPanel from "../../src/components/RecommendationPanel";

const SHELVES: { key: ShelfKey; label: string; icon: any; color: string }[] = [
  { key: "currently_drinking", label: "Drinking", icon: Coffee, color: "#C8553D" },
  { key: "drank", label: "Drank", icon: Check, color: "#6B5B4F" },
  { key: "want_to_try", label: "Want to Try", icon: Star, color: "#E8C07A" },
];

export default function MyShelfPage() {
  const { user } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const [activeShelf, setActiveShelf] = useState<ShelfKey>("currently_drinking");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) { fetchShelves(); fetchRecommendations("self"); }
  }, [user]);

  const onRefresh = async () => { setRefreshing(true); await fetchShelves(); setRefreshing(false); };

  if (!user) return null;

  const drankCount = (shelves.drank || []).length;

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.outer, { maxWidth: 1400 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={s.threeCol}>
          {/* LEFT: Profile — sticky on desktop */}
          <View style={isDesktop ? s.profileColDesktop : s.profileColMobile}>
            <View style={isDesktop ? { position: "sticky" as any, top: 72 } : undefined}>
              <ProfileCard user={user} drankCount={drankCount} />
            </View>
          </View>

          {/* CENTER: Shelf island card with tabs */}
          <View style={s.centerCol}>
            <View style={s.shelfCard}>
              {/* Three shelf tabs as grid */}
              <View style={s.tabGrid}>
                {SHELVES.map(({ key, label, icon: Icon, color }, i) => {
                  const count = (shelves[key] || []).length;
                  const isActive = activeShelf === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setActiveShelf(key)}
                      style={[
                        s.tabCell,
                        {
                          backgroundColor: isActive ? colors.cardFront : colors.tagBg,
                          borderBottomColor: isActive ? color : colors.border,
                          borderRightWidth: i < 2 ? 1 : 0,
                          borderRightColor: colors.border,
                        },
                      ]}
                    >
                      <Icon size={13} color={isActive ? color : colors.textSecondary} />
                      <Text style={[s.tabLabel, { color: isActive ? color : colors.textPrimary }]}>{label}</Text>
                      <Text style={[s.tabCount, { color: isActive ? color : colors.textSecondary }]}>{count}</Text>
                      <Pressable style={[s.tabPlus, { backgroundColor: `${color}20` }]}>
                        <Plus size={9} color={color} />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </View>

              {/* Shelf content */}
              <View style={{ padding: 16 }}>
                {(shelves[activeShelf] || []).length === 0 ? (
                  <Text style={s.emptyText}>No coffees here yet. Tap + above to add some.</Text>
                ) : (
                  (shelves[activeShelf] as any[]).map((entry: any) => {
                    const coffee = productMap?.get(entry.product_id);
                    if (!coffee) return null;
                    return (
                      <ShelfIsland
                        key={entry.id}
                        entry={entry}
                        coffee={coffee}
                        isOwner
                        currentShelf={activeShelf}
                        onRemove={() => removeFromShelf(entry.id)}
                        onMove={(pid: string, shelf: string) => addToShelf(pid, shelf)}
                      />
                    );
                  })
                )}
              </View>
            </View>
          </View>

          {/* RIGHT: Recommendations — sticky on desktop */}
          {isDesktop && (
            <View style={s.recColDesktop}>
              <View style={{ position: "sticky" as any, top: 72 }}>
                <RecommendationPanel
                  recommendations={recommendations}
                  onAddToShelf={addToShelf}
                />
              </View>
            </View>
          )}
        </View>

        {/* Mobile recommendations */}
        {!isDesktop && recommendations.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <RecommendationPanel recommendations={recommendations} onAddToShelf={addToShelf} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  outer: { alignSelf: "center" as any, width: "100%" as any, paddingHorizontal: 16, paddingVertical: 24 },
  threeCol: { flexDirection: "row", gap: 24 },
  profileColDesktop: { width: 240 },
  profileColMobile: { marginBottom: 24 },
  centerCol: { flex: 1, minWidth: 0 },
  recColDesktop: { width: 280 },
  shelfCard: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabGrid: { flexDirection: "row" },
  tabCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 2,
  },
  tabLabel: { fontSize: 12, fontWeight: "600" },
  tabCount: { fontSize: 12, fontWeight: "700" },
  tabPlus: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 14, textAlign: "center", paddingVertical: 12, color: colors.textSecondary },
});
