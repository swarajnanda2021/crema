"""
Origin / varietal canonicalization helpers.

Phase 1 light-touch pass that produces filterable chip values from the
free-text `origin` + `varietal` columns the scraper + Haiku enricher
deposit. Used in two places:

  1. The one-shot backfill migration (`backfill_canonical_columns`
     in catalog_ops) populates `products.origin_region` +
     `products.varietal_canonical` for every existing row.
  2. The per-scrape staging path (`_product_lite_from_scraped` in
     scrape_runner) populates the same two columns inline so new
     enrichment runs land canonical chip values without a separate
     pass.

A heavier curated pass — the planned **Coffee Standardization**
sub-tab in Catalog Ops — will rework bean_type + location +
tasting notes for the full catalog with a Haiku-driven exemplar
flow. When that lands, this regex pass becomes the *seed*; the
admin overrides on a per-row basis from the standardization tab.
The chip axis (`origin_region`, `varietal_canonical`) doesn't
change; only the values written into it do.

No "Other" chip by design — origins / varietals that don't match
the canonical patterns return None and stay search-only.
"""

from __future__ import annotations

import re
from typing import Optional

# ── Region canonicalization ────────────────────────────────────────────────
#
# Indian regions tried first since the catalog is India-heavy. Patterns
# are case-insensitive, anchored on word boundaries to avoid bleed
# (e.g., "harar" shouldn't match "harari" if the latter ever appears
# unrelated to coffee). Order matters: most specific first within each
# block so "Bababudan Hills, Chikmagalur" picks Bababudan before
# falling through to Chikmagalur.

_INDIAN_REGION_MAP: list[tuple[str, list[str]]] = [
    ("Coorg", [r"\b(coorg|kodagu|madikeri|gonikoppal|virajpet|somwarpet)\b"]),
    ("Bababudan", [r"\b(baba\s*budan|bababudan|baba-budan)\b"]),
    ("BR Hills", [r"\b(b\.?\s*r\.?\s*hills?|biligiri\s*ranga\w*)\b"]),
    # Chikmagalur has many transliterations: Chikkamagaluru (official),
    # Chickmagalur, Chikmaglur (common typo). `\w*` tail catches the
    # "uru" suffix on the official spelling without bleeding.
    ("Chikmagalur", [
        r"\b(chikmagalur\w*|chickmagalur\w*|chikkamagalur\w*|chikmaglur\w*)\b",
    ]),
    ("Sakleshpur", [r"\bsakleshpur\b"]),
    ("Hassan", [r"\bhassan\b"]),
    ("Mysuru", [r"\b(mysuru|mysore)\b"]),
    ("Wayanad", [r"\bwayanad\b"]),
    ("Nilgiris", [r"\b(nilgiris?|ooty|coonoor|kotagiri)\b"]),
    ("Araku Valley", [r"\b(araku|aruku)\b"]),
    # Eastern Ghats covers the Odisha + Andhra coffee belt. Koraput
    # district and Tribal Tracts in Odisha grow specialty Arabica
    # under the Eastern Ghats banner.
    ("Eastern Ghats", [r"\b(eastern\s*ghats?|koraput|kindiriguda)\b"]),
    # Shevaroy Hills (Yercaud area, Tamil Nadu) — distinct enough
    # specialty district to be its own chip rather than fold into
    # "Pulneys" or "Nilgiris".
    ("Shevaroy Hills", [r"\b(shevaroy\w*|yercaud)\b"]),
    ("Pulneys", [r"\b(pulneys|palanis|kodaikanal)\b"]),
    ("Travancore", [r"\b(travancore|tiruvitamcode)\b"]),
    ("Northeast India", [
        r"\b(meghalaya|nagaland|manipur|arunachal|mizoram|sikkim|tripura|assam)\b",
    ]),
]

