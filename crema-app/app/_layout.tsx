import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "../global.css";

import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { CoffeeDataProvider } from "../src/hooks/useCoffeeData";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/** Redirect to /auth if not logged in */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, backendAvailable } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthScreen = segments[0] === "auth";
    const inBrowse = segments[0] === "(tabs)" && segments[1] === "browse";

    // Allow browse without auth
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
    PlayfairDisplay: require("../assets/fonts/SpaceMono-Regular.ttf"), // Placeholder — replace with Playfair
    Inter: require("../assets/fonts/SpaceMono-Regular.ttf"), // Placeholder — replace with Inter
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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" options={{ presentation: "modal" }} />
            <Stack.Screen name="coffee/[id]" options={{ headerShown: true, title: "" }} />
            <Stack.Screen name="roaster/[slug]" options={{ headerShown: true, title: "" }} />
            <Stack.Screen name="user/[username]" options={{ headerShown: true, title: "" }} />
          </Stack>
          <StatusBar style="dark" />
        </AuthGate>
      </CoffeeDataProvider>
    </AuthProvider>
  );
}
