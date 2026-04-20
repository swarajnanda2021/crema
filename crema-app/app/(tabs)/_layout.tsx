import { View } from "react-native";
import { Tabs } from "expo-router";
import SiteHeader from "../../src/components/SiteHeader";

/**
 * (tabs) group layout — thin shell.
 *
 * Renders the top `SiteHeader` (mobile or web variant) and hands
 * routing to an Expo Router `Tabs` whose own tab bar is hidden on
 * every form factor. The visible bottom bar is the sitewide
 * `MobileFooter` mounted at the root layout — that way the bar
 * stays painted when users drill into non-(tabs) routes
 * (coffee / roaster / cafe / user / search / notifications /
 * account). On wide web the `Navbar` handles nav, so the footer
 * stays hidden there.
 */
export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <SiteHeader />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      />
    </View>
  );
}
