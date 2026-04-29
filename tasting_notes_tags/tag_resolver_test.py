#!/usr/bin/env python3
"""
SCA tag → address mapper feasibility test.

Reads coffees with non-empty flavor_notes from
Scraper/output/products_enriched.json. Collects the unique flavor-note
tags across the whole catalog and sends them to Haiku 4.5 in a SINGLE
batched call (instead of one call per coffee — same tags repeat hundreds
of times). Validates every returned address against the SCA tree, then
applies the lookup to each coffee and computes adjacency-based tag
recommendations and similar-coffee matches.

If `tasting_notes_tags/tag_resolutions.json` already exists, the API
call is skipped and resolutions are loaded from there (lets you
iterate on downstream logic without hitting Haiku every time).

No DB writes. No file writes other than
tasting_notes_tags/tag_resolver_test.log (mirrors stdout) and
tasting_notes_tags/tag_resolutions.json (cached lookup).

Usage (from repo root or from tasting_notes_tags/):
    ANTHROPIC_API_KEY=sk-... python tasting_notes_tags/tag_resolver_test.py
    python tasting_notes_tags/tag_resolver_test.py --refresh   # force re-call Haiku
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path


# ---------------------------------------------------------------------------
# Config

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 32000  # ~328 entries × ~75 tokens each ≈ 24.6K — give headroom
SDK_MAX_RETRIES = 4

SCRIPT_DIR = Path(__file__).resolve().parent      # tasting_notes_tags/
PROJECT_ROOT = SCRIPT_DIR.parent                  # repo root
INPUT_PATH = PROJECT_ROOT / "Scraper" / "output" / "products_enriched.json"
LOG_PATH = SCRIPT_DIR / "tag_resolver_test.log"
CACHE_PATH = SCRIPT_DIR / "tag_resolutions.json"

LABEL_WIDTH = 17  # column where values align in printed blocks
PREVIEW_TAGS = 40  # how many resolved tags to show in the preview pause


# ---------------------------------------------------------------------------
# The SCA flavor tree (authoritative — must match the system prompt below)

TREE = {
    "Floral": {
        "Black Tea": [],
        "Floral": ["Chamomile", "Rose", "Jasmine"],
    },
    "Fruity": {
        "Berry": ["Blackberry", "Raspberry", "Blueberry", "Strawberry"],
        "Dried Fruit": ["Raisin", "Prune"],
        "Other Fruit": ["Coconut", "Cherry", "Pomegranate", "Pineapple", "Grape", "Apple", "Peach", "Pear"],
        "Citrus Fruit": ["Grapefruit", "Orange", "Lemon", "Lime"],
    },
    "Sour/Fermented": {
        "Sour": ["Sour Aromatics", "Acetic Acid", "Butyric Acid", "Isovaleric Acid", "Citric Acid", "Malic Acid"],
        "Alcohol/Fermented": ["Winey", "Whiskey", "Fermented", "Overripe"],
    },
    "Green/Vegetative": {
        "Olive Oil": [],
        "Raw": [],
        "Green/Vegetative": ["Under-ripe", "Peapod", "Fresh", "Dark Green", "Vegetative", "Hay-like", "Herb-like"],
        "Beany": [],
    },
    "Other": {
        "Papery/Musty": ["Stale", "Cardboard", "Papery", "Woody", "Moldy/Damp", "Musty/Dusty", "Musty/Earthy", "Animalic", "Meaty Brothy", "Phenolic"],
        "Chemical": ["Bitter", "Salty", "Medicinal", "Petroleum", "Skunky", "Rubber"],
    },
    "Roasted": {
        "Pipe Tobacco": [],
        "Tobacco": [],
        "Burnt": ["Acrid", "Ashy", "Smoky", "Brown, Roast"],
        "Cereal": ["Grain", "Malt"],
    },
    "Spices": {
        "Pungent": [],
        "Pepper": [],
        "Brown Spice": ["Anise", "Nutmeg", "Cinnamon", "Clove"],
    },
    "Nutty/Cocoa": {
        "Nutty": ["Peanuts", "Hazelnut", "Almond"],
        "Cocoa": ["Chocolate", "Dark Chocolate"],
    },
    "Sweet": {
        "Brown Sugar": ["Molasses", "Maple Syrup", "Caramelized", "Honey"],
        "Vanilla": [],
        "Vanillin": [],
        "Overall Sweet": [],
        "Sweet Aromatics": [],
    },
}


# ---------------------------------------------------------------------------
# System prompt (with the tree JSON serialized verbatim)

_TREE_JSON = json.dumps(TREE, indent=2, ensure_ascii=False)

SYSTEM_PROMPT = f"""You map coffee tasting note tags onto the SCA flavor tree. For each input tag, return the single deepest address that captures it, or null.