# International origins. Region-level names recognized so a Yirgacheffe
# bean rolls up to Ethiopia, etc.
_INTERNATIONAL_REGION_MAP: list[tuple[str, list[str]]] = [
    ("Ethiopia", [
        r"\b(ethiopia|ethiopian|yirgacheffe|sidamo|guji|harrar?|kaffa|limu|jimma)\b",
    ]),
    ("Colombia", [
        r"\b(colombia|colombian|huila|nari[ñn]o|antioquia|tolima|caldas|cauca)\b",
    ]),
    ("Kenya", [r"\b(kenya|kenyan|nyeri|kirinyaga|kiambu|muranga|embu)\b"]),
    ("Rwanda", [r"\b(rwanda|rwandan)\b"]),
    ("Burundi", [r"\bburundi\b"]),
    ("Brazil", [
        r"\b(brazil|brazilian|cerrado|minas\s*gerais|sul\s*de\s*minas|mogiana|bahia)\b",
    ]),
    ("Guatemala", [
        r"\b(guatemala|guatemalan|antigua|huehuetenango|atitlan|cob[áa]n)\b",
    ]),
    ("Honduras", [r"\b(honduras|honduran)\b"]),
    ("Costa Rica", [r"\b(costa\s*rica|costarrican|tarrazu|tarraz[úu]|naranjo)\b"]),
    ("Panama", [r"\b(panama|panamanian|boquete|volc[áa]n)\b"]),
    ("El Salvador", [r"\b(el\s*salvador|salvadoran|salvadorean)\b"]),
    ("Yemen", [r"\byemen\b"]),
    ("Indonesia", [
        r"\b(indonesia|sumatra|java|bali|sulawesi|mandheling|gayo|sumatran)\b",
    ]),
    ("Vietnam", [r"\bvietnam\b"]),
    ("Mexico", [r"\b(mexico|mexican|chiapas|oaxaca|veracruz)\b"]),
    ("Peru", [r"\b(peru|peruvian)\b"]),
    ("Tanzania", [r"\b(tanzania|tanzanian|kilimanjaro|mbeya|kagera)\b"]),
    ("Uganda", [r"\b(uganda|ugandan|bugisu)\b"]),
]

_REGION_MAP = _INDIAN_REGION_MAP + _INTERNATIONAL_REGION_MAP

# Compile once at import. The compiled list mirrors the order above.
_REGION_PATTERNS: list[tuple[str, list[re.Pattern]]] = [
    (name, [re.compile(p, re.IGNORECASE) for p in patterns])
    for name, patterns in _REGION_MAP
]


def canonical_region(*sources: Optional[str]) -> Optional[str]:
    """Return a canonical region name for a free-text origin string.
    Tries Indian regions first, then international. Returns None
    when nothing matches — the caller should treat None as
    "search-only, no filter chip" rather than fall back to "Other".

    Multiple `sources` may be supplied (e.g., origin + description_raw)
    so a region that's mentioned in the description but missing from
    the origin field still gets picked up.
    """
    haystack = " ".join(s for s in sources if s)
    if not haystack.strip():
        return None
    for name, compiled in _REGION_PATTERNS:
        for pat in compiled:
            if pat.search(haystack):
                return name
    return None


# ── Varietal canonicalization ──────────────────────────────────────────────
#
# Light-touch regex pass — case dedup, abbreviation collapse, species
# cull. Heavier curation lives in the planned Coffee Standardization
# sub-tab.

# Species labels that pollute the varietal column — they belong in
# bean_type. Strip them so the chip set shows actual cultivars.
_SPECIES_LABELS = {"arabica", "robusta", "excelsa", "liberica"}

# Haiku placeholder strings. Skip these so they don't surface as chips.
_PLACEHOLDER_TOKENS = {
    "<unknown>", "unknown", "n/a", "na", "none", "tbd", "tba", "-",
}

# SLN / Selection / SL / S — Indian Coffee Board cultivar series.
# All collapse to "SLN {n}". Captures one or more digits with an
# optional trailing letter ("SLN 9A", "SL 28", "SLN795").
_SLN_RE = re.compile(
    r"^(?:sln|selection|sl|s)\s*(\d+[a-z]?)$",
    re.IGNORECASE,
)


