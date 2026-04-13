import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../src/hooks/useAuth";
import { colors, fonts } from "../src/tokens/useTokens";
import CremaLogo from "../src/components/CremaLogo";

export default function AuthPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ addAccount?: string }>();
  const isAddingAccount = params.addAccount === "1";
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
        {/* Logo — dark brown header strip */}
        <View style={styles.logoSection}>
          <CremaLogo width={180} height={37} />
          <Text style={styles.logoSubtitle}>Indian Specialty Coffee Community</Text>
        </View>

        {/* Form card */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {isAddingAccount
              ? (isLogin ? "Add Existing Account" : "Create New Account")
              : (isLogin ? "Welcome Back" : "Join Crema")}
          </Text>
          {isAddingAccount && (
            <Text style={styles.addAccountHint}>
              Sign in to another account. You can switch between accounts from the profile menu.
            </Text>
          )}

          <TextInput
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          {!isLogin && (
            <TextInput
              placeholder="Display Name"
              placeholderTextColor={colors.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
            />
          )}

          <TextInput
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
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
            style={[styles.submitBtn, { backgroundColor: loading ? colors.textMuted : colors.textPrimary }]}
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
    backgroundColor: colors.navbarBg,
    marginHorizontal: -24,
    marginTop: -24,
    paddingTop: 64,
    paddingBottom: 40,
    marginBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logoSubtitle: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    marginTop: 12,
    color: colors.textOnDark,
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  formCard: {
    borderRadius: 16,
    padding: 28,
    backgroundColor: colors.cardFront,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  formTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 22,
    marginBottom: 28,
    textAlign: "center",
    color: colors.textPrimary,
  },
  addAccountHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: -20,
    marginBottom: 20,
    lineHeight: 18,
  },
  input: {
    fontFamily: fonts.bodyRegular,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    marginBottom: 12,
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  errorText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
    color: "#C8553D",
  },
  submitBtn: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  submitText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "white",
    letterSpacing: 0.3,
  },
  toggleText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: "center",
    color: colors.textSecondary,
  },
  browseText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    textAlign: "center",
    color: colors.textMuted,
  },
});
