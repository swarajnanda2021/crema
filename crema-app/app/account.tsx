/**
 * Account — standalone Stack screen (mobile).
 *
 * Reached from the MobileHeader hamburger. Renders ProfileDropdown
 * in fullScreen mode so every feature of the web ProfileDropdown —
 * current-account header, Manage / Edit / Sign out, multi-account
 * switcher, Add-another-account — is available to mobile users,
 * just laid out as a full page instead of a floating card.
 *
 * The wide Navbar continues to render ProfileDropdown as a floating
 * card on avatar click; same component, same logic, different
 * presentation.
 */
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { t } from "../src/tokens/useTokens";
import ProfileDropdown from "../src/components/ProfileDropdown";

export default function AccountScreen() {
  const router = useRouter();
  return (
    <View style={s.wrap}>
      <ProfileDropdown visible={true} onClose={() => router.back()} fullScreen />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: t.color.bg },
});
