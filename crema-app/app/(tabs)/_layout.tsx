import { Tabs } from "expo-router";
import { View, Text, StyleSheet } from "react-native";
import { Coffee, ShoppingBag, User } from "lucide-react-native";
import { colors, fonts } from "../../src/theme/colors";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: fonts.bodySemiBold,
          fontSize: 11,
          letterSpacing: 0.3,
        },
        tabBarStyle: {
          backgroundColor: colors.cardFront,
          borderTopColor: colors.borderLight,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
        headerStyle: {
          backgroundColor: colors.bg,
          shadowColor: "transparent",
          elevation: 0,
          borderBottomWidth: 0,
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: {
          fontFamily: fonts.displayBold,
          fontSize: 22,
          color: colors.textPrimary,
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Crema",
          tabBarLabel: "Feed",
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Coffee size={20} color={colors.accent} strokeWidth={2.5} />
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 22, color: colors.textPrimary }}>
                Crema
              </Text>
            </View>
          ),
          tabBarIcon: ({ color, size }) => <Coffee size={size - 2} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: "Browse",
          tabBarIcon: ({ color, size }) => <ShoppingBag size={size - 2} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "My Shelf",
          tabBarIcon: ({ color, size }) => <User size={size - 2} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
