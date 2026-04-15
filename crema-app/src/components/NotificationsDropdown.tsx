/**
 * NotificationsDropdown — dropdown panel for notifications.
 * Same positioning and styling pattern as ProfileDropdown.
 * Shows likes, comments, follows, reposts, comment likes.
 */

import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { t, cardShadow } from "../tokens/useTokens";
import { CroppedAvatar, openPostModal } from "./primitives";
import { timeAgo } from "./primitives";
import { useNotifications, Notification } from "../hooks/useNotifications";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const NOTIF_MESSAGES: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "started following you",
  repost: "reposted your post",
  comment_like: "liked your comment",
  reply: "replied to your comment",
  product_added: "added a new coffee",
  product_removed: "removed a coffee",
  menu_added: "added a menu item",
  menu_removed: "removed a menu item",
  menu_updated: "updated a menu item",
};

// target_slug format: "roaster:<slug>" or "cafe:<slug>"
function parseTarget(target_slug: string | null): { kind: string; slug: string } | null {
  if (!target_slug) return null;
  const idx = target_slug.indexOf(":");
  if (idx < 0) return null;
  return { kind: target_slug.slice(0, idx), slug: target_slug.slice(idx + 1) };
}

export default function NotificationsDropdown({ visible, onClose }: Props) {
  const router = useRouter();
  const { notifications, loading, fetchNotifications, markAllRead, markRead, unreadCount } = useNotifications(true);
  const [ready, setReady] = useState(false);

  // Fetch full list when opened
  useEffect(() => {
    if (visible) {
      fetchNotifications();
      const t = setTimeout(() => setReady(true), 50);
      return () => { clearTimeout(t); setReady(false); };
    } else {
      setReady(false);
    }
  }, [visible]);

  if (!visible) return null;

  const goToProfile = (n: Notification) => {
    markRead(n.id);
    onClose();
    router.push(`/user/${n.actor_username}`);
  };

  const goToSource = (n: Notification) => {
    markRead(n.id);
    onClose();
    if (n.type === "follow") {
      router.push(`/user/${n.actor_username}`);
      return;
    }
    // Catalog-change notifications → roaster / café profile
    const target = parseTarget(n.target_slug);
    if (target) {
      if (target.kind === "cafe") router.push(`/cafe/${target.slug}` as any);
      else router.push(`/roaster/${target.slug}` as any);
      return;
    }
    // ALL other types: open sitewide PostModal
    const mode = (n.type === "comment" || n.type === "comment_like" || n.type === "reply") ? "comment" : "view";
    openPostModal({
      postId: n.post_id || undefined,
      mode,
      highlightCommentId: n.comment_id || undefined,
    });
  };

  const cardFixedStyle = Platform.OS === "web"
    ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
    : { position: "absolute" as any, top: 8, right: 40, zIndex: 9999 };

  return (
    <>
      {/* Backdrop */}
      {ready && (
        <Pressable
          onPress={onClose}
          style={[
            s.backdrop,
            Platform.OS === "web"
              ? { position: "fixed" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }
              : { position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
          ]}
        />
      )}

      {/* Card */}
      <View style={[s.card, cardFixedStyle]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead}>
              <Text style={s.markRead}>Mark all read</Text>
            </Pressable>
          )}
        </View>

        <View style={s.divider} />

        {/* List */}
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 24 }} />
          ) : notifications.length === 0 ? (
            <Text style={s.empty}>No notifications yet</Text>
          ) : (
            notifications.map((n, idx) => (
              <View key={n.id}>
                {idx > 0 && <View style={s.itemDivider} />}
                <Pressable
                  onPress={() => goToSource(n)}
                  style={({ pressed }: any) => [
                    s.item,
                    !n.read && s.itemUnread,
                    pressed && s.itemHover,
                  ]}
                >
                  {/* Thumbnail → profile */}
                  <Pressable onPress={(e) => { e.stopPropagation(); goToProfile(n); }}>
                    {n.actor_avatar_url ? (
                      <CroppedAvatar
                        url={n.actor_avatar_url}
                        cropX={n.actor_crop_x ?? undefined}
                        cropY={n.actor_crop_y ?? undefined}
                        zoom={n.actor_zoom ?? undefined}
                        size={36}
                      />
                    ) : (
                      <View style={s.avatarFallback}>
                        <Text style={s.avatarInitial}>{(n.actor_display_name || "?")[0].toUpperCase()}</Text>
                      </View>
                    )}
                  </Pressable>
                  {/* Rest → source post */}
                  <View style={s.itemContent}>
                    <Text style={s.itemText} numberOfLines={2}>
                      <Text style={s.actorName}>{n.actor_display_name}</Text>
                      {" "}{NOTIF_MESSAGES[n.type] || n.type}
                      {n.subject ? (
                        <Text style={s.subject}>
                          {" "}— <Text style={s.subjectName}>{n.subject}</Text>
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={s.itemTime}>{timeAgo(n.created_at)}</Text>
                  </View>
                  {!n.read && <View style={s.unreadDot} />}
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>

    </>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: "transparent" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    minWidth: 320,
    maxWidth: 380,
    maxHeight: 480,
    paddingVertical: 8,
    ...cardShadow,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, color: "#351101" },
  markRead: { fontFamily: t.font["body.medium"], fontSize: 12, color: "#D798DA" },
  divider: { height: 1, backgroundColor: "#EDE8E1", marginHorizontal: 12 },
  list: { maxHeight: 400 },
  empty: { fontFamily: t.font["body.regular"], fontSize: 13, color: "#A09580", textAlign: "center", paddingVertical: 32 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  itemUnread: { backgroundColor: "rgba(215,152,218,0.06)" },
  itemHover: { backgroundColor: "rgba(215,152,218,0.12)" },
  itemContent: { flex: 1 },
  itemText: { fontFamily: t.font["body.regular"], fontSize: 13, color: "#351101", lineHeight: 18 },
  actorName: { fontFamily: t.font["body.semibold"] },
  subject: { fontFamily: t.font["body.regular"], color: "#684F44" },
  subjectName: { fontFamily: t.font["body.medium"], color: "#351101" },
  itemTime: { fontFamily: t.font["body.regular"], fontSize: 11, color: "#A09580", marginTop: 2 },
  itemDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginHorizontal: 16 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D798DA" },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#351101", alignItems: "center", justifyContent: "center",
  } as any,
  avatarInitial: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#FAF8F0" },
});
