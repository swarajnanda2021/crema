import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { MapPin, Calendar, Coffee, Settings, Award, PenLine } from "lucide-react-native";
import { colors, fonts, cardShadow } from "../theme/colors";

const PREF_LABELS: Record<string, string> = { light: "Light Roast", medium: "Medium Roast", dark: "Dark Roast" };
const STYLE_LABELS: Record<string, string> = { espresso: "Espresso", filter: "Filter", both: "Espresso & Filter" };

interface Props {
  user: any;
  drankCount?: number;
  coffeeCount?: number;
  isOwner?: boolean;
  onEdit?: () => void;
}

export default function ProfileCard({ user, drankCount = 0, coffeeCount, isOwner, onEdit }: Props) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const avatarHeight = isDesktop ? 320 : 280;
  const count = coffeeCount ?? drankCount;

  const initials = (user.display_name || user.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={s.card}>
      {/* Full-bleed avatar background */}
      <View style={[s.avatarBg, { height: avatarHeight }]}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.initials}>{initials}</Text>
          </View>
        )}
        {isOwner && (
          <Pressable onPress={onEdit} style={s.editBtn}>
            <PenLine size={14} color={colors.textPrimary} />
          </Pressable>
        )}
      </View>

      {/* Cream semi-opaque bio overlay */}
      <View style={s.bioOverlay}>
        <Text style={s.displayName}>{user.display_name}</Text>
        <Text style={s.username}>@{user.username}</Text>
        {user.location && (
          <View style={s.locationRow}>
            <MapPin size={11} color={colors.textSecondary} />
            <Text style={s.locationText}>{user.location}</Text>
          </View>
        )}
        {user.bio && <Text style={s.bio}>{user.bio}</Text>}
        {(user.coffee_preference || user.brewing_style) && (
          <View style={s.pillRow}>
            {user.coffee_preference && (
              <View style={s.pill}>
                <Coffee size={9} color={colors.tagText} />
                <Text style={s.pillText}>{PREF_LABELS[user.coffee_preference] || user.coffee_preference}</Text>
              </View>
            )}
            {user.brewing_style && (
              <View style={s.pill}>
                <Settings size={9} color={colors.tagText} />
                <Text style={s.pillText}>{STYLE_LABELS[user.brewing_style] || user.brewing_style}</Text>
              </View>
            )}
          </View>
        )}
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Award size={11} color={colors.accent} />
            <Text style={s.statText}><Text style={s.statBold}>{count}</Text> tried</Text>
          </View>
          <View style={s.stat}>
            <Calendar size={11} color={colors.textSecondary} />
            <Text style={s.statText}>Since {new Date(user.created_at).getFullYear()}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, overflow: "hidden", ...cardShadow },
  avatarBg: { position: "relative" },
  avatarFallback: { width: "100%" as any, height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#D4C5B8" },
  initials: { fontFamily: fonts.displayBold, fontSize: 48, color: colors.textSecondary, opacity: 0.4 },
  editBtn: { position: "absolute", top: 12, right: 12, padding: 8, borderRadius: 9999, backgroundColor: "rgba(255,255,255,0.7)" },
  bioOverlay: { padding: 16, backgroundColor: "rgba(250, 247, 242, 0.95)" },
  displayName: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.textPrimary },
  username: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textMuted },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  locationText: { fontSize: 12, color: colors.textSecondary },
  bio: { fontFamily: fonts.bodyRegular, fontSize: 14, marginTop: 8, lineHeight: 22, color: colors.textSecondary },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, backgroundColor: colors.tagBg },
  pillText: { fontSize: 10, color: colors.tagText },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 12, color: colors.textSecondary },
  statBold: { fontWeight: "700", color: colors.textPrimary },
});
