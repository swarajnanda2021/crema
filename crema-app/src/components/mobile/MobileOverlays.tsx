/**
 * MobileOverlays — singleton host for the mobile slide-in panels.
 *
 * Lives at root layout, rendered only on `isMobile`. Sits absolute
 * between the top chrome (SiteHeader, ~48 + top safe inset) and the
 * bottom chrome (MobileFooter, ~71 + bottom safe inset) so when a
 * panel slides in, the Crema chrome stays painted and the user's
 * orientation is preserved.
 *
 * Currently hosts ONE panel:
 *   - Account  (§2.40.2, left-slide) — MobileHeader hamburger
 *
 * (Notifications used to be a right-slide panel here; retired
 * 2026-05-10 in favor of the full-page `app/notifications.tsx`
 * Stack route reached from the MobileHeader bell. Same reasoning
 * as the prior search-panel retirement — full screen real estate
 * + a back button reads as proper navigation, not an ephemeral
 * swipe-away. Search was retired earlier for the same reason
 * — `app/search.tsx` reached from the MobileFooter's Search tab.)
 *
 * Triggered by an `emit("crema:toggle-account-panel")` call from
 * the MobileHeader hamburger. Route changes auto-close the panel so
 * the user doesn't re-surface it after drilling into a detail
 * screen.
 */
import { useEffect, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";

import { t } from "../../tokens/useTokens";
import { listen } from "../../utils/events";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import SlidePanel from "./SlidePanel";
import ProfileDropdown from "../ProfileDropdown";

type PanelKey = "account" | null;

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];

export default function MobileOverlays() {
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [open, setOpen] = useState<PanelKey>(null);

  // Toggle event. Re-tapping the hamburger closes the panel. The
  // `crema:close-mobile-panels` broadcast lets any caller force-shut.
  useEffect(() => {
    const subs = [
      listen("crema:toggle-account-panel", () =>
        setOpen((prev) => (prev === "account" ? null : "account")),
      ),
      listen("crema:close-mobile-panels", () => setOpen(null)),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // Auto-close on route change so a panel left open on the home tab
  // doesn't linger when the user drills into, say, a product page.
  // Compare pathname via an effect so we catch every push.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  // Skip entirely on web wide — the Navbar dropdowns own this UX.
  // Skip on /auth so a freshly-signed-out user can't summon panels.
  if (!isMobile) return null;
  if (pathname?.startsWith("/auth")) return null;

  // Top offset: just below MobileHeader (SafeAreaView top inset +
  // 48px row). Bottom: 0 — the MobileFooter is rendered as a sibling
  // OUTSIDE the relative wrapper we live in, so the wrapper's own
  // bottom edge already sits flush against the top of the footer.
  const topOffset = insets.top + MOBILE_HEADER_HEIGHT;

  const close = () => setOpen(null);

  return (
    <View
      pointerEvents={open ? "auto" : "none"}
      style={[
        styles.host,
        { top: topOffset, bottom: 0 },
      ]}
    >
      {/* Account — left-slide ~75%. ProfileDropdown's own account-
          header row + divider stack takes the full width. */}
      <SlidePanel
        visible={open === "account"}
        onClose={close}
        side="left"
        widthPercent={75}
      >
        <ProfileDropdown
          visible={open === "account"}
          onClose={close}
          fullScreen
        />
      </SlidePanel>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    // top + bottom applied inline from safe-area insets
    ...(Platform.OS === "web" ? { zIndex: 50 } : {}),
  } as any,
});
