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

/** Fire the sitewide PopularityModal — CoffeeCard's social dot is
 * the sole caller. Mounted at root layout inside the chrome-aware
 * mid-band wrapper so on mobile the MobileHeader + MobileFooter
 * stay painted while the modal is open. (§2.40.3) */
export function openPopularityModal(opts: {
  productId: string;
  coffeeName: string;
  roasterName?: string;
  roastLevel?: string;
  process?: string;
  productUrl?: string;
}) {
  emit("crema:open-popularity", opts);
}

/** Fire the sitewide feed composer — the Home FAB + Profile "Post"
 * prompt + Roaster/Café-profile FABs all route through here so there
 * is a single composer surface sitewide. Mounted at root layout
 * inside the chrome-aware mid-band wrapper. (§2.40.3 / §2.40.6)
 *
 * `endpoint` lets the caller override the POST target — defaults to
 * `/posts` (regular feed), but the roaster / café / user-profile
 * flows set `/roaster-posts` + `/cafe-posts` + their own slug
 * via `extraData` so the same composer UI funnels into the right
 * table on submit. */
export function openComposePost(opts?: {
  initialData?: { body?: string; images?: any[]; location?: string };
  editPostId?: number;
  endpoint?: string;
  extraData?: Record<string, any>;
  refetchEventName?: string;
}) {
  emit("crema:open-compose", opts || {});
}
