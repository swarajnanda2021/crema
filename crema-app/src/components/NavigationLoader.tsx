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

import { t } from "../tokens/useTokens";
import { listen } from "../utils/events";
import CremaLogo from "./CremaLogo";
import SiteHeader from "./SiteHeader";
import { useAuth } from "../hooks/useAuth";

const MIN_DISPLAY_MS = 320;

export default function NavigationLoader() {
  const pathname = usePathname();
  const { loading: authLoading } = useAuth();
  const prevPathRef = useRef(pathname);
  // Start visible on initial mount so the first paint after a hard
  // reload (e.g. account switch → window.location.assign) is the
  // Crema wordmark, not the partially-hydrated destination page.
  const [visible, setVisible] = useState(true);
  const minHoldTimerRef = useRef<any>(null);
  const explicitHoldRef = useRef(0);
  const pulse = useRef(new Animated.Value(0.45)).current;

  // Arm the minimum-display timer on initial mount too, so the
  // overlay isn't stuck up forever if auth resolves in under 5ms.
  useEffect(() => {
    showOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the overlay up for the duration of auth hydration — on a
  // fresh page load / account switch, the old profile page briefly
  // tries to render as the new user (or as "not found" while the
  // catalog hydrates). Holding the curtain until `authLoading` flips
  // to false guarantees the user only ever sees the next fully-
  // resolved page.
  useEffect(() => {
    if (authLoading) {
      explicitHoldRef.current += 1;
      showOverlay();
    } else {
      // Decrement but never below zero — guards against strict-mode
      // double-fire in development.
      explicitHoldRef.current = Math.max(0, explicitHoldRef.current - 1);
      scheduleHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

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
    const offStart = listen("crema:loading-start", () => {
      explicitHoldRef.current += 1;
      showOverlay();
    });
    const offEnd = listen("crema:loading-end", () => {
      explicitHoldRef.current = Math.max(0, explicitHoldRef.current - 1);
      scheduleHide();
    });
    return () => { offStart(); offEnd(); };
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

  // Navbar stays visible through the curtain on every page EXCEPT
  // /auth — the auth screen replaces the navbar with its own hero
  // layout, so rendering a navbar there would double up.
  const onAuth = pathname?.startsWith("/auth");

  return (
    <>
      {!onAuth && (
        <View style={s.navbarLayer} pointerEvents="auto">
          <SiteHeader />
        </View>
      )}
      <View style={s.overlay} pointerEvents="auto">
        <Animated.View style={{ opacity: pulse }}>
          <CremaLogo width={240} height={50} />
        </Animated.View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  // Ensures the navbar is painted for the duration of the curtain,
  // so hard-reloads (account switch) never leave a bare cream strip
  // where the nav should be. zIndex sits just above the overlay
  // card (9500) but below the dropdowns the navbar hosts.
  navbarLayer: {
    ...(Platform.OS === "web"
      ? ({ position: "fixed" as any } as any)
      : ({ position: "absolute" as any } as any)),
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9600,
  } as any,
  // Full-viewport curtain. SiteHeader (zIndex 9600) sits on top so
  // the mobile + web chrome stays visible while the page under the
  // curtain pages in. Using top:0 (vs. NAVBAR_HEIGHT) avoids a gap
  // on mobile where the header is 48px + safe-area inset, not 72px.
  overlay: {
    ...(Platform.OS === "web"
      ? ({ position: "fixed" as any } as any)
      : ({ position: "absolute" as any } as any)),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9500, // below navbar (9999), above page content
  } as any,
});
