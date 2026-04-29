"""
SCA flavor-tree geolocation service.

Lifts the reusable bits of `tag_resolver_test.py` into a service module the
admin Taste Graph tab can call:

  * `is_valid_address(addr, tree)` — validates a returned address against a
    3-tier tree.
  * `extract_json(text)` — strips ``` fences from a Haiku response.
  * `parse_tree_json(text)` — defensively validates an uploaded tree JSON
    has the expected 3-tier shape (raises ValueError on bad structure).
  * `select_exemplars(db, *, limit=40)` — picks up to 40 entries from
    `sca_addresses` to embed in the system prompt (top-N by frequency,
    admin overrides, distinct tier-2 buckets), per LAUNCH_TODO §3.8.
  * `classify_tags(tags, tree, exemplars)` — single batched Haiku call
    with the tree + exemplars in a cache-controlled system prompt.
  * `compute_geolocate_stats(db)` — counts tags / classified / null /
    unclassified used by the admin sub-tab top section.
  * `validate_tree_against_addresses(db, new_tree)` — produces the diff
    buckets the upload UI shows (`still_valid`, `now_invalid`,
    `would_change_meaning`).

The classification logic stays consistent with the standalone script so
output cached in `tasting_notes_tags/tag_resolutions.json` is
interchangeable with rows written by this service.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Iterable

# ── Canonical SCA flavor tree ───────────────────────────────────────────────
# Mirrors `tag_resolver_test.TREE`. The on-disk seed is loaded from this
# constant the first time `database.init_db()` runs; subsequent runs read
# the active row from `sca_tree_versions`.

CANONICAL_TREE: dict = {
    "Floral": {
        "Black Tea": [],
        "Floral": ["Chamomile", "Rose", "Jasmine"],
    },
    "Fruity": {
        "Berry": ["Blackberry", "Raspberry", "Blueberry", "Strawberry"],
        "Dried Fruit": ["Raisin", "Prune"],
        "Other Fruit": ["Coconut", "Cherry", "Pomegranate", "Pineapple",
                         "Grape", "Apple", "Peach", "Pear"],
        "Citrus Fruit": ["Grapefruit", "Orange", "Lemon", "Lime"],
    },
    "Sour/Fermented": {
        "Sour": ["Sour Aromatics", "Acetic Acid", "Butyric Acid",
                  "Isovaleric Acid", "Citric Acid", "Malic Acid"],
        "Alcohol/Fermented": ["Winey", "Whiskey", "Fermented", "Overripe"],
    },
    "Green/Vegetative": {
        "Olive Oil": [],
        "Raw": [],
        "Green/Vegetative": ["Under-ripe", "Peapod", "Fresh", "Dark Green",
                              "Vegetative", "Hay-like", "Herb-like"],
        "Beany": [],
    },
    "Other": {
        "Papery/Musty": ["Stale", "Cardboard", "Papery", "Woody",
                          "Moldy/Damp", "Musty/Dusty", "Musty/Earthy",
                          "Animalic", "Meaty Brothy", "Phenolic"],
        "Chemical": ["Bitter", "Salty", "Medicinal", "Petroleum",
                      "Skunky", "Rubber"],
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

MODEL_VERSION = "claude-haiku-4-5-20251001"
MAX_TOKENS = 32000
SDK_MAX_RETRIES = 4

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


# ── Validators ──────────────────────────────────────────────────────────────

def is_valid_address(addr, tree: dict) -> bool:
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


def parse_tree_json(text: str) -> dict:
    """Parse a JSON string and validate it structurally as a 3-tier tree.
    Raises ValueError on bad structure with a human-readable message."""
    try:
        tree = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e.msg} (line {e.lineno}, col {e.colno})")
    if not isinstance(tree, dict) or not tree:
        raise ValueError("Top level must be a non-empty object (tier-1 categories).")
    for t1, t1_subtree in tree.items():
        if not isinstance(t1, str) or not t1:
            raise ValueError("Tier-1 keys must be non-empty strings.")
        if not isinstance(t1_subtree, dict):
            raise ValueError(f"Tier-1 '{t1}': value must be an object of tier-2 buckets.")
        for t2, t2_leaves in t1_subtree.items():
            if not isinstance(t2, str) or not t2:
                raise ValueError(f"Tier-2 keys under '{t1}' must be non-empty strings.")
            if not isinstance(t2_leaves, list):
                raise ValueError(f"Tier-2 '{t1} > {t2}': value must be an array of tier-3 leaves.")
            for leaf in t2_leaves:
                if not isinstance(leaf, str) or not leaf:
                    raise ValueError(
                        f"Tier-3 leaves under '{t1} > {t2}' must be non-empty strings."
                    )
    return tree


def extract_json(text: str) -> str:
    """Strip code fences in case the model wraps the output."""
    return _JSON_FENCE_RE.sub("", text.strip()).strip()


# ── Tag harvesting from products ────────────────────────────────────────────

def harvest_product_tags(db) -> Counter:
    """Walk every row in `products` and return a Counter of tag → occurrence
    count. Pulls from both `flavor_notes` (JSON list) and `tasting_notes`
    (free-form comma-separated string).

    The same tag can appear in either column; counts are summed so the
    "highest-frequency" exemplar selection reflects real catalog weight.
    """
    counts: Counter = Counter()
    rows = db.execute(
        "SELECT flavor_notes, tasting_notes FROM products WHERE available = 1"
    ).fetchall()
    for r in rows:
        # flavor_notes — usually JSON list, sometimes a CSV string
        raw = r["flavor_notes"]
        if raw:
            tags = _coerce_tag_list(raw)
            for t in tags:
                counts[t] += 1
        # tasting_notes — comma / slash / "and" separated free text
        notes = r["tasting_notes"]
        if isinstance(notes, str) and notes.strip():
            for t in _split_tasting_notes(notes):
                counts[t] += 1
    return counts


def _coerce_tag_list(raw) -> list[str]:
    """Accept JSON-list-as-string, real list, or CSV-as-string."""
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    if not isinstance(raw, str):
        return []
    s = raw.strip()
    if not s:
        return []
    if s.startswith("[") and s.endswith("]"):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(t).strip() for t in parsed if str(t).strip()]
        except json.JSONDecodeError:
            pass
    return _split_tasting_notes(s)


def _split_tasting_notes(s: str) -> list[str]:
    """Split a comma/slash/and-separated string into clean tag tokens."""
    parts = re.split(r"\s*[,&/|]\s*|\s+and\s+", s)
    out = []
    for p in parts:
        p = p.strip().strip(".").strip()
        if p and len(p) <= 50:
            out.append(p.title() if p.islower() or p.isupper() else p)
    return out


# ── Storage helpers ─────────────────────────────────────────────────────────

def address_to_columns(addr: list[str] | None) -> tuple:
    """Pack an address list into (t1, t2, t3, is_null) for storage."""
    if addr is None:
        return (None, None, None, 1)
    t1 = addr[0] if len(addr) >= 1 else None
    t2 = addr[1] if len(addr) >= 2 else None
    t3 = addr[2] if len(addr) >= 3 else None
    return (t1, t2, t3, 0)


def columns_to_address(t1, t2, t3, is_null) -> list[str] | None:
    """Inverse of `address_to_columns`."""
    if is_null:
        return None
    if not t1:
        return None
    out = [t1]
    if t2:
        out.append(t2)
    if t3:
        out.append(t3)
    return out


def get_active_tree(db) -> dict:
    """Return the active SCA tree from `sca_tree_versions`. Falls back to
    `CANONICAL_TREE` if no row is marked active (shouldn't happen after
    seed)."""
    row = db.execute(
        "SELECT tree_json FROM sca_tree_versions WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if not row:
        return CANONICAL_TREE
    try:
        return json.loads(row["tree_json"])
    except (json.JSONDecodeError, TypeError):
        return CANONICAL_TREE


# ── Stats endpoint ──────────────────────────────────────────────────────────

def compute_geolocate_stats(db) -> dict:
    """Top-section stats for the admin Taste Graph sub-tab."""
    counts = harvest_product_tags(db)
    classified_rows = db.execute(
        "SELECT tag, is_null FROM sca_addresses"
    ).fetchall()
    classified = {r["tag"]: r["is_null"] for r in classified_rows}

    geolocated = sum(1 for v in classified.values() if v == 0)
    null_resolved = sum(1 for v in classified.values() if v == 1)
    catalog_tags = set(counts.keys())
    unclassified = [t for t in catalog_tags if t not in classified]

    return {
        "total_catalog_tags": len(catalog_tags),
        "geolocated": geolocated,
        "null_resolved": null_resolved,
        "unclassified": len(unclassified),
        "total_classified_rows": len(classified),
    }


# ── Exemplar selection ──────────────────────────────────────────────────────

def select_exemplars(db, *, limit: int = 40) -> list[dict]:
    """Select up to `limit` exemplars to embed in the Haiku system prompt.

    Per LAUNCH_TODO §3.8 / the Catalog Ops prompt:
      - 20 highest-frequency tags (from product columns) that are already
        classified.
      - 10 admin-overridden entries (`source='admin_override'`).
      - 10 covering distinct tier-2 buckets (one per branch).
    Deduplicate by tag, return in deterministic order.

    Each exemplar dict: { "tag": str, "address": list[str] | None }.
    """
    counts = harvest_product_tags(db)
    rows = {
        r["tag"]: r for r in db.execute(
            "SELECT tag, address_t1, address_t2, address_t3, is_null, source "
            "FROM sca_addresses"
        ).fetchall()
    }

    chosen: dict[str, dict] = {}

    # 20 highest-frequency that have a row
    for tag, _ in counts.most_common():
        if len(chosen) >= 20:
            break
        if tag in rows:
            r = rows[tag]
            chosen[tag] = {
                "tag": tag,
                "address": columns_to_address(
                    r["address_t1"], r["address_t2"], r["address_t3"], r["is_null"],
                ),
            }

    # 10 admin overrides (anything the admin manually corrected — counts as
    # a strong signal even if low-frequency).
    overrides = [r for r in rows.values() if r["source"] == "admin_override"]
    for r in overrides[:10]:
        chosen.setdefault(r["tag"], {
            "tag": r["tag"],
            "address": columns_to_address(
                r["address_t1"], r["address_t2"], r["address_t3"], r["is_null"],
            ),
        })

    # 10 distinct tier-2 buckets — one example per branch so coverage stays
    # broad even when the catalog drifts toward Sweet/Nutty heavy hitters.
    seen_t2: set[tuple[str, str]] = set()
    for r in rows.values():
        if len(chosen) >= limit:
            break
        if r["is_null"] or not r["address_t2"]:
            continue
        key = (r["address_t1"], r["address_t2"])
        if key in seen_t2:
            continue
        seen_t2.add(key)
        chosen.setdefault(r["tag"], {
            "tag": r["tag"],
            "address": columns_to_address(
                r["address_t1"], r["address_t2"], r["address_t3"], r["is_null"],
            ),
        })

    return list(chosen.values())[:limit]


# ── System prompt builder ───────────────────────────────────────────────────

def build_system_prompt(tree: dict, exemplars: list[dict]) -> str:
    """Build the cache-controlled system prompt. Mirrors the structure of
    `tag_resolver_test.SYSTEM_PROMPT` but with embedded exemplars so house
    style propagates as the catalog grows."""
    tree_json = json.dumps(tree, indent=2, ensure_ascii=False)
    exemplar_block = ""
    if exemplars:
        # Render as input/address pairs the model can pattern-match on.
        lines = []
        for e in exemplars:
            addr = e.get("address")
            rhs = json.dumps(addr) if addr else "null"
            lines.append(f'  {{"input": {json.dumps(e["tag"])}, "address": {rhs}}},')
        exemplar_block = (
            "\n\nReference resolutions (already classified — match this style):\n\n"
            "{\n  \"results\": [\n" + "\n".join(lines) + "\n  ]\n}\n"
        )

    return f"""You map coffee tasting note tags onto the SCA flavor tree. For each input tag, return the single deepest address that captures it, or null.

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

