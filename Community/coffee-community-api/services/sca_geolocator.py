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

from services.llm_router import call_llm, LLMCallError

# Tool wrapper for routing free-text JSON Haiku calls through the
# provider-routed `call_llm`. The system prompt already instructs
# Haiku on the exact JSON shape to emit; the tool's input_schema
# stays permissive so the existing prompt design carries the
# shape contract instead.
_GENERIC_RESULT_TOOL = {
    "name": "emit_result",
    "description": (
        "Emit the structured result as a JSON object whose shape exactly "
        "matches what the system prompt describes."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": True,
    },
}

# ── Canonical SCA flavor tree ───────────────────────────────────────────────
# Mirrors `tag_resolver_test.TREE`. The on-disk seed is loaded from this
# constant the first time `database.init_db()` runs; subsequent runs read
# the active row from `sca_tree_versions`.

# Schema-shape moved out of code into JSON files at
# `services/flavor_schemas/`. Source-of-truth is whichever
# `sca_tree_versions` row has `is_active=1`; `get_active_schema()` reads
# that row, with a built-in fallback for the boot path before the
# first-seed has run.
FALLBACK_SCHEMA: dict = {
    "kind": "single_tier",
    "version": "fallback",
    "label": "Fallback (boot-time)",
    "sectors": [
        {"name": "Chocolate", "absorbs": []},
        {"name": "Caramel",   "absorbs": []},
        {"name": "Floral",    "absorbs": []},
        {"name": "Citrus",    "absorbs": []},
        {"name": "Berry",     "absorbs": []},
        {"name": "Fresh fruit","absorbs": []},
        {"name": "Dried",     "absorbs": []},
        {"name": "Spice",     "absorbs": []},
        {"name": "Nutty",     "absorbs": []},
        {"name": "Earthy",    "absorbs": []},
    ],
}

MODEL_VERSION = "claude-haiku-4-5-20251001"
MAX_TOKENS = 32000
SDK_MAX_RETRIES = 4

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


# ── Validators ──────────────────────────────────────────────────────────────

def schema_sector_names(schema: dict) -> list[str]:
    """Sector names in declaration order — the order is also the wheel
    layout, clockwise from 12 o'clock."""
    return [s.get("name", "") for s in (schema or {}).get("sectors", [])
            if isinstance(s, dict) and s.get("name")]


def is_valid_address(addr, schema: dict) -> bool:
    """An address is a single-element list `[sector_name]` whose name
    matches one of the schema's sectors. Single-tier schemas only —
    multi-tier addresses (`[t1, t2, t3]`) are rejected."""
    if not isinstance(addr, list) or len(addr) != 1:
        return False
    name = addr[0]
    if not isinstance(name, str) or not name:
        return False
    return name in schema_sector_names(schema)


def parse_tree_json(text: str) -> dict:
    """Parse + validate a single-tier flavor schema JSON. Returns the
    schema dict on success, raises ValueError with a human-readable
    message on bad shape."""
    try:
        schema = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e.msg} (line {e.lineno}, col {e.colno})")
    if not isinstance(schema, dict):
        raise ValueError("Top level must be an object.")
    kind = schema.get("kind")
    if kind != "single_tier":
        raise ValueError(
            f"Schema kind must be 'single_tier' (got {kind!r}). "
            "Multi-tier schemas are no longer supported."
        )
    sectors = schema.get("sectors")
    if not isinstance(sectors, list) or not sectors:
        raise ValueError("'sectors' must be a non-empty array.")
    seen_names: set[str] = set()
    for i, s in enumerate(sectors):
        if not isinstance(s, dict):
            raise ValueError(f"sectors[{i}] must be an object.")
        name = s.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"sectors[{i}].name must be a non-empty string.")
        if name in seen_names:
            raise ValueError(f"Duplicate sector name {name!r}.")
        seen_names.add(name)
        absorbs = s.get("absorbs", [])
        if not isinstance(absorbs, list):
            raise ValueError(f"sectors[{i}].absorbs must be an array.")
        for j, a in enumerate(absorbs):
            if not isinstance(a, str) or not a.strip():
                raise ValueError(
                    f"sectors[{i}].absorbs[{j}] must be a non-empty string."
                )
    return schema


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
    """Pack an address list into (t1, t2, t3, is_null) for storage.
    Single-tier schema: only t1 ever carries a value; t2 and t3 are
    permanently NULL. The columns are kept for table-shape stability
    so older rows + admin queries continue to work."""
    if addr is None:
        return (None, None, None, 1)
    t1 = addr[0] if len(addr) >= 1 else None
    return (t1, None, None, 0)


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


