/**
 * MobileFooter — sticky bottom nav that persists across every
 * mobile screen and never animates away.
 *
 * Default tab set: Home / Discover / Messages / Search / Profile.
 *
 * Lives at the root layout so it stays painted while the user
 * drills into detail screens (coffee, roaster, cafe, user, account,
 * notifications). Pathname drives the active state — no reliance
 * on Expo Router's Tabs mounted state, which disappears the moment
 * you navigate outside the `(tabs)` group.
 *
 * Every tab is a peer member of the `(tabs)` group, so taps use
 * `router.replace` and the tab switch is instant — no slide-from-
 * side Stack-push transition. (Search lived briefly as a Stack
 * screen above the group during Figma 864:3304 wiring; it was
 * moved into `(tabs)/search.tsx` so it behaves like every other
 * footer tab.)
 *
 * Per-screen tab sets (§2.40.7): `getTabsForPath(pathname, user)`
 * dispatches on the leading path segment so screens with a
 * different nav model can ship alongside the default one without
 * mounting their own footer. Café POS + roaster analytics are
 * scaffolded as examples — the actual screens haven't landed yet
 * (§2.39-adjacent), but the routes they'll use are reserved here
 * so their nav will "just work" when they arrive.
 *
 * Scroll-aware behaviour: MobileFooter is intentionally NOT scroll-
 * aware. Only MobileHeader collapses on scroll-down (chromeScroll
 * `hidden` Animated.Value). The footer must remain pinned at all
 * times — users navigate via the footer, so it can't disappear.
 *
 * Visual spec: Figma 864:3304 — frame 71×389. The bar is exactly
 * 71 px tall and its bottom edge sits flush with the viewport
 * bottom: the Figma frame already accounts for the iPhone home-
 * indicator curvature zone (the bottom ~34 px of the 71 sit inside
 * iOS's safe-inset zone, painted in the same `nav.mobile.bar.bg`
 * so the chrome reads as one continuous strip down to the screen
 * edge). We deliberately do NOT add `insets.bottom` on top of the
 * 71 — that would push the bar above the safe-inset zone and
 * double-count.
 *
 * Labels-off variant: the original Figma frame had Inter-Regular
 * 10-pt labels below each icon; the user requested they be removed
 * after the geometry was correct. With labels gone, icons centre
 * vertically inside the 71-px bar (`alignItems: "center"`) so they
 * sit balanced rather than hanging at the top with a void below.
 * `accessibilityLabel` on each Pressable preserves the route name
 * for screen readers.
 *
 * 26-px icons, `text.primary` active / `text.muted` inactive,
 * drop-shadow 0/-4/20 @ 3%.
 */