{tree_json}{exemplar_block}
"""


# ── Haiku call ──────────────────────────────────────────────────────────────

class GeolocatorError(RuntimeError):
    """Raised when the geolocator can't run for a reason the admin should
    see (missing key, missing SDK, Haiku failure)."""


def classify_tags(tags: list[str], tree: dict, exemplars: list[dict],
                   *, log=None) -> dict:
    """Single batched Haiku call. Returns a dict {tag: address|None}.

    Raises GeolocatorError with a clear message if the env / SDK / API
    is unavailable so the admin tab can surface a 503 instead of a stack
    trace.
    """
    if not tags:
        return {}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise GeolocatorError(
            "ANTHROPIC_API_KEY is not set. Export it in the shell that runs "
            "the FastAPI server (export ANTHROPIC_API_KEY=sk-...)."
        )

    try:
        import anthropic  # local import — same pattern as tag_resolver_test
    except ImportError as e:
        raise GeolocatorError(
            "anthropic SDK isn't installed. `pip install anthropic` in the "
            "Python env that runs the FastAPI server."
        ) from e

    client = anthropic.Anthropic(max_retries=SDK_MAX_RETRIES)
    user_msg = json.dumps({"tags": tags}, ensure_ascii=False)
    system_prompt = build_system_prompt(tree, exemplars)

    if log:
        log(f"calling Haiku with {len(tags)} unique tags...")
    t0 = time.time()
    with client.messages.stream(
        model=MODEL_VERSION,
        max_tokens=MAX_TOKENS,
        temperature=0,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for _ in stream.text_stream:
            pass
        msg = stream.get_final_message()

    text = next((b.text for b in msg.content if b.type == "text"), "")
    if log:
        cache_read = getattr(msg.usage, "cache_read_input_tokens", 0)
        log(
            f"Haiku returned in {time.time() - t0:.1f}s | "
            f"input={msg.usage.input_tokens} cache_read={cache_read} "
            f"output={msg.usage.output_tokens}"
        )

    try:
        parsed = json.loads(extract_json(text))
    except json.JSONDecodeError as e:
        raise GeolocatorError(
            f"Haiku response wasn't valid JSON: {e.msg}. First 200 chars: {text[:200]!r}"
        ) from e

    out: dict[str, list[str] | None] = {}
    invalid: list[tuple[str, list]] = []
    for entry in parsed.get("results", []) or []:
        inp = entry.get("input")
        addr = entry.get("address")
        if not isinstance(inp, str):
            continue
        if addr is None:
            out[inp] = None
        elif is_valid_address(addr, tree):
            out[inp] = addr
        else:
            invalid.append((inp, addr))
            out[inp] = None
    # Tags Haiku didn't return at all → null
    for t in tags:
        out.setdefault(t, None)

    if log and invalid:
        log(f"validation failures (returned-but-invalid): {len(invalid)}")
        for inp, addr in invalid[:20]:
            log(f"  - {inp!r} → {addr!r}")

    return out


# ── Tree validation diff ────────────────────────────────────────────────────

def validate_tree_against_addresses(db, new_tree: dict) -> dict:
    """Compare every row in `sca_addresses` against `new_tree` and bucket
    each tag into `still_valid`, `now_invalid`, or `would_change_meaning`.

    `would_change_meaning` covers the case where a tag's tier-3 leaf moves
    under a different tier-2 (or a tier-2 has been renamed), so the address
    *path* would no longer point at the same leaf in the new tree even if
    the leaf string still exists somewhere.
    """
    still_valid: list[dict] = []
    now_invalid: list[dict] = []
    changed_meaning: list[dict] = []

    rows = db.execute(
        "SELECT tag, address_t1, address_t2, address_t3, is_null FROM sca_addresses"
    ).fetchall()
    for r in rows:
        tag = r["tag"]
        if r["is_null"]:
            still_valid.append({"tag": tag, "address": None})
            continue
        addr = columns_to_address(
            r["address_t1"], r["address_t2"], r["address_t3"], r["is_null"],
        )
        if not addr:
            still_valid.append({"tag": tag, "address": None})
            continue

        if is_valid_address(addr, new_tree):
            still_valid.append({"tag": tag, "address": addr})
            continue

        # Try a "moved leaf" detection — find the leaf string anywhere in
        # the new tree. If it exists under a different parent, that's a
        # meaning change. If it's gone entirely, that's now_invalid.
        leaf = addr[-1]
        new_paths = _find_paths_to_leaf(new_tree, leaf)
        if new_paths:
            changed_meaning.append({
                "tag": tag,
                "old_address": addr,
                "new_paths": new_paths,
            })
        else:
            now_invalid.append({"tag": tag, "address": addr})

    return {
        "still_valid": {"count": len(still_valid), "items": still_valid[:200]},
        "now_invalid": {"count": len(now_invalid), "items": now_invalid[:200]},
        "would_change_meaning": {
            "count": len(changed_meaning),
            "items": changed_meaning[:200],
        },
    }


def _find_paths_to_leaf(tree: dict, leaf: str) -> list[list[str]]:
    """Return every address path in `tree` that ends in `leaf`."""
    paths: list[list[str]] = []
    for t1, t1_subtree in tree.items():
        if t1 == leaf:
            paths.append([t1])
        if not isinstance(t1_subtree, dict):
            continue
        for t2, leaves in t1_subtree.items():
            if t2 == leaf:
                paths.append([t1, t2])
            if isinstance(leaves, list):
                for leaf3 in leaves:
                    if leaf3 == leaf:
                        paths.append([t1, t2, leaf3])
    return paths


# ── Migration / backfill helpers ────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SEED_RESOLUTIONS_PATH = PROJECT_ROOT / "tmp" / "tag_resolutions.json"
