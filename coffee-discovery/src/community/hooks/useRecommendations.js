import { useState, useCallback } from "react";
import { apiFetch } from "../api";

/**
 * source: "self" (my shelf), "community" (feed), "user" (someone's profile)
 * forUser: username (only when source="user")
 */
export function useRecommendations() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = useCallback(async (source = "self", forUser = null, limit = 3) => {
    setLoading(true);
    try {
      let url = `/recommendations?source=${source}&limit=${limit}`;
      if (source === "user" && forUser) {
        url += `&for_user=${forUser}`;
      }
      const data = await apiFetch(url);
      setRecommendations(data.recommendations || []);
    } catch {
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { recommendations, loading, fetchRecommendations };
}
