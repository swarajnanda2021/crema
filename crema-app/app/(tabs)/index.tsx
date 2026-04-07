import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MapPin, ShoppingCart } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRecommendations } from "../../src/hooks/useRecommendations";
import { apiFetch, trackClick } from "../../src/api/client";
import { colors } from "../../src/theme/colors";
import { pricePer250g } from "../../src/utils/formatPrice";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";
import RecommendationPanel from "../../src/components/RecommendationPanel";
import { useShelves } from "../../src/hooks/useShelves";

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const { addToShelf } = useShelves();
  const router = useRouter();
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTimeline = async () => {
    try {
      const data = await apiFetch("/feed/timeline");
      setTimeline(data.timeline || []);
    } catch { setTimeline([]); }
  };

  useEffect(() => { if (user) fetchRecommendations("community", null, 10); }, [user]);
  useEffect(() => { loadTimeline().finally(() => setLoading(false)); }, []);

  const onRefresh = async () => { setRefreshing(true); await loadTimeline(); setRefreshing(false); };

  if (loading) {
    return <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}><Text style={{ color: colors.textSecondary }}>Loading feed...</Text></View>;
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <FlatList
        data={timeline}
        keyExtractor={(item) => `${item.note_id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListHeaderComponent={recommendations.length > 0 ? (
          <View className="px-4 pt-4 pb-2"><RecommendationPanel recommendations={recommendations.slice(0, 5)} onAddToShelf={(id) => addToShelf(id, "want_to_try")} /></View>
        ) : null}
        renderItem={({ item }) => <FeedCard item={item} productMap={productMap} router={router} />}
        ListEmptyComponent={<View className="items-center py-20"><Text className="text-4xl mb-4">{"☕"}</Text><Text className="text-lg font-semibold" style={{ color: colors.textPrimary }}>No notes yet</Text></View>}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function FeedCard({ item, productMap, router }: { item: any; productMap: any; router: any }) {
  const coffee = productMap?.get(item.product_id);
  const price250 = coffee ? pricePer250g(coffee.price_per_gram) : null;

  return (
    <View className="mx-4 my-2 rounded-2xl overflow-hidden" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
      {/* User row */}
      <View className="flex-row items-center gap-2.5 p-3 border-b" style={{ borderColor: colors.border }}>
        <Pressable onPress={() => router.push(`/user/${item.user?.username}`)}>
          {item.user?.avatar_url ? (
            <Image source={{ uri: item.user.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
          ) : (
            <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
              <Text className="text-sm font-bold" style={{ color: colors.tagText }}>{(item.user?.display_name || "?")[0]}</Text>
            </View>
          )}
        </Pressable>
        <View className="flex-1">
          <Text className="text-sm font-semibold" style={{ color: colors.textPrimary }}>{item.user?.display_name}</Text>
          {item.user?.location && <View className="flex-row items-center gap-0.5"><MapPin size={10} color={colors.textSecondary} /><Text className="text-[10px]" style={{ color: colors.textSecondary }}>{item.user.location}</Text></View>}
        </View>
      </View>

      {/* Coffee */}
      <Pressable onPress={() => router.push(`/coffee/${item.product_id}`)} className="flex-row p-3 gap-3">
        {(coffee?.image_url || item.image_url) && <Image source={{ uri: coffee?.image_url || item.image_url }} style={{ width: 60, height: 60, borderRadius: 8 }} contentFit="cover" />}
        <View className="flex-1">
          <Text className="text-base font-semibold" numberOfLines={1} style={{ color: colors.textPrimary }}>{item.coffee_name || coffee?.coffee_name}</Text>
          <Text className="text-xs" style={{ color: colors.textSecondary }}>{item.roaster_name || coffee?.roaster_name}</Text>
          {price250 != null && <Text className="text-sm font-bold mt-1" style={{ color: colors.textPrimary }}>{`\u20B9${price250.toLocaleString("en-IN")}`}<Text className="text-xs font-normal opacity-60"> / 250g</Text></Text>}
        </View>
        {coffee?.product_url && (
          <Pressable onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "feed"); Linking.openURL(coffee.product_url); }} className="w-9 h-9 rounded-full items-center justify-center self-center" style={{ backgroundColor: colors.accent }}>
            <ShoppingCart size={16} color="white" />
          </Pressable>
        )}
      </Pressable>

      {/* Note */}
      <View className="px-3 pb-3"><TastingNoteDisplay note={item} /></View>
    </View>
  );
}
