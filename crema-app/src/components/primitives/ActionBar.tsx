/**
 * ActionBar — generic like/comment/repost/share bar for posts.
 *
 * Composes Toggle primitives. Used by PostCard.
 * On iOS/Swift: HStack of Buttons.
 */

import { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
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
  postId: number;
  likeCount: number;
  commentCount: number;
  repostCount?: number;
  likedByMe: boolean;
  /** Is this a repost? (hides repost button) */
  isRepost?: boolean;
  onComment?: () => void;
  onRepost?: () => void;
  /** External URL or share URL */
  shareUrl?: string;
}

export default function ActionBar({
  postId, likeCount, commentCount, repostCount = 0, likedByMe,
  isRepost, onComment, onRepost, shareUrl,
}: ActionBarProps) {
  const { isMobile } = useBreakpoint();
  const [showCopied, setShowCopied] = useState(false);
  const s = useStyles();

  // Mobile: icon sizes match X's timeline action bar — ~20 px
  // heart / comment / repost, ~18 px share. Counts at 14 pt to
  // pair with the 14-pt timestamp / subtitle on the post header.
  const heartSize = isMobile ? 20 : 16;
  const commentSize = isMobile ? 18 : 14;
  const repostSize = isMobile ? 18 : 14;
  const shareSize = isMobile ? 16 : 12;

  const handleShare = useCallback(() => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 1500);
    }
  }, [shareUrl]);

  return (
    <View style={[s.bar, isMobile && s.barMobile]}>
      {/* Left group — like / comment / repost. Per Figma feed
         spec: these three primary engagement affordances cluster
         on the left of the action row, separated from the share
         icon (which floats to the right via the parent's
         `justifyContent: "space-between"`). */}
      <View style={[s.leftGroup, isMobile && s.leftGroupMobile]}>
        <Toggle
          resource="post_likes"
          targetId={postId}
          initial={likedByMe}
          count={likeCount}
          iconOn={<HeartFilledOutlineIcon size={heartSize} color={t.color.accent} />}
          iconOff={<HeartOutlineIcon size={heartSize} color={t.color.accent} />}
          countSize={isMobile ? 14 : 11.8}
          onToggled={(nowLiked) => showToast(nowLiked ? "Liked" : "Unliked")}
        />

        <HapticPressable haptic="tap" onPress={onComment} style={s.btn}>
          <CommentBubbleIcon size={commentSize} color={t.color.accent} />
          <Text style={[s.count, isMobile && s.countMobile]}>{commentCount}</Text>
        </HapticPressable>

        {!isRepost && (
          <HapticPressable haptic="tap" onPress={onRepost} style={s.btn}>
            <Svg width={repostSize} height={repostSize} viewBox="0 0 24 24" fill="none">
              <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3"
                stroke={t.color.accent} strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            {repostCount > 0 && <Text style={[s.count, isMobile && s.countMobile]}>{repostCount}</Text>}
          </HapticPressable>
        )}
      </View>

      {/* Share — pinned to the right edge of the row. */}
      <HapticPressable haptic="tap" onPress={handleShare} style={s.btn}>
        {showCopied ? (
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
  // Left cluster — like / comment / repost. Wider gap on mobile
  // matches the bigger icons.
  leftGroup: { flexDirection: "row", alignItems: "center", gap: 20 } as any,
  leftGroupMobile: { gap: 24 } as any,
  btn: { flexDirection: "row", alignItems: "center", gap: 6 } as any,
  count: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  copiedText: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color.accent },
  // Mobile: count label sized to match the post subtitle + time
  // (14 pt), keeping the action bar visually inline with the meta
  // rhythm above.
  countMobile: { fontSize: 14 } as any,
}));
