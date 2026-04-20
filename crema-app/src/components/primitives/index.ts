/**
 * Primitive components barrel export.
 *
 * These are the building blocks of the entire UI — platform-agnostic in concept,
 * platform-specific in rendering. On iOS, each becomes a SwiftUI equivalent.
 */
import { emit } from "../../utils/events";

export { default as CroppedAvatar } from "./Avatar";
export { timeAgo } from "./TimeAgo";
export { default as Toggle } from "./Toggle";
export { default as ActionBar } from "./ActionBar";
export { default as CommentThread } from "./CommentThread";
export { default as ConfirmDeleteModal } from "./ConfirmDeleteModal";

/** Fire the sitewide PostModal — Comment / Repost / post-card-tap
 * all route through here. Cross-platform via the events helper
 * (DeviceEventEmitter on native, window CustomEvent on web). */
export function openPostModal(opts: { postId?: number; post?: any; mode?: string; highlightCommentId?: number }) {
  emit("crema:open-post", opts);
}
