/**
 * PostModal — sitewide universal post interaction overlay. CRUD Utopia edition.
 *
 * Uses CommentThread primitive for comments (likes + replies built-in).
 * Uses PostCard for the post display.
 * Reads all design tokens from JSON.
 *
 * Triggered via: window.dispatchEvent(new CustomEvent("crema:open-post", { detail }))
 */

import { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, Animated, ActivityIndicator, Platform,
} from "react-native";
import { X } from "lucide-react-native";

import { apiFetch, apiFetchRaw } from "../../api/client";
import ComposePost from "../ComposePost";
import { t } from "../../tokens/useTokens";
import { CroppedAvatar, timeAgo } from "../primitives";
import CommentThread from "../primitives/CommentThread";
import PostCard from "../domain/PostCard";
import PostGallery from "../PostGallery";
import type { Post } from "../../resources/types";

interface PostModalProps {
  visible: boolean;
  postId?: number;
  post?: Post;
  mode?: "view" | "comment" | "repost";
  highlightCommentId?: number;
  onClose: () => void;
  user?: any;
}

export default function PostModal({
  visible, postId, post: postProp, mode = "view",
  highlightCommentId, onClose, user,
}: PostModalProps) {
  const [post, setPost] = useState<Post | null>(postProp || null);
  const [loading, setLoading] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);

  // Repost state
  const [repostComment, setRepostComment] = useState("");
  const [internalMode, setInternalMode] = useState(mode);
  const scrollRef = useRef<ScrollView>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  // Fetch post if only ID provided
  useEffect(() => {
    if (!visible) { setPost(null); setRepostComment(""); return; }
    if (postProp) { setPost(postProp); return; }
    if (!postId) return;

    setLoading(true);
    apiFetchRaw(`/posts/${postId}`)
      .then((envelope: any) => setPost(envelope.data || envelope))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, postId, postProp]);

  useEffect(() => { setInternalMode(mode); }, [mode]);

  // Flash animation for "view" mode
  useEffect(() => {
    if (!visible || !post) return;
    if (internalMode === "view") {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 1500, useNativeDriver: false }).start();
    }
  }, [visible, post]);

  const handleRepostSubmit = useCallback(async (data: any) => {
    try {
      await apiFetchRaw("/posts", { method: "POST", body: JSON.stringify(data) });
      onClose();
    } catch {}
  }, [onClose]);

  const handleEditPost = useCallback(async (postId: number, data: any) => {
    await apiFetchRaw(`/posts/${postId}`, { method: "PUT", body: JSON.stringify(data) });
    setEditingPost(null);
    // Reload the post
    const envelope: any = await apiFetchRaw(`/posts/${postId}`);
    setPost(envelope.data || envelope);
  }, []);

  if (!visible) return null;

  const showComments = internalMode !== "repost";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Overlay: background Pressable + card as sibling so clicks on card don't bubble to close handler */}
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {internalMode === "repost" ? "Repost" : "Post"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={18} color={t.color["text.primary"]} />
            </Pressable>
          </View>

          <ScrollView ref={scrollRef} style={s.scrollBody} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator size="large" color={t.color.accent} />
              </View>
            ) : !post ? (
              <Text style={s.emptyText}>Post not found</Text>
            ) : (
              <>
                {internalMode === "repost" ? (
                  /* ── Repost compose mode ── */
                  <View style={s.repostPreview}>
                    <View style={s.repostPreviewHeader}>
                      {user?.avatar_url ? (
                        <CroppedAvatar url={user.avatar_url} cropX={user.avatar_crop_x} cropY={user.avatar_crop_y} zoom={user.avatar_zoom} size={30} />
                      ) : (
                        <View style={s.repostAvatarFb}><Text style={s.repostAvatarLetter}>{(user?.display_name || "?")[0].toUpperCase()}</Text></View>
                      )}
                      <View>
                        <Text style={s.repostPreviewName}>{user?.display_name}</Text>
                        <Text style={s.repostPreviewSubtitle}>Reposting</Text>
                      </View>
                    </View>

                    {/* Optional comment input */}
                    <TextInput
                      value={repostComment}
                      onChangeText={setRepostComment}
                      placeholder="Add a comment (optional)..."
                      placeholderTextColor={t.color["text.muted"]}
                      style={s.repostInput}
                      multiline
                    />

                    {/* Nested original post preview */}
                    <View style={s.repostNestedCard}>
                      <View style={s.repostNestedHeader}>
                        {post.author?.avatar_url ? (
                          <CroppedAvatar url={post.author.avatar_url} cropX={post.author.avatar_crop_x} cropY={post.author.avatar_crop_y} zoom={post.author.avatar_zoom} size={20} />
                        ) : (
                          <View style={[s.repostAvatarFb, { width: 20, height: 20, borderRadius: 10 }]}>
                            <Text style={[s.repostAvatarLetter, { fontSize: 8 }]}>{(post.author?.display_name || "?")[0].toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={s.repostNestedAuthor} numberOfLines={1}>{post.author?.display_name}</Text>
                        <Text style={s.repostNestedTime}>{timeAgo(post.published_at)}</Text>
                      </View>
                      <Text style={s.repostNestedTeaser} numberOfLines={3}>{post.teaser}</Text>
                      {post.images?.length > 0 && (
                        <View style={{ marginTop: 8 }}>
                          <PostGallery images={post.images} />
                        </View>
                      )}
                    </View>

                    {/* Repost button — no disabled state, works with or without comment */}
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
                  /* ── Normal view: post card ── */
                  <Animated.View style={internalMode === "view" ? {
                    backgroundColor: flashAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["rgba(215,152,218,0)", "rgba(215,152,218,0.2)"],
                    }),
                    borderRadius: 8,
                  } : undefined}>
                    <PostCard
                      post={post}
                      user={user}
                      isOwner={!!(user && post && user.id === post.user_id)}
                      onComment={() => scrollRef.current?.scrollToEnd({ animated: true })}
                      onRepost={() => setInternalMode("repost")}
                      onEdit={(p) => setEditingPost(p)}
                    />
                  </Animated.View>
                )}

                {/* Comment thread — uses CommentThread primitive */}
                {showComments && (
                  <CommentThread
                    resource="post_comments"
                    likeResource="comment_likes"
                    parentResource="posts"
                    parentId={post.id}
                    user={user}
                    highlightCommentId={highlightCommentId}
                  />
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Edit post sub-modal */}
      {editingPost && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEditingPost(null)}>
          <View style={s.overlayWrap}>
            <Pressable style={s.overlayBg} onPress={() => setEditingPost(null)} />
            <View style={s.editModal}>
              <ComposePost
                onSubmit={async (data) => { await handleEditPost(editingPost.id, data); }}
                onCancel={() => setEditingPost(null)}
                user={user}
                products={[]}
                initialData={{ body: editingPost.teaser || (editingPost as any).body, images: (editingPost as any).images || [], location: editingPost.location || "" }}
              />
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  /* Shared overlay structure: background Pressable + card View as siblings */
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web" ? { backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  card: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 700,
    maxHeight: "85%",
    overflow: "hidden",
    zIndex: 1,
  } as any,
  editModal: { width: "90%", maxWidth: 680, backgroundColor: "#FAF8F0", borderRadius: 12, overflow: "hidden", maxHeight: "85%", zIndex: 1 } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  headerTitle: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.lg"], color: t.color["text.primary"] },
  scrollBody: { flex: 1 },
  loadingWrap: { paddingVertical: 60, alignItems: "center" } as any,
  emptyText: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.muted"], textAlign: "center", paddingVertical: 40 },

  // Repost preview
  repostPreview: { paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.lg },
  repostPreviewHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 } as any,
  repostAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-dark"] },
  repostPreviewName: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
  repostPreviewSubtitle: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.secondary"], marginTop: 2 },
  repostInput: {
    fontFamily: t.font["body.regular"], fontSize: t.size["font.lg"] + 0.8,
    color: t.color["text.primary"], lineHeight: 23.5, minHeight: 40, marginBottom: 14,
  },
  repostNestedCard: {
    borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md,
    backgroundColor: "#FEFDFB", padding: 12, marginBottom: 16,
  },
  repostNestedHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostNestedAuthor: { fontFamily: t.font["body.medium"], fontSize: t.size["font.sm"], color: t.color["text.primary"] },
  repostNestedTime: { fontFamily: t.font["body.regular"], fontSize: t.size["font.xs"], color: t.color["text.muted"] },
  repostNestedTeaser: { fontFamily: t.font["body.regular"], fontSize: t.size["font.base"], color: t.color["text.secondary"], lineHeight: 18 },
  repostBtn: {
    alignSelf: "flex-end", backgroundColor: t.color["text.primary"],
    borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8,
  } as any,
  repostBtnText: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.base"], color: t.color["text.on-dark"] },
});