def get_active_schema(db) -> dict:
    """Return the active flavor schema from `sca_tree_versions`. Falls
    back to `FALLBACK_SCHEMA` if no row is marked active (shouldn't
    happen after seed)."""
    row = db.execute(
        "SELECT tree_json FROM sca_tree_versions WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if not row:
        return FALLBACK_SCHEMA
    try:
        parsed = json.loads(row["tree_json"])
        if isinstance(parsed, dict) and parsed.get("kind") == "single_tier":
            return parsed
        return FALLBACK_SCHEMA
    except (json.JSONDecodeError, TypeError):
        return FALLBACK_SCHEMA


# Back-compat alias — older imports still call `get_active_tree`. New
# code should use `get_active_schema` for clarity.
get_active_tree = get_active_schema


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
    """Back-compat shim — delegates to the schema-aware
    `build_tasting_prompt`. Kept so existing callers (legacy geolocate
    job in catalog_ops) don't need rewiring."""
    return build_tasting_prompt(tree, exemplars)


# ── Haiku call ──────────────────────────────────────────────────────────────

class GeolocatorError(RuntimeError):
    """Raised when the geolocator can't run for a reason the admin should
    see (missing key, missing SDK, Haiku failure)."""


def classify_tags(tags: list[str], tree: dict, exemplars: list[dict],
                   *, log=None) -> dict:
    """Legacy single-batch tasting classifier — routes through `call_llm`
    via `_haiku_call_json`. Returns a dict {tag: address|None}.

    Kept for the legacy `geolocate` job kind in catalog_ops; the
    5-task standardize path uses `classify_tasting` etc. directly.
    """
    if not tags:
        return {}
    if log:
        log(f"calling Haiku with {len(tags)} unique tags...")
    parsed = _haiku_call_json(
        "geolocate_tasting",
        build_system_prompt(tree, exemplars),
        {"tags": tags},
        log=log,
    )

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


# ────────────────────────────────────────────────────────────────────────────
# CATALOG STANDARDIZATION (renamed MAPPING tab) — three tasks, one Haiku call
# ────────────────────────────────────────────────────────────────────────────
#
# Extends the SCA-only classifier to also map:
#   • origins → estate name / Multi-estate / International / Unknown
#   • varietals → canonical variety + species + morphology
# both against a code-shipped JSON tree (`seed_data/coffee_varieties.json`)
# sourced from World Coffee Research + India Coffee Board / CCRI.
#
# All three tasks ship in one batched Haiku call so the prompt cache is
# amortized across a single system-prompt blob. Exemplars are cached in
# `standardize_exemplars` and only resampled when the admin ticks
# "Regenerate exemplars on next run" — keeps the cache key stable.

VARIETY_TREE_PATH = (
    Path(__file__).resolve().parent.parent / "seed_data" / "coffee_varieties.json"
)


def load_variety_tree() -> dict:
    """Read the coffee variety reference tree from disk. Cached at module
    scope after the first read since the file ships with the codebase."""
    global _variety_tree_cache
    try:
        return _variety_tree_cache  # type: ignore[name-defined]
    except NameError:
        pass
    with open(VARIETY_TREE_PATH, "r", encoding="utf-8") as f:
        tree = json.load(f)
    globals()["_variety_tree_cache"] = tree
    return tree


# ── Harvesters ──────────────────────────────────────────────────────────────

def harvest_origins(db) -> Counter:
    """Counter of distinct `origin` strings across in-stock products. Empty
    / NULL skipped — those rows just map to "Unknown" without a Haiku call."""
    counts: Counter = Counter()
    rows = db.execute(
        "SELECT origin FROM products WHERE available = 1 AND origin IS NOT NULL "
        "AND origin != ''"
    ).fetchall()
    for r in rows:
        s = (r["origin"] or "").strip()
        if s:
            counts[s] += 1
    return counts


def harvest_roasts(db) -> Counter:
    """Counter of distinct roast-input strings across in-stock products.
    The "input" is the verbatim `roast_level_name` if present, falling
    back to the bucketed `roast_level` — Haiku gets the richest text
    available so it can collapse drift like "Vienna Roast" / "Light
    City Roast" / "Filter (Light Roast)" into a canonical bucket."""
    counts: Counter = Counter()
    rows = db.execute(
        "SELECT roast_level_name, roast_level FROM products WHERE available = 1"
    ).fetchall()
    for r in rows:
        s = ((r["roast_level_name"] or r["roast_level"]) or "").strip()
        if s and s != "<UNKNOWN>":
            counts[s] += 1
    return counts


def harvest_processes(db) -> Counter:
    """Counter of distinct process-input strings. Prefers `process_raw`
    (verbatim, preserves "Anaerobic Yeast Naturals" specificity) and
    falls back to the bucketed `process` column when raw is missing."""
    counts: Counter = Counter()
    rows = db.execute(
        "SELECT process_raw, process FROM products WHERE available = 1"
    ).fetchall()
    for r in rows:
        s = ((r["process_raw"] or r["process"]) or "").strip()
        if s and s != "<UNKNOWN>":
            counts[s] += 1
    return counts


def harvest_varietals(db) -> Counter:
    """Counter of distinct `varietal` strings across in-stock products."""
    counts: Counter = Counter()
    rows = db.execute(
        "SELECT varietal FROM products WHERE available = 1 AND varietal IS NOT NULL "
        "AND varietal != ''"
    ).fetchall()
    for r in rows:
        s = (r["varietal"] or "").strip()
        if s:
            counts[s] += 1
    return counts


# ── Stats ────────────────────────────────────────────────────────────────────

def compute_standardize_stats(db) -> dict:
    """3-way stats for the STANDARDIZATION sub-tab — mirrors
    `compute_geolocate_stats` but covers all three address tables.

    Each task returns:
      • total — distinct input strings appearing in in-stock products
      • classified — rows in the address table for those inputs
      • unclassified — total - classified (what the next run will Haiku)
    Plus per-task useful breakdowns (multi-estate count, morphology hits, …).
    """
    # Tasting tags
    tag_counts = harvest_product_tags(db)
    sca_rows = {r["tag"]: r for r in db.execute(
        "SELECT tag, is_null FROM sca_addresses"
    ).fetchall()}
    tag_classified = sum(1 for t in tag_counts if t in sca_rows)
    tag_geolocated = sum(1 for t in tag_counts if t in sca_rows and not sca_rows[t]["is_null"])

    # Origins
    origin_counts = harvest_origins(db)
    origin_rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, estate_canonical FROM origin_addresses"
    ).fetchall()}
    origin_classified = sum(1 for s in origin_counts if s in origin_rows)
    origin_buckets = Counter()
    for s in origin_counts:
        if s in origin_rows:
            est = origin_rows[s]["estate_canonical"] or "Unknown"
            if est in ("Multi-estate", "International", "Unknown"):
                origin_buckets[est] += 1
            else:
                origin_buckets["specific_estate"] += 1

    # Varietals
    varietal_counts = harvest_varietals(db)
    varietal_rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, canonical_varietal, bean_type, morphology FROM varietal_addresses"
    ).fetchall()}
    varietal_classified = sum(1 for s in varietal_counts if s in varietal_rows)
    varietal_buckets = Counter()
    for s in varietal_counts:
        if s in varietal_rows:
            r = varietal_rows[s]
            if r["canonical_varietal"] == "Multi-cultivar":
                varietal_buckets["multi_cultivar"] += 1
            elif r["canonical_varietal"]:
                varietal_buckets["specific_varietal"] += 1
            else:
                varietal_buckets["null"] += 1
            if r["morphology"]:
                varietal_buckets["with_morphology"] += 1

    # Roasts
    roast_counts = harvest_roasts(db)
    roast_rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, roast_canonical FROM roast_addresses"
    ).fetchall()}
    roast_classified = sum(1 for s in roast_counts if s in roast_rows)
    roast_buckets = Counter()
    for s in roast_counts:
        if s in roast_rows:
            c = roast_rows[s]["roast_canonical"] or "null"
            roast_buckets[c] += 1

    # Processes
    process_counts = harvest_processes(db)
    process_rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, canonical FROM process_addresses"
    ).fetchall()}
    process_classified = sum(1 for s in process_counts if s in process_rows)
    process_buckets = Counter()
    for s in process_counts:
        if s in process_rows:
            c = process_rows[s]["canonical"] or "null"
            process_buckets[c] += 1

    return {
        "tasting": {
            "total": len(tag_counts),
            "classified": tag_classified,
            "geolocated": tag_geolocated,
            "unclassified": len(tag_counts) - tag_classified,
        },
        "origin": {
            "total": len(origin_counts),
            "classified": origin_classified,
            "unclassified": len(origin_counts) - origin_classified,
            "specific_estate": origin_buckets.get("specific_estate", 0),
            "multi_estate": origin_buckets.get("Multi-estate", 0),
            "international": origin_buckets.get("International", 0),
            "unknown": origin_buckets.get("Unknown", 0),
        },
        "varietal": {
            "total": len(varietal_counts),
            "classified": varietal_classified,
            "unclassified": len(varietal_counts) - varietal_classified,
            "specific_varietal": varietal_buckets.get("specific_varietal", 0),
            "multi_cultivar": varietal_buckets.get("multi_cultivar", 0),
            "with_morphology": varietal_buckets.get("with_morphology", 0),
        },
        "roast": {
            "total": len(roast_counts),
            "classified": roast_classified,
            "unclassified": len(roast_counts) - roast_classified,
            "buckets": dict(roast_buckets),
        },
        "process": {
            "total": len(process_counts),
            "classified": process_classified,
            "unclassified": len(process_counts) - process_classified,
            "buckets": dict(process_buckets),
        },
    }


# ── Exemplar selection (per-task) ───────────────────────────────────────────

def select_roast_exemplars(db, *, limit: int = 20) -> list[dict]:
    """Top-frequency classified roasts. Each entry: {input, roast}."""
    counts = harvest_roasts(db)
    rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, roast_canonical, source FROM roast_addresses"
    ).fetchall()}
    chosen: dict[str, dict] = {}
    for raw, _ in counts.most_common():
        if len(chosen) >= 14:
            break
        if raw in rows:
            chosen[raw] = {"input": raw, "roast": rows[raw]["roast_canonical"]}
    overrides = [r for r in rows.values() if r["source"] == "admin_override"]
    for r in overrides[:6]:
        chosen.setdefault(r["raw_string"], {
            "input": r["raw_string"], "roast": r["roast_canonical"],
        })
    return list(chosen.values())[:limit]


def select_process_exemplars(db, *, limit: int = 20) -> list[dict]:
    """Top-frequency classified processes. Each entry: {input, process}."""
    counts = harvest_processes(db)
    rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, canonical, source FROM process_addresses"
    ).fetchall()}
    chosen: dict[str, dict] = {}
    for raw, _ in counts.most_common():
        if len(chosen) >= 14:
            break
        if raw in rows:
            chosen[raw] = {"input": raw, "process": rows[raw]["canonical"]}
    overrides = [r for r in rows.values() if r["source"] == "admin_override"]
    for r in overrides[:6]:
        chosen.setdefault(r["raw_string"], {
            "input": r["raw_string"], "process": r["canonical"],
        })
    return list(chosen.values())[:limit]


def select_origin_exemplars(db, *, limit: int = 20) -> list[dict]:
    """Top-frequency classified origins — anchors the prompt with concrete
    examples. Each entry: { "input": str, "estate": str|None }."""
    counts = harvest_origins(db)
    rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, estate_canonical, source FROM origin_addresses"
    ).fetchall()}
    chosen: dict[str, dict] = {}
    # 14 highest-frequency that have a row
    for raw, _ in counts.most_common():
        if len(chosen) >= 14:
            break
        if raw in rows:
            chosen[raw] = {"input": raw, "estate": rows[raw]["estate_canonical"]}
    # 6 admin overrides
    overrides = [r for r in rows.values() if r["source"] == "admin_override"]
    for r in overrides[:6]:
        chosen.setdefault(r["raw_string"], {
            "input": r["raw_string"], "estate": r["estate_canonical"]
        })
    return list(chosen.values())[:limit]


def select_varietal_exemplars(db, *, limit: int = 20) -> list[dict]:
    """Same shape as `select_origin_exemplars` but for the varietal table —
    each exemplar carries the three output fields the model has to fill."""
    counts = harvest_varietals(db)
    rows = {r["raw_string"]: r for r in db.execute(
        "SELECT raw_string, canonical_varietal, bean_type, morphology, source "
        "FROM varietal_addresses"
    ).fetchall()}
    chosen: dict[str, dict] = {}
    for raw, _ in counts.most_common():
        if len(chosen) >= 14:
            break
        if raw in rows:
            r = rows[raw]
            chosen[raw] = {
                "input": raw,
                "canonical_varietal": r["canonical_varietal"],
                "bean_type": r["bean_type"],
                "morphology": r["morphology"],
            }
    overrides = [r for r in rows.values() if r["source"] == "admin_override"]
    for r in overrides[:6]:
        chosen.setdefault(r["raw_string"], {
            "input": r["raw_string"],
            "canonical_varietal": r["canonical_varietal"],
            "bean_type": r["bean_type"],
            "morphology": r["morphology"],
        })
    return list(chosen.values())[:limit]


# ── Cached exemplar plumbing ────────────────────────────────────────────────
#
# Exemplars live in the system prompt, which is cache-controlled. To keep
# Anthropic's cache hit warm across runs, we freeze the chosen exemplars
# in `standardize_exemplars` and only resample when the admin explicitly
# opts in via the regen toggle (mirrors the site-prompt-hint pattern).

def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _select_exemplars_for_task(db, task: str) -> list[dict]:
    if task == "tasting":
        return select_exemplars(db)
    if task == "origin":
        return select_origin_exemplars(db)
    if task == "varietal":
        return select_varietal_exemplars(db)
    if task == "roast":
        return select_roast_exemplars(db)
    if task == "process":
        return select_process_exemplars(db)
    raise ValueError(f"unknown exemplar task: {task!r}")


