/**
 * Navbar — exact Figma specs from the design file.
 * Height: 72px, bg: #351101.
 * HOME at x=90, SHOP at x=213, logo centered at x=649.
 * Search icon at x=1262 (24px), User avatar at x=1326 (24px).
 * Active SHOP link: #D798DA (logo purple).
 *
 * Profile dropdown (Chrome-style) appears on avatar click for authenticated users.
 */
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { User, Search, Bell, MessageCircle } from "lucide-react-native";
import { t, NAVBAR_HEIGHT } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../hooks/useNotifications";
import { useInquiryInbox } from "../hooks/useInquiryInbox";
import { CroppedAvatar } from "./primitives";
import CremaLogo from "./CremaLogo";
import ProfileDropdown from "./ProfileDropdown";
import NotificationsDropdown from "./NotificationsDropdown";
import MessagesDropdown from "./MessagesDropdown";
import SearchDropdown from "./SearchDropdown";
import type { ThreadKind } from "./ThreadBody";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, backendAvailable } = useAuth();
  // §2.11 — sitewide search moved to a floating dropdown (same
  // language as messages / notifications). The navbar glass just
  // toggles visibility; all typing + results happen inside
  // SearchDropdown.
  const [searchOpen, setSearchOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  // Messages dropdown holds list + active thread in a single floating
  // panel. initialThread lets notification taps jump straight into
  // the right conversation without first showing the list.
  const [showMessages, setShowMessages] = useState(false);
  const [initialThread, setInitialThread] = useState<{ kind: ThreadKind; id: number } | null>(null);
  const { unreadCount } = useNotifications(!!user);
  // Every authenticated user has a Messages icon now — DMs are
  // available to regular user accounts too.
  const showMessagesIcon = !!user;
  const { totalUnread: messagesUnread } = useInquiryInbox(!!user);


  const isShop = pathname === "/browse";
  const isHome = pathname === "/";

  // Close every dropdown except the one named. Called from every
  // navbar-button onPress so clicking any icon/search always
  // dismisses whatever else was open. Keeps the three dropdowns
  // mutually exclusive without threading state through each toggler.
  const closeOthers = (keep?: "messages" | "notifications" | "profile" | "search") => {
    if (keep !== "messages") setShowMessages(false);
    if (keep !== "notifications") setShowNotifications(false);
    if (keep !== "profile") setShowDropdown(false);
    if (keep !== "search") setSearchOpen(false);
  };

  const openThreadFromNotification = (kind: ThreadKind, id: number) => {
    setInitialThread({ kind, id });
    closeOthers("messages");
    setShowMessages(true);
  };

  // Cross-component bridge. Anywhere on the site that wants to open a
  // conversation (profile Message button, future "Message roaster"
  // CTAs) can call window.__crema_openThread(kind, id). Keeps us from
  // threading a context or a hook through every tree level. Registered
  // on mount, cleared on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__crema_openThread = (kind: ThreadKind, id: number) => {
      setInitialThread({ kind, id });
      setShowMessages(true);
    };
    return () => { delete (window as any).__crema_openThread; };
  }, []);

  return (
    <>
      {/* data-role marker lets the dropdown outside-click handlers
         ignore clicks that land on the navbar itself (so icon toggle
         logic stays intact). */}
      <View {...({ dataSet: { role: "navbar" } } as any)} style={s.navbar}>
        {/* Left nav links — HOME at x=90, SHOP at x=213 */}
        <View style={s.leftLinks}>
          <Pressable onPress={() => router.push("/")} style={s.navLink}>
            <Text style={[s.navLinkText, isHome && s.navLinkTextActiveHome]}>HOME</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/browse")} style={s.navLink}>
            <Text style={[s.navLinkText, isShop && s.navLinkTextActiveShop]}>DISCOVER</Text>
          </Pressable>
        </View>

        {/* Center — Crema logo (141×29, centered) */}
        <Pressable onPress={() => router.push("/")} style={s.logoArea}>
          <CremaLogo width={141} height={29} />
        </Pressable>

        {/* Right side — search + user avatar */}
        <View style={s.rightSide}>
          <>
              <Pressable
                onPress={() => { closeOthers("search"); setSearchOpen((v) => !v); }}
                style={s.iconBtn}
              >
                <Search size={24} color="#E7D5B8" strokeWidth={1.5} />
              </Pressable>

              {/* Messages icon — every authenticated user now. DMs
                 are available to regular users as well as café +
                 roaster accounts. Clicking opens the inbox dropdown at
                 list view; the dropdown itself swaps to thread view on
                 row tap. */}
              {user && showMessagesIcon && (
                <Pressable
                  onPress={() => {
                    setInitialThread(null);
                    closeOthers("messages");
                    setShowMessages((v) => !v);
                  }}
                  style={s.iconBtn}
                >
                  <MessageCircle size={22} color="#E7D5B8" strokeWidth={1.5} />
                  {messagesUnread > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{messagesUnread > 9 ? "9+" : messagesUnread}</Text>
                    </View>
                  )}
                </Pressable>
              )}

              {/* Bell icon with unread badge */}
              {user && (
                <Pressable
                  onPress={() => {
                    closeOthers("notifications");
                    setShowNotifications((v) => !v);
                  }}
                  style={s.iconBtn}
                >
                  <Bell size={22} color="#E7D5B8" strokeWidth={1.5} />
                  {unreadCount > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
              )}

              {user ? (
                <Pressable
                  onPress={() => {
                    closeOthers("profile");
                    setShowDropdown((v) => !v);
                  }}
                  style={s.iconBtn}
                >
                  {user.avatar_url ? (
                    <View style={{ borderWidth: 1.5, borderColor: "#E7D5B8", borderRadius: 16, overflow: "hidden" }}>
                      <CroppedAvatar
                        url={user.avatar_url}
                        cropX={user.avatar_crop_x}
                        cropY={user.avatar_crop_y}
                        zoom={user.avatar_zoom}
                        size={28}
                      />
                    </View>
                  ) : (
                    <User size={24} color="#E7D5B8" strokeWidth={1.5} />
                  )}
                </Pressable>
              ) : backendAvailable ? (
                <Pressable onPress={() => router.push("/auth")} style={s.iconBtn}>
                  <User size={24} color="#E7D5B8" strokeWidth={1.5} />
                </Pressable>
              ) : null}
            </>
        </View>
      </View>

      {/* §2.11 — sitewide search dropdown. */}
      <SearchDropdown
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

      {/* Notifications dropdown. Tapping a thread-related notification
         opens the Messages dropdown directly at the right thread. */}
      <NotificationsDropdown
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        onOpenThread={openThreadFromNotification}
      />

      {/* Messages dropdown — compact floating panel that holds both
         the list and the active thread in master-detail. Non-blocking:
         no full-viewport backdrop, so the rest of the site stays
         scrollable + clickable. */}
      <MessagesDropdown
        visible={showMessages}
        onClose={() => setShowMessages(false)}
        initialThread={initialThread}
      />

      {/* Profile dropdown — rendered OUTSIDE the navbar View to avoid RNW overflow clip */}
      <ProfileDropdown
        visible={showDropdown}
        onClose={() => setShowDropdown(false)}
      />

    </>
  );
}

