import { useState, useEffect } from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { X, MapPin } from "lucide-react-native";
import { t } from "../tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import PostCard from "./domain/PostCard";
import { openPostModal } from "./primitives";
import type { Post } from "../resources/types";

interface Props {
  visible: boolean;
  productId: string;
  coffeeName: string;
  onClose: () => void;
}

export default function PopularityModal({ visible, productId, coffeeName, onClose }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetchRaw<any>(`/products/${productId}/users`).catch(() => ({ data: { users: [] } })),
      apiFetchRaw<any>(`/products/${productId}/posts`).catch(() => ({ data: [] })),
    ]).then(([uRes, pRes]) => {
      if (cancelled) return;
      const uData = uRes?.data ?? uRes;
      const pData = pRes?.data ?? pRes;
      setUsers(uData?.users || []);
      setPosts(Array.isArray(pData) ? pData : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, productId]);

  // Dedupe users-without-notes against the people who posted — if
  // they appear in both, the PostCard already represents them, so the
  // "also on shelf" list only mentions the rest. Matched by username
  // via author, which the post carries through the registry's join.
  const writerUsernames = new Set(posts.map((p) => p.author?.username).filter(Boolean));
  const silentShelvers = users.filter((u) => !writerUsernames.has(u.username));

  const count = users.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          {/* Header — count now lives here (moved off the CoffeeCard
             social dot which became number-free). */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{coffeeName}</Text>
              {!loading && (
                <Text style={s.subtitle}>
                  {count === 0 ? "On nobody's shelf yet" : count === 1 ? "On 1 person's shelf" : `On ${count} people's shelves`}
                </Text>
              )}
            </View>
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8}>
              <X size={18} color={t.color["text.secondary"]} />
            </Pressable>
          </View>

          {/* Body. Tasting-note posts render through the shared
             `PostCard` so the card shows the same header + tasting
             note + action bar language as the rest of the site (feed,
             roaster profile, user profile). Silent shelvers get a
             compact avatar row at the bottom — they shelved the bean
             but didn't write, so there's no post to surface. */}
          <ScrollView
            style={s.scrollArea}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <Text style={s.emptyText}>Loading...</Text>
            ) : (
              <>
                {posts.map((post, idx) => (
                  <View key={post.id}>
                    <PostCard
                      post={post}
                      user={user}
                      isOwner={user?.id === post.user_id}
                      onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                      onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                      onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                    />
                    {idx < posts.length - 1 && <View style={s.divider} />}
                  </View>
                ))}

                {silentShelvers.length > 0 && (
                  <>
                    {posts.length > 0 && <View style={s.sectionGap} />}
                    <Text style={s.sectionLabel}>Also on shelf</Text>
                    {silentShelvers.map((u) => (
                      <Pressable
                        key={u.username}
                        onPress={() => { onClose(); router.push(`/user/${u.username}`); }}
                        style={s.silentRow}
                      >
                        {u.avatar_url ? (
                          <Image source={{ uri: resolveUploadUrl(u.avatar_url) }} style={s.silentAvatar} />
                        ) : (
                          <View style={s.silentAvatarFallback}>
                            <Text style={s.silentAvatarLetter}>{(u.display_name || "?")[0]}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.silentName}>{u.display_name}</Text>
                          {u.location && (
                            <View style={s.silentMeta}>
                              <MapPin size={9} color={t.color["text.muted"]} />
                              <Text style={s.silentLocation}>{u.location}</Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                    ))}
                  </>
                )}

                {posts.length === 0 && silentShelvers.length === 0 && (
                  <Text style={s.emptyText}>Nobody has this on their shelf yet.</Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Overlay + card shell match the site's new floating-modal language
// (feed composer, roaster/café composer): blurred backdrop on web,
// token overlay color, 680px max card width, 85% max height, token
// radius. Content inside leans on the shared `PostCard` so tasting
// notes on-shelf render identically to tasting notes in the feed.
const s = StyleSheet.create({
  overlayWrap: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any) : {}),
  } as any,
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  card: {
    width: "90%", maxWidth: 680, backgroundColor: t.color.bg,
    borderRadius: t.radius.lg, overflow: "hidden", maxHeight: "85%", zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 20,
    color: t.color["text.primary"],
    lineHeight: 26,
  },
  subtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.muted"],
    marginTop: 2,
  },
  closeBtn: { padding: 4, marginLeft: 12 },
  scrollArea: { flex: 1, minHeight: 0 },
  scrollContent: { paddingVertical: 8 },
  divider: { height: 1, backgroundColor: t.color.divider, marginVertical: 4 },
  sectionGap: { height: 12 },
  sectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.muted"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  } as any,
  silentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  silentAvatar: { width: 32, height: 32, borderRadius: 16 },
  silentAvatarFallback: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: t.color["tag.bg"],
  },
  silentAvatarLetter: { fontFamily: t.font["body.bold"], fontSize: 12, color: t.color["tag.text"] },
  silentName: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  silentMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  silentLocation: { fontFamily: t.font["body.regular"], fontSize: 10, color: t.color["text.muted"] },
  emptyText: {
    fontFamily: t.font["body.regular"],
    textAlign: "center",
    paddingVertical: 32,
    fontSize: 14,
    color: t.color["text.muted"],
  },
});
