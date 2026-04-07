import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { MapPin, Coffee, Settings, Pencil } from "lucide-react-native";
import { colors } from "../theme/colors";

interface Props {
  user: any;
  coffeeCount?: number;
  isOwner?: boolean;
  onEdit?: () => void;
}

export default function ProfileCard({ user, coffeeCount = 0, isOwner, onEdit }: Props) {
  const since = user.created_at ? new Date(user.created_at) : null;
  const sinceStr = since
    ? `${since.toLocaleString("default", { month: "short" })} '${String(since.getFullYear()).slice(2)}`
    : "";

  return (
    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
      {/* Avatar background */}
      <View style={{ height: 140, backgroundColor: colors.cardBack }}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-4xl font-bold" style={{ color: colors.textOnDark }}>
              {(user.display_name || "?")[0]}
            </Text>
          </View>
        )}
        {/* Edit button */}
        {isOwner && onEdit && (
          <Pressable onPress={onEdit} className="absolute top-3 right-3 w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
            <Pencil size={14} color="white" />
          </Pressable>
        )}
      </View>

      {/* Bio content */}
      <View className="p-4">
        <Text className="text-lg font-bold" style={{ color: colors.textPrimary }}>
          {user.display_name}
        </Text>
        <Text className="text-sm" style={{ color: colors.textSecondary }}>
          @{user.username}
        </Text>

        {user.location && (
          <View className="flex-row items-center gap-1 mt-2">
            <MapPin size={12} color={colors.textSecondary} />
            <Text className="text-xs" style={{ color: colors.textSecondary }}>{user.location}</Text>
          </View>
        )}

        {user.bio && (
          <Text className="text-sm mt-2 leading-relaxed" style={{ color: colors.textPrimary }}>
            {user.bio}
          </Text>
        )}

        {/* Preferences */}
        <View className="flex-row flex-wrap gap-3 mt-3">
          {user.coffee_preference && (
            <View className="flex-row items-center gap-1">
              <Coffee size={12} color={colors.textSecondary} />
              <Text className="text-xs" style={{ color: colors.textSecondary }}>{user.coffee_preference}</Text>
            </View>
          )}
          {user.brewing_style && (
            <View className="flex-row items-center gap-1">
              <Settings size={12} color={colors.textSecondary} />
              <Text className="text-xs" style={{ color: colors.textSecondary }}>{user.brewing_style}</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View className="flex-row gap-4 mt-3 pt-3 border-t" style={{ borderColor: colors.border }}>
          <Text className="text-xs" style={{ color: colors.textSecondary }}>
            <Text className="font-bold" style={{ color: colors.textPrimary }}>{coffeeCount}</Text> coffees tried
          </Text>
          {sinceStr && (
            <Text className="text-xs" style={{ color: colors.textSecondary }}>
              Since {sinceStr}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
