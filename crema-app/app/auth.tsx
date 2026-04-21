/**
 * Auth screen — full-viewport brand surface that recolors with the
 * active track.
 *
 * User tab: cream background (the site's default bg — matches user
 * profile pages). Social-auth row (Google / Instagram / Reddit) is
 * present here, stubbed until OAuth wiring lands.
 *
 * Business tab: dark brown background (`roaster.panel` — the same
 * colour as the left column on roaster / café profile pages).
 * Business accounts manage a storefront, not a social feed, so the
 * social-auth row is hidden — these accounts sign in with username
 * + password only.
 *
 * No navbar, no half-navbar bar at the top. Just a large Canela
 * "crema" wordmark, tagline, tab selector, form card, browse link.
 * The page is the surface.
 */

import { useState } from "react";
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Animated, useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";

import { useAuth } from "../src/hooks/useAuth";
import { t } from "../src/tokens/useTokens";
import CremaLogo from "../src/components/CremaLogo";

type Track = "user" | "business";

export default function AuthPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ addAccount?: string; track?: string }>();
  const isAddingAccount = params.addAccount === "1";
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [track, setTrack] = useState<Track>(params.track === "business" ? "business" : "user");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isBusiness = track === "business";
  // Cream for the user track, roaster-panel dark brown for business.
  // Foreground text flips to stay readable on each.
  const bgColor = isBusiness ? t.color["roaster.panel"] : t.color.bg;
  const fgColor = isBusiness ? t.color["text.on-dark"] : t.color["text.primary"];
  const mutedFg = isBusiness ? "rgba(250,248,240,0.6)" : t.color["text.muted"];

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      if (isLogin) {
        await login(username, password, isBusiness);
      } else {
        await register(username, displayName || username, password, isBusiness);
      }
      router.replace("/");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = (provider: "google" | "instagram" | "reddit") => {
    setError(`${provider[0].toUpperCase() + provider.slice(1)} sign-in is coming soon.`);
  };

  const isCompact = width < 720;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[s.flex, { backgroundColor: bgColor }]}
    >
      <ScrollView
        contentContainerStyle={[s.scrollContent, isCompact && s.scrollContentCompact]}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand hero. Actual CremaLogo SVG — same asset the navbar
           uses, just scaled up. Tagline sits beneath. */}
        <View style={[s.hero, isCompact && s.heroCompact]}>
          <CremaLogo
            width={isCompact ? 280 : 440}
            height={isCompact ? 58 : 92}
          />
          <Text style={[s.tagline, { color: fgColor }, isCompact && s.taglineCompact]}>
            Discover coffee.
          </Text>
        </View>

        {/* Track selector — centred, pill-style. The inactive pill
           sits on a translucent wash that reads well on both the
           cream + dark backgrounds. */}
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

        {/* Form card. Always cream-bg so the inputs + error state
           read the same across both tracks. The card-on-dark reads
           like a piece of paper laid on wood, which is a nice
           business-feel. */}
        <View style={[s.card, isCompact && s.cardCompact]}>
          <Text style={s.cardTitle}>
            {isAddingAccount
              ? (isLogin ? "Add an account" : "Create a new account")
              : isBusiness
                ? (isLogin ? "Sign in for business" : "Create a business account")
                : (isLogin ? "Welcome back" : "Join Crema")}
          </Text>

          {isBusiness && !isAddingAccount && (
            <Text style={s.cardHint}>
              Roasters and cafés — manage your storefront, menu, wholesale flags, and inbox.
            </Text>
          )}
          {isAddingAccount && (
            <Text style={s.cardHint}>
              Sign in to another account. You can switch between accounts from the profile menu.
            </Text>
          )}

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

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={[s.submitBtn, loading && s.submitBtnLoading]}
          >
            <Text style={s.submitText}>
              {loading ? "…" : isLogin ? "Sign in" : "Create account"}
            </Text>
          </Pressable>

          <Pressable onPress={() => { setIsLogin(!isLogin); setError(""); }} hitSlop={6}>
            <Text style={s.toggleText}>
              {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>

          {/* Social auth — user track only. Business accounts sign in
             with creds; OAuth for business comes with domain
             verification in a later pass. */}
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

        <Pressable onPress={() => router.push("/browse")} hitSlop={8}>
          <Text style={[s.browseText, { color: mutedFg }]}>or browse coffees without signing in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 28,
  } as any,
  scrollContentCompact: {
    paddingVertical: 32, paddingHorizontal: 20, gap: 20,
  } as any,

  // Brand hero. Canela at scale: the whole point of the screen is
  // the name + what it does.
  hero: { alignItems: "center", gap: 8 } as any,
  heroCompact: { gap: 4 } as any,
  wordmark: {
    fontFamily: t.font.display,
    fontSize: 120,
    lineHeight: 128,
    letterSpacing: -1,
  } as any,
  wordmarkCompact: { fontSize: 76, lineHeight: 82 } as any,
  tagline: {
    fontFamily: t.font.display, // Canela italic-esque feel via display
    fontSize: 20,
    letterSpacing: 0.3,
    opacity: 0.85,
  } as any,
  taglineCompact: { fontSize: 16 } as any,

  // Track selector — sits between the hero and the card, translucent
  // on both backgrounds.
  trackRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: 4,
    gap: 4,
  } as any,
  trackTab: {
    paddingHorizontal: 18, paddingVertical: 9,
    borderRadius: 999,
  } as any,
  trackTabActiveLight: {
    backgroundColor: t.color["text.primary"],
  } as any,
  trackTabActiveDark: {
    backgroundColor: t.color.accent,
  } as any,
  trackTabText: {
    fontFamily: t.font["body.semibold"], fontSize: 13,
    letterSpacing: 0.3,
  },
  trackTabTextActiveLight: { color: t.color["text.on-dark"] } as any,
  trackTabTextActiveDark: { color: t.color["text.primary"] } as any,

  // Form card. Always cream regardless of outer background so the
  // inputs read the same on both tracks.
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.lg,
    padding: 32,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 6,
  } as any,
  cardCompact: { padding: 24, gap: 12 } as any,

  cardTitle: {
    fontFamily: t.font.display,
    fontSize: 26,
    lineHeight: 32,
    color: t.color["text.primary"],
    marginBottom: 4,
  },
  cardHint: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.muted"],
    lineHeight: 18,
    marginTop: -4, marginBottom: 6,
  },

  input: {
    fontFamily: t.font["body.regular"], fontSize: 14,
    color: t.color["text.primary"],
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,

  errorText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: "#C8553D",
    textAlign: "center",
    marginTop: 2,
  },

  submitBtn: {
    backgroundColor: t.color["text.primary"],
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnLoading: { backgroundColor: t.color["text.muted"] } as any,
  submitText: {
    fontFamily: t.font["body.semibold"], fontSize: 14,
    color: t.color["text.on-dark"],
    letterSpacing: 0.3,
  },
  toggleText: {
    fontFamily: t.font["body.medium"], fontSize: 13,
    color: t.color["text.secondary"],
    textAlign: "center",
    paddingVertical: 6,
  },

  dividerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginTop: 10, marginBottom: 2,
  } as any,
  dividerLine: { flex: 1, height: 1, backgroundColor: t.color["border.light"] } as any,
  dividerText: {
    fontFamily: t.font["body.regular"], fontSize: 11,
    color: t.color["text.muted"], letterSpacing: 0.3,
  },
  socialRow: { flexDirection: "row", gap: 8 } as any,
  socialBtn: {
    flex: 1,
    paddingVertical: 11, paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1, borderColor: t.color["border.light"],
    alignItems: "center",
    backgroundColor: t.color.bg,
  } as any,
  socialBtnText: {
    fontFamily: t.font["body.semibold"], fontSize: 13,
    color: t.color["text.primary"],
  },

  browseText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    textAlign: "center",
    textDecorationLine: "underline",
  } as any,
});
