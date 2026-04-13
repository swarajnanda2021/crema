/**
 * Home Feed — combined timeline of tasting notes + roaster posts.
 * Pulls from /api/posts-timeline (newest first, mixed types).
 *
 * Card types:
 *   - "tasting_note"  → TastingNoteCard  (existing design)
 *   - "roaster_post"  → RoasterPostCard  (new Figma design: avatar, title, cover, teaser)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView,
  RefreshControl, StyleSheet, Animated, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  MapPin, Send, Plus, X,
} from "lucide-react-native";

import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useSocial } from "../../src/hooks/useSocial";
import { apiFetch, resolveUploadUrl } from "../../src/api/client";
import { colors, fonts, cardShadow } from "../../src/theme/colors";
import { HeartOutlineIcon, HeartFilledOutlineIcon, CommentBubbleIcon, ShareNodesIcon } from "../../src/components/icons/FigmaIcons";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";
import CoffeeCard from "../../src/components/CoffeeCard";
import PostGallery from "../../src/components/PostGallery";
import ComposePost from "../../src/components/ComposePost";
import PostFeedCard, { openPostModal } from "../../src/components/PostFeedCard";

// ── Feed page ─────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const social = useSocial();
  const router = useRouter();
  const FEED_PER_PAGE = 5;
  const [items, setItems] = useState<any[]>([]);
  const [visibleFeedCount, setVisibleFeedCount] = useState(5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // ALL hooks must be declared before any early returns
  const [showRoasterCompose, setShowRoasterCompose] = useState(false);

  const isRoaster = user?.account_type === "roaster";

  const loadFeed = useCallback(async () => {
    try {
      const data = await apiFetch("/posts-timeline?limit=40");
      const feedItems = data.items || [];
      for (const item of feedItems) {
        if (item.type === "tasting_note") {
          social.setInitialLikeState(item.id, item.liked_by_me || false, item.like_count || 0);
        }
      }
      setItems(feedItems);
    } catch {
      try {
        const data = await apiFetch("/feed/timeline");
        const timeline = (data.timeline || []).map((item: any) => ({
          ...item,
          type: "tasting_note",
          id: item.note?.id,
          product_id: item.product_id || item.note?.product_id,
          author: item.user,
          created_at: item.note?.created_at,
          comment: item.note?.comment,
          flavor_tags: item.note?.flavor_tags
            ? (typeof item.note.flavor_tags === "string"
              ? JSON.parse(item.note.flavor_tags)
              : item.note.flavor_tags)
            : null,
          brew_method: item.note?.brew_method,
          drink_style: item.note?.drink_style,
          acidity: item.note?.acidity,
          body: item.note?.body,
          sweetness: item.note?.sweetness,
          aftertaste: item.note?.aftertaste,
        }));
        for (const item of timeline) {
          social.setInitialLikeState(item.id, item.liked_by_me || false, item.like_count || 0);
        }
        setItems(timeline);
      } catch { setItems([]); }
    }
  }, []);

  useEffect(() => { loadFeed().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await loadFeed(); setRefreshing(false); };

  const handleRoasterPost = useCallback(async (data: any) => {
    try {
      await apiFetch("/roaster-posts", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          post_type: data.post_type || "article",
          location: data.location || null,
        }),
      });
      setShowRoasterCompose(false);
      await loadFeed();
    } catch (e: any) {
      console.warn("Post error:", e.message);
    }
  }, [loadFeed]);

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <Text style={{ fontFamily: fonts.bodyRegular, color: colors.textSecondary }}>
          Loading feed…
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScrollView
        style={s.feedScroll}
        contentContainerStyle={s.feedContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
            if (visibleFeedCount < items.length) {
              setVisibleFeedCount((c) => Math.min(c + FEED_PER_PAGE, items.length));
            }
          }
        }}
        scrollEventThrottle={400}
      >
        {/* In-place compose — appears at top of feed when FAB is pressed (not for reposts) */}
        {showRoasterCompose && !repostTarget && (
          <>
            <ComposePost
              onSubmit={async (data) => { await handleRoasterPost(data); }}
              onCancel={() => setShowRoasterCompose(false)}
              loading={false}
              products={productMap ? Array.from(productMap.values()) : []}
              user={user}
            />
            {items.length > 0 && <View style={s.feedDivider} />}
          </>
        )}

        {items.length === 0 && !showRoasterCompose ? (
          <Text style={s.emptyText}>Nothing in the feed yet. Taste some coffees!</Text>
        ) : (
          items.slice(0, visibleFeedCount).map((item: any, idx: number) => {
            const card = item.type === "roaster_post" ? (
              <PostFeedCard
                key={`rp-${item.id}-${idx}`}
                post={item}
                user={user}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                isOwner={user?.id === item.user_id}
                onEdit={(p) => openPostModal({ post: p, mode: "comment" })}
                onDelete={async (p) => { await apiFetch(`/roaster-posts/${p.id}`, { method: "DELETE" }); loadFeed(); }}
              />
            ) : (
              <TastingNoteCard
                key={`tn-${item.id}-${idx}`}
                item={item}
                productMap={productMap}
                router={router}
                social={social}
                isLoggedIn={!!user}
              />
            );
            return (
              <View key={`wrap-${item.id}-${idx}`}>
                {card}
                {idx < Math.min(items.length, visibleFeedCount) - 1 && <View style={s.feedDivider} />}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Repost floating modal — Figma 116:770 backdrop */}
      {/* Compose FAB */}
      {user && !showRoasterCompose && (
        <Pressable onPress={() => setShowRoasterCompose(true)} style={s.fab}>
          <Plus size={22} color="#FAF8F0" strokeWidth={2.5} />
        </Pressable>
      )}
    </View>
  );
}

// ── Roaster compose card ───────────────────────────────────────────────────────

function RoasterComposeCard({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [postType, setPostType] = useState<"article" | "note">("article");
  const [title, setTitle] = useState("");
  const [teaser, setTeaser] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);

  const isNote = postType === "note";
  const canSubmit = teaser.trim().length > 0 && teaser.trim().length <= 300 &&
    (isNote || title.trim().length > 0);

  const addImageField = () => setImageUrls((prev) => [...prev, ""]);
  const updateImageUrl = (idx: number, val: string) =>
    setImageUrls((prev) => prev.map((u, i) => (i === idx ? val : u)));
  const removeImageUrl = (idx: number) =>
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const imgs = imageUrls.map((u) => u.trim()).filter(Boolean);
    try {
      await onSubmit({
        title: isNote ? (teaser.trim().slice(0, 60) || "Note") : title.trim(),
        teaser: teaser.trim(),
        external_url: url.trim() || null,
        cover_image_url: imgs[0] || null,
        post_type: postType,
        location: location.trim() || null,
        images: imgs,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={rc.wrap}>
      <View style={rc.topRow}>
        <Text style={rc.heading}>New post</Text>
        <Pressable onPress={onCancel} hitSlop={10}>
          <X size={16} color="#A09580" />
        </Pressable>
      </View>

      {/* Post type toggle */}
      <View style={rc.typeRow}>
        <Pressable onPress={() => setPostType("article")} style={[rc.typeBtn, !isNote && rc.typeBtnActive]}>
          <Text style={[rc.typeBtnText, !isNote && rc.typeBtnTextActive]}>Article</Text>
        </Pressable>
        <Pressable onPress={() => setPostType("note")} style={[rc.typeBtn, isNote && rc.typeBtnActive]}>
          <Text style={[rc.typeBtnText, isNote && rc.typeBtnTextActive]}>Note</Text>
        </Pressable>
      </View>

      {!isNote && (
        <>
          <Text style={rc.label}>Title *</Text>
          <TextInput
            style={rc.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Article title…"
            placeholderTextColor="#C7BAA5"
          />
        </>
      )}

      <Text style={rc.label}>
        {isNote ? "Note *" : "Teaser *"} <Text style={rc.labelCount}>{teaser.length}/300</Text>
      </Text>
      <TextInput
        style={[rc.input, rc.textarea]}
        value={teaser}
        onChangeText={setTeaser}
        placeholder={isNote ? "What's on your mind…" : "A short description shown in the feed (max 300 chars)…"}
        placeholderTextColor="#C7BAA5"
        multiline
        numberOfLines={3}
      />

      {isNote && (
        <>
          <Text style={rc.label}>Location</Text>
          <TextInput
            style={rc.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Nada, Anjuna"
            placeholderTextColor="#C7BAA5"
          />
        </>
      )}

      {!isNote && (
        <>
          <Text style={rc.label}>Article URL</Text>
          <TextInput
            style={rc.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            placeholderTextColor="#C7BAA5"
            autoCapitalize="none"
            keyboardType="url"
          />
        </>
      )}

      <Text style={rc.label}>
        Images <Text style={rc.labelCount}>(portrait for notes · scroll beyond 3)</Text>
      </Text>
      {imageUrls.map((val, idx) => (
        <View key={idx} style={rc.imageRow}>
          <TextInput
            style={[rc.input, { flex: 1 }]}
            value={val}
            onChangeText={(v) => updateImageUrl(idx, v)}
            placeholder="https://…"
            placeholderTextColor="#C7BAA5"
            autoCapitalize="none"
            keyboardType="url"
          />
          {imageUrls.length > 1 && (
            <Pressable onPress={() => removeImageUrl(idx)} hitSlop={8} style={rc.removeBtn}>
              <X size={13} color="#A09580" />
            </Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={addImageField} style={rc.addImageBtn}>
        <Plus size={11} color="#684F44" strokeWidth={2} />
        <Text style={rc.addImageText}>Add image</Text>
      </Pressable>

      <View style={rc.actions}>
        <Pressable onPress={onCancel} style={rc.cancelBtn}>
          <Text style={rc.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          style={[rc.submitBtn, (!canSubmit || loading) && rc.submitBtnDisabled]}
          disabled={!canSubmit || loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#FAF8F0" />
            : <Text style={rc.submitText}>Post to feed</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

const rc = StyleSheet.create({
  wrap: {
    marginHorizontal: 28,
    marginTop: 20,
    marginBottom: 4,
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FFFEFB",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101" },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  typeBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 4, borderWidth: 1, borderColor: "#D7D1C4", backgroundColor: "#FEFDFB",
  },
  typeBtnActive: { borderColor: "#351101", backgroundColor: "#351101" },
  typeBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#684F44" },
  typeBtnTextActive: { color: "#FAF8F0" },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#684F44",
    marginBottom: 5,
    marginTop: 12,
  },
  labelCount: { fontFamily: fonts.bodyRegular, color: "#A09580" },
  input: {
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#351101",
    backgroundColor: "#FEFDFB",
  } as any,
  textarea: { minHeight: 68, textAlignVertical: "top" as any },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    justifyContent: "flex-end" as any,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D7D1C4",
  },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#684F44" },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: "#351101",
    minWidth: 100,
    alignItems: "center" as any,
  },
  submitBtnDisabled: { backgroundColor: "#A09580" },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
  imageRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 } as any,
  removeBtn: { padding: 4 },
  addImageBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 4, marginBottom: 2,
    paddingVertical: 5, alignSelf: "flex-start" as any,
  },
  addImageText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },
});

// PhotoGallery — uses shared PostGallery component (universal aspect ratio, standard item size)

// ── Tasting Note Card (unchanged visual design) ───────────────────────────────

function TastingNoteCard({ item, productMap, router, social, isLoggedIn }: {
  item: any;
  productMap: any;
  router: any;
  social: ReturnType<typeof useSocial>;
  isLoggedIn: boolean;
}) {
  const note = item.note || item;
  const author = item.author || item.user || {};
  const productId = item.product_id || note?.product_id;
  const coffee = productMap?.get(productId);
  const noteId = item.id || note?.id;

  const likeState = social.getLikeState(noteId);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentCount, setCommentCount] = useState(item.comment_count || 0);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleLike = async () => {
    if (!isLoggedIn) return;
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.25, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    await social.toggleLike(noteId);
  };

  const loadComments = useCallback(async () => {
    const data = await social.fetchComments(noteId);
    setComments(data.comments);
    setCommentCount(data.comments.length);
  }, [noteId]);

  const handleToggleComments = () => {
    if (!showComments) loadComments();
    setShowComments(!showComments);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !isLoggedIn) return;
    await social.createComment(noteId, commentText.trim());
    setCommentText("");
    loadComments();
  };

  return (
    <View style={fc.card}>
      {/* User header */}
      <View style={fc.userRow}>
        <Pressable onPress={() => router.push(`/user/${author.username}`)}>
          {author.avatar_url ? (
            <Image source={{ uri: resolveUploadUrl(author.avatar_url) }} style={{ width: 36, height: 36, borderRadius: 18 }} />
          ) : (
            <View style={fc.avatarFallback}>
              <Text style={fc.avatarLetter}>{(author.display_name || "?")[0]}</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => router.push(`/user/${author.username}`)}>
            <Text style={fc.userName}>{author.display_name}</Text>
          </Pressable>
          <Text style={fc.postedAbout}>Posted about a coffee</Text>
          {author.location && (
            <View style={fc.locationRow}>
              <MapPin size={8} color={colors.textSecondary} />
              <Text style={fc.locationText}>{author.location}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Coffee card + tasting note */}
      {coffee && (
        <View style={fc.contentRow}>
          <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)}>
            <CoffeeCard coffee={coffee} width={240} height={372} />
          </Pressable>
          <View style={fc.noteCol}>
            <TastingNoteDisplay note={note} />
          </View>
        </View>
      )}

      {!coffee && (
        <View style={{ padding: 16 }}>
          <TastingNoteDisplay note={note} />
        </View>
      )}

      {/* Like + Comment bar */}
      <View style={fc.interactionBar}>
        <Pressable onPress={handleLike} style={fc.interactionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {likeState.liked
              ? <HeartFilledOutlineIcon size={16} color="#D798DA" />
              : <HeartOutlineIcon size={16} color="#D798DA" />}
          </Animated.View>
          {likeState.count > 0 && <Text style={[fc.interactionCount, likeState.liked && { color: "#D798DA" }]}>{likeState.count}</Text>}
        </Pressable>
        <Pressable onPress={handleToggleComments} style={fc.interactionBtn}>
          <CommentBubbleIcon size={14} color="#D798DA" />
          {commentCount > 0 && <Text style={[fc.interactionCount, showComments && { color: colors.textPrimary }]}>{commentCount}</Text>}
        </Pressable>
        <View style={fc.interactionBtn}>
          <ShareNodesIcon size={12} color="#D798DA" />
        </View>
      </View>

      {/* Comments section */}
      {showComments && (
        <View style={fc.commentsSection}>
          {comments.map((c: any) => (
            <View key={c.id} style={fc.commentRow}>
              <Text style={fc.commentAuthor}>{c.user.display_name}</Text>
              <Text style={fc.commentText}>{c.comment}</Text>
            </View>
          ))}
          {isLoggedIn && (
            <View style={fc.commentInputRow}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Write a comment…"
                placeholderTextColor={colors.textMuted}
                style={fc.commentInput}
                onSubmitEditing={handleSubmitComment}
              />
              <Pressable onPress={handleSubmitComment} style={fc.sendBtn}>
                <Send size={14} color={commentText.trim() ? colors.textPrimary : colors.textMuted} />
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  feedScroll: { flex: 1 },
  feedContent: {
    maxWidth: 900,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 100,
  },
  emptyText: { textAlign: "center", paddingVertical: 64, fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary },
  // Figma 135:1664 — #D7D1C4 separator line between posts
  feedDivider: { height: 1, backgroundColor: "#D7D1C4" },

  // FAB — same as roaster profile (bottom-right floating + button)
  fab: {
    position: "absolute",
    bottom: 28,
    right: 28,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#351101",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  } as any,
});

const fc = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 20,
    backgroundColor: colors.cardFront,
    ...cardShadow,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.tagBg,
  },
  avatarLetter: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.tagText },
  userName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary },
  postedAbout: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#D798DA", marginTop: 1 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  locationText: { fontFamily: fonts.bodyRegular, fontSize: 10, color: colors.textSecondary },
  contentRow: { flexDirection: "row" },
  noteCol: { flex: 1, minWidth: 0, paddingHorizontal: 16, paddingBottom: 16 },
  interactionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },
  interactionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  interactionCount: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  heartIcon: { width: 16, height: 14 },
  commentIcon: { width: 14, height: 14 },
  shareIcon: { width: 12, height: 14 },
  commentsSection: {
    borderTopWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  commentRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  commentAuthor: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
  commentText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textSecondary, flex: 1 },
  commentInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  commentInput: { flex: 1, fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textPrimary },
  sendBtn: { padding: 4 },
});
