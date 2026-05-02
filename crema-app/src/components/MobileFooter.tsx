/**
 * MobileFooter — sticky bottom nav that persists across every
 * mobile screen.
 *
 * Default tab set: Home / Discover / Messages / Profile.
 *
 * Lives at the root layout so it stays painted while the user
 * drills into detail screens (coffee, roaster, cafe, user, account,
 * search, notifications). Pathname drives the active state — no
 * reliance on Expo Router's Tabs mounted state, which disappears
 * the moment you navigate outside the `(tabs)` group.
 *
 * Taps on the tabs use `router.replace` so successive tab switches
 * don't accumulate a back stack. Drill-downs (e.g., tap a user on
 * the Discover feed) still push normally via `router.push` because
 * the underlying screens call `router.push` themselves.
 *
 * Per-screen tab sets (§2.40.7): `getTabsForPath(pathname, user)`
 * dispatches on the leading path segment so screens with a
 * different nav model can ship alongside the default one without
 * mounting their own footer. Café POS + roaster analytics are
 * scaffolded as examples — the actual screens haven't landed yet
 * (§2.39-adjacent), but the routes they'll use are reserved here
 * so their nav will "just work" when they arrive.
 *
 * Visual spec: Figma 66:6577 — 71px bar + iPhone home-indicator
 * inset, `nav.mobile.bar.bg`, `text.primary` active / `text.muted`
 * inactive, Inter Regular 10, -0.2 tracking, drop-shadow
 * 0/-4/20 @ 3%.
 */
import { View, Text, Pressable, StyleSheet, Platform, Animated } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Home, Compass, MessageCircle, User as UserIcon,
  QrCode, ClipboardList, Package, BarChart3, Settings, Users,
} from "lucide-react-native";

import { t, makeStyles } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { getChromeHiddenAnim, showChromeNow } from "../utils/chromeScroll";
import { emit } from "../utils/events";
import { tap as hapticTap, select as hapticSelect } from "../utils/haptics";
import { CroppedAvatar } from "./primitives";

interface TabDef {
  label: string;
  path: string;
  match: (p: string) => boolean;
  icon: (color: string) => React.ReactNode;
}

/** Default tab set — the 4 consumer tabs every signed-in user sees
 *  on the main surfaces. Profile icon flips to the user's avatar
 *  when one is set; otherwise the lucide UserIcon. */
function defaultTabs(user: any): TabDef[] {
  return [
    {
      label: "Home",
      path: "/",
      match: (p) => p === "/",
      icon: (color) => <Home size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Discover",
      path: "/browse",
      match: (p) => p === "/browse",
      icon: (color) => <Compass size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Messages",
      path: "/messages",
      match: (p) => p === "/messages",
      icon: (color) => <MessageCircle size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Profile",
      path: "/profile",
      match: (p) => p === "/profile",
      icon: (color) =>
        user?.avatar_url ? (
          <View
            style={{
              width: 26, height: 26, borderRadius: 13,
              borderWidth: 1.5, borderColor: color, overflow: "hidden",
            }}
          >
            <CroppedAvatar
              url={user.avatar_url}
              cropX={user.avatar_crop_x}
              cropY={user.avatar_crop_y}
              zoom={user.avatar_zoom}
              size={23}
            />
          </View>
        ) : (
          <UserIcon size={24} color={color} strokeWidth={2} />
        ),
    },
  ];
}

/** Café POS tab set — 5 tabs optimised for the counter workflow
 *  (Phase 2 §2.5 Café POS). Screens haven't landed yet; the paths
 *  below are reserved so when the POS feature ships it only has to
 *  mount under `/cafe-pos/*` to get this nav for free. */
function cafePosTabs(_user: any): TabDef[] {
  return [
    {
      label: "Scan",
      path: "/cafe-pos",
      match: (p) => p === "/cafe-pos",
      icon: (color) => <QrCode size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Orders",
      path: "/cafe-pos/orders",
      match: (p) => p === "/cafe-pos/orders",
      icon: (color) => <ClipboardList size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Stamps",
      path: "/cafe-pos/stamps",
      match: (p) => p === "/cafe-pos/stamps",
      icon: (color) => <Users size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Reports",
      path: "/cafe-pos/reports",
      match: (p) => p === "/cafe-pos/reports",
      icon: (color) => <BarChart3 size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Settings",
      path: "/cafe-pos/settings",
      match: (p) => p === "/cafe-pos/settings",
      icon: (color) => <Settings size={24} color={color} strokeWidth={2} />,
    },
  ];
}

/** Roaster analytics tab set — 5 tabs for the wholesale-first
 *  seller dashboard (Phase 1 §2.18 analytics + Phase 2 §2.15 orders).
 *  Same reservation model as cafePosTabs — when the screens ship
 *  under `/roaster-analytics/*` they inherit this footer. */