def get_or_refresh_exemplars(db, task: str, *, regenerate: bool, log=None) -> list[dict]:
    """Returns the cached exemplar list for `task`. If `regenerate` is
    true OR the row's `regenerate_next` flag is set OR the row is
    missing, resamples from current data and returns the new list.

    IMPORTANT: an empty selection (cold-start, address-table empty) is
    NOT cached — leaving the row absent so the next run retries. Without
    this guard the first run for a task locks in an empty cache, and
    subsequent runs reuse `[]` even after the address table is full.

    The `regenerate_next` flag is also NOT reset here — that happens
    only after the standardization run completes successfully (see
    `clear_regenerate_next` and the post-success hook in
    `catalog_ops.run_standardize_job`). Resetting mid-run would lose
    the regen intent if the run later fails."""
    row = db.execute(
        "SELECT exemplars_json, regenerate_next FROM standardize_exemplars "
        "WHERE task = ?", (task,)
    ).fetchone()
    needs_refresh = regenerate or row is None or (row and row["regenerate_next"])
    if not needs_refresh:
        try:
            return json.loads(row["exemplars_json"])
        except (json.JSONDecodeError, TypeError):
            needs_refresh = True

    exemplars = _select_exemplars_for_task(db, task)
    if log:
        log(f"resampled {task} exemplars: {len(exemplars)} entries")

    if not exemplars:
        # Cold start — the address table is empty so there's nothing
        # to seed from. Leave the cache row absent (or untouched) so
        # the post-success hook can retry the resample once the
        # writeback populates the table.
        if log:
            log(f"  no {task} exemplars to seed yet — leaving cache row untouched")
        return []

    db.execute(
        "INSERT INTO standardize_exemplars (task, exemplars_json, regenerate_next, generated_at) "
        "VALUES (?, ?, COALESCE((SELECT regenerate_next FROM standardize_exemplars WHERE task = ?), 0), ?) "
        "ON CONFLICT(task) DO UPDATE SET "
        "  exemplars_json = excluded.exemplars_json, "
        "  generated_at = excluded.generated_at",
        (task, json.dumps(exemplars, ensure_ascii=False), task, _now_iso()),
    )
    db.commit()
    return exemplars


def refresh_exemplars_post_run(db, task: str, *, log=None) -> int:
    """Force-resample exemplars for `task` after a successful run.
    Always writes the cache row (even if the new list is empty — the
    result_summary would have flagged this as a problem, but we still
    record the post-run state). Returns the new exemplar count.

    Distinct from `get_or_refresh_exemplars` because that runs at the
    TOP of a job and respects the no-empty-cache rule. This runs at
    the BOTTOM and is the authoritative post-success snapshot."""
    exemplars = _select_exemplars_for_task(db, task)
    db.execute(
        "INSERT INTO standardize_exemplars (task, exemplars_json, regenerate_next, generated_at) "
        "VALUES (?, ?, 0, ?) "
        "ON CONFLICT(task) DO UPDATE SET "
        "  exemplars_json = excluded.exemplars_json, "
        "  regenerate_next = 0, "
        "  generated_at = excluded.generated_at",
        (task, json.dumps(exemplars, ensure_ascii=False), _now_iso()),
    )
    db.commit()
    if log:
        log(f"post-run {task} exemplars refreshed: {len(exemplars)} entries")
    return len(exemplars)


def set_regenerate_next(db, task: str, value: bool = True):
    """Flag an exemplar list for refresh on the next standardization run.
    Idempotent — admin tab calls this when the regen toggle is ticked."""
    if task not in ("tasting", "origin", "varietal", "roast", "process"):
        raise ValueError(f"unknown task: {task!r}")
    db.execute(
        "INSERT INTO standardize_exemplars (task, exemplars_json, regenerate_next, generated_at) "
        "VALUES (?, '[]', ?, ?) "
        "ON CONFLICT(task) DO UPDATE SET regenerate_next = excluded.regenerate_next",
        (task, 1 if value else 0, _now_iso()),
    )
    db.commit()


# ── System prompts (per-task, three smaller calls) ──────────────────────────
#
# Replaces the single mega-prompt approach with one focused prompt per
# task. Trade-off: marginally more prompt-cache cost (three caches
# instead of one), but each call's output budget is dedicated to a
# single schema, so we don't blow MAX_TOKENS when one task happens to
# have a heavy input list. The runner issues these sequentially on a
# single button press.

def _tasting_exemplar_block(items: list[dict]) -> str:
    if not items:
        return "(none)"
    lines = []
    for e in items:
        addr = e.get("address")
        rhs = json.dumps(addr) if addr else "null"
        lines.append(f'  {{"input": {json.dumps(e["tag"])}, "address": {rhs}}}')
    return "[\n" + ",\n".join(lines) + "\n]"


def _origin_exemplar_block(items: list[dict]) -> str:
    if not items:
        return "(none)"
    lines = []
    for e in items:
        est = e.get("estate")
        rhs = json.dumps(est) if est is not None else "null"
        lines.append(f'  {{"input": {json.dumps(e["input"])}, "estate": {rhs}}}')
    return "[\n" + ",\n".join(lines) + "\n]"


def _varietal_exemplar_block(items: list[dict]) -> str:
    if not items:
        return "(none)"
    lines = []
    for e in items:
        cv = json.dumps(e.get("canonical_varietal")) if e.get("canonical_varietal") is not None else "null"
        bt = json.dumps(e.get("bean_type")) if e.get("bean_type") is not None else "null"
        mo = json.dumps(e.get("morphology")) if e.get("morphology") is not None else "null"
        lines.append(
            f'  {{"input": {json.dumps(e["input"])}, '
            f'"canonical_varietal": {cv}, "bean_type": {bt}, "morphology": {mo}}}'
        )
    return "[\n" + ",\n".join(lines) + "\n]"


def build_tasting_prompt(sca_tree: dict, exemplars: list[dict]) -> str:
    """Map free-text flavor tags onto the active single-tier flavor
    schema. For each tag, Haiku returns either a single-element address
    `[sector_name]` or `null`. Sector names come from `sca_tree.sectors[].name`;
    each sector also has an `absorbs` list of exemplar tags Haiku should
    treat as canonical members of that sector."""
    sectors = (sca_tree or {}).get("sectors", []) if isinstance(sca_tree, dict) else []
    schema_label = (sca_tree or {}).get("label", "(unlabeled)")
    schema_version = (sca_tree or {}).get("version", "?")

    # Render the sector menu as a compact list — one line per sector
    # with its absorb-exemplars inline so Haiku has the synonym map
    # right next to the sector name.
    sector_lines = []
    for s in sectors:
        if not isinstance(s, dict):
            continue
        name = s.get("name", "")
        absorbs = s.get("absorbs", []) or []
        absorbs_str = ", ".join(absorbs[:30]) if absorbs else "(no exemplars yet)"
        sector_lines.append(f"  • {name} — absorbs: {absorbs_str}")
    sectors_block = "\n".join(sector_lines)

    sector_names = [s.get("name", "") for s in sectors if isinstance(s, dict)]
    valid_names_str = ", ".join(json.dumps(n) for n in sector_names)

    return f"""You map coffee tasting note tags onto the active Crema flavor schema. For each input tag, return a single-element address `[sector_name]` or `null`.

Schema: {schema_label} (version {schema_version}). The schema has {len(sector_names)} sectors. Use these EXACT sector names — case + spacing must match:

{valid_names_str}.

For each tag, decide: which sector best captures the flavor, or is it not a flavor at all (null)?

Rules:

1. Use the absorbs list as the primary signal. If a tag literally appears in a sector's absorbs list, classify it to that sector.
2. Match flavor character. "Wild Honey" → ["Caramel"] (honey-like sweetness). "Roasted Almond" → ["Nutty"]. "Pink Guava" → ["Fresh fruit"] (or ["Tropical"] depending on the schema).
3. Strip modifiers. "Dark Caramel" → ["Caramel"] (or ["Chocolate"] if absorbed there). "Burnt Caramel" → ["Caramel"].
4. Compound tags spanning unrelated sectors → null. "Plum Cake" (Fresh fruit + Spice) → null.
5. Mouthfeel / body descriptors are not flavors → null. ("Smooth", "Creamy", "Silky", "Heavy", "Light Body", "Round", "Bold", "Velvety", "Buttery", "Mellow", "Crisp", "Bright")
6. Vague marketing language → null. ("Aromatic", "Complex", "Balanced", "Clean", "Exceptional", "Rich", "Full-bodied")
7. Acidity descriptors are not flavors → null. ("Bright Acidity", "Mild Acidity", "Citric Acidity")

═══════════════════════════════════════════════════════════════════════
ACTIVE SCHEMA — SECTORS
═══════════════════════════════════════════════════════════════════════

{sectors_block}

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

The user message is a JSON object: {{"tags": [...]}}

You return JSON only, no prose, no markdown:

{{
  "results": [
    {{"input": "Wild Honey", "address": ["Caramel"]}},
    {{"input": "Pink Guava", "address": ["Fresh fruit"]}},
    {{"input": "Smooth", "address": null}}
  ]
}}

Each output entry MUST have its `input` exactly equal to the input string. Never invent an output entry that wasn't in the input.

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES (already classified — match this style)
═══════════════════════════════════════════════════════════════════════

{_tasting_exemplar_block(exemplars)}
"""


