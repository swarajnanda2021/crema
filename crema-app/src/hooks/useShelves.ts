/**
 * useShelves — CRUD Utopia edition.
 * Uses apiFetchRaw for envelope-aware fetching.
 */

import { useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";

export function useShelves() {
  const [shelves, setShelves] = useState<any>({ open_bags: [], on_the_list: [] });
  const [loading, setLoading] = useState(false);

  const fetchShelves = useCallback(async () => {
    setLoading(true);
    try {
      // Get current user ID, then fetch their shelves specifically
      const meRes = await apiFetchRaw<any>("/auth/me");
      const me = meRes?.data ?? meRes;
      if (me?.id) {
        const shelfRes = await apiFetchRaw<any>(`/shelves/filter?user_id=${me.id}`);
        const data = shelfRes?.data ?? shelfRes;
        setShelves(data && typeof data === "object" ? data : { open_bags: [], on_the_list: [] });
      } else {
        setShelves({ open_bags: [], on_the_list: [] });
      }
    } catch {
      setShelves({ open_bags: [], on_the_list: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserShelves = useCallback(async (username: string) => {
    try {
      const res = await apiFetchRaw<any>(`/auth/users/${username}`);
      const user = res?.data ?? res;
      if (user?.id) {
        const shelfRes = await apiFetchRaw<any>(`/shelves/filter?user_id=${user.id}`);
        const data = shelfRes?.data ?? shelfRes;
        return data && typeof data === "object" ? data : { open_bags: [], on_the_list: [] };
      }
      return { open_bags: [], on_the_list: [] };
    } catch {
      return { open_bags: [], on_the_list: [] };
    }
  }, []);

  const addToShelf = useCallback(async (productId: string, shelf: string) => {
    try {
      await apiFetchRaw("/shelves", {
        method: "POST",
        body: JSON.stringify({ product_id: productId, shelf }),
      });
      await fetchShelves();
    } catch (e) { console.warn("Add to shelf failed:", e); }
  }, [fetchShelves]);

  const removeFromShelf = useCallback(async (entryId: string | number) => {
    try {
      await apiFetchRaw(`/shelves/${entryId}`, { method: "DELETE" });
      await fetchShelves();
    } catch (e) { console.warn("Remove from shelf failed:", e); }
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
