/**
 * RoasterProfilesProvider — sitewide cache for `roaster_profiles`.
 *
 * Why this exists. Before this, `roaster_profiles` was fetched
 * separately by every component that needed it: Discover ROASTERS
 * sub-tab via `useResource("roaster_profiles", { limit: 500 })`,
 * the consumer roaster page via a per-slug `/roaster_profiles/{slug}`,
 * the admin Catalog Ops via `useResource(...)` again. Each component
 * paid the network round-trip on its own first mount. The user
 * could already see a roaster's logo on Discover (because that page
 * fetched the list), but tapping into the roaster page started a
 * fresh fetch — the logo URL wasn't known until the response came
 * back, so the image couldn't even start loading until then.
 *
 * The fix is the same pattern as `CoffeeDataProvider`. One fetch
 * lives at the root of the app; every consumer reads from context.
 * Tapping a roaster on Discover now hydrates the page synchronously
 * from cache — the logo URL is known on the first render and
 * `expo-image` immediately hits its disk cache (it already
 * preloaded the image when Discover painted the row), so the logo
 * paints in the same frame as the rest of the page.
 *
 * `getBySlug(slug)` is the cache lookup. `upsert(profile)` lets the
 * roaster page write a freshly-fetched (silent revalidation or
 * post-edit) profile back into the cache so other tabs see the
 * latest data without a round-trip. `refetch({ silent })` follows
 * the stale-while-revalidate pattern shipped on `useCoffeeData` —
 * focus effects can refresh in the background without flashing the
 * page back through a loading state.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { apiFetchRaw } from "../api/client";

type RoasterProfileRow = {
  roaster_slug?: string;
  name?: string;
  city?: string;
  website?: string;
  logo_url?: string;
  hero_image_url?: string;
  about_blurb?: string;
  specialties?: any;
  published?: number;
  [key: string]: any;
};

type RoasterProfilesCtx = {
  profiles: RoasterProfileRow[];
  loading: boolean;
  refetch: (opts?: { silent?: boolean }) => Promise<void>;
  getBySlug: (slug: string | undefined | null) => RoasterProfileRow | null;
  upsert: (profile: RoasterProfileRow) => void;
};

const RoasterProfilesContext = createContext<RoasterProfilesCtx | null>(null);

export function RoasterProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<RoasterProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef(false);

  const refetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasFetchedRef.current;
      if (!silent) setLoading(true);
      try {
        const res: any = await apiFetchRaw("/roaster_profiles?limit=500");
        const data = res?.data ?? res;
        setProfiles(Array.isArray(data) ? data : []);
        hasFetchedRef.current = true;
      } catch {
        // Silent failures keep the existing cache so a flaky
        // background refresh doesn't kick the user back to an empty
        // state. The loud first fetch leaves an empty array on
        // failure (consumers already handle that path).
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const bySlug = useMemo(() => {
    const map = new Map<string, RoasterProfileRow>();
    for (const p of profiles) {
      if (p.roaster_slug) map.set(p.roaster_slug, p);
    }
    return map;
  }, [profiles]);

  const getBySlug = useCallback(
    (slug: string | undefined | null): RoasterProfileRow | null => {
      if (!slug) return null;
      return bySlug.get(slug) || null;
    },
    [bySlug],
  );

  const upsert = useCallback((profile: RoasterProfileRow) => {
    if (!profile?.roaster_slug) return;
    setProfiles((prev) => {
      const idx = prev.findIndex((p) => p.roaster_slug === profile.roaster_slug);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = profile;
        return next;
      }
      return [...prev, profile];
    });
  }, []);

  const value = useMemo<RoasterProfilesCtx>(
    () => ({ profiles, loading, refetch, getBySlug, upsert }),
    [profiles, loading, refetch, getBySlug, upsert],
  );

  return (
    <RoasterProfilesContext.Provider value={value}>
      {children}
    </RoasterProfilesContext.Provider>
  );
}

export function useRoasterProfiles(): RoasterProfilesCtx {
  const ctx = useContext(RoasterProfilesContext);
  if (!ctx) {
    throw new Error(
      "useRoasterProfiles must be used inside <RoasterProfilesProvider>",
    );
  }
  return ctx;
}