def build_origin_prompt(exemplars: list[dict]) -> str:
    """Normalize raw `origin` strings to estate name / Multi-estate /
    International / Unknown. No tree reference here — the rules ARE the
    canonical shape."""
    return f"""You normalise raw `origin` strings the roaster wrote on each coffee bag. For each input, return ONE of four things:

  • An estate name, normalised — Title Case, ALWAYS suffixed with the word "Estate" regardless of what the roaster wrote ("Farm" / "Farms" / "Plantation" / bare names all become "X Estate").
  • "Multi-estate" — when the input names ≥2 distinct estates, OR is a region/area without a specific estate, OR is generic descriptive language masquerading as an estate name.
  • "International" — when the origin is anywhere outside India.
  • "Unknown" — when no estate or region is named at all (empty / "<UNKNOWN>" / pure blend product names with no farm reference).

Rules:

1. Estate suffix is always "Estate" in the output. Recognise estate-class entities written with: "Estate", "Estates", "Farm", "Farms", "Plantation", "Plantations". Bare named estates with no suffix get "Estate" appended.
     "Ratnagiri Estate"        → "Ratnagiri Estate"
     "Tat Tvam Asi Farms"      → "Tat Tvam Asi Estate"
     "Hoysala Estate"          → "Hoysala Estate"
     "Riverdale"               → "Riverdale Estate"
     "Salawara"                → "Salawara Estate"

2. Strip everything after the first comma/semicolon that names a region, district, state, or country.
     "Kalledevarapura Estate, Bababudangiri, Chikmagalur" → "Kalledevarapura Estate"
     "Mooleh Manay Estate, Coorg"    → "Mooleh Manay Estate"
     "Harley Estate, Sakleshpur"     → "Harley Estate"

3. Multi-estate inputs (≥2 distinct estate proper-nouns joined by `&`, `+`, `and`, `;`, or `,`) → "Multi-estate". DO NOT pick the first.
     "Kalledevarapura Estate & Balur Estate, Chikmagalur" → "Multi-estate"
     "BR Hills, Karnataka; Wayanad, Kerala"               → "Multi-estate"

4. Region-only / state-only / district-only / hill-only / valley-only inputs (no specific estate proper noun) → "Multi-estate". A region IS de facto multi-estate from the consumer's view — it's a sourcing area, not a farm.
     "Coorg" / "Chikmagalur" / "Karnataka" / "Wayanad, Kerala" / "Western Ghats" / "Southern India" / "BR Hills, Karnataka" / "Mysore" / "Bababudan Hills" / "Araku Valley" → "Multi-estate"

5. Generic descriptive language masquerading as an estate name → "Multi-estate". Strings like "Finest Coffee Estate", "Premium Coffee Estate", "Best Coffee Plantation" have no proper-noun specificity.

6. International origins (any country other than India) → "International". Never name the country in the output.
     "Ethiopia" / "Colombia, Huila" / "Yirgacheffe" / "Panama" / "Brazil" → "International"

7. Misspelled Indian regions still resolve to "Multi-estate".
     "Chikmaglur" → "Multi-estate"
     "Chikkamagaluru" → "Multi-estate"

8. Empty / placeholder / pure blend product names (no farm or region reference at all) → "Unknown". This is the bucket the consumer filter hides.
     "<UNKNOWN>" / "House Blend" / "Espresso Blend" / "French Roast" / "Cold Brew Blend" → "Unknown"

9. Title Case the estate name. Mid-word lowercase joiners ("of", "the", "and", "de", "del") stay lowercase unless the roaster capitalised them. Match the roaster's spelling for proper nouns.

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

The user message is a JSON object: {{"origins": [...]}}

You return JSON only, no prose, no markdown:

{{
  "results": [
    {{"input": "Ratnagiri Estate", "estate": "Ratnagiri Estate"}},
    {{"input": "Coorg",            "estate": "Multi-estate"}},
    {{"input": "Ethiopia",         "estate": "International"}},
    {{"input": "House Blend",      "estate": "Unknown"}}
  ]
}}

Each output entry MUST have its `input` exactly equal to the input string. Never invent an output entry that wasn't in the input.

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES (already classified — match this style)
═══════════════════════════════════════════════════════════════════════

{_origin_exemplar_block(exemplars)}
"""


def build_varietal_prompt(variety_tree: dict, exemplars: list[dict]) -> str:
    """Normalize raw `varietal` strings to canonical cultivar + species
    + morphology. Embeds the WCR/CCRI variety tree as the canonical
    name reference."""
    variety_tree_json = json.dumps(variety_tree, indent=2, ensure_ascii=False)
    return f"""You normalise raw `varietal` strings the roaster wrote on each coffee bag. For each input, return THREE fields:

  • canonical_varietal — a variety name from the variety tree below, OR "Multi-cultivar" when ≥2 distinct cultivars are named, OR null when the input is just species labels / marketing prose / a morphology / empty.
  • bean_type — derived from canonical_varietal via the tree's `species` field. Override by direct mention only when the input explicitly names a species combination ("Arabica & Robusta" → "Blend"). One of "Arabica" / "Robusta" / "Blend" / "Liberica" / "Excelsa" / null.
  • morphology — "Peaberry" if the input mentions Peaberry / Caracol / Caracoli / Caracolillo (case-insensitive). Otherwise null. Independent of canonical_varietal.

Rules for canonical_varietal:

1. Match against the variety tree below. The `synonyms` array on each variety lists every drift form Crema's catalog has seen — collapse them to the canonical `name`.
     "S9", "SL9", "SLN9", "SLN-9", "Sln. 9", "Selection 9" → "SLN 9"
     "S795", "Selection 795", "SL795" → "S 795"
     "Catimore" → "Catimor"
     "Selection 12" → "Cauvery"
2. Multi-cultivar entries (≥2 distinct cultivars joined by `+`, `&`, `and`, `,` or `/`) → literal "Multi-cultivar". DO NOT pick a first.
     "Selection 9 + Selection 795 + Cauvery + Kent" → "Multi-cultivar"
     "SLN9 + SLN6 + Chandragiri" → "Multi-cultivar"
     "Bourbon, Caturra, Catimor" → "Multi-cultivar"
   Mixed cultivar + species: when the input names ≥1 specific cultivar AND ≥1 bare species token ("Robusta", "Arabica"), treat it as Multi-cultivar — the cultivar makes it specific enough to surface, the species token tells us bean_type is Blend (when the species pair spans Arabica + Robusta).
     "SLN 9 + Robusta" → "Multi-cultivar" (bean_type "Blend")
     "SLN 795 + Robusta" → "Multi-cultivar" (bean_type "Blend")
     "Chandragiri + Cauvery + Robusta" → "Multi-cultivar" (bean_type "Blend")
     "Arabica, Robusta, Chandragiri" → "Multi-cultivar" (bean_type "Blend")
   Exception: if all listed cultivars are the SAME canonical variety (e.g. "SL9, SLN-9, Sln. 9" → SLN 9), return that single canonical name.
3. Species-only inputs return null:
     "Arabica" / "Robusta" / "Arabica, Robusta" / "Washed Arabica" → null
4. Marketing prose / placeholders → null:
     "Washed Arabica + Various Cherry Varieties" → null
     "Traditional varieties" / "Mixed" / "Various" / "<UNKNOWN>" → null
5. Morphology-only inputs return null for canonical_varietal but surface in `morphology`:
     "Peaberry" → canonical_varietal: null, morphology: "Peaberry"
     "Caracol"  → canonical_varietal: null, morphology: "Peaberry"
6. Bracketed/parenthesised qualifiers strip:
     "SLN 795 HG" → "S 795"
     "Brown Tip - Panama Geisha" → "Geisha"
7. "Kents" in an Indian-context catalog defaults to "S 795" (the Indian Bourbon-Typica selection); standalone "Kent" with no Indian context resolves to "Kent" (the heirloom).

Rules for bean_type:

1. canonical_varietal lookup → use that variety's `species` from the tree.
2. canonical_varietal == "Multi-cultivar": derive from the listed cultivars. If they all share one species → that species. If they span Arabica + Robusta → "Blend".
3. canonical_varietal == null but the input names a species directly:
     "Robusta" / "Washed Robusta" → "Robusta"
     "Arabica, Robusta" / "Washed Arabica & Robusta" / "70% Arabica 30% Robusta" → "Blend"
     "Washed Arabica" / "Arabica" → "Arabica"
4. "Liberica" → bean_type "Liberica".
5. Empty / pure marketing / "<UNKNOWN>" → null.
6. CXR / C×R → "Robusta" (the cultivar's species, even though it has Congensis lineage).
7. **Excelsa OVERRIDE.** If the input mentions "Excelsa" anywhere — as a varietal, cultivar, or otherwise — bean_type MUST be "Liberica". Excelsa is botanically Coffea liberica var. dewevrei, NOT a varietal of Arabica. Some roasters mis-label Arabica beans with "Excelsa" as the varietal field; ignore that framing — Excelsa always implies the Liberica species. canonical_varietal stays as "Excelsa" in this case (the variety tree's Excelsa entry).

Rules for morphology:

1. "Peaberry" / "Caracol" / "Caracoli" / "Caracolillo" anywhere in the input → "Peaberry".
2. Otherwise → null.
3. Maragogype / "Elephant Bean" → NOT a morphology. It's the variety "Maragogype" (Bourbon-Typica group).

The full variety tree is below.

{variety_tree_json}

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

The user message is a JSON object: {{"varietals": [...]}}

You return JSON only, no prose, no markdown:

{{
  "results": [
    {{"input": "SLN 9",                "canonical_varietal": "SLN 9", "bean_type": "Arabica", "morphology": null}},
    {{"input": "Selection 9 + Cauvery","canonical_varietal": "Multi-cultivar", "bean_type": "Arabica", "morphology": null}},
    {{"input": "Peaberry",             "canonical_varietal": null, "bean_type": null, "morphology": "Peaberry"}}
  ]
}}

Each output entry MUST have its `input` exactly equal to the input string. Never invent an output entry that wasn't in the input.

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES (already classified — match this style)
═══════════════════════════════════════════════════════════════════════

{_varietal_exemplar_block(exemplars)}
"""


