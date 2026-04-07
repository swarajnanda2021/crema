import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Coffee } from "lucide-react-native";
import { useAuth } from "../src/hooks/useAuth";
import { colors } from "../src/theme/colors";

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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
        {/* Logo */}
        <View className="items-center mb-8">
          <Coffee size={48} color={colors.accent} />
          <Text className="text-3xl font-bold mt-2" style={{ color: colors.textPrimary }}>
            Crema
          </Text>
          <Text className="text-sm mt-1" style={{ color: colors.textSecondary }}>
            Indian Specialty Coffee Community
          </Text>
        </View>

        {/* Form card */}
        <View className="rounded-2xl p-6" style={{ backgroundColor: colors.cardFront, shadowColor: "#2C1810", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 }}>
          <Text className="text-xl font-bold mb-6 text-center" style={{ color: colors.textPrimary }}>
            {isLogin ? "Welcome Back" : "Join Crema"}
          </Text>

          <TextInput
            placeholder="Username"
            placeholderTextColor={colors.unavailable}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-xl px-4 py-3 text-base mb-3"
            style={{ backgroundColor: colors.bg, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border }}
          />

          {!isLogin && (
            <TextInput
              placeholder="Display Name"
              placeholderTextColor={colors.unavailable}
              value={displayName}
              onChangeText={setDisplayName}
              className="rounded-xl px-4 py-3 text-base mb-3"
              style={{ backgroundColor: colors.bg, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border }}
            />
          )}

          <TextInput
            placeholder="Password"
            placeholderTextColor={colors.unavailable}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            className="rounded-xl px-4 py-3 text-base mb-4"
            style={{ backgroundColor: colors.bg, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border }}
          />

          {error ? (
            <Text className="text-sm mb-3 text-center" style={{ color: colors.like }}>{error}</Text>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            className="rounded-xl py-3.5 items-center mb-4"
            style={{ backgroundColor: loading ? colors.unavailable : colors.accent }}
          >
            <Text className="text-base font-semibold" style={{ color: "white" }}>
              {loading ? "..." : isLogin ? "Sign In" : "Create Account"}
            </Text>
          </Pressable>

          <Pressable onPress={() => { setIsLogin(!isLogin); setError(""); }}>
            <Text className="text-sm text-center" style={{ color: colors.accent }}>
              {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </View>

        {/* Browse link */}
        <Pressable onPress={() => router.push("/browse")} className="mt-6">
          <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
            or browse coffees without signing in
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
