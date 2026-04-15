/**
 * CRUD Utopia — fuzzy resolver from a free-text café reference (e.g. user.favorite_cafe
 * "Moka Coffee, Siolim") to a registered café slug. Used to render in-bio café mentions
 * as tappable links to the café profile page.
 *
 * Matching strategy: lowercase substring match on cafe name + city. First match wins.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useMemo } from "react";
import { useCafes } from "./useCafes";
import type { Cafe } from "../resources/types";

export function useCafeResolver() {
  const { cafes } = useCafes();

  const resolve = useMemo(() => {
    return (text: string | null | undefined): Cafe | null => {
      if (!text) return null;
      const q = text.toLowerCase();
      // Find the café whose name appears in the free text
      // Sort by name length descending so "Moka Desserts" matches before "Moka"
      const sorted = [...cafes].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
      for (const c of sorted) {
        const nameTokens = (c.name || "").toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
        // Match if all distinctive tokens of the café name are in the user's text
        if (nameTokens.length === 0) continue;
        const allMatch = nameTokens.every((tok) => q.includes(tok));
        if (allMatch) return c;
        // Fallback: at least the first significant word + city
        const firstWord = nameTokens[0];
        const city = (c.city || "").toLowerCase();
        if (firstWord && q.includes(firstWord) && city && q.includes(city)) return c;
      }
      return null;
    };
  }, [cafes]);

  return { resolve };
}
