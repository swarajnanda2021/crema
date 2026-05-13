/**
 * Home Feed — CRUD Utopia edition.
 *
 * Uses useResource<Post>("posts") for data loading.
 * Renders PostCard (for articles, notes, reposts) composing primitives + tokens.
 * ComposePost creates via POST /api/posts.
 *
 * On iOS/Swift: SwiftUI List with PostCardView, same data from same API.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from "react-native";

import { useAuth } from "../../src/hooks/useAuth";
import { apiFetchRaw } from "../../src/api/client";
import { listen } from "../../src/utils/events";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import { useResource } from "../../src/resources/useResource";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { openPostModal, openComposePost, ConfirmDeleteModal } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import HiddenPostRow from "../../src/components/domain/HiddenPostRow";
import ScrollScrubber, { type ScrollScrubberHandle } from "../../src/components/mobile/ScrollScrubber";
import { hidePost, dislikePost, confirmAndReport } from "../../src/utils/postMenuActions";
import { t, makeStyles } from "../../src/tokens/useTokens";
import type { Post } from "../../src/resources/types";

const FEED_PER_PAGE = 5;

export default function FeedPage() {
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const [visibleCount, setVisibleCount] = useState(FEED_PER_PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [postToDelete, setPostToDelete] = useState<Post | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrubberRef = useRef<ScrollScrubberHandle>(null);
  const s = useStyles();
  // Local hide-state overrides. The map stores the viewer's
  // current intent for a given post id: `true` = hidden,
  // `false` = explicitly un-hidden (Undo after hide). Missing key
  // = fall through to the server's `hidden_by_me` flag. This lets
  // Undo win over a server-sourced hidden_by_me without a refetch.
  const [hideOverrides, setHideOverrides] = useState<Map<number, boolean>>(new Map());
  const isPostHidden = (p: Post) => {
    if (hideOverrides.has(p.id)) return hideOverrides.get(p.id) === true;
    return !!(p as any).hidden_by_me;
  };

  // Generic resource hook — fetches all posts sorted by published_at DESC
  const { data: posts, loading, refetch } = useResource<Post>("posts", { limit: 40 });

  // Keep hidden posts in the list so we can render the
  // HiddenPostRow stand-in + Undo. Only filter if we ever need
  // to hard-remove (not today).
  const items = Array.isArray(posts) ? posts : [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Reload after GlobalComposePost submits — either a new post or an
  // edit of an existing one.
  useEffect(() => listen("crema:posts-updated", () => refetch()), [refetch]);

  // X-style re-tap: tapping the active Home tab while already on the
  // feed scrolls this ScrollView to the top. MobileFooter fires
  // `crema:rescroll-home` on the active-tap path.
  useEffect(() => listen("crema:rescroll-home", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }), []);

  if (loading && items.length === 0) {
    return (
      <View style={s.loading}>
        <Text style={s.loadingText}>Loading feed...</Text>
      </View>
    );
  }

  return (
    <View testID="feed-screen" style={s.container}>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["accent.cta"]} />}
        onScroll={(e) => {
          // Pipe into the sitewide chrome-hide animation so the
          // header + footer slide away on scroll-down like X.
          onChromeScroll(e);
          // Right-edge drag-to-jump scrubber (§2.40.12). Native-only.
          scrubberRef.current?.onScroll(e);
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
            const hidden = isPostHidden(post);
            // When hidden, swap the whole card for the collapsed
            // Undo stand-in. Tapping Undo flips the override back to
            // false and re-toggles the server (since post_hides is a
            // toggle, the second POST deletes the row).
            if (hidden) {
              return (
                <View key={`post-${post.id}-${idx}`}>
                  <HiddenPostRow
                    onUndo={() => {
                      setHideOverrides((m) => new Map(m).set(post.id, false));
                      hidePost(post.id);
                    }}
                  />
                  {idx < Math.min(items.length, visibleCount) - 1 && <View style={s.divider} />}
                </View>
              );
            }
            const card = (
              <PostCard
                post={post}
                user={user}
                isOwner={user?.id === post.user_id}
                onOpen={(p) => openPostModal({ post: p, mode: "view" })}
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
                onHide={(p) => {
                  setHideOverrides((m) => new Map(m).set(p.id, true));
                  hidePost(p.id);
                }}
                onReport={(p) => confirmAndReport(p.id)}
                onDislike={(p) => dislikePost(p.id)}
              />
            );
            return (
              <View key={`post-${post.id}-${idx}`}>
                {/* SwipeToCommit (swipe-left-to-like, swipe-right-
                    to-comment) was retired in §2.40.22 — the
                    visible action bar under each post is the
                    affordance the user opted for. */}
                {card}
                {idx < Math.min(items.length, visibleCount) - 1 && <View style={s.divider} />}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Right-edge drag-to-jump scrubber (§2.40.12). Fades in while
          scrolling, out after ~900ms idle. Native-only; web keeps the
          browser scrollbar. */}
      <ScrollScrubber ref={scrubberRef} scrollRef={scrollRef} />

      {/* The "Create post" pill that used to live here as an inline
          circular FAB is now rendered at root layout via
          `<ConditionalCreatePostFab />` (Figma 864:3286 spec —
          Crema-pink pill, "+" icon + "Create post" label). Mounted
          there because the inline mount inherited per-frame
          re-layout from the chrome-scroll's height-animated
          MobileHeader, producing a visible jitter on the
          `position: absolute, bottom: 28` element. The relative
          wrapper at root has a stable bottom edge (footer height
          is fixed), so the pill stays put. (§2.40.16) */}

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

const useStyles = makeStyles((t) => ({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg } as any,
  loadingText: { fontFamily: t.font["body.regular"], color: t.color["text.secondary"] },
  container: { flex: 1, backgroundColor: t.color.bg },
  scroll: { flex: 1 },
  // The feed's contentContainer drops horizontal padding so the
  // post divider runs edge-to-edge of the column (Figma feed
  // spec). Each PostCard owns its own internal padding via
  // `cardMobile` / `card`. The empty-state Text below has
  // `textAlign: "center"` so it still centres without padding.
  content: {
    maxWidth: 900,
    alignSelf: "center" as any,
    width: "100%" as any,
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
  editModal: { width: "90%", maxWidth: 680, backgroundColor: t.color.bg, borderRadius: 12, overflow: "hidden", maxHeight: "85%", zIndex: 1 } as any,
  // Mobile: edge-to-edge composer. No radius, no max, no backdrop.
  editModalFull: {
    width: "100%" as any, height: "100%" as any,
    maxWidth: undefined, maxHeight: undefined, borderRadius: 0,
  } as any,
}));
