#!/usr/bin/env python3
"""
Faceted drill-down — column-by-column presentation.

Mirrors how a user would actually pick: at tier 1 they choose 3 broad
categories from the SCA tree; the system shows how many coffees touch all
three. They drill into each tier-1 to pick a tier-2 sub-category; system
re-counts. They drill again to pick a tier-3 leaf; system re-counts and
shows the matching coffee(s).

Each persona below specifies the three full tier-3 paths (so the parent
ancestors are unambiguous), but the table presents the choices as the user
would see them at each level.

Reuses the catalog loader + match logic from tag_funnel_search.py.

Usage:
    python tag_drill_table.py
"""

import tag_funnel_search as fs


PERSONAS = [
    (
        "floral-tropical sweet tooth",
        [
            ["Floral", "Floral", "Jasmine"],
            ["Sweet", "Brown Sugar", "Molasses"],
            ["Fruity", "Other Fruit", "Coconut"],
        ],
    ),
    (
        "citrus-and-spice fan",
        [
            ["Fruity", "Citrus Fruit", "Grapefruit"],
            ["Spices", "Brown Spice", "Clove"],
            ["Sweet", "Brown Sugar", "Caramelized"],
        ],
    ),
    (
        "apple-pie breakfast cup",
        [
            ["Fruity", "Other Fruit", "Apple"],
            ["Nutty/Cocoa", "Nutty", "Almond"],
            ["Sweet", "Brown Sugar", "Honey"],
        ],
    ),
    (
        "after-dinner espresso lover",
        [
            ["Nutty/Cocoa", "Cocoa", "Dark Chocolate"],
            ["Sweet", "Brown Sugar", "Caramelized"],
            ["Roasted", "Burnt", "Smoky"],
        ],
    ),
    (
        "wine-natural drinker",
        [
            ["Fruity", "Berry", "Strawberry"],
            ["Floral", "Floral", "Chamomile"],
            ["Sour/Fermented", "Alcohol/Fermented", "Winey"],
        ],
    ),
]


def join_picks(picks):
    """Render '3 selected items' for a tier — comma-joined, last 'and'-joined."""
    if len(picks) == 1:
        return picks[0]
    return ", ".join(picks[:-1]) + ", " + picks[-1]


def main():
    catalog = fs.load_catalog()

    # Compute counts and the matching coffees per persona
    rows = []
    for persona, leaves in PERSONAS:
        t1_picks = [b[0] for b in leaves]
        t2_picks = [f"{b[0]} · {b[1]}" for b in leaves]
        t3_picks = [b[2] for b in leaves]

        n1 = sum(1 for c in catalog if fs.coffee_matches(c, leaves, 1))
        n2 = sum(1 for c in catalog if fs.coffee_matches(c, leaves, 2))
        matches3 = [c for c in catalog if fs.coffee_matches(c, leaves, 3)]
        n3 = len(matches3)

        rows.append({
            "persona": persona,
            "t1": t1_picks, "n1": n1,
            "t2": t2_picks, "n2": n2,
            "t3": t3_picks, "n3": n3,
            "matches": matches3,
        })

    # ---------- markdown drill-down table ----------
    print(f"Catalog: {len(catalog)} coffees with at least one resolved tag.")
    print()
    print("| Persona | Tier 1 picks (3 broad) | n | Tier 2 picks (3 narrower) | n | Tier 3 picks (3 exact) | n |")
    print("|---|---|---:|---|---:|---|---:|")
    for r in rows:
        print(
            f"| {r['persona']} "
            f"| {join_picks(r['t1'])} | {r['n1']} "
            f"| {join_picks(r['t2'])} | {r['n2']} "
            f"| {join_picks(r['t3'])} | {r['n3']} |"
        )
    print()

    # ---------- the coffees that survived to tier 3 ----------
    print("### The coffees that matched all three tier-3 leaves")
    print()
    for r in rows:
        print(f"**{r['persona']}** — Tier 3: {join_picks(r['t3'])}  →  {r['n3']} match{'es' if r['n3'] != 1 else ''}")
        if not r["matches"]:
            print("  - (none)")
        else:
            for c in r["matches"]:
                print(f"  - *{c['name']}* by **{c['roaster']}**")
                print(f"    Roaster's notes: {', '.join(c['tags'])}")
        print()


if __name__ == "__main__":
    main()
