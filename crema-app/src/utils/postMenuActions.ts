/**
 * postMenuActions — shared handlers for the non-owner three-dots
 * menu items on any PostCard (feed, profile, roaster, cafe, user).
 *
 * Each endpoint records a recommender-engine signal:
 *   hide     — negative; the feed also optimistically filters the
 *              post out locally so the action feels instant.
 *   dislike  — silent negative; no visible effect on the current
 *              feed. Logged for ranking in the Phase 2 engine.
 *   report   — moderation signal; gated behind a confirm (tap →
 *              native Alert on iOS/Android, window.confirm on web)
 *              so a stray tap doesn't ship a report.
 *
 * Every request is best-effort: network failures are swallowed
 * because the UI has already moved on (the menu closed, the row
 * is gone from the feed). A background retry / offline queue is a
 * Phase 2 concern bundled with the recommender.
 */
import { Alert, Platform } from "react-native";
import { apiFetchRaw } from "../api/client";

export async function hidePost(postId: number): Promise<void> {
  try {
    await apiFetchRaw(`/post_hides/${postId}/toggle`, { method: "POST" });
  } catch {
    /* best-effort */
  }
}

export async function dislikePost(postId: number): Promise<void> {
  try {
    await apiFetchRaw(`/post_dislikes/${postId}/toggle`, { method: "POST" });
  } catch {
    /* best-effort */
  }
}

export async function reportPost(postId: number, reason?: string): Promise<void> {
  try {
    await apiFetchRaw(`/post_reports`, {
      method: "POST",
      body: JSON.stringify({ post_id: postId, reason: reason ?? null }),
    });
  } catch {
    /* best-effort */
  }
}

/** Confirm before firing the report — a single accidental tap
 *  shouldn't submit a report. Web uses `window.confirm`; native
 *  uses `Alert.alert` so the dialog reads as a system sheet.
 */
export function confirmAndReport(postId: number, onReported?: () => void): void {
  const submit = () => { reportPost(postId).then(() => { onReported?.(); }); };
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm("Report this post? Our moderators will review.")) {
      submit();
    }
  } else {
    Alert.alert(
      "Report this post?",
      "Our moderators will review.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Report", style: "destructive", onPress: submit },
      ],
    );
  }
}
