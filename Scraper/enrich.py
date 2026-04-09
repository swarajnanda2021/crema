#!/usr/bin/env python3
"""
LLM enrichment pipeline for coffee product data.

Reads products.json, passes each product through Claude Sonnet to extract:
  - is_coffee_bean    (boolean — final coffee/non-coffee classification)
  - origin            (specific estate, farm, or named micro-region)
  - altitude_masl     (int, meters above sea level)
  - roast_level       (Light / Medium-Light / Medium / Medium-Dark / Dark)
  - process           (Washed / Natural / Honey / Anaerobic / Semi-Washed)
  - tasting_notes     (prose tasting description)
  - flavor_notes      (concise list of individual flavor terms)
  - varietal          (coffee variety / cultivar)

Writes products_enriched.json.
Uses a checkpoint JSONL so interrupted runs can be resumed with --resume.

Usage (from the Scraper/ directory):
    ANTHROPIC_API_KEY=sk-...  python enrich.py
    ANTHROPIC_API_KEY=sk-...  python enrich.py --input output/products.json
    ANTHROPIC_API_KEY=sk-...  python enrich.py --resume
    ANTHROPIC_API_KEY=sk-...  python enrich.py --no-checkpoint   # start fresh
"""

import argparse
import json
import os
import sys
import time

import anthropic

# ── Config ────────────────────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024
INTER_REQUEST_PAUSE = 0.5   # seconds between successful requests
MAX_RETRIES = 4

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_INPUT = os.path.join(_BASE_DIR, "output", "products.json")
_DEFAULT_OUTPUT = os.path.join(_BASE_DIR, "output", "products_enriched.json")
_CHECKPOINT = os.path.join(_BASE_DIR, "output", "enrich_checkpoint.jsonl")


# ── Extraction tool schema ────────────────────────────────────────────────────

