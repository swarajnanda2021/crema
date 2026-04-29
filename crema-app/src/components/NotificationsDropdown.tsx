/**
 * NotificationsDropdown — dropdown panel for notifications.
 * Same positioning and styling pattern as ProfileDropdown. Flat list
 * for every account type — Phase 1 has only consumer + roaster, and
 * the splittable business-vs-activity surface was café-shaped.
 */

import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { CroppedAvatar, openPostModal, HapticPressable } from "./primitives";
import { timeAgo } from "./primitives";
import {
  useNotifications,
  Notification,
} from "../hooks/useNotifications";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps a thread-related notification
   *  (direct_message). The caller (Navbar) opens the Messages
   *  dropdown at the right thread. */
  onOpenThread?: (kind: "direct_message", id: number) => void;
  /** Full-viewport mode for the mobile /notifications Stack screen. */
  fullScreen?: boolean;
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
  sourcing_story: "shared a sourcing story",
  direct_message: "sent you a message",
};

// target_slug format: "roaster:<slug>" — café surfaces removed.
function parseRoasterTarget(target_slug: string | null): string | null {
  if (!target_slug) return null;
  const idx = target_slug.indexOf(":");
  if (idx < 0) return null;
  if (target_slug.slice(0, idx) !== "roaster") return null;
  return target_slug.slice(idx + 1);
}

export default function NotificationsDropdown({ visible, onClose, onOpenThread, fullScreen }: Props) {
  const router = useRouter();
  const { notifications, loading, fetchNotifications, markAllRead, markRead, unreadCount } = useNotifications(true);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<any>(null);

  // Outside-click dismissal on web — mirrors MessagesDropdown so the
  // whole site stays interactive while notifications are open.
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || fullScreen) return;
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 150);
    const handler = (e: MouseEvent) => {
      if (!armed) return;
      const card = cardRef.current as any;
      const target = e.target as Node;
      if (card && typeof card.contains === "function" && card.contains(target)) return;
      const navbar = (typeof document !== "undefined")
        ? document.querySelector('[data-role="navbar"]') : null;
      if (navbar && (navbar as any).contains && (navbar as any).contains(target)) return;
      onClose();
    };
    if (typeof document !== "undefined") document.addEventListener("click", handler);
    return () => {
      clearTimeout(armTimer);
      if (typeof document !== "undefined") document.removeEventListener("click", handler);
    };
  }, [visible, onClose]);

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

  const goToProfile = (n: Notification) => {
    markRead(n.id);
    onClose();
    router.push(`/user/${n.actor_username}`);
  };

  const goToSource = (n: Notification) => {
    markRead(n.id);
    if (n.type === "direct_message" && n.direct_thread_id && onOpenThread) {
      onClose();
      onOpenThread("direct_message", n.direct_thread_id);
      return;
    }
    onClose();
    if (n.type === "follow") {
      router.push(`/user/${n.actor_username}`);
      return;
    }
    // sourcing_story carries both target_slug and post_id; the post
    // is the more useful destination so PostModal wins.
    if (n.type === "sourcing_story" && n.post_id) {
      openPostModal({ postId: n.post_id, mode: "view" });
      return;
    }
    // Catalog-change notifications → roaster profile
    const roasterSlug = parseRoasterTarget(n.target_slug);
    if (roasterSlug) {
      router.push(`/roaster/${roasterSlug}` as any);
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

  const cardFixedStyle = fullScreen
    ? { flex: 1, width: "100%" as any }
    : Platform.OS === "web"
      ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
      : { position: "absolute" as any, top: 8, right: 40, zIndex: 9999 };
  const cardOverrides = fullScreen
    ? { width: "100%" as any, maxHeight: undefined, borderRadius: 0, shadowOpacity: 0, elevation: 0, backgroundColor: t.color.bg }
    : null;

  return (
    <>
      {!visible ? null : (<>
      {/* Card */}
      <View ref={cardRef} style={[s.card, cardFixedStyle, cardOverrides]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Notifications</Text>
          <View style={s.headerActions}>
            {unreadCount > 0 && (
              <HapticPressable haptic="select" onPress={markAllRead} hitSlop={6}>
                <Text style={s.markRead}>Mark all read</Text>
              </HapticPressable>
            )}
            {fullScreen && (
              <HapticPressable
                haptic="tap"
                onPress={onClose}
                hitSlop={10}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={s.closeBtn}
              >
                <X size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
              </HapticPressable>
            )}
          </View>
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
                <HapticPressable
                  haptic="tap"
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
                </HapticPressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
      </>)}
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: t.spacing.md } as any,
  markRead: { fontFamily: t.font["body.medium"], fontSize: 12, color: "#D798DA" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
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
