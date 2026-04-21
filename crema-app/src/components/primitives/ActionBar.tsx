/**
 * ActionBar — generic like/comment/repost/share bar for posts.
 *
 * Composes Toggle primitives. Used by PostCard.
 * On iOS/Swift: HStack of Buttons.
 */

import { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import Toggle from "./Toggle";
import { t } from "../../tokens/useTokens";
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

  // Mobile: icons +50% (16→24 / 14→21 / 12→18), count +50%.
  const heartSize = isMobile ? 24 : 16;
  const commentSize = isMobile ? 21 : 14;
  const repostSize = isMobile ? 21 : 14;
  const shareSize = isMobile ? 18 : 12;

  const handleShare = useCallback(() => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 1500);
    }
  }, [shareUrl]);

  return (
    <View style={s.bar}>
      <Toggle
        resource="post_likes"
        targetId={postId}
        initial={likedByMe}
        count={likeCount}
        iconOn={<HeartFilledOutlineIcon size={heartSize} color={t.color.accent} />}
        iconOff={<HeartOutlineIcon size={heartSize} color={t.color.accent} />}
        countSize={isMobile ? 17.7 : 11.8}
      />

      <Pressable onPress={onComment} style={s.btn}>
        <CommentBubbleIcon size={commentSize} color={t.color.accent} />
        <Text style={[s.count, isMobile && s.countMobile]}>{commentCount}</Text>
      </Pressable>

      {!isRepost && (
        <Pressable onPress={onRepost} style={s.btn}>
          <Svg width={repostSize} height={repostSize} viewBox="0 0 24 24" fill="none">
            <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3"
              stroke={t.color.accent} strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          {repostCount > 0 && <Text style={[s.count, isMobile && s.countMobile]}>{repostCount}</Text>}
        </Pressable>
      )}

      <Pressable onPress={handleShare} style={s.btn}>
        {showCopied ? (
          <Text style={[s.copiedText, isMobile && s.countMobile]}>Copied!</Text>
        ) : (
          <ShareNodesIcon size={shareSize} color={t.color.accent} />
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: 20, paddingTop: 12 } as any,
  btn: { flexDirection: "row", alignItems: "center", gap: 6 } as any,
  count: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  copiedText: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color.accent },
  // Mobile: count label +50% to match the icon bump.
  countMobile: { fontSize: 17.7 } as any,
});
