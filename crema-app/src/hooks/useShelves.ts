/**
 * useShelves — CRUD Utopia edition.
 * Uses apiFetchRaw for envelope-aware fetching.
 */

import { useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";

export function useShelves() {
  const [shelves, setShelves] = useState<any>({ currently_drinking: [], drank: [], want_to_try: [] });
  const [loading, setLoading] = useState(false);

  const fetchShelves = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetchRaw<any>("/shelves");
      const data = res?.data ?? res;
      setShelves(data && typeof data === "object" ? data : { currently_drinking: [], drank: [], want_to_try: [] });
    } catch {
      setShelves({ currently_drinking: [], drank: [], want_to_try: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserShelves = useCallback(async (username: string) => {
    try {
      const res = await apiFetchRaw<any>(`/shelves/filter?user_id=0`);
      // Use the specific user shelves endpoint
      const res2 = await apiFetchRaw<any>(`/auth/users/${username}`);
      const user = res2?.data ?? res2;
      if (user?.id) {
        const shelfRes = await apiFetchRaw<any>(`/shelves/filter?user_id=${user.id}`);
        const data = shelfRes?.data ?? shelfRes;
        return data && typeof data === "object" ? data : { currently_drinking: [], drank: [], want_to_try: [] };
      }
      return { currently_drinking: [], drank: [], want_to_try: [] };
    } catch {
      return { currently_drinking: [], drank: [], want_to_try: [] };
    }
  }, []);

  const addToShelf = useCallback(async (productId: string, shelf: string) => {
    try {
      await apiFetchRaw("/shelves", {
        method: "POST",
        body: JSON.stringify({ product_id: productId, shelf }),
      });
      await fetchShelves();
    } catch {}
  }, [fetchShelves]);

  const removeFromShelf = useCallback(async (entryId: string | number) => {
    try {
      await apiFetchRaw(`/shelves/${entryId}`, { method: "DELETE" });
      await fetchShelves();
    } catch {}
  }, [fetchShelves]);

  const getShelfForProduct = useCallback((productId: string) => {
    for (const [shelf, entries] of Object.entries(shelves)) {
      const entry = (entries as any[]).find((e: any) => e.product_id === productId);
      if (entry) return { shelf, entry };
    }
    return null;
  }, [shelves]);

  return { shelves, loading, fetchShelves, fetchUserShelves, addToShelf, removeFromShelf, getShelfForProduct };
}
