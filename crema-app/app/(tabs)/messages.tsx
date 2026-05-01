/**
 * Messages — mobile bottom tab screen.
 *
 * Reached from the Messages tab icon. Renders MessagesDropdown in
 * fullScreen mode — same inbox + thread view as the floating
 * dropdown on wide web; only the presentation flips.
 *
 * Accepts optional route params `thread_id` + `kind` so cross-screen
 * CTAs ("Message this user" on a profile) can deep-link into a
 * specific thread. The params are read once on mount and handed to
 * `MessagesDropdown` as `initialThread`. (M3)
 */
import { useLocalSearchParams } from "expo-router";
import { View, StyleSheet } from "react-native";
import { t, makeStyles } from "../../src/tokens/useTokens";
import MessagesDropdown from "../../src/components/MessagesDropdown";

export default function MessagesScreen() {
  const params = useLocalSearchParams<{ thread_id?: string }>();
  const threadId = params?.thread_id ? Number(params.thread_id) : null;
  const initialThread =
    threadId && !Number.isNaN(threadId)
      ? ({ kind: "direct_message" as const, id: threadId })
      : null;
  const s = useStyles();

  return (
    <View style={s.wrap}>
      <MessagesDropdown
        visible={true}
        onClose={() => {}}
        fullScreen
        initialThread={initialThread}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, backgroundColor: t.color.bg },
}));
