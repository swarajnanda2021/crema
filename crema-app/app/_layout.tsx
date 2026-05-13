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
import { NotificationsProvider } from "../src/hooks/useNotifications";
import { DirectInboxProvider } from "../src/hooks/useDirectInbox";
import { t, makeStyles, useTheme } from "../src/tokens/useTokens";
import { ThemeProvider } from "../src/tokens/ThemeProvider";
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
import FabPill from "../src/components/primitives/FabPill";
import { openComposePost } from "../src/components/primitives";
import { Plus } from "lucide-react-native";
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

/** Floating "Create post" pill on the home feed only (`/`).
 *
 *  /profile and /roaster/<slug> need per-page state to gate the
 *  pill (activeTab, isEditing, isOwner) — those pages register
 *  their own FAB via `useFloatingFab` from inside the page so the
 *  visibility tracks the page's tab state. ArticlesPanel does the
 *  same for the admin Refresh pill.
 *
 *  Mounted at the root layout's relative wrapper level so the
 *  pill is anchored to a parent whose bottom edge doesn't move
 *  when MobileHeader animates its height on scroll-collapse —
 *  fixes the per-frame jitter that inline mounts produced
 *  (§2.40.16).
 *
 *  `useIsFloatingFabRegistered()` short-circuits to null whenever
 *  another component has claimed the FAB slot — defensive
 *  guard against future dynamic FAB registrations on the home
 *  feed (no current use case, but the cost is one context read). */
function ConditionalCreatePostFab() {
  const { user } = useAuth();
  const pathname = usePathname();
  const fabRegistered = useIsFloatingFabRegistered();

  if (!user) return null;
  if (fabRegistered) return null;
  if (pathname !== "/") return null;

  return (
    <FabPill
      testID="fab-compose-post"
      icon={<Plus size={17} color={t.color["text.on-light"]} strokeWidth={2.5} />}
      label="Create post"
      onPress={() => openComposePost()}
      style={{ position: "absolute" as any, bottom: 28, right: 28 }}
    />
  );
}

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/** Single sitewide PostModal — rendered once at root, listens for crema:open-post */
function GlobalPostModal() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);

  useEffect(() => listen("crema:open-post", (detail) => setData(detail)), []);
  // Sitewide "escape" hatch — chrome buttons (MobileHeader hamburger/
  // bell, MobileFooter tabs) emit `crema:dismiss-modals` so any open
  // modal yields focus back to the chrome destination the user just
  // tapped. Without this, tapping Home while the post viewer is open
  // is a visual no-op (the route is already `/`) and the user reads
  // the chrome as broken. Reported in §2.40.24.
  useEffect(() => listen("crema:dismiss-modals", () => setData(null)), []);

  return (
    <PostModal
      visible={!!data}
      postId={data?.postId}
      post={data?.post}
      article={data?.article}
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
  useEffect(() => listen("crema:dismiss-modals", () => setData(null)), []);
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
 *  `crema:open-compose` event.
 *
 *  Focus-mode mounting (§2.40.25): on mobile the composer renders
 *  FULL-VIEWPORT — `top: 0, bottom: 0` with `zIndex: 100` — so
 *  MobileHeader and MobileFooter are intentionally covered. The
 *  user's directive: "the composer is a focus zone, no distractions
 *  from anywhere is preferred." Internal `paddingTop: insets.top`
 *  keeps the top bar clear of the iPhone notch / Dynamic Island.
 *
 *  This component is mounted OUTSIDE the relative wrapper (sibling
 *  of MobileFooter) so its absolute positioning resolves against
 *  the outer flex column = full viewport. From inside the wrapper
 *  the composer would have been clipped above the footer.
 *
 *  Web wide keeps the centered floating card. */
function GlobalComposePost() {
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const gStyles = useGStyles();

  useEffect(() => listen("crema:open-compose", (detail) => setData(detail || {})), []);
  useEffect(() => listen("crema:dismiss-modals", () => setData(null)), []);

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
      initialData={data.initialData}
    />
  );

  // Mobile: full-viewport overlay. Web wide: centered floating card.
  if (isMobile) {
    return (
      <View
        style={[
          gStyles.fullScreenHost,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {body}
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

const useGStyles = makeStyles((t) => ({
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
  // Full-viewport host for the focus-mode composer (§2.40.25).
  // Mounted as a sibling of MobileFooter so absolute positioning
  // resolves against the outer flex column = full viewport. The
  // `zIndex: 100` paints above any wrapper-internal modal (40)
  // and the MobileFooter (no zIndex, normal flow), so the
  // composer covers the chrome zones the user asked us to hide
  // for distraction-free focus.
  fullScreenHost: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg,
    zIndex: 100,
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
}));

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
      if (inAuthScreen && !isAddAccountFlow) router.replace("/");
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
          <CoffeeDataProvider>
            <RoasterProfilesProvider>
              <RoasterArticlesProvider>
                <NotificationsProvider>
                  <DirectInboxProvider>
                    <AuthGate>
                      <ThemedRoot />
                    </AuthGate>
                  </DirectInboxProvider>
                </NotificationsProvider>
              </RoasterArticlesProvider>
            </RoasterProfilesProvider>
          </CoffeeDataProvider>
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
          {/* Mobile-only destinations behind the MobileHeader bell
             icon. Native stack renders a back button for free via
             headerShown:true. On web wide these URLs exist but the
             Navbar's floating dropdowns are preferred — nothing
             there navigates here. (Search used to live here as a
             Stack screen; it's now a peer (tabs)/search.tsx tab.) */}
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
        {/* "Create post" pill on the home feed (§2.40.16). Anchored
            to the relative wrapper's bottom-right (constant in
            screen coords because the wrapper's bottom edge sits at
            viewport-bottom-minus-footer-height = stable value).
            Sits BEFORE the modals below so an open compose / post
            modal renders on top and covers it. */}
        <ConditionalCreatePostFab />
        {/* Sitewide modals — mounted inside the relative wrapper so
            on mobile their absolute-positioned mid-band layers
            resolve to the chrome-excluding parent. MobileFooter is
            a sibling OUTSIDE this wrapper, so `bottom: 0` here
            lands at the top of MobileFooter exactly. (§2.40.3) */}
        <GlobalPostModal />
        <GlobalPopularityModal />
        {/* Sitewide floating auth modal — opened from ProfileDropdown's
            "Add another account" item via crema:open-auth-modal event. */}
        <AuthModal />
        {/* Mobile slide-in panels (search / notifications /
            account). Last inside the wrapper so slide chrome
            paints above any open modal. */}
        <MobileOverlays />
        </FloatingFabProvider>
      </View>
      <ConditionalMobileFooter />
      {/* Focus-mode composer — mounted OUTSIDE the relative wrapper
          (§2.40.25) so its full-viewport absolute positioning
          (top:0 / bottom:0 / zIndex:100) covers MobileHeader and
          MobileFooter. The user's directive: "the composer is a
          focus zone, no distractions from anywhere is preferred." */}
      <GlobalComposePost />
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
