/**
 * SwipeToCommit — feed-row gesture that commits an action on
 * horizontal swipe, then springs back to neutral.
 *
 * Different contract from SwipeableRow:
 *   SwipeableRow → latch OPEN and hold actions behind the row
 *   SwipeToCommit → commit on threshold and release; no latch
 *
 * Swipe-left  → reveals a heart disc at the right edge; crosses
 *               the threshold → onSwipeLike()     → row springs back.
 * Swipe-right → reveals a comment disc at the left edge; crosses
 *               the threshold → onSwipeComment()  → row springs back.
 *
 * Each disc fills with `accent` (Crema-pink) as the swipe
 * progresses (0 → 1 over [0, COMMIT_THRESHOLD]), so the user sees
 * a direct mapping between finger travel and commit readiness.
 *
 * Native only. On web the wrapper is a passthrough — the feed's
 * ActionBar stays visible on web rows.
 */
import { useRef } from "react";
import { Animated, PanResponder, View, StyleSheet, Platform } from "react-native";
import { t } from "../../tokens/useTokens";
import { HeartFilledOutlineIcon, CommentBubbleIcon } from "../icons/FigmaIcons";

interface Props {
  onSwipeLike?: () => void;
  onSwipeComment?: () => void;
  children: React.ReactNode;
}

// Finger travel to commit. Matches the visual "fully filled" point
// of the reveal disc — by the time the disc fills to `accent`, the
// user has crossed the commit line.
const COMMIT_THRESHOLD = 96;
// Hard cap on translateX so the row can't fly off-screen during a
// long flick; also keeps the reveal disc from drifting past centre.
const MAX_DRAG = 140;
const DISC_SIZE = 52;

export default function SwipeToCommit(props: Props) {
  if (Platform.OS === "web") return <>{props.children}</>;
  return <Native {...props} />;
}

function Native({ onSwipeLike, onSwipeComment, children }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;

  const spring = (to: number) =>
    Animated.spring(translateX, {
      toValue: to,
      useNativeDriver: true,
      bounciness: 4,
      speed: 18,
    });

  const panResponder = useRef(
    PanResponder.create({
      // Gesture arbitration mirrors SwipeableRow: horizontal travel
      // must clearly dominate vertical (3×) and clear a 12 px minimum
      // before we claim the touch from the parent ScrollView.
      onMoveShouldSetPanResponder: (_, g) => {
        const ax = Math.abs(g.dx);
        const ay = Math.abs(g.dy);
        return ax > 12 && ax > ay * 3;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        const ax = Math.abs(g.dx);
        const ay = Math.abs(g.dy);
        return ax > 16 && ax > ay * 3;
      },
      onPanResponderMove: (_, g) => {
        const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, g.dx));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, g) => {
        const dx = g.dx;
        if (dx < -COMMIT_THRESHOLD && onSwipeLike) {
          onSwipeLike();
        } else if (dx > COMMIT_THRESHOLD && onSwipeComment) {
          onSwipeComment();
        }
        spring(0).start();
      },
      onPanResponderTerminate: () => {
        spring(0).start();
      },
    }),
  ).current;

  // Progress 0 → 1 for each direction. The disc's fill opacity and
  // scale both read off the same interpolation so they move in
  // lockstep with finger travel.
  const heartProgress = translateX.interpolate({
    inputRange: [-COMMIT_THRESHOLD, -8, 0],
    outputRange: [1, 0, 0],
    extrapolate: "clamp",
  });
  const commentProgress = translateX.interpolate({
    inputRange: [0, 8, COMMIT_THRESHOLD],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });

  const heartScale = heartProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });
  const commentScale = commentProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  return (
    <View style={s.wrap}>
      {/* Reveal layer — sits behind the row. Left disc for comment
         (right-swipe), right disc for like (left-swipe). Neither
         disc receives touches; the pan layer above handles the
         gesture and the commit happens there. */}
      <View pointerEvents="none" style={s.revealLayer}>
        <Animated.View
          style={[
            s.disc,
            s.discLeft,
            { opacity: commentProgress, transform: [{ scale: commentScale }] },
          ]}
        >
          <CommentBubbleIcon size={24} color={t.color["text.on-dark"]} />
        </Animated.View>
        <Animated.View
          style={[
            s.disc,
            s.discRight,
            { opacity: heartProgress, transform: [{ scale: heartScale }] },
          ]}
        >
          <HeartFilledOutlineIcon size={24} color={t.color["text.on-dark"]} />
        </Animated.View>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
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
