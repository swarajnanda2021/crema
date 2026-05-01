/**
 * CRUD Utopia — every visual value comes from design-tokens.json through
 * this file. No hex literals inline, no magic numbers. This is what makes
 * the app portable to Swift/Kotlin: same JSON, different language binding.
 * See CRUD_UTOPIA.md at repo root.
 *
 * Theme-aware token provider.
 *
 * `design-tokens.json` holds two color trees (`light` / `dark`). On boot
 * the active tree defaults to `light`; the ThemeProvider mounts at the
 * root and calls `setMode("dark")` when the system scheme — or a stored
 * user override — wants night mode. The change ripples three ways:
 *
 *   1. The mutable `t` export is reassigned — any inline JSX style that
 *      reads `t.color.X` on render picks up the new value automatically.
 *   2. `useTheme()` (built on `useSyncExternalStore`) re-renders every
 *      subscribed component so step 1 actually fires.
 *   3. `makeStyles(factory)` rebuilds StyleSheet.create blocks against
 *      the new `t` — captures from module load are kept in sync.
 *
 * Usage:
 *   import { t, font, shadow, useTheme, makeStyles } from "../tokens/useTokens";
 *
 *   // Inline (auto-updates if the component re-renders on theme change):
 *   const { t } = useTheme();
 *   <View style={{ backgroundColor: t.color.bg }}>
 *
 *   // Stylesheet form (preferred for any block that captures colors):
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.color.bg, padding: t.spacing.md },
 *   }));
 *   const styles = useStyles();  // re-runs on theme change
 */

import { useSyncExternalStore } from "react";
import { StyleSheet, Appearance, type ViewStyle, type TextStyle, type ImageStyle } from "react-native";
import tokens from "./design-tokens.json";

// Match RN's own NamedStyles<T> so makeStyles factory returns get the
// same narrowing behaviour as a literal StyleSheet.create call —
// without this, properties like `flexDirection: "row"` widen to
// `string` and trip ViewStyle's union types.
type RNNamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export type ThemeMode = "light" | "dark";

// ── Active token snapshot ───────────────────────────────────────────────────
//
// Resolves the per-mode `color` and `shadow` trees down to flat objects so
// the rest of the app can keep reading `t.color.X` / `t.shadow.X.color`
// without caring that the JSON is split.

function snapshotFor(mode: ThemeMode) {
  const colorTree = (tokens.color as any)[mode];
  const shadowTree = Object.fromEntries(
    Object.entries(tokens.shadow as any).map(([k, v]: any) => [k, v[mode]]),
  );
  return {
    ...tokens,
    color: colorTree,
    shadow: shadowTree,
  };
}

const lightSnapshot = snapshotFor("light");
const darkSnapshot = snapshotFor("dark");

// Read the OS scheme synchronously at module load so the first paint of
// every component already uses the right snapshot — without this, a
// dark-mode launch flashes one frame of light tokens before the
// ThemeProvider's effect catches up. The ThemeProvider's SecureStore
// hydration may still flip the mode after first paint if the user has
// chosen a "light" override on a dark OS, but that's a single-frame
// adjustment, not a stale-state bug.
let currentMode: ThemeMode = Appearance.getColorScheme() === "dark" ? "dark" : "light";

/**
 * Mutable export: reassigned on theme change. Inline `t.color.X` reads
 * inside JSX (`style={{ backgroundColor: t.color.bg }}`) pick up the new
 * value because they re-evaluate on each render. StyleSheet.create blocks
 * captured at module load do NOT — use `makeStyles` for those.
 */
// `let` binding so the variable can be reassigned by setMode below. The
// individual property reads are what consumers depend on, not the
// reference identity, so this is safe.
// eslint-disable-next-line prefer-const
export let t = currentMode === "dark" ? darkSnapshot : lightSnapshot;

/**
 * Non-flipping snapshot — always returns the light-mode token values
 * regardless of the active theme. Use this for surfaces that should
 * intentionally NOT participate in dark mode — most notably the
 * CoffeeCard product card (always cream-on-white per the
 * brand-identity rule) and any other "persistently light" surface
 * where dark inversion would harm legibility.
 */
export const tLight = lightSnapshot;

const listeners = new Set<() => void>();
const styleFactories = new Set<() => void>();

