import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiFetchRaw, setToken } from "../api/client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { router } from "expo-router";
import { emit } from "../utils/events";

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
  /** `expectedIsBusiness` is the UI track the user is signing in
   *  through — "For you" passes false, "For business" passes true.
   *  If the returned account's type doesn't match the track, the
   *  call throws BEFORE any session state is mutated (no token,
   *  no saved-account swap), so an accidental cross-track login
   *  can't evict the other account from the saved pool. */
  login: (username: string, password: string, expectedIsBusiness?: boolean) => Promise<User>;
  register: (username: string, displayName: string, password: string, expectedIsBusiness?: boolean) => Promise<User>;
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

// ── Multi-account helpers (web localStorage + native SecureStore) ───────────

// In-memory cache — keeps reads synchronous on both platforms. On
// native, app boot hydrates this from SecureStore; on web, it's
// hydrated lazily by the first `readSavedAccounts` call.
let _savedCache: SavedAccount[] | null = null;
let _hydrationPromise: Promise<void> | null = null;

/** Hydrate the in-memory cache from persistent storage. Web is sync
 *  (reads localStorage directly); native awaits SecureStore. Safe to
 *  call repeatedly — only the first call hits storage. */
async function hydrateSavedAccounts(): Promise<void> {
  if (_savedCache !== null) return;
  if (_hydrationPromise) return _hydrationPromise;
  _hydrationPromise = (async () => {
    try {
      if (Platform.OS === "web") {
        if (typeof localStorage !== "undefined") {
          const raw = localStorage.getItem(ACCOUNTS_KEY);
          _savedCache = raw ? JSON.parse(raw) : [];
        } else {
          _savedCache = [];
        }
      } else {
        // SecureStore items cap at ~2 KB on iOS. A JSON blob of up to
        // ~3 accounts (~1.2 KB) fits comfortably — one user, one
        // roaster, one café + their tokens.
        const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
        _savedCache = raw ? JSON.parse(raw) : [];
      }
    } catch {
      _savedCache = [];
    } finally {
      _hydrationPromise = null;
    }
  })();
  return _hydrationPromise;
}

function readSavedAccounts(): SavedAccount[] {
  // Lazy-hydrate on web (sync access to localStorage). On native the
  // cache is expected to be primed by AuthProvider's boot effect —
  // until that resolves we return an empty list.
  if (_savedCache === null) {
    if (Platform.OS === "web") {
      hydrateSavedAccounts();
    } else {
      // Kick off the hydrate; won't help this call but primes future
      // reads. Safe to fire-and-forget.
      void hydrateSavedAccounts();
      return [];
    }
  }
  return _savedCache ?? [];
}

function writeSavedAccounts(accounts: SavedAccount[]) {
  _savedCache = accounts;
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }
    return;
  }
  // Native: fire-and-forget. The in-memory cache is authoritative
  // for the current session; SecureStore just makes it survive a
  // restart. Failures here are logged but don't surface to the user.
  SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts)).catch(
    (e) => console.warn("Failed to persist saved accounts:", e?.message),
  );
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

/** Reject an auth call whose account type doesn't match the
 *  user-facing track (For you / For business). Throws BEFORE any
 *  session state mutates so a cross-track login can't evict the
 *  currently-saved account of the other type. */
