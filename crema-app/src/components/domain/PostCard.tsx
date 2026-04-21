/**
 * PostCard — universal post card used in feeds, profiles, and roaster pages.
 *
 * Composes primitives: CroppedAvatar, ActionBar, TimeAgo.
 * Reads design tokens — no hardcoded colors or sizes.
 *
 * On iOS/Swift: equivalent SwiftUI view composing the same primitives.
 *
 * Two render paths:
 * - Mobile (isMobile): X-style layout. Avatar is a fixed left column
 *   (~45 px, 50% bigger than feed default). Everything else — name,
 *   subtitle, body, location, nested repost, gallery, action bar —
 *   sits in a right column indented to align with the author name,
 *   so content reads as a single consistently-indented stream.
 * - Web wide: the historical layout — avatar lives inline with the
 *   name block in the header, then body + media + action bar span
 *   the full card width below.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { openExternal } from "../../utils/openExternal";
import { useRouter } from "expo-router";
import { Image } from "expo-image";

import { CroppedAvatar, ActionBar, timeAgo } from "../primitives";
import PostGallery from "../PostGallery";
import PostMenu from "../PostMenu";
import { resolveUploadUrl } from "../../api/client";
import { t } from "../../tokens/useTokens";
import { useBreakpoint } from "../../hooks/useBreakpoint";
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
  /** Feed rows on mobile replace the ActionBar with swipe gestures
   *  (§2.40.11). Set this true on mobile feed call-sites so the
   *  bar is omitted; PostModal + non-feed surfaces keep it. */
  hideActionBar?: boolean;
  /** Mobile-only tap-to-open. With the ActionBar hidden on mobile,
   *  the card itself becomes the affordance: tap anywhere that isn't
   *  the avatar / name / repost-inner claims → open the PostModal
   *  in view mode. Web wide ignores this — its ActionBar carries
   *  explicit comment / like / repost buttons. */
  onOpen?: (post: Post) => void;
  /** Non-owner three-dots menu handlers. Fed from `postMenuActions`
   *  in call-sites. See the recommender-engine roadmap entry. */
  onHide?: (post: Post) => void;
  onReport?: (post: Post) => void;
  onDislike?: (post: Post) => void;
}

// X-style mobile sizing.
// Avatar is 50% bigger than the feed default (30 → 45). Text rows
// are +50% from their web baseline (11.8 → 17.7 for the name,
// 10 → 15 for the subtitle + timestamp). Icons in ActionBar are
// +50% separately (see ActionBar.tsx).
const FEED_AVATAR_MOBILE = Math.round(t.size["avatar.feed"] * 1.5);
const NESTED_AVATAR_MOBILE = Math.round(t.size["avatar.xs"] * 1.5);

