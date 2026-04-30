/**
 * scaTree — the canonical SCA flavor tree, mirrored as a TS constant
 * for the consumer Discover Flavor wheel.
 *
 * Source of truth lives in `Community/coffee-community-api/services/
 * sca_geolocator.py:CANONICAL_TREE`. If the backend tree is edited in a
 * future migration, mirror the change here and bump CONST_REVISION.
 *
 * Helpers in this module are pure (no React, no fetch). They support:
 *   - listing children of any node
 *   - parsing & matching addresses (the [t1, t2?, t3?] tuples from
 *     /api/sca/addresses)
 *   - computing whether a coffee survives a wheel pick set under the
 *     "every picked branch must have ≥ 1 matching address" rule (same
 *     algorithm as `tag_funnel_search.py:coffee_matches`).
 */

export type TreeDict = Record<string, Record<string, string[]>>;

export type Address = readonly [string] | readonly [string, string] | readonly [string, string, string];

/** Keys used to dedupe picks in Sets — "Sweet>Brown Sugar>Honey". */
export type PickKey = string;

export interface Picks {
  t1: Set<PickKey>; // "Sweet"
  t2: Set<PickKey>; // "Sweet>Brown Sugar"
  t3: Set<PickKey>; // "Sweet>Brown Sugar>Honey"
}

export const CONST_REVISION = "2026-04-30";

export const CANONICAL_TREE: TreeDict = {
  Floral: {
    "Black Tea": [],
    Floral: ["Chamomile", "Rose", "Jasmine"],
  },
  Fruity: {
    Berry: ["Blackberry", "Raspberry", "Blueberry", "Strawberry"],
    "Dried Fruit": ["Raisin", "Prune"],
    "Other Fruit": ["Coconut", "Cherry", "Pomegranate", "Pineapple", "Grape", "Apple", "Peach", "Pear"],
    "Citrus Fruit": ["Grapefruit", "Orange", "Lemon", "Lime"],
  },
  "Sour/Fermented": {
    Sour: ["Sour Aromatics", "Acetic Acid", "Butyric Acid", "Isovaleric Acid", "Citric Acid", "Malic Acid"],
    "Alcohol/Fermented": ["Winey", "Whiskey", "Fermented", "Overripe"],
  },
  "Green/Vegetative": {
    "Olive Oil": [],
    Raw: [],
    "Green/Vegetative": ["Under-ripe", "Peapod", "Fresh", "Dark Green", "Vegetative", "Hay-like", "Herb-like"],
    Beany: [],
  },
  Other: {
    "Papery/Musty": [
      "Stale", "Cardboard", "Papery", "Woody", "Moldy/Damp",
      "Musty/Dusty", "Musty/Earthy", "Animalic", "Meaty Brothy", "Phenolic",
    ],
    Chemical: ["Bitter", "Salty", "Medicinal", "Petroleum", "Skunky", "Rubber"],
  },
  Roasted: {
    "Pipe Tobacco": [],
    Tobacco: [],
    Burnt: ["Acrid", "Ashy", "Smoky", "Brown, Roast"],
    Cereal: ["Grain", "Malt"],
  },
  Spices: {
    Pungent: [],
    Pepper: [],
    "Brown Spice": ["Anise", "Nutmeg", "Cinnamon", "Clove"],
  },
  "Nutty/Cocoa": {
    Nutty: ["Peanuts", "Hazelnut", "Almond"],
    Cocoa: ["Chocolate", "Dark Chocolate"],
  },
  Sweet: {
    "Brown Sugar": ["Molasses", "Maple Syrup", "Caramelized", "Honey"],
    Vanilla: [],
    Vanillin: [],
    "Overall Sweet": [],
    "Sweet Aromatics": [],
  },
};

/** Tier-1 categories in display order. The wheel renders them in this
 *  order around the inner ring, starting at 12-o'clock and walking
 *  clockwise. The order groups thematically (sweet/fruity/floral on one
 *  half; roasted/nutty/spices on the other) so neighbours feel related. */
export const TIER_1_ORDER: readonly string[] = [
  "Sweet",
  "Fruity",
  "Floral",
  "Sour/Fermented",
  "Green/Vegetative",
  "Other",
  "Roasted",
  "Spices",
  "Nutty/Cocoa",
];

/** Resolve a node's on-screen label. Generic rule: any
 *  "<word>/<word>" name collapses to the first word for display,
 *  e.g. "Sour/Fermented" → "Sour", "Green/Vegetative" → "Green",
 *  "Nutty/Cocoa" → "Nutty", "Alcohol/Fermented" → "Alcohol",
 *  "Papery/Musty" → "Papery". The canonical key (used by the
 *  sca_addresses join) keeps the full slash-name unchanged — only
 *  the on-screen label is shortened. The `tier` parameter is kept
 *  for callers that may want to apply tier-specific exceptions in
 *  the future. */
export function displayLabel(name: string, _tier: 1 | 2 | 3): string {
  if (name.includes("/")) return name.split("/")[0];
  return name;
}

// ── Pick keys ───────────────────────────────────────────────────────────────

