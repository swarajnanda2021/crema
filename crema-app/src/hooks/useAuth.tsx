import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiFetch, setToken } from "../api/client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

interface User {
  id: number;
  username: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  location?: string;
  coffee_preference?: string;
  brewing_style?: string;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  backendAvailable: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, displayName: string, password: string) => Promise<User>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem("coffee_session_token")
      : null;
  }
  return SecureStore.getItemAsync("coffee_session_token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/dictionary/brew-methods");
        setBackendAvailable(true);

        const token = await getStoredToken();
        if (token) {
          const me = await apiFetch<User>("/auth/me");
          setUser(me);
        }
      } catch {
        // Backend unreachable or token invalid
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    await setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (username: string, displayName: string, password: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, display_name: displayName, password }),
    });
    await setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    const updated = await apiFetch<User>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(profileData),
    });
    setUser(updated);
    return updated;
  }, []);

  return (
    <AuthContext.Provider value={{ user, backendAvailable, loading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
