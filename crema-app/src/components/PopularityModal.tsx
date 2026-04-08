import { useState, useEffect } from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { X, Coffee, Check, Star, MapPin } from "lucide-react-native";
import { colors, fonts } from "../theme/colors";
import { apiFetch } from "../api/client";
import TastingNoteDisplay from "./TastingNoteDisplay";

const SHELF_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  currently_drinking: { label: "Drinking", icon: Coffee, color: "#C8553D" },
  drank: { label: "Drank", icon: Check, color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", icon: Star, color: "#E8C07A" },
};

interface Props {
  visible: boolean;
  productId: string;
  coffeeName: string;
  onClose: () => void;
}

export default function PopularityModal({ visible, productId, coffeeName, onClose }: Props) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    apiFetch(`/products/${productId}/users`)
      .then(setData)
      .catch(() => setData({ users: [] }))
      .finally(() => setLoading(false));
  }, [visible, productId]);

  // Sort: users with notes first
  const sortedUsers = data?.users
    ? [...data.users].sort((a: any, b: any) => (b.notes?.length || 0) - (a.notes?.length || 0))
    : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation?.()}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.title} numberOfLines={1}>{coffeeName}</Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <X size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* User list — scrollable */}
          <ScrollView
            style={s.scrollArea}
            contentContainerStyle={{ padding: 20 }}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <Text style={s.emptyText}>Loading...</Text>
            ) : sortedUsers.length === 0 ? (
              <Text style={s.emptyText}>Nobody has this on their shelf yet.</Text>
            ) : (
              sortedUsers.map((u: any) => {
                const shelfMeta = SHELF_LABELS[u.shelf] || SHELF_LABELS.currently_drinking;
                const ShelfIcon = shelfMeta.icon;
                return (
                  <View key={u.username} style={s.userBlock}>
                    {/* User row */}
                    <View style={s.userRow}>
                      <Pressable onPress={() => { onClose(); router.push(`/user/${u.username}`); }}>
                        {u.avatar_url ? (
                          <Image source={{ uri: u.avatar_url }} style={s.avatar} />
                        ) : (
                          <View style={s.avatarFallback}>
                            <Text style={s.avatarLetter}>{(u.display_name || "?")[0]}</Text>
                          </View>
                        )}
                      </Pressable>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Pressable onPress={() => { onClose(); router.push(`/user/${u.username}`); }}>
                          <Text style={s.userName}>{u.display_name}</Text>
                        </Pressable>
                        <View style={s.metaRow}>
                          {u.location && (
                            <View style={s.metaItem}>
                              <MapPin size={8} color={colors.textMuted} />
                              <Text style={s.metaText}>{u.location}</Text>
                            </View>
                          )}
                          <View style={s.metaItem}>
                            <ShelfIcon size={9} color={shelfMeta.color} />
                            <Text style={[s.metaText, { color: shelfMeta.color }]}>{shelfMeta.label}</Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    {/* Their tasting notes */}
                    {u.notes && u.notes.length > 0 && (
                      <View style={s.notesArea}>
                        {u.notes.map((note: any) => (
                          <TastingNoteDisplay key={note.id} note={note} />
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 540,
    maxHeight: "70%",
    backgroundColor: colors.bg,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 32,
    elevation: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
    flex: 1,
    marginRight: 12,
  },
  closeBtn: { padding: 4 },
  scrollArea: {
    flex: 1,
    minHeight: 0,
  },
  emptyText: {
    fontFamily: fonts.bodyRegular,
    textAlign: "center",
    paddingVertical: 32,
    fontSize: 14,
    color: colors.textMuted,
  },
  userBlock: {
    marginBottom: 20,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  avatarLetter: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.tagText },
  userName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontFamily: fonts.bodyRegular, fontSize: 10, color: colors.textMuted },
  notesArea: { marginLeft: 42, marginTop: 4 },
});
