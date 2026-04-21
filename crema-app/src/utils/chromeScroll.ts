/**
 * chromeScroll — sitewide scroll-aware chrome.
 *
 * MobileHeader + MobileFooter subscribe to a single shared
 * Animated.Value (0 = fully shown, 1 = fully hidden). Any
 * ScrollView that wants the chrome to react to its scrolling
 * pipes its `onScroll` event through `onChromeScroll(e)`.
 *
 * Motion mirrors X / Instagram feed behaviour: chrome COLLAPSES
 * (height → 0) on scroll-down past a small threshold, expands
 * back on any scroll-up or when the scroll hits the top. We
 * animate height (not just translateY) so the flex column
 * reflows and the content below actually gains real estate —
 * otherwise the chrome leaves a blank slot behind it. That
 * means `useNativeDriver: false` here; the perf cost is
 * negligible since only two elements animate, once per
 * direction change.
 */
import { Animated, NativeScrollEvent, NativeSyntheticEvent, Platform } from "react-native";

const hidden = new Animated.Value(0);

type MutableState = { lastY: number; lastDir: "up" | "down" | null; running: Animated.CompositeAnimation | null };
const state: MutableState = { lastY: 0, lastDir: null, running: null };

// Minimum scroll delta (in px) before the chrome reacts. Small
// fidgety scrolls shouldn't flash the chrome open / closed.
const THRESHOLD = 8;
// Any scroll within this distance of the top snaps chrome open.
const TOP_ANCHOR = 40;

export function getChromeHiddenAnim(): Animated.Value {
  return hidden;
}

/** Reset chrome to fully shown. Call on page change / panel open
 *  where the user expects chrome to reappear even if they left
 *  the previous screen scrolled-down. */
export function showChromeNow() {
  state.running?.stop();
  state.running = Animated.timing(hidden, {
    toValue: 0,
    duration: 160,
    useNativeDriver: false,
  });
  state.running.start();
}

/** Pipe a ScrollView's onScroll event into the chrome animation.
 *  Safe to use with `scrollEventThrottle={16}` or lower. No-op on
 *  web — the web navbar (wide) and the narrow-web MobileHeader
 *  both stay sticky by design; scroll-hide chrome is a native-app
 *  idiom and the user explicitly asked for it to NOT apply on web. */
export function onChromeScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
  if (Platform.OS === "web") return;
  const y = e.nativeEvent.contentOffset.y;
  const dy = y - state.lastY;
  state.lastY = y;

  // Near the top — always show.
  if (y < TOP_ANCHOR) {
    if (state.lastDir !== "up") {
      state.lastDir = "up";
      animateTo(0);
    }
    return;
  }

  // Ignore fidgety motion below the threshold.
  if (Math.abs(dy) < THRESHOLD) return;

  if (dy > 0 && state.lastDir !== "down") {
    state.lastDir = "down";
    animateTo(1);
  } else if (dy < 0 && state.lastDir !== "up") {
    state.lastDir = "up";
    animateTo(0);
  }
}

function animateTo(target: 0 | 1) {
  state.running?.stop();
  state.running = Animated.timing(hidden, {
    toValue: target,
    duration: 180,
    useNativeDriver: false,
  });
  state.running.start();
}
