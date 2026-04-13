import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../api/client";

import fallbackRoasters from "../data/roasters.json";

export function useRoasterProfiles() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await apiFetch<any>("/roasters");
        const data = Array.isArray(raw) ? raw : raw?.data ?? [];
        setProfiles(Array.isArray(data) ? data : []);
      } catch {
        setProfiles(Array.isArray(fallbackRoasters) ? fallbackRoasters : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { bySlug, byDomain, byNameLower } = useMemo(() => {
    const bySlug = new Map();
    const byDomain = new Map();
    const byNameLower = new Map();
    for (const r of (Array.isArray(profiles) ? profiles : [])) {
      if (r.roaster_slug) bySlug.set(r.roaster_slug, r);
      if (r.website) {
        try {
          const domain = new URL(r.website).hostname.replace(/^www\./, "");
          byDomain.set(domain, r);
        } catch {}
      }
      if (r.name) byNameLower.set(r.name.toLowerCase(), r);
    }
    return { bySlug, byDomain, byNameLower };
  }, [profiles]);

  const getProfile = useCallback(
    (slug?: string, website?: string, name?: string) => {
      if (slug && bySlug.has(slug)) return bySlug.get(slug);
      if (website) {
        try {
          const domain = new URL(website).hostname.replace(/^www\./, "");
          if (byDomain.has(domain)) return byDomain.get(domain);
        } catch {}
      }
      if (name) {
        const nameLower = name.toLowerCase();
        if (byNameLower.has(nameLower)) return byNameLower.get(nameLower);
        for (const [catalogName, profile] of byNameLower) {
          if (catalogName.includes(nameLower) || nameLower.includes(catalogName)) return profile;
        }
      }
      return null;
    },
    [bySlug, byDomain, byNameLower]
  );

  const refreshProfiles = useCallback(async () => {
    try {
      const raw = await apiFetch<any>("/roasters");
      const data = Array.isArray(raw) ? raw : raw?.data ?? [];
      setProfiles(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  return { profiles, loading, getProfile, refreshProfiles };
}
