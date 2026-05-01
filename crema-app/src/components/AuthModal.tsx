/**
 * AuthModal — floating version of the `/auth` page. Opened from the
 * profile dropdown's "Add another account" item; lets the user log
 * into a second account without leaving the page.
 *
 * Design matches the full auth screen: big CremaLogo SVG, tagline,
 * User / Business tab selector, form card, social-auth row on the
 * user track only. Tracks recolor the modal interior — cream for
 * User, `roaster.panel` dark brown for Business — so business
 * sign-ins carry the same visual signal as the dedicated screen.
 *
 * Cap behaviour: upsertAccount enforces one account per type
 * (user / roaster / café), so signing into a 4th slot automatically
 * evicts the existing account of the same category.
 *
 * Opens via `window.dispatchEvent(new CustomEvent("crema:open-auth-modal"))`.
 */

import { useEffect, useState } from "react";
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { t, makeStyles } from "../tokens/useTokens";
import { listen } from "../utils/events";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint } from "../hooks/useBreakpoint";
import CremaLogo from "./CremaLogo";

const MOBILE_HEADER_HEIGHT = (t.size as any)["navbar.mobile.height"];

type Track = "user" | "business";

export default function AuthModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => listen("crema:open-auth-modal", () => setVisible(true)), []);

  if (!visible) return null;
  return <AuthModalContent visible={visible} onClose={() => setVisible(false)} />;
}

