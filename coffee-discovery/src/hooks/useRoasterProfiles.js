import { useState, useEffect, useMemo, useCallback } from "react";

/**
 * Fetch enriched roaster profiles from the catalog pipeline.
 * Falls back to the static JSON if the API is unavailable.
 *
 * Profiles are indexed by multiple keys (slug, website domain, name)
 * because the catalog pipeline uses Google Places names which differ
 * from the scraper's product-derived roaster slugs.
 */
export function useRoasterProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/roasters");
        if (res.ok) {
          setProfiles(await res.json());
        } else {
          throw new Error("API unavailable");
        }
      } catch {
        try {
          const mod = await import("../data/roasters.json");
          setProfiles(mod.default || mod);
        } catch {
          // No data
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Build multiple indexes for fuzzy matching
  const { bySlug, byDomain, byNameLower } = useMemo(() => {
    const bySlug = new Map();
    const byDomain = new Map();
    const byNameLower = new Map();

    for (const r of profiles) {
      // By catalog slug
      if (r.roaster_slug) bySlug.set(r.roaster_slug, r);

      // By website domain (strip protocol + www)
      if (r.website) {
        try {
          const domain = new URL(r.website).hostname.replace(/^www\./, "");
          byDomain.set(domain, r);
        } catch {
          // invalid URL
        }
      }

      // By lowercase name
      if (r.name) byNameLower.set(r.name.toLowerCase(), r);
    }

    return { bySlug, byDomain, byNameLower };
  }, [profiles]);

  /**
   * Look up a roaster profile using product-side data.
   * Tries: exact slug match → website domain match → name substring match.
   */
  const getProfile = useCallback(
    (slug, website, name) => {
      // 1. Exact slug match
      if (slug && bySlug.has(slug)) return bySlug.get(slug);

      // 2. Website domain match (most reliable cross-source key)
      if (website) {
        try {
          const domain = new URL(website).hostname.replace(/^www\./, "");
          if (byDomain.has(domain)) return byDomain.get(domain);
        } catch {
          // invalid URL
        }
      }

      // 3. Name-based fuzzy match (check if product roaster name appears
      // in any catalog name, or vice versa)
      if (name) {
        const nameLower = name.toLowerCase();
        // Exact name match
        if (byNameLower.has(nameLower)) return byNameLower.get(nameLower);
        // Substring: catalog name contains product name or vice versa
        for (const [catalogName, profile] of byNameLower) {
          if (catalogName.includes(nameLower) || nameLower.includes(catalogName)) {
            return profile;
          }
        }
      }

      return null;
    },
    [bySlug, byDomain, byNameLower]
  );

  return { profiles, loading, getProfile };
}
