/**
 * MobileFooter — sticky bottom nav that persists across every
 * mobile screen (Home / Discover / Messages / Profile).
 *
 * Lives at the root layout so it stays painted while the user
 * drills into detail screens (coffee, roaster, cafe, user, account,
 * search, notifications). Pathname drives the active state — no
 * reliance on Expo Router's Tabs mounted state, which disappears
 * the moment you navigate outside the `(tabs)` group.
 *
 * Taps on the four tabs use `router.replace` so successive tab
 * switches don't accumulate a back stack. Drill-downs (e.g., tap a
 * user on the Discover feed) still push normally via `router.push`
 * because the underlying screens call `router.push` themselves.
 *
 * Visual spec: Figma 66:6577 — 71px bar + iPhone home-indicator
 * inset, `nav.mobile.bar.bg`, `text.primary` active / `text.muted`
 * inactive, Inter Regular 10, -0.2 tracking, drop-shadow
 * 0/-4/20 @ 3%.
 */
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Compass, MessageCircle, User as UserIcon } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { CroppedAvatar } from "./primitives";

interface TabDef {
  label: string;
  path: string;
  match: (p: string) => boolean;
  icon: (color: string) => React.ReactNode;
}

export default function MobileFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // `/` is Home, `/browse` is Discover, `/messages` is Messages,
  // `/profile` is Profile. Anything outside these is a drill-down
  // (coffee, user, cafe, roaster, search, notifications, account,
  // auth) — we render the bar but no tab is active.
  const tabs: TabDef[] = [
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
              width: 26,
              height: 26,
              borderRadius: 13,
              borderWidth: 1.5,
              borderColor: color,
              overflow: "hidden",
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

  return (
    <View
      style={[
        s.bar,
        {
          paddingBottom: insets.bottom + t.spacing.sm,
          height: 71 + insets.bottom,
        },
      ]}
    >
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        const color = active ? t.color["text.primary"] : t.color["text.muted"];
        return (
          <Pressable
            key={tab.path}
            onPress={() => router.replace(tab.path as any)}
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
  );
}

const s = StyleSheet.create({
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
});
