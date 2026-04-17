/**
 * NavigationLoader — sitewide page-transition overlay.
 *
 * The navbar persists across route changes but the rest of the
 * content below it otherwise renders in pieces as each data hook
 * resolves. This overlay hides that partial-render window: on every
 * pathname change it paints a solid cream surface over the page
 * area (excluding the navbar) + a subtle pulsing "crema" wordmark,
 * for a minimum of ~320ms. Pages that want to hold the overlay
 * longer — for slow data — can fire `crema:loading-start` /
 * `crema:loading-end` events; the overlay stays up until either the
 * min time AND the explicit "end" event fire.
 *
 * Why a minimum time: most pages mount + render in < 120ms on web,
 * which is too fast to feel like a deliberate transition and too
 * short to read as a buffer. The 320ms threshold gives the
 * transition an intentional rhythm without dragging.
 *
 * Why positioned below the navbar: the navbar is the site's fixed
 * anchor. Keeping it visible during a transition matches what web
 * apps like GitHub + Linear do — users always know they're still
 * in the app, just moving between rooms.
 */

import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform, Animated, Easing } from "react-native";
import { usePathname } from "expo-router";

import { NAVBAR_HEIGHT, t } from "../tokens/useTokens";
import CremaLogo from "./CremaLogo";

const MIN_DISPLAY_MS = 320;

export default function NavigationLoader() {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  const [visible, setVisible] = useState(false);
  const minHoldTimerRef = useRef<any>(null);
  const explicitHoldRef = useRef(0);
  const pulse = useRef(new Animated.Value(0.45)).current;

  // Start the overlay on pathname change.
  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    showOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Allow pages to extend the hold when their data is slow. Listen
  // for two custom events on web. Native ships without event
  // pickup; pages there rely purely on the min-time default.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onStart = () => { explicitHoldRef.current += 1; showOverlay(); };
    const onEnd = () => {
      explicitHoldRef.current = Math.max(0, explicitHoldRef.current - 1);
      scheduleHide();
    };
    window.addEventListener("crema:loading-start", onStart);
    window.addEventListener("crema:loading-end", onEnd);
    return () => {
      window.removeEventListener("crema:loading-start", onStart);
      window.removeEventListener("crema:loading-end", onEnd);
    };
  }, []);

  // Pulse animation for the wordmark — ~1.1s cycle, slightly
  // asymmetrical so it feels alive without being distracting.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(pulse, { toValue: 0.45, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  function showOverlay() {
    setVisible(true);
    if (minHoldTimerRef.current) clearTimeout(minHoldTimerRef.current);
    minHoldTimerRef.current = setTimeout(() => {
      minHoldTimerRef.current = null;
      if (explicitHoldRef.current === 0) setVisible(false);
    }, MIN_DISPLAY_MS);
  }

  function scheduleHide() {
    // If the min-time has already elapsed, fade out immediately;
    // otherwise the running timer will handle it.
    if (minHoldTimerRef.current == null && explicitHoldRef.current === 0) {
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <View style={s.overlay} pointerEvents="auto">
      <Animated.View style={{ opacity: pulse }}>
        <CremaLogo width={240} height={50} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  // Pinned below the navbar. Uses `position: "fixed"` on web so the
  // overlay stays put while the page underneath is paging in.
  overlay: {
    ...(Platform.OS === "web"
      ? ({ position: "fixed" as any } as any)
      : ({ position: "absolute" as any } as any)),
    top: NAVBAR_HEIGHT,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9500, // below navbar (9999), above page content
  } as any,
});
