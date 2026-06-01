import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";

import { View } from "react-native";
import { usePathname } from "expo-router";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { CoffeeDataProvider } from "../src/hooks/useCoffeeData";
import { RoasterProfilesProvider } from "../src/hooks/useRoasterProfiles";
import { RoasterArticlesProvider } from "../src/hooks/useRoasterArticles";
import { t, makeStyles, useTheme } from "../src/tokens/useTokens";
import { ThemeProvider } from "../src/tokens/ThemeProvider";
import { listen, emit } from "../src/utils/events";
import { useBreakpoint } from "../src/hooks/useBreakpoint";
import Toast from "../src/components/shell/Toast";
import AuthModal from "../src/components/AuthModal";
import NavigationLoader from "../src/components/NavigationLoader";
import MobileFooter from "../src/components/MobileFooter";
import MobileOverlays from "../src/components/mobile/MobileOverlays";
import ContactCrema from "../src/components/ContactCrema";
import { FloatingFabProvider, useIsFloatingFabRegistered } from "../src/contexts/FloatingFabContext";
import { apiFetchRaw } from "../src/api/client";

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



function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, backendAvailable } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();

  const inAuthScreen = segments[0] === "auth";
  const inBrowse = segments[0] === "(tabs)" && segments[1] === "browse";
  // Deliberate exception — ProfileDropdown "Add another account" on
  // native routes to `/auth?addAccount=1`. A logged-in user has to
  // land on that screen to sign a SECOND account in; without this
  // exception, AuthGate bounces them back to "/" and the flow
  // silently fails. (§2.40.4)
  const isAddAccountFlow =
    inAuthScreen &&
    (typeof window !== "undefined" && typeof window.location !== "undefined"
      ? new URLSearchParams(window.location.search || "").get("addAccount") === "1"
      : pathname?.includes("addAccount=1"));
  const wantsAuth = !backendAvailable || !user;

  useEffect(() => {
    if (loading) return;
    if (inBrowse) return;
    if (wantsAuth) {
      if (!inAuthScreen) router.replace("/auth");
    } else {
      if (inAuthScreen && !isAddAccountFlow) router.replace("/browse");
    }
  }, [user, loading, backendAvailable, segments, pathname]);

  // Hold the native splash until auth has resolved AND we're already
  // rendering the route the user belongs on. Otherwise on cold-launch
  // the (tabs) chrome flashes for one frame before the router.replace
  // to /auth lands.
  useEffect(() => {
    if (loading) return;
    const matched = inBrowse || isAddAccountFlow || wantsAuth === inAuthScreen;
    if (matched) SplashScreen.hideAsync().catch(() => {});
  }, [loading, wantsAuth, inAuthScreen, inBrowse, isAddAccountFlow]);

  if (loading) return null;
  if (!inBrowse && !isAddAccountFlow && wantsAuth !== inAuthScreen) return null;
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NewSpiritTRIAL_Regular: require("../assets/fonts/NewSpiritTRIAL-Regular.otf"),
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
  });

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  // Splash hide is owned by AuthGate now — it holds the splash until
  // auth has resolved AND the rendered route matches the user state,
  // so cold-launch never flashes the (tabs) chrome before bouncing to
  // /auth. Falling back here keeps a runaway splash from sticking when
  // fonts hard-fail.
  useEffect(() => {
    if (fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontError]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <AuthProvider>
          <RoasterProfilesProvider>
            <CoffeeDataProvider>
              <RoasterArticlesProvider>
                <AuthGate>
                  <ThemedRoot />
                </AuthGate>
              </RoasterArticlesProvider>
            </CoffeeDataProvider>
          </RoasterProfilesProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Subscribes to theme changes so the Stack's screenOptions and any
 *  inline `t.color.X` reads below repaint when the user switches modes.
 *  Sits inside ThemeProvider so `useTheme()` resolves correctly. */
function ThemedRoot() {
  // Subscribe — re-renders on theme change so all the inline
  // `t.color.X` reads in screenOptions below pick up the new values.
  useTheme();
  return (
    // backgroundColor on the outermost theme-aware view so the iOS
    // home-indicator safe area beneath the MobileFooter (and any
    // pixel exposed mid-animation when the footer slides out) paints
    // with the theme bg instead of leaking the OS window's default
    // white. Without this the dark-mode footer-hide animation flashes
    // a light strip across the home indicator zone. (Reported with a
    // dark-mode screen capture during scroll-hide.)
    <View style={{ flex: 1, backgroundColor: t.color.bg }}>
      {/* Relative wrapper — the Stack fills this, and
          `MobileOverlays` absolute-positions inside it with
          safe-area + chrome offsets so the slide panels sit
          BETWEEN the (tabs) SiteHeader and the MobileFooter
          below.
          The FloatingFabProvider (§2.40.18) wraps everything
          inside the wrapper so any deeply-nested component
          (admin ArticlesPanel's Refresh, roaster page's Create
          post for owners) can register a FAB and have it render
          here at the wrapper level — anchored to a stable bottom
          edge (no chrome-scroll jitter). */}
      <View style={{ flex: 1, position: "relative" } as any}>
        <FloatingFabProvider>
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
            name="article/[id]"
            options={{
              // Article reader uses its own floating back FAB on the
              // hero image (matching the roaster page treatment); the
              // system header is hidden so the hero can run edge-to-
              // edge without an empty navbar above it.
              headerShown: false,
            }}
          />
          {/* /account is reached via the ProfileDropdown. Native stack
             renders a back button for free via headerShown:true. */}
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
        {/* Sitewide floating auth modal — opened from ProfileDropdown's
            "Add another account" item via crema:open-auth-modal event. */}
        <AuthModal />
        {/* Mobile slide-in panels (search / notifications /
            account). Last inside the wrapper so slide chrome
            paints above any open modal. */}
        <MobileOverlays />
        {/* Floating "Contact Crema" support widget (catalog-only) — sits
            in the chrome-excluding wrapper where the old create-post FAB
            lived, so it clears the MobileFooter on mobile. */}
        <ContactCrema />
        </FloatingFabProvider>
      </View>
      <ConditionalMobileFooter />
      {/* Sitewide status toast — sibling OUTSIDE the relative
          wrapper so its top offset is screen-absolute and it can
          paint above MobileHeader + the relative band.
          Triggered via `showToast("Liked")` etc. */}
      <Toast />
      <StatusBar style="light" />
      {/* Page-transition overlay. Paints the content area below the
          navbar solid cream + a pulsing crema wordmark while routes
          change, so the partial-render flicker doesn't show. */}
      <NavigationLoader />
    </View>
  );
}
