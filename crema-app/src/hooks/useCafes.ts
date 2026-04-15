/**
 * CRUD Utopia — café data fetcher. Wraps useResource<Cafe> for the list,
 * adds convenience for stamp book + popularity that need composite endpoints.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useEffect, useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";
import type { Cafe, StampBookEntry } from "../resources/types";

export function useCafes() {
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const [cafesRes, popRes] = await Promise.all([
        apiFetchRaw<any>("/cafe_profiles?limit=100"),
        apiFetchRaw<any>("/cafes/popularity"),
      ]);
      const cafesData = (cafesRes?.data ?? cafesRes) as Cafe[];
      const popData = (popRes?.data ?? popRes) as Record<string, number>;
      setCafes(Array.isArray(cafesData) ? cafesData : []);
      setPopularity(popData && typeof popData === "object" ? popData : {});
    } catch (e) {
      console.warn("Cafés fetch failed:", e);
      setCafes([]);
      setPopularity({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { cafes, popularity, loading, refetch };
}

export function useStampBook(username: string | undefined) {
  const [entries, setEntries] = useState<StampBookEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>(`/users/${username}/stamp-book`);
      const data = (raw?.data ?? raw) as StampBookEntry[];
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("Stamp book fetch failed:", e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { refetch(); }, [refetch]);

  return { entries, loading, refetch };
}