# ── Per-task Haiku callers ──────────────────────────────────────────────────

def _haiku_call_json(step: str, system_prompt: str, user_payload: dict, *, log=None) -> dict:
    """Shared Haiku-call shell — routes through `call_llm` so the
    standardize pipeline honours `LLM_PROVIDER` (SDK direct vs.
    agent-fallback queue). Returns the parsed result dict. Raises
    `GeolocatorError` on caller-actionable failures.

    The `step` name (e.g. 'standardize_tasting', 'standardize_origin')
    is stamped on the llm_jobs row when routing via the queue path —
    lets drainers filter by task.
    """
    user_msg = json.dumps(user_payload, ensure_ascii=False)
    t0 = time.time()
    try:
        result = call_llm(
            step=step,
            system=[{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }],
            tool=_GENERIC_RESULT_TOOL,
            user_content=user_msg,
            max_tokens=MAX_TOKENS,
            model=MODEL_VERSION,
        )
    except LLMCallError as e:
        raise GeolocatorError(f"Haiku call failed ({step}): {e}") from e
    except Exception as e:
        # Anthropic SDK errors (credit exhaustion, rate limit, etc.)
        # propagate through call_llm's SDK path; we wrap them so the
        # admin tab gets a clean 503 instead of a raw stack trace.
        raise GeolocatorError(f"Haiku call errored ({step}): {e}") from e
    if log:
        log(f"Haiku returned in {time.time() - t0:.1f}s")
    if result is None:
        raise GeolocatorError(
            f"Haiku returned no tool_use result for {step}"
        )
    return result


