/**
 * Primitive components barrel export.
 *
 * These are the building blocks of the entire UI — platform-agnostic in concept,
 * platform-specific in rendering. On iOS, each becomes a SwiftUI equivalent.
 */
import { emit } from "../../utils/events";

export { default as CroppedAvatar } from "./Avatar";
export { default as RoasterLogo } from "./RoasterLogo";
export { timeAgo } from "./TimeAgo";
export { default as Toggle } from "./Toggle";
export { default as ActionBar } from "./ActionBar";
export { default as CommentThread } from "./CommentThread";
export { default as ConfirmDeleteModal } from "./ConfirmDeleteModal";
export { default as HapticPressable, type HapticKind, type HapticPressableProps } from "./HapticPressable";
export { useTabSlider } from "./TabSlider";

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
