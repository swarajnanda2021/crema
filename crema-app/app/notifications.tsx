/**
 * Notifications — standalone Stack screen (mobile).
 *
 * Reached from the MobileHeader bell. Renders NotificationsDropdown
 * in fullScreen mode — same activity / business tabs, same rows,
 * same onTap routing as the floating dropdown on wide web. Thread
 * notifications (wholesale inquiry / DM) route to /messages on
 * mobile.
 */
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { t, makeStyles } from "../src/tokens/useTokens";
import NotificationsDropdown from "../src/components/NotificationsDropdown";

export default function NotificationsScreen() {
  const router = useRouter();
  const s = useStyles();
  return (
    <View style={s.wrap}>
      <NotificationsDropdown
        visible={true}
        onClose={() => {}}
        onOpenThread={() => router.push("/messages")}
        fullScreen
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, backgroundColor: t.color.bg },
}));