export default function PostCard({
  post, user, isOwner, onComment, onRepost, onViewOriginal, onEdit, onPin, onDelete,
  hideActionBar, onOpen, onHide, onReport, onDislike,
}: PostCardProps) {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const isPinned = !!post.is_pinned;
  const isArticle = post.post_type === "article";
  const isRepost = post.post_type === "repost";
  const isSourcingStory = post.post_type === "sourcing_story";
  const [storyExpanded, setStoryExpanded] = useState(false);

  const feedAvatarSize = isMobile ? FEED_AVATAR_MOBILE : t.size["avatar.feed"];
  const repostAvatarSize = isMobile ? NESTED_AVATAR_MOBILE : t.size["avatar.xs"];

  const subtitleText = isPinned ? "Pinned"
    : post.post_type === "tasting_note" ? "Posted a tasting note"
    : post.post_type === "note" ? "Shared a moment"
    : isRepost ? "Reposted"
    : isSourcingStory ? "Shared a long-form post"
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
    if (post.external_url) openExternal(post.external_url);
  };

  // ── Shared content blocks ────────────────────────────────────────

  const authorAvatar = author.avatar_url ? (
    <CroppedAvatar
      url={author.avatar_url}
      cropX={author.avatar_crop_x}
      cropY={author.avatar_crop_y}
      zoom={author.avatar_zoom}
      size={feedAvatarSize}
    />
  ) : (
    <View style={[
      s.avatarFb,
      isMobile && { width: feedAvatarSize, height: feedAvatarSize, borderRadius: feedAvatarSize / 2 },
    ]}>
      <Text style={[s.avatarLetter, isMobile && s.avatarLetterMobile]}>
        {(author.display_name || "?")[0].toUpperCase()}
      </Text>
    </View>
  );

  const nameBlock = (
    <>
      <View style={s.metaRow}>
        <Text style={[s.authorName, isMobile && s.authorNameMobile]}>{author.display_name}</Text>
        <Text style={[s.metaTime, isMobile && s.metaTimeMobile]}>{timeAgo(post.published_at)}</Text>
      </View>
      <Text style={[s.metaSubtitle, isMobile && s.metaSubtitleMobile]}>{subtitleText}</Text>
    </>
  );

  // On mobile with onOpen wired, the outer card Pressable catches
  // the tap — drop the inner Pressable so the touch falls through.
  // On web the body still wraps a Pressable for article / link posts
  // whose primary action is "open the external URL".
  const mobileTapToOpen = isMobile && !!onOpen;
  const bodyEl = mobileTapToOpen ? (
    <Text style={[s.body, s.bodyMobile]}>{post.teaser}</Text>
  ) : (
    <Pressable onPress={isRepost ? undefined : handleOpen}>
      <Text style={[s.body, isMobile && s.bodyMobile]}>{post.teaser}</Text>
    </Pressable>
  );

  const storyEl = isSourcingStory && post.body_full ? (
    <View style={isMobile ? s.storyWrapMobile : s.storyWrap}>
      {storyExpanded ? (
        <>
          <Text style={s.storyBody}>{post.body_full}</Text>
          <Pressable onPress={() => setStoryExpanded(false)} hitSlop={8}>
            <Text style={s.storyToggle}>Show less</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => setStoryExpanded(true)} hitSlop={8}>
          <Text style={s.storyToggle}>Read the full post →</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  const locationEl = post.location ? (
    <View style={isMobile ? s.locationRowMobile : s.locationRow}>
      <PostLocationPinIcon size={isMobile ? 16 : 12} color={t.color.accent} />
      <Text style={[s.locationText, isMobile && s.locationTextMobile]}>{post.location}</Text>
    </View>
  ) : null;

  const repostEl = isRepost && post.original_post ? (
    <Pressable
      onPress={onViewOriginal ? () => onViewOriginal(post.original_post!.id) : undefined}
      style={isMobile ? s.repostCardMobile : s.repostCard}
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
              size={repostAvatarSize}
            />
          ) : (
            <View style={[
              s.repostAvatarFb,
              isMobile && { width: repostAvatarSize, height: repostAvatarSize, borderRadius: repostAvatarSize / 2 },
            ]}>
              <Text style={[s.repostAvatarLetter, isMobile && s.repostAvatarLetterMobile]}>
                {(post.original_post.author?.display_name || "?")[0].toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[s.repostAuthor, isMobile && s.repostAuthorMobile]} numberOfLines={1}>
            {post.original_post.author?.display_name}
          </Text>
        </Pressable>
        <Text style={[s.repostTime, isMobile && s.repostTimeMobile]}>{timeAgo(post.original_post.published_at)}</Text>
      </View>
      <Text
        style={[s.repostTeaser, isMobile && s.repostTeaserMobile]}
        numberOfLines={isMobile ? undefined : 3}
      >
        {post.original_post.teaser}
      </Text>
      {(() => {
        // If the reposted post is an ARTICLE, render the article card
        // (cover image + title/domain overlay) instead of falling back
        // to a single thumbnail in the gallery strip. Matches the
        // top-level article presentation so reposts don't mangle the
        // original's layout. (§postmodal-redo)
        const op = post.original_post as any;
        const opIsArticle = op?.post_type === "article";
        if (opIsArticle && op.cover_image_url) {
          return (
            <View style={{ marginTop: 8 }}>
              <View style={isMobile ? s.articleWrapMobile : s.articleWrap}>
                <Image source={{ uri: resolveUploadUrl(op.cover_image_url) }} style={s.articleImg} contentFit="cover" />
                <View style={s.articleOverlay}>
                  {op.title && <Text style={s.articleTitle} numberOfLines={2}>{op.title}</Text>}
                  {op.external_url && (
                    <Text style={s.articleDomain}>
                      {op.external_url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          );
        }
        if (op?.images?.length > 0 || op?.cover_image_url) {
          return (
            <View style={{ marginTop: 8 }}>
              <PostGallery
                images={op.images?.length > 0
                  ? op.images
                  : [op.cover_image_url!]}
              />
            </View>
          );
        }
        return null;
      })()}
    </Pressable>
  ) : null;

  // Mobile tap-to-open: article + gallery route taps to the modal
  // instead of the external URL. The link is reachable inside the
  // modal. Web wide keeps the direct external-URL affordance.
  const mediaTapHandler = mobileTapToOpen ? () => onOpen!(post) : handleOpen;
  const articleOrGalleryEl = isArticle && post.cover_image_url ? (
    <Pressable onPress={mediaTapHandler} style={isMobile ? s.articleWrapMobile : s.articleWrap}>
      <Image source={{ uri: resolveUploadUrl(post.cover_image_url) }} style={s.articleImg} contentFit="cover" />
      <View style={s.articleOverlay}>
        {post.title && <Text style={s.articleTitle} numberOfLines={2}>{post.title}</Text>}
        <Text style={s.articleDomain}>
          {post.external_url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
        </Text>
      </View>
    </Pressable>
  ) : (
    <View style={isMobile ? s.galleryWrapMobile : s.galleryWrap}>
      <PostGallery
        images={post.images || (post.cover_image_url ? [post.cover_image_url] : [])}
        onPress={mediaTapHandler}
      />
    </View>
  );

  const actionBarEl = hideActionBar ? null : (
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
  );

  // ── Mobile: X-style indent ───────────────────────────────────────

  if (isMobile) {
    // Tap-to-open: on mobile the card itself is the affordance to
    // reach the PostModal. Nested Pressables (avatar → author, name
    // block → author, repost inner → original, story toggle, media)
    // claim touches in their regions first; the outer Pressable only
    // fires when the user tapped empty space or the body text.
    const CardContainer: any = mobileTapToOpen ? Pressable : View;
    const containerProps = mobileTapToOpen
      ? { onPress: () => onOpen!(post), style: s.cardMobile }
      : { style: s.cardMobile };
    return (
      <CardContainer {...containerProps}>
        <View style={s.cardRowMobile}>
          {/* Avatar column — tap routes to author. */}
          <Pressable onPress={goToAuthor} style={s.avatarColMobile}>
            {authorAvatar}
          </Pressable>

          {/* Content column — everything indented to align with the
              author name. */}
          <View style={s.contentColMobile}>
            <View style={s.headerRowMobile}>
              <Pressable onPress={goToAuthor} style={{ flex: 1 }}>
                {nameBlock}
              </Pressable>
              <PostMenu
                onEdit={isOwner && onEdit ? () => onEdit(post) : undefined}
                onPin={isOwner && onPin ? () => onPin(post) : undefined}
                onDelete={isOwner && onDelete ? () => onDelete(post) : undefined}
                isPinned={isPinned}
                onHide={!isOwner && onHide ? () => onHide(post) : undefined}
                onReport={!isOwner && onReport ? () => onReport(post) : undefined}
                onDislike={!isOwner && onDislike ? () => onDislike(post) : undefined}
              />
            </View>
            {bodyEl}
            {storyEl}
            {locationEl}
            {repostEl}
            {articleOrGalleryEl}
            {actionBarEl}
          </View>
        </View>
      </CardContainer>
    );
  }

  // ── Web wide: historical layout ─────────────────────────────────

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.headerRow}>
        <Pressable onPress={goToAuthor} style={s.header}>
          {authorAvatar}
          <View style={{ flex: 1 }}>{nameBlock}</View>
        </Pressable>
        <PostMenu
          onEdit={isOwner && onEdit ? () => onEdit(post) : undefined}
          onPin={isOwner && onPin ? () => onPin(post) : undefined}
          onDelete={isOwner && onDelete ? () => onDelete(post) : undefined}
          isPinned={isPinned}
          onHide={!isOwner && onHide ? () => onHide(post) : undefined}
          onReport={!isOwner && onReport ? () => onReport(post) : undefined}
          onDislike={!isOwner && onDislike ? () => onDislike(post) : undefined}
        />
      </View>
      <View style={s.bodyWrap}>{bodyEl}</View>
      {storyEl}
      {locationEl}
      {repostEl}
      {articleOrGalleryEl}
      {actionBarEl}
    </View>
  );
}

const s = StyleSheet.create({
  // Web wide
  card: { backgroundColor: t.color.bg, paddingTop: 20, paddingBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 14 } as any,
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 } as any,

  // Mobile X-style layout
  cardMobile: { backgroundColor: t.color.bg, paddingHorizontal: 16, paddingVertical: 14 } as any,
  cardRowMobile: { flexDirection: "row", alignItems: "flex-start", gap: 12 } as any,
  avatarColMobile: { flexShrink: 0 } as any,
  contentColMobile: { flex: 1, minWidth: 0 } as any,
  headerRowMobile: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 } as any,

  avatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-dark"] },
  authorName: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  metaRow: { flexDirection: "row", alignItems: "baseline", gap: 5 } as any,
  metaTime: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.muted"] },
  metaSubtitle: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.secondary"], marginTop: 2 },

  // Mobile text scale — matches X's timeline density:
  // name 15 (semibold), subtitle + time 14 (medium/muted), body 15
  // (regular). Same 15-pt rhythm X uses for all three; the name
  // reads as bolder via fontFamily, subtitle/time lighter via
  // color. Tight enough to fit 2-3 posts on a 390-px viewport
  // with the chrome still visible.
  authorNameMobile: { fontSize: 15, fontFamily: t.font["body.semibold"] } as any,
  metaTimeMobile: { fontSize: 14 } as any,
  metaSubtitleMobile: { fontSize: 14, marginTop: 1 } as any,
  avatarLetterMobile: { fontSize: 16 } as any,

  bodyWrap: { paddingHorizontal: 20 },
  body: { fontFamily: t.font["body.regular"], fontSize: 16.8, color: t.color["text.primary"], lineHeight: 23.5, marginBottom: 10 },
  bodyMobile: { fontSize: 15, lineHeight: 20, marginTop: 4, marginBottom: 8 } as any,

  locationRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginBottom: 14 } as any,
  locationRowMobile: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 2 } as any,
  locationText: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  locationTextMobile: { fontSize: 14 } as any,

  // Repost nested card
  repostCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, backgroundColor: "#FEFDFB", padding: 12 },
  repostCardMobile: { marginTop: 6, marginBottom: 8, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, backgroundColor: "#FEFDFB", padding: 12 } as any,
  repostHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 } as any,
  repostAvatarFb: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 8, color: t.color["text.on-dark"] },
  repostAuthor: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.primary"] },
  repostTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: t.color["text.muted"] },
  // Nested repost text — same 15-pt rhythm as the outer post so
  // the quoted body reads at full weight. The wrapper still shows
  // the full teaser (no numberOfLines truncation on mobile).
  repostAuthorMobile: { fontSize: 15, fontFamily: t.font["body.semibold"] } as any,
  repostTimeMobile: { fontSize: 14 } as any,
  repostAvatarLetterMobile: { fontSize: 10 } as any,
  repostTeaser: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"], lineHeight: 18 },
  repostTeaserMobile: { fontSize: 15, lineHeight: 20, color: t.color["text.primary"] } as any,

  // Article thumbnail
  articleWrap: { marginHorizontal: 20, marginBottom: 14, borderRadius: t.radius.md, overflow: "hidden", position: "relative", height: 200 } as any,
  articleWrapMobile: { marginTop: 6, marginBottom: 10, borderRadius: t.radius.md, overflow: "hidden", position: "relative", height: 200 } as any,
  articleImg: { width: "100%" as any, height: "100%" as any },
  articleOverlay: { position: "absolute", bottom: 10, left: 10, backgroundColor: "#FFF", borderRadius: t.radius.md, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "80%" } as any,
  articleTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"], lineHeight: 19, marginBottom: 2 },
  articleDomain: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"] },

  // Gallery
  galleryWrap: { paddingHorizontal: 20 },
  galleryWrapMobile: { marginTop: 6 } as any,

  // Sourcing story (§2.3)
  storyWrap: { paddingHorizontal: 20, marginBottom: 14 } as any,
  storyWrapMobile: { marginTop: 4, marginBottom: 10 } as any,
  storyBody: {
    fontFamily: t.font["body.regular"], fontSize: 15,
    color: t.color["text.primary"], lineHeight: 22, marginBottom: 8,
  } as any,
  storyToggle: {
    fontFamily: t.font["body.semibold"], fontSize: 12,
    color: t.color.accent, letterSpacing: 0.3,
  } as any,
});
