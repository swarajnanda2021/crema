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
  View, Text, TextInput, Pressable, ScrollView, Modal,
  RefreshControl, StyleSheet, Animated, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  MapPin, Send, Plus, X,
} from "lucide-react-native";

import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useSocial } from "../../src/hooks/useSocial";
import { apiFetch, resolveUploadUrl } from "../../src/api/client";
import { colors, fonts, cardShadow } from "../../src/theme/colors";
import { HeartOutlineIcon, HeartFilledOutlineIcon, CommentBubbleIcon, ShareNodesIcon, PostLocationPinIcon } from "../../src/components/icons/FigmaIcons";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";
import CoffeeCard from "../../src/components/CoffeeCard";
import PostGallery from "../../src/components/PostGallery";
import ComposePost from "../../src/components/ComposePost";
import CommentModal from "../../src/components/CommentModal";

// ── Feed page ─────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const social = useSocial();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // ALL hooks must be declared before any early returns
  const [showRoasterCompose, setShowRoasterCompose] = useState(false);
  const [repostTarget, setRepostTarget] = useState<any>(null);

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
          items.map((item: any, idx: number) => {
            const card = item.type === "roaster_post" ? (
              <RoasterPostFeedCard
                key={`rp-${item.id}-${idx}`}
                post={item}
                router={router}
                onRepost={(post: any) => { setRepostTarget(post); }}
                user={user}
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
                {idx < items.length - 1 && <View style={s.feedDivider} />}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Repost floating modal — Figma 116:770 backdrop */}
      {repostTarget && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setRepostTarget(null)}>
          <Pressable style={s.repostOverlay} onPress={() => setRepostTarget(null)}>
            <Pressable style={s.repostModal} onPress={(e) => e.stopPropagation()}>
              <ComposePost
                onSubmit={async (data) => { await handleRoasterPost(data); setRepostTarget(null); }}
                onCancel={() => setRepostTarget(null)}
                loading={false}
                repostTarget={repostTarget}
                user={user}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Compose FAB */}
      {user && !showRoasterCompose && !repostTarget && (
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

// ── Roaster Post Feed Card (Figma-faithful) ───────────────────────────────────

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  } catch { return ""; }
}

// ── Post feed card — matches roaster profile PostCard design ─────────────────

function RoasterPostFeedCard({ post, router, onRepost, user }: { post: any; router: any; onRepost?: (post: any) => void; user?: any }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleLike = async () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    // Optimistic update
    setLiked((l) => !l);
    setLikeCount((c: number) => liked ? c - 1 : c + 1);
    try {
      const res = await apiFetch(`/posts/${post.id}/like`, { method: "POST" });
      setLiked(res.liked);
      setLikeCount(res.like_count);
    } catch {}
  };

  const handleOpen = () => {
    if (post.external_url) Linking.openURL(post.external_url);
  };

  const goToAuthor = () => {
    if (post.roaster_slug && !post.roaster_slug.startsWith("user_")) {
      router.push(`/roaster/${post.roaster_slug}`);
    } else {
      router.push(`/user/${post.author_username}`);
    }
  };

  const isPinned = !!post.is_featured;
  const isArticle = post.post_type === "article";
  const subtitleText = isPinned
    ? "Pinned"
    : post.post_type === "tasting_note"
    ? "Posted a tasting note"
    : post.post_type === "note"
    ? "Shared a moment"
    : post.post_type === "repost"
    ? "Reposted"
    : "Shared an article";

  return (
    <View style={rp.card}>
      {/* Header */}
      <Pressable onPress={goToAuthor} style={rp.header}>
        {post.author_avatar_url ? (
          <Image source={{ uri: resolveUploadUrl(post.author_avatar_url) }} style={rp.avatar} contentFit="cover" />
        ) : (
          <View style={[rp.avatar, rp.avatarFallback]}>
            <Text style={rp.avatarLetter}>{(post.author_display_name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={rp.headerText}>
          <View style={rp.nameRow}>
            <Text style={rp.authorName}>{post.author_display_name}</Text>
            <Text style={rp.timestamp}>{timeAgo(post.published_at)}</Text>
          </View>
          <Text style={rp.subtitle}>{subtitleText}</Text>
        </View>
      </Pressable>

      {/* Body */}
      <Pressable onPress={handleOpen}>
        <Text style={rp.body}>{post.teaser}</Text>
      </Pressable>

      {/* Location */}
      {post.location ? (
        <View style={rp.locationRow}>
          <PostLocationPinIcon size={12} color="#D798DA" />
          <Text style={rp.locationText}>{post.location}</Text>
        </View>
      ) : null}

      {/* Repost: nested original post card */}
      {post.post_type === "repost" && post.original_post && (
        <View style={rp.repostCard}>
          <View style={rp.repostCardHeader}>
            <Pressable
              onPress={() => {
                const op = post.original_post;
                if (op.roaster_slug && !op.roaster_slug.startsWith("user_")) router.push(`/roaster/${op.roaster_slug}`);
                else if (op.author_username) router.push(`/user/${op.author_username}`);
              }}
              style={rp.repostCardAuthorRow}
            >
              {post.original_post.author_avatar_url ? (
                <Image source={{ uri: resolveUploadUrl(post.original_post.author_avatar_url) }} style={rp.repostCardAvatar} contentFit="cover" />
              ) : (
                <View style={[rp.repostCardAvatar, rp.repostCardAvatarFb]}>
                  <Text style={rp.repostCardAvatarLetter}>{(post.original_post.author_display_name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              <Text style={rp.repostCardAuthor} numberOfLines={1}>{post.original_post.author_display_name}</Text>
            </Pressable>
            <Text style={rp.repostCardTime}>{timeAgo(post.original_post.published_at)}</Text>
          </View>
          <Text style={rp.repostCardTeaser} numberOfLines={3}>{post.original_post.teaser}</Text>
          {(post.original_post.images?.length > 0 || post.original_post.cover_image_url) && (
            <View style={rp.repostCardGallery}>
              <PostGallery
                images={post.original_post.images?.length > 0 ? post.original_post.images : [post.original_post.cover_image_url]}
                onPress={() => { if (post.original_post.external_url) Linking.openURL(post.original_post.external_url); }}
              />
            </View>
          )}
        </View>
      )}

      {/* Article thumbnail with title overlay OR note gallery */}
      {isArticle && post.cover_image_url ? (
        <Pressable onPress={handleOpen} style={rp.articleThumbWrap}>
          <Image source={{ uri: resolveUploadUrl(post.cover_image_url) }} style={rp.articleThumbImg} contentFit="cover" />
          <View style={rp.articleOverlay}>
            {post.title ? <Text style={rp.articleTitle} numberOfLines={2}>{post.title}</Text> : null}
            <Text style={rp.articleDomain}>{post.external_url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={rp.galleryWrap}>
          <PostGallery images={post.images || (post.cover_image_url ? [post.cover_image_url] : [])} onPress={handleOpen} />
        </View>
      )}

      {/* Action bar — heart, comment, repost, share */}
      <View style={rp.actionBar}>
        <Pressable onPress={handleLike} style={rp.actionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {liked
              ? <HeartFilledOutlineIcon size={16} color="#D798DA" />
              : <HeartOutlineIcon size={16} color="#D798DA" />}
          </Animated.View>
          <Text style={[rp.actionCount, liked && { color: "#D798DA" }]}>{likeCount}</Text>
        </Pressable>
        <Pressable onPress={() => setShowCommentModal(true)} style={rp.actionBtn}>
          <CommentBubbleIcon size={14} color="#D798DA" />
          <Text style={rp.actionCount}>{commentCount}</Text>
        </Pressable>
        {post.post_type !== "repost" && (
          <Pressable onPress={() => onRepost?.(post)} style={rp.actionBtn}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3" stroke="#D798DA" strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(post.external_url || (typeof window !== "undefined" ? window.location.href : ""));
            }
          }}
          style={rp.actionBtn}
        >
          <ShareNodesIcon size={12} color="#D798DA" />
        </Pressable>
      </View>

      {/* Comment modal */}
      <CommentModal
        visible={showCommentModal}
        post={post}
        onClose={() => setShowCommentModal(false)}
        onCommentCountChange={(_, count) => setCommentCount(count)}
        user={user}
      />
    </View>
  );
}

const rp = StyleSheet.create({
  card: {
    backgroundColor: "#FAF8F0",
    paddingTop: 20,
    paddingBottom: 20,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  avatar: { width: 30, height: 30, borderRadius: 15, overflow: "hidden" } as any,
  avatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  headerText: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  authorName: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  timestamp: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#684F44", marginTop: 2 },
  body: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16.8,
    color: "#351101",
    lineHeight: 23.5,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  locationText: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  galleryWrap: { paddingHorizontal: 20 },
  // Article thumbnail with title overlay
  articleThumbWrap: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
    height: 200,
  } as any,
  articleThumbImg: { width: "100%" as any, height: "100%" as any },
  articleOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
    backgroundColor: "#FFF",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "80%",
  } as any,
  articleTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
    lineHeight: 19,
    marginBottom: 2,
  },
  articleDomain: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Nested repost card
  repostCard: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 8,
    backgroundColor: "#FEFDFB",
    padding: 12,
  },
  repostCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostCardAvatar: { width: 20, height: 20, borderRadius: 10, overflow: "hidden" } as any,
  repostCardAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  repostCardAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 8, color: "#FAF8F0" },
  repostCardAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 } as any,
  repostCardAuthor: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101" },
  repostCardTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  repostCardTeaser: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#684F44", lineHeight: 18 },
  repostCardGallery: { marginTop: 8 },
  actionCount: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
});

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
  // Repost floating modal — Figma 116:770 backdrop
  repostOverlay: {
    flex: 1,
    backgroundColor: "rgba(104,79,68,0.6)",
    backdropFilter: "blur(35px)",
    WebkitBackdropFilter: "blur(35px)",
    justifyContent: "center",
    alignItems: "center",
  } as any,
  repostModal: {
    width: "90%",
    maxWidth: 560,
    borderRadius: 12,
    overflow: "hidden",
  } as any,
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
