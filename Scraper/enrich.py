#!/usr/bin/env python3
"""
LLM enrichment pipeline for coffee product data.

Reads products.json, passes each product through Claude Sonnet to extract
the full per-bean payload (~14 fields per the wishlist), then writes
products_enriched.json. Uses a checkpoint JSONL so interrupted runs can
be resumed with --resume.

Phase 6 rewrite (2026-04-28): Sonnet now sees a layered context built
from everything we have on hand AND a live fetch of the product detail
page. The prior pipeline only passed listing-endpoint data (title +
short description + tags), which let non-bean products like barista
workshops slip through with no enrichment because their listing copy
was thin and didn't carry obvious "this isn't a bean" signals.

Per-product context now includes:
  • Product title
  • Product URL (slug like /products/barista-workshop is a strong
    is_coffee_bean=false signal)
  • Variant table (sizes + prices — single flat-price variants are
    rarely beans; bean SKUs almost always have weight options)
  • Tags + collection labels from the listing endpoint
  • Listing-endpoint description (truncated)
  • Live product page text — fetched per call, BeautifulSoup-stripped,
    capped at ~10KB. Catches roasters whose listing copy is two
    sentences but whose product page has the full sourcing story.

Schema additions over the v1 pipeline:
  • `weight_grams` (LLM extracts when scraper missed it)
  • `roast_level_name` (verbatim roaster term — Vienna, Full City+, etc.)
  • `roaster_blurb` (Sonnet-distilled 1-2-sentence narrative about THIS
    bean — sourcing story, processing technique, etc. Same voice
    treatment as the roaster about_blurb.)

The `process` enum is dropped — `process_raw` is the only process
field; canonicalization happens later in the MAPPING tab's Process
Graph (BUILD_ROADMAP §1.5 row 119).

Usage (from the Scraper/ directory):
    ANTHROPIC_API_KEY=sk-...  python enrich.py
    ANTHROPIC_API_KEY=sk-...  python enrich.py --input output/products.json
    ANTHROPIC_API_KEY=sk-...  python enrich.py --resume
    ANTHROPIC_API_KEY=sk-...  python enrich.py --no-checkpoint   # start fresh
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Literal

import anthropic
import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

# Haiku 4.5 — switched from Sonnet on 2026-04-28. Per-product
# extractions are bounded structured tasks; with the layered context
# (URL + variants + page text + tags + listing description) Haiku
# lands the schema cleanly. The cost difference is order-of-
# magnitude — a 50-product run that was ~$5-7 on Sonnet runs at
# ~$0.30-0.50 on Haiku. The Sonnet meta-call (per-roaster prompt
# addendum, ~once per roaster) lives in
# `services/site_prompt_generator.py` and pays for itself in
# accuracy gains on subsequent runs.
MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 2048           # bigger response budget — more fields per call
INTER_REQUEST_PAUSE = 0.5
MAX_RETRIES = 4
PAGE_FETCH_TIMEOUT_S = 15
PAGE_FETCH_USER_AGENT = (
    "Mozilla/5.0 (compatible; CremaCatalog/1.0; +https://crema.app/about)"
)
PAGE_TEXT_CAP = 12_000      # ~12 KB of page text fits comfortably in context

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_INPUT = os.path.join(_BASE_DIR, "output", "products.json")
_DEFAULT_OUTPUT = os.path.join(_BASE_DIR, "output", "products_enriched.json")
_CHECKPOINT = os.path.join(_BASE_DIR, "output", "enrich_checkpoint.jsonl")


# ── Extraction tool schema ────────────────────────────────────────────────────

_EXTRACT_TOOL = {
    "name": "extract_coffee_data",
    "description": (
        "Extract structured coffee product data from the layered context "
        "(title, URL, variants, tags, listing description, live product "
        "page text). The page text is the richest source — lean on it."
    ),
    "input_schema": {
        "type": "object",
        "required": [
            "is_coffee_bean",
            "coffee_name_clean",
            "origin",
            "altitude_masl",
            "roast_level",
            "roast_level_name",
            "process_raw",
            "tasting_notes",
            "flavor_notes",
            "varietal",
            "bean_type",
            "weight_grams",
            "producer",
            "roaster_blurb",
        ],
        "properties": {
            "is_coffee_bean": {
                "type": "boolean",
                "description": (
                    "True ONLY for roasted whole bean or ground coffee products — "
                    "including single-serve pour-over filter bags that contain "
                    "actual roasted coffee. False for: workshops, classes, "
                    "barista training, subscriptions (the subscription itself, "
                    "not a roastable bean), gift cards, gift sets / hampers, "
                    "merchandise (mugs, t-shirts, totes), equipment (grinders, "
                    "kettles, scales, drippers, accessories), cold brew cans, "
                    "ready-to-drink bottles, instant coffee jars, capsules / "
                    "pods, chocolate bars, tea, matcha, honey, syrups. "
                    "Use these signal sources jointly:\n"
                    "  • URL slug — `/products/barista-...`, `/products/"
                    "workshop-...`, `/products/class-...`, `/products/"
                    "subscription-...`, `/products/gift-card-...`, `/products/"
                    "merch-...`, `/products/equipment-...`, `/products/"
                    "grinder-...`, `/products/accessories-...`, `/products/"
                    "tour-...`, `/products/training-...` are strong negative "
                    "signals.\n"
                    "  • Variant shape — products with a single flat-price "
                    "variant and no weight options are rarely beans. Real "
                    "bean SKUs almost always have 250g / 500g / 1kg weight "
                    "options.\n"
                    "  • Page text — explicit mentions of roast level, "
                    "process, origin estate, varietal, altitude are positive "
                    "signals; mentions of 'class duration', 'instructor', "
                    "'workshop schedule', 'subscription plan', 'gift recipient' "
                    "are negative. When in doubt, lean false — non-coffee items "
                    "polluting the catalog is worse than missing one bean."
                ),
            },
            "coffee_name_clean": {
                "type": ["string", "null"],
                "description": (
                    "A standardised, display-ready product name. Apply these rules:\n"
                    "1. TASTING-NOTE SUFFIX: strip everything from ' - <Roast> Roast - "
                    "<tasting text>' onward. "
                    "'Vienna Roast - Dark Roast - Dark Chocolate & Smoke' → 'Vienna Roast'.\n"
                    "2. TASTER PACK DETAILS: remove pack quantity and discount text after "
                    "a dash or pipe. 'Dark Roast Taster Pack - (3 packs x 75 gm) | 20% Off' "
                    "→ 'Dark Roast Taster Pack'.\n"
                    "3. REGION + ROAST SUFFIX: strip trailing ' - <Region> - <Roast> Roast' "
                    "or ' - <Roast> Roast'. Keep estate name and process descriptor. "
                    "'Salawara Estate - Naturals - Sakleshpur - Light Roast' → "
                    "'Salawara Estate - Naturals'.\n"
                    "4. ALL CAPS: convert fully uppercase names to Title Case; preserve "
                    "emoji. 'MYSORE NUGGETS' → 'Mysore Nuggets'.\n"
                    "5. ROAST IN BRACKETS: remove '(Dark Roast)', '(Medium Roast)' etc. "
                    "'Arabica Blend (Dark Roast)' → 'Arabica Blend'.\n"
                    "6. ESTATE CAPITALISATION: title-case lowercase estate words. "
                    "'Attikan estate' → 'Attikan Estate'.\n"
                    "7. VERBOSE BLENDS: slim excessively long blend names to their core "
                    "identity. 'Special Peaberry + Special A 50:50 Mix' → 'Peaberry & "
                    "Special A Blend'.\n"
                    "8. PROCESS SUFFIX REDUNDANCY: strip trailing process tokens that "
                    "duplicate the `process_raw` field. 'Gangecool Estate - Washed' → "
                    "'Gangecool Estate'. Keep when it distinguishes two products from the "
                    "same estate (Washed lot vs Natural lot).\n"
                    "Return null if the raw name already passes all rules unchanged."
                ),
            },
            "origin": {
                "type": ["string", "null"],
                "description": (
                    "The specific farm, estate, or named micro-region. "
                    "E.g. 'Ratnagiri Estate', 'Attikan Estate', 'Bababudan Hills', "
                    "'Araku Valley'. Do NOT use generic state or country names alone. "
                    "Null if no specific estate or named growing region is mentioned "
                    "anywhere in the listing OR the page text."
                ),
            },
            "altitude_masl": {
                "type": ["integer", "null"],
                "description": (
                    "Growing altitude in metres above sea level as an integer. "
                    "For ranges like '900–1100m', use the midpoint (1000). "
                    "Look in the page text + description for: 'MASL', 'masl', "
                    "'m asl', 'meters above sea level', 'metres', or a 3-4 digit "
                    "number followed by 'm'/'ft'/'feet' in a coffee context. "
                    "Convert feet to metres (multiply by 0.3048, round to integer). "
                    "Null only if no altitude is stated."
                ),
            },
            "roast_level": {
                "type": ["string", "null"],
                "enum": ["Light", "Medium-Light", "Medium", "Medium-Dark", "Dark", None],
                "description": (
                    "Roast level mapped to a forgiving 5-bucket enum for downstream "
                    "filterability. Mapping rules:\n"
                    "  Vienna / French / Italian / Spanish → Dark\n"
                    "  Full City+ / Full City → Medium-Dark\n"
                    "  City+ / City → Medium-Light\n"
                    "  Espresso roast → Medium-Dark unless the roaster says light\n"
                    "  Filter roast → Medium-Light unless otherwise specified\n"
                    "  'Medium' / 'Medium roast' → Medium\n"
                    "Null only if no roast term appears anywhere."
                ),
            },
            "roast_level_name": {
                "type": ["string", "null"],
                "description": (
                    "The roast term EXACTLY as the roaster wrote it. Preserves "
                    "specificity that the bucketed `roast_level` enum loses. "
                    "Examples: 'Vienna', 'Full City+', 'City+', 'Espresso roast', "
                    "'Filter roast', 'Medium-Light', 'Mild roast'. If the listing "
                    "uses a generic 'Medium' or 'Dark' that maps cleanly to the "
                    "enum, repeat that. Null only if no roast term appears."
                ),
            },
            "process_raw": {
                "type": ["string", "null"],
                "description": (
                    "The processing method EXACTLY as the roaster wrote it. "
                    "Preserves specificity that an enum would lose — Indian "
                    "specialty coffee uses many experimental methods. Examples: "
                    "'Washed', 'Natural', 'Honey', 'Anaerobic Carbonic "
                    "Maceration', 'Lactic Fermented Natural', 'Yeast Inoculated "
                    "Honey', 'Wet-Hulled Giling Basah', 'Double Fermented "
                    "Anaerobic Honey', 'Semi-Washed', 'Pulped Natural'. "
                    "Strip leading/trailing whitespace and trailing punctuation "
                    "but keep the roaster's word order. Null only if no process "
                    "info appears anywhere in the text."
                ),
            },
            "tasting_notes": {
                "type": ["string", "null"],
                "description": (
                    "The roaster's tasting/flavour prose — exactly as written or "
                    "as a clean concise summary if the original is verbose. "
                    "E.g. 'fruity sweetness and silky body', 'dark chocolate and "
                    "caramel with a bright citrus finish'. "
                    "Null if no tasting information is present."
                ),
            },
            "flavor_notes": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Concise individual flavour descriptors, title case, 1-3 words "
                    "each. Infer from natural language tasting prose — don't "
                    "require the word to appear literally. Max 5. "
                    "Examples: 'fruity sweetness and silky body' → ['Fruity', 'Silky']; "
                    "'notes of dark chocolate, caramel, bright citrus' → "
                    "['Dark Chocolate', 'Caramel', 'Citrus']. Empty list if no "
                    "flavour information is present."
                ),
            },
            "varietal": {
                "type": ["string", "null"],
                "description": (
                    "Coffee plant CULTIVAR — the specific botanical variety. "
                    "E.g. 'SLN 795', 'SLN 9', 'Cauvery', 'Chandragiri', "
                    "'Bourbon', 'Typica', 'Catimor', 'Selection 5', "
                    "'Selection 6', 'Geisha', 'SL28', 'Catuai'. If multiple "
                    "are listed, join with ' + '. Null if not mentioned.\n"
                    "DISAMBIGUATION — CRITICAL, READ CAREFULLY:\n"
                    "  • 'Arabica' / 'Robusta' / 'Liberica' / 'Excelsa' / "
                    "'Blend' are SPECIES (the `bean_type` field), NOT "
                    "varietals. NEVER put a species name in `varietal` — "
                    "this is the most common extraction mistake and the "
                    "single rule that matters most. The `varietal` field "
                    "is ONLY for specific cultivar names (Catuai, "
                    "Chandragiri, SLN 9, Bourbon-the-plant, Geisha, etc.).\n"
                    "  • Worked example A — page says '100% Arabica' only: "
                    "varietal=NULL, bean_type='Arabica'. The species "
                    "information goes in bean_type. varietal stays null.\n"
                    "  • Worked example B — page says 'Arabica, washed' only: "
                    "varietal=NULL, bean_type='Arabica', process='Washed'. "
                    "Same rule — Arabica is the species, not a cultivar.\n"
                    "  • Worked example C — page says '70% Arabica + 30% "
                    "Robusta blend': varietal=NULL, bean_type='Blend'. The "
                    "ratio is interesting prose but neither species is a "
                    "varietal.\n"
                    "  • Worked example D — page says 'SLN 9 Arabica, "
                    "natural processed at Ratnagiri Estate': "
                    "varietal='SLN 9', bean_type='Arabica'. SLN 9 is a "
                    "real cultivar (Indian Selection 9, an Arabica), so "
                    "it goes in varietal; Arabica goes in bean_type.\n"
                    "  • Worked example E — page says 'Catuai + Bourbon, "
                    "Arabica from Mysore': varietal='Catuai + Bourbon', "
                    "bean_type='Arabica'. Two cultivars + the species.\n"
                    "  • If the source says NOTHING beyond 'Arabica' or "
                    "'Robusta' or 'Blend' — leave varietal NULL. Don't "
                    "guess. Don't recycle the species name. NULL is the "
                    "correct answer.\n"
                    "  • Barrel-aging context: phrases like 'Bourbon "
                    "Barrel Aged', 'Whiskey Barrel Aged', 'Rum Barrel "
                    "Aged', 'Wine Barrel Aged', 'Agave Barrel Aged' refer "
                    "to the SPIRIT/WINE/SPIRIT used in the wooden barrel "
                    "that ages the coffee — NOT to a coffee varietal. "
                    "When 'Bourbon' / 'Whiskey' / 'Rum' / etc. appears "
                    "ONLY in barrel-aging context, varietal = NULL "
                    "(unless the underlying coffee's cultivar is "
                    "separately disclosed elsewhere on the page — e.g. "
                    "'Catuai aged in Bourbon barrels' → varietal = "
                    "'Catuai'). The barrel-aging method itself belongs "
                    "in process_raw ('Bourbon Barrel Aged', 'Whiskey "
                    "Barrel Aged Natural', etc.).\n"
                    "  • 'Bourbon' AS A REAL VARIETAL is legitimate (a "
                    "coffee cultivar grown in Nicaragua, El Salvador, "
                    "Brazil, parts of India). Use varietal = 'Bourbon' "
                    "ONLY when the page describes the COFFEE PLANT — "
                    "e.g. 'Nicaraguan Bourbon at 1500 masl', 'old "
                    "Bourbon trees', 'planted with Bourbon varietal', "
                    "'classic Bourbon cultivar'. The signal is "
                    "agronomic/botanical context, not culinary/spirits."
                ),
            },
            "bean_type": {
                "type": ["string", "null"],
                "enum": ["Arabica", "Robusta", "Liberica", "Excelsa", "Blend", None],
                "description": (
                    "Species-level classification. Rules:\n"
                    "  'Arabica' — 100% Arabica (explicit, or all detected cultivars "
                    "are Arabica). Indian Arabica cultivars include: "
                    "SLN 795 / S795, SLN 9 / Sln 9 / Selection 9 (CCRI 1985 hybrid, "
                    "Tafarikela × Hibrido de Timor — leaf-rust tolerant), "
                    "SLN 4 / Sln 4 / Selection 4, SLN 6 / Selection 6, "
                    "SLN 7 / Selection 7, SLN 12 / Cauvery (a Catimor variant), "
                    "Chandragiri, Hemavathi, Catuai, Bourbon, Caturra, Catimor, "
                    "Geisha, Kents, Sachimore, Tafarikela, Hibrido de Timor, "
                    "Typica, San Ramon, SL28.\n"
                    "  'Robusta' — 100% Robusta (explicit, or all cultivars are "
                    "Robusta). Indian Robusta cultivars include: "
                    "SLN 274 / S 274 / Selection 274 (the canonical Indian "
                    "Robusta), S5B / Selection 5B, S5A / Selection 5A, "
                    "Old Peradeniya / Peradeniya (Sri Lankan-origin Robusta), "
                    "CxR (Congensis × Robusta cross), Conillon.\n"
                    "  IMPORTANT — common confusion: SLN 9 (Indian Selection 9) "
                    "is ARABICA, not Robusta. The Indian Robusta selections are "
                    "SLN 274 and S5B. Don't classify SLN 9 / Sln 9 / Selection 9 "
                    "as Robusta — that's a known mis-pattern.\n"
                    "  'Liberica' / 'Excelsa' — explicit mention only (rare in "
                    "Indian estates but emerging).\n"
                    "  'Blend' — explicitly mixes two or more species.\n"
                    "  Null if species cannot be determined from the text."
                ),
            },
            "weight_grams": {
                "type": ["integer", "null"],
                "description": (
                    "Net weight per bag in grams. Look across:\n"
                    "  • The variants table (the smallest weight option is canonical).\n"
                    "  • The product title ('250g', '500 gms', '1kg', '8 oz').\n"
                    "  • The page text body copy.\n"
                    "Conversions:\n"
                    "  • '1kg' / '1 kilo' / '1 kilogram' → 1000\n"
                    "  • '8oz' / '8 oz' / '8 ounce' → 227 (round)\n"
                    "  • '250 gms' / '250 grams' / '250 g' → 250\n"
                    "  • '0.5 kg' → 500\n"
                    "If multiple sizes are sold (250g + 500g + 1kg variants), pick "
                    "the SMALLEST positive size — that's the unit downstream pricing "
                    "logic uses. Null only if no quantity appears anywhere."
                ),
            },
            "producer": {
                "type": ["string", "null"],
                "description": (
                    "The named individual or family who grew / harvested / processed "
                    "the coffee, if mentioned. Watch for narrative phrasing like "
                    "'grown by the Mathew family at Salawara Estate', 'sourced from "
                    "Mr. Krishnamurthy', 'producer: Anil Bhaskaran', 'farmed by the "
                    "Kalathil estate team'. Return just the name or family — not "
                    "the estate. Null if no producer is named (estate-only mentions "
                    "don't count)."
                ),
            },
            "brew_recommendation": {
                "type": ["object", "null"],
                "description": (
                    "The roaster's suggested brewing approach, if they explicitly "
                    "recommend one. Look for sidebars / sections like 'Brew guide', "
                    "'Pulls best as…', 'We recommend pour-over at 1:16'. Return "
                    "null if no recommendation is present — don't guess from the "
                    "bean's character."
                ),
                "properties": {
                    "method": {
                        "type": ["string", "null"],
                        "description": (
                            "One of: 'espresso', 'pour_over', 'aeropress', "
                            "'french_press', 'cold_brew', 'moka', 'siphon', "
                            "'turkish', 'south_indian_filter', 'other'. "
                            "Null if a method isn't named."
                        ),
                    },
                    "dose_grams": {
                        "type": ["number", "null"],
                        "description": "Coffee dose in grams (18 for espresso, 22 for pour-over).",
                    },
                    "ratio": {
                        "type": ["string", "null"],
                        "description": "Coffee-to-water ratio as written ('1:2', '1:16').",
                    },
                    "water_temp_celsius": {
                        "type": ["integer", "null"],
                        "description": "Brew temperature in °C if specified.",
                    },
                    "notes": {
                        "type": ["string", "null"],
                        "description": (
                            "Verbatim or near-verbatim short note from the roaster "
                            "(under 200 chars)."
                        ),
                    },
                },
            },
            "roaster_blurb": {
                "type": ["string", "null"],
                "description": (
                    "A clean 1-2 sentence third-person narrative about THIS specific "
                    "bean — distilled from the roaster's prose on the product page. "
                    "Capture the SOURCING STORY (where it came from, why), the "
                    "PROCESSING approach the roaster wants to highlight, or what "
                    "makes this particular bean distinctive in their lineup. "
                    "Examples of good blurbs:\n"
                    "  • 'A small-lot natural-process Cauvery from the Mathew "
                    "family's Salawara Estate, fermented in cherry under banana "
                    "leaves before sun-drying for 18 days.'\n"
                    "  • 'The roastery's flagship espresso blend — 70% Karnataka "
                    "washed Arabica with a 30% Robusta backbone for crema and depth.'\n"
                    "Voice rules:\n"
                    "  • Third person.\n"
                    "  • Don't repeat tasting notes (those have their own field).\n"
                    "  • Don't include marketing slogans verbatim — distill into prose.\n"
                    "Thin-source fallback — DO NOT return null when ANY of these "
                    "are present:\n"
                    "  • The product page has structured spec fields you extracted "
                    "(roast_level, bean_type, origin, process_raw, varietal, "
                    "altitude_masl, producer, weight_grams).\n"
                    "  • The page lists tasting notes, even if the surrounding prose "
                    "is sparse.\n"
                    "In that case, construct a brief one-sentence blurb from the "
                    "extracted fields. Templates:\n"
                    "  • '[Roast level] [bean_type] from [origin], [process_raw] "
                    "processed[ at [altitude_masl]m][, by [producer]].'\n"
                    "  • 'A [roast_level] [varietal] from [origin], showing "
                    "[2-3 flavor notes].'\n"
                    "  • If only species and brand are known: 'A "
                    "[roast_level] [bean_type] blend from [roaster name in "
                    "field's natural place].' (Use roaster name from the user "
                    "message ROASTER section.)\n"
                    "Only return null when there is genuinely nothing to work "
                    "with — no structured fields, no tasting prose, no body copy. "
                    "An empty or one-line product page warrants a constructed "
                    "blurb, not null. Don't invent details (estate names, "
                    "altitudes, fermentation specifics) that aren't in the source."
                ),
            },
        },
    },
}


# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM = """\
You are a structured-data extractor for Crema, a specialty coffee discovery
platform focused on Indian roasters.