import { View, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import {
  Compass, MessageCircle, Search, User as UserIcon,
  QrCode, ClipboardList, Package, BarChart3, Settings, Users,
} from "lucide-react-native";

import { t, makeStyles } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { showChromeNow } from "../utils/chromeScroll";
import { emit } from "../utils/events";
import { tap as hapticTap, select as hapticSelect } from "../utils/haptics";
import { CroppedAvatar } from "./primitives";

// Figma 864:3304 frame height. This is the TOTAL bar height
// measured from the viewport bottom edge — it already includes the
// iPhone home-indicator zone, no `+ insets.bottom` on top.
const FOOTER_BAR_HEIGHT = 71;

// Every footer icon renders inside a fixed-size box so the layout
// footprint is identical across tabs — matters because lucide
// glyphs have slightly different intrinsic heights at the same
// `size` prop (e.g. Compass's circle is ~22 of a 24-unit viewBox
// while Home's silhouette spans the full 24). The slot equalises
// the box; the lucide glyph or avatar sits centred inside.
const ICON_SLOT_SIZE = 26;

interface TabDef {
  label: string;
  path: string;
  match: (p: string) => boolean;
  icon: (color: string) => React.ReactNode;
}

/** Default tab set — the 5 consumer tabs every signed-in user sees
 *  on the main surfaces. Profile icon flips to the user's avatar
 *  when one is set; otherwise the lucide UserIcon. Search slots
 *  between Messages and Profile and is a peer (tabs)/ route, same
 *  as the others — switching to it is a tab change, not a Stack
 *  push, so there's no slide-in animation. */
function defaultTabs(user: any): TabDef[] {
  return [
    {
      label: "Discover",
      path: "/browse",
      match: (p) => p === "/browse",
      icon: (color) => <Compass size={26} color={color} strokeWidth={2} />,
    },
    {
      label: "Search",
      path: "/search",
      match: (p) => p === "/search",
      icon: (color) => <Search size={26} color={color} strokeWidth={2} />,
    },
    {
      label: "Profile",
      path: "/profile",
      match: (p) => p === "/profile",
      icon: (color) =>
        user?.avatar_url ? (
          <View
            style={{
              width: ICON_SLOT_SIZE, height: ICON_SLOT_SIZE, borderRadius: ICON_SLOT_SIZE / 2,
              borderWidth: 1.5, borderColor: color, overflow: "hidden",
            }}
          >
            <CroppedAvatar
              url={user.avatar_url}
              cropX={user.avatar_crop_x}
              cropY={user.avatar_crop_y}
              zoom={user.avatar_zoom}
              size={ICON_SLOT_SIZE - 3}
            />
          </View>
        ) : (
          <UserIcon size={26} color={color} strokeWidth={2} />
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
  const { user } = useAuth();
  const s = useStyles();

  // Per-screen tab sets (§2.40.7): the dispatcher picks the right
  // TabDef[] based on the URL prefix so café POS + roaster analytics
  // screens can ship with their own 5-tab nav without mounting their
  // own footer.
  const tabs: TabDef[] = getTabsForPath(pathname, user);

  // Bar height is exactly FOOTER_BAR_HEIGHT (71) — no safe-inset
  // addition. The bar's bottom edge sits at the viewport bottom and
  // its bg paints into the iPhone home-indicator zone naturally.
  // Icons anchor to the top of the 71 via alignItems:flex-start +
  // paddingTop, well clear of the home-indicator pill at the bottom.
  return (
    <View style={s.bar}>
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        const color = active ? t.color["text.primary"] : t.color["text.muted"];
        // X-style re-tap behaviour: tapping the active tab scrolls
        // its primary scroll surface to the top + reveals chrome.
        // Home → feed scroll-to-top. Discover / Messages / Search /
        // Profile fall through to the same pattern; each screen can
        // listen for its own event. Inactive taps navigate.
        //
        // ALWAYS dismiss any open sitewide modal first. When the
        // post viewer is open and the user taps Home (with home as
        // the active tab) we used to emit only `rescroll-home` —
        // the route stayed `/` and the modal stayed mounted above
        // the feed, so the tap looked like a no-op. Closing
        // modals first guarantees the user actually reaches the
        // tab destination they tapped (§2.40.24).
        const onPress = () => {
          emit("crema:dismiss-modals");
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
            testID={`tab-${tab.label.toLowerCase()}`}
            onPress={onPress}
            style={s.tab}
            hitSlop={4}
            accessibilityLabel={tab.label}
            accessibilityRole="button"
          >
            <View style={s.iconSlot}>
              {tab.icon(color)}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Sticky bar — sits at the bottom of the root layout's flex
  // column (native + web; web requires `html, body, #root { height:
  // 100% }` in `global.css` so the outer flex chain reaches the
  // viewport bottom). Total height is exactly FOOTER_BAR_HEIGHT
  // (71 px) — measured from the viewport bottom edge, not from the
  // top of the iPhone home-indicator safe-inset zone. The Figma
  // 864:3304 frame already accounts for that curvature.
  //
  // Labels-off variant: with the Figma's 10-pt labels removed, each
  // tab is just an icon — `alignItems: "center"` centres icons
  // vertically inside the 71-px bar so they sit balanced rather
  // than hanging at the top with a label-shaped void below. On
  // iPhones the icon's centre lands a few pixels above the safe-
  // inset zone, well clear of the home-indicator pill.
  //
  // `paddingHorizontal: t.spacing.md` (12 px each side, ~6% of a
  // 390-pt viewport) pulls the outermost tabs (Home + Profile)
  // toward the centred Messages tab — the user's "5% center-aligned
  // to the comment button" tweak. Closest ladder value to the
  // requested 5% (t.spacing.sm at 8 would be 4%; t.spacing.md at
  // 12 is the better visual match).
  bar: {
    height: FOOTER_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: t.spacing.md,
    backgroundColor: (t.color as any)["nav.mobile.bar.bg"],
    // Drop-shadow from Figma 864:3304.
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
  },
  // Fixed slot so every tab's icon footprint is identical regardless
  // of the lucide glyph's intrinsic dimensions or whether the
  // Profile tab is rendering an avatar (with border ring) or the
  // fallback UserIcon. Lucide icon at size:26 fills exactly; the
  // 26-px Profile avatar wrapper fills exactly.
  iconSlot: {
    width: ICON_SLOT_SIZE,
    height: ICON_SLOT_SIZE,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  } as any,
  // Pink unread badge — mirrors the discover filter-dot style
  // (8×8 accent disc anchored to the top-right of the icon slot).
  // Position is slightly off the icon's outer edge so it reads as a
  // badge on the icon rather than a dot inside it.
  unreadDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,
}));
