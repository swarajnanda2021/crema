import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ShoppingCart, Plus, Coffee } from "lucide-react-native";
import { colors } from "../theme/colors";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../api/client";

interface Props {
  recommendations: any[];
  onAddToShelf?: (productId: string) => void;
}

export default function RecommendationPanel({ recommendations, onAddToShelf }: Props) {
  const router = useRouter();

  if (!recommendations || recommendations.length === 0) return null;

  return (
    <View>
      <Text style={styles.heading}>You might like</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {recommendations.map((rec: any) => (
          <MiniCard key={rec.product_id} coffee={rec} onAddToShelf={onAddToShelf} router={router} />
        ))}
      </ScrollView>
    </View>
  );
}

function MiniCard({ coffee, onAddToShelf, router }: { coffee: any; onAddToShelf?: (id: string) => void; router: any }) {
  const price250 = pricePer250g(coffee.price_per_gram);

  return (
    <Pressable
      onPress={() => router.push(`/coffee/${coffee.product_id}`)}
      style={styles.miniCard}
    >
      {/* Image */}
      <View style={{ width: 100 }}>
        {coffee.image_url ? (
          <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Coffee size={24} color={colors.border} />
          </View>
        )}
        {coffee._novel && (
          <View style={styles.novelBadge}>
            <Text style={styles.novelText}>NEW</Text>
          </View>
        )}
      </View>

      {/* Details */}
      <View style={styles.miniDetails}>
        <View>
          <Text style={styles.miniName} numberOfLines={2}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={styles.miniRoaster} numberOfLines={1}>{coffee.roaster_name}</Text>
          </Pressable>
        </View>

        <View style={styles.miniFooter}>
          <Text style={styles.miniPrice}>
            {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : ""}
          </Text>
          <View style={styles.miniActions}>
            {onAddToShelf && (
              <Pressable onPress={() => onAddToShelf(coffee.product_id)} style={styles.miniActionBtn}>
                <Plus size={14} color={colors.tagText} />
              </Pressable>
            )}
            <Pressable
              onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "recommendation"); Linking.openURL(coffee.product_url); }}
              style={[styles.miniActionBtn, { backgroundColor: colors.accent }]}
            >
              <ShoppingCart size={14} color="white" />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    paddingHorizontal: 4,
    color: colors.textPrimary,
  },
  miniCard: {
    flexDirection: "row",
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
    height: 120,
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  novelBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  novelText: {
    color: "white",
    fontSize: 8,
    fontWeight: "700",
  },
  miniDetails: {
    flex: 1,
    padding: 10,
    justifyContent: "space-between",
  },
  miniName: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  miniRoaster: {
    fontSize: 10,
    marginTop: 2,
    color: colors.accent,
  },
  miniFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  miniPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  miniActions: {
    flexDirection: "row",
    gap: 6,
  },
  miniActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
});
