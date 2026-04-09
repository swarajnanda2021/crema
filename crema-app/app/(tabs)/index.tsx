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
  RefreshControl, StyleSheet, Animated,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  MapPin, Coffee, ShoppingCart, MessageCircle, Send,
} from "lucide-react-native";
import * as Linking from "expo-linking";
import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useSocial } from "../../src/hooks/useSocial";
import { apiFetch, trackClick } from "../../src/api/client";
import { colors, fonts, cardShadow } from "../../src/theme/colors";
import { HeartIcon, HeartFilledIcon, HeartOutlineIcon, HeartFilledOutlineIcon } from "../../src/components/icons/FigmaIcons";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";
import Chip from "../../src/components/Chip";

// ── Feed page ─────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const social = useSocial();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFeed = async () => {
    try {
      const data = await apiFetch("/posts-timeline?limit=40");
      const feedItems = data.items || [];
      // Initialise like state for tasting notes
      for (const item of feedItems) {
        if (item.type === "tasting_note") {
          social.setInitialLikeState(item.id, item.liked_by_me || false, item.like_count || 0);
        }
      }
      setItems(feedItems);
    } catch {
      // Fall back to old timeline if posts-timeline unavailable
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
  };

  useEffect(() => { loadFeed().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await loadFeed(); setRefreshing(false); };

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
        {items.length === 0 ? (
          <Text style={s.emptyText}>Nothing in the feed yet. Taste some coffees!</Text>
        ) : (
          items.map((item: any, idx: number) => {
            if (item.type === "roaster_post") {
              return (
                <RoasterPostFeedCard
                  key={`rp-${item.id}-${idx}`}
                  post={item}
                  router={router}
                />
              );
            }
            return (
              <TastingNoteCard
                key={`tn-${item.id}-${idx}`}
                item={item}
                productMap={productMap}
                router={router}
                social={social}
                isLoggedIn={!!user}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

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

function RoasterPostFeedCard({ post, router }: { post: any; router: any }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const pulse = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.25, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  const handleLike = () => {
    pulse();
    setLiked((l) => !l);
    setLikeCount((c) => liked ? c - 1 : c + 1);
  };

  const handleOpen = () => {
    if (post.external_url) Linking.openURL(post.external_url);
  };

  const goToRoaster = () => {
    if (post.roaster_slug) router.push(`/roaster/${post.roaster_slug}`);
  };

  return (
    <View style={rp.card}>
      {/* Header */}
      <Pressable onPress={goToRoaster} style={rp.header}>
        <View style={rp.avatarWrap}>
          {post.author_avatar_url ? (
            <Image
              source={{ uri: post.author_avatar_url }}
              style={rp.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[rp.avatar, rp.avatarFallback]}>
              <Text style={rp.avatarLetter}>
                {(post.author_display_name || "R")[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={rp.headerText}>
          <View style={rp.nameRow}>
            <Text style={rp.authorName}>{post.author_display_name}</Text>
            <Text style={rp.timestamp}>{timeAgo(post.published_at)}</Text>
          </View>
          <Text style={rp.subtitle}>Posted about an article</Text>
        </View>
      </Pressable>

      {/* Title */}
      <Pressable onPress={handleOpen} style={rp.titleWrap}>
        <Text style={rp.title}>{post.title}</Text>
      </Pressable>

      {/* Cover image */}
      {post.cover_image_url ? (
        <Pressable onPress={handleOpen} style={rp.coverWrap}>
          <Image
            source={{ uri: post.cover_image_url }}
            style={rp.coverImage}
            contentFit="cover"
          />
        </Pressable>
      ) : null}

      {/* Teaser */}
      <Text style={rp.teaser} numberOfLines={4}>{post.teaser}</Text>

      {/* Action bar */}
      <View style={rp.actionBar}>
        <Pressable onPress={handleLike} style={rp.actionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {liked
              ? <HeartFilledOutlineIcon size={16} color={colors.like} />
              : <HeartOutlineIcon size={16} color={colors.textMuted} />}
          </Animated.View>
          {likeCount > 0 && (
            <Text style={[rp.actionCount, liked && { color: colors.like }]}>{likeCount}</Text>
          )}
        </Pressable>
        <View style={rp.actionBtn}>
          <MessageCircle size={16} color={colors.textMuted} strokeWidth={2} />
        </View>
        {post.external_url && (
          <Pressable onPress={handleOpen} style={[rp.actionBtn, { marginLeft: "auto" as any }]}>
            <Text style={rp.readMore}>Read article →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const rp = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 20,
    backgroundColor: colors.cardFront,
    ...cardShadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  avatarWrap: {},
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
  } as any,
  avatarFallback: {
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },
  headerText: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  authorName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
  timestamp: { fontFamily: fonts.bodyRegular, fontSize: 10, color: colors.textMuted },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  titleWrap: { paddingHorizontal: 16, marginBottom: 10 },
  title: {
    fontFamily: fonts.bodyRegular,
    fontSize: 17,
    color: colors.textPrimary,
    lineHeight: 23,
  },
  coverWrap: { marginBottom: 12 },
  coverImage: {
    width: "100%" as any,
    height: 220,
  },
  teaser: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionCount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textMuted },
  readMore: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textPrimary,
    textDecorationLine: "underline",
  },
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

  const handleLike = async () => {
    if (!isLoggedIn) return;
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
            <Image source={{ uri: author.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
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
          {author.location && (
            <View style={fc.locationRow}>
              <MapPin size={8} color={colors.textSecondary} />
              <Text style={fc.locationText}>{author.location}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Coffee image + tasting note */}
      {coffee && (
        <View style={fc.contentRow}>
          <View style={fc.coffeeCol}>
            <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)}>
              {coffee.image_url ? (
                <Image source={{ uri: coffee.image_url }} style={fc.coffeeImage} contentFit="cover" />
              ) : (
                <View style={[fc.coffeeImage, { backgroundColor: colors.tagBg, alignItems: "center", justifyContent: "center" }]}>
                  <Coffee size={20} color={colors.border} />
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)}>
              <Text style={fc.coffeeName} numberOfLines={2}>{coffee.coffee_name}</Text>
            </Pressable>
            <Text style={fc.roasterName}>{coffee.roaster_name}</Text>
            <View style={fc.chipRow}>
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
            </View>
            <Pressable
              onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "feed"); Linking.openURL(coffee.product_url); }}
              style={fc.buyLink}
            >
              <ShoppingCart size={9} color={colors.accent} />
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.accent }}>Buy</Text>
            </Pressable>
          </View>
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
          {likeState.liked ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} color={colors.textMuted} />}
          {likeState.count > 0 && <Text style={[fc.interactionCount, likeState.liked && { color: colors.purple }]}>{likeState.count}</Text>}
        </Pressable>
        <Pressable onPress={handleToggleComments} style={fc.interactionBtn}>
          <MessageCircle size={16} color={showComments ? colors.textPrimary : colors.textMuted} strokeWidth={2} />
          {commentCount > 0 && <Text style={[fc.interactionCount, showComments && { color: colors.textPrimary }]}>{commentCount}</Text>}
        </Pressable>
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
    maxWidth: 720,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 100,
  },
  emptyText: { textAlign: "center", paddingVertical: 64, fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary },
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
  locationRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  locationText: { fontFamily: fonts.bodyRegular, fontSize: 10, color: colors.textSecondary },
  contentRow: { flexDirection: "row" },
  coffeeCol: {
    width: 160,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  coffeeImage: {
    width: "100%" as any,
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  coffeeName: { fontFamily: fonts.displayRegular, fontSize: 13, lineHeight: 17, color: colors.textPrimary },
  roasterName: { fontFamily: fonts.bodyRegular, fontSize: 11, marginTop: 2, color: colors.textSecondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  buyLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
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
  interactionCount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textMuted },
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
