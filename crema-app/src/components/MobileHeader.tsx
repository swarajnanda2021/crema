/**
 * MobileHeader — native + narrow-web top chrome.
 *
 * Matches Figma 63:4710 exactly:
 *   - 63 px navbar height (burnt brown `navbar.bg`, plus iPhone top
 *     safe inset painted in the same colour so the notch / Dynamic
 *     Island reads as an extension of the navbar).
 *   - Hamburger at x=32, a landscape 25×16 shape (3 stacked bars;
 *     wider than it is tall — lucide's square `Menu` icon reads too
 *     cramped).
 *   - Crema wordmark centered (131×27, large enough that the
 *     lowercase "a" bowls render cleanly at retina density).
 *   - Search glass + bell pinned to the right, icon centers at
 *     y=31.5 (navbar midpoint). x=337 for the glass per the design;
 *     the bell (notifications affordance, not shown in the static
 *     Figma but required for the app's notification feature) sits
 *     left of the glass.
 *
 * Icons TOGGLE slide-in panels hosted by the root-level
 * `MobileOverlays` component (§2.40.1-2). The panels sit between
 * this header and the `MobileFooter` so the Crema chrome stays
 * painted while a panel is open; re-tapping the icon closes.
 */
import { View, Pressable, StyleSheet, Animated, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, Bell } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../hooks/useNotifications";
import { emit } from "../utils/events";
import { getChromeHiddenAnim } from "../utils/chromeScroll";
import CremaLogo from "./CremaLogo";

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];

/** Landscape hamburger — 3 bars, 25 wide × 16 tall, matches
 *  Figma 63:4943 exactly. Built as plain Views instead of the
 *  lucide Menu icon because that glyph is square (24×24) and reads
 *  cramped on the navbar. */
function Hamburger({ color }: { color: string }) {
  return (
    <View style={hamburger.wrap}>
      <View style={[hamburger.bar, { backgroundColor: color }]} />
      <View style={[hamburger.bar, { backgroundColor: color }]} />
      <View style={[hamburger.bar, { backgroundColor: color }]} />
    </View>
  );
}

const hamburger = StyleSheet.create({
  wrap: { width: 25, height: 16, justifyContent: "space-between" },
  bar: { width: "100%" as any, height: 2, borderRadius: 1 } as any,
});

export default function MobileHeader() {
  const router = useRouter();
  const { user } = useAuth();
  const { unreadCount } = useNotifications(!!user);
  const insets = useSafeAreaInsets();
  const hidden = getChromeHiddenAnim();
  const fullHeight = MOBILE_HEADER_HEIGHT + insets.top;
  // Collapse only the NAVBAR portion (63 px) — the safe-area top
  // inset stays painted in navbar.bg so on notched iPhones the
  // Dynamic Island / camera cutout keeps its dark backdrop and
  // the page content below never rises into that zone. Before
  // this, the wrapper collapsed to 0 and the Browse sub-tab row
  // (BEANS / ROASTERS / CAFÉS) drifted up under the Island at
  // the instant chrome hid. The collapse still frees 63 px for
  // the feed — we just refuse to yield the status-bar strip.
  const heightAnim = hidden.interpolate({
    inputRange: [0, 1],
    outputRange: [fullHeight, insets.top],
  });

  return (
    <Animated.View
      {...({ dataSet: { role: "navbar" } } as any)}
      style={[s.animShell, { height: heightAnim, overflow: "hidden" }]}
    >
      <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.header}>
        {/* Left: hamburger — toggles the Account slide panel. */}
        <View style={s.flankLeft}>
          {user && (
            <Pressable
              onPress={() => emit("crema:toggle-account-panel")}
              hitSlop={10}
              accessibilityLabel="Account menu"
              accessibilityRole="button"
            >
              <Hamburger color={t.color["navbar.text"]} />
            </Pressable>
          )}
        </View>

        {/* Center: Crema wordmark (tap routes to the feed). */}
        <Pressable
          onPress={() => router.push("/")}
          style={s.logoArea}
          hitSlop={8}
          accessibilityLabel="Feed"
          accessibilityRole="button"
        >
          <CremaLogo width={131} height={27} />
        </Pressable>

        {/* Right: bell + search glass. Both TOGGLE slide-in panels;
           re-tapping closes the same panel. */}
        <View style={s.flankRight}>
          {user && (
            <Pressable
              onPress={() => emit("crema:toggle-notifications-panel")}
              style={s.iconBtn}
              hitSlop={10}
              accessibilityLabel="Notifications"
              accessibilityRole="button"
            >
              <Bell size={22} color={t.color["navbar.text"]} strokeWidth={1.5} />
              {unreadCount > 0 && <View style={s.badge} />}
            </Pressable>
          )}
          <Pressable
            onPress={() => emit("crema:toggle-search-panel")}
            style={s.iconBtn}
            hitSlop={10}
            accessibilityLabel="Search"
            accessibilityRole="button"
          >
            <Search size={24} color={t.color["navbar.text"]} strokeWidth={1.75} />
          </Pressable>
        </View>
      </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Animated wrapper. Height is driven by the scroll-aware hidden
  // animation; when collapsed, `overflow: hidden` clips the bar
  // underneath so nothing leaks out.
  animShell: { backgroundColor: t.color["navbar.bg"] } as any,
  safe: { backgroundColor: t.color["navbar.bg"] },
  header: {
    height: MOBILE_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing["3xl"], // 32 px (Figma x=32 edges)
    backgroundColor: t.color["navbar.bg"],
  },
  // Flanks are equal-width flex:1 so the logo stays optically
  // centered regardless of how many icons each side has.
  flankLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  flankRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: t.spacing.lg,
  },
  logoArea: {
    justifyContent: "center",
    alignItems: "center",
  },
  iconBtn: { position: "relative" } as any,
  // Minimal dot badge — the bell opens the Notifications panel
  // where the real counts live.
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,
});
