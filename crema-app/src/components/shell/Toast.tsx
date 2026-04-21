/**
 * Toast — sitewide status pill that slides down from under the
 * header.
 *
 * Single-instance toast mounted once at the root layout. Any
 * call-site fires a new toast via `showToast("message")`; the
 * component listens to the `crema:toast` event (DeviceEventEmitter
 * on native, window CustomEvent on web — routed through the
 * `utils/events` helper), slides in, dwells ~1.4 s, slides back up
 * and unmounts. New toasts replace older ones immediately — we
 * don't stack because the user only needs to see the most recent
 * action confirmation.
 *
 * Positioning: anchored to the top of the mid-band (below the
 * MobileHeader on mobile, below the SiteHeader on web wide). The
 * pill itself is centered horizontally via `alignSelf: "center"`.
 *
 * Intended use — post-action confirmations where the user needs a
 * "did that register?" signal that a haptic alone can't convey:
 *   showToast("Liked");
 *   showToast("Unliked");
 *   showToast("Commented");
 *   showToast("Reposted");
 *
 * Never use this for errors — those go through the dedicated error
 * surface (red banner, inline inputs). Toast is success-only and
 * intentionally quiet: `t.color.accent` on `text.on-dark`, small
 * pill, no iconography, no dismiss affordance. Tap-to-dismiss is
 * available but nobody reads it fast enough to use it.
 *
 * Web + native: same component, same event plumbing. On web the
 * animation uses `useNativeDriver: false` (transform only, RN Web
 * supports it).
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBreakpoint } from "../../hooks/useBreakpoint";
import { emit, listen } from "../../utils/events";
import { t } from "../../tokens/useTokens";

const DWELL_MS = 1400;
const SLIDE_IN_MS = 220;
const SLIDE_OUT_MS = 200;
const HIDDEN_Y = -72;
const NAVBAR_MOBILE = (t.size as any)["navbar.mobile.height"];
const NAVBAR_DESKTOP = (t.size as any)["navbar.height"];

/** Fire a status toast. Call from any component, any thread — the
 *  global Toast mount handles rendering. */
export function showToast(message: string) {
  if (!message) return;
  emit("crema:toast", { message });
}

export default function Toast() {
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(HIDDEN_Y)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIn = useRef<Animated.CompositeAnimation | null>(null);
  const activeOut = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    return listen("crema:toast", (detail: any) => {
      const next = detail?.message;
      if (typeof next !== "string" || !next) return;

      // New toast replaces any in-flight one. Clear both the dwell
      // timer and any running animation so we don't cross-fade or
      // double-animate.
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      activeIn.current?.stop();
      activeOut.current?.stop();

      setMsg(next);
      translateY.setValue(HIDDEN_Y);
      opacity.setValue(0);
      activeIn.current = Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: SLIDE_IN_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: SLIDE_IN_MS, useNativeDriver: true }),
      ]);
      activeIn.current.start(() => {
        hideTimer.current = setTimeout(dismiss, DWELL_MS);
      });
    });
  }, []);

  const dismiss = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    activeOut.current?.stop();
    activeOut.current = Animated.parallel([
      Animated.timing(translateY, { toValue: HIDDEN_Y, duration: SLIDE_OUT_MS, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: SLIDE_OUT_MS, useNativeDriver: true }),
    ]);
    activeOut.current.start(({ finished }) => { if (finished) setMsg(null); });
  };

  if (!msg) return null;

  // Anchor below the header: MobileHeader (63 px + safe-area inset on
  // native) or SiteHeader (72 px) on web wide.
  const topOffset = isMobile
    ? (Platform.OS === "web" ? 0 : insets.top) + NAVBAR_MOBILE + 8
    : NAVBAR_DESKTOP + 12;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[s.host, { top: topOffset }]}
    >
      <Animated.View style={[s.pillAnim, { transform: [{ translateY }], opacity }]}>
        <Pressable onPress={dismiss} style={s.pill} accessibilityRole="alert">
          <Text style={s.text}>{msg}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    // Sits above modals / FABs / chrome. Kept below RN Modal overlays
    // by design — error modals still steal focus.
    ...(Platform.OS === "web" ? { zIndex: 10000 } : { elevation: 20 }),
  } as any,
  pillAnim: {
    alignSelf: "center",
  } as any,
  pill: {
    backgroundColor: t.color.accent,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm + 2,
    borderRadius: t.radius.full,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  } as any,
  text: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-dark"],
    letterSpacing: -0.1,
  },
});
