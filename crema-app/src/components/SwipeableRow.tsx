/**
 * SwipeableRow — wrap any row to expose Archive / Mute / Delete
 * (or any action set) behind the row content. (§2 migration)
 *
 * Native: horizontal swipe drags the row left, revealing action
 * buttons that sit behind. Release past the snap threshold (or on a
 * leftward flick) latches open; a rightward swipe / flick or tap on
 * the foreground closes it. Built on `react-native-gesture-handler`
 * + `react-native-reanimated` so drag tracking + release spring run
 * entirely on the UI thread — same migration that took SwipeToCommit
 * from "sticky" to "buttery".
 *
 * Web: right-click (contextmenu) and double-click both open a
 * compact floating menu anchored to the row. Outside-click dismiss.
 *
 * The wrapped child still receives taps normally — on native the
 * gesture only activates once horizontal travel clears ~12px, so
 * scroll-down never triggers a spurious open.
 */
import { useRef, useState, useEffect } from "react";
import {
  Pressable, StyleSheet, Platform, Text, View,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { t, makeStyles } from "../tokens/useTokens";

export interface SwipeAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Button background — defaults to `t.color["text.primary"]`. Use
   *  a destructive / warning colour for Delete etc. */
  background?: string;
  onPress: () => void;
}

interface Props {
  actions: SwipeAction[];
  children: React.ReactNode;
}

const ACTION_WIDTH = 72;
// Minimum horizontal travel for the swipe to claim the gesture away
// from the parent ScrollView. Matches the old PanResponder's 12px.
const CLAIM_X = 12;
// Maximum vertical drift before we defer to the ScrollView.
const FAIL_Y = 16;
// Open / close snap threshold in px.
const SNAP = 40;
// Flick velocity threshold (px/sec). PanResponder used 0.3 px/ms =
// 300 px/s; gesture-handler is in px/s directly. Slightly looser
// (400) gives the same perceived "flick enough to commit" feel.
const FLICK = 400;
const SPRING = { damping: 16, stiffness: 200, mass: 0.55 };

export default function SwipeableRow({ actions, children }: Props) {
  if (Platform.OS === "web") return <WebRow actions={actions}>{children}</WebRow>;
  return <NativeRow actions={actions}>{children}</NativeRow>;
}

function NativeRow({ actions, children }: Props) {
  const s = useStyles();
  const reveal = actions.length * ACTION_WIDTH;
  const tx = useSharedValue(0);
  // Gesture-start anchor — translationX is relative to gesture start,
  // so we store where the row was when the finger landed and add the
  // delta on every update. This is the worklet equivalent of the old
  // startXRef pattern and avoids `extractOffset` drift.
  const savedTx = useSharedValue(0);
  const isOpen = useSharedValue(false);

  const snapTo = (to: number) => {
    "worklet";
    isOpen.value = to !== 0;
    tx.value = withSpring(to, SPRING);
  };

  // JS-side close for Pressable onPress taps on an action. Setting a
  // shared value from JS is safe; the spring still runs on UI.
  const closeFromJS = () => {
    isOpen.value = false;
    tx.value = withSpring(0, SPRING);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-CLAIM_X, CLAIM_X])
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onBegin(() => {
      "worklet";
      savedTx.value = tx.value;
    })
    .onUpdate((e) => {
      "worklet";
      // Clamp to [-reveal, 0]: the row only travels left, never right
      // of the closed position.
      const next = Math.max(-reveal, Math.min(0, savedTx.value + e.translationX));
      tx.value = next;
    })
    .onEnd((e) => {
      "worklet";
      const final = savedTx.value + e.translationX;
      const leftFlick = e.velocityX < -FLICK;
      const rightFlick = e.velocityX > FLICK;
      if (isOpen.value) {
        // Already open: close on rightward movement past SNAP or a
        // rightward flick; otherwise stay latched open.
        if (final > -reveal + SNAP || rightFlick) snapTo(0);
        else snapTo(-reveal);
      } else {
        // Closed: snap open on any meaningful leftward movement.
        if (final < -SNAP || leftFlick) snapTo(-reveal);
        else snapTo(0);
      }
    })
    .onFinalize(() => {
      "worklet";
      // Safety net if the gesture is cancelled mid-drag (parent
      // claims the responder): snap back to the last committed state
      // so the row never ends up stranded in mid-swipe.
      const target = isOpen.value ? -reveal : 0;
      if (tx.value !== target) tx.value = withSpring(target, SPRING);
    });

  const fgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  return (
    <View style={s.wrap}>
      {/* Action layer — sits behind the row and is revealed by the
         swipe. Pressables here only receive taps when the foreground
         is slid left (they're physically uncovered). */}
      <View style={s.actionsLayer}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => { closeFromJS(); a.onPress(); }}
            style={[
              s.actionBtn,
              { width: ACTION_WIDTH, backgroundColor: a.background || t.color["text.primary"] },
            ]}
            accessibilityLabel={a.label}
            accessibilityRole="button"
          >
            {a.icon}
            <Text style={s.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Foreground row — what the user sees when closed. Drag gesture
         lives here so a tap on the row still works normally (gesture
         only activates past CLAIM_X). */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.fg, fgStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Web path — unchanged from the pre-migration version. Right-click
 *  / double-click opens a floating menu anchored at the cursor.
 *  Outside-click + Escape dismiss. Kept separate from the native row
 *  because the gesture-handler + reanimated pipeline doesn't carry
 *  its weight for a desktop menu. */
function WebRow({ actions, children }: Props) {
  const s = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<any>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: any) => {
      const menu = menuRef.current;
      if (menu && typeof menu.contains === "function" && menu.contains(e.target)) return;
      setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    if (typeof document !== "undefined") {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", esc);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", handler);
        document.removeEventListener("keydown", esc);
      }
    };
  }, [menuOpen]);

  const openMenuAt = (e: any) => {
    e?.preventDefault?.();
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    setMenuPos({ x, y });
    setMenuOpen(true);
  };

  const webHandlers: any = { onContextMenu: openMenuAt, onDoubleClick: openMenuAt };

  return (
    <View style={s.wrapWeb} {...webHandlers}>
      <View style={s.fg}>{children}</View>
      {menuOpen && menuPos && (
        <View ref={menuRef} style={[s.webMenu, { top: menuPos.y, left: menuPos.x }]}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => { setMenuOpen(false); a.onPress(); }}
              style={({ pressed }: any) => [s.webMenuItem, pressed && s.webMenuItemPressed]}
            >
              <View style={{ marginRight: t.spacing.sm }}>{a.icon}</View>
              <Text style={s.webMenuLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    position: "relative",
    overflow: "hidden",
  } as any,
  wrapWeb: {
    position: "relative",
    overflow: "visible",
  } as any,
  actionsLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
  } as any,
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing["2xs"],
    paddingHorizontal: t.spacing.sm,
  },
  actionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color.bg,
  },
  fg: {
    backgroundColor: t.color.bg,
  } as any,
  webMenu: {
    position: "fixed" as any,
    minWidth: 160,
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    paddingVertical: t.spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 9999,
  } as any,
  webMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  webMenuItemPressed: {
    backgroundColor: "rgba(215,152,218,0.08)",
  },
  webMenuLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
}));
