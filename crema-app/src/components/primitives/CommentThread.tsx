/**
 * CommentThread — generic comment list with likes, nested replies, and input.
 *
 * Works for any parent resource (posts, tasting notes).
 * On iOS/Swift: LazyVStack with ForEach + hierarchical grouping.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Animated } from "react-native";
import { Send, X, MessageCircle } from "lucide-react-native";
import CroppedAvatar from "./Avatar";
import Toggle from "./Toggle";
import { timeAgo } from "./TimeAgo";
import { useResource } from "../../resources/useResource";
import { t } from "../../tokens/useTokens";
import { HeartOutlineIcon, HeartFilledOutlineIcon } from "../icons/FigmaIcons";
import type { Comment } from "../../resources/types";

interface CommentThreadProps {
  /** Resource name for comments (e.g. "post_comments", "note_comments") */
  resource: string;
  /** Resource name for comment likes (e.g. "comment_likes") */
  likeResource?: string;
  /** Parent resource name (e.g. "posts") */
  parentResource: string;
  /** Parent ID */
  parentId: number;
  /** Currently logged-in user */
  user?: any;
  /** Comment ID to highlight (from notification) */
  highlightCommentId?: number;
}

export default function CommentThread({
  resource, likeResource, parentResource, parentId, user, highlightCommentId,
}: CommentThreadProps) {
  const { data: comments, loading, refetch, create } = useResource<Comment>(resource, {
    parent: { resource: parentResource, id: parentId },
    limit: 100,
  });

  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const flashAnims = useRef<Record<number, Animated.Value>>({}).current;

  // Highlight specific comment on mount
  useEffect(() => {
    if (highlightCommentId && comments.length > 0) {
      const anim = new Animated.Value(1);
      flashAnims[highlightCommentId] = anim;
      Animated.timing(anim, { toValue: 0, duration: 2000, useNativeDriver: false }).start();
    }
  }, [highlightCommentId, comments.length]);

  const handleSubmit = useCallback(async () => {
    if (!commentText.trim() || !user) return;
    setSending(true);
    try {
      const body: any = { comment: commentText.trim() };
      if (replyTo) body.parent_id = replyTo.id;
      await create(body);
      setCommentText("");
      setReplyTo(null);
    } catch {} finally {
      setSending(false);
    }
  }, [commentText, user, replyTo, create]);

  const commentList = Array.isArray(comments) ? comments : [];
  const topLevel = commentList.filter((c) => !c.parent_id);
  const replies = commentList.filter((c) => c.parent_id);

  const renderComment = (c: Comment, idx: number, isReply = false) => {
    const isHighlight = highlightCommentId === c.id;
    const anim = flashAnims[c.id];
    const childReplies = replies.filter((r) => r.parent_id === c.id);

    return (
      <Animated.View
        key={c.id}
        style={[
          s.row,
          isReply && { marginLeft: 38 },
          isHighlight && anim ? {
            backgroundColor: anim.interpolate({
              inputRange: [0, 1],
              outputRange: ["rgba(215,152,218,0)", "rgba(215,152,218,0.25)"],
            }),
            borderRadius: 6,
          } : undefined,
        ]}
      >
        {idx > 0 && <View style={s.divider} />}
        <View style={s.body}>
          {c.user?.avatar_url ? (
            <CroppedAvatar url={c.user.avatar_url} size={isReply ? 22 : 28} />
          ) : (
            <View style={[s.avatarFb, isReply && { width: 22, height: 22, borderRadius: 11 }]}>
              <Text style={[s.avatarLetter, isReply && { fontSize: 9 }]}>
                {(c.user?.display_name || "?")[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={s.content}>
            <View style={s.nameRow}>
              <Text style={s.name}>{c.user?.display_name}</Text>
              <Text style={s.time}>{timeAgo(c.created_at)}</Text>
            </View>
            <Text style={s.text}>{c.comment}</Text>
            <View style={s.actions}>
              {likeResource && (
                <Toggle
                  resource={likeResource}
                  targetId={c.id}
                  initial={c.liked_by_me}
                  count={c.like_count}
                  iconOn={<HeartFilledOutlineIcon size={12} color={t.color.accent} />}
                  iconOff={<HeartOutlineIcon size={12} color={t.color["text.muted"]} />}
                  countSize={11}
                />
              )}
              {user && !isReply && (
                <Pressable
                  onPress={() => setReplyTo({ id: c.id, username: c.user?.display_name || "user" })}
                  style={s.actionBtn}
                >
                  <MessageCircle size={12} color={t.color["text.muted"]} />
                  <Text style={s.actionText}>Reply</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
        {childReplies.map((r, ri) => renderComment(r, ri, true))}
      </Animated.View>
    );
  };

  return (
    <View style={s.section}>
      <View style={s.headerDivider} />
      <Text style={s.header}>
        {commentList.length} comment{commentList.length !== 1 ? "s" : ""}
      </Text>

      {loading ? (
        <ActivityIndicator size="small" color={t.color.accent} style={{ paddingVertical: 16 }} />
      ) : commentList.length === 0 ? (
        <Text style={s.empty}>No comments yet. Be the first!</Text>
      ) : (
        topLevel.map((c, idx) => renderComment(c, idx))
      )}

      {replyTo && (
        <View style={s.replyIndicator}>
          <Text style={s.replyText}>Replying to {replyTo.username}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <X size={14} color={t.color["text.muted"]} />
          </Pressable>
        </View>
      )}

      {user && (
        <View style={s.input}>
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            placeholder={replyTo ? `Reply to ${replyTo.username}...` : "Write a comment..."}
            placeholderTextColor={t.color["text.muted"]}
            style={s.inputField}
            onSubmitEditing={handleSubmit}
          />
          <Pressable onPress={handleSubmit} disabled={sending || !commentText.trim()}>
            <Send size={18} color={commentText.trim() ? t.color.accent : t.color.border} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingBottom: 20 },
  headerDivider: { height: 1, backgroundColor: t.color["border.light"], marginVertical: 16 },
  header: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"], marginBottom: 12 },
  empty: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"], textAlign: "center", paddingVertical: 16 },

  row: { paddingVertical: 4 },
  divider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginVertical: 8 },
  body: { flexDirection: "row", gap: 10 } as any,
  avatarFb: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-dark"] },
  content: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 } as any,
  name: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  time: { fontFamily: t.font["body.regular"], fontSize: 10, color: t.color["text.muted"] },
  text: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"], lineHeight: 18 },

  actions: { flexDirection: "row", gap: 14, marginTop: 4 } as any,
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 } as any,
  actionText: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"] },

  replyIndicator: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#F5F0E8", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8,
  } as any,
  replyText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.secondary"] },

  input: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16,
    backgroundColor: t.color["card.front"], borderRadius: 8,
    borderWidth: 1, borderColor: t.color["border.light"],
    paddingHorizontal: 12, paddingVertical: 8,
  } as any,
  inputField: { flex: 1, fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"] },
});
