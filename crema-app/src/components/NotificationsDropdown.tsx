/**
 * NotificationsDropdown — dropdown panel for notifications.
 * Same positioning and styling pattern as ProfileDropdown.
 * Shows likes, comments, follows, reposts, comment likes.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator, Modal, Animated } from "react-native";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { fonts, cardShadow } from "../theme/colors";
import { apiFetch } from "../api/client";
import { CroppedAvatar } from "./PostFeedCard";
import PostFeedCard, { timeAgo } from "./PostFeedCard";
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
};

export default function NotificationsDropdown({ visible, onClose }: Props) {
  const router = useRouter();
  const { notifications, loading, fetchNotifications, markAllRead, markRead, unreadCount } = useNotifications(true);
  const [ready, setReady] = useState(false);
  const [previewPost, setPreviewPost] = useState<any>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

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

  if (!visible && !previewPost) return null;

  const goToProfile = (n: Notification) => {
    markRead(n.id);
    onClose();
    router.push(`/user/${n.actor_username}`);
  };

  const goToSource = async (n: Notification) => {
    markRead(n.id);
    if (n.type === "follow") {
      onClose();
      router.push(`/user/${n.actor_username}`);
      return;
    }
    if (!n.post_id) {
      onClose();
      router.push(`/user/${n.actor_username}`);
      return;
    }
    // Fetch the post and show in a floating modal
    try {
      const data = await apiFetch(`/posts-timeline?limit=100`);
      const items = data.items || data.posts || [];
      const post = items.find((p: any) => p.id === n.post_id);
      if (post) {
        setPreviewPost(post);
        onClose();
        // Flash animation after a tick to let modal mount
        setTimeout(() => {
          flashAnim.setValue(1);
          Animated.timing(flashAnim, { toValue: 0, duration: 1500, useNativeDriver: false }).start();
        }, 100);
      } else {
        onClose();
        router.push(`/user/${n.actor_username}`);
      }
    } catch {
      onClose();
      router.push(`/user/${n.actor_username}`);
    }
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

      {/* Post preview modal — shown when clicking a notification */}
      {previewPost && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPreviewPost(null)}>
          <Pressable style={s.postModalOverlay} onPress={() => setPreviewPost(null)}>
            <Pressable style={s.postModalCard} onPress={(e) => e.stopPropagation()}>
              <View style={s.postModalHeader}>
                <Text style={s.postModalTitle}>Post</Text>
                <Pressable onPress={() => setPreviewPost(null)} hitSlop={8}>
                  <X size={18} color="#351101" />
                </Pressable>
              </View>
              <Animated.View style={{
                backgroundColor: flashAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["rgba(215,152,218,0)", "rgba(215,152,218,0.2)"],
                }),
                borderRadius: 8,
              }}>
                <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                  <PostFeedCard post={previewPost} />
                </ScrollView>
              </Animated.View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
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
  headerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },
  markRead: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#D798DA" },
  divider: { height: 1, backgroundColor: "#EDE8E1", marginHorizontal: 12 },
  list: { maxHeight: 400 },
  empty: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#A09580", textAlign: "center", paddingVertical: 32 },
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
  itemText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101", lineHeight: 18 },
  actorName: { fontFamily: fonts.bodySemiBold },
  itemTime: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#A09580", marginTop: 2 },
  itemDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginHorizontal: 16 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D798DA" },
  // Post preview modal
  postModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(104,79,68,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  postModalCard: {
    width: "90%",
    maxWidth: 620,
    backgroundColor: "#FAF8F0",
    borderRadius: 12,
    overflow: "hidden",
    padding: 16,
  } as any,
  postModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  postModalTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101" },

  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#351101", alignItems: "center", justifyContent: "center",
  } as any,
  avatarInitial: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#FAF8F0" },
});
