/**
 * scaTree — single-tier flavor schema types + helpers for the Crema
 * Discover wheel (v3).
 *
 * The platform's flavor taxonomy lives in the backend `sca_tree_versions`
 * table; the active row is fetched via `GET /api/sca/tree`. This file
 * provides the TS shape, a small fallback schema for cold starts, and
 * the single-select address helpers the wheel + filter chain use.
 *
 * v3 collapsed the prior 3-tier (T1/T2/T3) shape into a flat sector
 * list. An "address" is now a single-element tuple `[sector_name]`
 * matching one of `schema.sectors[].name`. Picks are a single sector
 * name (or null) — the wheel is single-select.
 */

export type FlavorSector = {
  name: string;
  /** Raw catalog tags Haiku should classify into this sector. Drives
   *  the classifier prompt and the "what's in this sector" tooltip. */
  absorbs: string[];
};

export type FlavorSchema = {
  kind: "single_tier";
  version: string;
  label: string;
  notes?: string;
  sectors: FlavorSector[];
};

/** A coffee's flavor address. Single-tier = always a one-element tuple
 *  whose only string is a sector name from the active schema. */
export type Address = readonly [string];

/** The user's wheel pick — single-select, may be null when nothing's
 *  picked. Body chip selection is tracked separately in the host. */
export type SelectedFlavor = string | null;

export const CONST_REVISION = "2026-04-30-crema-v3";

/** Cold-start fallback so the wheel can render before /api/sca/tree
 *  resolves. Mirrors the backend `FALLBACK_SCHEMA` shape so a network
 *  hiccup never blanks out the surface. */
export const FALLBACK_SCHEMA: FlavorSchema = {
  kind: "single_tier",
  version: "fallback",
  label: "Fallback (loading…)",
  sectors: [
    { name: "Chocolate",   absorbs: [] },
    { name: "Caramel",     absorbs: [] },
    { name: "Floral",      absorbs: [] },
    { name: "Citrus",      absorbs: [] },
    { name: "Berry",       absorbs: [] },
    { name: "Fresh fruit", absorbs: [] },
    { name: "Dried",       absorbs: [] },
    { name: "Spice",       absorbs: [] },
    { name: "Nutty",       absorbs: [] },
    { name: "Earthy",      absorbs: [] },
  ],
};

// ── Schema helpers ──────────────────────────────────────────────────────────

/** Sector names in declaration order — the order is also the wheel
 *  layout, clockwise from 12 o'clock. */
export function sectorNames(schema: FlavorSchema): string[] {
  return schema.sectors.map((s) => s.name);
}

/** Validate an address against a schema. */
export function isValidAddress(addr: unknown, schema: FlavorSchema): addr is Address {
  if (!Array.isArray(addr) || addr.length !== 1) return false;
  const name = addr[0];
  if (typeof name !== "string" || !name) return false;
  return sectorNames(schema).includes(name);
}

/** Single-tier coffee match: does any of the coffee's addresses point
 *  at the picked sector? When `selected` is null, every coffee passes. */
export function coffeeMatchesSelection(
  addresses: readonly Address[],
  selected: SelectedFlavor,
): boolean {
  if (!selected) return true;
  for (const a of addresses) {
    if (a[0] === selected) return true;
  }
  return false;
}

// ── Product → addresses ────────────────────────────────────────────────────

/** Pull the raw flavor-tag list off a product. Mirrors
 *  `services/sca_geolocator.harvest_product_tags` — prefer `flavor_notes`
 *  (array), fall back to comma-split `tasting_notes` (string). */
export function harvestProductTags(product: any): string[] {
  const fn = product?.flavor_notes;
  if (Array.isArray(fn) && fn.length > 0) {
    return fn.filter((x: unknown) => typeof x === "string" && (x as string).trim().length > 0);
  }
  const tn = product?.tasting_notes;
  if (typeof tn === "string" && tn.includes(",")) {
    return tn.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (typeof tn === "string" && tn.trim()) {
    return [tn.trim()];
  }
  return [];
}

/** Resolve a product's tags through the tag→address map and return the
 *  list of valid addresses (drops tags that resolved to null or are
 *  unknown). Tag lookup is case-insensitive — the resolution map keys
 *  are usually titlecase but catalog tags arrive in mixed case. */
export function productAddresses(
  product: any,
  resolutions: Record<string, readonly string[] | null>,
  schema: FlavorSchema = FALLBACK_SCHEMA,
): Address[] {
  const tags = harvestProductTags(product);
  const out: Address[] = [];
  // Build a case-insensitive lookup once per call.
  const lookup = new Map<string, readonly string[] | null>();
  for (const k of Object.keys(resolutions)) {
    lookup.set(k.toLowerCase(), resolutions[k]);
  }
  for (const t of tags) {
    const a = lookup.get(t.toLowerCase());
    if (!a || a.length === 0) continue;
    // Backwards-compat: older `sca_addresses` rows are 3-tier (3
    // strings); we still want them filterable so we treat their first
    // element as the sector name and validate against the active
    // single-tier schema. Multi-tier rows whose t1 doesn't match any
    // active sector are silently dropped.
    const candidate = [a[0]] as Address;
    if (isValidAddress(candidate, schema)) out.push(candidate);
  }
  return out;
}