def canonical_varietal(value: Optional[str]) -> Optional[str]:
    """Clean up a free-text `varietal` value into a single chip-friendly
    label. Steps (in order):

      1. Strip + lowercase + collapse internal whitespace.
      2. Split on `,` `+` `&` `/` `and` to handle multi-cultivar entries.
      3. For each token: skip species labels ("arabica" / "robusta") and
         placeholder strings ("<unknown>"). Collapse SLN / Selection /
         SL / S abbreviations to canonical "SLN {n}". Otherwise
         title-case the cleaned token.
      4. First non-species, non-placeholder cultivar wins. Returns None
         when nothing usable survives.

    Multi-cultivar entries currently lose the second cultivar. The
    Coffee Standardization sub-tab will model them as a many-to-many
    relationship; this regex pass takes the first cultivar as the
    primary chip.
    """
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None

    # Split on common separators. \s+and\s+ catches "SLN 9 and Kent".
    tokens = re.split(r"[,/&+]|\s+and\s+", cleaned, flags=re.IGNORECASE)

    for raw in tokens:
        tok = re.sub(r"\s+", " ", raw.strip().lower())
        if not tok:
            continue
        if tok in _SPECIES_LABELS:
            continue
        if tok in _PLACEHOLDER_TOKENS:
            continue
        # Strip surrounding angle brackets / quotes from Haiku output
        # before regex match (`"<chandragiri>"` shouldn't get title-
        # cased into `"<Chandragiri>"`).
        stripped = tok.strip("<>\"'")
        if not stripped or stripped in _SPECIES_LABELS or stripped in _PLACEHOLDER_TOKENS:
            continue
        m = _SLN_RE.match(stripped)
        if m:
            return f"SLN {m.group(1).upper()}"
        # Title-case the cleaned token. Word-by-word so "sln 9" doesn't
        # accidentally pass through if the regex misses (it shouldn't,
        # but defensive).
        return " ".join(w.capitalize() for w in stripped.split())

    return None


# ── Altitude band classification ───────────────────────────────────────────
#
# Specialty-coffee altitude shorthand:
#   < 1200 m   — low-grown, often Robusta / commodity tier
#   1200–1500  — high-grown specialty (most Indian estates land here)
#   ≥ 1500 m   — strictly high-grown; commands premium pricing
#
# Three bands chosen to match how specialty drinkers think about
# altitude. Frontend filter chips bind to these keys.

ALTITUDE_BANDS = (
    ("lt1200", "Up to 1200m"),
    ("1200_1500", "1200–1500m"),
    ("gte1500", "1500m+"),
)


def altitude_band(altitude: Optional[int]) -> Optional[str]:
    """Bucket an altitude (in masl) into one of the three named bands.
    Returns None for missing altitude — caller hides the row when any
    altitude filter is active rather than coercing into a band."""
    if altitude is None:
        return None
    if altitude < 1200:
        return "lt1200"
    if altitude < 1500:
        return "1200_1500"
    return "gte1500"


# ── Price-per-100g band classification ─────────────────────────────────────
#
# Specialty pricing shorthand (Indian market, INR per 100 g):
#   <  ₹200 / 100 g — value tier
#   ₹200–399       — standard specialty
#   ₹400+          — premium / single-estate / micro-lot
#
# Keyed by ppg-per-100g rather than absolute price because a 100 g bag
# at ₹500 is ~5×/g while a 250 g bag at ₹500 is ~2×/g — comparing
# absolute price across pack sizes is meaningless.

PRICE_BANDS = (
    ("under_200", "Under ₹200/100g"),
    ("200_400", "₹200-400/100g"),
    ("over_400", "₹400+/100g"),
)


def price_band(price_inr: Optional[float], weight_grams: Optional[int]) -> Optional[str]:
    """Bucket a (price, weight) pair into one of the three named bands
    by ₹/100g. Returns None if either price or weight is missing."""
    if not price_inr or not weight_grams or weight_grams <= 0:
        return None
    ppg_per_100g = (price_inr / weight_grams) * 100.0
    if ppg_per_100g < 200:
        return "under_200"
    if ppg_per_100g < 400:
        return "200_400"
    return "over_400"
