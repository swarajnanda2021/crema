import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiFetch, apiFetchRaw, setToken } from "../api/client";
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
  favorite_drink?: string;
  favorite_cafe?: string;
  avatar_crop_x?: number;
  avatar_crop_y?: number;
  avatar_zoom?: number;
  account_type?: "user" | "roaster";
  roaster_slug?: string;
  created_at: string;
}

export interface SavedAccount {
  username: string;
  display_name: string;
  avatar_url: string | null;
  token: string;
}

interface AuthContextValue {
  user: User | null;
  backendAvailable: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, displayName: string, password: string) => Promise<User>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<User>;
  switchAccount: (token: string) => Promise<User>;
  getSavedAccounts: () => SavedAccount[];
  removeSavedAccount: (username: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCOUNTS_KEY = "coffee_saved_accounts";

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem("coffee_session_token")
      : null;
  }
  return SecureStore.getItemAsync("coffee_session_token");
}

// ── Multi-account helpers (web localStorage) ─────────────────────────────────

function readSavedAccounts(): SavedAccount[] {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeSavedAccounts(accounts: SavedAccount[]) {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return;
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function upsertAccount(user: User, token: string) {
  const accounts = readSavedAccounts();
  const entry: SavedAccount = {
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url || null,
    token,
  };
  const idx = accounts.findIndex((a) => a.username === user.username);
  if (idx >= 0) accounts[idx] = entry;
  else accounts.push(entry);
  writeSavedAccounts(accounts);
}

function removeAccount(username: string) {
  const accounts = readSavedAccounts().filter((a) => a.username !== username);
  writeSavedAccounts(accounts);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await apiFetchRaw("/dictionary/brew-methods");
        setBackendAvailable(true);

        const token = await getStoredToken();
        if (token) {
          const meRes = await apiFetchRaw<any>("/auth/me");
          const me = meRes?.data ?? meRes;
          setUser(me);
          upsertAccount(me, token);
        }
      } catch {
        // Backend unreachable or token invalid
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const raw = await apiFetchRaw<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const res = raw?.data ?? raw;
    await setToken(res.token);
    setUser(res.user);
    upsertAccount(res.user, res.token);
    return res.user;
  }, []);

  const register = useCallback(async (username: string, displayName: string, password: string) => {
    const raw = await apiFetchRaw<any>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, display_name: displayName, password }),
    });
    const res = raw?.data ?? raw;
    await setToken(res.token);
    setUser(res.user);
    upsertAccount(res.user, res.token);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    const username = user?.username;
    await setToken(null);
    setUser(null);
    if (username) removeAccount(username);
  }, [user]);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    const raw = await apiFetchRaw<any>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(profileData),
    });
    const updated = raw?.data ?? raw;
    setUser(updated);
    // Update saved account entry with new display name / avatar
    const token = await getStoredToken();
    if (token) upsertAccount(updated, token);
    return updated;
  }, []);

  const switchAccount = useCallback(async (token: string) => {
    await setToken(token);
    const meRes = await apiFetchRaw<any>("/auth/me");
    const me = meRes?.data ?? meRes;
    setUser(me);
    upsertAccount(me, token);
    return me;
  }, []);

  const getSavedAccounts = useCallback((): SavedAccount[] => {
    return readSavedAccounts();
  }, []);

  const removeSavedAccount = useCallback((username: string) => {
    removeAccount(username);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, backendAvailable, loading,
      login, register, logout, updateProfile,
      switchAccount, getSavedAccounts, removeSavedAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