_EXTRACT_TOOL = {
    "name": "extract_coffee_data",
    "description": (
        "Extract structured coffee product data from the product title, "
        "tags, and description text."
    ),
    "input_schema": {
        "type": "object",
        "required": [
            "is_coffee_bean",
            "coffee_name_clean",
            "origin",
            "altitude_masl",
            "roast_level",
            "process",
            "tasting_notes",
            "flavor_notes",
            "varietal",
            "bean_type",
        ],
        "properties": {
            "coffee_name_clean": {
                "type": ["string", "null"],
                "description": (
                    "A standardised, display-ready product name. Apply these rules:\n"
                    "1. TASTING-NOTE SUFFIX: If the raw name contains ' - <Roast> Roast - <tasting text>', "
                    "strip everything from ' - <Roast> Roast' onward. "
                    "E.g. 'Vienna Roast - Dark Roast - Dark Chocolate & Smoke' → 'Vienna Roast'.\n"
                    "2. TASTER PACK DETAILS: Remove pack quantity and discount text. "
                    "E.g. 'Dark Roast Taster Pack - (3 packs x 75 gm each) | 20% Off' → 'Dark Roast Taster Pack'.\n"
                    "3. REGION + ROAST SUFFIX: If the name ends with ' - <Region> - <Roast> Roast' or "
                    "' - <Roast> Roast', strip those trailing segments but keep estate and process descriptor. "
                    "E.g. 'Salawara Estate - Naturals - Sakleshpur - Light Roast' → 'Salawara Estate - Naturals'.\n"
                    "4. ALL CAPS: Convert fully uppercase names to Title Case. "
                    "E.g. 'MYSORE NUGGETS' → 'Mysore Nuggets'. Preserve emoji.\n"
                    "5. ROAST IN BRACKETS: Remove '(Dark Roast)', '(Medium Roast)', '(Light Roast)' etc. "
                    "from names. E.g. 'Arabica Blend (Dark Roast)' → 'Arabica Blend'.\n"
                    "6. ESTATE CAPITALISATION: Title-case estate words. "
                    "E.g. 'Attikan estate' → 'Attikan Estate'.\n"
                    "7. VERBOSE BLENDS: Slim excessively long blend names to their core identity. "
                    "E.g. 'Special Peaberry + Special A 50:50 Mix' → 'Peaberry & Special A Blend'; "
                    "'Special A Coffee Beans Unique Blend - 5 Kg Bag' → 'Special A Blend'.\n"
                    "Return null if the original name already passes all rules unchanged."
                ),
            },
            "is_coffee_bean": {
                "type": "boolean",
                "description": (
                    "True ONLY for roasted whole bean or ground coffee products — "
                    "including single-serve pour-over filter bags with actual roasted coffee. "
                    "False for: cold brew cans, RTD drinks, concentrates, instant coffee, "
                    "accessories, equipment, brew bags that are pre-brewed, capsules, pods, "
                    "gift sets, hampers, workshops, subscriptions, chocolate bars, tea, matcha, "
                    "or any non-roasted-bean product."
                ),
            },
            "origin": {
                "type": ["string", "null"],
                "description": (
                    "The specific farm, estate, or named micro-region where the coffee was grown. "
                    "E.g. 'Ratnagiri Estate', 'Attikan Estate', 'Bababudan Hills', 'Araku Valley'. "
                    "Do NOT use generic state or country names like 'Karnataka' or 'India' alone. "
                    "Null if no specific estate or named growing region is mentioned."
                ),
            },
            "altitude_masl": {
                "type": ["integer", "null"],
                "description": (
                    "Growing altitude in meters above sea level as an integer. "
                    "For a range like '900–1100m', use the midpoint (1000). "
                    "Look for: 'MASL', 'masl', 'm asl', 'meters above sea level', "
                    "or a 3–4 digit number followed by 'm' in a coffee context. "
                    "Null if not mentioned."
                ),
            },
            "roast_level": {
                "type": ["string", "null"],
                "enum": ["Light", "Medium-Light", "Medium", "Medium-Dark", "Dark", None],
                "description": "Roast level. Null if not explicitly stated.",
            },
            "process": {
                "type": ["string", "null"],
                "enum": ["Washed", "Natural", "Honey", "Anaerobic", "Semi-Washed", None],
                "description": "Bean processing method. Null if not mentioned.",
            },
            "tasting_notes": {
                "type": ["string", "null"],
                "description": (
                    "The tasting/flavour note text — either exactly as written or "
                    "as a clean concise prose summary. "
                    "E.g. 'fruity sweetness and silky body', "
                    "'dark chocolate and caramel with a bright citrus finish'. "
                    "Null if no tasting information is present."
                ),
            },
            "flavor_notes": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Concise individual flavour descriptors, title case, 1–3 words each. "
                    "Infer these from natural language tasting prose — do not require "
                    "the word to appear literally. "
                    "Examples: "
                    "'fruity sweetness and silky body' → ['Fruity', 'Silky']; "
                    "'notes of dark chocolate, caramel, and a bright citrus finish' "
                    "→ ['Dark Chocolate', 'Caramel', 'Citrus']; "
                    "'refined cup with berry-like sweetness' → ['Berry']. "
                    "Empty list if no flavour information is present."
                ),
            },
            "varietal": {
                "type": ["string", "null"],
                "description": (
                    "Coffee variety or cultivar. "
                    "E.g. 'SLN 795', 'SLN 9', 'Cauvery', 'Chandragiri', 'Arabica', "
                    "'Robusta', 'Bourbon', 'Typica', 'Catimor', 'Selection 5', 'Selection 6'. "
                    "Null if not mentioned."
                ),
            },
            "bean_type": {
                "type": ["string", "null"],
                "enum": ["Arabica", "Robusta", "Blend", None],
                "description": (
                    "Species-level bean classification. Rules:\n"
                    "- 'Arabica': product is 100% Arabica (explicit mention, or all detected "
                    "cultivars are Arabica: SLN 795, S795, Chandragiri, Hemavathi, Catuai, "
                    "Bourbon, Caturra, Catimor, Cauvery, Geisha, Kents, Sachimore).\n"
                    "- 'Robusta': product is 100% Robusta (explicit mention, or all cultivars "
                    "are Robusta: SLN 9, SL 9, SL9, Selection 9, S5B).\n"
                    "- 'Blend': product explicitly mixes Arabica and Robusta, or the name "
                    "includes both species.\n"
                    "- Null if species cannot be determined from the text."
                ),
            },
        },
    },
}


# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM = """\
You are a specialty coffee data extraction assistant focused on Indian coffee roasters.

Extract structured data precisely from the product information provided.

General rules:
- Be conservative: only extract what is explicitly stated or strongly implied.
- Do not invent details not present in the text.

Field-specific rules:

coffee_name_clean:
  Produce a clean, display-ready name by applying these transformations to the raw product title:
  1. TASTING-NOTE SUFFIX — strip everything from ' - <Roast> Roast - <tasting text>' onward.
     "Vienna Roast - Dark Roast - Dark Chocolate & Smoke" → "Vienna Roast"
  2. TASTER PACK DETAILS — remove pack quantity and discount text after a dash or pipe.
     "Dark Roast Taster Pack - (3 packs x 75 gm) | 20% Off" → "Dark Roast Taster Pack"
  3. REGION + ROAST SUFFIX — strip trailing ' - <Region> - <Roast> Roast' or ' - <Roast> Roast'.
     Keep estate name and process descriptor.
     "Salawara Estate - Naturals - Sakleshpur - Light Roast" → "Salawara Estate - Naturals"
  4. ALL CAPS — convert fully uppercase names to Title Case; preserve emoji.
     "MYSORE NUGGETS" → "Mysore Nuggets"
  5. ROAST IN BRACKETS — remove "(Dark Roast)", "(Medium Roast)", "(Light Roast)" etc.
     "Arabica Blend (Dark Roast)" → "Arabica Blend"
  6. ESTATE CAPITALISATION — title-case lowercase estate words.
     "Attikan estate" → "Attikan Estate"
  7. VERBOSE BLENDS — slim excessively long blend names to their core identity.
     "Special Peaberry + Special A 50:50 Mix" → "Peaberry & Special A Blend"
  Return null only if the raw name is already clean and none of the above rules apply.

flavor_notes:
  Infer individual descriptors from natural language prose (max 3, title case, 1–3 words each).
  "fruity sweetness and silky body" → ["Fruity", "Silky"]
  "notes of dark chocolate, caramel, bright citrus" → ["Dark Chocolate", "Caramel", "Citrus"]

origin:
  Specific named farms, estates, or micro-regions only — NOT generic state/country names.
  E.g. "Ratnagiri Estate", "Attikan Estate", "Bababudan Hills", "Araku Valley".

altitude_masl:
  Altitude in metres. For ranges, use the midpoint. Look for MASL, masl, m asl, or a
  3–4 digit number followed by m/metres in a coffee context. Null if absent.
  IMPORTANT: many Indian estate products report altitude in feet — convert to metres (× 0.3048).

bean_type:
  "Arabica", "Robusta", "Blend", or null.
  Arabica cultivars (Indian): SLN 795/S795/S 795, Chandragiri, Hemavathi, Catuai, Bourbon,
    Caturra, Catimor, Cauvery, Geisha, Kents, Sachimore, SL 6/SLN 6.
  Robusta cultivars (Indian): SLN 9/SL 9/SL9/Selection 9, S5B.
  Blend if the product mixes both species. Null if species is unknown.

is_coffee_bean:
  True for roasted whole bean or ground coffee (including pour-over filter bags with actual
  roasted coffee). False for: RTDs, concentrates, instant, accessories, gift sets, workshops,
  subscriptions, capsules, tea, matcha, chocolate bars, or any non-roasted-bean product.
