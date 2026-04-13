/**
 * Home Feed — CRUD Utopia edition.
 *
 * Uses useResource<Post>("posts") for data loading.
 * Renders PostCard (for articles, notes, reposts) composing primitives + tokens.
 * ComposePost creates via POST /api/posts.
 *
 * On iOS/Swift: SwiftUI List with PostCardView, same data from same API.
 */

import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { Plus } from "lucide-react-native";

import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { apiFetch } from "../../src/api/client";
import { useResource } from "../../src/resources/useResource";
import { openPostModal } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import ComposePost from "../../src/components/ComposePost";
import { t } from "../../src/tokens/useTokens";
import type { Post } from "../../src/resources/types";

const FEED_PER_PAGE = 5;

export default function FeedPage() {
  const { user } = useAuth();
  const { productMap } = useCoffeeData();
  const [visibleCount, setVisibleCount] = useState(FEED_PER_PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

  // Generic resource hook — fetches all posts sorted by published_at DESC
  const { data: posts, loading, refetch } = useResource<Post>("posts", { limit: 40 });

  // Normalize: the timeline returns envelope { data: [...], meta: {...} }
  const items = Array.isArray(posts) ? posts : [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCreatePost = useCallback(async (data: any) => {
    try {
      await apiFetch("/posts", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          post_type: data.post_type || "note",
          location: data.location || null,
        }),
      });
      setShowCompose(false);
      refetch();
    } catch (e: any) {
      console.warn("Post error:", e.message);
    }
  }, [refetch]);

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
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
            if (visibleCount < items.length) {
              setVisibleCount((c) => Math.min(c + FEED_PER_PAGE, items.length));
            }
          }
        }}
        scrollEventThrottle={400}
      >
        {/* Compose overlay */}
        {showCompose && (
          <>
            <ComposePost
              onSubmit={handleCreatePost}
              onCancel={() => setShowCompose(false)}
              loading={false}
              products={productMap ? Array.from(productMap.values()) : []}
              user={user}
            />
            {items.length > 0 && <View style={s.divider} />}
          </>
        )}

        {/* Feed items */}
        {items.length === 0 && !showCompose ? (
          <Text style={s.empty}>Nothing in the feed yet. Taste some coffees!</Text>
        ) : (
          items.slice(0, visibleCount).map((post, idx) => (
            <View key={`post-${post.id}-${idx}`}>
              <PostCard
                post={post}
                user={user}
                isOwner={user?.id === post.user_id}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                onDelete={async (p) => {
                  await apiFetch(`/posts/${p.id}`, { method: "DELETE" });
                  refetch();
                }}
              />
              {idx < Math.min(items.length, visibleCount) - 1 && <View style={s.divider} />}
            </View>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      {user && !showCompose && (
        <Pressable onPress={() => setShowCompose(true)} style={s.fab}>
          <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </Pressable>
      )}
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
  fab: {
    position: "absolute", bottom: 28, right: 28,
    width: t.size["fab.size"], height: t.size["fab.size"], borderRadius: t.size["fab.size"] / 2,
    alignItems: "center", justifyContent: "center",
    backgroundColor: t.color["text.primary"],
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  } as any,
});
