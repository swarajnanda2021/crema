import { View, Platform, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { Coffee, User, ShoppingBag } from "lucide-react-native";
import { colors, fonts } from "../../src/theme/colors";
import Navbar from "../../src/components/Navbar";

export default function TabLayout() {
  const isWeb = Platform.OS === "web";

  return (
    <View style={{ flex: 1 }}>
      {/* Top navbar on web */}
      {isWeb && <Navbar />}

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.textPrimary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: {
            fontFamily: fonts.bodySemiBold,
            fontSize: 11,
            letterSpacing: 0.3,
          },
          tabBarStyle: isWeb
            ? { display: "none" } // Hide bottom tabs on web — use top navbar
            : {
                backgroundColor: colors.cardFront,
                borderTopColor: colors.borderLight,
                borderTopWidth: 1,
                height: 60,
                paddingBottom: 8,
                paddingTop: 6,
              },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Feed",
            tabBarIcon: ({ color, size }) => <Coffee size={size - 2} color={color} strokeWidth={2} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "My Shelf",
            tabBarIcon: ({ color, size }) => <User size={size - 2} color={color} strokeWidth={2} />,
          }}
        />
        <Tabs.Screen
          name="browse"
          options={{
            title: "Browse",
            tabBarIcon: ({ color, size }) => <ShoppingBag size={size - 2} color={color} strokeWidth={2} />,
          }}
        />
      </Tabs>
    </View>
  );
}
