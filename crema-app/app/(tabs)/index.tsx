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
  MapPin, Coffee, ShoppingCart, Send, Plus, X, ChevronDown, MessageCircle,
} from "lucide-react-native";

// ── Figma Frame 720 post card assets ─────────────────────────────────────────
const FIGMA_POST_HEART   = "http://localhost:3845/assets/3e92b5cd93aafa2a17dd1b9b331c5338e18ac639.svg";
const FIGMA_POST_COMMENT = "http://localhost:3845/assets/71167aa5e804a3f44c93add7f2445f77d514d0af.svg";
const FIGMA_POST_SHARE   = "http://localhost:3845/assets/12186c3d643c443d0ef02bb899348e1c0cdf0973.svg";
const FIGMA_POST_MAPPIN  = "http://localhost:3845/assets/e5bb5db86d84a07e96f6d7e2803da172dc94dd29.svg";
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
      >
        {/* Roaster compose card — top of feed for roaster accounts */}
        {isRoaster && (
          <>
            {showRoasterCompose ? (
              <RoasterComposeCard
                onSubmit={handleRoasterPost}
                onCancel={() => setShowRoasterCompose(false)}
              />
            ) : (
              <Pressable
                onPress={() => setShowRoasterCompose(true)}
                style={s.composePrompt}
              >
                <View style={s.composePromptAvatar}>
                  {user?.avatar_url ? (
                    <Image source={{ uri: user.avatar_url }} style={s.composePromptAvatarImg} contentFit="cover" />
                  ) : (
                    <View style={[s.composePromptAvatarImg, s.composePromptAvatarFallback]}>
                      <Text style={s.composePromptInitial}>{(user?.display_name || "N")[0].toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.composePromptText}>Share a note or article with the community…</Text>
                <View style={s.composePromptIcon}>
                  <Plus size={14} color="#A09580" />
                </View>
              </Pressable>
            )}
            <View style={s.feedDivider} />
          </>
        )}

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
  const [coverUrl, setCoverUrl] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);

  const isNote = postType === "note";
  const canSubmit = teaser.trim().length > 0 && teaser.trim().length <= 300 &&
    (isNote || title.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onSubmit({
        title: isNote ? (teaser.trim().slice(0, 60) || "Note") : title.trim(),
        teaser: teaser.trim(),
        external_url: url.trim() || null,
        cover_image_url: coverUrl.trim() || null,
        post_type: postType,
        location: location.trim() || null,
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

      <Text style={rc.label}>Cover image URL</Text>
      <TextInput
        style={rc.input}
        value={coverUrl}
        onChangeText={setCoverUrl}
        placeholder="https://…"
        placeholderTextColor="#C7BAA5"
        autoCapitalize="none"
        keyboardType="url"
      />

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
});

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

// ── Roaster post feed card — Frame 720 design ─────────────────────────────────

function RoasterPostFeedCard({ post, router }: { post: any; router: any }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleLike = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.25, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setLiked((l) => !l);
    setLikeCount((c) => liked ? c - 1 : c + 1);
  };

  const handleOpen = () => {
    if (post.external_url) Linking.openURL(post.external_url);
  };

  const goToRoaster = () => {
    if (post.roaster_slug) router.push(`/roaster/${post.roaster_slug}`);
  };

  // Post type label: note vs article
  const postTypeLabel = post.post_type === "note" ? "Posted a note" : "Posted about an article";

  return (
    <View style={rp.card}>

      {/* ── Header ── */}
      <Pressable onPress={goToRoaster} style={rp.header}>
        {post.author_avatar_url ? (
          <Image source={{ uri: post.author_avatar_url }} style={rp.avatar} contentFit="cover" />
        ) : (
          <View style={[rp.avatar, rp.avatarFallback]}>
            <Text style={rp.avatarLetter}>{(post.author_display_name || "R")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={rp.headerText}>
          <View style={rp.nameRow}>
            <Text style={rp.authorName}>{post.author_display_name}</Text>
            <Text style={rp.timestamp}>{timeAgo(post.published_at)}</Text>
          </View>
          <Text style={rp.subtitle}>{postTypeLabel}</Text>
        </View>
      </Pressable>

      {/* ── Body text (teaser at Figma 16.764px) ── */}
      <Pressable onPress={handleOpen}>
        <Text style={rp.body}>{post.teaser}</Text>
      </Pressable>

      {/* ── Location row ── */}
      {post.location ? (
        <View style={rp.locationRow}>
          <Image source={{ uri: FIGMA_POST_MAPPIN }} style={rp.mapPinIcon} contentFit="contain" />
          <Text style={rp.locationText}>{post.location}</Text>
        </View>
      ) : null}

      {/* ── Cover photo ── */}
      {post.cover_image_url ? (
        <Pressable onPress={handleOpen} style={rp.photoWrap}>
          <Image source={{ uri: post.cover_image_url }} style={rp.photo} contentFit="cover" />
        </Pressable>
      ) : null}

      {/* ── Action bar ── */}
      <View style={rp.actionBar}>
        {/* Heart + count */}
        <Pressable onPress={handleLike} style={rp.actionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {liked
              ? <HeartFilledOutlineIcon size={16} color="#D798DA" />
              : <Image source={{ uri: FIGMA_POST_HEART }} style={rp.heartIcon} contentFit="contain" />}
          </Animated.View>
          <Text style={[rp.actionCount, liked && { color: "#D798DA" }]}>{likeCount}</Text>
        </Pressable>
        {/* Comment + count */}
        <View style={rp.actionBtn}>
          <Image source={{ uri: FIGMA_POST_COMMENT }} style={rp.commentIcon} contentFit="contain" />
          <Text style={rp.actionCount}>{commentCount}</Text>
        </View>
        {/* Share */}
        <View style={rp.actionBtn}>
          <Image source={{ uri: FIGMA_POST_SHARE }} style={rp.shareIcon} contentFit="contain" />
        </View>
        {/* Article link */}
        {post.external_url && (
          <Pressable onPress={handleOpen} style={{ marginLeft: "auto" as any }}>
            <Text style={rp.readMore}>Read →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const rp = StyleSheet.create({
  // Figma: white card, subtle border, rounded
  card: {
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 20,
    backgroundColor: colors.cardFront,
    ...cardShadow,
  },
  // Header: avatar + name row + subtitle
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  avatar: { width: 30, height: 30, borderRadius: 15, overflow: "hidden" } as any,
  avatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  headerText: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  // Figma: Inter Medium 11.848px #351101
  authorName: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  // Figma: Inter Medium 10.058px #A09580
  timestamp: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  // Figma: Inter Medium 10.058px #684F44
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#684F44", marginTop: 2 },
  // Body: Figma Inter Regular 16.764px #351101 line-height 23.469px
  body: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16.8,
    color: "#351101",
    lineHeight: 23.5,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  // Location: Figma map pin + Inter Medium 11.848px #351101
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  mapPinIcon: { width: 11, height: 14 },
  locationText: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  // Photo: Figma 311px tall, rounded 5px
  photoWrap: { marginHorizontal: 20, borderRadius: 5, overflow: "hidden", marginBottom: 14 } as any,
  photo: { width: "100%" as any, height: 240, borderRadius: 5 },
  // Action bar
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: colors.borderLight,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Figma icon sizes
  heartIcon: { width: 16, height: 14 },
  commentIcon: { width: 14, height: 14 },
  shareIcon: { width: 12, height: 14 },
  // Figma: Inter Medium 11.848px #351101
  actionCount: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  readMore: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101", textDecorationLine: "underline" },
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

  // Roaster compose prompt (collapsed state)
  composePrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 28,
    marginTop: 20,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FFFEFB",
  } as any,
  composePromptAvatar: {},
  composePromptAvatarImg: { width: 28, height: 28, borderRadius: 14, overflow: "hidden" } as any,
  composePromptAvatarFallback: {
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  },
  composePromptInitial: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  composePromptText: { flex: 1, fontFamily: fonts.bodyRegular, fontSize: 13, color: "#A09580" },
  composePromptIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F0EBE1",
    alignItems: "center",
    justifyContent: "center",
  },
  feedDivider: { height: 1, backgroundColor: "#D7D1C4", marginTop: 16 },
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
