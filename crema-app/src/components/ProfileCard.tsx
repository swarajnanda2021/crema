import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { MapPin, Calendar, Coffee, Settings, PenLine } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { resolveUploadUrl } from "../api/client";

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
  const avatarHeight = isDesktop ? 240 : 200;
  const count = coffeeCount ?? drankCount;

  const initials = (user.display_name || user.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={s.card}>
      {/* Avatar area */}
      <View style={[s.avatarArea, { height: avatarHeight }]}>
        {user.avatar_url ? (
          <Image source={{ uri: resolveUploadUrl(user.avatar_url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.initials}>{initials}</Text>
          </View>
        )}
        {isOwner && (
          <Pressable onPress={onEdit} style={s.editBtn}>
            <PenLine size={14} color={t.color["text.primary"]} />
          </Pressable>
        )}
      </View>

      {/* Info section — matches card info design */}
      <View style={s.infoSection}>
        <Text style={s.displayName}>{user.display_name}</Text>
        <Text style={s.username}>@{user.username}</Text>

        {user.location && (
          <View style={s.locationRow}>
            <MapPin size={11} color={t.color["text.secondary"]} />
            <Text style={s.locationText}>{user.location}</Text>
          </View>
        )}

        {user.bio && <Text style={s.bio}>{user.bio}</Text>}

        {(user.coffee_preference || user.brewing_style) && (
          <>
            <View style={s.divider} />
            <View style={s.pillRow}>
              {user.coffee_preference && (
                <View style={s.pill}>
                  <Coffee size={10} color={t.color["text.secondary"]} />
                  <Text style={s.pillText}>{PREF_LABELS[user.coffee_preference] || user.coffee_preference}</Text>
                </View>
              )}
              {user.brewing_style && (
                <View style={s.pill}>
                  <Settings size={10} color={t.color["text.secondary"]} />
                  <Text style={s.pillText}>{STYLE_LABELS[user.brewing_style] || user.brewing_style}</Text>
                </View>
              )}
            </View>
          </>
        )}

        <View style={s.divider} />
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statNumber}>{count}</Text>
            <Text style={s.statLabel}>tried</Text>
          </View>
          <View style={s.stat}>
            <Calendar size={12} color={t.color["text.muted"]} />
            <Text style={s.statLabel}>Since {new Date(user.created_at).getFullYear()}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderTopLeftRadius: 3.6,
    borderTopRightRadius: 3.6,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: t.color["card.info"],
    ...cardShadow,
  },
  avatarArea: {
    borderTopLeftRadius: 3.6,
    borderTopRightRadius: 3.6,
    overflow: "hidden",
    position: "relative",
  },
  avatarFallback: {
    width: "100%" as any,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D4C5B8",
  },
  initials: { fontFamily: t.font["body.bold"], fontSize: 48, color: t.color["text.secondary"], opacity: 0.4 },
  editBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 8,
    borderRadius: 9999,
    backgroundColor: "rgba(255,255,255,0.85)",
  },

  infoSection: {
    padding: 16,
  },
  displayName: {
    fontFamily: t.font["body.semibold"],
    fontSize: 18,
    color: t.color["text.primary"],
  },
  username: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.muted"],
    marginTop: 2,
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  locationText: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"] },
  bio: { fontFamily: t.font["body.regular"], fontSize: 13, marginTop: 8, lineHeight: 20, color: t.color["text.secondary"] },

  divider: { height: 1, backgroundColor: t.color.divider, marginVertical: 10 },

  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  pillText: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.secondary"] },

  statsRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statNumber: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  statLabel: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"] },
});
