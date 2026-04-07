import { useState, useCallback } from "react";
import { apiFetch } from "../api/client";

export function useShelves() {
  const [shelves, setShelves] = useState({
    currently_drinking: [] as any[],
    drank: [] as any[],
    want_to_try: [] as any[],
  });
  const [loading, setLoading] = useState(false);

  const fetchShelves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/shelves");
      setShelves(data);
    } catch {
      // Backend unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserShelves = useCallback(async (username: string) => {
    return apiFetch(`/shelves/users/${username}`);
  }, []);

  const addToShelf = useCallback(async (productId: string, shelf: string) => {
    const entry = await apiFetch("/shelves", {
      method: "POST",
      body: JSON.stringify({ product_id: productId, shelf }),
    });
    await fetchShelves();
    return entry;
  }, [fetchShelves]);

  const removeFromShelf = useCallback(async (entryId: number) => {
    await apiFetch(`/shelves/${entryId}`, { method: "DELETE" });
    await fetchShelves();
  }, [fetchShelves]);

  const getShelfForProduct = useCallback(
    (productId: string) => {
      for (const [shelf, entries] of Object.entries(shelves)) {
        const entry = (entries as any[]).find((e) => e.product_id === productId);
        if (entry) return { shelf, entry };
      }
      return null;
    },
    [shelves]
  );

  return { shelves, loading, fetchShelves, fetchUserShelves, addToShelf, removeFromShelf, getShelfForProduct };
}
