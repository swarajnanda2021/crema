/**
 * useScaAddresses — fetches the consumer-side `tag → SCA address` map
 * from `/api/sca/addresses` and caches it in module memory.
 *
 * Used by the Discover Flavor wheel to join product `flavor_notes` /
 * `tasting_notes` onto canonical SCA tree nodes for the chip-ladder
 * filter math.
 *
 * The endpoint is small (~300-500 entries × ~80 bytes each) and stable,
 * so we cache once for the app's lifetime. Re-fetch only if the cache
 * is empty when a new consumer mounts the wheel.
 */
import { useEffect, useState } from "react";
import { apiFetchRaw } from "../api/client";
import type { Address } from "../utils/scaTree";

export type ResolutionMap = Record<string, Address | null>;

let _cache: ResolutionMap | null = null;
let _inflight: Promise<ResolutionMap> | null = null;

async function loadOnce(): Promise<ResolutionMap> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await apiFetchRaw<any>("/sca/addresses");
      const data = (res?.data ?? res) as ResolutionMap;
      _cache = data && typeof data === "object" ? data : {};
      return _cache;
    } catch {
      _cache = {};
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function useScaAddresses(): { resolutions: ResolutionMap; loading: boolean } {
  const [resolutions, setResolutions] = useState<ResolutionMap>(_cache ?? {});
  const [loading, setLoading] = useState(_cache === null);

  useEffect(() => {
    if (_cache !== null) return;
    let cancelled = false;
    setLoading(true);
    loadOnce().then((map) => {
      if (cancelled) return;
      setResolutions(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { resolutions, loading };
}
