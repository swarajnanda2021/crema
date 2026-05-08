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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Repeat2, X, ArrowLeft } from "lucide-react-native";

import { apiFetchRaw } from "../../api/client";
import ComposePost from "../ComposePost";
import { t, makeStyles } from "../../tokens/useTokens";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { showChromeNow } from "../../utils/chromeScroll";
import { showToast } from "./Toast";
import { CroppedAvatar, timeAgo, HapticPressable } from "../primitives";
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

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];
const MOBILE_FOOTER_HEIGHT = 71;

export default function PostModal({
  visible, postId, post: postProp, mode = "view",
  highlightCommentId, onClose, user,
}: PostModalProps) {
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState<Post | null>(postProp || null);
  const [loading, setLoading] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const s = useStyles();

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
      .then((raw: any) => setPost(raw?.data ?? raw))
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

  // On mobile-open: (a) snap the modal's own ScrollView to top so the
  // post card lands flush with the modal header — otherwise a prior
  // open's scroll position can leak through a quick re-open, and
  // (b) force the MobileHeader / MobileFooter chrome back to visible.
  // The modal positions at `top: insets.top + MOBILE_HEADER_HEIGHT`,
  // which only aligns with the painted header when chrome is shown;
  // if the underlying feed was mid-scroll (chrome collapsed) the
  // modal would sit below a gap through which the underlying feed's
  // previous post was visible. `showChromeNow()` closes the gap.
  useEffect(() => {
    if (!visible) return;
    if (isMobile) showChromeNow();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, isMobile]);

  const handleRepostSubmit = useCallback(async (data: any) => {
    try {
      await apiFetchRaw("/posts", { method: "POST", body: JSON.stringify(data) });
      showToast("Reposted");
      onClose();
    } catch (e) { console.warn("Repost failed:", e); }
  }, [onClose]);

  const handleEditPost = useCallback(async (postId: number, data: any) => {
    await apiFetchRaw(`/posts/${postId}`, { method: "PUT", body: JSON.stringify(data) });
    setEditingPost(null);
    // Reload the post
    const raw: any = await apiFetchRaw(`/posts/${postId}`);
    setPost(raw?.data ?? raw);
  }, []);

  if (!visible) return null;

  const showComments = internalMode !== "repost";

  // Mobile: instead of RN <Modal> (which paints over the sticky
  // MobileHeader + MobileFooter), render as an absolute-positioned
  // View that sits BETWEEN them. The parent mount (GlobalPostModal
  // inside the root-layout relative wrapper) is the positioning
  // context; we offset from the top by the MobileHeader band and
  // anchor to `bottom: 0` which hits the top of MobileFooter
  // because the footer lives OUTSIDE the wrapper as a sibling.
  //
  // Web wide keeps the centered floating card so the feed stays
  // visible behind it. §2.40.3.
  const cardBody = (
    <View style={[s.card, isMobile && s.cardMidBand]}>
      <View style={[s.header, isMobile && s.headerMobile]}>
        {isMobile && (
          <HapticPressable haptic="tap" onPress={onClose} hitSlop={10} style={s.backBtn} accessibilityLabel="Back">
            <ArrowLeft size={22} color={t.color["text.primary"]} strokeWidth={2} />
          </HapticPressable>
        )}
        <Text style={s.headerTitle}>
          {internalMode === "repost" ? "Repost" : "Post"}
        </Text>
        {!isMobile && (
          <HapticPressable haptic="tap" onPress={onClose} hitSlop={8}>
            <X size={18} color={t.color["text.primary"]} />
          </HapticPressable>
        )}
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
                        <CroppedAvatar
                          url={user.avatar_url}
                          cropX={user.avatar_crop_x}
                          cropY={user.avatar_crop_y}
                          zoom={user.avatar_zoom}
                          size={isMobile ? 60 : 30}
                        />
                      ) : (
                        <View style={[
                          s.repostAvatarFb,
                          isMobile && { width: 60, height: 60, borderRadius: 30 },
                        ]}>
                          <Text style={[s.repostAvatarLetter, isMobile && { fontSize: 22 }]}>
                            {(user?.display_name || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View>
                        <Text style={[s.repostPreviewName, isMobile && { fontSize: 17.7 }]}>
                          {user?.display_name}
                        </Text>
                        <Text style={[s.repostPreviewSubtitle, isMobile && { fontSize: 15, marginTop: 4 }]}>
                          Reposting
                        </Text>
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
                          <CroppedAvatar
                            url={post.author.avatar_url}
                            cropX={post.author.avatar_crop_x}
                            cropY={post.author.avatar_crop_y}
                            zoom={post.author.avatar_zoom}
                            size={isMobile ? 40 : 20}
                          />
                        ) : (
                          <View style={[
                            s.repostAvatarFb,
                            isMobile
                              ? { width: 40, height: 40, borderRadius: 20 }
                              : { width: 20, height: 20, borderRadius: 10 },
                          ]}>
                            <Text style={[s.repostAvatarLetter, { fontSize: isMobile ? 14 : 8 }]}>
                              {(post.author?.display_name || "?")[0].toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <Text style={[s.repostNestedAuthor, isMobile && { fontSize: 16.5 }]} numberOfLines={1}>
                          {post.author?.display_name}
                        </Text>
                        <Text style={[s.repostNestedTime, isMobile && { fontSize: 15 }]}>
                          {timeAgo(post.published_at)}
                        </Text>
                      </View>
                      <Text style={s.repostNestedTeaser} numberOfLines={3}>{post.teaser}</Text>
                      {post.images?.length > 0 && (
                        <View style={{ marginTop: 8 }}>
                          <PostGallery images={post.images} />
                        </View>
                      )}
                    </View>

                    {/* Repost submit — circular, icon-only. Same language
                        as other site circular buttons (FAB / admin refresh
                        / scanner stamp): dark primary fill, cream icon,
                        soft shadow. */}
                    <View style={s.repostBtnRow}>
                      <Pressable
                        onPress={() => handleRepostSubmit({
                          post_type: "repost",
                          repost_of_id: post.id,
                          title: "Repost",
                          teaser: repostComment.trim() || "Repost",
                          repost_comment: repostComment.trim() || null,
                        })}
                        style={({ pressed }) => [
                          s.repostBtn,
                          pressed && s.repostBtnPressed,
                        ]}
                        accessibilityLabel="Repost"
                      >
                        <Repeat2 size={20} color={t.color["text.on-cta"]} strokeWidth={2} />
                      </Pressable>
                    </View>
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

                {/* Comment thread — uses CommentThread primitive. When
                    the modal opens in mode="comment" (e.g. the mobile
                    feed's swipe-right-to-comment shortcut), auto-focus
                    the input so the keyboard pops on open. */}
                {showComments && (
                  <CommentThread
                    resource="post_comments"
                    likeResource="comment_likes"
                    parentResource="posts"
                    parentId={post.id}
                    user={user}
                    highlightCommentId={highlightCommentId}
                    autoFocusInput={internalMode === "comment"}
                  />
                )}
              </>
            )}
      </ScrollView>
    </View>
  );

  // Edit-post sub-surface. On mobile it becomes an absolute-filled
  // overlay inside this same mid-band; on web wide it stays a
  // centered floating card on its own RN <Modal>.
  const editSub = editingPost ? (
    isMobile ? (
      <View style={[s.mobileHost, { top: insets.top + MOBILE_HEADER_HEIGHT, bottom: 0 }]}>
        <View style={s.editModalMobile}>
          <ComposePost
            onSubmit={async (data) => { await handleEditPost(editingPost.id, data); }}
            onCancel={() => setEditingPost(null)}
            user={user}
            products={[]}
            initialData={{ body: editingPost.teaser || (editingPost as any).body, images: (editingPost as any).images || [], location: editingPost.location || "" }}
          />
        </View>
      </View>
    ) : (
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
    )
  ) : null;

  // Mobile: render as an absolute-positioned mid-band view so the
  // sticky MobileHeader + MobileFooter stay painted. The
  // `GlobalPostModal` mount point in the root layout is inside the
  // relative wrapper that excludes MobileFooter — so `bottom: 0`
  // here lands at the top of the footer exactly.
  if (isMobile) {
    return (
      <>
        <View style={[s.mobileHost, { top: insets.top + MOBILE_HEADER_HEIGHT, bottom: 0 }]}>
          {cardBody}
        </View>
        {editSub}
      </>
    );
  }

  // Web wide: the pre-existing centered-card overlay via RN Modal.
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        {cardBody}
      </View>
      {editSub}
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
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
  // Mobile: the "card" fills the mid-band host exactly. No rounding,
  // no max — the absolute-positioned host already defines the band
  // between MobileHeader and MobileFooter, and the card fills it
  // edge-to-edge so body content scrolls inside.
  mobileHost: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: t.color.bg,
    // zIndex works cross-platform. On Android, `elevation` creates
    // a Material shadow layer whose hit-test outline can extend
    // slightly beyond the view's declared frame, intermittently
    // swallowing taps on sibling chrome (M2). Plain zIndex keeps
    // the paint order correct without the elevation outline quirk.
    zIndex: 40,
  } as any,
  cardMidBand: {
    width: "100%" as any,
    height: "100%" as any,
    maxWidth: undefined,
    maxHeight: undefined,
    borderRadius: 0,
  } as any,
  headerMobile: {
    justifyContent: "flex-start",
    gap: t.spacing.md,
  } as any,
  backBtn: { padding: t.spacing["2xs"] } as any,
  editModal: { width: "90%", maxWidth: 680, backgroundColor: t.color.bg, borderRadius: 12, overflow: "hidden", maxHeight: "85%", zIndex: 1 } as any,
  editModalMobile: { flex: 1, backgroundColor: t.color.bg, overflow: "hidden" } as any,
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
  // Identity surface — see ComposePost avatarFallback.
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
    backgroundColor: t.color["card.subtle"], padding: 12, marginBottom: 16,
  },
  repostNestedHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostNestedAuthor: { fontFamily: t.font["body.medium"], fontSize: t.size["font.sm"], color: t.color["text.primary"] },
  repostNestedTime: { fontFamily: t.font["body.regular"], fontSize: t.size["font.xs"], color: t.color["text.muted"] },
  repostNestedTeaser: { fontFamily: t.font["body.regular"], fontSize: t.size["font.base"], color: t.color["text.secondary"], lineHeight: 18 },
  repostBtnRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: t.spacing.md,
  },
  repostBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.color.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  } as any,
  repostBtnPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.96 }],
  } as any,
}));
