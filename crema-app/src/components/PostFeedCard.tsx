/**
 * PostFeedCard — shared post card used in home feed, profile, and public profile.
 * Extracted from app/(tabs)/index.tsx.
 */

import { useState, useRef, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { useRouter } from "expo-router";

import { apiFetch, resolveUploadUrl } from "../api/client";
import { fonts } from "../theme/colors";
import {
  HeartOutlineIcon,
  HeartFilledOutlineIcon,
  CommentBubbleIcon,
  ShareNodesIcon,
  PostLocationPinIcon,
} from "./icons/FigmaIcons";
import PostGallery from "./PostGallery";
import PostMenu from "./PostMenu";

/** Renders an avatar with crop/zoom applied via manual positioning.
 *  Exported so other components can reuse it. */
export function CroppedAvatar({ url, cropX, cropY, zoom, size, style }: {
  url: string; cropX?: number; cropY?: number; zoom?: number; size: number; style?: any;
}) {
  const [aspect, setAspect] = useState(1.5);
  const z = zoom ?? 1;
  const cx = cropX ?? 50;
  const cy = cropY ?? 50;
  const MIN = 1.2;
  // Square container → image always landscape → height fits tightly
  let iW: number, iH: number;
  if (aspect >= 1) { iH = size * MIN * z; iW = iH * aspect; }
  else { iW = size * MIN * z; iH = iW / aspect; }
  const tx = -(iW - size) * (cx / 100);
  const ty = -(iH - size) * (cy / 100);
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }, style]}>
      <Image
        source={{ uri: resolveUploadUrl(url) }}
        style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
        contentFit="fill"
        onLoad={(e: any) => { const s = e?.source; if (s?.width && s?.height) setAspect(s.width / s.height); }}
      />
    </View>
  );
}

/** Dispatch global event to open the sitewide PostModal */
export function openPostModal(opts: { postId?: number; post?: any; mode?: string; highlightCommentId?: number }) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crema:open-post", { detail: opts }));
  }
}

export function timeAgo(dateStr: string): string {
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

interface PostFeedCardProps {
  post: any;
  user?: any;
  onComment?: (post: any) => void;
  onRepost?: (post: any) => void;
  onViewOriginal?: (postId: number) => void;
  // Three-dots menu (owner only)
  isOwner?: boolean;
  onEdit?: (post: any) => void;
  onPin?: (post: any) => void;
  onDelete?: (post: any) => void;
}

export default function PostFeedCard({
  post, user, onComment, onRepost, onViewOriginal,
  isOwner, onEdit, onPin, onDelete,
}: PostFeedCardProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(post.liked_by_me || false);
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [showCopied, setShowCopied] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleLike = async () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setLiked((l: boolean) => !l);
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
      <View style={rp.headerRow}>
        <Pressable onPress={goToAuthor} style={rp.header}>
          {post.author_avatar_url ? (
            <CroppedAvatar
              url={post.author_avatar_url}
              cropX={post.author_avatar_crop_x}
              cropY={post.author_avatar_crop_y}
              zoom={post.author_avatar_zoom}
              size={30}
            />
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
        {isOwner && (
          <PostMenu
            onEdit={onEdit ? () => onEdit(post) : undefined}
            onPin={onPin ? () => onPin(post) : undefined}
            onDelete={onDelete ? () => onDelete(post) : undefined}
            isPinned={isPinned}
          />
        )}
      </View>

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

      {/* Repost: nested original post card — clickable to open original */}
      {post.post_type === "repost" && post.original_post && (
        <Pressable onPress={onViewOriginal ? () => onViewOriginal(post.original_post.id) : undefined} style={rp.repostCard}>
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
                <CroppedAvatar
                  url={post.original_post.author_avatar_url}
                  cropX={post.original_post.author_avatar_crop_x}
                  cropY={post.original_post.author_avatar_crop_y}
                  zoom={post.original_post.author_avatar_zoom}
                  size={20}
                />
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
        </Pressable>
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
        <Pressable onPress={onComment ? () => onComment(post) : undefined} style={rp.actionBtn}>
          <CommentBubbleIcon size={14} color="#D798DA" />
          <Text style={rp.actionCount}>{commentCount}</Text>
        </Pressable>
        {post.post_type !== "repost" && (
          <Pressable onPress={onRepost ? () => onRepost(post) : undefined} style={rp.actionBtn}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3" stroke="#D798DA" strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            {(post.repost_count || 0) > 0 && <Text style={rp.actionCount}>{post.repost_count}</Text>}
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            const url = post.external_url || (typeof window !== "undefined" ? `${window.location.origin}/user/${post.author_username}` : "");
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(url);
              setShowCopied(true);
              setTimeout(() => setShowCopied(false), 1500);
            }
          }}
          style={rp.actionBtn}
        >
          {showCopied ? (
            <Text style={rp.copiedText}>Copied!</Text>
          ) : (
            <ShareNodesIcon size={12} color="#D798DA" />
          )}
        </Pressable>
      </View>

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
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    flex: 1,
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
  copiedText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#D798DA" },
});
