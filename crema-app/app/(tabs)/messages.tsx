/**
 * Messages — mobile bottom tab screen.
 *
 * Reached from the Messages tab icon. Renders MessagesDropdown in
 * fullScreen mode — same inbox + thread view as the floating
 * dropdown on wide web; only the presentation flips.
 */
import { View, StyleSheet } from "react-native";
import { t } from "../../src/tokens/useTokens";
import MessagesDropdown from "../../src/components/MessagesDropdown";

export default function MessagesScreen() {
  return (
    <View style={s.wrap}>
      <MessagesDropdown visible={true} onClose={() => {}} fullScreen />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: t.color.bg },
});