You will be given a layered context per product:
  • PRODUCT TITLE — what the listing endpoint calls it.
  • PRODUCT URL — the slug often signals product type (workshop, gift card, etc.).
  • VARIANTS — sizes + prices. Real bean SKUs almost always have weight options.
  • TAGS — collection labels from the listing endpoint.
  • LISTING DESCRIPTION — short summary from the listing endpoint.
  • PAGE TEXT — the full product detail page, BeautifulSoup-stripped. THE
    RICHEST SOURCE — lean on it for sourcing stories, altitude, varietal,
    process detail, tasting prose, and roaster narrative. The other layers
    are short and may be marketing-only.

Be conservative: only extract what is explicitly stated or strongly implied
across the layered context. Never invent details. Return null when the
source genuinely doesn't say.

is_coffee_bean is the most consequential field. If it's wrong upstream
catalog pollution propagates to consumers. Use the URL slug + variant shape
+ page text together — see the field's schema description for specifics.
When in doubt, return false.

Field-specific guidance is in each field's schema description.
"""


# ── Live page-fetch helper ────────────────────────────────────────────────────

def _is_wix_url(url: str) -> bool:
    """Detect whether a product URL is hosted on Wix.

    Two reliable signals:
      • `*.wix.com` / `*.wixsite.com` direct hostnames.
      • A `/product-page/<slug>` path — Wix Stores' canonical product
        URL pattern, used on custom domains like 729grams.coffee that
        run on Wix under the hood.

    A false-positive risks a 5-10s headless render where a plain
    requests.get would have sufficed; a false-negative leaves the
    table content un-extracted. We bias toward catching Wix.
    """
    if not url:
        return False
    lower = url.lower()
    return (
        ".wix.com" in lower
        or ".wixsite.com" in lower
        or "/product-page/" in lower
    )


def _fetch_product_page_text(url: str) -> str:
    """Fetch the live product detail page and strip to clean text.

    Why: listing endpoints (Shopify /products.json, Woo's REST output)
    often surface only marketing-level copy — the full sourcing story,
    altitude, varietal detail, brew guide all live on the rendered
    detail page. Fetching once per enrichment closes that gap.

    Wix sites are JS-rendered SPAs (single-page apps). Their product
    detail tables (Producer / Variety / Notes / Process / Altitude)
    load post-page-load via Velo XHR calls — a plain `requests.get`
    gets only a hydration shell. Route those through the hybrid Wix
    fetcher, which falls back to Playwright headless Chromium when
    the cheap path doesn't yield rich content.

    Returns "" on any failure (timeout, 4xx, 5xx, parse error,
    Playwright not installed, etc.) — Haiku falls back to whatever
    the listing endpoint provided. Capped at PAGE_TEXT_CAP chars so
    the prompt budget stays sane.
    """
    if not url or not url.startswith(("http://", "https://")):
        return ""

    # Wix path — hybrid fetcher with headless fallback.
    if _is_wix_url(url):
        try:
            from scraper.wix_fetcher import fetch_wix_page_text
        except ImportError:
            # Module path differs in some packaging arrangements;
            # try the alternate path before giving up.
            try:
                from .wix_fetcher import fetch_wix_page_text  # type: ignore
            except ImportError:
                return ""
        try:
            return fetch_wix_page_text(url)
        except Exception:
            return ""

    # Default path — plain requests + BeautifulSoup. Covers Shopify,
    # WooCommerce, Magento, and any other SSR'd platform.
    try:
        resp = requests.get(
            url,
            timeout=PAGE_FETCH_TIMEOUT_S,
            headers={"User-Agent": PAGE_FETCH_USER_AGENT},
        )
        if resp.status_code != 200:
            return ""
        soup = BeautifulSoup(resp.text, "html.parser")
        # Drop chrome that pollutes the extraction with nav links and
        # site-wide footer copy. Per-product content lives in <main> or
        # within a `.product` / `.product-detail` container on most
        # platforms; fall back to body if neither is present.
        for tag in soup(["script", "style", "nav", "footer", "header",
                          "aside", "noscript", "iframe", "form"]):
            tag.decompose()
        target = (
            soup.find("main")
            or soup.find(class_=lambda c: bool(c) and "product" in c.lower())
            or soup.body
            or soup
        )
        text = target.get_text(separator="\n", strip=True)
        # Collapse runs of blank lines so the prompt isn't padded with
        # whitespace.
        lines = [ln for ln in (line.strip() for line in text.splitlines()) if ln]
        cleaned = "\n".join(lines)
        return cleaned[:PAGE_TEXT_CAP]
    except (requests.RequestException, OSError, ValueError):
        return ""


def _format_variants(variants: list) -> str:
    """Compact variant table for the LLM prompt — sizes + prices only.

    A single flat-price variant with no weight is a strong negative
    is_coffee_bean signal; multiple weighted variants (250g/500g/1kg)
    is a strong positive. We keep the format tight (one line per
    variant, max 8 lines) so the prompt budget goes to the page text.
    """
    if not variants:
        return ""
    lines = []
    for v in variants[:8]:
        wg = v.get("weight_grams")
        pr = v.get("price_inr")
        label = v.get("title") or v.get("option1") or v.get("option_value") or "(unnamed)"
        wg_str = f"{wg}g" if wg else "—"
        pr_str = f"₹{pr}" if pr is not None else "—"
        lines.append(f"  - {label} | weight={wg_str} | price={pr_str}")
    suffix = f"  (+ {len(variants) - 8} more)" if len(variants) > 8 else ""
    return "Variants:\n" + "\n".join(lines) + (("\n" + suffix) if suffix else "")


def _build_user_content(
    product: dict,
    page_text: str,
    image_ocr_text: str = "",
) -> str:
    """Assemble the layered context the LLM sees per product.

    Order matters: title and URL come first because they're the highest
    information density per token. Page text comes last so the LLM can
    use the structured prefix as scaffolding while skimming the long
    body. Image OCR text — when present — slots between the listing
    description and page text, since on platforms like 729-Grams the
    image card is the AUTHORITATIVE source for the structured fields
    (page text is sparse, image card has the full table).
    """
    title = product.get("coffee_name") or product.get("title") or ""
    product_url = product.get("product_url") or ""
    tags = ", ".join(str(t) for t in (product.get("tags") or []))
    listing_desc = (product.get("description_raw") or "").strip()
    variants = product.get("variants") or []
    roaster_existing = product.get("roast_level") or ""
    process_existing = product.get("process") or ""

    parts = [f"PRODUCT TITLE: {title}"]
    if product_url:
        parts.append(f"PRODUCT URL: {product_url}")
    variant_block = _format_variants(variants)
    if variant_block:
        parts.append(variant_block)
    if tags:
        parts.append(f"TAGS: {tags}")
    if roaster_existing or process_existing:
        hints = []
        if roaster_existing and roaster_existing != "Unknown":
            hints.append(f"  regex roast hint: {roaster_existing}")
        if process_existing:
            hints.append(f"  regex process hint: {process_existing}")
        parts.append("PRE-EXTRACTED HINTS (may be inaccurate):\n" + "\n".join(hints))
    if listing_desc:
        parts.append(
            "LISTING DESCRIPTION (truncated):\n" + listing_desc[:2000]
        )
    if image_ocr_text:
        parts.append(
            "IMAGE OCR (extracted from product image — info-card content "
            "the roaster encoded as pixels, not HTML. Often the "
            "AUTHORITATIVE source for Producer / Variety / Notes / "
            "Process / Altitude on roasters that design Canva/Figma "
            "cards):\n" + image_ocr_text
        )
    if page_text:
        parts.append(
            "PAGE TEXT (live fetch, cleaned — RICHEST SOURCE):\n" + page_text
        )
    return "\n\n".join(parts)


# ── Pre-LLM heuristic ────────────────────────────────────────────────────────
#
# Cheap regex pass that classifies a storefront row as `skip` (obviously
# not a coffee bean — workshop, t-shirt, gift hamper, equipment), `send`
# (looks unambiguously like a bean — explicit roast / origin / Arabica
# mention), or `uncertain` (neither signal fired — let Haiku decide).
#
# Why: roaster storefronts routinely ship 40-60% non-coffee SKUs
# (training, merch, brewers, gift packs). Sending every one of them
# to Haiku burns the same per-call cost as a real bean even though
# the answer is foregone. A regex pre-filter trims the Haiku budget
# 50-70% on a typical Shopify catalog with zero added risk: `skip`
# is gated to URL paths + title patterns whose negative signal is
# unambiguous (`/workshops/`, `\bT-Shirt\b`, `\bGrinder\b`, etc.),
# and `uncertain` rows still flow to Haiku unchanged.

# L1 — URL path fragments that mark a product as obviously not a bean.
# Substring match on the lowercased URL. Tight set — only fragments
# that no roaster uses for actual bean listings.
_HEURISTIC_URL_NEGATIVES: tuple[str, ...] = (
    "/merch/",
    "/equipment/",
    "/training/",
    "/workshops/",
    "/workshop",
    "/courses/",
    "/course/",
    "/gift-cards/",
    "/consultation",
    "/lesson",
)

# L2 — title regex patterns that mark a product as obviously not a bean.
# Case-insensitive. Each pattern is anchored on word boundaries so
# substring noise doesn't cause spurious skips ("Course" matches "Course"
# but not "Coursey"). A handful use negative lookahead to avoid catching
# the (rare) legitimate bean: `Indian Filter` is the device unless
# followed by " Coffee" (the real bean is called "Indian Filter Coffee"
# on the 93-degrees catalog and elsewhere); `Mug` is merch unless
# followed by " Cake" (defensive — no Mug Cake in the current corpus
# but cheap to keep).
_HEURISTIC_TITLE_NEGATIVES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE) for p in (
        r"\bT-?[Ss]hirt\b",
        r"\bWorkshop\b",
        r"\bCourse\b",
        r"\bConsultation\b",
        r"\bSubscription\b",
        r"\bTumbler\b",
        r"\bMug\b(?! Cake)",
        r"\bFrench Press\b",
        r"\bMokapot\b",
        r"\bMoka [Pp]ot\b",
        r"\bPlunger\b",
        r"\bDrip Filter\b",
        r"\bIndian Filter\b(?! Coffee)",
        r"\bCatering\b",
        r"\bLesson\b",
        r"\bGrinder\b",
        r"\bAero-?[Pp]ress\b",
        r"\bPour-?[Oo]ver Box\b",
        r"\bGift (?:Box|Parcel|Basket|Hamper)\b",
        r"\bMini [A-Z]{2}\b",
        r"\bGift Card\b",
        r"\bSensory (?:Workshop|Skills)\b",
        r"\bSCA Intro\b",
        r"\bBarista (?:Lesson|Training)\b",
        r"\bFoundation Course\b",
        r"\bIntermediate Course\b",
        r"\bProfessional Course\b",
        r"\bCherry Tea\b",
        r"\bCascara\b",
    )
)

# L3 — title regex patterns that mark a product as obviously a bean.
# Same case-insensitive ladder. Origin / region patterns lean Indian
# (Karnataka, Coorg, Chikmagalur, Araku, Wayanad, Tamil Nadu) plus the
# common African specialty regions (Ethiopia, Yirgacheffe, Sidamo,
# Guji) — the audience is Indian-specialty-first, but those African
# regions show up in Indian roasters' lineups often enough to be worth
# matching. `\bEspresso\b` only fires as a positive when NOT modified
# by Workshop / Course (those L2 negatives short-circuit first).
_HEURISTIC_TITLE_POSITIVES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE) for p in (
        r"\bRoast(?:ed)?\b",
        r"\bBeans?\b",
        r"\bEspresso\b",
        r"\bSingle Origin\b",
        r"\bArabica\b",
        r"\bRobusta\b",
        # Origin / region — Indian specialty regions first, then a few
        # well-known global origins commonly featured by Indian roasters.
        r"\bEthiopian?\b",
        r"\bYirgacheffe\b",
        r"\bSidamo\b",
        r"\bGuji\b",
        r"\bChikmagalur\b",
        r"\bKarnataka\b",
        r"\bCoorg\b",
        r"\bAraku\b",
        r"\bWayanad\b",
        r"\bTamil Nadu\b",
    )
)


def _likely_coffee_bean(product: dict) -> Literal["skip", "send", "uncertain"]:
    """Pre-Haiku classifier — return `skip` / `send` / `uncertain`.

    Cheap regex-only pass over title + URL. `skip` rows never reach the
    LLM; the runner stages them as auto-rejected proposals so the audit
    trail is preserved without burning a Haiku call. `send` and
    `uncertain` both flow to Haiku as today — `uncertain` is the safe
    default, used whenever neither the negative nor the positive ladder
    has a confident answer.

    Layer order:
      L1: URL path negatives → skip
      L2: title regex negatives → skip
      L3: title regex positives → send
      L4: default → uncertain
    """
    url = (product.get("product_url") or "").lower()
    if any(frag in url for frag in _HEURISTIC_URL_NEGATIVES):
        return "skip"

    title = product.get("title") or product.get("coffee_name") or ""
    if title:
        for pat in _HEURISTIC_TITLE_NEGATIVES:
            if pat.search(title):
                return "skip"
        for pat in _HEURISTIC_TITLE_POSITIVES:
            if pat.search(title):
                return "send"

    return "uncertain"


# ── Core enrichment call ──────────────────────────────────────────────────────

def _enrich_one(
    client: anthropic.Anthropic,
    product: dict,
    system_addendum: str | None = None,
) -> dict | None:
    """Call Claude Haiku with tool use to extract structured fields.

    Always fetches the live product page and passes it alongside the
    listing-endpoint data — the page is where the rich narrative lives.
    Returns the tool-input dict, or None if all retries fail.

    `system_addendum`: optional per-roaster prompt addendum produced
    by `services/site_prompt_generator.py`. When provided, it's
    appended to the base system prompt (as a "SITE-SPECIFIC NOTES"
    block) so Haiku gets the past experience for free on every
    subsequent run for the same roaster. None / empty string means
    fall back to the base prompt only — first-run behaviour.
    Also re-fetches `page_text` for caller-side hint generation,
    surfaced via the returned dict's `_page_text` key (private
    convention) so the runner can sample without fetching twice.

    Pre-LLM heuristic: rows that `_likely_coffee_bean` flags as
    `"skip"` (URL contains `/workshops/` / `/merch/` / etc., or the
    title matches one of the unambiguous-non-bean patterns — t-shirt,
    workshop, gift hamper, mokapot, …) are short-circuited here
    with a stub dict that carries `is_coffee_bean=False` plus a
    `_heuristic_skip_reason` marker. No HTTP fetch, no LLM call.
    `"send"` and `"uncertain"` both flow through to the LLM
    unchanged — `"uncertain"` is the safe default whenever neither
    ladder fired confidently.
    """
    heuristic = _likely_coffee_bean(product)
    if heuristic == "skip":
        # Stub matches the shape `_merge` expects — `is_coffee_bean=False`
        # is the only field downstream consumers care about for a
        # rejected row, plus the private `_heuristic_skip_reason` flag so
        # the runner can stage this as an auto-rejected proposal rather
        # than dropping it silently (preserves audit trail).
        return {
            "is_coffee_bean": False,
            "coffee_name_clean": (
                product.get("title") or product.get("coffee_name")
                or product.get("product_name")
            ),
            "_heuristic_skip_reason": "non_coffee_url_or_title",
        }

    page_text = _fetch_product_page_text(product.get("product_url", ""))

    # Image OCR pass — some roasters (Wix users especially, but the
    # pattern recurs on any roaster that designs info cards in
    # Canva/Figma) encode Producer / Variety / Notes / Process /
    # Altitude as text RENDERED INTO A PNG, not as HTML. The page
    # text fetch sees the <img> tag but not the table content. Run
    # OCR on the product's primary image so Haiku has those fields
    # to extract from. Tesseract handles most cases for free; if
    # we ever wire Haiku-vision as an escalation it goes through
    # the haiku_vision_callback parameter.
    image_ocr_text = ""
    image_url = product.get("image_url") or product.get("image_raw") or ""
    if image_url:
        try:
            from scraper.image_ocr import ocr_product_image
        except ImportError:
            try:
                from .image_ocr import ocr_product_image  # type: ignore
            except ImportError:
                ocr_product_image = None  # type: ignore
        if ocr_product_image is not None:
            try:
                image_ocr_text = ocr_product_image(image_url)
            except Exception:
                image_ocr_text = ""

    user_content = _build_user_content(product, page_text, image_ocr_text)

    system_prompt = _SYSTEM
    if system_addendum and system_addendum.strip():
        system_prompt = (
            _SYSTEM
            + "\n\nSITE-SPECIFIC NOTES (this roaster only — past runs):\n"
            + system_addendum.strip()
        )

    # Route through services.llm_router when the FastAPI runtime is
    # in scope (under FastAPI, services/ is on sys.path; standalone
    # scraper, it isn't). The router internally picks SDK or queue
    # per provider env. Standalone scraper falls back to the legacy
    # SDK retry loop below.
    try:
        from services.llm_router import call_llm, LLMCallError  # type: ignore
        _has_router = True
    except ImportError:
        call_llm = None  # type: ignore
        LLMCallError = Exception  # type: ignore
        _has_router = False

    if _has_router:
        try:
            out = call_llm(
                step="product_enrich",
                system=system_prompt,
                tool=_EXTRACT_TOOL,
                user_content=user_content,
                max_tokens=MAX_TOKENS,
                model=MODEL,
                target_id=product.get("product_url", ""),
            )
        except LLMCallError as exc:
            print(f"    [llm_router] {exc}", flush=True)
            return None
        if out is None:
            return None
        out = dict(out)
        if page_text:
            out["_page_text"] = page_text[:1500]
        return out

    # Standalone scraper path — SDK direct with manual retries.
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                tools=[_EXTRACT_TOOL],
                tool_choice={"type": "tool", "name": "extract_coffee_data"},
                messages=[{"role": "user", "content": user_content}],
            )
            for block in resp.content:
                if block.type == "tool_use":
                    out = dict(block.input)
                    # Stash the page text so the runner can pass it to
                    # the meta-prompt generator without re-fetching.
                    # Underscore-prefixed → not part of the schema, the
                    # `_merge` step ignores unknown keys.
                    if page_text:
                        out["_page_text"] = page_text[:1500]
                    return out

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
    """Merge LLM-extracted fields into a product dict.

    LLM values win when they have an opinion (non-null); existing
    values survive only when the LLM returns null. `is_coffee_bean=False`
    rows are kept in the output but flagged so callers can drop them
    before staging proposals.
    """
    out = dict(product)

    out["is_coffee_bean"] = llm.get("is_coffee_bean", True)

    # Display name override — LLM cleans up listing-side noise.
    llm_name = llm.get("coffee_name_clean")
    if llm_name:
        out["coffee_name_clean"] = llm_name
        out["coffee_name"] = llm_name

    # Bean species (Arabica / Robusta / Blend / Liberica / Excelsa / null)
    if llm.get("bean_type"):
        out["bean_type"] = llm["bean_type"]

    # Origin estate / micro-region
    if llm.get("origin"):
        out["origin"] = llm["origin"]

    # Altitude
    if llm.get("altitude_masl") is not None:
        out["altitude_masl"] = llm["altitude_masl"]

    # Roast level — bucketed enum AND verbatim term.
    if llm.get("roast_level"):
        out["roast_level"] = llm["roast_level"]
    if llm.get("roast_level_name"):
        out["roast_level_name"] = llm["roast_level_name"]

    # Process — only the verbatim form. The legacy `process` enum field
    # stays untouched on the row (canonicalization happens later in the
    # MAPPING tab's Process Graph), but the enricher no longer writes
    # to it.
    if llm.get("process_raw"):
        out["process_raw"] = llm["process_raw"]

    # Tasting prose + concise array
    if llm.get("tasting_notes"):
        out["tasting_notes"] = llm["tasting_notes"]
    out["flavor_notes"] = llm.get("flavor_notes") or product.get("flavor_notes") or []

    # Varietal
    if llm.get("varietal"):
        out["varietal"] = llm["varietal"]

    # Weight — LLM only fills when the scraper missed it. Hard-coded
    # variant extraction stays authoritative when it works.
    if llm.get("weight_grams") and not out.get("weight_grams"):
        out["weight_grams"] = llm["weight_grams"]

    # Producer
    if llm.get("producer"):
        out["producer"] = llm["producer"]

    # Brew recommendation — store as JSON for downstream typing.
    brew = llm.get("brew_recommendation")
    if brew and any(v is not None for v in brew.values()):
        out["brew_recommendation_json"] = json.dumps(brew, ensure_ascii=False)

    # Per-bean narrative blurb (third-person, distilled).
    if llm.get("roaster_blurb"):
        out["roaster_blurb"] = llm["roaster_blurb"]

    # Carry the page-text excerpt forward (private convention — runner
    # uses it to seed the post-run meta-prompt sampler without
    # re-fetching the live page). Stripped before the row lands in
    # `scrape_proposals` by `_product_lite_from_scraped`.
    if llm.get("_page_text"):
        out["_page_text"] = llm["_page_text"]

    # Pre-LLM heuristic skip flag (private convention — runner uses it
    # to stage the row as an auto-rejected proposal rather than dropping
    # it silently). Stripped before the row lands in the `products`
    # table — the heuristic stub doesn't carry the full schema, so it
    # would pollute the catalog if applied. Same shape as `_page_text`
    # — the runner reads it, then `_product_lite_from_scraped` ignores
    # it.
    if llm.get("_heuristic_skip_reason"):
        out["_heuristic_skip_reason"] = llm["_heuristic_skip_reason"]
        out["llm_enriched"] = False
        out["enrichment_status"] = "heuristic_skip"
        return out

    out["llm_enriched"] = True
    out["enrichment_status"] = "enriched"
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
            kept = dict(product)
            kept["enrichment_status"] = "failed"
            newly_enriched.append(kept)
            continue

        # Print what we extracted — quick at-a-glance check per product.
        is_bean = llm_data.get("is_coffee_bean", True)
        roast = llm_data.get("roast_level_name") or llm_data.get("roast_level") or "—"
        proc = llm_data.get("process_raw") or "—"
        origin = llm_data.get("origin") or "—"
        alt = llm_data.get("altitude_masl")
        alt_str = f"{alt}m" if alt else "—"
        weight = llm_data.get("weight_grams")
        wt_str = f"{weight}g" if weight else "—"
        notes = (llm_data.get("tasting_notes") or "")[:60]
        blurb = (llm_data.get("roaster_blurb") or "")[:80]

        status = "✓ coffee" if is_bean else "✗ NOT coffee"
        print(f"  {status} | {roast} | {proc} | {origin} | {alt_str} | {wt_str}", flush=True)
        if notes:
            print(f"  notes: {notes}", flush=True)
        if blurb:
            print(f"  blurb: {blurb}", flush=True)

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
    with_proc = sum(1 for p in all_enriched if p.get("process_raw"))
    with_weight = sum(1 for p in all_enriched if p.get("weight_grams"))
    with_blurb = sum(1 for p in all_enriched if p.get("roaster_blurb"))

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
    print(f"  With process_raw     : {with_proc}  ({pct(with_proc)})")
    print(f"  With weight_grams    : {with_weight}  ({pct(with_weight)})")
    print(f"  With roaster_blurb   : {with_blurb}  ({pct(with_blurb)})")
    if failed:
        print(f"  Failed (kept raw)    : {len(failed)}")
    print(f"  Output               : {args.output}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()