function roasterAnalyticsTabs(_user: any): TabDef[] {
  return [
    {
      label: "Overview",
      path: "/roaster-analytics",
      match: (p) => p === "/roaster-analytics",
      icon: (color) => <BarChart3 size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Orders",
      path: "/roaster-analytics/orders",
      match: (p) => p === "/roaster-analytics/orders",
      icon: (color) => <Package size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Leads",
      path: "/roaster-analytics/leads",
      match: (p) => p === "/roaster-analytics/leads",
      icon: (color) => <MessageCircle size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Audience",
      path: "/roaster-analytics/audience",
      match: (p) => p === "/roaster-analytics/audience",
      icon: (color) => <Users size={24} color={color} strokeWidth={2} />,
    },
    {
      label: "Settings",
      path: "/roaster-analytics/settings",
      match: (p) => p === "/roaster-analytics/settings",
      icon: (color) => <Settings size={24} color={color} strokeWidth={2} />,
    },
  ];
}

/** Dispatch the right tab set based on the current route. Adding a
 *  new per-screen nav is a single prefix guard here — no provider,
 *  no context, no emits. Pathname prefix is the contract. */
function getTabsForPath(pathname: string | null | undefined, user: any): TabDef[] {
  const p = pathname || "/";
  if (p === "/cafe-pos" || p.startsWith("/cafe-pos/")) return cafePosTabs(user);
  if (p === "/roaster-analytics" || p.startsWith("/roaster-analytics/")) return roasterAnalyticsTabs(user);
  return defaultTabs(user);
}

export default function MobileFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const s = useStyles();

  // Per-screen tab sets (§2.40.7): the dispatcher picks the right
  // TabDef[] based on the URL prefix so café POS + roaster analytics
  // screens can ship with their own 5-tab nav without mounting their
  // own footer.
  const tabs: TabDef[] = getTabsForPath(pathname, user);

  const hidden = getChromeHiddenAnim();
  const footerTotalH = 71 + insets.bottom;
  // Two-layer collapse: the OUTER wrapper clips everything so the
  // strip shrinks out of the flex column. Parallel opacity fade
  // masks the last 2–6 px of residue caused by iOS shadows + Android
  // elevation, which bypass the parent's overflow:hidden and would
  // otherwise leave a faint cream stripe at full-hide.
  const heightAnim = hidden.interpolate({
    inputRange: [0, 1],
    outputRange: [footerTotalH, 0],
  });
  // Fade hard in the last 20% of the collapse — stays crisp while
  // visible, then drops to 0 right as the height pinches shut.
  const opacityAnim = hidden.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [1, 1, 0],
  });

  return (
    <Animated.View
      style={{
        height: heightAnim,
        opacity: opacityAnim,
        overflow: "hidden",
      }}
    >
      <View
        style={[
          s.bar,
          {
            paddingBottom: insets.bottom + t.spacing.sm,
            height: footerTotalH,
          },
        ]}
      >
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const color = active ? t.color["text.primary"] : t.color["text.muted"];
          // X-style re-tap behaviour: tapping the active tab scrolls
          // its primary scroll surface to the top + reveals chrome.
          // Home → feed scroll-to-top. Discover / Messages / Profile
          // fall through to the same pattern; each screen can listen
          // for its own event. Inactive taps navigate.
          const onPress = () => {
            if (active) {
              hapticSelect();
              emit(`crema:rescroll-${tab.label.toLowerCase()}`);
              showChromeNow();
            } else {
              hapticTap();
              // NavigationLoader keys off pathname change to paint the
              // sitewide cream curtain + crema wordmark, but on bottom-
              // tab `router.replace` switches the destination tab can
              // commit its first paint before the loader's min-display
              // overlay actually renders — the curtain "doesn't show".
              // Emit the explicit start/end pair so the loader is up
              // for the full hold regardless of how fast the
              // destination tab hydrates.
              emit("crema:loading-start");
              router.replace(tab.path as any);
              setTimeout(() => emit("crema:loading-end"), 350);
            }
          };
          return (
            <Pressable
              key={tab.path}
              onPress={onPress}
              style={s.tab}
              hitSlop={4}
              accessibilityLabel={tab.label}
              accessibilityRole="button"
            >
              {tab.icon(color)}
              <Text style={[s.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  // Flex-sized bar at the bottom of the root layout's flex column —
  // reserves its own height so the Stack content above never gets
  // covered. Sticky behaviour comes from the parent `<View flex:1>`
  // wrapping it above the Stack.
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: (t.color as any)["nav.mobile.bar.bg"],
    paddingTop: t.spacing.md,
    // Drop-shadow from Figma 66:6577.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.03,
    shadowRadius: 20,
    elevation: 4,
  } as any,
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  label: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    letterSpacing: -0.2,
  },
}));
