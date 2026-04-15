/**
 * CRUD Utopia — floating auth modal. Opened from the profile dropdown's
 * "Add another account" item. Lets the user log into (or register) a
 * second account without leaving the current page; on success the
 * useAuth provider's upsertAccount enforces one-of-each type
 * (user/roaster/café) by evicting any existing saved account of the
 * same type.
 *
 * Uses the same overlayWrap + backdrop-blur language as PostModal.
 * Opens via window event: `crema:open-auth-modal` — dispatched from
 * ProfileDropdown's "Add another account" handler.
 */

import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { X } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";

export default function AuthModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const handler = () => setVisible(true);
    window.addEventListener("crema:open-auth-modal", handler);
    return () => window.removeEventListener("crema:open-auth-modal", handler);
  }, []);

  if (!visible) return null;
  return (
    <AuthModalContent visible={visible} onClose={() => setVisible(false)} />
  );
}

function AuthModalContent({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setIsLogin(true);
    setUsername(""); setDisplayName(""); setPassword("");
    setError(""); setLoading(false);
  };

  const close = () => { reset(); onClose(); };

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      if (isLogin) await login(username, password);
      else await register(username, displayName || username, password);
      close();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={close} />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>
              {isLogin ? "Add another account" : "Create a new account"}
            </Text>
            <Pressable onPress={close} hitSlop={8}>
              <X size={20} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          <View style={s.body}>
            <Text style={s.hint}>
              Only one user, one roaster, and one café account stay signed
              in at a time. Adding a new account of the same type replaces
              the previous one.
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
                placeholder="Display Name"
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

            <Pressable onPress={() => setIsLogin((v) => !v)}>
              <Text style={s.toggle}>
                {isLogin ? "Don't have an account? Create one" : "Already have one? Sign in"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any)
      : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  card: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 420,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    flex: 1,
    paddingRight: t.spacing.md,
  },
  body: {
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.xl,
    gap: t.spacing.md,
  },
  hint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  },
  input: {
    backgroundColor: t.color["card.info"],
    borderRadius: t.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    outlineStyle: "none" as any,
  } as any,
  submit: {
    backgroundColor: t.color.accent,
    borderRadius: t.radius.sm,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: t.spacing.xs,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  toggle: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing.xs,
  },
  error: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
  },
});
