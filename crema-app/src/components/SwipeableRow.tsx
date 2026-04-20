/**
 * SwipeableRow — wrap any row to expose Archive / Mute / Delete
 * (or any action set) behind the row content.
 *
 * Mobile: horizontal PanResponder drags the row left, revealing the
 * action buttons that sit behind. Release past the half-way point
 * latches open; release before it springs closed.
 *
 * Web: right-click (contextmenu) and double-click both open a
 * compact floating menu anchored to the row. Outside-click dismiss.
 *
 * The wrapped child still receives taps normally — swipe only
 * engages when the horizontal delta exceeds a small threshold.
 */
import { useRef, useState, useEffect } from "react";
import {
  Animated, PanResponder, View, Pressable, StyleSheet, Platform, Text,
} from "react-native";
import { t } from "../tokens/useTokens";

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

export default function SwipeableRow({ actions, children }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  // Drag-start anchor in absolute coords — survives between gesture
  // callbacks so onMove can compute totalX = startX + g.dx without
  // any extractOffset bookkeeping (which was drifting).
  const startXRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<any>(null);
  const menuRef = useRef<any>(null);
  const reveal = actions.length * ACTION_WIDTH;

  const animateTo = (to: number) => {
    openRef.current = to !== 0;
    Animated.spring(translateX, {
      toValue: to,
      useNativeDriver: true,
      bounciness: 4,
      speed: 16,
    }).start();
  };

  // WhatsApp-style swipe: a small leftward gesture is enough to
  // snap the row open (≥ 40px moved left OR a leftward flick). Once
  // open it stays open until the user swipes right past a symmetric
  // threshold or taps an action.
  //
  // Gesture arbitration vs. the parent ScrollView: we only claim
  // the gesture when horizontal travel clearly dominates vertical
  // (3×) and has cleared a 12px minimum. Below that we return
  // false and the ScrollView keeps the touch, so a casual scroll
  // never accidentally opens a row. Once we've claimed, the row
  // is locked — vertical nudges during the same gesture stick with
  // the swipe (ScrollView can't reclaim), which matches the user's
  // mental model: "arm the swipe first, scroll-down after release".
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        const ax = Math.abs(g.dx);
        const ay = Math.abs(g.dy);
        return ax > 12 && ax > ay * 3;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        // Only capture (intercept from ScrollView) once the swipe
        // is clearly horizontal AND has real momentum — otherwise
        // let the outer scroll handle the touch.
        const ax = Math.abs(g.dx);
        const ay = Math.abs(g.dy);
        return ax > 16 && ax > ay * 3;
      },
      onPanResponderGrant: () => {
        startXRef.current = openRef.current ? -reveal : 0;
      },
      onPanResponderMove: (_, g) => {
        const next = Math.max(-reveal, Math.min(0, startXRef.current + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const final = startXRef.current + g.dx;
        const SNAP = 40; // forgiving open / close threshold
        const leftFlick = g.vx < -0.3;
        const rightFlick = g.vx > 0.3;
        if (openRef.current) {
          // Already open: close if swiped right past the threshold or
          // flicked right; otherwise stay latched open.
          if (final > -reveal + SNAP || rightFlick) animateTo(0);
          else animateTo(-reveal);
        } else {
          // Closed: snap open on any meaningful leftward movement.
          if (final < -SNAP || leftFlick) animateTo(-reveal);
          else animateTo(0);
        }
      },
      onPanResponderTerminate: () => {
        animateTo(openRef.current ? -reveal : 0);
      },
    }),
  ).current;

  // Web: outside-click + Escape to dismiss the context menu.
  useEffect(() => {
    if (!menuOpen || Platform.OS !== "web") return;
    const handler = (e: any) => {
      const menu = menuRef.current;
      if (menu && typeof menu.contains === "function" && menu.contains(e.target)) return;
      setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    if (typeof document !== "undefined") {
      // `mousedown` fires before click, so clicking an action inside
      // the menu doesn't race with this outside-click handler.
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
    // Anchor the menu at the cursor on right-click; fallback to the
    // double-click coordinates on desktop.
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    setMenuPos({ x, y });
    setMenuOpen(true);
  };

  const webHandlers: any = Platform.OS === "web"
    ? { onContextMenu: openMenuAt, onDoubleClick: openMenuAt }
    : {};

  return (
    <View ref={rootRef} style={s.wrap} {...webHandlers}>
      {/* Action layer — sits behind the row and is revealed by the
         native swipe. Skipped on web since the context menu handles
         the same actions there (and would otherwise force
         `overflow:hidden` that clips the menu). */}
      {Platform.OS !== "web" && (
        <View style={s.actionsLayer}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => { animateTo(0); a.onPress(); }}
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
      )}

      {/* Foreground row — what the user sees when closed. */}
      <Animated.View
        style={[s.fg, { transform: [{ translateX }] }]}
        {...(Platform.OS !== "web" ? panResponder.panHandlers : {})}
      >
        {children}
      </Animated.View>

      {/* Web-only context menu, anchored to the cursor via
         `position: fixed` so it can escape clipping ancestors (e.g.
         the Messages ScrollView's overflow boundary). */}
      {menuOpen && menuPos && Platform.OS === "web" && (
        <View
          ref={menuRef}
          style={[s.webMenu, { top: menuPos.y, left: menuPos.x }]}
        >
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

const s = StyleSheet.create({
  wrap: {
    position: "relative",
    // Native: clip the action layer when the row is at rest.
    // Web: visible so the context menu can overflow the row bounds.
    overflow: Platform.OS === "web" ? "visible" : "hidden",
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
  // Position: fixed so the menu can float above clipping ancestors
  // (ScrollView, card, etc.). Anchored to cursor via inline `top` /
  // `left`.
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
});
