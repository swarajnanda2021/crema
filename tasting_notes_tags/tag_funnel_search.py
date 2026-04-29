#!/usr/bin/env python3
"""
Faceted drill-down search.

Pretend a consumer who knows their palate picks 3 flavors they like (tier-3
leaves on the SCA tree). We search the catalog at three levels of specificity:

  - tier 1: does the coffee have ANY tag in each of the 3 broad categories?
  - tier 2: does it have ANY tag in each of the 3 mid categories?
  - tier 3: does it have ANY tag matching each of the 3 exact leaves?

A coffee matches at tier N when, for every one of the 3 query branches, at
least one of the coffee's resolved tags has that branch as a prefix at depth
N. The pool collapses tier by tier.

Reuses TREE + is_valid_address from tag_resolver_test.py. No API calls.

Usage:
    python tag_funnel_search.py
"""

import json
from pathlib import Path

import tag_resolver_test as trt


SCRIPT_DIR = Path(__file__).resolve().parent      # tasting_notes_tags/
PROJECT_ROOT = SCRIPT_DIR.parent                  # repo root
INPUT_PATH = PROJECT_ROOT / "Scraper" / "output" / "products_enriched.json"
CACHE_PATH = SCRIPT_DIR / "tag_resolutions.json"


# ---------------------------------------------------------------------------
# Loading

def load_catalog():
    with open(CACHE_PATH) as f:
        resolutions = json.load(f)
    resolutions.pop("_comment", None)
    with open(INPUT_PATH) as f:
        data = json.load(f)

    catalog = []
    for c in data:
        tags = c.get("flavor_notes") or []
        if not tags:
            continue
        addrs = [
            resolutions[t]
            for t in tags
            if resolutions.get(t) is not None
            and trt.is_valid_address(resolutions[t], trt.TREE)
        ]
        if not addrs:
            continue
        catalog.append(
            {
                "name": c.get("coffee_name") or "?",
                "roaster": c.get("roaster_name") or "?",
                "tags": tags,
                "addresses": addrs,
            }
        )
    return catalog


# ---------------------------------------------------------------------------
# Match logic

def has_match_at_tier(addresses, branch, tier):
    """At least one of `addresses` shares branch[:tier] as a prefix at depth N."""
    target = branch[:tier]
    if len(target) < tier:
        return False  # query branch isn't deep enough for this tier
    for a in addresses:
        if len(a) >= tier and a[:tier] == target:
            return True
    return False


def coffee_matches(coffee, query_branches, tier):
    """All 3 branches must each find ≥1 matching tag in the coffee."""
    return all(has_match_at_tier(coffee["addresses"], b, tier) for b in query_branches)


def fmt(addr):
    return "[" + ", ".join(addr) + "]"


# ---------------------------------------------------------------------------
# Funnel display

def funnel(query_name, leaves, catalog):
    print(f"╔══ User picks 3 flavors they like — {query_name}")
    for leaf in leaves:
        print(f"║   • {leaf[-1]}")
    print()
    print(f"║   (in tree terms: {' / '.join(fmt(b) for b in leaves)})")
    print()

    prev_count = len(catalog)
    last_matches = []
    for tier in (1, 2, 3):
        ancestors = [b[:tier] for b in leaves]
        matches = [c for c in catalog if coffee_matches(c, leaves, tier)]
        last_matches = matches
        # short label for the level
        level_name = {1: "broad category", 2: "mid category", 3: "exact leaf"}[tier]
        print(f"║ Tier {tier} ({level_name}):  {' + '.join(fmt(a) for a in ancestors)}")
        delta = ""
        if tier > 1:
            delta = f"  (was {prev_count})"
        print(f"║   → {len(matches)} coffees match{delta}")
        prev_count = len(matches)
        print("║")

    print("╠══ The coffee(s) that matched at tier 3:")
    if not last_matches:
        print("║   (none — no coffee in the catalog has all three exact leaves)")
    else:
        for c in last_matches:
            print(f"║")
            print(f"║   ✦ {c['name']} by {c['roaster']}")
            print(f"║     Roaster's notes: {', '.join(c['tags'])}")
            print(f"║     Resolved as:     {'; '.join(fmt(a) for a in c['addresses'])}")
    print("╚" + "═" * 78)
    print()


# ---------------------------------------------------------------------------
# Demo

def main():
    catalog = load_catalog()
    print(f"Catalog: {len(catalog)} coffees with at least one resolved tag.")
    print()

    # Each query is 3 tier-3 leaves the consumer "likes".
    # Picked so the three tier-1 ancestors are distinct (so the funnel actually
    # walks all three levels meaningfully).
    queries = [
        # Persona: floral-tropical-sweet
        (
            "the floral-tropical sweet tooth",
            [
                ["Floral", "Floral", "Jasmine"],
                ["Sweet", "Brown Sugar", "Molasses"],
                ["Fruity", "Other Fruit", "Coconut"],
            ],
        ),
        # Persona: bright-warm-spiced
        (
            "the citrus-and-spice fan",
            [
                ["Fruity", "Citrus Fruit", "Grapefruit"],
                ["Spices", "Brown Spice", "Clove"],
                ["Sweet", "Brown Sugar", "Caramelized"],
            ],
        ),
        # Persona: berry-floral-winey (light wine-y natural)
        (
            "the wine-natural drinker",
            [
                ["Fruity", "Berry", "Strawberry"],
                ["Floral", "Floral", "Chamomile"],
                ["Sour/Fermented", "Alcohol/Fermented", "Winey"],
            ],
        ),
        # Persona: nutty-fruity-honey (a softer, balanced cup)
        (
            "the apple-pie breakfast cup",
            [
                ["Fruity", "Other Fruit", "Apple"],
                ["Nutty/Cocoa", "Nutty", "Almond"],
                ["Sweet", "Brown Sugar", "Honey"],
            ],
        ),
    ]

    for name, leaves in queries:
        funnel(name, leaves, catalog)


if __name__ == "__main__":
    main()
