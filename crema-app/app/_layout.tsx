import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "../global.css";

import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { CoffeeDataProvider } from "../src/hooks/useCoffeeData";
import { colors } from "../src/theme/colors";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, backendAvailable } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthScreen = segments[0] === "auth";
    const inBrowse = segments[0] === "(tabs)" && segments[1] === "browse";
    if (inBrowse) return;
    if (!backendAvailable || !user) {
      if (!inAuthScreen) router.replace("/auth");
    } else {
      if (inAuthScreen) router.replace("/");
    }
  }, [user, loading, backendAvailable, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Canela Text — local OTF for card headings & prices
    CanelaText_Regular: require("../assets/fonts/CanelaText-Regular.otf"),
    // Inter — Google Font for all UI text
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <CoffeeDataProvider>
        <AuthGate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" options={{ presentation: "modal" }} />
            <Stack.Screen
              name="coffee/[id]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: colors.accent,
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="roaster/[slug]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: colors.accent,
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="user/[username]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: colors.accent,
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
          </Stack>
          <StatusBar style="light" />
        </AuthGate>
      </CoffeeDataProvider>
    </AuthProvider>
  );
}
