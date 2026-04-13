/**
 * Generic toggle hook — handles like/unlike, follow/unfollow for any toggle resource.
 *
 * Usage:
 *   const like = useToggle("post_likes", post.id, { initial: post.liked_by_me, count: post.like_count });
 *   <Pressable onPress={like.toggle}>
 *     {like.toggled ? <HeartFilled /> : <HeartOutline />}
 *     <Text>{like.count}</Text>
 *   </Pressable>
 *
 * When building iOS: this becomes a Swift @Observable class.
 */

import { useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";
import type { Envelope, ToggleResult } from "./types";

interface ToggleOptions {
  /** Initial toggled state (e.g. from liked_by_me on the parent resource) */
  initial?: boolean;
  /** Initial count (e.g. from like_count on the parent resource) */
  count?: number;
}

export function useToggle(resource: string, targetId: string | number, options: ToggleOptions = {}) {
  const [toggled, setToggled] = useState(options.initial ?? false);
  const [count, setCount] = useState(options.count ?? 0);

  const toggle = useCallback(async () => {
    // Optimistic update
    const prevToggled = toggled;
    const prevCount = count;
    setToggled(!prevToggled);
    setCount(prevToggled ? prevCount - 1 : prevCount + 1);

    try {
      const envelope: Envelope<ToggleResult> = await apiFetchRaw(
        `/${resource}/${targetId}/toggle`,
        { method: "POST" },
      );
      setToggled(envelope.data.toggled);
      setCount(envelope.data.count);
    } catch {
      // Rollback on error
      setToggled(prevToggled);
      setCount(prevCount);
    }
  }, [resource, targetId, toggled, count]);

  return { toggled, count, toggle };
}
