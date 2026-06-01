/**
 * Navbar — wide (tablet+) top chrome for the catalog-only build.
 * Height 72px, bg Espresso. Logo centered → catalog landing.
 * Right side: sitewide search + profile/auth.
 *
 * The HOME / DISCOVER nav tabs were removed with the social feed —
 * the catalog (Discover) is now the landing, reached via the logo, so
 * a header tab row is redundant. The messages icon, notifications
 * bell, and DM bridge were removed too. Full social chrome preserved
 * at git tag `social-v1`.
 */
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { User, Search } from "lucide-react-native";
import { t, NAVBAR_HEIGHT } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { CroppedAvatar } from "./primitives";
import CremaLogo from "./CremaLogo";
import ProfileDropdown from "./ProfileDropdown";
import SearchDropdown from "./SearchDropdown";

export default function Navbar() {
  const router = useRouter();
  const { user, backendAvailable } = useAuth();
  // §2.11 — sitewide search lives in a floating dropdown; the navbar
  // glass just toggles visibility.
  const [searchOpen, setSearchOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Close every dropdown except the one named, so any icon tap
  // dismisses whatever else was open.
  const closeOthers = (keep?: "profile" | "search") => {
    if (keep !== "profile") setShowDropdown(false);
    if (keep !== "search") setSearchOpen(false);
  };

  return (
    <>
      <View {...({ dataSet: { role: "navbar" } } as any)} style={s.navbar}>
        {/* Left spacer — balances the right-side icons so the
           absolutely-centered logo stays centered. (HOME / DISCOVER
           tabs removed with the feed.) */}
        <View style={s.leftLinks} />

        {/* Center — Crema logo → catalog landing */}
        <Pressable onPress={() => router.push("/browse")} style={s.logoArea}>
          <CremaLogo width={141} height={29} />
        </Pressable>

        {/* Right side — search + user avatar */}
        <View style={s.rightSide}>
          <Pressable
            onPress={() => { closeOthers("search"); setSearchOpen((v) => !v); }}
            style={s.iconBtn}
          >
            <Search size={24} color={t.color["navbar.text"]} strokeWidth={1.5} />
          </Pressable>

          {user ? (
            <Pressable
              onPress={() => { closeOthers("profile"); setShowDropdown((v) => !v); }}
              style={s.iconBtn}
            >
              {user.avatar_url ? (
                <View style={{ borderWidth: 1.5, borderColor: t.color["navbar.text"], borderRadius: 16, overflow: "hidden" }}>
                  <CroppedAvatar
                    url={user.avatar_url}
                    cropX={user.avatar_crop_x}
                    cropY={user.avatar_crop_y}
                    zoom={user.avatar_zoom}
                    size={28}
                  />
                </View>
              ) : (
                <User size={24} color={t.color["navbar.text"]} strokeWidth={1.5} />
              )}
            </Pressable>
          ) : backendAvailable ? (
            <Pressable onPress={() => router.push("/auth")} style={s.iconBtn}>
              <User size={24} color={t.color["navbar.text"]} strokeWidth={1.5} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* §2.11 — sitewide search dropdown (beans / roasters / journal). */}
      <SearchDropdown
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
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
  navbar: {
    height: NAVBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: "6.25%" as any,
    paddingRight: "6.25%" as any,
    backgroundColor: t.color["navbar.bg"],
  },
  // Left spacer: flex:1 to balance the flex:1 right side, keeping the
  // absolutely-centered logo centered.
  leftLinks: { flex: 1 },
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
    gap: 40,
    flex: 1,
  },
  iconBtn: { position: "relative" } as any,
});
