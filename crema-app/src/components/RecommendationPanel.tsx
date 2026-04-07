import { View, Text, Pressable, ScrollView } from "react-native";
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
      <Text className="text-sm font-semibold mb-3 px-1" style={{ color: colors.textPrimary }}>
        You might like
      </Text>
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
      className="flex-row rounded-xl mb-2 overflow-hidden"
      style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border, height: 120 }}
    >
      {/* Image */}
      <View style={{ width: 100 }}>
        {coffee.image_url ? (
          <Image source={{ uri: coffee.image_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
            <Coffee size={24} color={colors.border} />
          </View>
        )}
        {coffee._novel && (
          <View className="absolute top-1 left-1 px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.accent }}>
            <Text style={{ color: "white", fontSize: 8, fontWeight: "700" }}>NEW</Text>
          </View>
        )}
      </View>

      {/* Details */}
      <View className="flex-1 p-2.5 justify-between">
        <View>
          <Text className="text-xs font-semibold" numberOfLines={2} style={{ color: colors.textPrimary }}>
            {coffee.coffee_name}
          </Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text className="text-[10px] mt-0.5" numberOfLines={1} style={{ color: colors.accent }}>
              {coffee.roaster_name}
            </Text>
          </Pressable>
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-bold" style={{ color: colors.textPrimary }}>
            {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : ""}
          </Text>
          <View className="flex-row gap-1.5">
            {onAddToShelf && (
              <Pressable onPress={() => onAddToShelf(coffee.product_id)} className="w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
                <Plus size={14} color={colors.tagText} />
              </Pressable>
            )}
            <Pressable
              onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "recommendation"); Linking.openURL(coffee.product_url); }}
              className="w-7 h-7 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.accent }}
            >
              <ShoppingCart size={14} color="white" />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
