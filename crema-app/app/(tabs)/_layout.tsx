import { Tabs } from "expo-router";
import { Coffee, ShoppingBag, User } from "lucide-react-native";
import { colors } from "../../src/theme/colors";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.cardFront,
          borderTopColor: colors.border,
        },
        headerStyle: {
          backgroundColor: "rgba(250, 247, 242, 0.95)",
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Crema",
          tabBarLabel: "Feed",
          tabBarIcon: ({ color, size }) => <Coffee size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: "Browse",
          tabBarIcon: ({ color, size }) => <ShoppingBag size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "My Shelf",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
