/**
 * HapticPressable — Pressable + implicit haptic feedback.
 *
 * Drop-in replacement for raw `Pressable` at tactile touchpoints —
 * menu items, FABs, CTAs, toggles, send buttons. Fires a haptic
 * from `utils/haptics` BEFORE delegating to `onPress`, so the user
 * feels the confirm tick the instant their finger releases rather
 * than after whatever the handler does (which may be async).
 *
 * Pick `haptic` by semantic weight, not by look:
 *   "tap"    — normal button press (default).
 *   "select" — a toggle / selection change (follow, like, menu pick).
 *   "commit" — action past a meaningful threshold (submit, send).
 *   "warn"   — destructive or careful (delete, report).
 *   "error"  — failure.
 *   "none"   — disable (rare; just use raw Pressable instead).
 *
 * Web is a pass-through — `haptics.ts` already no-ops there, so there
 * is no runtime cost on desktop.
 *
 * On iOS/Swift: `Button` + `UIImpactFeedbackGenerator` at the tap
 * site. Same semantic weights map 1:1.
 */
import { Pressable, PressableProps, GestureResponderEvent } from "react-native";
import { tap, select, commit, warn, error } from "../../utils/haptics";

const fireByKind: Record<string, () => void> = {
  tap,
  select,
  commit,
  warn,
  error,
  none: () => {},
};

export type HapticKind = "tap" | "select" | "commit" | "warn" | "error" | "none";

export interface HapticPressableProps extends PressableProps {
  /** Haptic weight to fire on press. Default "tap". */
  haptic?: HapticKind;
}

export default function HapticPressable({ haptic = "tap", onPress, ...rest }: HapticPressableProps) {
  const wrappedOnPress = onPress
    ? (e: GestureResponderEvent) => {
        fireByKind[haptic]?.();
        onPress(e);
      }
    : undefined;
  return <Pressable {...rest} onPress={wrappedOnPress} />;
}
