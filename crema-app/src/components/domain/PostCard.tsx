/**
 * PostCard — universal post card used in feeds, profiles, and roaster pages.
 *
 * Composes primitives: CroppedAvatar, ActionBar, TimeAgo.
 * Reads design tokens — no hardcoded colors or sizes.
 *
 * On iOS/Swift: equivalent SwiftUI view composing the same primitives.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { Image } from "expo-image";

import { CroppedAvatar, ActionBar, openPostModal, timeAgo } from "../primitives";
import PostGallery from "../PostGallery";
import PostMenu from "../PostMenu";
import { resolveUploadUrl } from "../../api/client";
import { t } from "../../tokens/useTokens";
import { PostLocationPinIcon } from "../icons/FigmaIcons";
import type { Post } from "../../resources/types";

interface PostCardProps {
  post: Post;
  user?: any;
  isOwner?: boolean;
  onComment?: (post: Post) => void;
  onRepost?: (post: Post) => void;
  onViewOriginal?: (id: number) => void;
  onEdit?: (post: Post) => void;
  onPin?: (post: Post) => void;
  onDelete?: (post: Post) => void;
}

export default function PostCard({
  post, user, isOwner, onComment, onRepost, onViewOriginal, onEdit, onPin, onDelete,
}: PostCardProps) {
  const router = useRouter();
  const isPinned = !!post.is_pinned;
  const isArticle = post.post_type === "article";
  const isRepost = post.post_type === "repost";

  const subtitleText = isPinned ? "Pinned"
    : post.post_type === "tasting_note" ? "Posted a tasting note"
    : post.post_type === "note" ? "Shared a moment"
    : isRepost ? "Reposted"
    : "Shared an article";

  const author = post.author || {};

  const goToAuthor = () => {
    if (post.roaster_slug && !post.roaster_slug.startsWith("user_")) {
      router.push(`/roaster/${post.roaster_slug}` as any);
    } else if (author.username) {
      router.push(`/user/${author.username}` as any);
    }
  };

  const handleOpen = () => {
    if (post.external_url) Linking.openURL(post.external_url);
  };

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.headerRow}>
        <Pressable onPress={goToAuthor} style={s.header}>
          {author.avatar_url ? (
            <CroppedAvatar
              url={author.avatar_url}
              cropX={author.avatar_crop_x}
              cropY={author.avatar_crop_y}
              zoom={author.avatar_zoom}
              size={t.size["avatar.feed"]}
            />
          ) : (
            <View style={s.avatarFb}>
              <Text style={s.avatarLetter}>{(author.display_name || "?")[0].toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={s.metaRow}>
              <Text style={s.authorName}>{author.display_name}</Text>
              <Text style={s.metaTime}>{timeAgo(post.published_at)}</Text>
            </View>
            <Text style={s.metaSubtitle}>{subtitleText}</Text>
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

      {/* Body text */}
      <Pressable onPress={isRepost ? undefined : handleOpen} style={s.bodyWrap}>
        <Text style={s.body}>{post.teaser}</Text>
      </Pressable>

      {/* Location */}
      {post.location && (
        <View style={s.locationRow}>
          <PostLocationPinIcon size={12} color={t.color.accent} />
          <Text style={s.locationText}>{post.location}</Text>
        </View>
      )}

      {/* Repost: nested original post card */}
      {isRepost && post.original_post && (
        <Pressable
          onPress={onViewOriginal ? () => onViewOriginal(post.original_post!.id) : undefined}
          style={s.repostCard}
        >
          <View style={s.repostHeader}>
            <Pressable
              onPress={() => {
                const op = post.original_post!;
                const opAuthor = op.author || {};
                if (op.roaster_slug && !op.roaster_slug.startsWith("user_"))
                  router.push(`/roaster/${op.roaster_slug}` as any);
                else if (opAuthor.username)
                  router.push(`/user/${opAuthor.username}` as any);
              }}
              style={s.repostAuthorRow}
            >
              {post.original_post.author?.avatar_url ? (
                <CroppedAvatar
                  url={post.original_post.author.avatar_url}
                  cropX={post.original_post.author.avatar_crop_x}
                  cropY={post.original_post.author.avatar_crop_y}
                  zoom={post.original_post.author.avatar_zoom}
                  size={t.size["avatar.xs"]}
                />
              ) : (
                <View style={s.repostAvatarFb}>
                  <Text style={s.repostAvatarLetter}>
                    {(post.original_post.author?.display_name || "?")[0].toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={s.repostAuthor} numberOfLines={1}>
                {post.original_post.author?.display_name}
              </Text>
            </Pressable>
            <Text style={s.repostTime}>{timeAgo(post.original_post.published_at)}</Text>
          </View>
          <Text style={s.repostTeaser} numberOfLines={3}>{post.original_post.teaser}</Text>
          {(post.original_post.images?.length > 0 || post.original_post.cover_image_url) && (
            <View style={{ marginTop: 8 }}>
              <PostGallery
                images={post.original_post.images?.length > 0
                  ? post.original_post.images
                  : [post.original_post.cover_image_url!]}
              />
            </View>
          )}
        </Pressable>
      )}

      {/* Article thumbnail OR gallery */}
      {isArticle && post.cover_image_url ? (
        <View style={s.articleWrap}>
          <Image source={{ uri: resolveUploadUrl(post.cover_image_url) }} style={s.articleImg} contentFit="cover" />
          <View style={s.articleOverlay}>
            {post.title && <Text style={s.articleTitle} numberOfLines={2}>{post.title}</Text>}
            <Text style={s.articleDomain}>
              {post.external_url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
            </Text>
          </View>
        </View>
      ) : (
        <View style={s.galleryWrap}>
          <PostGallery
            images={post.images || (post.cover_image_url ? [post.cover_image_url] : [])}
            onPress={handleOpen}
          />
        </View>
      )}

      {/* Action bar */}
      <ActionBar
        postId={post.id}
        likeCount={post.like_count}
        commentCount={post.comment_count}
        repostCount={post.repost_count}
        likedByMe={post.liked_by_me}
        isRepost={isRepost}
        onComment={onComment ? () => onComment(post) : undefined}
        onRepost={onRepost ? () => onRepost(post) : undefined}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: t.color.bg, paddingTop: 20, paddingBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 14 } as any,
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 } as any,
  avatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-dark"] },
  authorName: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  metaRow: { flexDirection: "row", alignItems: "baseline", gap: 5 } as any,
  metaTime: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.muted"] },
  metaDot: { color: t.color["text.muted"], fontSize: 10 },
  metaSubtitle: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.secondary"], marginTop: 2 },
  bodyWrap: { paddingHorizontal: 20 },
  body: { fontFamily: t.font["body.regular"], fontSize: 16.8, color: t.color["text.primary"], lineHeight: 23.5, marginBottom: 10 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginBottom: 14 } as any,
  locationText: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },

  // Repost nested card
  repostCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, backgroundColor: "#FEFDFB", padding: 12 },
  repostHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 } as any,
  repostAvatarFb: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 8, color: t.color["text.on-dark"] },
  repostAuthor: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.primary"] },
  repostTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: t.color["text.muted"] },
  repostTeaser: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"], lineHeight: 18 },

  // Article thumbnail
  articleWrap: { marginHorizontal: 20, marginBottom: 14, borderRadius: t.radius.md, overflow: "hidden", position: "relative", height: 200 } as any,
  articleImg: { width: "100%" as any, height: "100%" as any },
  articleOverlay: { position: "absolute", bottom: 10, left: 10, backgroundColor: "#FFF", borderRadius: t.radius.md, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "80%" } as any,
  articleTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"], lineHeight: 19, marginBottom: 2 },
  articleDomain: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"] },

  // Gallery
  galleryWrap: { paddingHorizontal: 20 },
});
