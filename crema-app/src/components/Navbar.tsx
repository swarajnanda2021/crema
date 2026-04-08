/**
 * Navbar — exact Figma specs from the design file.
 * Height: 72px, bg: #351101.
 * HOME at x=90, SHOP at x=213, logo centered at x=649.
 * Search icon at x=1262 (24px), User icon at x=1326 (24px).
 * Active SHOP link: #D798DA (logo purple).
 */
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useState } from "react";
import { User, Search, X } from "lucide-react-native";
import { colors, fonts } from "../theme/colors";
import { useAuth } from "../hooks/useAuth";
import CremaLogo from "./CremaLogo";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, backendAvailable } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleSearch = () => {
    if (query.trim()) {
      router.push(`/browse?q=${encodeURIComponent(query.trim())}`);
    }
    setSearchOpen(false);
    setQuery("");
  };

  const isShop = pathname === "/browse";
  const isHome = pathname === "/";

  return (
    <View style={s.navbar}>
      {/* Left nav links — HOME at x=90, SHOP at x=213 */}
      <View style={s.leftLinks}>
        <Pressable onPress={() => router.push("/")} style={s.navLink}>
          <Text style={[s.navLinkText, isHome && s.navLinkTextActiveHome]}>HOME</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/browse")} style={s.navLink}>
          <Text style={[s.navLinkText, isShop && s.navLinkTextActiveShop]}>SHOP</Text>
        </Pressable>
      </View>

      {/* Center — Crema logo (141×29, centered) */}
      <Pressable onPress={() => router.push("/")} style={s.logoArea}>
        <CremaLogo width={141} height={29} />
      </Pressable>

      {/* Right side — search + user icons */}
      <View style={s.rightSide}>
        {searchOpen ? (
          <View style={s.searchContainer}>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder="Search"
              placeholderTextColor="rgba(250,248,240,0.5)"
              style={s.searchInput}
            />
            <Pressable onPress={() => { setSearchOpen(false); setQuery(""); }}>
              <X size={18} color="#E7D5B8" />
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable onPress={() => setSearchOpen(true)} style={s.iconBtn}>
              <Search size={24} color="#E7D5B8" strokeWidth={1.5} />
            </Pressable>
            {user ? (
              <Pressable onPress={() => router.push("/profile")} style={s.iconBtn}>
                <User size={24} color="#E7D5B8" strokeWidth={1.5} />
              </Pressable>
            ) : backendAvailable ? (
              <Pressable onPress={() => router.push("/auth")} style={s.iconBtn}>
                <User size={24} color="#E7D5B8" strokeWidth={1.5} />
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Figma: 1440×72, bg #351101
  navbar: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 90,   // Figma: HOME at x=90
    paddingRight: 90,  // Figma: symmetric
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
    fontFamily: fonts.bodySemiBold,
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
  iconBtn: {},
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: 200,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: "#E7D5B8",
  },
});
