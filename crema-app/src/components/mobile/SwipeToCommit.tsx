/**
 * SwipeToCommit — feed-row gesture that commits an action on
 * horizontal swipe, then springs back to neutral. (§2.40.11 + §2)
 *
 * Different contract from SwipeableRow:
 *   SwipeableRow → latch OPEN and hold actions behind the row
 *   SwipeToCommit → commit on threshold and release; no latch
 *
 * Swipe-left  → reveals a heart disc at the right edge; crosses
 *               the threshold → onSwipeLike()     → disc pulses,
 *               row springs back.
 * Swipe-right → reveals a comment disc at the left edge; crosses
 *               the threshold → onSwipeComment()  → disc pulses,
 *               row springs back.
 *
 * Each disc fills with `accent` (Crema-pink) as the swipe
 * progresses (0 → 1 over [0, COMMIT_THRESHOLD]). At commit the
 * disc does a 1 → 1.4 → 1 burst that stays visible through the
 * row's return spring so the user sees the action land — the
 * ActionBar is hidden on mobile feed rows, so this burst is the
 * *only* visual confirmation.
 *
 * Implementation: `react-native-gesture-handler` (`Gesture.Pan`) +
 * `react-native-reanimated` (shared values + animated styles). The
 * drag, the disc interpolations, the burst, and the release spring
 * all run on the UI thread — no JS-bridge round-trip per frame, so
 * the row tracks the finger at 60+ fps even when JS is busy.
 * Haptics + commit callbacks hop back to JS via `runOnJS`.
 *
 * Native only. On web the wrapper is a passthrough — the feed's
 * ActionBar stays visible on web rows.
 */
import { Platform, StyleSheet, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from "react-native-reanimated";

import { t } from "../../tokens/useTokens";
import { HeartFilledOutlineIcon, CommentBubbleIcon } from "../icons/FigmaIcons";
import { commit as hapticCommit, select as hapticSelect } from "../../utils/haptics";

interface Props {
  onSwipeLike?: () => void;
  onSwipeComment?: () => void;
  children: React.ReactNode;
}

// Finger travel to commit — matches the disc's "fully filled" point,
// so the commit line is exactly where the visual reaches accent-full.
const COMMIT_THRESHOLD = 96;
// Hard cap on translateX. Long flicks don't fly the row off-screen,
// and the reveal disc doesn't drift past centre.
const MAX_DRAG = 140;
const DISC_SIZE = 52;
const BURST_PEAK = 1.4;
const BURST_MS = 420;

export default function SwipeToCommit(props: Props) {
  if (Platform.OS === "web") return <>{props.children}</>;
  return <Native {...props} />;
}

function Native({ onSwipeLike, onSwipeComment, children }: Props) {
  const tx = useSharedValue(0);
  // Tracks the last threshold-crossing sign (-1 = past like, 1 = past
  // comment, 0 = neutral). When this changes while dragging we fire a
  // single selection tick via runOnJS — one tick per crossing, not per
  // frame while past the line.
  const thresholdSign = useSharedValue(0);
  // Burst values drive the post-commit "pulse" on each disc. 0 when
  // dormant, ramps 1 → 0 over BURST_MS on commit so the disc stays
  // visible + scales up briefly even after the row springs back.
  const likeBurst = useSharedValue(0);
  const commentBurst = useSharedValue(0);

  const fireLike = () => onSwipeLike?.();
  const fireComment = () => onSwipeComment?.();

  const pan = Gesture.Pan()
    // Claim the gesture once the finger clears ~10px horizontally; if
    // vertical travel crosses 12px first, give up so the parent
    // ScrollView keeps the touch. Mirrors the old PanResponder
    // arbitration numbers so the feel at the edge cases is the same.
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      "worklet";
      const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, e.translationX));
      tx.value = clamped;

      const sign =
        clamped <= -COMMIT_THRESHOLD ? -1 :
        clamped >= COMMIT_THRESHOLD ? 1 : 0;
      if (sign !== thresholdSign.value) {
        thresholdSign.value = sign;
        if (sign !== 0) runOnJS(hapticSelect)();
      }
    })
    .onEnd((e) => {
      "worklet";
      const dx = e.translationX;
      if (dx < -COMMIT_THRESHOLD) {
        runOnJS(hapticCommit)();
        runOnJS(fireLike)();
        // Burst: snap to peak then ease back to 0. Disc opacity /
        // scale read max(drag, burst), so it stays painted while the
        // row springs back.
        likeBurst.value = 1;
        likeBurst.value = withTiming(0, { duration: BURST_MS, easing: Easing.out(Easing.cubic) });
      } else if (dx > COMMIT_THRESHOLD) {
        runOnJS(hapticCommit)();
        runOnJS(fireComment)();
        commentBurst.value = 1;
        commentBurst.value = withTiming(0, { duration: BURST_MS, easing: Easing.out(Easing.cubic) });
      }
      tx.value = withSpring(0, { damping: 14, stiffness: 180, mass: 0.55 });
      thresholdSign.value = 0;
    })
    .onFinalize(() => {
      "worklet";
      // Ensure we always return to neutral even if the gesture is
      // cancelled mid-drag (e.g. parent claims the responder). Cheap
      // no-op if already settled.
      if (tx.value !== 0) {
        tx.value = withSpring(0, { damping: 14, stiffness: 180, mass: 0.55 });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  const heartStyle = useAnimatedStyle(() => {
    const dragP = interpolate(
      tx.value,
      [-COMMIT_THRESHOLD, -8, 0],
      [1, 0, 0],
      Extrapolation.CLAMP,
    );
    const burst = likeBurst.value;
    const opacity = Math.max(dragP, burst);
    // Scale blends drag-growth (0.55 → 1) with burst-pulse (1 → 1.4 → 1).
    const dragScale = 0.55 + dragP * 0.45;
    const burstScale = 1 + burst * (BURST_PEAK - 1);
    const scale = Math.max(dragScale, burstScale);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const commentStyle = useAnimatedStyle(() => {
    const dragP = interpolate(
      tx.value,
      [0, 8, COMMIT_THRESHOLD],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    const burst = commentBurst.value;
    const opacity = Math.max(dragP, burst);
    const dragScale = 0.55 + dragP * 0.45;
    const burstScale = 1 + burst * (BURST_PEAK - 1);
    const scale = Math.max(dragScale, burstScale);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <View style={s.wrap}>
      {/* Reveal layer — sits behind the row. Left disc for comment
         (right-swipe), right disc for like (left-swipe). Neither
         disc receives touches; the pan layer above handles the
         gesture and the commit happens there. */}
      <View pointerEvents="none" style={s.revealLayer}>
        <Animated.View style={[s.disc, s.discLeft, commentStyle]}>
          <CommentBubbleIcon size={24} color={t.color["text.on-dark"]} />
        </Animated.View>
        <Animated.View style={[s.disc, s.discRight, heartStyle]}>
          <HeartFilledOutlineIcon size={24} color={t.color["text.on-dark"]} />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "relative", backgroundColor: t.color.bg } as any,
  revealLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  } as any,
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color.accent,
  } as any,
  discLeft: {},
  discRight: {},
});
