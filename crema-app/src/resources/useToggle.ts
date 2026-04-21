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
  /** Fires after the server confirms the toggle — receives the new
   *  state (`true` = now on / created, `false` = now off / deleted).
   *  Call-site typically uses this to flash a confirmation toast. */
  onToggled?: (nowToggled: boolean) => void;
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
      const raw: any = await apiFetchRaw(
        `/${resource}/${targetId}/toggle`,
        { method: "POST" },
      );
      const result = raw?.data ?? raw;
      setToggled(result.toggled);
      setCount(result.count);
      options.onToggled?.(!!result.toggled);
    } catch {
      // Rollback on error
      setToggled(prevToggled);
      setCount(prevCount);
    }
  }, [resource, targetId, toggled, count, options.onToggled]);

  return { toggled, count, toggle };
}
