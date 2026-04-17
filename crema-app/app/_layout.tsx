import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "../global.css";

import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { CoffeeDataProvider } from "../src/hooks/useCoffeeData";
import { t } from "../src/tokens/useTokens";
import PostModal from "../src/components/shell/PostModal";
import AuthModal from "../src/components/AuthModal";
import NavigationLoader from "../src/components/NavigationLoader";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/** Single sitewide PostModal — rendered once at root, listens for crema:open-post */
function GlobalPostModal() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const handler = (e: any) => setData(e.detail);
    window.addEventListener("crema:open-post", handler);
    return () => window.removeEventListener("crema:open-post", handler);
  }, []);

  return (
    <PostModal
      visible={!!data}
      postId={data?.postId}
      post={data?.post}
      mode={data?.mode || "view"}
      highlightCommentId={data?.highlightCommentId}
      onClose={() => setData(null)}
      user={user}
    />
  );
}

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
    CanelaText_Regular: require("../assets/fonts/CanelaText-Regular.otf"),
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
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
              contentStyle: { backgroundColor: t.color.bg },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" options={{ presentation: "modal" }} />
            <Stack.Screen
              name="coffee/[id]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="roaster/[slug]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="user/[username]"
              options={{
                headerShown: true,
                title: "",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="cafe/[slug]"
              options={{
                headerShown: false,
              }}
            />
          </Stack>
          <StatusBar style="light" />
          <GlobalPostModal />
          {/* Sitewide floating auth modal — opened from ProfileDropdown's
              "Add another account" item via crema:open-auth-modal event. */}
          <AuthModal />
          {/* Page-transition overlay. Paints the content area below the
              navbar solid cream + a pulsing crema wordmark while routes
              change, so the partial-render flicker doesn't show. */}
          <NavigationLoader />
        </AuthGate>
      </CoffeeDataProvider>
    </AuthProvider>
  );
}
