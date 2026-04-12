/**
 * CommentModal — floating modal for post comments.
 *
 * Shows a compact post preview at top, scrollable comment thread,
 * and a comment input at the bottom. Supports:
 * - Like on comments (heart toggle)
 * - Edit own comments (inline TextInput)
 * - Delete own comments
 *
 * Backdrop: Figma 116:770 (#684F44 60% + 35px blur)
 */

import { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, ActivityIndicator, Platform,
} from "react-native";
import { Image } from "expo-image";
import { X, Send, PenLine, Trash2 } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

import { apiFetch, resolveUploadUrl } from "../api/client";
import { fonts } from "../theme/colors";
import { HeartOutlineIcon, HeartFilledOutlineIcon } from "./icons/FigmaIcons";

interface CommentModalProps {
  visible: boolean;
  post: any;
  onClose: () => void;
  onCommentCountChange?: (postId: number, count: number) => void;
  user?: any;
}

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  } catch { return ""; }
}

export default function CommentModal({ visible, post, onClose, onCommentCountChange, user }: CommentModalProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const loadComments = useCallback(async () => {
    if (!post?.id) return;
    try {
      const data = await apiFetch(`/posts/${post.id}/comments`);
      setComments(data.comments || []);
      onCommentCountChange?.(post.id, (data.comments || []).length);
    } catch { setComments([]); }
    finally { setLoading(false); }
  }, [post?.id]);

  useEffect(() => {
    if (visible && post?.id) { setLoading(true); loadComments(); }
  }, [visible, post?.id]);

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      await apiFetch(`/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: inputText.trim() }),
      });
      setInputText("");
      await loadComments();
    } catch {} finally { setSending(false); }
  };

  const handleDelete = async (commentId: number) => {
    try {
      await apiFetch(`/post-comments/${commentId}`, { method: "DELETE" });
      await loadComments();
    } catch {}
  };

  const handleSaveEdit = async (commentId: number) => {
    if (!editText.trim()) return;
    try {
      await apiFetch(`/post-comments/${commentId}`, {
        method: "PUT",
        body: JSON.stringify({ comment: editText.trim() }),
      });
      setEditingId(null);
      setEditText("");
      await loadComments();
    } catch {}
  };

  const handleToggleLike = async (commentId: number) => {
    try {
      const res = await apiFetch(`/post-comments/${commentId}/like`, { method: "POST" });
      setComments((prev) =>
        prev.map((c) => c.id === commentId ? { ...c, liked_by_me: res.liked, like_count: res.like_count } : c)
      );
    } catch {}
  };

  if (!post) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>

          {/* Header + close */}
          <View style={s.header}>
            <Text style={s.headerTitle}>Comments</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color="#351101" />
            </Pressable>
          </View>

          {/* Compact post preview */}
          <View style={s.postPreview}>
            <View style={s.postPreviewHeader}>
              {post.author_avatar_url ? (
                <Image source={{ uri: resolveUploadUrl(post.author_avatar_url) }} style={s.postAvatar} contentFit="cover" />
              ) : (
                <View style={[s.postAvatar, s.postAvatarFb]}>
                  <Text style={s.postAvatarLetter}>{(post.author_display_name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              <Text style={s.postAuthor} numberOfLines={1}>{post.author_display_name}</Text>
              <Text style={s.postTime}>{timeAgo(post.published_at)}</Text>
            </View>
            <Text style={s.postTeaser} numberOfLines={2}>{post.teaser}</Text>
          </View>

          <View style={s.divider} />

          {/* Comments list */}
          <ScrollView style={s.commentsList} showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 24 }} />
            ) : comments.length === 0 ? (
              <Text style={s.emptyText}>No comments yet. Be the first!</Text>
            ) : (
              comments.map((c, idx) => {
                const isMe = user && c.user?.id === user.id;
                const isEditing = editingId === c.id;
                return (
                  <View key={c.id}>
                    {idx > 0 && <View style={s.commentDivider} />}
                    <View style={s.commentRow}>
                      {/* Avatar */}
                      {c.user?.avatar_url ? (
                        <Image source={{ uri: resolveUploadUrl(c.user.avatar_url) }} style={s.commentAvatar} contentFit="cover" />
                      ) : (
                        <View style={[s.commentAvatar, s.commentAvatarFb]}>
                          <Text style={s.commentAvatarLetter}>{(c.user?.display_name || "?")[0].toUpperCase()}</Text>
                        </View>
                      )}

                      {/* Content */}
                      <View style={s.commentContent}>
                        <View style={s.commentNameRow}>
                          <Text style={s.commentName}>{c.user?.display_name}</Text>
                          <Text style={s.commentTime}>{timeAgo(c.created_at)}</Text>
                          {c.updated_at && <Text style={s.commentEdited}>(edited)</Text>}
                        </View>

                        {isEditing ? (
                          <View style={s.editRow}>
                            <TextInput
                              style={s.editInput}
                              value={editText}
                              onChangeText={setEditText}
                              multiline
                              autoFocus
                            />
                            <View style={s.editActions}>
                              <Pressable onPress={() => setEditingId(null)}>
                                <Text style={s.editCancel}>Cancel</Text>
                              </Pressable>
                              <Pressable onPress={() => handleSaveEdit(c.id)}>
                                <Text style={s.editSave}>Save</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <Text style={s.commentText}>{c.comment}</Text>
                        )}

                        {/* Actions row */}
                        {!isEditing && (
                          <View style={s.commentActions}>
                            <Pressable onPress={() => handleToggleLike(c.id)} style={s.commentLikeBtn}>
                              {c.liked_by_me ? (
                                <HeartFilledOutlineIcon size={12} color="#D798DA" />
                              ) : (
                                <HeartOutlineIcon size={12} color="#A09580" />
                              )}
                              {c.like_count > 0 && (
                                <Text style={[s.commentLikeCount, c.liked_by_me && { color: "#D798DA" }]}>{c.like_count}</Text>
                              )}
                            </Pressable>
                            {isMe && (
                              <>
                                <Pressable onPress={() => { setEditingId(c.id); setEditText(c.comment); }} style={s.commentActionBtn}>
                                  <Text style={s.commentActionText}>Edit</Text>
                                </Pressable>
                                <Pressable onPress={() => handleDelete(c.id)} style={s.commentActionBtn}>
                                  <Text style={[s.commentActionText, { color: "#A09580" }]}>Delete</Text>
                                </Pressable>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Input area */}
          {user && (
            <View style={s.inputArea}>
              <View style={s.inputRow}>
                {user.avatar_url ? (
                  <Image source={{ uri: resolveUploadUrl(user.avatar_url) }} style={s.inputAvatar} contentFit="cover" />
                ) : (
                  <View style={[s.inputAvatar, s.commentAvatarFb]}>
                    <Text style={s.commentAvatarLetter}>{(user.display_name || user.username || "?")[0].toUpperCase()}</Text>
                  </View>
                )}
                <TextInput
                  style={s.inputField}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Write a comment..."
                  placeholderTextColor="#A09580"
                  multiline
                  maxLength={500}
                />
                <Pressable
                  onPress={handleSend}
                  disabled={!inputText.trim() || sending}
                  style={[s.sendBtn, (!inputText.trim() || sending) && s.sendBtnDisabled]}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#FAF8F0" />
                  ) : (
                    <Send size={16} color="#FAF8F0" />
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(104,79,68,0.6)",
    backdropFilter: "blur(35px)",
    WebkitBackdropFilter: "blur(35px)",
    justifyContent: "center",
    alignItems: "center",
  } as any,
  card: {
    backgroundColor: "#FAF8F0",
    borderRadius: 12,
    width: "90%",
    maxWidth: 520,
    maxHeight: "80%",
    overflow: "hidden",
  } as any,

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  } as any,
  headerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },

  // Post preview
  postPreview: { paddingHorizontal: 20, paddingBottom: 12 },
  postPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  postAvatar: { width: 24, height: 24, borderRadius: 12, overflow: "hidden" } as any,
  postAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  postAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 9, color: "#FAF8F0" },
  postAuthor: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#351101", flex: 1 },
  postTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  postTeaser: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#684F44", lineHeight: 18 },

  divider: { height: 1, backgroundColor: "#D7D1C4" },

  // Comments list
  commentsList: { paddingHorizontal: 20, maxHeight: 400 },
  emptyText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#A09580", textAlign: "center", paddingVertical: 32 } as any,
  commentDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.4)", marginVertical: 4 },

  // Comment row
  commentRow: { flexDirection: "row", gap: 10, paddingVertical: 10 } as any,
  commentAvatar: { width: 24, height: 24, borderRadius: 12, overflow: "hidden", marginTop: 2 } as any,
  commentAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  commentAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 9, color: "#FAF8F0" },
  commentContent: { flex: 1 },
  commentNameRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 } as any,
  commentName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#351101" },
  commentTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  commentEdited: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580", fontStyle: "italic" } as any,
  commentText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101", lineHeight: 18 },

  // Comment actions
  commentActions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 } as any,
  commentLikeBtn: { flexDirection: "row", alignItems: "center", gap: 4 } as any,
  commentLikeCount: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  commentActionBtn: {},
  commentActionText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },

  // Edit mode
  editRow: { marginTop: 2 },
  editInput: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#351101",
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
    minHeight: 36,
  },
  editActions: { flexDirection: "row", gap: 12, marginTop: 6, justifyContent: "flex-end" } as any,
  editCancel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#A09580" },
  editSave: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#351101" },

  // Input area
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: "#D7D1C4",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 } as any,
  inputAvatar: { width: 24, height: 24, borderRadius: 12, overflow: "hidden", marginBottom: 4 } as any,
  inputField: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#351101",
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#fff",
    maxHeight: 80,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  } as any,
  sendBtnDisabled: { opacity: 0.4 },
});
