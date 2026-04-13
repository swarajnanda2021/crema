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
import { X, Send } from "lucide-react-native";
import { apiFetch, resolveUploadUrl } from "../api/client";
import { fonts, cardShadow } from "../theme/colors";
import PostFeedCard, { CroppedAvatar, timeAgo } from "./PostFeedCard";
import ComposePost from "./ComposePost";

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
  const [commentCount, setCommentCount] = useState(0);

  // Animations
  const flashAnim = useRef(new Animated.Value(0)).current;
  const commentFlashAnims = useRef<Record<number, Animated.Value>>({}).current;
  const commentRefs = useRef<Record<number, any>>({}).current;
  const scrollRef = useRef<ScrollView>(null);

  // Fetch post if only ID provided
  useEffect(() => {
    if (!visible) { setPost(null); setComments([]); return; }
    if (postProp) { setPost(postProp); return; }
    if (!postId) return;

    setLoading(true);
    apiFetch(`/posts/${postId}`)
      .then((p) => setPost(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, postId, postProp]);

  // Load comments when in comment mode or post is loaded
  useEffect(() => {
    if (!visible || !post) return;
    if (mode === "comment" || highlightCommentId) {
      loadComments();
    }
    // Flash post on view/like/repost notifications
    if (mode === "view") {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 1500, useNativeDriver: false }).start();
    }
    setCommentCount(post.comment_count || 0);
  }, [visible, post, mode]);

  const loadComments = useCallback(async () => {
    if (!post) return;
    setCommentsLoading(true);
    try {
      const data = await apiFetch(`/posts/${post.id}/comments`);
      setComments(data.comments || []);
      setCommentCount(data.comments?.length || 0);

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
      await apiFetch(`/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: commentText.trim() }),
      });
      setCommentText("");
      loadComments();
    } catch {} finally {
      setSending(false);
    }
  };

  const handleRepostSubmit = async (data: any) => {
    try {
      await apiFetch("/roaster-posts", { method: "POST", body: JSON.stringify(data) });
      onClose();
    } catch {}
  };

  if (!visible) return null;

  const showComments = mode === "comment" || !!highlightCommentId;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {mode === "repost" ? "Repost" : mode === "comment" ? "Post" : "Post"}
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
                {/* Repost compose form */}
                {mode === "repost" && (
                  <ComposePost
                    onSubmit={handleRepostSubmit}
                    onCancel={onClose}
                    repostTarget={post}
                    user={user}
                  />
                )}

                {/* Post card with optional flash highlight */}
                {mode !== "repost" && (
                  <Animated.View style={mode === "view" ? {
                    backgroundColor: flashAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["rgba(215,152,218,0)", "rgba(215,152,218,0.2)"],
                    }),
                    borderRadius: 8,
                  } : undefined}>
                    <PostFeedCard post={post} user={user} />
                  </Animated.View>
                )}

                {/* Comment thread */}
                {showComments && (
                  <View style={s.commentSection}>
                    <View style={s.commentDivider} />
                    <Text style={s.commentHeader}>{commentCount} comment{commentCount !== 1 ? "s" : ""}</Text>

                    {commentsLoading ? (
                      <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 16 }} />
                    ) : comments.length === 0 ? (
                      <Text style={s.emptyComment}>No comments yet. Be the first!</Text>
                    ) : (
                      comments.map((c, idx) => {
                        const isHighlight = highlightCommentId === c.id;
                        const anim = commentFlashAnims[c.id];
                        return (
                          <Animated.View
                            key={c.id}
                            ref={(ref: any) => { commentRefs[c.id] = ref; }}
                            style={[
                              s.commentRow,
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
                                <CroppedAvatar url={c.user.avatar_url} size={28} />
                              ) : (
                                <View style={s.commentAvatarFb}>
                                  <Text style={s.commentAvatarLetter}>{(c.user?.display_name || "?")[0].toUpperCase()}</Text>
                                </View>
                              )}
                              <View style={s.commentContent}>
                                <View style={s.commentNameRow}>
                                  <Text style={s.commentName}>{c.user?.display_name || c.display_name}</Text>
                                  <Text style={s.commentTime}>{timeAgo(c.created_at)}</Text>
                                </View>
                                <Text style={s.commentText}>{c.comment}</Text>
                              </View>
                            </View>
                          </Animated.View>
                        );
                      })
                    )}

                    {/* Comment input */}
                    {user && (
                      <View style={s.commentInput}>
                        <TextInput
                          value={commentText}
                          onChangeText={setCommentText}
                          placeholder="Write a comment..."
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
});