The flavor tree is a 3-tier hierarchy. An address is a path: [tier1], [tier1, tier2], or [tier1, tier2, tier3].

Rules:

1. Match at the deepest tier where the input clearly fits. "Honey" → ["Sweet", "Brown Sugar", "Honey"]. "Cacao" → ["Nutty/Cocoa", "Cocoa"] (synonym for Cocoa, no tier-3 match).

2. Strip modifiers that don't change the underlying flavor. "Wild Honey", "Raw Honey" → ["Sweet", "Brown Sugar", "Honey"]. "Milk Chocolate", "Dark Chocolate" → keep at tier 3 if exact match exists, else climb. "Roasted Nuts" → ["Nutty/Cocoa", "Nutty"].

3. Climb up when the input points to a region rather than a single leaf. "Stone Fruit" → ["Fruity", "Other Fruit"] (groups Cherry + Peach under the directive). "Citrus" → ["Fruity", "Citrus Fruit"]. "Lemon Verbena" → ["Fruity", "Citrus Fruit"] (the lemon directive dominates; do not split).

4. Climb to tier 1 only when no tier-2 captures the input. "Fruity" itself stays at ["Fruity"].

5. For compound tags where two parts point to genuinely different tier-1 categories with no common ancestor, return null. "Plum Cake" (Fruity + Spices) → null.

6. Mouthfeel and body descriptors are not flavors. Return null. Examples: "Smooth", "Creamy", "Silky", "Heavy", "Light Body", "Round".

7. Vague marketing language returns null. Examples: "Aromatic", "Complex", "Balanced", "Clean", "Bold", "Exceptional".

You will receive a JSON object {{"tags": [...]}} containing every unique tag in one batch. Return JSON only, no prose, with one result entry per input tag preserving the input string verbatim:

{{
  "results": [
    {{"input": "Wild Honey", "address": ["Sweet", "Brown Sugar", "Honey"]}},
    {{"input": "Stone Fruit", "address": ["Fruity", "Other Fruit"]}},
    {{"input": "Smooth", "address": null}}
  ]
}}

The full tree is below. Use these exact strings — case, punctuation, slashes must match.

