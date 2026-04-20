/**
 * Cross-platform pub/sub for the handful of "fire this globally"
 * moments in Crema (open post modal, edit profile, auth modal,
 * loader hold).
 *
 * Web: routes through `window` DOM events — same semantics the
 * existing Navbar / dropdown code already relies on.
 * Native: routes through React Native's `DeviceEventEmitter` —
 * `window.addEventListener` doesn't exist on RN's window polyfill,
 * so every previous call site crashed on iOS.
 *
 * API: `emit(name, detail?)` and `listen(name, handler) → unsub`.
 * Detail is the single payload passed through; matches the
 * `(e) => setData(e.detail)` shape on web and the `(detail) => …`
 * shape on native so call sites are identical on both.
 */
import { Platform, DeviceEventEmitter } from "react-native";

export function emit(name: string, detail?: any): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    }
    return;
  }
  DeviceEventEmitter.emit(name, detail);
}

export function listen(
  name: string,
  handler: (detail?: any) => void,
): () => void {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return () => {};
    }
    const wrapper = (e: any) => handler(e?.detail);
    window.addEventListener(name, wrapper);
    return () => window.removeEventListener(name, wrapper);
  }
  const sub = DeviceEventEmitter.addListener(name, handler);
  return () => sub.remove();
}
