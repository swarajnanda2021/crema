import { useState, useCallback } from "react";
import { apiFetch } from "../api";

export function useShelves() {
  const [shelves, setShelves] = useState({
    currently_drinking: [],
    drank: [],
    want_to_try: [],
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

  const fetchUserShelves = useCallback(async (username) => {
    const data = await apiFetch(`/shelves/users/${username}`);
    return data;
  }, []);

  const addToShelf = useCallback(async (productId, shelf) => {
    const entry = await apiFetch("/shelves", {
      method: "POST",
      body: JSON.stringify({ product_id: productId, shelf }),
    });
    await fetchShelves(); // refresh
    return entry;
  }, [fetchShelves]);

  const removeFromShelf = useCallback(async (entryId) => {
    await apiFetch(`/shelves/${entryId}`, { method: "DELETE" });
    await fetchShelves(); // refresh
  }, [fetchShelves]);

  const getShelfForProduct = useCallback(
    (productId) => {
      for (const [shelf, entries] of Object.entries(shelves)) {
        const entry = entries.find((e) => e.product_id === productId);
        if (entry) return { shelf, entry };
      }
      return null;
    },
    [shelves]
  );

  return {
    shelves,
    loading,
    fetchShelves,
    fetchUserShelves,
    addToShelf,
    removeFromShelf,
    getShelfForProduct,
  };
}
