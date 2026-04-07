import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl, StyleSheet } from "react-native";
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
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ color: colors.textSecondary }}>Loading feed...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={timeline}
        keyExtractor={(item) => `${item.note_id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListHeaderComponent={recommendations.length > 0 ? (
          <View style={styles.recHeader}>
            <RecommendationPanel recommendations={recommendations.slice(0, 5)} onAddToShelf={(id) => addToShelf(id, "want_to_try")} />
          </View>
        ) : null}
        renderItem={({ item }) => <FeedCard item={item} productMap={productMap} router={router} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>{"☕"}</Text>
            <Text style={styles.emptyTitle}>No notes yet</Text>
          </View>
        }
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
    <View style={feedStyles.card}>
      {/* User row */}
      <View style={feedStyles.userRow}>
        <Pressable onPress={() => router.push(`/user/${item.user?.username}`)}>
          {item.user?.avatar_url ? (
            <Image source={{ uri: item.user.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
          ) : (
            <View style={feedStyles.avatarFallback}>
              <Text style={feedStyles.avatarLetter}>{(item.user?.display_name || "?")[0]}</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={feedStyles.userName}>{item.user?.display_name}</Text>
          {item.user?.location && (
            <View style={feedStyles.locationRow}>
              <MapPin size={10} color={colors.textSecondary} />
              <Text style={feedStyles.locationText}>{item.user.location}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Coffee */}
      <Pressable onPress={() => router.push(`/coffee/${item.product_id}`)} style={feedStyles.coffeeRow}>
        {(coffee?.image_url || item.image_url) && (
          <Image source={{ uri: coffee?.image_url || item.image_url }} style={{ width: 60, height: 60, borderRadius: 8 }} contentFit="cover" />
        )}
        <View style={{ flex: 1 }}>
          <Text style={feedStyles.coffeeName} numberOfLines={1}>{item.coffee_name || coffee?.coffee_name}</Text>
          <Text style={feedStyles.roasterName}>{item.roaster_name || coffee?.roaster_name}</Text>
          {price250 != null && (
            <Text style={feedStyles.price}>
              {`\u20B9${price250.toLocaleString("en-IN")}`}
              <Text style={feedStyles.priceUnit}> / 250g</Text>
            </Text>
          )}
        </View>
        {coffee?.product_url && (
          <Pressable
            onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "feed"); Linking.openURL(coffee.product_url); }}
            style={feedStyles.buyBtn}
          >
            <ShoppingCart size={16} color="white" />
          </Pressable>
        )}
      </Pressable>

      {/* Note */}
      <View style={feedStyles.noteSection}>
        <TastingNoteDisplay note={item} />
      </View>
    </View>
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
  recHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 80,
  },
  emptyEmoji: {
    fontSize: 32,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});

const feedStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  avatarLetter: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.tagText,
  },
  userName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  locationText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  coffeeRow: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  coffeeName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  roasterName: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  price: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
    color: colors.textPrimary,
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.6,
  },
  buyBtn: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: colors.accent,
  },
  noteSection: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});