const s = StyleSheet.create({
  // Figma: 1440×72, bg #351101
  navbar: {
    height: NAVBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: "6.25%" as any,   // Figma: 90/1440 = 6.25%
    paddingRight: "6.25%" as any,  // scales with viewport
    backgroundColor: "#351101",
  },
  leftLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: 80,  // Figma: HOME(90)→SHOP(213), gap = 213-90-43 = 80
    flex: 1,
  },
  navLink: {},
  // Figma: Inter Semi Bold 14px, uppercase
  navLinkText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    color: "#E7D5B8",
    textTransform: "uppercase",
  } as any,
  // HOME active: stays white/cream
  navLinkTextActiveHome: {
    color: "#FFFFFF",
  },
  // SHOP active: highlighted in logo purple #D798DA
  navLinkTextActiveShop: {
    color: "#D798DA",
  },
  logoArea: {
    position: "absolute",
    left: "50%",
    marginLeft: -70.5,  // half of 141px logo width
    alignItems: "center",
    justifyContent: "center",
  } as any,
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 40,  // Figma: search(1262)→user(1326) = 64px center-to-center, minus 24px icon = 40px gap
    flex: 1,
  },
  // Figma: 24×24 icons
  iconBtn: { position: "relative" } as any,
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    backgroundColor: "#D798DA",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  } as any,
  badgeText: { fontFamily: t.font["body.semibold"], fontSize: 9, color: "#351101" },
  // searchContainer / searchInput styles removed — the sitewide
  // search moved to a floating dropdown (see SearchDropdown).
});
