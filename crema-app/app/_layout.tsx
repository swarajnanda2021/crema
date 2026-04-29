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
import { CoffeeDataProvider, useCoffeeData } from "../src/hooks/useCoffeeData";
import { t } from "../src/tokens/useTokens";
import { listen, emit } from "../src/utils/events";
import { useBreakpoint } from "../src/hooks/useBreakpoint";
import PostModal from "../src/components/shell/PostModal";
import Toast from "../src/components/shell/Toast";
import AuthModal from "../src/components/AuthModal";
import PopularityModal from "../src/components/PopularityModal";
import ComposePost from "../src/components/ComposePost";
import NavigationLoader from "../src/components/NavigationLoader";
import MobileFooter from "../src/components/MobileFooter";
import MobileOverlays from "../src/components/mobile/MobileOverlays";
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

/** Single sitewide PopularityModal — triggered via
 *  `openPopularityModal(opts)` from CoffeeCard's social dot. Mounted
 *  here so on mobile the modal's absolute-positioned mid-band wrapper
 *  resolves against the chrome-excluding relative parent. */
function GlobalPopularityModal() {
  const [data, setData] = useState<any>(null);
  useEffect(() => listen("crema:open-popularity", (detail) => setData(detail)), []);
  if (!data) return null;
  return (
    <PopularityModal
      visible={!!data}
      productId={data.productId}
      coffeeName={data.coffeeName}
      roasterName={data.roasterName}
      roastLevel={data.roastLevel}
      process={data.process}
      productUrl={data.productUrl}
      onClose={() => setData(null)}
    />
  );
}

/** Single sitewide ComposePost — the Home FAB + Profile post prompt
 *  + any other "open the composer" affordance all route through the
 *  `crema:open-compose` event. Mounted inside the relative wrapper
 *  so the mid-band positioning keeps MobileHeader + MobileFooter
 *  painted on mobile. */
function GlobalComposePost() {
  const { user } = useAuth();
  const { products: productMap } = useCoffeeData() as any;
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);

  useEffect(() => listen("crema:open-compose", (detail) => setData(detail || {})), []);

  const close = () => setData(null);
  const visible = data !== null;

  if (!visible) return null;

  const endpoint = data.endpoint || "/posts";
  const extra = data.extraData || {};
  const refetchEvent = data.refetchEventName || "crema:posts-updated";

  const submit = async (payload: any) => {
    try {
      if (data.editPostId) {
        await apiFetchRaw(`${endpoint}/${data.editPostId}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, ...extra }),
        });
      } else {
        await apiFetchRaw(endpoint, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            ...extra,
            post_type: payload.post_type || "note",
          }),
        });
      }
      close();
      // Fire a refetch signal so whichever screen raised the composer
      // can refresh its feed without holding a direct callback ref.
      emit(refetchEvent, {});
    } catch (e: any) {
      console.warn("Compose submit failed:", e?.message);
    }
  };

  const body = (
    <ComposePost
      onSubmit={submit}
      onCancel={close}
      loading={false}
      user={user}
      products={productMap ? Array.from((productMap as any[])) : []}
      initialData={data.initialData}
    />
  );

  // Mobile: absolute mid-band. Web wide: centered floating card.
  const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];
  if (isMobile) {
    return (
      <View style={[gStyles.mobileHost, { top: insets.top + MOBILE_HEADER_HEIGHT, bottom: 0 }]}>
        <View style={gStyles.composeCardMobile}>{body}</View>
      </View>
    );
  }
  return (
    <View style={gStyles.overlayWrap} pointerEvents="box-none">
      <Pressable style={gStyles.overlayBg} onPress={close} />
      <View style={gStyles.composeCard}>{body}</View>
    </View>
  );
}

const gStyles = StyleSheet.create({
  mobileHost: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: t.color.bg,
    // See the matching comment in PostModal.tsx — zIndex over
    // `elevation: 12` to avoid Android's Material-shadow hit-test
    // outline occasionally swallowing taps on sibling chrome (M2).
    zIndex: 40,
  } as any,
  composeCardMobile: { flex: 1, backgroundColor: t.color.bg, overflow: "hidden" } as any,
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  composeCard: {
    width: "90%",
    maxWidth: 680,
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.md,
    overflow: "hidden",
    maxHeight: "85%",
    zIndex: 1,
  } as any,
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, backendAvailable } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
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
    if (inBrowse) return;
    if (!backendAvailable || !user) {
      if (!inAuthScreen) router.replace("/auth");
    } else {
      if (inAuthScreen && !isAddAccountFlow) router.replace("/");
    }
  }, [user, loading, backendAvailable, segments, pathname]);

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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <CoffeeDataProvider>
          <AuthGate>
          <View style={{ flex: 1 }}>
          {/* Relative wrapper — the Stack fills this, and
              `MobileOverlays` absolute-positions inside it with
              safe-area + chrome offsets so the slide panels sit
              BETWEEN the (tabs) SiteHeader and the MobileFooter
              below. */}
          <View style={{ flex: 1, position: "relative" } as any}>
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
          {/* Sitewide modals — mounted inside the relative wrapper so
              on mobile their absolute-positioned mid-band layers
              resolve to the chrome-excluding parent. MobileFooter is
              a sibling OUTSIDE this wrapper, so `bottom: 0` here
              lands at the top of MobileFooter exactly. (§2.40.3) */}
          <GlobalPostModal />
          <GlobalPopularityModal />
          <GlobalComposePost />
          {/* Sitewide floating auth modal — opened from ProfileDropdown's
              "Add another account" item via crema:open-auth-modal event. */}
          <AuthModal />
          {/* Mobile slide-in panels (search / notifications /
              account). Last inside the wrapper so slide chrome
              paints above any open modal. */}
          <MobileOverlays />
          </View>
          <ConditionalMobileFooter />
          {/* Sitewide status toast — sibling OUTSIDE the relative
              wrapper so its top offset is screen-absolute and it can
              paint above MobileHeader + the relative band.
              Triggered via `showToast("Liked")` etc. */}
          <Toast />
          </View>
          <StatusBar style="light" />
          {/* Page-transition overlay. Paints the content area below the
              navbar solid cream + a pulsing crema wordmark while routes
              change, so the partial-render flicker doesn't show. */}
          <NavigationLoader />
        </AuthGate>
        </CoffeeDataProvider>
      </AuthProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
