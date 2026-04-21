/**
 * Home Feed — CRUD Utopia edition.
 *
 * Uses useResource<Post>("posts") for data loading.
 * Renders PostCard (for articles, notes, reposts) composing primitives + tokens.
 * ComposePost creates via POST /api/posts.
 *
 * On iOS/Swift: SwiftUI List with PostCardView, same data from same API.
 */

import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { Plus } from "lucide-react-native";

import { useAuth } from "../../src/hooks/useAuth";
import { apiFetchRaw } from "../../src/api/client";
import { listen } from "../../src/utils/events";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import { useResource } from "../../src/resources/useResource";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { openPostModal, openComposePost, ConfirmDeleteModal } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import SwipeToCommit from "../../src/components/mobile/SwipeToCommit";
import { t } from "../../src/tokens/useTokens";
import type { Post } from "../../src/resources/types";

const FEED_PER_PAGE = 5;

export default function FeedPage() {
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const [visibleCount, setVisibleCount] = useState(FEED_PER_PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [postToDelete, setPostToDelete] = useState<Post | null>(null);

  // Generic resource hook — fetches all posts sorted by published_at DESC
  const { data: posts, loading, refetch } = useResource<Post>("posts", { limit: 40 });

  // Normalize: the timeline returns envelope { data: [...], meta: {...} }
  const items = Array.isArray(posts) ? posts : [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Reload after GlobalComposePost submits — either a new post or an
  // edit of an existing one.
  useEffect(() => listen("crema:posts-updated", () => refetch()), [refetch]);

  if (loading && items.length === 0) {
    return (
      <View style={s.loading}>
        <Text style={s.loadingText}>Loading feed...</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["accent.cta"]} />}
        onScroll={(e) => {
          // Pipe into the sitewide chrome-hide animation so the
          // header + footer slide away on scroll-down like X.
          onChromeScroll(e);
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
            if (visibleCount < items.length) {
              setVisibleCount((c) => Math.min(c + FEED_PER_PAGE, items.length));
            }
          }
        }}
        scrollEventThrottle={16}
      >
        {/* Feed items — compose is now a floating modal (see below) so the
            feed stays in place when the FAB is tapped instead of getting
            pushed down by an inline composer. */}
        {items.length === 0 ? (
          <Text style={s.empty}>Nothing in the feed yet. Taste some coffees!</Text>
        ) : (
          items.slice(0, visibleCount).map((post, idx) => {
            const card = (
              <PostCard
                post={post}
                user={user}
                isOwner={user?.id === post.user_id}
                hideActionBar={isMobile}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                onEdit={(p) => openComposePost({
                  editPostId: p.id,
                  initialData: {
                    body: p.teaser || (p as any).body,
                    images: (p as any).images || [],
                    location: p.location || "",
                  },
                })}
                onDelete={(p) => setPostToDelete(p)}
              />
            );
            return (
              <View key={`post-${post.id}-${idx}`}>
                {isMobile ? (
                  <SwipeToCommit
                    onSwipeLike={async () => {
                      // Fire the toggle endpoint directly; refetch so the
                      // feed's post state reflects the new like count.
                      // ActionBar is hidden on mobile feed rows, so the
                      // round-trip is the sole source of truth.
                      try {
                        await apiFetchRaw(`/post_likes/${post.id}/toggle`, { method: "POST" });
                        refetch();
                      } catch {
                        /* swallow — the swipe is best-effort */
                      }
                    }}
                    onSwipeComment={() => openPostModal({ post, mode: "comment" })}
                  >
                    {card}
                  </SwipeToCommit>
                ) : card}
                {idx < Math.min(items.length, visibleCount) - 1 && <View style={s.divider} />}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* FAB — routes to the sitewide composer (GlobalComposePost at
          root layout) via the `openComposePost` helper. On mobile the
          composer renders in the mid-band between MobileHeader and
          MobileFooter; on web wide it stays a centered floating card.
          (§2.40.3 / §2.40.6) */}
      {user && (
        <Pressable onPress={() => openComposePost()} style={s.fab}>
          <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </Pressable>
      )}

      {/* Edit post routing is handled inline on the PostCard's edit
          tap — see the `onEdit` prop below. GlobalComposePost is
          re-used with `initialData` + `editPostId`. No local modal. */}

      {/* Confirm before deleting. The post lands in the recycle bin
         (§2.25) on delete — mention that in the body so the user
         knows the action is recoverable. */}
      <ConfirmDeleteModal
        visible={!!postToDelete}
        title="Delete this post?"
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!postToDelete) return;
          await apiFetchRaw(`/posts/${postToDelete.id}`, { method: "DELETE" });
          refetch();
        }}
        onClose={() => setPostToDelete(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg } as any,
  loadingText: { fontFamily: t.font["body.regular"], color: t.color["text.secondary"] },
  container: { flex: 1, backgroundColor: t.color.bg },
  scroll: { flex: 1 },
  content: {
    maxWidth: 900,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing["2xl"],
    paddingBottom: 100,
  },
  empty: {
    textAlign: "center", paddingVertical: t.spacing["5xl"],
    fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.secondary"],
  },
  divider: { height: 1, backgroundColor: t.color.divider },
  editOverlayWrap: { flex: 1, justifyContent: "center", alignItems: "center" } as any,
  editOverlayWrapFull: { backgroundColor: t.color.bg } as any,
  editOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" } as any,
  editModal: { width: "90%", maxWidth: 680, backgroundColor: "#FAF8F0", borderRadius: 12, overflow: "hidden", maxHeight: "85%", zIndex: 1 } as any,
  // Mobile: edge-to-edge composer. No radius, no max, no backdrop.
  editModalFull: {
    width: "100%" as any, height: "100%" as any,
    maxWidth: undefined, maxHeight: undefined, borderRadius: 0,
  } as any,
  fab: {
    position: "absolute", bottom: 28, right: 28,
    width: t.size["fab.size"], height: t.size["fab.size"], borderRadius: t.size["fab.size"] / 2,
    alignItems: "center", justifyContent: "center",
    backgroundColor: t.color["text.primary"],
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  } as any,
});
