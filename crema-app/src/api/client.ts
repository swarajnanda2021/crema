/**
 * CRUD Utopia — apiFetchRaw is the only way to talk to the backend.
 * Every call site unwraps responses with `res?.data ?? res`. useResource
 * wraps this for CRUD; use apiFetchRaw directly for composite endpoints.
 * See CRUD_UTOPIA.md at repo root.
 *
 * Platform-abstracted API client for Crema.
 *
 * Replaces the web-only api.js that used window.location.hostname + localStorage.
 * Uses expo-secure-store on native, localStorage on web.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

// ── Base URL ────────────────────────────────────────────────────
// Override with EXPO_PUBLIC_API_URL env var for production.
// On physical devices via Expo Go we auto-resolve to the dev machine's
// LAN IP from Expo's debuggerHost — localhost is the phone itself.
function getBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      return `http://${window.location.hostname}:8000/api`;
    }
    return "http://localhost:8000/api";
  }

  // Native: pull LAN IP from the Expo dev server. Works for Expo Go on
  // a physical iPhone / Android over the same wifi. Falls back to
  // simulator defaults if hostUri isn't present (e.g. standalone build).
  const hostUri =
    (Constants.expoGoConfig as any)?.debuggerHost ??
    (Constants.expoConfig as any)?.hostUri ??
    (Constants as any).manifest?.debuggerHost ??
    (Constants as any).manifest?.hostUri;
  const hostIp = typeof hostUri === "string" ? hostUri.split(":")[0] : null;
  if (hostIp) return `http://${hostIp}:8000/api`;

  if (Platform.OS === "android") {
    return "http://10.0.2.2:8000/api";
  }
  return "http://localhost:8000/api";
}

const BASE_URL = getBaseUrl();

// ── Token Storage ───────────────────────────────────────────────
const TOKEN_KEY = "coffee_session_token";

// AFTER_FIRST_UNLOCK lets the keychain item be read in more app states
// than the default WHEN_UNLOCKED — avoids "User interaction is not
// allowed" failures when Expo Go backgrounds / resumes or when the app
// cold-starts before the OS has fully transitioned out of a lock state.
const KEYCHAIN_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : null;
  }
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY, KEYCHAIN_OPTS);
  } catch {
    // Keychain temporarily unavailable (device locked, app state
    // transition). Treat as "no token" rather than crash — the user
    // can re-auth if needed.
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    }
    return;
  }
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token, KEYCHAIN_OPTS);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY, KEYCHAIN_OPTS);
  }
}

// ── API Fetch ───────────────────────────────────────────────────
export async function apiFetchRaw<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Open a streaming request and hand the raw Response back to the
 * caller. Used by the SSE-driven Sonnet roaster enricher so the admin
 * page can read `response.body.getReader()` directly. Same auth
 * plumbing as `apiFetchRaw`; caller is responsible for consuming /
 * disposing the stream.
 *
 * Throws on non-2xx (drains the body for the error message). On 2xx
 * it returns the live Response; the caller should check
 * `response.body` before reading.
 */
export async function apiStream(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res;
}

/** Upload a file (e.g. avatar). Uses FormData — no JSON content-type. */
export async function apiUpload<T = any>(
  path: string,
  formData: FormData
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload ${res.status}: ${text}`);
  }
  return res.json();
}

/** Fire-and-forget click tracking. */
export function trackClick(
  productId: string,
  roasterSlug: string,
  sourcePage: string
): void {
  apiFetchRaw("/clicks", {
    method: "POST",
    body: JSON.stringify({
      product_id: productId,
      roaster_slug: roasterSlug,
      source_page: sourcePage,
    }),
  }).catch(() => {});
}

/**
 * Resolve an upload path (e.g. "/uploads/avatar.jpg") to a full URL on the API server.
 * Returns absolute URLs (http://, https://) unchanged.
 * Returns null/undefined unchanged.
 */
export function resolveUploadUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // Strip the /api suffix to get the server origin
  const origin = BASE_URL.replace(/\/api$/, "");
  return `${origin}${path}`;
}

export { BASE_URL };