"""


# ── Core enrichment call ──────────────────────────────────────────────────────

def _enrich_one(client: anthropic.Anthropic, product: dict) -> dict | None:
    """
    Call Claude Sonnet with tool use to extract structured fields.
    Returns the tool-input dict, or None if all retries fail.
    """
    title = product.get("coffee_name") or product.get("title") or ""
    desc = (product.get("description_raw") or "")[:3000]
    tags = ", ".join(str(t) for t in (product.get("tags") or []))
    roast_existing = product.get("roast_level") or ""
    process_existing = product.get("process") or ""

    # Give the model the existing regex-extracted hints so it can validate / correct
    hint_lines = []
    if roast_existing and roast_existing != "Unknown":
        hint_lines.append(f"Regex-detected roast: {roast_existing}")
    if process_existing:
        hint_lines.append(f"Regex-detected process: {process_existing}")
    hints = ("\n\nExisting extraction hints (may be inaccurate):\n" + "\n".join(hint_lines)) if hint_lines else ""

    user_content = (
        f"Product: {title}\n\n"
        f"Tags: {tags}\n\n"
        f"Description:\n{desc}"
        f"{hints}"
    )

    for attempt in range(MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM,
                tools=[_EXTRACT_TOOL],
                tool_choice={"type": "tool", "name": "extract_coffee_data"},
                messages=[{"role": "user", "content": user_content}],
            )
            for block in resp.content:
                if block.type == "tool_use":
                    return block.input

        except anthropic.RateLimitError:
            wait = 15 * (attempt + 1)
            print(f"    [rate limit] waiting {wait}s…", flush=True)
            time.sleep(wait)

        except anthropic.APIError as exc:
            print(f"    [API error] {exc}", flush=True)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)

    return None


# ── Merge LLM data into product ───────────────────────────────────────────────

def _merge(product: dict, llm: dict) -> dict:
    """
    Merge LLM-extracted fields into a product dict.
    LLM values win; existing values survive only when LLM returns null.
    Adds new fields: is_coffee_bean, flavor_notes, bean_type, coffee_name_clean, llm_enriched.
    """
    out = dict(product)

    out["is_coffee_bean"] = llm.get("is_coffee_bean", True)

    # coffee_name_clean — standardised display name; override coffee_name if provided
    llm_name = llm.get("coffee_name_clean")
    if llm_name:
        out["coffee_name_clean"] = llm_name
        out["coffee_name"] = llm_name

    # bean_type — Arabica / Robusta / Blend / null
    llm_bean = llm.get("bean_type")
    if llm_bean:
        out["bean_type"] = llm_bean

    # origin: LLM estate/micro-region wins; fall back to existing origin
    llm_origin = llm.get("origin")
    if llm_origin:
        out["origin"] = llm_origin

    # altitude
    llm_alt = llm.get("altitude_masl")
    if llm_alt is not None:
        out["altitude_masl"] = llm_alt

    # roast_level — LLM wins; but only override if it has an opinion
    llm_roast = llm.get("roast_level")
    if llm_roast:
        out["roast_level"] = llm_roast

    # process
    llm_proc = llm.get("process")
    if llm_proc:
        out["process"] = llm_proc

    # tasting_notes
    llm_notes = llm.get("tasting_notes")
    if llm_notes:
        out["tasting_notes"] = llm_notes

    # flavor_notes — new field
    out["flavor_notes"] = llm.get("flavor_notes") or []

    # varietal
    llm_var = llm.get("varietal")
    if llm_var:
        out["varietal"] = llm_var

    out["llm_enriched"] = True
    return out


# ── Checkpoint helpers ────────────────────────────────────────────────────────

def _load_checkpoint(path: str) -> dict:
    """Load checkpoint JSONL → {product_id: llm_data}."""
    done = {}
    if not os.path.exists(path):
        return done
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                done[entry["product_id"]] = entry["llm_data"]
            except (json.JSONDecodeError, KeyError):
                pass
    return done


def _append_checkpoint(path: str, product_id: str, llm_data: dict) -> None:
    """Append one enrichment result to the checkpoint JSONL."""
    with open(path, "a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {"product_id": product_id, "llm_data": llm_data},
                ensure_ascii=False,
            )
        )
        f.write("\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="LLM enrichment for coffee products")
    parser.add_argument(
        "--input", default=_DEFAULT_INPUT,
        help=f"Input products JSON (default: {_DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output", default=_DEFAULT_OUTPUT,
        help=f"Output enriched JSON (default: {_DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip products already recorded in the checkpoint file",
    )
    parser.add_argument(
        "--no-checkpoint", dest="no_checkpoint", action="store_true",
        help="Ignore existing checkpoint and start fresh",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    # Load products
    with open(args.input, encoding="utf-8") as f:
        products = json.load(f)
    print(f"Loaded {len(products)} products from {args.input}")

    # Load checkpoint
    checkpoint: dict = {}
    if not args.no_checkpoint:
        checkpoint = _load_checkpoint(_CHECKPOINT)
        if checkpoint:
            print(f"Checkpoint: {len(checkpoint)} products already enriched")

    client = anthropic.Anthropic(api_key=api_key)

    # Partition products
    already_done: list[dict] = []
    to_process: list[dict] = []
    for p in products:
        pid = p.get("product_id", "")
        if pid in checkpoint:
            already_done.append(_merge(p, checkpoint[pid]))
        else:
            to_process.append(p)

    print(f"To process: {len(to_process)}  |  Already cached: {len(already_done)}\n")

    newly_enriched: list[dict] = []
    failed: list[str] = []

    for i, product in enumerate(to_process, start=1):
        pid = product.get("product_id", f"unknown_{i}")
        name = product.get("coffee_name") or product.get("title") or pid
        roaster = product.get("roaster_name", "")

        print(f"[{i}/{len(to_process)}] {roaster} — {name}", flush=True)

        llm_data = _enrich_one(client, product)

        if llm_data is None:
            print("  FAILED — keeping original data", flush=True)
            failed.append(pid)
            newly_enriched.append(dict(product))
            continue

        # Print what we extracted
        is_bean = llm_data.get("is_coffee_bean", True)
        roast = llm_data.get("roast_level") or "—"
        proc = llm_data.get("process") or "—"
        origin = llm_data.get("origin") or "—"
        alt = llm_data.get("altitude_masl")
        alt_str = f"{alt}m" if alt else "—"
        notes = (llm_data.get("tasting_notes") or "")[:70]
        flavors = ", ".join(llm_data.get("flavor_notes") or [])

        status = "✓ coffee" if is_bean else "✗ NOT coffee"
        print(f"  {status} | {roast} | {proc} | {origin} | {alt_str}", flush=True)
        if notes:
            print(f"  notes: {notes}", flush=True)
        if flavors:
            print(f"  flavors: {flavors}", flush=True)

        _append_checkpoint(_CHECKPOINT, pid, llm_data)
        newly_enriched.append(_merge(product, llm_data))

        time.sleep(INTER_REQUEST_PAUSE)

    # Combine, sort, write
    all_enriched = already_done + newly_enriched
    all_enriched.sort(key=lambda p: (
        p.get("roaster_name") or "",
        p.get("coffee_name") or "",
    ))

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(all_enriched, f, ensure_ascii=False, indent=2)

    # Summary
    total = len(all_enriched)
    beans = sum(1 for p in all_enriched if p.get("is_coffee_bean", True))
    not_beans = total - beans
    with_notes = sum(1 for p in all_enriched if p.get("tasting_notes"))
    with_flavors = sum(1 for p in all_enriched if p.get("flavor_notes"))
    with_origin = sum(1 for p in all_enriched if p.get("origin"))
    with_alt = sum(1 for p in all_enriched if p.get("altitude_masl"))
    with_proc = sum(1 for p in all_enriched if p.get("process"))

    def pct(n):
        return f"{100 * n // total}%" if total else "—"

    print(f"\n{'═' * 60}")
    print("ENRICHMENT COMPLETE")
    print(f"  Total products       : {total}")
    print(f"  Confirmed coffee     : {beans}  ({pct(beans)})")
    print(f"  Non-coffee (flagged) : {not_beans}")
    print(f"  With tasting notes   : {with_notes}  ({pct(with_notes)})")
    print(f"  With flavor_notes    : {with_flavors}  ({pct(with_flavors)})")
    print(f"  With origin/estate   : {with_origin}  ({pct(with_origin)})")
    print(f"  With altitude        : {with_alt}  ({pct(with_alt)})")
    print(f"  With process         : {with_proc}  ({pct(with_proc)})")
    if failed:
        print(f"  Failed (kept raw)    : {len(failed)}")
    print(f"  Output               : {args.output}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()
