/**
 * Platform-abstracted API client for Crema.
 *
 * Replaces the web-only api.js that used window.location.hostname + localStorage.
 * Uses expo-secure-store on native, localStorage on web.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// ── Base URL ────────────────────────────────────────────────────
// Override with EXPO_PUBLIC_API_URL env var for production / physical devices.
function getBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  if (Platform.OS === "web") {
    // Web: same host as the page, port 8000
    if (typeof window !== "undefined") {
      return `http://${window.location.hostname}:8000/api`;
    }
    return "http://localhost:8000/api";
  }
  if (Platform.OS === "android") {
    // Android emulator: 10.0.2.2 maps to host machine's localhost
    return "http://10.0.2.2:8000/api";
  }
  // iOS simulator: localhost works directly
  return "http://localhost:8000/api";
}

const BASE_URL = getBaseUrl();

// ── Token Storage ───────────────────────────────────────────────
const TOKEN_KEY = "coffee_session_token";

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
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
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

// ── API Fetch ───────────────────────────────────────────────────
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  const json = await res.json();
  // Auto-unwrap CRUD Utopia envelope: { data, meta } → data
  // Old endpoints return bare objects/arrays, new ones wrap in envelope.
  // This makes all existing code compatible with both.
  if (json && typeof json === "object" && "data" in json && "meta" in json) {
    return json.data;
  }
  return json;
}

/** Fetch without auto-unwrapping — returns full { data, meta } envelope.
 *  Used by useResource which needs meta for pagination totals. */
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
  apiFetch("/clicks", {
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
