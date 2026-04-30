# Prompt for next Claude instance — design + build the tasting-notes Discover surface

> Paste this as the first message to a fresh Claude Code session in
> `/Users/swarajnanda/Coffee_Aggregator`. Branch: `feat/mobile-readiness`.
> Don't open the conversation with a recap; pick up the task directly.

---

## TL;DR

Discover today has two browsing lenses — **BEANS** (a grid of coffees
filtered by attribute chips) and **ROASTERS** (a vertical list of
roaster cards). The filter chips just shipped a faceted-counts pass
across all sections, plus a fresh canonical-tag substrate from the
five-task Catalog Standardization run (tasting / origin / varietal /
roast / process).

The next thing to build is a **third browsing lens — flavor-led
Discovery via the SCA flavor tree** — that turns the catalog's tasting
notes into a navigable surface in their own right. Consumers should
be able to start from a flavor ("Citrus", "Honey", "Dark Chocolate")
and land on coffees that taste like that, without having to know any
roaster names or origin facts up front. The SCA tree we already use
for tasting-tag canonicalization (`services/sca_geolocator.py:CANONICAL_TREE`)
is the navigation backbone.

---

## What's already in place (don't redo)

- **`sca_addresses`** table populated by the standardization run —
  every harvested tasting tag in the in-stock catalog has either a
  3-tier address (`address_t1`, `address_t2`, `address_t3`) or a
  null row marking "not a flavor". Walk
  `services/sca_geolocator.py` for the schema + `tag_resolutions.json`
  for the seed mapping.
- **Canonical SCA tree** lives in code at
  `Community/coffee-community-api/services/sca_geolocator.py`
  (`CANONICAL_TREE`). 3-tier hierarchy: tier-1 categories like
  "Sweet" / "Fruity" / "Nutty/Cocoa" / "Spices" / "Floral" /
  "Roasted" / "Other"; tier-2 sub-groups; tier-3 leaves.
  The same tree is exposed read-only via
  `GET /api/admin/standardize/trees` for the admin inspector — same
  shape works for a consumer-side Discover renderer.
- **Products carry `tasting_notes` + `flavor_notes`** — the harvester
  in `harvest_product_tags` reads both. The consumer-side
  `tasting_notes_tags/tag_resolutions.json` already maps thousands of
  catalog tags to their SCA addresses; the same lookup powers any new
  Discover surface.
- **Discover BEANS filter** got a faceted-counts pass. Each chip
  shows "label · N" where N = how many coffees would remain in view if
  that chip were toggled on, considering all OTHER active filters.
  See `crema-app/app/(tabs)/browse.tsx` for the pattern (`baseExcept`
  helper, every option memo). Replicate that mental model for the new
  lens — every flavor node should carry a count.

---

## The new surface, sketched

A third lens on Discover, sitting alongside BEANS and ROASTERS. Working
title: **FLAVOR** (or **TASTE**). Consumer mental model:

> "I want a coffee that tastes like dark chocolate and cherry."

Implementation candidates (pick one or hybridize after exploring):

### Option A — Tier-1 chip ladder

Top of the Flavor tab is 7 large chips for the tier-1 SCA categories
(Sweet, Fruity, Nutty/Cocoa, Spices, Floral, Roasted, Other). Tap a
chip → drill into tier-2 groups. Tap a tier-2 → drill into tier-3
leaves OR show beans at that depth. At any depth the result list is a
CoffeeCard grid filtered to beans whose tasting tags address-match
the selected node.

Pros: Familiar mobile pattern (category → subcategory). Counts at each
depth give the consumer a sense of where the catalog is rich.

### Option B — Flavor wheel viz

