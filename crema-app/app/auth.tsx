import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Coffee } from "lucide-react-native";
import { useAuth } from "../src/hooks/useAuth";
import { colors, fonts } from "../src/theme/colors";

export default function AuthPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await register(username, displayName || username, password);
      }
      router.replace("/");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Logo */}
        <View style={styles.logoSection}>
          <Coffee size={48} color={colors.accent} />
          <Text style={styles.logoTitle}>Crema</Text>
          <Text style={styles.logoSubtitle}>Indian Specialty Coffee Community</Text>
        </View>

        {/* Form card */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {isLogin ? "Welcome Back" : "Join Crema"}
          </Text>

          <TextInput
            placeholder="Username"
            placeholderTextColor={colors.unavailable}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          {!isLogin && (
            <TextInput
              placeholder="Display Name"
              placeholderTextColor={colors.unavailable}
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
            />
          )}

          <TextInput
            placeholder="Password"
            placeholderTextColor={colors.unavailable}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={[styles.input, { marginBottom: 16 }]}
          />

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={[styles.submitBtn, { backgroundColor: loading ? colors.unavailable : colors.accent }]}
          >
            <Text style={styles.submitText}>
              {loading ? "..." : isLogin ? "Sign In" : "Create Account"}
            </Text>
          </Pressable>

          <Pressable onPress={() => { setIsLogin(!isLogin); setError(""); }}>
            <Text style={styles.toggleText}>
              {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </View>

        {/* Browse link */}
        <Pressable onPress={() => router.push("/browse")} style={{ marginTop: 24 }}>
          <Text style={styles.browseText}>or browse coffees without signing in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    marginTop: 8,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  logoSubtitle: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    marginTop: 6,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  formCard: {
    borderRadius: 20,
    padding: 28,
    backgroundColor: colors.cardFront,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  formTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    marginBottom: 28,
    textAlign: "center",
    color: colors.textPrimary,
  },
  input: {
    fontFamily: fonts.bodyRegular,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
    color: colors.like,
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  submitText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: "white",
    letterSpacing: 0.3,
  },
  toggleText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: "center",
    color: colors.accent,
  },
  browseText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    textAlign: "center",
    color: colors.textMuted,
  },
});
