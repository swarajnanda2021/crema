/**
 * Search — standalone Stack screen (mobile).
 *
 * Reached from the MobileHeader search glass. Renders SearchDropdown
 * in fullScreen mode so the input + result sections (Users / Beans /
 * Roasters / Cafés) fill the viewport below the Stack header. Wide
 * web continues to use the floating dropdown triggered from the
 * Navbar; same component, same logic — only the presentation flips.
 */
import { View, StyleSheet } from "react-native";
import { t } from "../src/tokens/useTokens";
import SearchDropdown from "../src/components/SearchDropdown";

export default function SearchScreen() {
  return (
    <View style={s.wrap}>
      <SearchDropdown visible={true} onClose={() => {}} fullScreen />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: t.color.bg },
});
