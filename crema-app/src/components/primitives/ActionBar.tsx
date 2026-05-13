/**
 * ActionBar — generic like/comment/repost/share bar.
 *
 * Composes Toggle primitives. Used by PostCard, the article reader,
 * the JOURNALS row's compact action bar, and any future engagement
 * surface that rides on the registry's toggle pattern.
 *
 * The bar is parameterised on the (likeResource, targetId) tuple so
 * the same component drives `post_likes` for posts and `article_likes`
 * for articles. The other affordances (comment / repost / share) are
 * delegated to the parent via callback props so the bar stays UI-only.
 *
 * On iOS/Swift: HStack of Buttons.
 */

import { useState, useCallback } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Path } from "react-native-svg";
import Toggle from "./Toggle";
import HapticPressable from "./HapticPressable";
import { showToast } from "../shell/Toast";
import { t, makeStyles } from "../../tokens/useTokens";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import {
  HeartOutlineIcon, HeartFilledOutlineIcon,
  CommentBubbleIcon, ShareNodesIcon,
} from "../icons/FigmaIcons";

interface ActionBarProps {
  /** Toggle resource for the like — defaults to `post_likes` so existing
   *  PostCard call-sites don't need to change. Article surfaces pass
   *  `article_likes` to drive the parallel toggle. */
  likeResource?: string;
  /** ID of the resource being engaged with — `post.id` for posts,
   *  `article.id` for articles. */
  targetId: number;
  likeCount: number;
  commentCount: number;
  repostCount?: number;
  likedByMe: boolean;
  /** Is this a repost? (hides repost button) */
  isRepost?: boolean;
  onComment?: () => void;
  onRepost?: () => void;
  /** Canonical share URL. When provided, the share button copies this
   *  to the clipboard via `expo-clipboard` (native + web) and pops a
   *  "Copied to clipboard" toast.
   *
   *  Pass `https://crema.app/article/{id}` for article surfaces — the
   *  in-app chat (`<ThreadBody>`) detects this exact pattern at render
   *  time and swaps the message bubble for an `<ArticlePreviewCard>`,
   *  giving us a thumbnail-in-chat unfurl with no schema change.
   *  Posts can pass `https://crema.app/post/{id}` — the in-app
   *  chat doesn't yet unfurl those, but the URL stays parseable for
   *  a future handler. */
  shareUrl?: string;
  /** Compact mode — used on the JOURNALS row card, where the bar sits
   *  below a title-only article preview and we want a tighter
   *  presentation: smaller icons, tighter top padding, no "Copied!"
   *  inline label (toast still fires). Mobile sizing kicks in below
   *  via useBreakpoint as usual. */
  compact?: boolean;
}

