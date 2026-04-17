import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiFetchRaw, setToken } from "../api/client";
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
  favorite_cafe_slug?: string | null;
  avatar_crop_x?: number;
  avatar_crop_y?: number;
  avatar_zoom?: number;
  account_type?: "user" | "roaster" | "cafe";
  roaster_slug?: string;
  cafe_slug?: string;
  created_at: string;
}

export interface SavedAccount {
  username: string;
  display_name: string;
  avatar_url: string | null;
  account_type?: "user" | "roaster" | "cafe";
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
  // Enforce one account per type — replace any existing saved account
  // with the same account_type (except the current user row we're about
  // to insert/overwrite). Keeps the saved pool at most one user + one
  // roaster + one café at any moment.
  const type = user.account_type || "user";
  const accounts = readSavedAccounts().filter((a) => {
    if (a.username === user.username) return false; // will re-insert
    return (a.account_type || "user") !== type;
  });
  const entry: SavedAccount = {
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url || null,
    account_type: type,
    token,
  };
  accounts.push(entry);
  writeSavedAccounts(accounts);
}

function removeAccount(username: string) {
  const accounts = readSavedAccounts().filter((a) => a.username !== username);
  writeSavedAccounts(accounts);
}

/** Where to land a user after a hard-reload switch. Roasters and cafés
 * go to their entity profile so the owner affordances (edit banner,
 * menu controls, scan button) light up immediately; regular users
 * land on their own profile tab (`/profile`) rather than the feed so
 * the "who am I now?" question is answered visually the moment the
 * switch completes. */
function entityHomeFor(user: User): string {
  if (user.account_type === "roaster" && user.roaster_slug) {
    return `/roaster/${user.roaster_slug}`;
  }
  if (user.account_type === "cafe" && user.cafe_slug) {
    return `/cafe/${user.cafe_slug}`;
  }
  return "/profile";
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
    // Hard-reload web so the app mounts fresh under the new identity
    // (matches switchAccount). Native keeps the old router.replace path.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign(entityHomeFor(res.user));
    }
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
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign(entityHomeFor(res.user));
    }
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    const username = user?.username;
    // Drop the current session first so any follow-up fetch uses
    // the next account's token.
    await setToken(null);
    setUser(null);
    if (username) removeAccount(username);

    // If the user still has other saved accounts on the device,
    // slip into the next one instead of bouncing to /auth. That
    // matches the mental model of Gmail / Twitter account
    // switching — "sign out" really means "drop this identity" not
    // "log me out of everything". The next-account pick order:
    //   1. user  2. roaster  3. café
    // which is the order people tend to think of them in.
    const remaining = readSavedAccounts();
    const typePriority: Record<string, number> = { user: 0, roaster: 1, cafe: 2 };
    const next = remaining
      .slice()
      .sort((a, b) => (typePriority[a.account_type || "user"] ?? 9)
        - (typePriority[b.account_type || "user"] ?? 9))[0];

    if (next && Platform.OS === "web" && typeof window !== "undefined") {
      // Slip into the next saved account. Write the token first so
      // the follow-up /auth/me carries the right session, then call
      // it to pull the full user row (we need slug fields the saved
      // entry doesn't carry). Hard-reload at the entity home so the
      // new identity mounts cleanly.
      await setToken(next.token);
      try {
        const meRes = await apiFetchRaw<any>("/auth/me");
        const me = meRes?.data ?? meRes;
        upsertAccount(me, next.token);
        window.location.assign(entityHomeFor(me));
        return;
      } catch {
        // Token expired — fall through to the default logout path
        // after wiping the stale saved entry.
        removeAccount(next.username);
        await setToken(null);
      }
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      // No other accounts — fresh reload drops any in-memory state
      // bound to the old session token and lands at the auth screen
      // via AuthGate's unauthenticated redirect.
      window.location.assign("/");
    }
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
    // Hard navigate on web so every hook / component remounts with the
    // new identity. Cached data (feed, caf\u00e9 / roaster pages, owner
    // affordances, navbar avatar) all re-read from the new session
    // token without any bespoke invalidation.
    // On native, callers are expected to router.replace to the home
    // tab — the provider state change is enough since there's no
    // persistent URL state to blow away.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const target = entityHomeFor(me);
      window.location.assign(target);
    }
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