def classify_tasting(tags: list[str], sca_tree: dict, exemplars: list[dict],
                       *, log=None) -> dict:
    """Single batched Haiku call for tasting → SCA addresses. Returns
    {tag: address|None}. Tags Haiku didn't return at all stay missing
    from the dict — caller decides whether to persist a null row."""
    if not tags:
        return {}
    if log:
        log(f"calling Haiku — {len(tags)} tasting tags")
    parsed = _haiku_call_json(
        "standardize_tasting",
        build_tasting_prompt(sca_tree, exemplars),
        {"tags": tags},
        log=log,
    )
    out: dict[str, list[str] | None] = {}
    for entry in parsed.get("results", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        addr = entry.get("address")
        if not isinstance(inp, str):
            continue
        if addr is None:
            out[inp] = None
        elif is_valid_address(addr, sca_tree):
            out[inp] = addr
        else:
            out[inp] = None
    return out


def classify_origins(origins: list[str], exemplars: list[dict],
                       *, log=None) -> dict:
    """Single batched Haiku call for origin → estate string. Returns
    {raw: estate_str|None}."""
    if not origins:
        return {}
    if log:
        log(f"calling Haiku — {len(origins)} origins")
    parsed = _haiku_call_json(
        "standardize_origin",
        build_origin_prompt(exemplars),
        {"origins": origins},
        log=log,
    )
    out: dict[str, str | None] = {}
    for entry in parsed.get("results", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        out[inp] = _validate_estate(entry.get("estate"))
    return out


def classify_varietals(varietals: list[str], variety_tree: dict,
                         exemplars: list[dict], *, log=None) -> dict:
    """Single batched Haiku call for varietal → canonical+species+morph.
    Returns {raw: {canonical_varietal, bean_type, morphology}}."""
    if not varietals:
        return {}
    if log:
        log(f"calling Haiku — {len(varietals)} varietals")
    parsed = _haiku_call_json(
        "standardize_varietal",
        build_varietal_prompt(variety_tree, exemplars),
        {"varietals": varietals},
        log=log,
    )
    variety_lookup = _build_variety_lookup(variety_tree)
    out: dict[str, dict] = {}
    for entry in parsed.get("results", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        validated = _validate_varietal_entry(entry, variety_lookup)
        if validated is not None:
            # Defensive Excelsa override — even if Haiku ignored the
            # prompt rule, any input that mentions "Excelsa" lands as
            # bean_type "Liberica" since Excelsa IS a Liberica variety.
            # Stops the Subko-style "Arabica with Excelsa varietal"
            # mis-tag from sneaking through the model layer.
            if "excelsa" in inp.lower():
                validated["bean_type"] = "Liberica"
            out[inp] = validated
    return out


# ── Roast + Process: prompts and classifiers ───────────────────────────────
#
# Both tasks map a verbatim roaster string onto a small flat enum.
# No external tree to embed — the canonical buckets are listed inline
# in the prompt rules. Exemplars from `roast_addresses` /
# `process_addresses` propagate house style as the catalog grows.

ROAST_BUCKETS = ["Light", "Medium-Light", "Medium", "Medium-Dark", "Dark"]

PROCESS_BUCKETS = [
    "Washed",
    "Natural",
    "Honey",
    "Anaerobic",
    "Wet-Hulled",
    "Monsooned",
    "Experimental",
    "Decaf",
]


def _roast_exemplar_block(items: list[dict]) -> str:
    if not items:
        return "(none)"
    lines = []
    for e in items:
        rhs = json.dumps(e.get("roast")) if e.get("roast") is not None else "null"
        lines.append(f'  {{"input": {json.dumps(e["input"])}, "roast": {rhs}}}')
    return "[\n" + ",\n".join(lines) + "\n]"


def _process_exemplar_block(items: list[dict]) -> str:
    if not items:
        return "(none)"
    lines = []
    for e in items:
        rhs = json.dumps(e.get("process")) if e.get("process") is not None else "null"
        lines.append(f'  {{"input": {json.dumps(e["input"])}, "process": {rhs}}}')
    return "[\n" + ",\n".join(lines) + "\n]"


def build_roast_prompt(exemplars: list[dict]) -> str:
    return f"""You normalise raw roast-level strings the roaster wrote on each coffee bag. Return one of five canonical buckets, or null when the input doesn't describe a roast level.

Canonical buckets (use these EXACT strings):
  • "Light"          — first crack just done, cinnamon to City roast.
  • "Medium-Light"   — City+, slightly past first crack.
  • "Medium"         — Full City, classic American roast.
  • "Medium-Dark"    — Full City+, Vienna territory, oils starting to show.
  • "Dark"           — French / Italian, oily surface, smoky-bitter.

Mapping rules:

1. Direct synonyms collapse to the canonical bucket.
     "Medium" / "Medium Roast" / "medium" / "medium roast" → "Medium"
     "Light" / "Light Roast" / "Light City Roast" → "Light"
     "Dark" / "Dark Roast" / "French Roast" / "Italian Roast" → "Dark"
     "Vienna" / "Vienna Roast" / "Vienna/ Dark" → "Medium-Dark"

2. Hyphen / dash / spelling drift is the same bucket.
     "Medium-Dark" / "Medium Dark" / "Medium–Dark" / "Medium dark" / "Medium - Dark Roast" → "Medium-Dark"
     "Medium-Light" / "Medium Light" / "Light-Medium" / "Light to Medium" / "Light Medium" → "Medium-Light"

3. Modifiers like "Roast", "Custom Roast", "Traditional", trailing capitalization differences are stripped before the bucket decision.

4. Roast PURPOSE strings (not roast LEVELS) → null. The consumer's roast filter is about lightness/darkness; brewing intent lives elsewhere.
     "Espresso" / "Espresso Roast" → null
     "Filter Roast" / "Filter (Light Roast)" → "Light" (the parenthetical names the actual level — use it)
     "Omni Roast" / "Custom Roast" / "Traditional" → null

5. Multi-bucket strings (a roaster who labels a bean for two intents) — pick the dominant interpretation. "Light to Medium-Dark" → "Medium". "Medium to Dark Roast" → "Medium-Dark". When truly ambiguous → null.

6. "<UNKNOWN>" / empty / "Unknown" → null.

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

User message: {{"roasts": [...]}}

Return JSON only, no prose:

{{
  "results": [
    {{"input": "Vienna Roast", "roast": "Medium-Dark"}},
    {{"input": "Filter (Light Roast)", "roast": "Light"}},
    {{"input": "Espresso", "roast": null}}
  ]
}}

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES
═══════════════════════════════════════════════════════════════════════

{_roast_exemplar_block(exemplars)}
"""


def build_process_prompt(exemplars: list[dict]) -> str:
    return f"""You normalise raw coffee processing-method strings the roaster wrote on each coffee bag. For each input, return TWO fields:

  • "process"  — one of the canonical buckets below (or null when the input doesn't describe a processing method). Used for filtering. Consumers never see the bucket name; "Experimental" is fine as a bucket label even though it's vague.
  • "display"  — a cleaned, display-ready version of the input string that the CoffeeCard renders to the consumer. Single phrase, ≤ 30 chars, Title Case, strips noise but preserves what makes the method distinctive. Returned as null only when "process" is also null.

Canonical buckets (use these EXACT strings):
  • "Washed"        — wet-processed, fully washed, double washed, fully washed patio dried.
  • "Natural"       — sun-dried in cherry, naturals, sundried, dry process.
  • "Honey"         — pulped natural with mucilage retained (red / yellow / black / white honey).
  • "Anaerobic"     — sealed-tank fermentation, carbonic maceration, thermal-shock anaerobic, ANY anaerobic-led step (even when combined with barrel ageing or yeast inoculation).
  • "Wet-Hulled"    — Sumatran "Giling Basah", semi-washed, wet-hulled.
  • "Monsooned"     — Indian Malabar / monsooned coffees only.
  • "Experimental"  — last-resort catch-all for inputs that don't fit any other bucket (barrel-aged with no anaerobic step, infused / co-ferment, multi-step exotic methods).
  • "Decaf"         — decaffeinated coffees (DCM, CO₂, Swiss Water, Mountain Water).

Mapping rules:

1. Plurals / capitalisation collapse: "Naturals", "naturals", "Natural Process", "Natural Sundried", "Sundried", "Sun-dried", "Pulped natural & Sun-dried" → "Natural".
2. "Washed" family includes "Fully Washed", "Double Washed", "Washed (Fully Washed)", "Washed, Patio Dried", "Pulped Natural" (when paired with full washing).
3. "Honey" family — anything explicitly labeled honey (Red Honey / Yellow Honey / Black Honey / Yeast Honey) and pulped-natural-with-mucilage-retained.
4. "Anaerobic" family wins over "Experimental" when ANY anaerobic step is named. "Anaerobic Natural" → "Anaerobic". "Anaerobic Carbonic Maceration" → "Anaerobic". "Anaerobic Yeast Fermentation" → "Anaerobic". "Whiskey Barrel Anaerobic" → "Anaerobic". The anaerobic step is the consumer-relevant signal; the modifier (barrel / yeast / fruit) is descriptive flavor info preserved separately.
5. "Wet-Hulled" — labeled Wet-Hulled, "Giling Basah", or "Semi-Washed" (the Indonesian style).
6. "Monsooned" — only when explicitly labeled monsooned / Malabar style.
7. "Experimental" — strict last resort. Only use when NONE of the above buckets fit. Examples: "Whiskey Barrel Aged" (no anaerobic step) → "Experimental"; "Rum Barrel Aged Natural" → "Natural" (Natural is the underlying process; barrel is flavor-add); "Pineapple Co-Fermented Honey" → "Honey" (Honey is the underlying); pure infusion / unusual single-method strings with no clean parent → "Experimental". Prefer the underlying / dominant canonical step over Experimental whenever an underlying step is named.
8. "Decaf" — DCM Decaf, CO₂, Swiss Water, Mountain Water, Sugarcane EA. The bean's underlying process before decaffeination is lost; decaf wins.
9. Multi-process strings ("Washed & Naturals", "Washed and Naturals") — when the roaster blends two processes in one bag, pick the dominant method by listed order. If neither is a clear winner and no anaerobic step is named → "Experimental".
10. Generic / non-process strings: "Mixed", "Blended", "Blend" → null. These describe blending, not processing.
11. "<UNKNOWN>" / empty → null.

DISPLAY-LABEL RULES (the consumer-facing string on the CoffeeCard):

D1. For canonical-mappable inputs (Washed / Natural / Honey / Wet-Hulled / Monsooned / Decaf), the display string mirrors the canonical bucket UNLESS the input adds a meaningful colour modifier:
      "Fully Washed" → display: "Washed"
      "Naturals" / "Sundried" → display: "Natural"
      "Red Honey" → display: "Red Honey" (modifier preserved)
      "Yeast Honey" → display: "Yeast Honey"
      "Sumatran Wet-Hulled" → display: "Wet-Hulled"
      "Monsooned Malabar" → display: "Monsooned"
      "DCM Decaf" → display: "DCM Decaf"
      "Swiss Water Decaf" → display: "Swiss Water"
D2. For Anaerobic and Experimental inputs, retain the meaningful method modifiers — that's the consumer-visible character. Strip generic suffixes ("Process", "Method", "Treatment"), parenthetical noise ("(patio dried)", "(fully washed)", "(8 days)"), redundant punctuation, ALL-CAPS:
      "Anaerobic Carbonic Maceration" → display: "Carbonic Maceration", process: "Anaerobic"
      "Anaerobic Yeast Fermentation 96h" → display: "Yeast Fermented", process: "Anaerobic"
      "Whiskey Barrel Aged Natural" → display: "Whiskey Barrel Natural", process: "Natural"
      "Whiskey Barrel Aged" → display: "Whiskey Barrel Aged", process: "Experimental"
      "Pineapple Co-Fermented Honey" → display: "Pineapple Co-Ferment", process: "Honey"
      "Wine Process" → display: "Wine Fermented", process: "Experimental"
      "Lactic Fermented Natural" → display: "Lactic Fermented", process: "Natural"
D3. For multi-process strings, the display preserves both methods joined cleanly:
      "Washed & Natural" → display: "Washed + Natural", process: pick the dominant via rule 9
      "Washed Fermented" → display: "Washed Fermented", process: "Washed"
D4. Length cap: ≤ 30 chars. If you must trim, drop the last meaningful modifier first ("Pineapple Yeast Co-Ferment Honey" → "Pineapple Co-Ferment").
D5. When process is null, display is null too.

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

User message: {{"processes": [...]}}

Return JSON only, no prose:

{{
  "results": [
    {{"input": "Anaerobic Natural",       "process": "Anaerobic",    "display": "Anaerobic Natural"}},
    {{"input": "Whiskey Barrel Aged",     "process": "Experimental", "display": "Whiskey Barrel Aged"}},
    {{"input": "Anaerobic Carbonic Maceration", "process": "Anaerobic", "display": "Carbonic Maceration"}},
    {{"input": "Washed Fermented",        "process": "Washed",       "display": "Washed Fermented"}},
    {{"input": "Red Honey",               "process": "Honey",        "display": "Red Honey"}},
    {{"input": "Mixed",                   "process": null,           "display": null}}
  ]
}}

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES
═══════════════════════════════════════════════════════════════════════

{_process_exemplar_block(exemplars)}
"""


def _validate_roast(value) -> str | None:
    if not isinstance(value, str):
        return None
    return value if value in ROAST_BUCKETS else None


def _validate_process(value) -> str | None:
    if not isinstance(value, str):
        return None
    return value if value in PROCESS_BUCKETS else None


def classify_roasts(inputs: list[str], exemplars: list[dict],
                      *, log=None) -> dict:
    if not inputs:
        return {}
    if log:
        log(f"calling Haiku — {len(inputs)} roasts")
    parsed = _haiku_call_json(
        "standardize_roast",
        build_roast_prompt(exemplars),
        {"roasts": inputs},
        log=log,
    )
    out: dict[str, str | None] = {}
    for entry in parsed.get("results", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        out[inp] = _validate_roast(entry.get("roast"))
    return out


def classify_processes(inputs: list[str], exemplars: list[dict],
                         *, log=None) -> dict:
    """Classify raw process strings. Returns
    `{raw_string: {"canonical": str|None, "display": str|None}}`. The
    canonical is one of the 8 buckets (used for filtering); the display
    label is a cleaned consumer-facing string the CoffeeCard renders.
    Display falls back to the raw input if Haiku omitted it but did
    return a canonical — never lose the descriptive text."""
    if not inputs:
        return {}
    if log:
        log(f"calling Haiku — {len(inputs)} processes")
    parsed = _haiku_call_json(
        "standardize_process",
        build_process_prompt(exemplars),
        {"processes": inputs},
        log=log,
    )
    out: dict[str, dict] = {}
    for entry in parsed.get("results", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        canonical = _validate_process(entry.get("process"))
        display_raw = entry.get("display")
        display = display_raw.strip() if isinstance(display_raw, str) and display_raw.strip() else None
        # If Haiku returned a canonical but skipped display, fall back
        # to the original input (truncated) so the card still shows
        # something descriptive — never the canonical bucket name.
        if canonical and not display:
            display = inp.strip()[:30] if isinstance(inp, str) else None
        # If canonical is null, display must be null too — the row
        # represents "this isn't a process" and won't surface anywhere.
        if canonical is None:
            display = None
        out[inp] = {"canonical": canonical, "display": display}
    return out


# ── Legacy combined prompt + classifier (kept for backward compat) ──────────

def build_standardize_system_prompt(
    sca_tree: dict,
    variety_tree: dict,
    tag_exemplars: list[dict],
    origin_exemplars: list[dict],
    varietal_exemplars: list[dict],
) -> str:
    """Compose the cached system prompt for one Haiku call covering all
    three standardization tasks. Embeds both reference trees + per-task
    exemplar blocks so the model has concrete signals for every field it
    has to fill."""
    # Single-tier flavor schema rendered as a list of sectors with
    # absorbs-exemplars inline. Variety tree stays its own dict (different
    # taxonomy, untouched by the v3 wheel rewrite).
    sectors = (sca_tree or {}).get("sectors", []) if isinstance(sca_tree, dict) else []
    schema_label = (sca_tree or {}).get("label", "(unlabeled)")
    schema_version = (sca_tree or {}).get("version", "?")
    sector_names = [s.get("name", "") for s in sectors if isinstance(s, dict)]
    valid_names_str = ", ".join(json.dumps(n) for n in sector_names)
    sector_lines: list[str] = []
    for s in sectors:
        if not isinstance(s, dict):
            continue
        nm = s.get("name", "")
        ab = s.get("absorbs", []) or []
        ab_str = ", ".join(ab[:30]) if ab else "(no exemplars yet)"
        sector_lines.append(f"  • {nm} — absorbs: {ab_str}")
    sectors_block = "\n".join(sector_lines)
    variety_tree_json = json.dumps(variety_tree, indent=2, ensure_ascii=False)

    def _tasting_block(items):
        if not items:
            return "(none)"
        lines = []
        for e in items:
            addr = e.get("address")
            rhs = json.dumps(addr) if addr else "null"
            lines.append(f'  {{"input": {json.dumps(e["tag"])}, "address": {rhs}}}')
        return "[\n" + ",\n".join(lines) + "\n]"

    def _origin_block(items):
        if not items:
            return "(none)"
        lines = []
        for e in items:
            est = e.get("estate")
            rhs = json.dumps(est) if est is not None else "null"
            lines.append(f'  {{"input": {json.dumps(e["input"])}, "estate": {rhs}}}')
        return "[\n" + ",\n".join(lines) + "\n]"

    def _varietal_block(items):
        if not items:
            return "(none)"
        lines = []
        for e in items:
            cv = json.dumps(e.get("canonical_varietal")) if e.get("canonical_varietal") is not None else "null"
            bt = json.dumps(e.get("bean_type")) if e.get("bean_type") is not None else "null"
            mo = json.dumps(e.get("morphology")) if e.get("morphology") is not None else "null"
            lines.append(
                f'  {{"input": {json.dumps(e["input"])}, '
                f'"canonical_varietal": {cv}, "bean_type": {bt}, "morphology": {mo}}}'
            )
        return "[\n" + ",\n".join(lines) + "\n]"

    return f"""You standardize three independent fields on the Crema coffee catalog in one pass. The user message carries three input lists; you return three output lists, one entry per input, preserving the input string verbatim as the key.

═══════════════════════════════════════════════════════════════════════
TASK 1 — TASTING NOTES → flavor sector
═══════════════════════════════════════════════════════════════════════

Map each free-text flavor tag onto the active Crema flavor schema. For each tag, return a single-element address `[sector_name]` or `null`.

Schema: {schema_label} (version {schema_version}). The schema has {len(sector_names)} sectors. Use these EXACT sector names — case + spacing must match:

{valid_names_str}.

Rules:

1. Use the absorbs list as the primary signal. If a tag literally appears in a sector's absorbs list, classify it to that sector.
2. Match flavor character. "Wild Honey" → ["Caramel"] (honey-like sweetness). "Roasted Almond" → ["Nutty"]. "Pink Guava" → ["Fresh fruit"] (or ["Tropical"] depending on the schema).
3. Strip modifiers that don't change the underlying flavor. "Dark Caramel" → ["Caramel"] (or ["Chocolate"] if absorbed there). "Burnt Caramel" → ["Caramel"].
4. Compound tags spanning unrelated sectors → null. "Plum Cake" (Fresh fruit + Spice) → null.
5. Mouthfeel / body descriptors are not flavors → null. ("Smooth", "Creamy", "Silky", "Heavy", "Light Body", "Round", "Bold", "Velvety", "Buttery", "Mellow", "Crisp", "Bright")
6. Vague marketing language → null. ("Aromatic", "Complex", "Balanced", "Clean", "Exceptional", "Rich", "Full-bodied")
7. Acidity descriptors are not flavors → null. ("Bright Acidity", "Mild Acidity", "Citric Acidity")

ACTIVE SCHEMA SECTORS (with absorbs):

{sectors_block}

═══════════════════════════════════════════════════════════════════════
TASK 2 — ORIGIN → estate name
═══════════════════════════════════════════════════════════════════════

Each input is the raw `origin` field as the roaster wrote it. Return ONE of four things:

  • An estate name, normalised — Title Case, ALWAYS suffixed with the word "Estate" regardless of what the roaster wrote ("Farm" / "Farms" / "Plantation" / bare names all become "X Estate").
  • "Multi-estate" — when the input names ≥2 distinct estates, OR is a region/area without a specific estate, OR is generic descriptive language masquerading as an estate name.
  • "International" — when the origin is anywhere outside India.
  • "Unknown" — when no estate or region is named at all (empty / "<UNKNOWN>" / pure blend product names with no farm reference).

Rules:

1. Estate suffix is always "Estate" in the output. Recognise estate-class entities written with: "Estate", "Estates", "Farm", "Farms", "Plantation", "Plantations". Bare named estates with no suffix get "Estate" appended.
     "Ratnagiri Estate"        → "Ratnagiri Estate"
     "Tat Tvam Asi Farms"      → "Tat Tvam Asi Estate"
     "Hoysala Estate"          → "Hoysala Estate"
     "Riverdale"               → "Riverdale Estate"
     "Salawara"                → "Salawara Estate"

2. Strip everything after the first comma/semicolon that names a region, district, state, or country.
     "Kalledevarapura Estate, Bababudangiri, Chikmagalur" → "Kalledevarapura Estate"
     "Mooleh Manay Estate, Coorg"    → "Mooleh Manay Estate"
     "Harley Estate, Sakleshpur"     → "Harley Estate"

3. Multi-estate inputs (≥2 distinct estate proper-nouns joined by `&`, `+`, `and`, `;`, or `,`) → "Multi-estate". DO NOT pick the first.
     "Kalledevarapura Estate & Balur Estate, Chikmagalur" → "Multi-estate"
     "BR Hills, Karnataka; Wayanad, Kerala"               → "Multi-estate"

4. Region-only / state-only / district-only / hill-only / valley-only inputs (no specific estate proper noun) → "Multi-estate". A region IS de facto multi-estate from the consumer's view — it's a sourcing area, not a farm.
     "Coorg"            → "Multi-estate"
     "Chikmagalur"      → "Multi-estate"
     "Coorg & Chikmagalur" → "Multi-estate"
     "Karnataka"        → "Multi-estate"
     "Wayanad, Kerala"  → "Multi-estate"
     "Western Ghats"    → "Multi-estate"
     "Southern India"   → "Multi-estate"
     "BR Hills, Karnataka" → "Multi-estate"
     "Mysore"           → "Multi-estate"
     "Bababudan Hills"  → "Multi-estate"
     "Araku Valley"     → "Multi-estate"

5. Generic descriptive language masquerading as an estate name → "Multi-estate". These strings have no proper-noun specificity ("Finest", "Premium", "Best" + Coffee/Estate/Plantation are advertising copy, not actual places).
     "Finest Coffee Estate"    → "Multi-estate"
     "Premium Coffee Estate"   → "Multi-estate"
     "Best Coffee Plantation"  → "Multi-estate"

6. International origins (any country other than India) → "International". Never name the country in the output.
     "Ethiopia"           → "International"
     "Colombia, Huila"    → "International"
     "Yirgacheffe"        → "International"  (Yirgacheffe is in Ethiopia)
     "Panama"             → "International"

7. Misspelled Indian regions still resolve to "Multi-estate":
     "Chikmaglur" → "Multi-estate"
     "Chikkamagaluru" → "Multi-estate"

8. Empty / placeholder / pure blend product names (no farm/region reference at all) → "Unknown". This is the bucket the consumer filter hides.
     "<UNKNOWN>" → "Unknown"
     "House Blend" → "Unknown"
     "Espresso Blend" → "Unknown"
     "French Roast" → "Unknown"
     "Cold Brew Blend" → "Unknown"

9. Title Case the estate name. Mid-word lowercase joiners ("of", "the", "and", "de", "del") stay lowercase unless the roaster capitalised them. Match the roaster's spelling for proper nouns.

═══════════════════════════════════════════════════════════════════════
TASK 3 — VARIETAL → canonical variety + species + morphology
═══════════════════════════════════════════════════════════════════════

Each input is the raw `varietal` field. Return THREE fields:

  • canonical_varietal — a variety name from the variety tree below, OR "Multi-cultivar" when ≥2 distinct cultivars are named, OR null when the input is just species labels / marketing prose / a morphology / empty.
  • bean_type — derived from canonical_varietal via the tree's `species` field. Override by direct mention only when the input explicitly names a species combination ("Arabica & Robusta" → "Blend"). One of "Arabica" / "Robusta" / "Blend" / "Liberica" / "Excelsa" / null.
  • morphology — "Peaberry" if the input mentions Peaberry / Caracol / Caracoli / Caracolillo (case-insensitive). Otherwise null. Independent of canonical_varietal.

Rules for canonical_varietal:

1. Match against the variety tree below. The `synonyms` array on each variety lists every drift form Crema's catalog has seen — collapse them to the canonical `name`.
     "S9", "SL9", "SLN9", "SLN-9", "Sln. 9", "Selection 9" → "SLN 9"
     "S795", "Selection 795", "SL795" → "S 795"
     "Catimore" → "Catimor"
     "Selection 12" → "Cauvery"
2. Multi-cultivar entries (≥2 distinct cultivars joined by `+`, `&`, `and`, `,` or `/`) → literal "Multi-cultivar". DO NOT pick a first.
     "Selection 9 + Selection 795 + Cauvery + Kent" → "Multi-cultivar"
     "SLN9 + SLN6 + Chandragiri" → "Multi-cultivar"
     "Bourbon, Caturra, Catimor" → "Multi-cultivar"
     "SLN 795 + SLN 9" → "Multi-cultivar"
   Exception: if all listed cultivars are the SAME canonical variety (e.g. "SL9, SLN-9, Sln. 9" → SLN 9), return that single canonical name.
3. Species-only inputs return null:
     "Arabica" / "Robusta" / "Arabica, Robusta" / "Washed Arabica" → null
4. Marketing prose / placeholders → null:
     "Washed Arabica + Various Cherry Varieties" → null
     "Traditional varieties" / "Mixed" / "Various" / "<UNKNOWN>" → null
5. Morphology-only inputs return null for canonical_varietal but surface in `morphology`:
     "Peaberry" → canonical_varietal: null, morphology: "Peaberry"
     "Caracol"  → canonical_varietal: null, morphology: "Peaberry"
6. Bracketed/parenthesised qualifiers strip:
     "SLN 795 HG" → "S 795"
     "Brown Tip - Panama Geisha" → "Geisha"
7. "Kents" in an Indian-context catalog defaults to "S 795" (the Indian Bourbon-Typica selection); standalone "Kent" with no Indian context resolves to "Kent" (the heirloom).

Rules for bean_type:

1. canonical_varietal lookup → use that variety's `species` from the tree.
2. canonical_varietal == "Multi-cultivar": derive from the listed cultivars. If they all share one species → that species. If they span Arabica + Robusta → "Blend".
3. canonical_varietal == null but the input names a species directly:
     "Robusta" / "Washed Robusta" → "Robusta"
     "Arabica, Robusta" / "Washed Arabica & Robusta" / "70% Arabica 30% Robusta" → "Blend"
     "Washed Arabica" / "Arabica" → "Arabica"
4. "Liberica" → bean_type "Liberica".
5. Empty / pure marketing / "<UNKNOWN>" → null.
6. CXR / C×R → "Robusta" (the cultivar's species, even though it has Congensis lineage).
7. **Excelsa OVERRIDE.** If the input mentions "Excelsa" anywhere — as a varietal, cultivar, or otherwise — bean_type MUST be "Liberica". Excelsa is botanically Coffea liberica var. dewevrei, NOT a varietal of Arabica. Some roasters mis-label Arabica beans with "Excelsa" as the varietal field; ignore that framing — Excelsa always implies the Liberica species. canonical_varietal stays as "Excelsa" in this case (the variety tree's Excelsa entry).

Rules for morphology:

1. "Peaberry" / "Caracol" / "Caracoli" / "Caracolillo" anywhere in the input → "Peaberry".
2. Otherwise → null.
3. Maragogype / "Elephant Bean" → NOT a morphology. It's the variety "Maragogype" (Bourbon-Typica group).

The full variety tree is below.

{variety_tree_json}

═══════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════

The user message is a JSON object:

{{
  "tasting_tags": [...],
  "origins": [...],
  "varietals": [...]
}}

You return JSON only, no prose, no markdown, with all three output lists keyed verbatim:

{{
  "tasting_addresses": [
    {{"input": "Wild Honey",  "address": ["Caramel"]}},
    {{"input": "Pink Guava",  "address": ["Fresh fruit"]}},
    {{"input": "Smooth",      "address": null}}
  ],
  "origin_estates": [
    {{"input": "Ratnagiri Estate", "estate": "Ratnagiri Estate"}},
    {{"input": "Coorg",            "estate": "Multi-estate"}},
    {{"input": "Ethiopia",         "estate": "International"}},
    {{"input": "House Blend",      "estate": "Unknown"}}
  ],
  "varietals": [
    {{"input": "SLN 9",                "canonical_varietal": "SLN 9", "bean_type": "Arabica", "morphology": null}},
    {{"input": "Selection 9 + Cauvery","canonical_varietal": "Multi-cultivar", "bean_type": "Arabica", "morphology": null}},
    {{"input": "Peaberry",             "canonical_varietal": null, "bean_type": null, "morphology": "Peaberry"}}
  ]
}}

Each output entry MUST have its `input` exactly equal to the input string. If a list in the request is empty or omitted, return an empty list for it. Never invent an output entry that wasn't in the input.

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES (already classified — match this style)
═══════════════════════════════════════════════════════════════════════

Tasting tags:
{_tasting_block(tag_exemplars)}

Origins:
{_origin_block(origin_exemplars)}

Varietals:
{_varietal_block(varietal_exemplars)}
"""


# ── Three-task batched Haiku call ───────────────────────────────────────────

def _validate_estate(value) -> str | None:
    """Coerce the model's estate output. Returns the canonical string or
    None (so the caller can drop bad rows rather than persist garbage)."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    if s in ("Multi-estate", "International", "Unknown"):
        return s
    if len(s) > 80:
        return None
    return s


def _validate_varietal_entry(entry, variety_lookup: set[str]) -> dict | None:
    """Coerce a varietal output into the {canonical_varietal, bean_type,
    morphology} shape; reject rows where canonical_varietal isn't in the
    tree (and isn't "Multi-cultivar" / null)."""
    if not isinstance(entry, dict):
        return None
    cv = entry.get("canonical_varietal")
    if cv is not None and not isinstance(cv, str):
        cv = None
    if cv and cv != "Multi-cultivar" and cv not in variety_lookup:
        cv = None
    bt = entry.get("bean_type")
    if bt not in (None, "Arabica", "Robusta", "Blend", "Liberica", "Excelsa"):
        bt = None
    mo = entry.get("morphology")
    if mo not in (None, "Peaberry", "Triangular"):
        mo = None
    return {"canonical_varietal": cv, "bean_type": bt, "morphology": mo}


def _build_variety_lookup(tree: dict) -> set[str]:
    """Flatten variety names from the tree for O(1) validation."""
    out: set[str] = set()
    for group in (tree.get("groups") or {}).values():
        for v in group.get("varieties") or []:
            n = v.get("name")
            if isinstance(n, str):
                out.add(n)
    return out


def classify_standardize_batch(
    tags: list[str],
    origins: list[str],
    varietals: list[str],
    sca_tree: dict,
    variety_tree: dict,
    tag_exemplars: list[dict],
    origin_exemplars: list[dict],
    varietal_exemplars: list[dict],
    *,
    log=None,
) -> dict:
    """Single batched Haiku call covering all three tasks. Returns:

        {
          "tasting": {tag: address|None, ...},
          "origin":  {raw: estate_str|None, ...},     # None means parse miss
          "varietal": {raw: {canonical_varietal, bean_type, morphology}, ...}
        }

    Inputs Haiku didn't return at all stay missing from the output dicts —
    the caller decides whether to persist a null row or skip them.
    """
    if not tags and not origins and not varietals:
        return {"tasting": {}, "origin": {}, "varietal": {}}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise GeolocatorError(
            "ANTHROPIC_API_KEY is not set. Export it in the shell that runs "
            "the FastAPI server (export ANTHROPIC_API_KEY=sk-...)."
        )

    try:
        import anthropic
    except ImportError as e:
        raise GeolocatorError(
            "anthropic SDK isn't installed. `pip install anthropic` in the "
            "Python env that runs the FastAPI server."
        ) from e

    client = anthropic.Anthropic(max_retries=SDK_MAX_RETRIES)
    user_payload = {
        "tasting_tags": tags,
        "origins": origins,
        "varietals": varietals,
    }
    user_msg = json.dumps(user_payload, ensure_ascii=False)
    system_prompt = build_standardize_system_prompt(
        sca_tree, variety_tree, tag_exemplars, origin_exemplars, varietal_exemplars,
    )

    if log:
        log(
            f"calling Haiku — {len(tags)} tags · {len(origins)} origins · "
            f"{len(varietals)} varietals"
        )
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

    # Tasting — same validator as legacy classify_tags
    tasting_out: dict[str, list[str] | None] = {}
    for entry in parsed.get("tasting_addresses", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        addr = entry.get("address")
        if not isinstance(inp, str):
            continue
        if addr is None:
            tasting_out[inp] = None
        elif is_valid_address(addr, sca_tree):
            tasting_out[inp] = addr
        else:
            tasting_out[inp] = None

    # Origin
    origin_out: dict[str, str | None] = {}
    for entry in parsed.get("origin_estates", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        origin_out[inp] = _validate_estate(entry.get("estate"))

    # Varietal
    variety_lookup = _build_variety_lookup(variety_tree)
    varietal_out: dict[str, dict] = {}
    for entry in parsed.get("varietals", []) or []:
        if not isinstance(entry, dict):
            continue
        inp = entry.get("input")
        if not isinstance(inp, str):
            continue
        validated = _validate_varietal_entry(entry, variety_lookup)
        if validated is not None:
            varietal_out[inp] = validated

    return {"tasting": tasting_out, "origin": origin_out, "varietal": varietal_out}
