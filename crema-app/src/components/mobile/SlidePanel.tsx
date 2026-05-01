/**
 * SlidePanel — shared primitive for mobile slide-in overlays.
 *
 * The session 2 mobile chrome (§2.40.1-3, §2.34) wants a family of
 * panels that slide in from one edge and occupy the viewport band
 * **between** `SiteHeader` and `MobileFooter` so the Crema chrome
 * stays painted. Examples:
 *
 *   - Search   : right-slide, ~80% wide   (MobileHeader glass)
 *   - Notifications : right-slide, ~80% wide   (MobileHeader bell)
 *   - Hamburger : left-slide, ~75% wide    (MobileHeader menu)
 *   - FilterDrawer (§2.34) : right-slide, ~85% wide
 *   - Compose  : bottom-slide (future 2.40.3 reuse)
 *
 * Parent is expected to position this to cover only the desired
 * band — the panel fills its parent with `StyleSheet.absoluteFillObject`
 * and slides a child card in from the specified `side`. The sliver
 * left exposed is a translucent backdrop that dismisses on tap and
 * on Android hardware back.
 *
 * Animation reuses the site's `Animated.spring` easing from
 * `SwipeableRow` so every new motion on mobile reads in the same
 * language.
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated, Pressable, StyleSheet, Platform, BackHandler,
  useWindowDimensions, View,
} from "react-native";
import { t, makeStyles } from "../../tokens/useTokens";

interface Props {
  visible: boolean;
  onClose: () => void;
  side: "left" | "right" | "bottom";
  /** 0–100. Defaults: right=80, left=75, bottom=100. */
  widthPercent?: number;
  /** 0–100. Only used for side="bottom". Default 85. */
  heightPercent?: number;
  /**
   * When true (default), the exposed sliver is filled with the
   * dim/blur `overlay.panel` backdrop. Set false to keep the
   * underlying app fully visible while the panel is open — the
   * sliver is still tap-to-dismiss, just transparent.
   */
  dimBackdrop?: boolean;
  children: React.ReactNode;
}

export default function SlidePanel({
  visible, onClose, side,
  widthPercent, heightPercent, dimBackdrop = true, children,
}: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const defaultW = side === "right" ? 80 : side === "left" ? 75 : 100;
  const defaultH = 85;
  const wPct = widthPercent ?? defaultW;
  const hPct = heightPercent ?? defaultH;
  const styles = useStyles();

  // Panel dimensions (used only for the transform distance).
  // Parent container constrains the actual layout — we just translate
  // by enough to push it fully offscreen.
  const panelW = (wPct / 100) * screenW;
  const panelH = (hPct / 100) * screenH;

  // Animated progress: 0 = fully open, 1 = fully closed.
  const progress = useRef(new Animated.Value(visible ? 0 : 1)).current;
  // Keep the panel mounted while the exit animation plays, then unmount
  // so the View doesn't intercept events or paint offscreen.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(progress, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 16,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  // Android hardware back → close the top-most open panel.
  useEffect(() => {
    if (!visible || Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  const translateOffscreen =
    side === "right" ? panelW
    : side === "left" ? -panelW
    : /* bottom */ panelH;

  const translate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, translateOffscreen],
  });

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const transformStyle =
    side === "bottom" ? { transform: [{ translateY: translate }] }
    : { transform: [{ translateX: translate }] };

  const sideAnchor =
    side === "right" ? { right: 0, top: 0, bottom: 0, width: `${wPct}%` as any }
    : side === "left" ? { left: 0, top: 0, bottom: 0, width: `${wPct}%` as any }
    : { left: 0, right: 0, bottom: 0, height: `${hPct}%` as any };

  return (
    <View
      style={StyleSheet.absoluteFillObject}
      pointerEvents={visible ? "auto" : "none"}
    >
      {/* Backdrop fills the exposed sliver. Tap dismisses. The dim/
         blur fill is opt-out — set `dimBackdrop={false}` to keep
         the underlying app fully visible while the panel is open. */}
      <Animated.View
        style={[
          styles.backdropBase,
          dimBackdrop && styles.backdropDim,
          { opacity: backdropOpacity },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityLabel="Close panel"
          accessibilityRole="button"
        />
      </Animated.View>

      {/* Panel card itself. */}
      <Animated.View style={[styles.panel, sideAnchor, transformStyle]}>
        {children}
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  backdropBase: {
    ...StyleSheet.absoluteFillObject,
  } as any,
  backdropDim: {
    backgroundColor: t.color["overlay.panel"],
    ...(Platform.OS === "web"
      ? { backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }
      : {}),
  } as any,
  panel: {
    position: "absolute",
    backgroundColor: t.color.bg,
    overflow: "hidden",
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  } as any,
}));