function AuthModalContent({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const { login, register } = useAuth();
  const { isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [isLogin, setIsLogin] = useState(true);
  const [track, setTrack] = useState<Track>("user");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const s = useStyles();

  const reset = () => {
    setIsLogin(true);
    setTrack("user");
    setUsername(""); setDisplayName(""); setPassword("");
    setError(""); setLoading(false);
  };
  const close = () => { reset(); onClose(); };

  const isBusiness = track === "business";
  const bgColor = isBusiness ? t.color["roaster.panel"] : t.color.bg;
  const fgColor = isBusiness ? t.color["text.on-cta"] : t.color["text.primary"];
  const mutedFg = isBusiness ? "rgba(250,248,240,0.6)" : t.color["text.muted"];

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      if (isLogin) await login(username, password, isBusiness);
      else await register(username, displayName || username, password, isBusiness);
      close();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = (provider: "google" | "instagram" | "reddit") => {
    setError(`${provider[0].toUpperCase() + provider.slice(1)} sign-in is coming soon.`);
  };

  const cardBody = (
    <View style={[s.card, isMobile && s.cardMidBand, { backgroundColor: bgColor }]}>
      {/* Close button in the corner — absolute so it doesn't
         throw off the hero's centering. */}
      <Pressable onPress={close} hitSlop={8} style={s.closeBtn}>
        <X size={20} color={fgColor} />
      </Pressable>

          <ScrollView
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero — Crema SVG + tagline, flips with the track. */}
            <View style={s.hero}>
              <CremaLogo width={200} height={42} />
              <Text style={[s.tagline, { color: fgColor }]}>Discover coffee.</Text>
            </View>

            {/* Track selector */}
            <View style={s.trackRow}>
              <Pressable
                onPress={() => { setTrack("user"); setError(""); }}
                style={[s.trackTab, !isBusiness && s.trackTabActiveLight]}
              >
                <Text style={[s.trackTabText, !isBusiness ? s.trackTabTextActiveLight : { color: mutedFg }]}>
                  For you
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setTrack("business"); setError(""); }}
                style={[s.trackTab, isBusiness && s.trackTabActiveDark]}
              >
                <Text style={[s.trackTabText, isBusiness ? s.trackTabTextActiveDark : { color: mutedFg }]}>
                  For business
                </Text>
              </Pressable>
            </View>

            {/* Form card — always cream so inputs read consistently
               across both tracks. */}
            <View style={s.formCard}>
              <Text style={s.formTitle}>
                {isBusiness
                  ? (isLogin ? "Sign in for business" : "Create a business account")
                  : (isLogin ? "Add another account" : "Create a new account")}
              </Text>
              <Text style={s.formHint}>
                Only one user, one roaster, and one café stay signed in at once. Adding a new account of the same type replaces the previous one.
              </Text>

              <TextInput
                placeholder="Username"
                placeholderTextColor={t.color["text.muted"]}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.input}
              />
              {!isLogin && (
                <TextInput
                  placeholder={isBusiness ? "Business name" : "Display Name"}
                  placeholderTextColor={t.color["text.muted"]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  style={s.input}
                />
              )}
              <TextInput
                placeholder="Password"
                placeholderTextColor={t.color["text.muted"]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={s.input}
              />

              {error ? <Text style={s.error}>{error}</Text> : null}

              <Pressable
                onPress={submit}
                disabled={loading || !username || !password}
                style={[s.submit, (loading || !username || !password) && s.submitDisabled]}
              >
                <Text style={s.submitText}>
                  {loading ? "…" : isLogin ? "Sign in" : "Create account"}
                </Text>
              </Pressable>

              <Pressable onPress={() => { setIsLogin(!isLogin); setError(""); }}>
                <Text style={s.toggleText}>
                  {isLogin ? "New here? Create an account" : "Already have one? Sign in"}
                </Text>
              </Pressable>

              {/* Social row — user track only. */}
              {!isBusiness && (
                <>
                  <View style={s.dividerRow}>
                    <View style={s.dividerLine} />
                    <Text style={s.dividerText}>or continue with</Text>
                    <View style={s.dividerLine} />
                  </View>
                  <View style={s.socialRow}>
                    {(["google", "instagram", "reddit"] as const).map((p) => (
                      <Pressable key={p} onPress={() => handleSocial(p)} style={s.socialBtn}>
                        <Text style={s.socialBtnText}>{p[0].toUpperCase() + p.slice(1)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
      </ScrollView>
    </View>
  );

  // Mobile: mid-band absolute (chrome preserved). Web wide: centered
  // floating overlay via RN Modal.
  if (isMobile) {
    return (
      <View style={[s.mobileHost, { top: insets.top + MOBILE_HEADER_HEIGHT, bottom: 0 }]}>
        {cardBody}
      </View>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={close} />
        {cardBody}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlayWrap: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any)
      : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  card: {
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 460,
    maxHeight: "90%",
    overflow: "hidden",
    zIndex: 1,
  } as any,
  // Mobile: mid-band absolute host. GlobalPostModal-style: parent is
  // the root relative wrapper so `bottom: 0` = top of MobileFooter.
  mobileHost: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: t.color.bg,
    // See PostModal.tsx — zIndex over `elevation: 12` to avoid the
    // Material-shadow hit-test outline quirk on Android (M2).
    zIndex: 40,
  } as any,
  cardMidBand: {
    width: "100%" as any,
    height: "100%" as any,
    maxWidth: undefined,
    maxHeight: undefined,
    borderRadius: 0,
  } as any,
  closeBtn: {
    position: "absolute",
    top: 14, right: 14,
    zIndex: 2,
    padding: 4,
  } as any,

  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 28,
    alignItems: "center",
    gap: 22,
  } as any,

  hero: { alignItems: "center", gap: 6 } as any,
  tagline: {
    fontFamily: t.font.display,
    fontSize: 16,
    letterSpacing: 0.2,
    opacity: 0.85,
  } as any,

  trackRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: 4,
    gap: 4,
  } as any,
  trackTab: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 999,
  } as any,
  trackTabActiveLight: { backgroundColor: t.color["text.primary"] } as any,
  trackTabActiveDark: { backgroundColor: t.color.accent } as any,
  trackTabText: {
    fontFamily: t.font["body.semibold"], fontSize: 12,
    letterSpacing: 0.3,
  },
  trackTabTextActiveLight: { color: t.color["text.on-cta"] } as any,
  trackTabTextActiveDark: { color: t.color["text.primary"] } as any,

  formCard: {
    width: "100%",
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.md,
    padding: 22,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  } as any,
  formTitle: {
    fontFamily: t.font.display,
    fontSize: 20,
    lineHeight: 26,
    color: t.color["text.primary"],
  },
  formHint: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.muted"],
    lineHeight: 17,
    marginTop: -4, marginBottom: 4,
  },
  input: {
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: t.font["body.regular"], fontSize: 14,
    color: t.color["text.primary"],
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  error: {
    fontFamily: t.font["body.regular"], fontSize: 12.5,
    color: t.color["accent.cta"],
    textAlign: "center",
  },
  submit: {
    backgroundColor: t.color["text.primary"],
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  submitDisabled: { opacity: 0.5 } as any,
  submitText: {
    fontFamily: t.font["body.semibold"], fontSize: 13,
    color: t.color["text.on-cta"], letterSpacing: 0.3,
  },
  toggleText: {
    fontFamily: t.font["body.medium"], fontSize: 12.5,
    color: t.color["text.secondary"],
    textAlign: "center",
    paddingVertical: 4,
  },

  dividerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginTop: 8, marginBottom: 2,
  } as any,
  dividerLine: { flex: 1, height: 1, backgroundColor: t.color["border.light"] } as any,
  dividerText: {
    fontFamily: t.font["body.regular"], fontSize: 10.5,
    color: t.color["text.muted"], letterSpacing: 0.3,
  },
  socialRow: { flexDirection: "row", gap: 8 } as any,
  socialBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1, borderColor: t.color["border.light"],
    alignItems: "center",
    backgroundColor: t.color.bg,
  } as any,
  socialBtnText: {
    fontFamily: t.font["body.semibold"], fontSize: 12.5,
    color: t.color["text.primary"],
  },
}));
