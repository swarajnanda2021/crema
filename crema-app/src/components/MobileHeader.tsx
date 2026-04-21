/**
 * MobileHeader — native + narrow-web top chrome (per Figma 63:4710).
 *
 * Layout: Crema wordmark centered (tappable, routes to feed), with
 * search + bell icons on the right, hamburger on the left. No Stack
 * back button — each icon TOGGLES a slide-in panel hosted by the
 * root-level `MobileOverlays` component (§2.40.1-2). The panels sit
 * between this header and the `MobileFooter` so the Crema chrome
 * stays painted while a panel is open — re-tapping the icon closes
 * the same panel.
 *
 * The SafeAreaView paints the burnt-brown bg through the iPhone
 * notch / Dynamic Island and pushes the 48px row below the top
 * inset. Web (insets.top = 0) just renders the 48px row.
 */
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, Bell, Menu } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../hooks/useNotifications";
import { emit } from "../utils/events";
import CremaLogo from "./CremaLogo";

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];

export default function MobileHeader() {
  const router = useRouter();
  const { user } = useAuth();
  const { unreadCount } = useNotifications(!!user);

  return (
    <SafeAreaView
      edges={["top"]}
      {...({ dataSet: { role: "navbar" } } as any)}
      style={s.safe}
    >
      <View style={s.header}>
        {/* Left side — hamburger toggles the left-slide Account panel
           (profile switcher, edit, sign out). Equal-width to the right
           flank so the logo sits optically centered. */}
        <View style={[s.side, s.sideLeft]}>
          {user && (
            <Pressable
              onPress={() => emit("crema:toggle-account-panel")}
              style={s.iconBtn}
              hitSlop={10}
              accessibilityLabel="Account menu"
              accessibilityRole="button"
            >
              <Menu size={24} color={t.color["navbar.text"]} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>

        {/* Centered Crema wordmark. Taps route to the feed so the
           logo doubles as a "home" affordance, matching the web
           navbar's centered-logo behaviour. */}
        <Pressable
          onPress={() => router.push("/")}
          style={s.logoArea}
          hitSlop={8}
          accessibilityLabel="Feed"
          accessibilityRole="button"
        >
          <CremaLogo width={105} height={21.6} />
        </Pressable>

        {/* Right side — search + bell. Both TOGGLE slide-in panels
           hosted by MobileOverlays; re-tapping closes the same panel. */}
        <View style={s.side}>
          <Pressable
            onPress={() => emit("crema:toggle-search-panel")}
            style={s.iconBtn}
            hitSlop={10}
            accessibilityLabel="Search"
            accessibilityRole="button"
          >
            <Search size={22} color={t.color["navbar.text"]} strokeWidth={1.5} />
          </Pressable>

          {user && (
            <Pressable
              onPress={() => emit("crema:toggle-notifications-panel")}
              style={s.iconBtn}
              hitSlop={10}
              accessibilityLabel="Notifications"
              accessibilityRole="button"
            >
              <Bell size={22} color={t.color["navbar.text"]} strokeWidth={1.5} />
              {unreadCount > 0 && (
                <View style={s.badge}>
                  <View />
                </View>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { backgroundColor: t.color["navbar.bg"] },
  header: {
    height: MOBILE_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    backgroundColor: t.color["navbar.bg"],
  },
  // Equal-width flanks keep the logo optically centered even when
  // the two sides have different numbers of icons.
  side: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: t.spacing.xl,
  },
  sideLeft: { justifyContent: "flex-start" },
  logoArea: {
    justifyContent: "center",
    alignItems: "center",
  },
  iconBtn: { position: "relative" } as any,
  // Minimal dot badge — the header icon pushes to a full /notifications
  // screen where the real counts live, so a simple unread indicator is
  // enough up here (vs. the web navbar's numeric badge).
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
