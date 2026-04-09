import { useState, useCallback } from "react";
import { apiFetch } from "../api/client";

export function useRecommendations() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = useCallback(
    async (source = "self", forUser: string | null = null, limit = 3) => {
      setLoading(true);
      try {
        let url = `/recommendations?source=${source}&limit=${limit}`;
        if (source === "user" && forUser) url += `&for_user=${forUser}`;
        const data = await apiFetch(url);
        setRecommendations(data.recommendations || []);
      } catch {
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { recommendations, loading, fetchRecommendations };
}
