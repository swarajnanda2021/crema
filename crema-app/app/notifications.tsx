/**
 * Notifications — full-page reader. Reached from the bell icon in
 * either SiteHeader (web Navbar) or MobileHeader. Sitewide affordance
 * is one tap → this route, no more sliding panels or floating
 * dropdowns.
 *
 * Chrome layout matches /article/[id] and /coffee/[id]:
 *   • SiteHeader at top (Crema wordmark + hamburger + bell) — stays
 *     sticky as the user scrolls.
 *   • NotificationsDropdown rendered in `fullScreen` mode — its own
 *     "Notifications" page header carries the title, "Mark all read"
 *     action, and a close X that we wire to router.back().
 *   • MobileFooter at bottom — global, mounted in the root layout, so
 *     no work needed here.
 *
 * The dropdown's existing close X IS the back button per the user's
 * directive ("a back button to get out"). It pops the stack when
 * possible and falls back to the home tab when there's nowhere to
 * pop to (e.g. the user landed via a deep link / push notification
 * tap that opened directly into this route).
 *
 * Thread-related notification taps (direct_message) route to
 * /messages so the user can read the conversation in full instead of
 * an inline preview.
 */
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { t, makeStyles } from "../src/tokens/useTokens";
import SiteHeader from "../src/components/SiteHeader";
import NotificationsDropdown from "../src/components/NotificationsDropdown";

export default function NotificationsScreen() {
  const router = useRouter();
  const s = useStyles();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/" as any);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SiteHeader />
      <View testID="notifications-screen" style={s.wrap}>
        <NotificationsDropdown
          visible={true}
          onClose={handleBack}
          onOpenThread={() => router.push("/messages")}
          fullScreen
        />
      </View>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, backgroundColor: t.color.bg },
}));
