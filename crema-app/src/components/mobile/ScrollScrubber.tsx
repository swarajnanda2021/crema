/**
 * ScrollScrubber — X-style right-edge drag-to-jump scrubber for
 * mobile feeds. (§2.40.12)
 *
 * Pattern:
 *   const scrubberRef = useRef<ScrollScrubberHandle>(null);
 *   <ScrollView
 *     ref={scrollRef}
 *     onScroll={(e) => { scrubberRef.current?.onScroll(e); ... }}
 *     scrollEventThrottle={16}
 *   />
 *   <ScrollScrubber ref={scrubberRef} scrollRef={scrollRef} />
 *
 * Contract:
 *   - Fades in on the first real scroll, fades back out after ~900ms
 *     of no scroll events. Stays visible while the user drags.
 *   - Dragging the thumb calls `scrollTo` on the owner ref without
 *     animation so the feed tracks the finger exactly.
 *   - Thumb height scales with viewport/content ratio (native
 *     scrollbar convention), floored at MIN_THUMB_H so it's always
 *     grabbable.
 *   - Hidden entirely when the feed isn't deep enough to scroll —
 *     no point showing a scrubber on a list that already fits.
 *   - Native only; web returns null so desktop keeps the browser's
 *     native scrollbar. The imperative `onScroll` is a no-op on web
 *     so call-sites stay platform-agnostic.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";

import { t } from "../../tokens/useTokens";
import { select as hapticSelect, tap as hapticTap } from "../../utils/haptics";

export interface ScrollScrubberHandle {
  /** Feed this every ScrollView onScroll event. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

interface Props {
  scrollRef: React.RefObject<ScrollView | null>;
  /** Inset from the top of the parent container (default 72: below MobileHeader). */
  topInset?: number;
  /** Inset from the bottom of the parent container (default 100: above MobileFooter). */
  bottomInset?: number;
}

// Visual sizing.
const THUMB_W = 4;
const MIN_THUMB_H = 44;
const HIT_W = 32;
const TRACK_EDGE_INSET = 6;

// Behaviour.
const MIN_SCROLL_RANGE = 600;
const IDLE_FADE_MS = 900;
const MAX_OPACITY = 0.55;
const DRAG_OPACITY = 0.85;

