/**
 * RoasterArticlesProvider — sitewide cache for `roaster_articles`.
 *
 * Same shape as RoasterProfilesProvider. One fetch lives at the
 * root of the app; every consumer reads from context.
 *
 * Why this exists. The Discover JOURNAL feed and the article
 * reader screen both render the same row data. If each fetched
 * independently, tapping a card on JOURNAL would briefly show an
 * empty reader while the per-id fetch landed. With the shared
 * cache, the reader hydrates synchronously from the list payload
 * (every field except `body_html`), then silent-revalidates the
 * full row (including body_html) so the reader paints with hero
 * + title + meta in the same frame as the navigation, and the
 * body slots in a tick later when the longer payload arrives.
 *
 * `getById(id)` returns the cached row; `upsert(article)` merges
 * a freshly-fetched row (typically the full reader payload with
 * body_html) back into the cache so other readers see it without
 * a round-trip. `refetch({ silent })` follows the SWR pattern
 * shipped on `useCoffeeData` and `useRoasterProfiles`.
 *
 * The list endpoint excludes body_html (heavy payload — keeping
 * it out of the chronological feed shrinks the per-row cost);
 * the reader's own /articles/{id} fetch is the only path that
 * brings body_html into the cache.
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
import { Image } from "expo-image";
import { apiFetchRaw } from "../api/client";
import { thumbnailUrl } from "../utils/imageUrl";
import type { RoasterArticle } from "../resources/types";

type RoasterArticlesCtx = {
  articles: RoasterArticle[];
  loading: boolean;
  refetch: (opts?: { silent?: boolean }) => Promise<void>;
  getById: (id: number | string | null | undefined) => RoasterArticle | null;
  getByRoasterSlug: (slug: string | null | undefined) => RoasterArticle[];
  upsert: (article: RoasterArticle) => void;
};

const RoasterArticlesContext = createContext<RoasterArticlesCtx | null>(null);

export function RoasterArticlesProvider({ children }: { children: ReactNode }) {
  const [articles, setArticles] = useState<RoasterArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef(false);

  const refetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasFetchedRef.current;
      if (!silent) setLoading(true);
      try {
        // Pull the full list — admin curation keeps this from
        // growing unbounded (every roaster averages 5-30 articles
        // and the consumer view filters out unpublished). The
        // backend caps `limit` at 500.
        const res: any = await apiFetchRaw("/articles?limit=500");
        const data = res?.data ?? res;
        const list: RoasterArticle[] = Array.isArray(data) ? data : [];
        setArticles(list);
        hasFetchedRef.current = true;

        // Warm the disk cache for hero images so JOURNAL paints
        // instantly on the next focus and the reader screen
        // doesn't need to wait for the network. Same pattern as
        // useNotifications.fetchNotifications.
        const heroes = list
          .map((a) => a.image_url)
          .filter((u): u is string => !!u)
          .map((u) => thumbnailUrl(u, 800) || u);
        // expo-image's prefetch is a no-op when the URL is
        // already cached; fire-and-forget is fine.
        for (const url of heroes.slice(0, 50)) {
          Image.prefetch(url).catch(() => {});
        }
      } catch {
        // Silent failure preserves the cache. The first fetch
        // leaves articles empty if it fails (consumers handle
        // that path with the canonical empty state).
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const byId = useMemo(() => {
    const map = new Map<number, RoasterArticle>();
    for (const a of articles) {
      if (a?.id != null) map.set(Number(a.id), a);
    }
    return map;
  }, [articles]);

  const getById = useCallback(
    (id: number | string | null | undefined): RoasterArticle | null => {
      if (id == null || id === "") return null;
      return byId.get(Number(id)) || null;
    },
    [byId],
  );

  const getByRoasterSlug = useCallback(
    (slug: string | null | undefined): RoasterArticle[] => {
      if (!slug) return [];
      return articles.filter((a) => a.roaster_slug === slug);
    },
    [articles],
  );

  const upsert = useCallback((article: RoasterArticle) => {
    if (!article || article.id == null) return;
    setArticles((prev) => {
      const idx = prev.findIndex((a) => Number(a.id) === Number(article.id));
      if (idx >= 0) {
        const next = [...prev];
        // Merge: prefer fresh fields, but keep cached body_html
        // when the new payload omits it (the list endpoint does).
        next[idx] = { ...prev[idx], ...article };
        return next;
      }
      return [article, ...prev];
    });
  }, []);

  const value = useMemo<RoasterArticlesCtx>(
    () => ({ articles, loading, refetch, getById, getByRoasterSlug, upsert }),
    [articles, loading, refetch, getById, getByRoasterSlug, upsert],
  );

  return (
    <RoasterArticlesContext.Provider value={value}>
      {children}
    </RoasterArticlesContext.Provider>
  );
}

export function useRoasterArticles(): RoasterArticlesCtx {
  const ctx = useContext(RoasterArticlesContext);
  if (!ctx) {
    throw new Error(
      "useRoasterArticles must be used inside <RoasterArticlesProvider>",
    );
  }
  return ctx;
}
