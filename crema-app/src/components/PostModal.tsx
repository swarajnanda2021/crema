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

  // Animations
  const flashAnim = useRef(new Animated.Value(0)).current;
  const commentFlashAnims = useRef<Record<number, Animated.Value>>({}).current;
  const commentRefs = useRef<Record<number, any>>({}).current;
  const scrollRef = useRef<ScrollView>(null);

  // Fetch post if only ID provided
  useEffect(() => {
    if (!visible) { setPost(null); setComments([]); setRepostComment(""); return; }
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
                        <Text style={s.repostPreviewSubtitle}>Reposted</Text>
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
                      onPress={() => handleRepostSubmit({ post_type: "repost", repost_of_id: post.id, teaser: repostComment })}
                      style={[s.repostBtn, !repostComment.trim() && { opacity: 0.5 }]}
                      disabled={!repostComment.trim()}
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
