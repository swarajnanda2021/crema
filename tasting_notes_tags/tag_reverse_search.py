#!/usr/bin/env python3
"""
Reverse search: given a query of 3 SCA tree branches, find coffees that match.

Reuses the address-pair-score / coffee-similarity from tag_resolver_test.py.
A coffee "matches" if its similarity to the query is > 0 (i.e., at least one
query branch shares a tier-1 ancestor with at least one of the coffee's
resolved addresses).

Usage:
    python tag_reverse_search.py
"""

import json
from pathlib import Path

import tag_resolver_test as trt


SCRIPT_DIR = Path(__file__).resolve().parent      # tasting_notes_tags/
PROJECT_ROOT = SCRIPT_DIR.parent                  # repo root
INPUT_PATH = PROJECT_ROOT / "Scraper" / "output" / "products_enriched.json"
CACHE_PATH = SCRIPT_DIR / "tag_resolutions.json"


def load_catalog():
    """Returns list of dicts: {name, roaster, tags, addresses}."""
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
        addrs = []
        for t in tags:
            a = resolutions.get(t)
            if a is not None:
                # Validate (defense-in-depth) — skip anything bad
                if trt.is_valid_address(a, trt.TREE):
                    addrs.append(a)
        if not addrs:
            # Coffee has tags but none resolved — skip from match pool
            continue
        catalog.append({
            "name": c.get("coffee_name") or "?",
            "roaster": c.get("roaster_name") or "?",
            "tags": tags,
            "addresses": addrs,
        })
    return catalog


def search(query, catalog):
    """Returns (count_matched, ranked) where ranked = [(score, item), ...]."""
    scored = []
    for item in catalog:
        s = trt.coffee_similarity(query, item["addresses"])
        if s > 0:
            scored.append((s, item))
    # Sort: score desc, then name asc, then roaster asc (deterministic ties)
    scored.sort(key=lambda x: (-x[0], x[1]["name"], x[1]["roaster"]))
    return len(scored), scored


def fmt(addr):
    return "[" + ", ".join(addr) + "]"


def print_query(name, query, catalog):
    count, ranked = search(query, catalog)

    print(f"=== Query: {name} ===")
    for a in query:
        print(f"  branch: {fmt(a)}")
    print()
    print(f"Matches: {count} coffees (out of {len(catalog)} with resolved addresses)")
    if ranked:
        # bucketed match strength
        buckets = {"≥9 (very strong)": 0, "6-8 (strong)": 0, "3-5 (moderate)": 0, "1-2 (weak)": 0}
        for s, _ in ranked:
            if s >= 9:
                buckets["≥9 (very strong)"] += 1
            elif s >= 6:
                buckets["6-8 (strong)"] += 1
            elif s >= 3:
                buckets["3-5 (moderate)"] += 1
            else:
                buckets["1-2 (weak)"] += 1
        bucket_str = ", ".join(f"{k}: {v}" for k, v in buckets.items() if v > 0)
        print(f"  ({bucket_str})")
    print()
    print("Top 3:")
    for i, (score, item) in enumerate(ranked[:3], 1):
        print(f"  {i}. {item['name']} by {item['roaster']} — score {score}")
        print(f"     Tags:      {', '.join(item['tags'])}")
        print(f"     Addresses: {'; '.join(fmt(a) for a in item['addresses'])}")
    print()


def main():
    catalog = load_catalog()
    print(f"loaded {len(catalog)} coffees with at least one resolved address")
    print()

    queries = [
        (
            "Dark dessert (chocolate + caramel + smoky)",
            [
                ["Nutty/Cocoa", "Cocoa", "Dark Chocolate"],
                ["Sweet", "Brown Sugar", "Caramelized"],
                ["Roasted", "Burnt", "Smoky"],
            ],
        ),
        (
            "Bright washed (berry + citrus + floral)",
            [
                ["Fruity", "Berry"],
                ["Fruity", "Citrus Fruit"],
                ["Floral", "Floral"],
            ],
        ),
        (
            "Tropical fermented natural (pineapple + winey + honey)",
            [
                ["Fruity", "Other Fruit", "Pineapple"],
                ["Sour/Fermented", "Alcohol/Fermented", "Winey"],
                ["Sweet", "Brown Sugar", "Honey"],
            ],
        ),
        (
            "Comfort breakfast (hazelnut + brown sugar + cereal)",
            [
                ["Nutty/Cocoa", "Nutty", "Hazelnut"],
                ["Sweet", "Brown Sugar"],
                ["Roasted", "Cereal"],
            ],
        ),
    ]

    for name, query in queries:
        print_query(name, query, catalog)


if __name__ == "__main__":
    main()