Render the SCA tree as a radial wheel (the Specialty Coffee
Association's canonical visualisation). Each wedge is a tier-1
category; tier-2 + tier-3 nest as sub-arcs. Tap any arc → filter beans
to that node and its descendants.

Pros: Iconic, instantly readable for anyone who's looked at coffee
flavor materials before. Works as a brand surface.
Cons: Needs `react-native-svg` work; mobile small-screen ergonomics
are tricky.

### Option C — Search-first, address-shaped

A search input at top ("citrus, dark chocolate, …") that auto-completes
from the flavor tree. Selected flavors render as removable chips. The
result is the intersection / union of beans matching those addresses.
Empty state is a curated list of "Try these flavor combos" presets.

Pros: Multi-flavor compounds are first-class. Fastest path to
"give me beans that taste like X AND Y".
Cons: Less browseable for consumers who don't know what they want yet.

### Recommended starting shape

Probably **A + sprinkle of C** — the chip ladder is the primary
navigation, but the tier-1 row sits below an always-visible search
field that lets power users skip straight to a known leaf. Build A
first; add C in the same surface once A's depth-of-nav is solid.

---

## Things to think through before you start cutting code

1. **Empty leaves vs catalog depth.** The SCA tree has dozens of tier-3
   leaves the catalog has zero beans against (e.g. "Asparagus" under
   Vegetative). The chip count must be 0 for those — they shouldn't
   crowd the navigation. Either hide zero-count chips at every depth,
   or grey them out and disable the tap. Probably hide.

2. **Fan-out and roll-up.** A bean tagged with three tasting notes
   shows up under each note's address AND under each ancestor's
   address. So "Cherry" (Fruity → Berry → Cherry) means the bean
   counts under "Cherry", "Berry", and "Fruity" simultaneously.
   That's correct for "I'm browsing Fruity, what's there?". Be sure
   the count math doesn't double-count a single bean within one chip
   (use a Set).

3. **The address table is the authoritative join, not free-text
   `tasting_notes`**. A bean that says "tobacco-like aftertaste"
   maps via `sca_addresses` to whatever address the standardization
   run resolved. Always join through that table; never grep raw
   tasting notes from the consumer side.

4. **Perf.** The harvest-product-tags walk is O(products × tags-per-
   product) but stays under 5k entries today. For consumer renders,
   pre-compute a `flavor_index` map on the products useMemo so each
   chip's count is O(1). Mirror the `baseExcept` pattern from the
   BEANS faceted counts.

5. **Cross-lens linking.** From a BEANS card, tapping a tasting-note
   chip should jump into the FLAVOR lens with that node selected.
   From a roaster page, tapping a flavor chip on a bean does the same.
   Plumbing-wise: Expo Router params on `/browse?tab=flavor&node=Cherry`.

6. **Tier-2 vs tier-3 default depth.** When the consumer opens the
   Flavor tab fresh, what do they see? Tier-1 chip row plus a
   "what's popular" rail (e.g. top-3 catalog flavors by bean count).
   Don't dump them straight to the wheel unless we go Option B — pick
   one default-state design and stick with it.

---

## Implementation pointers

- **Frontend route:** new `(tabs)/browse.tsx` tab alongside BEANS /
  ROASTERS. The TabButton + activeTab state already exists; add a
  third value.
- **Component:** `src/components/discover/FlavorBrowse.tsx`. Owns the
  tier-1/2/3 navigation state, the catalog index, and the result
  grid. Mirror the structure of `RoastersList` (which lives inside
  the same browse.tsx today).
- **Data:** the frontend already has `useCoffeeData()` returning
  products. To get each product's SCA addresses, two paths:
  - **(a) Backend serves them.** Add a `/api/products/with_addresses`
    endpoint that joins products × sca_addresses and returns each bean
    with a `flavor_addresses` field (`Array<[t1, t2?, t3?]>`).
  - **(b) Frontend joins.** Fetch `sca_addresses` once, fetch
    products once, do the join in memory. Cheaper RPC, more client
    code. Probably the right v0 — caches in `useCoffeeData`.
- **Counts:** every node in the tree gets a count = how many beans
  have at least one address ending under or at that node. Compute
  once per products+addresses change, store as `Map<nodeKey, number>`
  keyed by `t1` / `t1>t2` / `t1>t2>t3`.

---

## Don't get distracted by

- The existing standardization tab — it's working as of this commit.
  Don't refactor unless explicitly asked.
- Building wheel-viz immediately. Option A's chip ladder is the
  faster path to a usable surface; the wheel is a nice-to-have second
  pass.
- Roast-level / process / origin filters in the Flavor lens.
  Consumers in this lens are starting from taste, not provenance.
  Layer those in only if the result list gets too big to scan.
- The MAPPING tab's old paste-upload flow — gone for good per a prior
  pass, don't try to revive it.

---

## Files to study before designing

- `crema-app/app/(tabs)/browse.tsx` — current Discover, faceted-count
  pattern, tab plumbing.
- `crema-app/src/components/discover/CoffeeCard.tsx` — the result
  grid's primitive. Reuse, don't fork.
- `Community/coffee-community-api/services/sca_geolocator.py` —
  `CANONICAL_TREE`, `harvest_product_tags`, `is_valid_address`.
- `tasting_notes_tags/tag_resolutions.json` — concrete examples of
  what a populated address table looks like.
- `BUILD_ROADMAP.md` §1.5 — Catalog Ops history, including the
  five-task standardization run that fed `sca_addresses`.

---

## Standing rules (from CLAUDE.md / NORTH_STAR.md)

- Phase 1 surface — discovery + retention. Should make a Phase-1
  consumer want to come back tomorrow because they found a flavor
  combo they didn't know existed.
- Token-only styling (palette: Espresso #351101, Crema #D798DA,
  Crema White #FAF8F0). NewSpirit display, Inter body.
- No new top-level `.md` files. If you build the wheel and it deserves
  its own design doc, add a note inline in `BUILD_ROADMAP.md` instead.
- Update `BUILD_ROADMAP.md` when a piece of this lands — move "Flavor
  Discover lens" out of the next-build section as it ships.

When in doubt about scope, ship Option A's chip ladder end-to-end
(tab → tier-1 row → drill → result grid) before any other variant.
That's the minimum useful surface; everything else is an enhancement
on top.