function assertTrackMatch(user: User, expectedIsBusiness?: boolean) {
  if (expectedIsBusiness === undefined) return;
  const type = user.account_type || "user";
  const userIsBusiness = type === "roaster" || type === "cafe";
  if (userIsBusiness === expectedIsBusiness) return;
  if (expectedIsBusiness) {
    throw new Error(
      "This is a consumer account. Switch to 'For you' to sign in.",
    );
  }
  throw new Error(
    `This is a ${type} (business) account. Switch to 'For business' to sign in.`,
  );
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
        // Prime the saved-accounts cache FIRST. On native this
        // reads SecureStore async; without it, `readSavedAccounts`
        // returns [] on every sync call and multi-account switching
        // silently breaks.
        await hydrateSavedAccounts();

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

  const login = useCallback(async (username: string, password: string, expectedIsBusiness?: boolean) => {
    const raw = await apiFetchRaw<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const res = raw?.data ?? raw;
    // Track guard — reject a mismatch BEFORE any session state
    // mutates. Otherwise a roaster signing in via "For you" would
    // evict the currently-saved user account before we realized it
    // was the wrong track.
    assertTrackMatch(res.user, expectedIsBusiness);
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

  const register = useCallback(async (username: string, displayName: string, password: string, expectedIsBusiness?: boolean) => {
    const raw = await apiFetchRaw<any>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, display_name: displayName, password }),
    });
    const res = raw?.data ?? raw;
    assertTrackMatch(res.user, expectedIsBusiness);
    await setToken(res.token);
    setUser(res.user);
    upsertAccount(res.user, res.token);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign(entityHomeFor(res.user));
    }
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    // Raise the sitewide loader curtain BEFORE any async work so
    // the old profile page doesn't re-render with stale state
    // (null user / wrong account) while we swap tokens and fetch
    // the next identity. No matching "loading-end" is fired — the
    // window.location.assign hard-reload takes over, and the new
    // page's NavigationLoader holds the curtain until authLoading
    // settles there.
    emit("crema:loading-start");

    const username = user?.username;
    // If there's a next saved account on the device, slip into it
    // instead of bouncing to /auth. Matches the mental model of
    // Gmail / Twitter account switching — "sign out" really means
    // "drop this identity" not "log me out of everything".
    //
    // Critical ordering fix: do NOT call setUser(null) or
    // setToken(null) before we've decided whether a next account
    // exists. The intermediate `user === null` render would make
    // AuthGate fire `router.replace("/auth")` before our
    // `window.location.assign(entityHomeFor(next))` kicks in,
    // producing a visible flicker through the auth screen. We swap
    // the session token + fetch the next user FIRST, then hard-
    // navigate, letting the full page reload flush the old state.
    //
    // Next-account pick order: user → roaster → café (the order
    // people think of them in).
    const remaining = username
      ? readSavedAccounts().filter((a) => a.username !== username)
      : readSavedAccounts();
    const typePriority: Record<string, number> = { user: 0, roaster: 1, cafe: 2 };
    const next = remaining
      .slice()
      .sort((a, b) => (typePriority[a.account_type || "user"] ?? 9)
        - (typePriority[b.account_type || "user"] ?? 9))[0];

    if (next) {
      await setToken(next.token);
      try {
        const meRes = await apiFetchRaw<any>("/auth/me");
        const me = meRes?.data ?? meRes;
        upsertAccount(me, next.token);
        if (username) removeAccount(username);
        if (Platform.OS === "web" && typeof window !== "undefined") {
          // Hard-navigate. Page reload replaces React state entirely
          // so we don't need setUser() / setToken() cleanup here.
          window.location.assign(entityHomeFor(me));
        } else {
          // Native: push the provider state + route to the new
          // identity's entity home. Without the router.replace we
          // would linger on the previous account's page; without
          // the `loading-end` the NavigationLoader curtain would
          // stay up forever.
          setUser(me);
          router.replace(entityHomeFor(me) as any);
          emit("crema:loading-end");
        }
        return;
      } catch {
        // Stale next-account token — wipe it and fall through to
        // the default sign-out-to-auth path.
        removeAccount(next.username);
      }
    }

    // No next account (or the next token was stale) — drop the
    // current session cleanly. Web hard-reloads into "/" which
    // AuthGate redirects to /auth; native router.replaces directly
    // and the provider state drop ensures the feed doesn't flash
    // on the way out.
    await setToken(null);
    setUser(null);
    if (username) removeAccount(username);

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign("/");
    } else {
      router.replace("/auth");
      emit("crema:loading-end");
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
    // Same curtain-first pattern as logout() — paint the sitewide
    // loader before any async work so the current page can't
    // briefly render with the incoming account's token but the
    // outgoing account's props.
    emit("crema:loading-start");
    try {
      await setToken(token);
      const meRes = await apiFetchRaw<any>("/auth/me");
      const me = meRes?.data ?? meRes;
      setUser(me);
      upsertAccount(me, token);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        // Hard navigate on web so every hook / component remounts
        // under the new identity. The post-reload NavigationLoader
        // restarts from scratch; no matching `loading-end` needed.
        window.location.assign(entityHomeFor(me));
      } else {
        // Native: push the user to the new identity's entity home
        // (profile / roaster / café). Without this we'd stay on
        // the previous account's page. Then emit `loading-end` so
        // the NavigationLoader curtain hides — previously this was
        // missing and the curtain hung indefinitely.
        router.replace(entityHomeFor(me) as any);
        emit("crema:loading-end");
      }
      return me;
    } catch (e) {
      // Never let an exception leave the loader curtain stuck up.
      emit("crema:loading-end");
      throw e;
    }
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
