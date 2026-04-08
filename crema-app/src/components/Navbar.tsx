import { View, Text, Pressable, TextInput, StyleSheet, Platform } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useState } from "react";
import { Coffee, User, ShoppingBag, Search, X, LogIn } from "lucide-react-native";
import { colors, fonts } from "../theme/colors";
import { useAuth } from "../hooks/useAuth";

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

  const isActive = (path: string) => pathname === path;

  return (
    <View style={s.navbar}>
      {/* Logo — links to Feed */}
      <Pressable onPress={() => router.push("/")} style={s.logoArea}>
        <Coffee size={20} color={colors.accent} strokeWidth={2.5} />
        <Text style={s.logoText}>Crema</Text>
      </Pressable>

      {/* Nav links */}
      <View style={s.navLinks}>
        {user && (
          <NavLink
            label="My Shelf"
            icon={<User size={15} color={isActive("/profile") ? colors.textPrimary : colors.textMuted} strokeWidth={2} />}
            active={isActive("/profile")}
            onPress={() => router.push("/profile")}
          />
        )}
        <NavLink
          label="Browse"
          icon={<ShoppingBag size={15} color={isActive("/browse") ? colors.textPrimary : colors.textMuted} strokeWidth={2} />}
          active={isActive("/browse")}
          onPress={() => router.push("/browse")}
        />
      </View>

      {/* Right side */}
      <View style={s.rightSide}>
        {searchOpen ? (
          <View style={s.searchContainer}>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder="Search..."
              placeholderTextColor={colors.textMuted}
              style={s.searchInput}
            />
            <Pressable onPress={() => { setSearchOpen(false); setQuery(""); }}>
              <X size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setSearchOpen(true)} style={s.iconBtn}>
            <Search size={17} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        )}

        {backendAvailable && !user && (
          <Pressable onPress={() => router.push("/auth")} style={s.signInBtn}>
            <LogIn size={13} color="white" />
            <Text style={s.signInText}>Sign In</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function NavLink({ label, icon, active, onPress }: { label: string; icon: React.ReactNode; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.navLink, active && s.navLinkActive]}>
      {icon}
      <Text style={[s.navLinkText, active && s.navLinkTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  navbar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(250, 247, 242, 0.97)",
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
    // Web-specific backdrop blur
    ...(Platform.OS === "web" ? { backdropFilter: "blur(12px)" } as any : {}),
  },
  logoArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 24,
  },
  logoText: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  navLinks: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  navLinkActive: {
    backgroundColor: colors.tagBg,
  },
  navLinkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  navLinkTextActive: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 8,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardFront,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    width: 200,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textPrimary,
  },
  signInBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 4,
  },
  signInText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "white",
  },
});
