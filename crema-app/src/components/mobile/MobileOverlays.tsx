/**
 * MobileOverlays — singleton host for the mobile slide-in panels.
 *
 * Lives at root layout, rendered only on `isMobile`. Sits absolute
 * between the top chrome (SiteHeader, ~48 + top safe inset) and the
 * bottom chrome (MobileFooter, ~71 + bottom safe inset) so when a
 * panel slides in, the Crema chrome stays painted and the user's
 * orientation is preserved.
 *
 * The two panels hosted here:
 *   - Notifications  (§2.40.1, right-slide) — MobileHeader bell
 *   - Account  (§2.40.2, left-slide)  — MobileHeader hamburger
 *
 * (Search used to be a third right-slide panel; it was retired in
 * favour of a full-page `app/search.tsx` Stack screen reached from
 * the MobileFooter's Search tab. The header dropped its search
 * glass at the same time so the only icons there are the
 * hamburger + bell.)
 *
 * Each is triggered by an `emit("crema:toggle-<panel>-panel")` call
 * (the MobileHeader icons emit). We maintain a single-open invariant:
 * opening any panel closes whichever was open. Route changes also
 * close the open panel so the user doesn't re-surface it after
 * drilling into a detail screen.
 *
 * Keeps the Stack screens `app/notifications.tsx`, `app/account.tsx`
 * intact for direct URL access / web fallback — MobileHeader just
 * prefers the panel path now.
 */
import { useEffect, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";

import { t } from "../../tokens/useTokens";
import { listen } from "../../utils/events";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import SlidePanel from "./SlidePanel";
import NotificationsDropdown from "../NotificationsDropdown";
import ProfileDropdown from "../ProfileDropdown";

type PanelKey = "notifications" | "account" | null;

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];

export default function MobileOverlays() {
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<PanelKey>(null);

  // Toggle events. Re-tapping the same icon closes. Tapping a
  // different icon switches atomically (single-panel invariant).
  useEffect(() => {
    const subs = [
      listen("crema:toggle-notifications-panel", () =>
        setOpen((prev) => (prev === "notifications" ? null : "notifications")),
      ),
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
      {/* Notifications — right-slide ~80%. Dropdown has its own
          "Notifications" header + Mark all read; we feed it onClose
          so the existing header can paint an X. */}
      <SlidePanel
        visible={open === "notifications"}
        onClose={close}
        side="right"
        widthPercent={80}
      >
        <NotificationsDropdown
          visible={open === "notifications"}
          onClose={close}
          onOpenThread={() => {
            close();
            router.push("/messages");
          }}
          fullScreen
        />
      </SlidePanel>

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
