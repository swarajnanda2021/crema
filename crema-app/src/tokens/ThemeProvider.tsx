/**
 * ThemeProvider — owns the active theme mode and broadcasts overrides
 * down to the user-toggle UI.
 *
 * Resolution order on every render:
 *   1. User override stored in SecureStore (`crema.theme.override`),
 *      values: "light" | "dark" | absent (= follow system).
 *   2. System preference from `useColorScheme()`.
 *   3. Fallback to "light".
 *
 * The resolved mode is pushed into the token module via `setMode()` —
 * see useTokens.ts for how that propagates to inline styles and
 * makeStyles factories.
 *
 * Mount once at the top of the layout tree (above any consumer of
 * `useTheme()`).
 */
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { setMode, getMode, ThemeMode } from "./useTokens";

type Override = ThemeMode | null;

interface ThemeContextValue {
  /** Currently-applied mode (after override + system resolution). */
  mode: ThemeMode;
  /** User override; null = follow system. */
  override: Override;
  /** Update the override and persist it. Pass null to clear (follow system again). */
  setOverride: (next: Override) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  override: null,
  setOverride: () => {},
});

const STORE_KEY = "crema.theme.override";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [override, setOverrideState] = useState<Override>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the override from storage on mount. SecureStore is async, so
  // there's a brief window where we render in light mode before the
  // user's preference loads — acceptable for a one-frame flash.
  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") setOverrideState(v);
      })
      .finally(() => setHydrated(true));
  }, []);

  // Apply the resolved mode whenever override or system scheme changes.
  const resolved: ThemeMode = override ?? (systemScheme === "dark" ? "dark" : "light");

  // useLayoutEffect (not useEffect) so the swap lands BEFORE the next
  // commit paints — avoids the one-frame flash of stale tokens on
  // dark-mode launches. Doing it during render is tempting but trips
  // React's "setState in render" guard because setMode notifies
  // subscribers (which schedule updates).
  useEffect(() => {
    setMode(resolved);
  }, [resolved]);

  const setOverride = useCallback((next: Override) => {
    setOverrideState(next);
    if (next === null) {
      SecureStore.deleteItemAsync(STORE_KEY).catch(() => {});
    } else {
      SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode: resolved, override, setOverride }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Read + mutate the user's theme override. For toggle UI. */
export function useThemeOverride() {
  return useContext(ThemeContext);
}