export default function ActionBar({
  likeResource = "post_likes",
  targetId,
  likeCount, commentCount, repostCount = 0, likedByMe,
  isRepost, onComment, onRepost, shareUrl, compact,
}: ActionBarProps) {
  const { isMobile } = useBreakpoint();
  const [showCopied, setShowCopied] = useState(false);
  const s = useStyles();

  // Mobile: icon sizes match X's timeline action bar — ~20 px
  // heart / comment / repost, ~18 px share. Counts at 14 pt to
  // pair with the 14-pt timestamp / subtitle on the post header.
  // Compact mode (JOURNALS row) shrinks one notch — the bar reads as
  // metadata under the article title, not a primary CTA strip.
  const heartSize = compact ? (isMobile ? 16 : 14) : isMobile ? 20 : 16;
  const commentSize = compact ? (isMobile ? 14 : 12) : isMobile ? 18 : 14;
  const repostSize = compact ? (isMobile ? 14 : 12) : isMobile ? 18 : 14;
  const shareSize = compact ? (isMobile ? 13 : 11) : isMobile ? 16 : 12;

  const handleShare = useCallback(async () => {
    // Resolve the URL to copy. shareUrl wins; web falls back to the
    // current page URL so the existing post-share behavior survives.
    const url =
      shareUrl ||
      (Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.href
        : "");
    if (!url) return;
    try {
      await Clipboard.setStringAsync(url);
    } catch {
      // expo-clipboard rarely throws on supported platforms; the toast
      // / inline label below still fire so the user sees a confirmation.
    }
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1500);
    showToast("Copied to clipboard");
  }, [shareUrl]);

  return (
    <View style={[s.bar, isMobile && s.barMobile, compact && s.barCompact]}>
      {/* Left group — like / comment / repost. Per Figma feed
         spec: these three primary engagement affordances cluster
         on the left of the action row, separated from the share
         icon (which floats to the right via the parent's
         `justifyContent: "space-between"`). */}
      <View style={[s.leftGroup, isMobile && s.leftGroupMobile, compact && s.leftGroupCompact]}>
        <Toggle
          resource={likeResource}
          targetId={targetId}
          initial={likedByMe}
          count={likeCount}
          iconOn={<HeartFilledOutlineIcon size={heartSize} color={t.color.accent} />}
          iconOff={<HeartOutlineIcon size={heartSize} color={t.color.accent} />}
          countSize={compact ? 12 : isMobile ? 14 : 11.8}
          onToggled={(nowLiked) => showToast(nowLiked ? "Liked" : "Unliked")}
          testID={`action-like-${targetId}`}
        />

        <HapticPressable testID={`action-comment-${targetId}`} haptic="tap" onPress={onComment} style={s.btn}>
          <CommentBubbleIcon size={commentSize} color={t.color.accent} />
          <Text style={[s.count, isMobile && s.countMobile, compact && s.countCompact]}>{commentCount}</Text>
        </HapticPressable>

        {!isRepost && (
          <HapticPressable testID={`action-repost-${targetId}`} haptic="tap" onPress={onRepost} style={s.btn}>
            <Svg width={repostSize} height={repostSize} viewBox="0 0 24 24" fill="none">
              <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3"
                stroke={t.color.accent} strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            {repostCount > 0 && <Text style={[s.count, isMobile && s.countMobile, compact && s.countCompact]}>{repostCount}</Text>}
          </HapticPressable>
        )}
      </View>

      {/* Share — pinned to the right edge of the row. */}
      <HapticPressable testID={`action-share-${targetId}`} haptic="tap" onPress={handleShare} style={s.btn}>
        {showCopied && !compact ? (
          <Text style={[s.copiedText, isMobile && s.countMobile]}>Copied!</Text>
        ) : (
          <ShareNodesIcon size={shareSize} color={t.color.accent} />
        )}
      </HapticPressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Bar uses `space-between` to pin the share icon to the right
  // edge of the row; the left group (like / comment / repost)
  // owns its own internal gap.
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12 } as any,
  // Mobile: PostCard already indents the action row with the rest
  // of the X-style content column, so the bar drops its own
  // horizontal padding.
  barMobile: { paddingHorizontal: 0, paddingTop: 10 } as any,
  // Compact mode (JOURNALS row card): tighter top padding so the bar
  // sits right under the article title without an exaggerated gap.
  // Horizontal padding stays at the parent's default — the call-site
  // controls overall card insets.
  barCompact: { paddingTop: 8 } as any,
  // Left cluster — like / comment / repost. Wider gap on mobile
  // matches the bigger icons.
  leftGroup: { flexDirection: "row", alignItems: "center", gap: 20 } as any,
  leftGroupMobile: { gap: 24 } as any,
  // Compact mode: tighter cluster gap so the bar reads as metadata,
  // not a primary affordance row.
  leftGroupCompact: { gap: 14 } as any,
  btn: { flexDirection: "row", alignItems: "center", gap: 6 } as any,
  count: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  copiedText: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color.accent },
  // Mobile: count label sized to match the post subtitle + time
  // (14 pt), keeping the action bar visually inline with the meta
  // rhythm above.
  countMobile: { fontSize: 14 } as any,
  countCompact: { fontSize: 12 } as any,
}));
