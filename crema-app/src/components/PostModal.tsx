/**
 * PostModal — sitewide universal post interaction overlay.
 *
 * Triggered globally via: window.dispatchEvent(new CustomEvent("crema:open-post", { detail }))
 *
 * Modes:
 *   "view"    — show post with pink flash highlight (likes, reposts from notifications)
 *   "comment" — show post + comment thread + compose input
 *   "repost"  — show compose repost form above original post preview
 *
 * For comment/comment_like notifications, pass highlightCommentId to scroll to
 * and briefly flash that comment.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, Animated, ActivityIndicator, Platform,
} from "react-native";
import { Image } from "expo-image";
import { X, Send, MessageCircle } from "lucide-react-native";
import { HeartOutlineIcon, HeartFilledOutlineIcon } from "./icons/FigmaIcons";
import { apiFetch, resolveUploadUrl } from "../api/client";
import { fonts, cardShadow } from "../theme/colors";
import PostFeedCard, { CroppedAvatar, timeAgo } from "./PostFeedCard";
import PostGallery from "./PostGallery";

interface PostModalProps {
  visible: boolean;
  postId?: number;
  post?: any;
  mode?: "view" | "comment" | "repost";
  highlightCommentId?: number;
  onClose: () => void;
  user?: any;
}

export default function PostModal({
  visible, postId, post: postProp, mode = "view",
  highlightCommentId, onClose, user,
}: PostModalProps) {
  const [post, setPost] = useState<any>(postProp || null);
  const [loading, setLoading] = useState(false);

  // Comments
  const [comments, setComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [repostComment, setRepostComment] = useState("");
  const [commentCount, setCommentCount] = useState(0);
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const [commentLikes, setCommentLikes] = useState<Record<number, { liked: boolean; count: number }>>({});

  // Animations
  const flashAnim = useRef(new Animated.Value(0)).current;
  const commentFlashAnims = useRef<Record<number, Animated.Value>>({}).current;
  const commentRefs = useRef<Record<number, any>>({}).current;
  const scrollRef = useRef<ScrollView>(null);

  // Fetch post if only ID provided
  useEffect(() => {
    if (!visible) { setPost(null); setComments([]); setRepostComment(""); setReplyTo(null); setCommentLikes({}); return; }
    if (postProp) { setPost(postProp); return; }
    if (!postId) return;

    setLoading(true);
    apiFetch(`/posts/${postId}`)
      .then((p) => setPost(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, postId, postProp]);

  // Internal mode — can switch from view→repost within the modal
  const [internalMode, setInternalMode] = useState(mode);
  useEffect(() => { setInternalMode(mode); }, [mode]);

  // Always load comments when post is available
  useEffect(() => {
    if (!visible || !post) return;
    loadComments();
    if (internalMode === "view") {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 1500, useNativeDriver: false }).start();
    }
    setCommentCount(post.comment_count || 0);
  }, [visible, post]);

  const loadComments = useCallback(async () => {
    if (!post) return;
    setCommentsLoading(true);
    try {
      const data = await apiFetch(`/posts/${post.id}/comments`);
      const list = data.comments || [];
      setComments(list);
      setCommentCount(list.length);
      const likes: Record<number, { liked: boolean; count: number }> = {};
      for (const c of list) { likes[c.id] = { liked: c.liked_by_me || false, count: c.like_count || 0 }; }
      setCommentLikes(likes);

      // Highlight specific comment after load
      if (highlightCommentId) {
        setTimeout(() => {
          const anim = new Animated.Value(1);
          commentFlashAnims[highlightCommentId] = anim;
          // Scroll to the comment
          const ref = commentRefs[highlightCommentId];
          if (ref && scrollRef.current) {
            ref.measureLayout?.(scrollRef.current, (_x: number, y: number) => {
              scrollRef.current?.scrollTo({ y: y - 100, animated: true });
            });
          }
          Animated.timing(anim, { toValue: 0, duration: 2000, useNativeDriver: false }).start();
        }, 500);
      }
    } catch {} finally {
      setCommentsLoading(false);
    }
  }, [post, highlightCommentId]);

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !user || !post) return;
    setSending(true);
    try {
      const body: any = { comment: commentText.trim() };
      if (replyTo) body.parent_id = replyTo.id;
      await apiFetch(`/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCommentText("");
      setReplyTo(null);
      loadComments();
    } catch {} finally {
      setSending(false);
    }
  };

  const handleToggleCommentLike = async (commentId: number) => {
    if (!user) return;
    const prev = commentLikes[commentId] || { liked: false, count: 0 };
    setCommentLikes((s) => ({ ...s, [commentId]: { liked: !prev.liked, count: prev.liked ? prev.count - 1 : prev.count + 1 } }));
    try {
      const res = await apiFetch(`/post-comments/${commentId}/like`, { method: "POST" });
      setCommentLikes((s) => ({ ...s, [commentId]: { liked: res.liked, count: res.like_count } }));
    } catch {
      setCommentLikes((s) => ({ ...s, [commentId]: prev }));
    }
  };

  const handleRepostSubmit = async (data: any) => {
    try {
      await apiFetch("/roaster-posts", { method: "POST", body: JSON.stringify(data) });
      onClose();
    } catch {}
  };

  if (!visible) return null;

  const showComments = internalMode !== "repost"; // hide comments in repost mode

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {internalMode === "repost" ? "Repost" : "Post"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={18} color="#351101" />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={s.scrollBody}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <ActivityIndicator size="large" color="#D798DA" style={{ paddingVertical: 40 }} />
            ) : !post ? (
              <Text style={s.emptyText}>Post not found</Text>
            ) : (
              <>
                {internalMode === "repost" ? (
                  /* ── Repost preview: mimics how the repost will look in the feed ── */
                  <View style={s.repostPreview}>
                    {/* User header: "You · Reposted" */}
                    <View style={s.repostPreviewHeader}>
                      {user?.avatar_url ? (
                        <CroppedAvatar url={user.avatar_url} cropX={user.avatar_crop_x} cropY={user.avatar_crop_y} zoom={user.avatar_zoom} size={30} />
                      ) : (
                        <View style={s.repostPreviewAvatarFb}><Text style={s.repostPreviewAvatarLetter}>{(user?.display_name || "?")[0].toUpperCase()}</Text></View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={s.repostPreviewName}>{user?.display_name || "You"}</Text>
                        <Text style={s.repostPreviewSubtitle}>Reposting</Text>
                      </View>
                    </View>

                    {/* Editable repost comment */}
                    <TextInput
                      value={repostComment}
                      onChangeText={setRepostComment}
                      placeholder="Add your thoughts..."
                      placeholderTextColor="#A09580"
                      style={s.repostCommentInput}
                      multiline
                    />

                    {/* Nested original post card (read-only, same as feed) */}
                    <View style={s.repostNestedCard}>
                      <View style={s.repostNestedHeader}>
                        {post.author_avatar_url ? (
                          <CroppedAvatar url={post.author_avatar_url} cropX={post.author_avatar_crop_x} cropY={post.author_avatar_crop_y} zoom={post.author_avatar_zoom} size={20} />
                        ) : (
                          <View style={[s.repostPreviewAvatarFb, { width: 20, height: 20, borderRadius: 10 }]}><Text style={[s.repostPreviewAvatarLetter, { fontSize: 8 }]}>{(post.author_display_name || "?")[0].toUpperCase()}</Text></View>
                        )}
                        <Text style={s.repostNestedAuthor} numberOfLines={1}>{post.author_display_name}</Text>
                        <Text style={s.repostNestedTime}>{timeAgo(post.published_at)}</Text>
                      </View>
                      <Text style={s.repostNestedTeaser} numberOfLines={3}>{post.teaser}</Text>
                      {post.images?.length > 0 && (
                        <View style={{ marginTop: 8 }}>
                          <PostGallery images={post.images} />
                        </View>
                      )}
                    </View>

                    {/* Repost button */}
                    <Pressable
                      onPress={() => handleRepostSubmit({
                        post_type: "repost",
                        repost_of_id: post.id,
                        title: "Repost",
                        teaser: repostComment.trim() || "Repost",
                        repost_comment: repostComment.trim() || null,
                      })}
                      style={s.repostBtn}
                    >
                      <Text style={s.repostBtnText}>Repost</Text>
                    </Pressable>
                  </View>
                ) : (
                  /* ── Normal view: post card with comment/repost buttons ── */
                  <Animated.View style={internalMode === "view" ? {
                    backgroundColor: flashAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["rgba(215,152,218,0)", "rgba(215,152,218,0.2)"],
                    }),
                    borderRadius: 8,
                  } : undefined}>
                    <PostFeedCard
                      post={post}
                      user={user}
                      onComment={() => scrollRef.current?.scrollToEnd({ animated: true })}
                      onRepost={() => setInternalMode("repost")}
                    />
                  </Animated.View>
                )}

                {/* Comment thread — hidden in repost mode */}
                {showComments && (
                  <View style={s.commentSection}>
                    <View style={s.commentDivider} />
                    <Text style={s.commentHeader}>{commentCount} comment{commentCount !== 1 ? "s" : ""}</Text>

                    {commentsLoading ? (
                      <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 16 }} />
                    ) : comments.length === 0 ? (
                      <Text style={s.emptyComment}>No comments yet. Be the first!</Text>
                    ) : (() => {
                      const topLevel = comments.filter((c) => !c.parent_id);
                      const replies = comments.filter((c) => c.parent_id);
                      const renderComment = (c: any, idx: number, isReply = false) => {
                        const isHighlight = highlightCommentId === c.id;
                        const anim = commentFlashAnims[c.id];
                        const lk = commentLikes[c.id] || { liked: false, count: 0 };
                        const childReplies = replies.filter((r) => r.parent_id === c.id);
                        return (
                          <Animated.View
                            key={c.id}
                            ref={(ref: any) => { commentRefs[c.id] = ref; }}
                            style={[
                              s.commentRow,
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
                            {idx > 0 && <View style={s.commentRowDivider} />}
                            <View style={s.commentBody}>
                              {c.user?.avatar_url ? (
                                <CroppedAvatar url={c.user.avatar_url} size={isReply ? 22 : 28} />
                              ) : (
                                <View style={[s.commentAvatarFb, isReply && { width: 22, height: 22, borderRadius: 11 }]}>
                                  <Text style={[s.commentAvatarLetter, isReply && { fontSize: 9 }]}>{(c.user?.display_name || "?")[0].toUpperCase()}</Text>
                                </View>
                              )}
                              <View style={s.commentContent}>
                                <View style={s.commentNameRow}>
                                  <Text style={s.commentName}>{c.user?.display_name || c.display_name}</Text>
                                  <Text style={s.commentTime}>{timeAgo(c.created_at)}</Text>
                                </View>
                                <Text style={s.commentText}>{c.comment}</Text>
                                <View style={s.commentActions}>
                                  <Pressable onPress={() => handleToggleCommentLike(c.id)} style={s.commentActionBtn}>
                                    {lk.liked
                                      ? <HeartFilledOutlineIcon size={12} color="#D798DA" />
                                      : <HeartOutlineIcon size={12} color="#A09580" />}
                                    {lk.count > 0 && <Text style={[s.commentActionText, lk.liked && { color: "#D798DA" }]}>{lk.count}</Text>}
                                  </Pressable>
                                  {user && !isReply && (
                                    <Pressable onPress={() => { setReplyTo({ id: c.id, username: c.user?.display_name || c.user?.username || "user" }); }} style={s.commentActionBtn}>
                                      <MessageCircle size={12} color="#A09580" />
                                      <Text style={s.commentActionText}>Reply</Text>
                                    </Pressable>
                                  )}
                                </View>
                              </View>
                            </View>
                            {childReplies.map((r, ri) => renderComment(r, ri, true))}
                          </Animated.View>
                        );
                      };
                      return topLevel.map((c, idx) => renderComment(c, idx));
                    })()}

                    {/* Reply indicator */}
                    {replyTo && (
                      <View style={s.replyIndicator}>
                        <Text style={s.replyIndicatorText}>Replying to {replyTo.username}</Text>
                        <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                          <X size={14} color="#A09580" />
                        </Pressable>
                      </View>
                    )}

                    {/* Comment input */}
                    {user && (
                      <View style={s.commentInput}>
                        <TextInput
                          value={commentText}
                          onChangeText={setCommentText}
                          placeholder={replyTo ? `Reply to ${replyTo.username}...` : "Write a comment..."}
                          placeholderTextColor="#A09580"
                          style={s.commentInputField}
                          onSubmitEditing={handleSubmitComment}
                        />
                        <Pressable onPress={handleSubmitComment} disabled={sending || !commentText.trim()}>
                          <Send size={18} color={commentText.trim() ? "#D798DA" : "#D7D1C4"} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(104,79,68,0.6)",
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web" ? { backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } : {}),
  } as any,
  card: {
    backgroundColor: "#FAF8F0",
    borderRadius: 12,
    width: "92%",
    maxWidth: 700,
    maxHeight: "85%",
    overflow: "hidden",
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EDE8E1",
  },
  headerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },
  scrollBody: { flex: 1 },
  emptyText: { fontFamily: fonts.bodyRegular, fontSize: 14, color: "#A09580", textAlign: "center", paddingVertical: 40 },

  // Comments
  commentSection: { paddingHorizontal: 20, paddingBottom: 20 },
  commentDivider: { height: 1, backgroundColor: "#EDE8E1", marginVertical: 16 },
  commentHeader: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#351101", marginBottom: 12 },
  emptyComment: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#A09580", textAlign: "center", paddingVertical: 16 },
  commentRow: { paddingVertical: 4 },
  commentRowDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginVertical: 8 },
  commentBody: { flexDirection: "row", gap: 10 },
  commentAvatarFb: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  commentAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  commentContent: { flex: 1 },
  commentNameRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 },
  commentName: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#351101" },
  commentTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  commentText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101", lineHeight: 18 },
  commentActions: { flexDirection: "row", gap: 14, marginTop: 4 } as any,
  commentActionBtn: { flexDirection: "row", alignItems: "center", gap: 4 } as any,
  commentActionText: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#A09580" },
  replyIndicator: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F5F0E8", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 } as any,
  replyIndicatorText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#684F44" },
  commentInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#EDE8E1",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  commentInputField: { flex: 1, fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101" },

  // Repost preview — mimics feed appearance
  repostPreview: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  repostPreviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  repostPreviewAvatarFb: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "#351101", alignItems: "center", justifyContent: "center",
  } as any,
  repostPreviewAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  repostPreviewName: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  repostPreviewSubtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#684F44", marginTop: 2 },
  repostCommentInput: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16.8,
    color: "#351101",
    lineHeight: 23.5,
    minHeight: 40,
    marginBottom: 14,
  },
  repostNestedCard: {
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 8,
    backgroundColor: "#FEFDFB",
    padding: 12,
    marginBottom: 16,
  },
  repostNestedHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostNestedAuthor: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101" },
  repostNestedTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  repostNestedTeaser: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#684F44", lineHeight: 18 },
  repostBtn: {
    alignSelf: "flex-end",
    backgroundColor: "#351101",
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  repostBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
});
