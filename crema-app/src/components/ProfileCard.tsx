import { View, Text, Pressable, StyleSheet } from "react-native";
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
    <View style={styles.card}>
      {/* Avatar background */}
      <View style={styles.avatarBg}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>
              {(user.display_name || "?")[0]}
            </Text>
          </View>
        )}
        {/* Edit button */}
        {isOwner && onEdit && (
          <Pressable onPress={onEdit} style={styles.editBtn}>
            <Pencil size={14} color="white" />
          </Pressable>
        )}
      </View>

      {/* Bio content */}
      <View style={styles.body}>
        <Text style={styles.displayName}>{user.display_name}</Text>
        <Text style={styles.username}>@{user.username}</Text>

        {user.location && (
          <View style={styles.locationRow}>
            <MapPin size={12} color={colors.textSecondary} />
            <Text style={styles.locationText}>{user.location}</Text>
          </View>
        )}

        {user.bio && (
          <Text style={styles.bio}>{user.bio}</Text>
        )}

        {/* Preferences */}
        <View style={styles.prefsRow}>
          {user.coffee_preference && (
            <View style={styles.prefItem}>
              <Coffee size={12} color={colors.textSecondary} />
              <Text style={styles.prefText}>{user.coffee_preference}</Text>
            </View>
          )}
          {user.brewing_style && (
            <View style={styles.prefItem}>
              <Settings size={12} color={colors.textSecondary} />
              <Text style={styles.prefText}>{user.brewing_style}</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <Text style={styles.statLabel}>
            <Text style={styles.statValue}>{coffeeCount}</Text> coffees tried
          </Text>
          {sinceStr && (
            <Text style={styles.statLabel}>Since {sinceStr}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarBg: {
    height: 140,
    backgroundColor: colors.cardBack,
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  editBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  body: {
    padding: 16,
  },
  displayName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  username: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  locationText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  bio: {
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  prefsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  prefItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  prefText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statValue: {
    fontWeight: "700",
    color: colors.textPrimary,
  },
});
