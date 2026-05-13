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
import { Image } from "expo-image";
import { openExternal } from "../../utils/openExternal";
import { useRouter } from "expo-router";

import { CroppedAvatar, ActionBar, timeAgo } from "../primitives";
import RoasterLogo from "../primitives/RoasterLogo";
import PostGallery, { isTastingNoteEntry as isTNEntry } from "../PostGallery";
import PostMenu from "../PostMenu";
import ArticlePreviewCard from "./ArticlePreviewCard";
import {
  TOPIC_LABELS,
  formatArticleDate,
  estimateReadingTime,
} from "../../utils/articleMeta";
import { t, makeStyles } from "../../tokens/useTokens";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useCoffeeData } from "../../hooks/useCoffeeData";
import { resolveUploadUrl } from "../../api/client";
import { thumbnailUrl } from "../../utils/imageUrl";
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
  const { productMap } = useCoffeeData() as any;
  const s = useStyles();
  const isPinned = !!post.is_pinned;
  const isArticle = post.post_type === "article";
  const isRepost = post.post_type === "repost";
  const isSourcingStory = post.post_type === "sourcing_story";
  const [storyExpanded, setStoryExpanded] = useState(false);

  // Hydrate the tagged coffee (if the post carries a `product_id`)
  // via the shared coffee catalog. Used to render the small in-post
  // coffee chip per Figma 825:2657, and to drive the subtitle copy
  // ("Posted about a coffee" vs the generic "Shared a moment").
  const taggedCoffee =
    (post as any).product_id && productMap?.get?.((post as any).product_id);

  const feedAvatarSize = isMobile ? FEED_AVATAR_MOBILE : t.size["avatar.feed"];
  const repostAvatarSize = isMobile ? NESTED_AVATAR_MOBILE : t.size["avatar.xs"];

  const subtitleText = isPinned ? "Pinned"
    : post.post_type === "tasting_note" ? "Posted a tasting note"
    : post.post_type === "note" && taggedCoffee ? "Posted about a coffee"
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
      {/* Location lives UNDER the subtitle in the header (Figma
          825:2639 et al). Renders a small pin glyph + place name
          below "Posted about a coffee" / "Shared a moment" so the
          location reads as a metadata trail rather than a body
          element. The standalone body location row is removed
          below — the user's spec puts location here, not down with
          the body. */}
      {post.location ? (
        <View style={s.headerLocationRow}>
          <PostLocationPinIcon
            size={isMobile ? 13 : 11}
            color={t.color.accent}
          />
          <Text
            style={[
              s.headerLocationText,
              isMobile && s.headerLocationTextMobile,
            ]}
            numberOfLines={1}
          >
            {post.location}
          </Text>
        </View>
      ) : null}
    </>
  );

  // On mobile with onOpen wired, the outer card Pressable catches
  // the tap — drop the inner Pressable so the touch falls through.
  // On web the body still wraps a Pressable for article / link posts
  // whose primary action is "open the external URL".
  //
  // bodyEl is null when post.teaser is empty — most relevant for
  // commentless reposts (user reposts without adding their own
  // comment): without this guard the empty Text would still
  // reserve a line of vertical space above the nested repost
  // card, leaving a visible blank gap. The guard also covers
  // image-only / tasting-note posts that ship without body copy.
  const mobileTapToOpen = isMobile && !!onOpen;
  const hasTeaser = !!(post.teaser && post.teaser.trim());
  const bodyEl = !hasTeaser ? null : mobileTapToOpen ? (
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

  // Body location row retired — location now renders in the header
  // under the subtitle (see `nameBlock` above). Keeping the const
  // null here so the existing JSX that reads `locationEl` doesn't
  // need surgical changes; the body simply renders nothing.
  const locationEl = null;

  // Tagged-coffee chip — Figma 825:2657 / 801:132. Renders BELOW
  // the image (and any other body media) when the post carries a
  // `product_id`. Unlike the composer's chip (image-left), the
  // feed chip puts the text on the LEFT and a 60×62 image at the
  // RIGHT edge of the 350-wide row. Tap to navigate to the
  // coffee's detail screen.
  const taggedCoffeeChipEl = taggedCoffee ? (
    <Pressable
      onPress={() =>
        router.push(`/coffee/${(taggedCoffee as any).product_id}` as any)
      }
      style={isMobile ? s.coffeeChipMobile : s.coffeeChip}
      accessibilityRole="button"
      accessibilityLabel={`Open ${(taggedCoffee as any).coffee_name}`}
    >
      <View style={s.coffeeChipText}>
        <Text style={s.coffeeChipName} numberOfLines={2} ellipsizeMode="tail">
          {(taggedCoffee as any).coffee_name}
        </Text>
        <Text
          style={s.coffeeChipRoaster}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          By {(taggedCoffee as any).roaster_name || "—"}
        </Text>
      </View>
      {(() => {
        const raw =
          (taggedCoffee as any).hero_image || (taggedCoffee as any).image_url;
        if (!raw) return <View style={s.coffeeChipImage} />;
        const resolved = resolveUploadUrl(raw) || raw;
        const src = thumbnailUrl(resolved, 200) || resolved;
        return (
          <View style={s.coffeeChipImage}>
            <Image
              source={{ uri: src }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={150}
            />
          </View>
        );
      })()}
    </Pressable>
  ) : null;

  // Article repost branch — when a roaster_post carries
  // `repost_of_article_id`, the cross-resource embed populates
  // `original_article` with the article row's full payload. The
  // user's directive: render it editorial-style (heading, byline,
  // synopsis, reading time, Read-article pill) inside the existing
  // `repostCard` chrome — no hero, no domain, no extra roaster
  // header. Same content shape as the chat-bubble unfurl, just
  // wrapped in the cream `card.product.subtle` card chrome.
  const repostArticleEl = isRepost && post.original_article ? (() => {
    const a = post.original_article!;
    const tagLabel = a.topic_category
      ? TOPIC_LABELS[a.topic_category] || null
      : null;
    // Display the article's own publish date only — never the scrape
    // day. NULL published_at hides the date cleanly.
    const dateLabel = formatArticleDate(a.published_at);
    const readingTime = estimateReadingTime(a.word_count);
    return (
      <Pressable
        onPress={() => router.push(`/article/${a.id}` as any)}
        style={isMobile ? s.repostCardMobile : s.repostCard}
        accessibilityRole="link"
        accessibilityLabel={`Open article: ${a.title}`}
      >
        {(tagLabel || dateLabel) ? (
          <View style={s.articleEditorialMetaRow}>
            {tagLabel ? <Text style={s.articleEditorialMeta}>{tagLabel}</Text> : null}
            {dateLabel ? <Text style={s.articleEditorialMeta}>{dateLabel}</Text> : null}
          </View>
        ) : null}
        <Text style={s.articleEditorialTitle} numberOfLines={3}>
          {a.title}
        </Text>
        {a.roaster_name ? (
          <Text style={s.articleEditorialByline} numberOfLines={1}>
            By {a.roaster_name}
          </Text>
        ) : null}
        {a.excerpt ? (
          <Text style={s.articleEditorialExcerpt}>{a.excerpt}</Text>
        ) : null}
        {readingTime ? (
          <Text style={s.articleEditorialMeta}>{readingTime}</Text>
        ) : null}
        <Pressable
          onPress={() => router.push(`/article/${a.id}` as any)}
          style={s.articleEditorialCta}
          accessibilityRole="link"
        >
          <Text style={s.articleEditorialCtaLabel}>Read article →</Text>
        </Pressable>
      </Pressable>
    );
  })() : null;

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
        // If the reposted post is an ARTICLE, render the canonical
        // ArticlePreviewCard so reposts match the top-level article
        // presentation (Figma 801:155).
        const op = post.original_post as any;
        const opIsArticle = op?.post_type === "article";
        if (opIsArticle && (op.title || op.external_url || op.cover_image_url)) {
          return (
            <View style={{ marginTop: 8 }}>
              <ArticlePreviewCard
                title={op.title}
                sourceUrl={op.external_url}
                imageUrl={op.cover_image_url}
                onPress={() => {
                  if (op.external_url) openExternal(op.external_url);
                }}
              />
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
  // Single-image note posts get the Figma 825:2669 hero treatment
  // (350-wide × ~266-tall, aspect 349/266 ≈ 1.31). PostGallery's
  // 3-up thumbnail strip is appropriate when the post carries
  // multiple images, but for a single hero image it renders as a
  // tiny 1/3-width thumbnail which the user (rightly) called out
  // as "looks like shit." Branch on count and render the single-
  // image case directly.
  const allImages =
    post.images && post.images.length > 0
      ? post.images
      : post.cover_image_url
        ? [post.cover_image_url]
        : [];
  const isSingleImageNote =
    !isArticle && allImages.length === 1 && !isTNEntry(allImages[0]);

  const articleOrGalleryEl = isArticle ? (
    <View style={isMobile ? s.articleWrapMobile : s.articleWrap}>
      <ArticlePreviewCard
        title={post.title}
        sourceUrl={post.external_url}
        imageUrl={post.cover_image_url}
        onPress={mediaTapHandler}
      />
    </View>
  ) : isSingleImageNote ? (
    <Pressable
      onPress={mediaTapHandler}
      style={isMobile ? s.singleImageWrapMobile : s.singleImageWrap}
      accessibilityRole="button"
      accessibilityLabel="Open post"
    >
      <Image
        source={{ uri: resolveUploadUrl(allImages[0]) || allImages[0] }}
        style={s.singleImage}
        contentFit="cover"
        transition={150}
      />
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
      // likeResource defaults to "post_likes" — keep the default; the
      // article reader passes `article_likes` explicitly.
      targetId={post.id}
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
    // Mobile layout: the avatar lives INLINE in the header row only
    // (alongside the author name + subtitle + 3-dots menu); the body,
    // location, repost embed, article/gallery, and action bar all
    // sit BELOW the header at the card's full content width — no
    // X-style indent. The user's mental model: "the post's text
    // should start at the same x as the avatar's left edge." That's
    // what this layout produces — body/article/actionbar all start
    // at `cardMobile.paddingLeft` (16), which is exactly where the
    // avatar's left edge sits.
    //
    // Tap-to-open: the card itself is the affordance to reach
    // PostModal. Nested Pressables (avatar / name → author, repost
    // inner → original, story toggle, media) claim touches in their
    // regions first; the outer Pressable only fires when the user
    // tapped empty space or the body text.
    const CardContainer: any = mobileTapToOpen ? Pressable : View;
    const containerProps = mobileTapToOpen
      ? { onPress: () => onOpen!(post), style: s.cardMobile, testID: `post-card-${post.id}` }
      : { style: s.cardMobile, testID: `post-card-${post.id}` };
    return (
      <CardContainer {...containerProps}>
        <View style={s.headerRowMobile}>
          <Pressable onPress={goToAuthor}>
            {authorAvatar}
          </Pressable>
          <Pressable onPress={goToAuthor} style={s.headerNameWrapMobile}>
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
        {repostArticleEl}
        {repostEl}
        {articleOrGalleryEl}
        {taggedCoffeeChipEl}
        {actionBarEl}
      </CardContainer>
    );
  }

  // ── Web wide: historical layout ─────────────────────────────────

  return (
    <View testID={`post-card-${post.id}`} style={s.card}>
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
      {repostArticleEl}
      {repostEl}
      {articleOrGalleryEl}
      {taggedCoffeeChipEl}
      {actionBarEl}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Web wide
  card: { backgroundColor: t.color.bg, paddingTop: 20, paddingBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 14 } as any,
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 } as any,

  // Mobile post card. Symmetric 20-px horizontal padding per
  // Figma 801:103 — the action bar's like-cluster sits at x=20
  // and the share icon ends at x≈370 on the 390-wide canvas, i.e.
  // 20 from each screen edge. Body text, location row, repost
  // embed, article preview, and actionbar all line up at this
  // 20-px inset. (Earlier passes split this — paddingLeft 16,
  // paddingRight 8 — to "widen" the text on the right; that
  // produced visibly mismatched padding on the like vs share
  // icons + a too-tight repost-card right edge, which was the
  // user's complaint in the §2.40.22 follow-up.)
  // Vertical padding: 30 each side (Figma 801:103 — the action
  // bar's bottom edge sits 30 px above the divider, and the next
  // post header sits 30 px below the divider; total 60 px between
  // adjacent post content blocks).
  cardMobile: { backgroundColor: t.color.bg, paddingHorizontal: t.spacing.xl, paddingVertical: 30 } as any,
  // Header row hosts the avatar + name/subtitle + 3-dots menu
  // inline. The body and everything below this row sit at the
  // cardMobile level (full content width), NOT inside an X-style
  // right column — that's why this is the only row that needs the
  // avatar gap, and why the row's marginBottom (8) is the only
  // breathing room between header and body.
  headerRowMobile: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    marginBottom: t.spacing.sm,
  } as any,
  // Name + subtitle column inside headerRowMobile. flex:1 so the
  // 3-dots menu pins to the right edge, minWidth:0 so a long
  // display name truncates instead of pushing the menu off-screen.
  headerNameWrapMobile: { flex: 1, minWidth: 0 } as any,

  avatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-cta"] },
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

  // Legacy body-location styles, kept so any external surface still
  // referencing them compiles. The current layout renders the
  // location in the header (see `headerLocationRow*` below) — these
  // are inert.
  locationRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginBottom: 14 } as any,
  locationRowMobile: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 2 } as any,
  locationText: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  locationTextMobile: { fontSize: 14 } as any,

  // ── Header location (under the subtitle) ────────────────────
  // Sits inside the `nameBlock` column, below "Posted about a
  // coffee" / "Shared a moment". Pin glyph in Crema pink + warm-
  // brown muted text reads as a metadata trail rather than a
  // body element.
  headerLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  } as any,
  headerLocationText: {
    fontFamily: t.font["body.medium"],
    fontSize: 10,
    color: t.color["text.secondary"],
    flexShrink: 1,
  } as any,
  headerLocationTextMobile: {
    fontSize: 13,
  } as any,

  // ── Single-image hero (Figma 825:2669) ──────────────────────
  // Used when a "Posted about a coffee" / "Shared a moment" post
  // carries exactly one image. 349/266 aspect (≈1.31) per the
  // Figma frame. The 350-wide footprint matches the rest of the
  // body block; height auto-derives via aspectRatio so the box
  // grows / shrinks with the parent without manual math.
  singleImageWrap: {
    width: 350,
    aspectRatio: 349 / 266,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: t.color["card.info"],
    marginTop: 12,
    alignSelf: "flex-start",
  } as any,
  singleImageWrapMobile: {
    width: 350,
    aspectRatio: 349 / 266,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: t.color["card.info"],
    marginTop: 12,
  } as any,
  singleImage: {
    width: "100%" as any,
    height: "100%" as any,
  } as any,

  // ── Tagged-coffee chip (Figma 825:2657 / 801:132) ──────────
  // Renders below the gallery on a "Posted about a coffee" post.
  // 350-wide row with text-left, image-right (60×62). Different
  // from the composer's chip (image-left, X on right) — this is
  // the read-only feed presentation.
  coffeeChip: {
    flexDirection: "row",
    width: 350,
    height: 62,
    backgroundColor: t.color["card.product.bg"],
    borderRadius: 5,
    overflow: "hidden",
    marginTop: 12,
    alignSelf: "flex-start",
    paddingLeft: 0,
    paddingRight: 0,
  } as any,
  coffeeChipMobile: {
    flexDirection: "row",
    height: 62,
    backgroundColor: t.color["card.product.bg"],
    borderRadius: 5,
    overflow: "hidden",
    marginTop: 12,
  } as any,
  coffeeChipText: {
    flex: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
  } as any,
  coffeeChipName: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    lineHeight: 18,
    color: t.color["card.product.text"],
  } as any,
  coffeeChipRoaster: {
    fontFamily: t.font["body.medium"],
    fontSize: 11,
    lineHeight: 14,
    color: t.color["card.product.text.muted"],
    marginTop: 3,
  } as any,
  coffeeChipImage: {
    width: 60,
    height: 62,
    backgroundColor: t.color["card.info"],
  } as any,

  // Repost nested card
  // Nested repost (the original post being quoted). Always-light card
  // floating on the dark page bg in dark mode (and on cream in light
  // mode). All text + avatar inside is pinned to always-dark values
  // so the inner card stays readable in both modes — the outer wrapper
  // is just the page bg, which already provides the dark backdrop in
  // night mode that the user wants behind the light inner card.
  repostCard: { marginHorizontal: 20, marginBottom: 14, borderRadius: t.radius.md, backgroundColor: t.color["card.product.subtle"], padding: 12 },
  // cardMobile is now symmetric 20-px horizontal padding, so the
  // repost embed inherits equal screen-edge spacing without a
  // marginRight band-aid. (The earlier `marginRight: 8` was
  // compensating for cardMobile's asymmetric 16/8 padding —
  // dropped along with that asymmetry.)
  repostCardMobile: { marginTop: 6, marginBottom: 8, borderRadius: t.radius.md, backgroundColor: t.color["card.product.subtle"], padding: 12 } as any,
  // ── Article repost editorial layout ─────────────────────────
  // Same content shape as the chat-bubble article unfurl (tag/date
  // · title · byline · excerpt · reading time · Read article pill)
  // but on the cream `card.product.subtle` chrome of the repost
  // card. All text uses `card.product.text*` constants so the card
  // stays light in both modes — this is an "always-light identity
  // surface" the same way the CoffeeCard is.
  articleEditorialMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    marginBottom: 4,
  } as any,
  articleEditorialMeta: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["card.product.text.muted"],
    letterSpacing: 0.2,
  } as any,
  articleEditorialTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["card.product.text"],
  } as any,
  articleEditorialByline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["card.product.text.muted"],
    marginTop: 2,
  } as any,
  articleEditorialExcerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 20,
    color: t.color["card.product.text"],
    marginTop: 6,
    marginBottom: 6,
  } as any,
  // CTA pill — Crema pink fill + Espresso text, same as the
  // chat-bubble's other-side CTA. Self-aligned to flex-start so the
  // pill hugs its content rather than stretching the card width.
  articleEditorialCta: {
    alignSelf: "flex-start" as any,
    flexDirection: "row" as any,
    alignItems: "center" as any,
    backgroundColor: t.color["accent.cta"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs + 2,
    borderRadius: t.radius.full,
    marginTop: 6,
  } as any,
  articleEditorialCtaLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    letterSpacing: 0.4,
  } as any,
  repostHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 } as any,
  repostAvatarFb: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.color["text.on-light"], alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 8, color: t.color["text.on-dark"] },
  repostAuthor: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.on-light"] },
  repostTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: t.color["card.product.text.muted"] },
  // Nested repost text — same 15-pt rhythm as the outer post so
  // the quoted body reads at full weight. The wrapper still shows
  // the full teaser (no numberOfLines truncation on mobile).
  repostAuthorMobile: { fontSize: 15, fontFamily: t.font["body.semibold"] } as any,
  repostTimeMobile: { fontSize: 14 } as any,
  repostAvatarLetterMobile: { fontSize: 10 } as any,
  repostTeaser: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["card.product.text.muted"], lineHeight: 18 },
  repostTeaserMobile: { fontSize: 15, lineHeight: 20, color: t.color["text.on-light"] } as any,

  // Article thumbnail
  // Article wrappers carry only the surrounding spacing — the card
  // surface (white bg, radius, shadow, title/domain/hero layout) is
  // owned by `<ArticlePreviewCard>` so PostCard and the JOURNALS
  // ArticleCard stay visually identical (Figma 801:155).
  articleWrap: { marginHorizontal: t.spacing.xl, marginBottom: t.spacing.md } as any,
  articleWrapMobile: { marginTop: t.spacing.xs, marginBottom: t.spacing.sm } as any,

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
}));