/** Switch the active theme. Idempotent — calling with the current mode is a no-op. */
export function setMode(mode: ThemeMode) {
  if (mode === currentMode) return;
  currentMode = mode;
  t = mode === "dark" ? darkSnapshot : lightSnapshot;
  // Rebuild every registered makeStyles factory so existing references
  // (the object returned by useStyles()) point to the new sheet.
  styleFactories.forEach((rebuild) => rebuild());
  // Then notify React so subscribed components actually render.
  listeners.forEach((l) => l());
}

export function getMode(): ThemeMode {
  return currentMode;
}

// ── React hook ──────────────────────────────────────────────────────────────

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getSnapshot = () => currentMode;

/**
 * Subscribe a component to theme changes. Returns the active mode and the
 * matching token snapshot. Components reading `t.color.X` from this hook
 * are guaranteed to re-render on theme change.
 */
export function useTheme(): { mode: ThemeMode; t: typeof lightSnapshot } {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { mode, t: mode === "dark" ? darkSnapshot : lightSnapshot };
}

// ── makeStyles — theme-reactive StyleSheet factory ──────────────────────────

/**
 * Build a StyleSheet whose entries are rebuilt whenever the theme changes.
 *
 * The returned hook keeps the SAME wrapper object identity across renders,
 * but its enumerable keys are reassigned to the IDs of a freshly-created
 * sheet on every theme switch — so consumers can capture `const s = useStyles()`
 * once at the top of a component and pass `s.foo` into any `style={...}`
 * prop without worrying about staleness. (React Native's StyleSheet
 * registry returns numeric IDs that can't be mutated in place, so we rebuild
 * the whole sheet and copy keys over.)
 */
export function makeStyles<T extends RNNamedStyles<T> | RNNamedStyles<any>>(
  factory: (t: typeof lightSnapshot) => T | RNNamedStyles<T>,
): () => T {
  // Hold the sheet in a closure cell. On theme change we rebuild it
  // outright (RN's StyleSheet.create can return a frozen object on some
  // platforms, so mutating in place is unsafe). The hook returns the
  // current cell value, so subscribed components naturally see the new
  // sheet on their next render.
  let sheet: T = StyleSheet.create(factory(t) as T);
  const rebuild = () => {
    sheet = StyleSheet.create(factory(t) as T);
  };
  styleFactories.add(rebuild);
  return function useStyles(): T {
    useTheme();
    return sheet;
  };
}

// ── Convenience helpers ─────────────────────────────────────────────────────

/** Build a font style from token keys. */
export function font(
  family: keyof typeof tokens.font,
  size?: keyof typeof tokens.size,
): { fontFamily: string; fontSize?: number } {
  const result: any = { fontFamily: tokens.font[family] };
  if (size) result.fontSize = tokens.size[size];
  return result;
}

/** Build a shadow style from token key. Reads from the active theme. */
export function shadow(key: keyof typeof tokens.shadow) {
  const s = (t.shadow as any)[key];
  return {
    shadowColor: s.color,
    shadowOffset: { width: s.offset[0], height: s.offset[1] },
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    elevation: s.elevation,
  };
}

/** Get a shelf config by key. */
export function shelfConfig(key: string) {
  return (tokens.shelf as any)[key] || { label: key, color: "#A09580" };
}

/** Shorthand for spacing values. */
export function sp(key: keyof typeof tokens.spacing): number {
  return tokens.spacing[key];
}

/** Shorthand for radius values. */
export function rad(key: keyof typeof tokens.radius): number {
  return tokens.radius[key];
}

/** Shorthand for size values. */
export function sz(key: keyof typeof tokens.size): number {
  return tokens.size[key];
}

export const NAVBAR_HEIGHT = tokens.size["navbar.height"];

// Note: cardShadow / cardShadowHover are evaluated at module load against
// whatever theme is current at first import. Components that rely on the
// shadow updating on theme change should call `shadow("card")` from inside
// a `useTheme()`-subscribed render instead of importing these constants.
export const cardShadow = shadow("card");
export const cardShadowHover = shadow("card.hover");

export const SHELF_LABELS = tokens.shelf;

export type ShelfKey = "open_bags" | "on_the_list";
