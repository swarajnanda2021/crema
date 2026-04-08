import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MapPin, Coffee, ShoppingCart } from "lucide-react-native";
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
import Chip from "../../src/components/Chip";

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const { addToShelf } = useShelves();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
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
    return <View style={s.loadingContainer}><Text style={{ color: colors.textSecondary }}>Loading feed...</Text></View>;
  }

  return (
    <View style={s.container}>
      {/* ── 3-column layout matching main branch ── */}
      <View style={[s.outer, { maxWidth: 1400 }]}>
        <View style={s.threeCol}>
          {/* LEFT: spacer matching MyShelf profile column */}
          {isDesktop && <View style={{ width: 240 }} />}

          {/* CENTER: Temporal feed */}
          <ScrollView
            style={s.feedScroll}
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          >
            {timeline.length === 0 ? (
              <Text style={s.emptyText}>No tasting notes yet. Be the first to write one!</Text>
            ) : (
              timeline.map((item: any) => (
                <FeedCard key={item.note_id || item.note?.id} item={item} productMap={productMap} router={router} />
              ))
            )}
          </ScrollView>

          {/* RIGHT: Recommendations — sticky, independently scrollable */}
          {isDesktop && (
            <View style={s.recSidebar}>
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <RecommendationPanel
                  recommendations={recommendations}
                  onAddToShelf={addToShelf}
                />
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** Feed card — matches main branch: user header → two-column (coffee image left | note right) */
function FeedCard({ item, productMap, router }: { item: any; productMap: any; router: any }) {
  // Handle both API shapes: {note, user, product_id} and flat {note_id, user, ...}
  const note = item.note || item;
  const author = item.user || {};
  const productId = item.product_id || note.product_id;
  const coffee = productMap?.get(productId);
  const price250 = coffee ? pricePer250g(coffee.price_per_gram) : null;

  return (
    <View style={fc.card}>
      {/* User header */}
      <View style={fc.userRow}>
        <Pressable onPress={() => router.push(`/user/${author.username}`)}>
          {author.avatar_url ? (
            <Image source={{ uri: author.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
          ) : (
            <View style={fc.avatarFallback}>
              <Text style={fc.avatarLetter}>{(author.display_name || "?")[0]}</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => router.push(`/user/${author.username}`)}>
            <Text style={fc.userName}>{author.display_name}</Text>
          </Pressable>
          {author.location && (
            <View style={fc.locationRow}>
              <MapPin size={8} color={colors.textSecondary} />
              <Text style={fc.locationText}>{author.location}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Two-column: coffee image left | tasting note right */}
      {coffee && (
        <View style={fc.contentRow}>
          {/* Left: coffee card */}
          <View style={fc.coffeeCol}>
            <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)}>
              {coffee.image_url ? (
                <Image source={{ uri: coffee.image_url }} style={fc.coffeeImage} contentFit="cover" />
              ) : (
                <View style={[fc.coffeeImage, { backgroundColor: colors.tagBg, alignItems: "center", justifyContent: "center" }]}>
                  <Coffee size={20} color={colors.border} />
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)}>
              <Text style={fc.coffeeName} numberOfLines={2}>{coffee.coffee_name}</Text>
            </Pressable>
            <Text style={fc.roasterName}>{coffee.roaster_name}</Text>
            <View style={fc.chipRow}>
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
            </View>
            <Pressable
              onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "feed"); Linking.openURL(coffee.product_url); }}
              style={fc.buyLink}
            >
              <ShoppingCart size={9} color={colors.accent} />
              <Text style={{ fontSize: 10, color: colors.accent }}>Buy</Text>
            </Pressable>
          </View>

          {/* Right: tasting note */}
          <View style={fc.noteCol}>
            <TastingNoteDisplay note={note} />
          </View>
        </View>
      )}

      {/* If no coffee found, just the note */}
      {!coffee && (
        <View style={{ padding: 16 }}>
          <TastingNoteDisplay note={note} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  outer: { flex: 1, alignSelf: "center", width: "100%" as any, paddingHorizontal: 16, paddingVertical: 24 },
  threeCol: { flex: 1, flexDirection: "row", gap: 24 },
  feedScroll: { flex: 1, minWidth: 0 },
  emptyText: { textAlign: "center", paddingVertical: 64, fontSize: 14, color: colors.textSecondary },
  recSidebar: { width: 280, position: "sticky" as any, top: 72, height: "calc(100vh - 88px)" as any },
});

const fc = StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  avatarLetter: { fontSize: 12, fontWeight: "700", color: colors.tagText },
  userName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  locationText: { fontSize: 10, color: colors.textSecondary },
  // Two-column content
  contentRow: { flexDirection: "row" },
  coffeeCol: {
    width: 160,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  coffeeImage: {
    width: "100%" as any,
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  coffeeName: { fontSize: 12, fontWeight: "600", lineHeight: 16, color: colors.textPrimary },
  roasterName: { fontSize: 10, marginTop: 2, color: colors.textSecondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  buyLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  noteCol: { flex: 1, minWidth: 0, paddingHorizontal: 16, paddingBottom: 16 },
});