const ScrollScrubber = forwardRef<ScrollScrubberHandle, Props>(function ScrollScrubber(
  { scrollRef, topInset = 72, bottomInset = 100 },
  ref,
) {
  const opacity = useRef(new Animated.Value(0)).current;
  const thumbY = useRef(new Animated.Value(0)).current;
  const [thumbHeight, setThumbHeight] = useState(MIN_THUMB_H);
  // `canGrab` gates pointerEvents so an invisible scrubber doesn't
  // steal the right 32px column of taps from the feed below.
  const [canGrab, setCanGrab] = useState(false);

  const geo = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    scrollY: 0,
    trackHeight: 0,
    thumbHeight: MIN_THUMB_H,
  });

  const dragging = useRef(false);
  const dragStartThumbY = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAnim = useRef<Animated.CompositeAnimation | null>(null);

  const stopAnim = () => { activeAnim.current?.stop(); activeAnim.current = null; };
  const clearIdleTimer = () => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
  };

  const fadeTo = (to: number, duration: number, onEnd?: (finished: boolean) => void) => {
    stopAnim();
    activeAnim.current = Animated.timing(opacity, { toValue: to, duration, useNativeDriver: true });
    activeAnim.current.start(({ finished }) => onEnd?.(finished));
  };

  const scheduleFadeOut = () => {
    clearIdleTimer();
    idleTimer.current = setTimeout(() => {
      if (dragging.current) return;
      fadeTo(0, 260, (finished) => { if (finished) setCanGrab(false); });
    }, IDLE_FADE_MS);
  };

  const computeThumbHeight = () => {
    const { contentHeight, viewportHeight, trackHeight } = geo.current;
    if (contentHeight <= 0 || trackHeight <= 0) return MIN_THUMB_H;
    const ratio = Math.max(0, Math.min(1, viewportHeight / contentHeight));
    return Math.max(MIN_THUMB_H, Math.round(trackHeight * ratio));
  };

  const maxThumbY = () => Math.max(0, geo.current.trackHeight - geo.current.thumbHeight);

  const thumbOffsetForScroll = (scrollY: number) => {
    const { contentHeight, viewportHeight } = geo.current;
    const scrollable = Math.max(1, contentHeight - viewportHeight);
    const p = Math.max(0, Math.min(1, scrollY / scrollable));
    return p * maxThumbY();
  };

  const scrollForThumbOffset = (yInTrack: number) => {
    const { contentHeight, viewportHeight } = geo.current;
    const scrollable = Math.max(1, contentHeight - viewportHeight);
    const range = maxThumbY();
    const p = range > 0 ? Math.max(0, Math.min(1, yInTrack / range)) : 0;
    return p * scrollable;
  };

  useImperativeHandle(ref, () => ({
    onScroll: (e) => {
      if (Platform.OS === "web") return;
      const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
      geo.current.contentHeight = contentSize.height;
      geo.current.viewportHeight = layoutMeasurement.height;
      geo.current.scrollY = contentOffset.y;

      const scrollable = contentSize.height - layoutMeasurement.height;
      if (scrollable <= MIN_SCROLL_RANGE) return;

      const h = computeThumbHeight();
      if (h !== geo.current.thumbHeight) {
        geo.current.thumbHeight = h;
        setThumbHeight(h);
      }
      if (!dragging.current) {
        thumbY.setValue(thumbOffsetForScroll(contentOffset.y));
      }
      stopAnim();
      opacity.setValue(MAX_OPACITY);
      setCanGrab(true);
      scheduleFadeOut();
    },
  }));

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture if the scrubber is visible — otherwise
      // taps in the right hit-slop column fall through to the feed.
      onStartShouldSetPanResponder: () => ((opacity as any)._value ?? 0) > 0.05,
      onMoveShouldSetPanResponder: () => ((opacity as any)._value ?? 0) > 0.05,
      onPanResponderGrant: () => {
        dragging.current = true;
        dragStartThumbY.current = (thumbY as any)._value ?? 0;
        hapticSelect();
        clearIdleTimer();
        fadeTo(DRAG_OPACITY, 80);
      },
      onPanResponderMove: (_, g) => {
        const target = Math.max(0, Math.min(maxThumbY(), dragStartThumbY.current + g.dy));
        thumbY.setValue(target);
        const scrollTarget = scrollForThumbOffset(target);
        scrollRef.current?.scrollTo({ y: scrollTarget, animated: false });
      },
      onPanResponderRelease: () => {
        dragging.current = false;
        hapticTap();
        fadeTo(MAX_OPACITY, 120);
        scheduleFadeOut();
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        scheduleFadeOut();
      },
    }),
  ).current;

  if (Platform.OS === "web") return null;

  return (
    <View
      pointerEvents="box-none"
      style={[s.container, { top: topInset, bottom: bottomInset }]}
    >
      <View
        style={s.track}
        pointerEvents="box-none"
        onLayout={(e) => {
          geo.current.trackHeight = e.nativeEvent.layout.height;
          if (!dragging.current) {
            thumbY.setValue(thumbOffsetForScroll(geo.current.scrollY));
          }
        }}
      >
        <Animated.View
          pointerEvents={canGrab ? "auto" : "none"}
          style={[
            s.thumbHit,
            { height: thumbHeight, transform: [{ translateY: thumbY }], opacity },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={[s.thumbVisual, { height: Math.max(MIN_THUMB_H - 8, thumbHeight - 8) }]} />
        </Animated.View>
      </View>
    </View>
  );
});

export default ScrollScrubber;

const s = StyleSheet.create({
  container: {
    position: "absolute",
    right: 0,
    width: HIT_W,
  } as any,
  track: {
    flex: 1,
    position: "relative",
  } as any,
  thumbHit: {
    position: "absolute",
    top: 0,
    right: 0,
    width: HIT_W,
    alignItems: "flex-end",
    justifyContent: "center",
  } as any,
  thumbVisual: {
    width: THUMB_W,
    borderRadius: THUMB_W / 2,
    backgroundColor: t.color["text.primary"],
    marginRight: TRACK_EDGE_INSET,
  } as any,
});
