/**
 * VirtualList — sitewide standard for virtualized scrollable lists.
 *
 * Thin wrapper around React Native's FlatList with sensible defaults
 * for windowed rendering. Items outside the viewport window are unmounted
 * to keep memory bounded.
 *
 * Usage:
 *   <VirtualList
 *     data={posts}
 *     renderItem={(item) => <PostFeedCard post={item} />}
 *     keyExtractor={(item) => String(item.id)}
 *   />
 *
 * Presets:
 *   Posts/Feed:  initialNumToRender=5,  windowSize=5, maxToRenderPerBatch=3
 *   Followers:   initialNumToRender=25, windowSize=7, maxToRenderPerBatch=10
 *   Comments:    initialNumToRender=25, windowSize=7, maxToRenderPerBatch=10
 *   CoffeeGrid:  initialNumToRender=24, windowSize=5, maxToRenderPerBatch=6
 */

import React, { useCallback } from "react";
import { FlatList, FlatListProps, View } from "react-native";

type VirtualListProps<T> = {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  /** Number of items to render in the initial batch. Default: 5 */
  initialNumToRender?: number;
  /** How many viewport heights to render above/below. Default: 5 (≈2 screens each direction) */
  windowSize?: number;
  /** Max items to render per incremental batch. Default: 3 */
  maxToRenderPerBatch?: number;
  /** Called when scroll reaches the end. Use for loading more data. */
  onEndReached?: () => void;
  /** Distance from end (in px) to trigger onEndReached. Default: 300 */
  onEndReachedThreshold?: number;
  /** Component shown when data is empty */
  ListEmptyComponent?: React.ReactElement | null;
  /** Rendered between items */
  ItemSeparatorComponent?: React.ComponentType<any> | null;
  /** Rendered above all items (e.g. hero section, compose form) */
  ListHeaderComponent?: React.ReactElement | null;
  /** Rendered below all items (e.g. loading indicator) */
  ListFooterComponent?: React.ReactElement | null;
  /** Pull-to-refresh control */
  refreshControl?: React.ReactElement;
  showsVerticalScrollIndicator?: boolean;
  contentContainerStyle?: any;
  style?: any;
};

export default function VirtualList<T>({
  data,
  renderItem,
  keyExtractor,
  initialNumToRender = 5,
  windowSize = 5,
  maxToRenderPerBatch = 3,
  onEndReached,
  onEndReachedThreshold = 0.3,
  ListEmptyComponent,
  ItemSeparatorComponent,
  ListHeaderComponent,
  ListFooterComponent,
  refreshControl,
  showsVerticalScrollIndicator = false,
  contentContainerStyle,
  style,
}: VirtualListProps<T>) {
  const flatListRenderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => renderItem(item, index),
    [renderItem],
  );

  return (
    <FlatList
      data={data}
      renderItem={flatListRenderItem}
      keyExtractor={keyExtractor}
      initialNumToRender={initialNumToRender}
      windowSize={windowSize}
      maxToRenderPerBatch={maxToRenderPerBatch}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={false} // safer on web
      onEndReached={onEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      ListEmptyComponent={ListEmptyComponent}
      ItemSeparatorComponent={ItemSeparatorComponent}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      contentContainerStyle={contentContainerStyle}
      style={style}
    />
  );
}

/**
 * Preset configs for different list types.
 * Use with spread: <VirtualList {...VIRTUAL_PRESETS.posts} data={...} ... />
 */
export const VIRTUAL_PRESETS = {
  posts: { initialNumToRender: 5, windowSize: 5, maxToRenderPerBatch: 3 },
  followers: { initialNumToRender: 25, windowSize: 7, maxToRenderPerBatch: 10 },
  comments: { initialNumToRender: 25, windowSize: 7, maxToRenderPerBatch: 10 },
  coffeeGrid: { initialNumToRender: 24, windowSize: 5, maxToRenderPerBatch: 6 },
  roasters: { initialNumToRender: 20, windowSize: 5, maxToRenderPerBatch: 5 },
} as const;