{_TREE_JSON}
"""


# ---------------------------------------------------------------------------
# Validation

def is_valid_address(addr, tree):
    """An address is a list of 1–3 strings forming a valid path through the tree."""
    if not isinstance(addr, list) or not (1 <= len(addr) <= 3):
        return False
    if not all(isinstance(x, str) for x in addr):
        return False
    t1 = addr[0]
    if t1 not in tree:
        return False
    if len(addr) == 1:
        return True
    t2 = addr[1]
    if t2 not in tree[t1]:
        return False
    if len(addr) == 2:
        return True
    t3 = addr[2]
    return t3 in tree[t1][t2]


# ---------------------------------------------------------------------------
# Haiku call — single batched request for all unique tags

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _extract_json(text):
    """Defensively strip code fences in case the model wraps the output."""
    return _JSON_FENCE_RE.sub("", text.strip()).strip()


def call_haiku_batched(unique_tags, log):
    """Send ALL unique tags in one Haiku call. Streams to stay under timeouts."""
    import anthropic  # local import so unit tests / cached runs don't need it

    client = anthropic.Anthropic(max_retries=SDK_MAX_RETRIES)
    user_msg = json.dumps({"tags": unique_tags}, ensure_ascii=False)

    log(f"calling Haiku with {len(unique_tags)} unique tags (streaming)...")
    t0 = time.time()
    with client.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for _ in stream.text_stream:
            pass
        msg = stream.get_final_message()

    text = next((b.text for b in msg.content if b.type == "text"), "")
    parsed = json.loads(_extract_json(text))
    log(
        f"Haiku returned in {time.time() - t0:.1f}s | "
        f"input={msg.usage.input_tokens} cache_read={getattr(msg.usage, 'cache_read_input_tokens', 0)} "
        f"output={msg.usage.output_tokens}"
    )
    return parsed


# ---------------------------------------------------------------------------
# Resolution map

def build_resolutions(unique_tags, log, refresh=False):
    """Returns {tag: address|None}. Loads cache if present unless refresh=True."""
    if not refresh and CACHE_PATH.exists():
        with open(CACHE_PATH) as f:
            cached = json.load(f)
        cached.pop("_comment", None)
        # Trust the cache as long as every unique tag is covered.
        missing = [t for t in unique_tags if t not in cached]
        if not missing:
            log(f"loaded {len(cached)} cached resolutions from {CACHE_PATH.relative_to(PROJECT_ROOT)}")
            return cached, []
        log(f"cache hit but missing {len(missing)} tag(s); re-calling Haiku")

    parsed = call_haiku_batched(unique_tags, log)
    resolutions = {}
    invalid = []
    for entry in parsed.get("results", []):
        inp = entry.get("input")
        addr = entry.get("address")
        if not isinstance(inp, str):
            continue
        if addr is None:
            resolutions[inp] = None
        elif is_valid_address(addr, TREE):
            resolutions[inp] = addr
        else:
            invalid.append((inp, addr))
            resolutions[inp] = None

    # Any tags Haiku didn't return at all → null
    for t in unique_tags:
        resolutions.setdefault(t, None)

    # Persist
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(resolutions, f, indent=2, ensure_ascii=False)
    log(f"wrote {len(resolutions)} resolutions to {CACHE_PATH.relative_to(PROJECT_ROOT)}")

    return resolutions, invalid


# ---------------------------------------------------------------------------
# Adjacency algorithm — top-k tag recommendations

def recommend_tags(addresses, tree, k=3):
    candidate_scores = {}
    for addr in addresses:
        t1 = addr[0]
        t1_subtree = tree[t1]

        if len(addr) == 3:
            t2, t3 = addr[1], addr[2]
            for sibling in t1_subtree[t2]:
                if sibling != t3:
                    candidate_scores[sibling] = candidate_scores.get(sibling, 0) + 3
            for other_t2, leaves in t1_subtree.items():
                if other_t2 != t2:
                    for leaf in leaves:
                        candidate_scores[leaf] = candidate_scores.get(leaf, 0) + 1

        elif len(addr) == 2:
            t2 = addr[1]
            for leaf in t1_subtree.get(t2, []):
                candidate_scores[leaf] = candidate_scores.get(leaf, 0) + 2
            for other_t2 in t1_subtree:
                if other_t2 != t2:
                    candidate_scores[other_t2] = candidate_scores.get(other_t2, 0) + 1

        else:  # tier-1
            for t2, leaves in t1_subtree.items():
                candidate_scores[t2] = candidate_scores.get(t2, 0) + 2
                for leaf in leaves:
                    candidate_scores[leaf] = candidate_scores.get(leaf, 0) + 1

    input_names = {addr[-1] for addr in addresses}
    for name in input_names:
        candidate_scores.pop(name, None)

    return sorted(candidate_scores.items(), key=lambda x: (-x[1], x[0]))[:k]


# ---------------------------------------------------------------------------
# Similarity algorithm

def address_pair_score(a, b):
    if a[0] != b[0]:
        return 0
    if len(a) >= 2 and len(b) >= 2 and a[1] == b[1]:
        if len(a) == 3 and len(b) == 3 and a[2] == b[2]:
            return 3
        return 2
    return 1


def coffee_similarity(addrs_a, addrs_b):
    available = list(addrs_b)
    total = 0
    for a in addrs_a:
        if not available:
            break
        best_idx, best_score = None, -1
        for i, b in enumerate(available):
            s = address_pair_score(a, b)
            if s > best_score:
                best_idx, best_score = i, s
        if best_idx is not None and best_score > 0:
            total += best_score
            available.pop(best_idx)
    return total


# ---------------------------------------------------------------------------
# Pretty-printing

def fmt_addr(addr):
    return "[" + ", ".join(addr) + "]"


def label(text):
    return f"{text:<{LABEL_WIDTH}}"


def cont():
    return " " * LABEL_WIDTH


def print_block(item, log, similar_top=None):
    log(f"=== {item['name']} by {item['roaster']} ===")
    log(label("Roaster tags:") + ", ".join(item["tags"]))

    results = item["results"]
    if not results:
        log(label("Resolved:") + "(no tags)")
        log("")
        return

    for idx, r in enumerate(results):
        prefix = label("Resolved:") if idx == 0 else cont()
        rhs = fmt_addr(r["address"]) if r["address"] else "null"
        log(f"{prefix}{r['input']} → {rhs}")

    valid_addrs = [r["address"] for r in results if r["address"]]
    if valid_addrs:
        recs = recommend_tags(valid_addrs, TREE, k=3)
        rec_str = ", ".join(f"{n} ({s})" for n, s in recs) if recs else "(none)"
        log(label("Recommended:") + rec_str)
    else:
        log(label("Recommended:") + "(no valid addresses)")

    if similar_top is not None:
        if similar_top:
            for j, (score, n, r) in enumerate(similar_top):
                prefix = label("Similar coffees:") if j == 0 else cont()
                log(f"{prefix}{j + 1}. {n} by {r} — score {score}")
        else:
            log(label("Similar coffees:") + "(none)")

    log("")


# ---------------------------------------------------------------------------
# Driver

def make_logger(log_path):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(log_path, "w", encoding="utf-8")

    def log(line=""):
        print(line)
        fh.write(line + "\n")
        fh.flush()

    return log, fh


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--refresh", action="store_true", help="ignore cached resolutions, re-call Haiku")
    p.add_argument("--no-pause", action="store_true", help="skip the human-review pause (useful for re-runs)")
    args = p.parse_args()

    if not INPUT_PATH.exists():
        print(f"error: {INPUT_PATH} not found", file=sys.stderr)
        sys.exit(2)

    log, log_fh = make_logger(LOG_PATH)
    try:
        log(f"# tag_resolver_test — {time.strftime('%Y-%m-%d %H:%M:%S')}")
        log(f"# model: {MODEL}")
        log(f"# input: {INPUT_PATH.relative_to(PROJECT_ROOT)}")

        with open(INPUT_PATH) as f:
            data = json.load(f)
        coffees = [c for c in data if c.get("flavor_notes")]

        # Collect unique tags across the catalog (sorted for stable prompts)
        from collections import Counter
        tag_counts = Counter()
        for c in coffees:
            for t in c["flavor_notes"]:
                tag_counts[t] += 1
        unique_tags = sorted(tag_counts.keys())

        log(f"# coffees with flavor_notes: {len(coffees)}/{len(data)}")
        log(f"# unique flavor_notes: {len(unique_tags)}")
        log("")

        # ---- single batched call (or cache load) ----
        if args.refresh or not CACHE_PATH.exists():
            if not os.environ.get("ANTHROPIC_API_KEY"):
                print("error: ANTHROPIC_API_KEY not set (and no cached resolutions at "
                      f"{CACHE_PATH})", file=sys.stderr)
                sys.exit(2)

        resolutions, invalid_returns = build_resolutions(unique_tags, log, refresh=args.refresh)

        # Coverage stats
        null_tags = [t for t, a in resolutions.items() if a is None]
        depth_dist = {1: 0, 2: 0, 3: 0}
        for t, a in resolutions.items():
            if a:
                depth_dist[len(a)] += 1

        log(f"resolutions: {len(resolutions)} total, "
            f"{len(null_tags)} null ({100*len(null_tags)/max(len(resolutions),1):.1f}%), "
            f"depths tier1={depth_dist[1]} tier2={depth_dist[2]} tier3={depth_dist[3]}")
        if invalid_returns:
            log(f"validation failures (returned-but-invalid): {len(invalid_returns)}")
            for inp, addr in invalid_returns:
                log(f"  - {inp!r} → {addr!r}")
        log("")

        # ---- preview pause ----
        if not args.no_pause:
            log(f"=========== preview: top {PREVIEW_TAGS} most-common tag resolutions ===========")
            log("")
            top_tags = [t for t, _ in tag_counts.most_common(PREVIEW_TAGS)]
            for t in top_tags:
                addr = resolutions[t]
                rhs = fmt_addr(addr) if addr else "null"
                log(f"  {tag_counts[t]:4d}×  {t:30s} → {rhs}")
            null_top = [t for t in top_tags if resolutions[t] is None]
            if null_top:
                log("")
                log(f"  (of those, {len(null_top)} returned null: {', '.join(null_top)})")
            log("")
            log(f"=========== end preview ({len(unique_tags) - PREVIEW_TAGS} more tags resolved) ===========")
            log("")
            log("Type 'yes' to apply these resolutions across the full catalog and print results.")
            log("Anything else aborts.")
            sys.stdout.flush()

            try:
                answer = input("continue? [yes/no]: ").strip().lower()
            except EOFError:
                answer = ""
            log(f"(user typed: {answer!r})")
            if answer != "yes":
                log("aborted by user — exiting")
                return
            log("")

        # ---- apply resolutions to every coffee ----
        items = []
        for coffee in coffees:
            name = coffee.get("coffee_name") or "?"
            roaster = coffee.get("roaster_name") or "?"
            tags = list(coffee["flavor_notes"])
            results = [
                {"input": t, "address": resolutions.get(t)}
                for t in tags
            ]
            items.append({"name": name, "roaster": roaster, "tags": tags, "results": results})

        # ---- compute similar coffees across the whole catalog ----
        addrs_per_item = [
            [r["address"] for r in it["results"] if r["address"]]
            for it in items
        ]
        similar_per_item = []
        for i, item in enumerate(items):
            my_addrs = addrs_per_item[i]
            if not my_addrs:
                similar_per_item.append([])
                continue
            scored = []
            for j, other in enumerate(items):
                if i == j:
                    continue
                other_addrs = addrs_per_item[j]
                if not other_addrs:
                    continue
                s = coffee_similarity(my_addrs, other_addrs)
                if s > 0:
                    scored.append((s, other["name"], other["roaster"]))
            scored.sort(key=lambda x: (-x[0], x[1], x[2]))
            similar_per_item.append(scored[:3])

        # ---- final printout ----
        log("=========== full catalog results ===========")
        log("")
        for item, sim in zip(items, similar_per_item):
            print_block(item, log, similar_top=sim)

        # ---- summary ----
        total_tags = sum(len(it["results"]) for it in items)
        null_count = sum(1 for it in items for r in it["results"] if r["address"] is None)
        catalog_depth_dist = {1: 0, 2: 0, 3: 0}
        for it in items:
            for r in it["results"]:
                if r["address"]:
                    catalog_depth_dist[len(r["address"])] += 1

        log("=========== summary ===========")
        log(f"coffees processed:        {len(items)}")
        log(f"unique tags:              {len(unique_tags)}")
        log(f"  - resolved to address:  {len(unique_tags) - len(null_tags)}")
        log(f"  - resolved to null:     {len(null_tags)}")
        log(f"total tag occurrences:    {total_tags}")
        if total_tags:
            log(f"  - null occurrences:     {null_count} "
                f"({100 * null_count / total_tags:.1f}%)")
        log(f"address depth (per occurrence):")
        log(f"  - tier 1: {catalog_depth_dist[1]}")
        log(f"  - tier 2: {catalog_depth_dist[2]}")
        log(f"  - tier 3: {catalog_depth_dist[3]}")
        if invalid_returns:
            log(f"haiku-returned-but-invalid: {len(invalid_returns)}")
            for inp, addr in invalid_returns:
                log(f"  - {inp!r} → {addr!r}")
        else:
            log("haiku-returned-but-invalid: 0")

        log("")
        log(f"log:         {LOG_PATH.relative_to(PROJECT_ROOT)}")
        log(f"resolutions: {CACHE_PATH.relative_to(PROJECT_ROOT)}")

    finally:
        log_fh.close()


if __name__ == "__main__":
    main()
