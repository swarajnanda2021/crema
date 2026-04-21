/**
 * haptics — thin wrapper around expo-haptics with a web no-op.
 *
 * Use this at every interaction that needs implicit confirmation —
 * swipe commits, active-tab re-taps, destructive confirms, menu-item
 * taps, swipe-to-archive, long-press actions. Web silently returns;
 * native iOS fires the Taptic Engine and Android triggers the
 * vibration pattern.
 *
 * Pick by semantic weight, not by how the interaction looks:
 *   tap()      — a normal button press (light).
 *   select()   — a selection change (a different light style).
 *   commit()   — a successful action past a threshold (medium).
 *   warn()     — a destructive or careful action (warning notification).
 *   error()    — a failed action.
 *
 * Keep this file free of business logic; it's meant to be imported
 * everywhere that needs "give the user a bump".
 */
import { Platform } from "react-native";

// Lazy-require so bundlers don't bark if expo-haptics is ever pulled
// on web — the module is native-only in practice.
let H: any = null;
if (Platform.OS !== "web") {
  try { H = require("expo-haptics"); } catch { H = null; }
}

export function tap(): void {
  if (!H) return;
  H.impactAsync?.(H.ImpactFeedbackStyle.Light);
}

export function select(): void {
  if (!H) return;
  H.selectionAsync?.();
}

export function commit(): void {
  if (!H) return;
  H.impactAsync?.(H.ImpactFeedbackStyle.Medium);
}

export function warn(): void {
  if (!H) return;
  H.notificationAsync?.(H.NotificationFeedbackType.Warning);
}

export function error(): void {
  if (!H) return;
  H.notificationAsync?.(H.NotificationFeedbackType.Error);
}
