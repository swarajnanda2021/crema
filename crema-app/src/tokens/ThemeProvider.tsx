/**
 * ThemeProvider — owns the active theme mode and broadcasts it
 * down to the user-toggle UI.
 *
 * Two modes only: "light" and "dark" (§2.40.23 retired the prior
 * three-way System / Light / Dark cycle — the user found "Auto"
 * unnecessary on top of the explicit choices). The active mode is
 * persisted in SecureStore (`crema.theme.override`) and defaults
 * to "light" if nothing is stored.
 *
 * The resolved mode is pushed into the token module via
 * `setMode()` — see useTokens.ts for how that propagates to inline
 * styles and makeStyles factories.
 *
 * Mount once at the top of the layout tree (above any consumer of
 * `useTheme()`).
 */
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { setMode, getMode, ThemeMode } from "./useTokens";

interface ThemeContextValue {
  /** Currently-applied mode. Always "light" or "dark" — there's no
   *  "follow system" option anymore. */
  mode: ThemeMode;
  /** Update the mode and persist it. */
  setMode: (next: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  setMode: () => {},
});

const STORE_KEY = "crema.theme.override";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial state mirrors useTokens' module-load OS detection so the
  // very first paint already matches the device scheme. SecureStore
  // hydration below may flip it once the user's persisted choice
  // loads.
  const [mode, setModeState] = useState<ThemeMode>(() => getMode());

  // Hydrate the persisted mode on mount. SecureStore is async, so
  // there's a brief window where we render in the OS-detected mode
  // before the user's preference loads — acceptable for a
  // one-frame flash if the user has explicitly stored a different
  // mode.
  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") setModeState(v);
      })
      .catch(() => {});
  }, []);

  // Apply the resolved mode whenever it changes.
  useEffect(() => {
    setMode(mode);
  }, [mode]);

  const setModePersisted = useCallback((next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode: setModePersisted }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Read + mutate the user's theme. For toggle UI. */
export function useThemeOverride() {
  return useContext(ThemeContext);
}
