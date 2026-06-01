/**
 * MobileHeader — native + narrow-web top chrome.
 *
 * Matches Figma 63:4710 with one structural revision: the search
 * glass that sat on the right has moved to MobileFooter (right
 * before Profile) so the header reads as exactly two flanking
 * controls around the centered logo.
 *
 *   - 63 px navbar height (burnt brown `navbar.bg`, plus iPhone top
 *     safe inset painted in the same colour so the notch / Dynamic
 *     Island reads as an extension of the navbar).
 *   - Hamburger at x=32, a landscape 25×16 shape (3 stacked bars;
 *     wider than it is tall — lucide's square `Menu` icon reads too
 *     cramped).
 *   - Crema wordmark centered (131×27, large enough that the
 *     lowercase "a" bowls render cleanly at retina density).
 *   - Bell on the right (notifications affordance), centered at
 *     y=31.5 (navbar midpoint).
 *
 * The hamburger and bell still TOGGLE slide-in panels hosted by the
 * root-level `MobileOverlays` component (§2.40.1-2). Search is now
 * a full Stack screen (`app/search.tsx`) reached from the footer's
 * Search tab — the slide-panel variant has been retired.
 */
import { View, Pressable, StyleSheet, Animated, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { t, makeStyles } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
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
  const insets = useSafeAreaInsets();
  const hidden = getChromeHiddenAnim();
  const s = useStyles();
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
        {/* Left: hamburger — toggles the Account slide panel. Also
           emits `crema:dismiss-modals` first so any open post viewer
           / compose / popularity / auth modal closes BEFORE the
           panel slides in. Without this, tapping the hamburger while
           the post viewer is open layered the panel above the modal
           but the modal stayed underneath; the user read the chrome
           as broken (§2.40.24). */}
        <View style={s.flankLeft}>
          {user && (
            <Pressable
              onPress={() => {
                emit("crema:dismiss-modals");
                emit("crema:toggle-account-panel");
              }}
              hitSlop={10}
              accessibilityLabel="Account menu"
              accessibilityRole="button"
            >
              <Hamburger color={t.color["navbar.text"]} />
            </Pressable>
          )}
        </View>

        {/* Center: Crema wordmark → catalog landing. Dismisses any
           open modal first so the user lands clean. */}
        <Pressable
          onPress={() => {
            emit("crema:dismiss-modals");
            router.push("/browse");
          }}
          style={s.logoArea}
          hitSlop={8}
          accessibilityLabel="Catalog"
          accessibilityRole="button"
        >
          <CremaLogo width={131} height={27} />
        </Pressable>

        {/* Right: empty spacer — keeps the logo optically centered
           against the left hamburger. The bell / notifications
           affordance was removed with the feed. */}
        <View style={s.flankRight} />
      </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
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
}));
