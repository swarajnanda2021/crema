/**
 * CRUD Utopia — data fetch for the admin traction dashboard.
 * Single endpoint (/api/stats/traction) returns the full payload; this hook
 * wraps apiFetchRaw with caching, refresh, and loading state. Gated
 * server-side to the "crema" admin account (is_admin=1).
 * See CRUD_UTOPIA.md at repo root.
 */

import { useCallback, useEffect, useState } from "react";

import { apiFetchRaw } from "../api/client";
import type { TractionStats } from "../resources/types";

interface UseTractionStatsResult {
  stats: TractionStats | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Module-level cache so tab switches on the profile page don't re-fetch the
// full payload on every mount. Invalidate by calling refresh() explicitly.
let _cache: TractionStats | null = null;
let _inflight: Promise<TractionStats> | null = null;

export function useTractionStats(enabled: boolean = true): UseTractionStatsResult {
  const [stats, setStats] = useState<TractionStats | null>(_cache);
  const [loading, setLoading] = useState(!_cache && enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (force: boolean) => {
    if (!enabled) return;
    if (!force && _cache) {
      setStats(_cache);
      setLoading(false);
      return;
    }
    if (!force && _inflight) {
      const data = await _inflight;
      setStats(data);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const promise = apiFetchRaw<any>("/stats/traction")
      .then((res) => {
        const data = (res?.data ?? res) as TractionStats;
        // Don't cache a partially-failed payload. /stats/traction returns
        // HTTP 200 even when a section computes to `{ error: ... }` (each
        // section is independently wrapped server-side), so a transient
        // backend failure would otherwise be cached at module scope and
        // poison every later mount — the dashboard would keep showing
        // broken cards even after the backend recovered, until a hard
        // reload. Surface it as an error instead so Refresh re-fetches.
        const failed = Object.values((data || {}) as Record<string, any>).some(
          (v: any) => v && typeof v === "object" && "error" in v,
        );
        if (failed) throw new Error("Some stats sections failed to load — tap Refresh.");
        _cache = data;
        return data;
      })
      .finally(() => {
        _inflight = null;
      });
    _inflight = promise;
    try {
      const data = await promise;
      setStats(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load traction stats");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchStats(false).catch(() => {});
  }, [enabled, fetchStats]);

  const refresh = useCallback(async () => {
    _cache = null;
    await fetchStats(true);
  }, [fetchStats]);

  return { stats, loading, error, refresh };
}
