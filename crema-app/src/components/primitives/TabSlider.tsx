/**
 * TabSlider — shared sliding-underline behaviour for every tab strip.
 *
 * The hook captures per-tab refs (via `trackTab(key)`), measures
 * them after every commit, and returns a reanimated style + an
 * imperative `slideTo(key)` method. The host renders the underline
 * using reanimated's `Animated.View` so the slide animates smoothly
 * on both web (transform/CSS) and native (UI-thread driven worklet).
 *
 * ┌─ Why decouple slide from React state ─────────────────────────┐
 * │ The slide and the content swap are TWO things that happen on  │
 * │ tab change:                                                   │
 * │                                                               │
 * │  - The slider runs on the UI thread (reanimated worklet)      │
 * │  - The content area re-renders on the JS thread (React)       │
 * │                                                               │
 * │ If both are triggered from the same React state update        │
 * │ (`setActiveTab`), the slide animation has to wait for React   │
 * │ to commit before its `useEffect` fires and calls `withTiming`.│
 * │ On a heavy content swap (RoastersList mounting + 5000-product │
 * │ data join + carousel image decodes), the JS thread can block  │
 * │ long enough that the slide feels stuttery or delayed — the    │
 * │ user perceives the tab strip as "buffering."                  │
 * │                                                               │
 * │ The fix: expose `slideTo(key)` as an imperative method.       │
 * │ Call sites invoke it BEFORE `setActiveTab`, so the animation  │
 * │ fires immediately on the press event. Reanimated schedules    │
 * │ the worklet on the UI thread synchronously; the slide is      │
 * │ already in flight by the time React processes the state       │
 * │ update and re-renders the content.                            │
 * └───────────────────────────────────────────────────────────────┘
 *
 * Why reanimated (and not RN's stock `Animated` or CSS-only):
 *
 * Stock `Animated.View` traverses the `style` array looking for
 * `Animated.Value` instances and attaches listeners — but on RN
 * Web the bridge skipped our values when they were inside a
 * `[styleA, styleB]` style array (the bar rendered once with the
 * initial value and never updated). CSS-only `transition` worked
 * on web but on iOS native there is no CSS — the bar would jump to
 * the new position instantly, reading as a flicker. Reanimated v4
 * drives the values on the UI thread via a worklet, smooth on both.
 *
 * Why measure via ref + post-render effect, not `onLayout`:
 *
 * RN Web's `Pressable` doesn't propagate `onLayout` reliably (the
 * underlying `<div>` has no layout listener wired up by default).
 * Capturing the ref and reading `getBoundingClientRect` (web) or
 * `View.measure` (native) after every commit works everywhere.
 *
 * Usage:
 *
 *   import Animated from "react-native-reanimated";
 *   const { trackTab, underlineStyle, slideTo } = useTabSlider(activeKey);
 *
 *   <View style={s.tabRow}>
 *     <Pressable
 *       ref={trackTab("posts")}
 *       onPress={() => {
 *         slideTo("posts");         // imperative — fires now
 *         setActive("posts");       // React state — async swap
 *       }}
 *     >
 *       <Text style={[s.tabText, active && s.tabTextActive]}>POSTS</Text>
 *     </Pressable>
 *     ... other tabs ...
 *
 *     <Animated.View
 *       pointerEvents="none"
 *       style={[underlineStyle, { bottom: -1, height: 4,
 *         backgroundColor: t.color["text.primary"] }]}
 *     />
 *   </View>
 *
 * `Animated.View` MUST come from `react-native-reanimated`, not
 * `react-native`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Platform } from "react-native";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

interface LayoutInfo { x: number; w: number; }

// useLayoutEffect on the server (SSR) logs a warning; fall back to
// useEffect there. Expo Web bundles for the client only, so this
// branch is defensive — we'll always hit useLayoutEffect at runtime.
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// 220 ms / decelerate-out — fast enough to feel responsive, slow
// enough that the eye perceives the slide. Same curve as iOS
// UISegmentedControl swaps.
const SLIDE_DURATION = 220;
const SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

export function useTabSlider(activeKey: string | null | undefined) {
  // Reanimated shared values — UI-thread state for the bar's left,
  // width, and opacity. Updates via `withTiming` are scheduled on
  // the worklet runner; the View's style reads them via
  // `useAnimatedStyle`. No bridge round-trip per frame, smooth at
  // 60 fps on iOS, smooth via requestAnimationFrame on web.
  const left = useSharedValue(0);
  const width = useSharedValue(0);
  const opacity = useSharedValue(0);
  // Track whether the bar has been positioned once — first
  // measurement should jump to the target without animation so the
  // bar doesn't slide in from x=0 on page mount. Subsequent
  // `slideTo` calls ride the easing curve.
  const initializedRef = useRef(false);

  // Layouts stored in a ref (not state) so `slideTo` reads them
  // synchronously without depending on React's render cycle. The
  // measure pass below mutates the ref and calls `slideTo` itself
  // when relevant — there's no scenario where the bar position
  // depends on React state that the imperative call doesn't know
  // about.
  const layoutsRef = useRef<Record<string, LayoutInfo>>({});
  // Per-key node refs. The host attaches these via
  // `ref={trackTab(key)}`.
  const nodesRef = useRef<Record<string, any>>({});
  // Per-key handler cache so refs have stable identity across
  // renders (React calls `ref` with the node on mount and `null`
  // on unmount; a new handler each render would trigger spurious
  // re-attaches).
  const handlersRef = useRef<Record<string, (node: any) => void>>({});
  const trackTab = (key: string) => {
    if (!handlersRef.current[key]) {
      handlersRef.current[key] = (node: any) => {
        nodesRef.current[key] = node;
      };
    }
    return handlersRef.current[key];
  };

  // Imperative slide-to. Call sites hit this synchronously from the
  // press handler so the animation kicks off BEFORE React processes
  // the state update that swaps the content area. Reanimated
  // schedules `withTiming` on the worklet — the bar starts moving
  // even if the subsequent JS thread is busy mounting the new
  // content. Stable identity via useCallback (refs as deps means
  // the function never re-creates).
  const slideTo = useCallback(
    (key: string | null | undefined) => {
      if (!key) return;
      const target = layoutsRef.current[key];
      if (!target) return;
      if (!initializedRef.current) {
        // First positioning — snap without animation so the bar
        // doesn't slide in from left=0 on page mount.
        left.value = target.x;
        width.value = target.w;
        opacity.value = withTiming(1, { duration: 120 });
        initializedRef.current = true;
        return;
      }
      left.value = withTiming(target.x, {
        duration: SLIDE_DURATION,
        easing: SLIDE_EASING,
      });
      width.value = withTiming(target.w, {
        duration: SLIDE_DURATION,
        easing: SLIDE_EASING,
      });
    },
    [left, width, opacity],
  );

  // After every commit, measure each ref's offset within its
  // positioned ancestor + update `layoutsRef`. If the active tab's
  // geometry changed (e.g. first measurement, or a viewport
  // resize), re-sync the bar via `slideTo`.
  //
  // RNW path: `offsetLeft` is parent-relative, matching the
  // absolute bar's coordinate space.
  // Native path: `View.measure(cb)` returns x/y relative to the
  // immediate parent (NOT pageX/pageY — using pageX would shift
  // the bar by the parent's screen-x, see 2026-05-13 hotfix).
  useIsoLayoutEffect(() => {
    let mounted = true;
    const measure = () => {
      if (!mounted) return;
      let activeChanged = false;
      for (const key of Object.keys(nodesRef.current)) {
        const node = nodesRef.current[key];
        if (!node) continue;
        if (typeof (node as HTMLElement).getBoundingClientRect === "function") {
          const x = (node as HTMLElement).offsetLeft;
          const w = (node as HTMLElement).getBoundingClientRect().width;
          const cur = layoutsRef.current[key];
          if (!cur || cur.x !== x || cur.w !== w) {
            layoutsRef.current[key] = { x, w };
            if (key === activeKey) activeChanged = true;
          }
        } else if (typeof (node as any).measure === "function") {
          (node as any).measure((x: number, _y: number, w: number) => {
            const cur = layoutsRef.current[key];
            if (cur && cur.x === x && cur.w === w) return;
            layoutsRef.current[key] = { x, w };
            if (key === activeKey) slideTo(activeKey);
          });
        }
      }
      // On web, the measure pass is sync — re-sync the active bar
      // once after the loop instead of inside it (cheaper, single
      // `withTiming` call).
      if (activeChanged) slideTo(activeKey);
    };
    measure();
    // Re-measure on viewport changes — handles orientation flips,
    // browser resizes, chrome-scroll animations.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onResize = () => measure();
      window.addEventListener("resize", onResize);
      return () => {
        mounted = false;
        window.removeEventListener("resize", onResize);
      };
    }
    return () => {
      mounted = false;
    };
  });

  // Also re-sync when activeKey changes from OUTSIDE the imperative
  // path — e.g. a URL param populating the initial tab, or a
  // sibling component setting state. Call sites that already invoke
  // `slideTo` synchronously will hit this as a no-op (the bar is
  // already at the right position).
  useEffect(() => {
    slideTo(activeKey);
  }, [activeKey, slideTo]);

  // Reanimated derives the rendered style from the shared values on
  // the UI thread; React only re-renders when this hook itself
  // re-runs (which is when activeKey changes, not on every animation
  // frame). The position-absolute + the shared values together
  // place the bar precisely inside the tab-row parent.
  const underlineStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: left.value,
    width: width.value,
    opacity: opacity.value,
  }));

  return { trackTab, underlineStyle, slideTo };
}
