import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import "react-native-reanimated";
import "../global.css";

import { View } from "react-native";
import { usePathname } from "expo-router";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { CoffeeDataProvider } from "../src/hooks/useCoffeeData";
import { t } from "../src/tokens/useTokens";
import { listen } from "../src/utils/events";
import { useBreakpoint } from "../src/hooks/useBreakpoint";
import PostModal from "../src/components/shell/PostModal";
import AuthModal from "../src/components/AuthModal";
import NavigationLoader from "../src/components/NavigationLoader";
import MobileFooter from "../src/components/MobileFooter";

/** Sticky bottom tab bar on every mobile screen. Hidden on /auth
 *  (full-page sign-in shouldn't compete with nav) and on wide web
 *  (Navbar handles nav there). Sits inside the same flex column as
 *  the Stack so the two never overlap. */
function ConditionalMobileFooter() {
  const { isMobile } = useBreakpoint();
  const pathname = usePathname();
  if (!isMobile) return null;
  if (pathname?.startsWith("/auth")) return null;
  return <MobileFooter />;
}

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/** Single sitewide PostModal — rendered once at root, listens for crema:open-post */
function GlobalPostModal() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);

  useEffect(() => listen("crema:open-post", (detail) => setData(detail)), []);

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
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <CoffeeDataProvider>
          <AuthGate>
          <View style={{ flex: 1 }}>
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
            {/* Mobile-only destinations behind the MobileHeader
               search + bell icons. Native stack renders a back
               button for free via headerShown:true. On web wide
               these URLs exist but the Navbar's floating dropdowns
               are preferred — nothing there navigates here. */}
            <Stack.Screen
              name="search"
              options={{
                headerShown: true,
                title: "Search",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="notifications"
              options={{
                headerShown: true,
                title: "Notifications",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="account"
              options={{
                headerShown: true,
                title: "Account",
                headerTintColor: t.color["accent.cta"],
                headerStyle: { backgroundColor: t.color.bg },
                headerShadowVisible: false,
              } as any}
            />
          </Stack>
          <ConditionalMobileFooter />
          </View>
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
    </SafeAreaProvider>
  );
}
