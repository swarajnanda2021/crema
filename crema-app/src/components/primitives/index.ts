/**
 * Primitive components barrel export.
 *
 * These are the building blocks of the entire UI — platform-agnostic in concept,
 * platform-specific in rendering. On iOS, each becomes a SwiftUI equivalent.
 */

export { default as CroppedAvatar } from "./Avatar";
export { timeAgo } from "./TimeAgo";
export { default as Toggle } from "./Toggle";
export { default as ActionBar } from "./ActionBar";
export { default as CommentThread } from "./CommentThread";
export { default as ConfirmDeleteModal } from "./ConfirmDeleteModal";

/** Dispatch global event to open the sitewide PostModal */
export function openPostModal(opts: { postId?: number; post?: any; mode?: string; highlightCommentId?: number }) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crema:open-post", { detail: opts }));
  }
}
