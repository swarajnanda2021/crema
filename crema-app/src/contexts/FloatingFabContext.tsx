/**
 * FloatingFabContext — register a floating action button at the
 * root layout level so it anchors to the viewport's stable
 * relative wrapper (not a scroll-aware flex chain that re-layouts
 * on chrome-scroll animation, which produced the jitter described
 * in §2.40.16).
 *
 * The Provider is mounted ONCE at `app/_layout.tsx` inside the
 * relative wrapper, wrapping everything that lives inside it.
 * Deeply-nested components call `useFloatingFab(<jsx>)` to
 * register a FAB; the Provider renders it as a sibling of its
 * children at the wrapper level. Cleanup on unmount returns the
 * slot to empty.
 *
 * Two consumer hooks:
 *   • `useFloatingFab(content)` — write a registration. Last
 *     writer wins (single slot). Pass `null` to clear. Backed by
 *     `useFocusEffect` so the registration is scoped to the
 *     calling component's screen — the FAB clears the moment the
 *     screen blurs (so it doesn't carry over into other routes
 *     when Expo Router's Tabs cache the previous screen) and
 *     re-registers on focus-back.
 *   • `useIsFloatingFabRegistered()` — read whether anything is
 *     currently registered. Used by `ConditionalCreatePostFab` at
 *     root to defer to a deeper-mounted FAB (e.g. the admin
 *     Refresh pill) so the two don't overlap on /profile when the
 *     Catalog Ops Journals sub-tab is active.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useFocusEffect } from "expo-router";

type Setter = (content: ReactNode | null) => void;

const SetterContext = createContext<Setter | null>(null);
const ContentContext = createContext<ReactNode | null>(null);

export function FloatingFabProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  return (
    <SetterContext.Provider value={setContent}>
      <ContentContext.Provider value={content}>
        {children}
        {content}
      </ContentContext.Provider>
    </SetterContext.Provider>
  );
}

/**
 * Register a FAB at the nearest enclosing FloatingFabProvider. The
 * passed JSX renders as a sibling of the provider's children at
 * the wrapper level, so `position: absolute` resolves against the
 * stable relative wrapper. If no provider is found, this is a
 * no-op (the FAB simply doesn't render).
 *
 * Single-slot, last-writer-wins. Pass `null` to clear without
 * unmounting the calling component.
 *
 * Focus-aware: backed by `useFocusEffect` so the registration is
 * scoped to the calling component's screen. When the user
 * navigates away (e.g., from `/profile` → `/browse` via the
 * footer), Expo Router's Tabs cache the previous screen and the
 * deeply-nested ArticlesPanel that registered this FAB stays
 * mounted in the background. Without focus-awareness the FAB
 * would persist across every other route until that screen
 * remounts; `useFocusEffect`'s blur cleanup clears the slot the
 * moment the screen loses focus, then re-runs on focus-back to
 * re-register. (See §2.40.20 for the bug report.)
 */
export function useFloatingFab(content: ReactNode | null) {
  const setContent = useContext(SetterContext);
  useFocusEffect(
    useCallback(() => {
      if (!setContent) return;
      setContent(content);
      return () => setContent(null);
    }, [content, setContent]),
  );
}

/**
 * Read whether a FAB is currently registered. Used by static-route
 * FABs (e.g. ConditionalCreatePostFab on the home feed and own
 * profile) to defer to a deeper-mounted dynamic registration —
 * prevents two pills overlapping at the same screen corner when a
 * sub-tab registers its own FAB.
 */
export function useIsFloatingFabRegistered(): boolean {
  return useContext(ContentContext) !== null;
}