export const keyT1 = (t1: string): PickKey => t1;
export const keyT2 = (t1: string, t2: string): PickKey => `${t1}>${t2}`;
export const keyT3 = (t1: string, t2: string, t3: string): PickKey => `${t1}>${t2}>${t3}`;

export const splitKey = (key: PickKey): string[] => key.split(">");

export const emptyPicks = (): Picks => ({
  t1: new Set<PickKey>(),
  t2: new Set<PickKey>(),
  t3: new Set<PickKey>(),
});

export const totalPicks = (p: Picks): number => p.t1.size + p.t2.size + p.t3.size;

// ── Tree traversal ──────────────────────────────────────────────────────────

/** Children of a node. Returns the next-tier names. */
export function listChildren(tree: TreeDict, t1?: string, t2?: string): string[] {
  if (!t1) return Object.keys(tree);
  if (!t2) return Object.keys(tree[t1] ?? {});
  return tree[t1]?.[t2] ?? [];
}

/** Children of MULTIPLE picked parents at the next tier — used to populate
 *  the T2 ring (when t1Picks given) or the T3 ring (when t2Picks given).
 *  Returns ordered pairs `[parentName, childName]` so the caller knows
 *  which T1 each T2 came from (for grouping / colour tinting). */
export function listChildrenOfPicks(
  tree: TreeDict,
  picks: Set<PickKey>,
  tier: 1 | 2,
): Array<{ parent: PickKey; child: string; address: Address }> {
  const out: Array<{ parent: PickKey; child: string; address: Address }> = [];
  // Iterate in TIER_1_ORDER so output is deterministic across renders
  // even when picks Sets have been mutated in different orders.
  if (tier === 1) {
    // Picks are T1; want T2 children.
    for (const t1 of TIER_1_ORDER) {
      if (!picks.has(t1)) continue;
      for (const t2 of Object.keys(tree[t1] ?? {})) {
        out.push({ parent: t1, child: t2, address: [t1, t2] as const });
      }
    }
  } else {
    // Picks are T2 ("t1>t2"); want T3 leaves.
    for (const t1 of TIER_1_ORDER) {
      const t1Subtree = tree[t1] ?? {};
      for (const t2 of Object.keys(t1Subtree)) {
        const k = keyT2(t1, t2);
        if (!picks.has(k)) continue;
        for (const t3 of t1Subtree[t2] ?? []) {
          out.push({ parent: k, child: t3, address: [t1, t2, t3] as const });
        }
      }
    }
  }
  return out;
}

// ── Address validation & matching ───────────────────────────────────────────

export function isValidAddress(addr: unknown, tree: TreeDict): addr is Address {
  if (!Array.isArray(addr) || addr.length < 1 || addr.length > 3) return false;
  if (!addr.every((x) => typeof x === "string")) return false;
  const t1 = addr[0] as string;
  if (!(t1 in tree)) return false;
  if (addr.length === 1) return true;
  const t2 = addr[1] as string;
  if (!(t2 in tree[t1])) return false;
  if (addr.length === 2) return true;
  const t3 = addr[2] as string;
  return (tree[t1][t2] ?? []).includes(t3);
}

/** Does `addr` prefix-match `branch[:tier]`? E.g. address ["Sweet",
 *  "Brown Sugar", "Honey"] prefix-matches the branch ["Sweet", "Brown Sugar"]
 *  at tier 2. */
function addressPrefixMatches(addr: Address, branch: readonly string[], tier: 1 | 2 | 3): boolean {
  if (addr.length < tier || branch.length < tier) return false;
  for (let i = 0; i < tier; i++) {
    if (addr[i] !== branch[i]) return false;
  }
  return true;
}

/** A coffee survives the wheel filter if, for every picked branch (across
 *  all three tiers), at least one of the coffee's resolved addresses
 *  prefix-matches that branch at the picked tier. Mirrors
 *  `tag_funnel_search.coffee_matches`.
 *
 *  When NO picks exist, every coffee survives. */
export function coffeeMatchesPicks(addresses: readonly Address[], picks: Picks): boolean {
  if (totalPicks(picks) === 0) return true;
  // Build the list of (branch, tier) constraints.
  const constraints: Array<{ branch: readonly string[]; tier: 1 | 2 | 3 }> = [];
  for (const k of picks.t1) constraints.push({ branch: [k], tier: 1 });
  for (const k of picks.t2) constraints.push({ branch: splitKey(k), tier: 2 });
  for (const k of picks.t3) constraints.push({ branch: splitKey(k), tier: 3 });
  for (const c of constraints) {
    let ok = false;
    for (const a of addresses) {
      if (addressPrefixMatches(a, c.branch, c.tier)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
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

/** Resolve a product's tags through the tag→address map and return
 *  the list of valid addresses (drops tags that resolved to null or
 *  are unknown). */
export function productAddresses(
  product: any,
  resolutions: Record<string, Address | null>,
  tree: TreeDict = CANONICAL_TREE,
): Address[] {
  const tags = harvestProductTags(product);
  const out: Address[] = [];
  for (const t of tags) {
    const a = resolutions[t];
    if (!a) continue;
    if (isValidAddress(a, tree)) out.push(a);
  }
  return out;
}
