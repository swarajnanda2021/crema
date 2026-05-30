"""Three-tier quality reviewer for enrichment output.

The Pydantic validators on CanonicalProduct / CanonicalArticle catch
STRUCTURAL junk (negative prices, absurd values, etc.) but can't catch
SEMANTIC junk — Haiku writing structurally-valid output that's still
wrong:

  • varietal='Bourbon' when "Bourbon" is the barrel-aging spirit, not
    the coffee cultivar (Zenforest Bourbon Bliss 2026-05-26)
  • coffee_name='Vithai' when Vithai is the brand, not a coffee
  • origin='Karnataka' invented when the page never mentions a location
  • All-generic enrichment ("Medium roast / balanced / smooth") where
    Haiku punted because the source was thin

This module implements the trust-but-verify pattern:

  T1 — deterministic heuristics (zero LLM cost). Fast, broad-coverage,
       runs on every enrichment outcome. Flags rows for review.

  T2 — Haiku adversarial reviewer (cheap). For T1-flagged rows, a
       second Haiku call with a skeptical reviewer prompt confirms
       or clears the flag.

  T3 — Opus override (sparse, MCP-fired). For T2-confirmed flags on
       high-impact fields, the orchestrator (Claude main, Opus tier)
       reads the full context and emits a corrected payload plus a
       lesson for prompt hardening.

T1 + T2 run inline post-enrichment. T3 fires only when the orchestrator
explicitly invokes it via MCP — keeps Opus spend bounded and deliberate.

The lesson-emission loop is the goal: every T3 override teaches us
either (a) a new T1 heuristic or (b) a prompt-hardening edit. After
3-5 sweep cycles, T3 should be rare.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional
import re


# Generic vocabulary that signals Haiku punted on a thin source.
# When all enrichment fields land at these values, the row is
# probably hallucinated rather than extracted.
_GENERIC_ORIGINS = frozenset({
    "india", "multi-estate", "single estate", "single-estate",
    "karnataka", "south india", "south-india", "multiple estates",
    "various", "blend",
})

# Spirit names that get mis-read as coffee cultivars when they
# appear in barrel-aging context. Bourbon IS a real cultivar — the
# rule below distinguishes spirit-context from agronomic-context.
_SPIRIT_NAMES = frozenset({
    "bourbon", "whiskey", "whisky", "rum", "agave", "wine",
    "tequila", "brandy", "scotch", "mezcal", "cognac", "sherry",
    "port", "vermouth", "gin", "vodka",
})

# Light-roast tasting-note vocabulary. Should NOT appear when
# roast_level=Dark.
_LIGHT_ROAST_VOCAB = frozenset({
    "floral", "jasmine", "citric", "citrus", "bright", "tea-like",
    "green tea", "white wine", "hibiscus", "lemongrass", "elderflower",
    "bergamot", "stone fruit", "white peach", "lychee",
})

# Heavy-roast tasting-note vocabulary. Should NOT appear when
# roast_level=Light.
_HEAVY_ROAST_VOCAB = frozenset({
    "smoky", "bittersweet", "intense", "dark chocolate", "burnt",
    "charcoal", "leather", "tobacco", "molasses", "char", "ash",
    "espresso roast", "italian roast",
})

# Generic tasting-note vocabulary that flags a punt when it's all
# the row has.
_GENERIC_NOTES_VOCAB = frozenset({
    "smooth", "balanced", "rich", "aromatic", "full-bodied",
    "full bodied", "well-balanced", "well balanced", "pleasant",
    "satisfying", "delightful", "delicious",
})

# Generic article tags. When tags is JUST these, the article
# wasn't actually classified.
_GENERIC_ARTICLE_TAGS = frozenset({
    "coffee", "blog", "news", "post", "article", "blog post",
})


@dataclass
class QualityFlag:
    """One quality concern raised against an entity field (or
    cross-field). Persisted to the `quality_reviews` table by the
    caller. Pure data — no I/O."""

    tier: int               # 1, 2, or 3
    rule: str               # canonical rule name e.g. "spirit_as_varietal"
    field: Optional[str]    # field that triggered, or None for cross-field
    evidence: Optional[str] = None
    flagged_value: Optional[str] = None


@dataclass
class ReviewBundle:
    """Result of running T1 over one entity. Empty `flags` means the
    row is clean and no T2 review is needed."""

    target_table: str  # 'products' or 'roaster_articles'
    target_id: str
    flags: list[QualityFlag] = field(default_factory=list)


# ── Internal helpers ───────────────────────────────────────────────────────


def _norm(s: Optional[str]) -> str:
    return (s or "").lower().strip()


def _contains_any(haystack: str, needles: frozenset[str]) -> list[str]:
    """Word-boundary-aware substring check. 'char' should NOT match
    'character'; 'burnt' should NOT match 'sunburnt' (well, that's
    not a coffee word, but consistency). For multi-word needles
    like 'dark chocolate', match the literal phrase.
    """
    hits = []
    for n in needles:
        if " " in n:
            # Multi-word — exact substring is fine (phrase boundary)
            if n in haystack:
                hits.append(n)
        else:
            # Single word — require word boundaries
            if re.search(rf"\b{re.escape(n)}\b", haystack):
                hits.append(n)
    return hits


def _value_appears_in(value: str, *texts: Optional[str]) -> bool:
    """Case-insensitive substring check across multiple sources.

    Returns True if the value (or its meaningful tokens) appears in any
    of the source texts. Handles multi-token values by requiring at
    least one ≥3-char token match — "Catuai + Bourbon" should match
    a page that says "Catuai" without needing the exact concatenation.
    """
    if not value:
        return True  # empty value can't be hallucinated
    v = _norm(value)
    sources = " ".join(_norm(t) for t in texts if t)
    if not sources:
        return False  # no source to verify against — caller decides
    if v in sources:
        return True
    # Token-level fallback for multi-word values
    tokens = [t for t in re.split(r"[\s,;+/&]+", v) if len(t) >= 3]
    if not tokens:
        return False
    return any(t in sources for t in tokens)


def _is_generic_origin(origin: Optional[str]) -> bool:
    return _norm(origin) in _GENERIC_ORIGINS


def _is_generic_tasting(notes: Optional[str]) -> bool:
    """True if tasting_notes contains ONLY generic vocab and no
    specific descriptors. A note like "Smooth and balanced" is
    generic; "Smooth and balanced with notes of dark chocolate and
    citrus" is not (has specifics)."""
    n = _norm(notes)
    if not n:
        return True
    # If any specific roast-vocab word appears, it's not generic.
    if _contains_any(n, _LIGHT_ROAST_VOCAB | _HEAVY_ROAST_VOCAB):
        return False
    # Count generic vs total signal words
    words = set(re.findall(r"[a-z]+", n))
    if not words:
        return True
    generic_hits = words & {w.split()[0] for w in _GENERIC_NOTES_VOCAB}
    # If >half of distinct words are generic, treat as cliche
    return len(generic_hits) >= max(2, len(words) // 2)


# ── T1 product heuristics ──────────────────────────────────────────────────


def _t1_spirit_as_varietal(
    entity: dict, page_text: str
) -> Optional[QualityFlag]:
    """varietal matches a spirit name AND barrel-aging context is
    present in the coffee_name or process_raw → likely misfire."""
    varietal = _norm(entity.get("varietal"))
    if varietal not in _SPIRIT_NAMES:
        return None
    coffee_name = _norm(entity.get("coffee_name"))
    process_raw = _norm(entity.get("process_raw"))
    name_or_process = coffee_name + " " + process_raw
    if "barrel" not in name_or_process and "aged" not in name_or_process:
        # Spirit name is present but no barrel-aging context — could
        # be a real cultivar named after a spirit (Bourbon IS a real
        # cultivar). Skip the flag; pure name-match is too weak.
        return None
    return QualityFlag(
        tier=1,
        rule="spirit_as_varietal",
        field="varietal",
        evidence=(
            f"varietal='{entity.get('varietal')}' AND "
            f"coffee_name/process mentions barrel-aging "
            f"('{coffee_name}' | '{process_raw}'). "
            "Spirit names in barrel-aging context refer to the barrel "
            "contents, not the coffee cultivar."
        ),
        flagged_value=entity.get("varietal"),
    )


def _t1_brand_as_coffee_name(
    entity: dict, roaster_name: Optional[str]
) -> Optional[QualityFlag]:
    """coffee_name equals (or is dominated by) roaster_name → Haiku
    fell back to the brand instead of extracting the SKU name."""
    if not roaster_name:
        return None
    coffee = _norm(entity.get("coffee_name"))
    brand = _norm(roaster_name)
    if not coffee or not brand:
        return None
    if coffee == brand:
        return QualityFlag(
            tier=1, rule="brand_as_coffee_name", field="coffee_name",
            evidence=(
                f"coffee_name='{entity.get('coffee_name')}' == "
                f"roaster_name='{roaster_name}'"
            ),
            flagged_value=entity.get("coffee_name"),
        )
    # Heavy overlap: brand makes up >60% of coffee_name
    if brand in coffee and len(brand) >= 4 and len(brand) / len(coffee) > 0.6:
        return QualityFlag(
            tier=1, rule="brand_as_coffee_name", field="coffee_name",
            evidence=(
                f"coffee_name='{entity.get('coffee_name')}' is mostly "
                f"the brand name '{roaster_name}'"
            ),
            flagged_value=entity.get("coffee_name"),
        )
    return None


def _t1_value_not_in_text(
    field_name: str, entity: dict, page_text: str,
) -> Optional[QualityFlag]:
    """Generic 'value should appear in page_text or description_raw'
    check. Used for origin, varietal, process_raw, producer.

    Generic origins ('India', 'Multi-estate') are exempt — they're
    catalog conventions, not page-text claims.

    Refined 2026-05-27 (retroactive-sweep false-positive fix): when
    BOTH page_text and description_raw are empty (typical for v1-path
    rows that never had description_raw populated, or for sweeps
    running against rows enriched before the page-text caching),
    we have no source text to verify against. Skip the check rather
    than firing a noise flag — the retroactive sweep was generating
    ~1,000 of these per run, drowning the real T1 signal.
    """
    value = entity.get(field_name)
    if not value:
        return None
    if field_name == "origin" and _is_generic_origin(value):
        return None
    description = entity.get("description_raw")
    # No source text at all → can't verify, skip rather than flag
    if not (page_text or "").strip() and not (description or "").strip():
        return None
    if _value_appears_in(str(value), page_text, description):
        return None
    return QualityFlag(
        tier=1, rule=f"{field_name}_not_in_text", field=field_name,
        evidence=(
            f"{field_name}='{value}' does not appear in page_text "
            f"({len(page_text or '')} chars) or description_raw "
            f"({len(description or '') if description else 0} chars). "
            "Likely hallucinated."
        ),
        flagged_value=str(value),
    )


def _t1_generic_bingo(entity: dict) -> Optional[QualityFlag]:
    """Cross-field cliche detector. When EVERY enrichment field is
    either null or a generic default value, the row is probably a
    Haiku punt against a thin source — not a real extraction.

    Required-empty fields: origin (or generic), varietal, producer,
    altitude_masl, tasting_notes (or generic), roaster_blurb (or
    short/generic).
    """
    origin = entity.get("origin")
    varietal = entity.get("varietal")
    producer = entity.get("producer")
    altitude = entity.get("altitude_masl")
    tasting = entity.get("tasting_notes")
    blurb = entity.get("roaster_blurb")

    origin_is_punt = (not origin) or _is_generic_origin(origin)
    varietal_is_punt = not varietal
    producer_is_punt = not producer
    altitude_is_punt = altitude is None
    tasting_is_punt = _is_generic_tasting(tasting)
    blurb_is_punt = (not blurb) or len(_norm(blurb)) < 40

    punts = [
        ("origin", origin_is_punt),
        ("varietal", varietal_is_punt),
        ("producer", producer_is_punt),
        ("altitude_masl", altitude_is_punt),
        ("tasting_notes", tasting_is_punt),
        ("roaster_blurb", blurb_is_punt),
    ]
    punted_fields = [name for name, p in punts if p]
    if len(punted_fields) < 5:
        return None  # row has some real specifics
    return QualityFlag(
        tier=1, rule="generic_bingo", field=None,
        evidence=(
            f"All-or-mostly-generic enrichment: {len(punted_fields)}/6 "
            f"fields are null or generic ({', '.join(punted_fields)}). "
            "Source page likely too thin for extraction — Haiku punted."
        ),
        flagged_value=None,
    )


def _t1_roast_notes_vocab_mismatch(
    entity: dict,
) -> Optional[QualityFlag]:
    """roast_level=Light with heavy-roast vocab in tasting_notes,
    or roast_level=Dark with light-roast vocab. Strong indicator
    the wrong row's notes were applied OR the roast was misread."""
    roast = _norm(entity.get("roast_level"))
    notes = _norm(entity.get("tasting_notes")) + " " + _norm(entity.get("roaster_blurb"))
    if not roast or not notes:
        return None
    if roast in ("light", "medium-light"):
        hits = _contains_any(notes, _HEAVY_ROAST_VOCAB)
        if hits:
            return QualityFlag(
                tier=1, rule="roast_notes_vocab_mismatch",
                field="tasting_notes",
                evidence=(
                    f"roast_level='{entity.get('roast_level')}' but "
                    f"tasting_notes/blurb contains heavy-roast vocabulary: "
                    f"{hits[:3]}"
                ),
                flagged_value=str(hits[:3]),
            )
    elif roast in ("dark", "medium-dark"):
        hits = _contains_any(notes, _LIGHT_ROAST_VOCAB)
        if hits:
            return QualityFlag(
                tier=1, rule="roast_notes_vocab_mismatch",
                field="tasting_notes",
                evidence=(
                    f"roast_level='{entity.get('roast_level')}' but "
                    f"tasting_notes/blurb contains light-roast vocabulary: "
                    f"{hits[:3]}"
                ),
                flagged_value=str(hits[:3]),
            )
    return None


def _t1_altitude_implausible(
    entity: dict,
) -> Optional[QualityFlag]:
    """Altitude below 200m or above 3000m is implausible for any
    specialty coffee origin (Indian: ~700-1800; global ceiling
    ~2200m). Out-of-band values are typically misread units
    (feet read as meters, plot size read as altitude, etc.)."""
    alt = entity.get("altitude_masl")
    if alt is None:
        return None
    try:
        a = int(alt)
    except (TypeError, ValueError):
        return None
    if 200 <= a <= 3000:
        return None
    return QualityFlag(
        tier=1, rule="altitude_implausible", field="altitude_masl",
        evidence=(
            f"altitude_masl={a} is outside the plausible specialty range "
            "(200-3000m). Likely a unit-misread (feet read as meters) or "
            "a non-altitude number captured by mistake."
        ),
        flagged_value=str(a),
    )


# ── T1 article heuristics ──────────────────────────────────────────────────


def _t1_article_title_is_url_slug(entity: dict) -> Optional[QualityFlag]:
    """title looks like a URL slug (lowercase + many hyphens) →
    Haiku didn't extract a real title, used the URL handle."""
    title = entity.get("title") or ""
    if not title:
        return None
    if title == title.lower() and title.count("-") >= 3 and len(title) > 25:
        return QualityFlag(
            tier=1, rule="title_is_url_slug", field="title",
            evidence=(
                f"title='{title}' looks like a URL slug "
                f"(lowercase, {title.count('-')} hyphens, "
                f"{len(title)} chars). Likely the URL handle, not "
                "the article's actual title."
            ),
            flagged_value=title,
        )
    return None


def _t1_article_excerpt_equals_body_prefix(
    entity: dict,
) -> Optional[QualityFlag]:
    """excerpt is exactly the first N chars of body_html (or its
    stripped text) → Haiku didn't summarize, just truncated."""
    excerpt = (entity.get("excerpt") or "").strip()
    body = (entity.get("body_html") or "").strip()
    if not excerpt or not body or len(excerpt) < 50:
        return None
    # Strip HTML tags from body for comparison
    body_text = re.sub(r"<[^>]+>", "", body)
    body_text = re.sub(r"\s+", " ", body_text).strip()
    excerpt_norm = re.sub(r"\s+", " ", excerpt).strip()
    if body_text.startswith(excerpt_norm[: min(150, len(excerpt_norm))]):
        return QualityFlag(
            tier=1, rule="excerpt_equals_body_prefix", field="excerpt",
            evidence=(
                f"excerpt is the first {len(excerpt)} chars of body — "
                "not a summary. Haiku truncated instead of summarizing."
            ),
            flagged_value=excerpt[:80],
        )
    return None


def _t1_article_tags_generic_only(entity: dict) -> Optional[QualityFlag]:
    """tags is empty or contains only generic words → article wasn't
    actually classified."""
    tags = entity.get("tags") or []
    if isinstance(tags, str):
        import json
        try:
            tags = json.loads(tags)
        except (ValueError, TypeError):
            tags = []
    if not tags:
        return None
    tag_set = {_norm(t) for t in tags if t}
    if tag_set and tag_set.issubset(_GENERIC_ARTICLE_TAGS):
        return QualityFlag(
            tier=1, rule="tags_generic_only", field="tags",
            evidence=(
                f"tags={list(tag_set)} are all generic "
                "(coffee/blog/news/post). Article wasn't really classified."
            ),
            flagged_value=",".join(sorted(tag_set)),
        )
    return None


# ── Public T1 entry points ─────────────────────────────────────────────────


def run_t1_product(
    *,
    entity: dict,
    page_text: str,
    roaster_name: Optional[str],
    product_id: str,
) -> ReviewBundle:
    """Run all T1 product heuristics against an enriched product row.
    Returns a ReviewBundle; empty flags = clean."""
    flags: list[QualityFlag] = []
    page_text = page_text or ""

    if f := _t1_spirit_as_varietal(entity, page_text):
        flags.append(f)
    if f := _t1_brand_as_coffee_name(entity, roaster_name):
        flags.append(f)
    if f := _t1_value_not_in_text("origin", entity, page_text):
        flags.append(f)
    if f := _t1_value_not_in_text("varietal", entity, page_text):
        flags.append(f)
    if f := _t1_value_not_in_text("process_raw", entity, page_text):
        flags.append(f)
    if f := _t1_value_not_in_text("producer", entity, page_text):
        flags.append(f)
    if f := _t1_generic_bingo(entity):
        flags.append(f)
    if f := _t1_roast_notes_vocab_mismatch(entity):
        flags.append(f)
    if f := _t1_altitude_implausible(entity):
        flags.append(f)

    return ReviewBundle(
        target_table="products", target_id=product_id, flags=flags,
    )


# ── T1 bio constants live below in the existing implementation ────────────
# (Removed a duplicate block 2026-05-27 — a prior session had already
#  built run_t1_bio + helpers below at line ~823+ with a more
#  thought-out design: bio flags are deterministic facts about the
#  homepage + catalog, so they go straight to verdict='confirmed'
#  via persist_flags(default_verdict='confirmed'), bypassing T2
#  Haiku adversarial review which adds no value for provable claims.
#  Keeping the canonical version below.)


_GENERIC_SPECIALTIES_DUP_MARKER = None  # placeholder so subsequent imports stay stable


def run_t1_article(
    *,
    entity: dict,
    page_text: str,
    article_id: str,
) -> ReviewBundle:
    """Run all T1 article heuristics against an enriched article row."""
    flags: list[QualityFlag] = []
    page_text = page_text or ""

    if f := _t1_article_title_is_url_slug(entity):
        flags.append(f)
    if f := _t1_article_excerpt_equals_body_prefix(entity):
        flags.append(f)
    if f := _t1_article_tags_generic_only(entity):
        flags.append(f)

    return ReviewBundle(
        target_table="roaster_articles", target_id=article_id, flags=flags,
    )


# ── T1 bio heuristics (target_table='roaster_profiles') ───────────────────


def _normalize_url_for_match(url: Optional[str]) -> str:
    """Canonicalize a URL for cross-source matching. Mirrors the
    dedup module's normalizer but inlined here to keep
    quality_reviewer self-contained. Strips: scheme, www, trailing
    slashes, /collections/all/ shopify-shim.
    """
    if not url:
        return ""
    u = url.lower().strip()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = u.replace("/collections/all/", "/")
    return u.rstrip("/")


def _path_pattern(url: Optional[str]) -> Optional[str]:
    """Extract the URL path's first segment as a pattern key.
    'https://x.com/products/y' → '/products/', etc. Used to detect
    platform-pattern drift between bio's discovered URLs and the
    catalog's URLs."""
    if not url:
        return None
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        path = (p.path or "/").lower()
        # First segment after the root
        parts = [s for s in path.split("/") if s]
        if not parts:
            return None
        return f"/{parts[0]}/"
    except Exception:
        return None


_BIO_GENERIC_SPECIALTIES = frozenset({
    "coffee", "specialty coffee", "specialty", "arabica", "robusta",
    "single origin", "single-origin", "fresh", "fresh roasted",
    "freshly roasted", "premium", "roasted coffee", "coffee beans",
    "indian coffee", "roasted", "espresso", "filter coffee",
})


def _t1_bio_specialties_generic_only(
    profile: dict,
) -> Optional[QualityFlag]:
    """Bio's specialties list contains ONLY generic catch-all words
    with no cultivar / region / process / brewing specificity. Signal
    that Haiku punted on the bio extraction."""
    raw = profile.get("specialties")
    if not raw:
        return None
    try:
        if isinstance(raw, str):
            import json as _json
            items = _json.loads(raw)
        else:
            items = raw
    except (ValueError, TypeError):
        return None
    if not items or not isinstance(items, list):
        return None
    norm = {str(s).lower().strip() for s in items if s}
    if not norm:
        return None
    # All items must be in the generic set
    if norm.issubset(_BIO_GENERIC_SPECIALTIES):
        return QualityFlag(
            tier=1, rule="bio_specialties_generic_only", field="specialties",
            evidence=(
                f"specialties={sorted(norm)} are all generic catch-all "
                "vocabulary. The bio extraction punted — no cultivar, "
                "region, process, or brewing specifics. Source page "
                "may be thin OR Haiku didn't extract real specialties."
            ),
            flagged_value=",".join(sorted(norm)),
        )
    return None


def _t1_bio_about_blurb_too_short(
    profile: dict,
) -> Optional[QualityFlag]:
    """about_blurb < 80 chars suggests Haiku found nothing to extract
    on the homepage / about-page. Real specialty roaster bios are
    typically 200-1000 chars."""
    blurb = (profile.get("about_blurb") or "").strip()
    if not blurb:
        return QualityFlag(
            tier=1, rule="bio_about_blurb_missing", field="about_blurb",
            evidence="about_blurb is empty or null. Bio enrich failed "
                     "to extract any prose from homepage / about-page.",
            flagged_value=None,
        )
    if len(blurb) < 80:
        return QualityFlag(
            tier=1, rule="bio_about_blurb_too_short", field="about_blurb",
            evidence=(
                f"about_blurb is {len(blurb)} chars; specialty roaster "
                "bios are typically 200-1000 chars. Likely a Haiku punt "
                "or a thin about page."
            ),
            flagged_value=blurb,
        )
    return None


def _t1_bio_no_urls_discovered(
    profile: dict, source: dict,
) -> Optional[QualityFlag]:
    """Bio discovery captured zero product URLs from the homepage.
    Either the homepage doesn't link to products (unusual for a
    storefront), the platform's chrome confused the parser, or the
    bio enrich ran before the discovery code was wired in. Worth
    a manual check.

    Only fires when the website is set AND platform is set (so we
    KNOW it's a real storefront, not a placeholder profile)."""
    if not profile.get("website"):
        return None
    if not source.get("platform"):
        return None
    product_urls = source.get("discovered_product_urls") or []
    if isinstance(product_urls, str):
        try:
            import json as _json
            product_urls = _json.loads(product_urls)
        except (ValueError, TypeError):
            product_urls = []
    if product_urls:
        return None  # all good
    return QualityFlag(
        tier=1, rule="bio_no_urls_discovered", field=None,
        evidence=(
            f"Bio enrich captured 0 product URLs from the homepage "
            f"at {profile['website']!r} (platform={source.get('platform')!r}). "
            "Homepage may not link to products, or the parser missed "
            "the platform's link pattern. Worth manual review."
        ),
        flagged_value=None,
    )


def _t1_bio_urls_vs_catalog_mismatch(
    profile: dict, source: dict, catalog_urls: list[str],
) -> Optional[QualityFlag]:
    """Bio captured a sample of product URLs from the homepage. If
    most of them DON'T have a normalized match in the catalog, the
    catalog is drifting from reality — URLs have changed (Nandan
    prefix-add class), the storefront replatformed, or the catalog
    has not been refreshed in a long time.

    Threshold: requires ≥ 3 bio URLs (avoid noisy small samples) AND
    < 50% match rate against the catalog.
    """
    bio_urls = source.get("discovered_product_urls") or []
    if isinstance(bio_urls, str):
        try:
            import json as _json
            bio_urls = _json.loads(bio_urls)
        except (ValueError, TypeError):
            bio_urls = []
    if len(bio_urls) < 3:
        return None
    catalog_normalized = {_normalize_url_for_match(u) for u in catalog_urls if u}
    bio_normalized = [_normalize_url_for_match(u) for u in bio_urls if u]
    if not bio_normalized:
        return None
    matched = sum(1 for b in bio_normalized if b in catalog_normalized)
    match_rate = matched / len(bio_normalized)
    if match_rate >= 0.5:
        return None
    return QualityFlag(
        tier=1, rule="bio_urls_vs_catalog_mismatch", field=None,
        evidence=(
            f"Bio captured {len(bio_normalized)} product URLs from the "
            f"homepage; only {matched} ({int(match_rate*100)}%) have a "
            "normalized match in the catalog. The catalog has likely "
            "drifted (URLs renamed, host moved, products re-slugged). "
            f"Sample of bio URLs: {bio_urls[:3]}. "
            f"Sample of catalog URLs: {list(catalog_urls)[:3]}"
        ),
        flagged_value=f"match_rate={int(match_rate*100)}%",
    )


def _t1_bio_platform_url_pattern_drift(
    source: dict, catalog_urls: list[str],
) -> Optional[QualityFlag]:
    """Bio's discovered product URLs use one URL pattern (e.g.
    /products/<slug>, Shopify) but the catalog has many rows with a
    different pattern (e.g. /product/<slug>, WooCommerce). Strong
    signal of an undetected replatform that diff-layer heuristics
    missed."""
    bio_urls = source.get("discovered_product_urls") or []
    if isinstance(bio_urls, str):
        try:
            import json as _json
            bio_urls = _json.loads(bio_urls)
        except (ValueError, TypeError):
            bio_urls = []
    if len(bio_urls) < 3 or not catalog_urls:
        return None

    def _patterns(urls):
        from collections import Counter
        return Counter(_path_pattern(u) for u in urls if _path_pattern(u))

    bio_patterns = _patterns(bio_urls)
    cat_patterns = _patterns(catalog_urls)
    if not bio_patterns or not cat_patterns:
        return None
    bio_dom = bio_patterns.most_common(1)[0][0]
    cat_dom = cat_patterns.most_common(1)[0][0]
    if bio_dom == cat_dom:
        return None
    # Compute fractions to make sure both are dominant (>60%) in their
    # respective sources — otherwise it's mixed and noisy.
    bio_frac = bio_patterns[bio_dom] / sum(bio_patterns.values())
    cat_frac = cat_patterns[cat_dom] / sum(cat_patterns.values())
    if bio_frac < 0.6 or cat_frac < 0.6:
        return None
    return QualityFlag(
        tier=1, rule="bio_platform_url_pattern_drift", field=None,
        evidence=(
            f"Bio's homepage URLs use pattern {bio_dom!r} "
            f"({int(bio_frac*100)}% dominant) but the catalog's rows "
            f"use {cat_dom!r} ({int(cat_frac*100)}% dominant). "
            "Suggests an undetected platform migration (e.g. WooCommerce "
            "→ Shopify) that produced different URL shapes."
        ),
        flagged_value=f"bio={bio_dom} catalog={cat_dom}",
    )


def run_t1_bio(
    *,
    roaster_slug: str,
    profile: dict,
    source: dict,
    catalog_product_urls: list[str],
) -> ReviewBundle:
    """Run all T1 bio heuristics. Returns a ReviewBundle with
    target_table='roaster_profiles' and target_id=roaster_slug.
    """
    flags: list[QualityFlag] = []
    if f := _t1_bio_specialties_generic_only(profile):
        flags.append(f)
    if f := _t1_bio_about_blurb_too_short(profile):
        flags.append(f)
    if f := _t1_bio_no_urls_discovered(profile, source):
        flags.append(f)
    if f := _t1_bio_urls_vs_catalog_mismatch(
        profile, source, catalog_product_urls
    ):
        flags.append(f)
    if f := _t1_bio_platform_url_pattern_drift(source, catalog_product_urls):
        flags.append(f)
    return ReviewBundle(
        target_table="roaster_profiles",
        target_id=roaster_slug,
        flags=flags,
    )


# ── Persistence helpers ────────────────────────────────────────────────────


def persist_flags(
    db,
    bundle: ReviewBundle,
    *,
    now_iso: str,
    default_verdict: str = "pending",
) -> list[int]:
    """Insert each flag in the bundle as a new quality_reviews row.

    Idempotent at the (target, rule, field) level — re-running T1
    on the same entity wipes the matching default_verdict flags and
    re-inserts. Resolved flags (a state OTHER than default_verdict)
    are preserved as history.

    `default_verdict`: 'pending' (default) for products / articles
    where T2 is the adversarial reviewer that resolves the flag.
    'confirmed' for bio rules — they're deterministic facts about
    the homepage / catalog (URL drift, missing specialties), no
    Haiku-reviewer adds value, so the flag is its own verdict.
    """
    if default_verdict not in ("pending", "confirmed"):
        raise ValueError(f"unsupported default_verdict: {default_verdict}")
    if not bundle.flags:
        # Clear any stale flags at the same verdict — the entity is
        # now clean under this rule set.
        db.execute(
            "DELETE FROM quality_reviews "
            "WHERE target_table = ? AND target_id = ? AND verdict = ?",
            (bundle.target_table, bundle.target_id, default_verdict),
        )
        db.commit()
        return []

    # Wipe flags at the same verdict for this target, then re-insert.
    # Cleared / confirmed-by-T2 / overridden flags stay as history.
    db.execute(
        "DELETE FROM quality_reviews "
        "WHERE target_table = ? AND target_id = ? AND verdict = ?",
        (bundle.target_table, bundle.target_id, default_verdict),
    )

    ids: list[int] = []
    for f in bundle.flags:
        # For bio (default_verdict='confirmed'), also stamp
        # resolved_at + resolved_by so the row reads cleanly in the
        # admin queue.
        resolved_at = now_iso if default_verdict == "confirmed" else None
        resolved_by = "t1_deterministic" if default_verdict == "confirmed" else None
        cur = db.execute(
            "INSERT INTO quality_reviews "
            "(target_table, target_id, tier, rule, field, evidence, "
            " flagged_value, verdict, created_at, "
            " resolved_at, resolved_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bundle.target_table, bundle.target_id, f.tier, f.rule,
                f.field, f.evidence, f.flagged_value, default_verdict,
                now_iso, resolved_at, resolved_by,
            ),
        )
        ids.append(cur.lastrowid)
    db.commit()
    return ids


# ── T2 Haiku adversarial reviewer ──────────────────────────────────────────


_T2_REVIEW_TOOL = {
    "name": "verify_enrichment_fields",
    "description": (
        "Verify whether each flagged field in the enrichment is "
        "supported by the source page text, or whether it was "
        "hallucinated (invented without evidence)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "field_verdicts": {
                "type": "array",
                "description": (
                    "One verdict per flagged field. Order doesn't matter; "
                    "the rule_id key matches the input flag's rule."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "rule_id": {
                            "type": "string",
                            "description": (
                                "Matches the rule name from the input "
                                "flag (e.g. 'spirit_as_varietal')."
                            ),
                        },
                        "verdict": {
                            "type": "string",
                            "enum": ["hallucinated", "valid", "unsure"],
                            "description": (
                                "'hallucinated' = the flagged value is "
                                "not supported by the page text and "
                                "appears invented. 'valid' = the value "
                                "is supported by the page text (T1 was "
                                "a false positive). 'unsure' = the "
                                "page text is ambiguous; defer to "
                                "human review."
                            ),
                        },
                        "reasoning": {
                            "type": "string",
                            "description": (
                                "1-2 sentences explaining the verdict. "
                                "Cite specific page-text excerpts where "
                                "possible."
                            ),
                        },
                    },
                    "required": ["rule_id", "verdict", "reasoning"],
                },
            },
        },
        "required": ["field_verdicts"],
    },
}


_T2_REVIEW_SYSTEM = (
    "You are an ADVERSARIAL REVIEWER of coffee-product enrichment.\n\n"
    "An earlier extraction pass (Haiku enricher, running a different "
    "prompt and tool schema) produced structured fields from a "
    "product page. A deterministic heuristic layer (T1) flagged "
    "some fields as suspicious. Your job is to confirm each flag "
    "or clear it.\n\n"
    "For each flagged field, decide:\n"
    "  • 'hallucinated' — the flagged value is NOT supported by the "
    "page text. The earlier pass invented it (e.g. picked a generic "
    "default, copied from another row, or confused barrel-aging "
    "context with cultivar context).\n"
    "  • 'valid' — the flagged value IS supported by the page text. "
    "T1 was overly conservative; the value should stand.\n"
    "  • 'unsure' — the page text is genuinely ambiguous. Defer to "
    "human review.\n\n"
    "Be SKEPTICAL by default — if you can't find direct page-text "
    "support, lean toward 'hallucinated'. The cost of a false "
    "'valid' verdict is consumer-visible junk on the catalog; the "
    "cost of a false 'hallucinated' verdict is just one extra T3 "
    "Opus call. Bias toward caution.\n\n"
    "Cite specific page-text excerpts in your reasoning when "
    "possible. A 'valid' verdict with no cited excerpt is weaker "
    "than one with a quote."
)


def _build_t2_user_content(
    *,
    entity: dict,
    page_text: str,
    description_raw: Optional[str],
    flags: list[QualityFlag],
) -> str:
    parts = ["FLAGGED FIELDS TO REVIEW:"]
    for f in flags:
        parts.append(
            f"  rule_id: {f.rule}\n"
            f"  field: {f.field or '(cross-field)'}\n"
            f"  flagged_value: {f.flagged_value!r}\n"
            f"  T1 evidence: {f.evidence}\n"
        )
    parts.append("\nFULL ENRICHMENT (what the earlier pass produced):")
    for k in (
        "coffee_name", "origin", "varietal", "process_raw", "producer",
        "altitude_masl", "roast_level", "tasting_notes", "roaster_blurb",
        "title", "excerpt", "topic_category", "tags",
    ):
        v = entity.get(k)
        if v is not None and v != [] and v != "":
            parts.append(f"  {k}: {v!r}")
    if description_raw:
        parts.append(
            f"\nLISTING DESCRIPTION (verbatim from the storefront):\n"
            f"{description_raw[:1500]}"
        )
    parts.append(
        f"\nCLEANED PAGE TEXT (richest source):\n"
        f"{(page_text or '')[:6000]}"
    )
    return "\n".join(parts)


def run_t2_review(
    *,
    entity: dict,
    page_text: str,
    description_raw: Optional[str],
    flags: list[QualityFlag],
    roaster_slug: Optional[str] = None,
    target_id: Optional[str] = None,
) -> dict[str, str]:
    """Run the T2 Haiku adversarial reviewer. Returns a dict mapping
    rule_id → verdict ('hallucinated' | 'valid' | 'unsure'). Caller
    persists the verdicts to quality_reviews.verdict.

    Empty flags → empty dict. No LLM call wasted on clean rows.
    """
    if not flags:
        return {}
    from services.llm_router import call_llm  # lazy import

    user_content = _build_t2_user_content(
        entity=entity, page_text=page_text,
        description_raw=description_raw, flags=flags,
    )
    result = call_llm(
        step="quality_review_t2",
        system=_T2_REVIEW_SYSTEM,
        tool=_T2_REVIEW_TOOL,
        user_content=user_content,
        max_tokens=1500,
        model="claude-haiku-4-5-20251001",
        roaster_slug=roaster_slug,
        target_id=target_id,
    )
    if not result:
        return {}
    verdicts: dict[str, str] = {}
    for v in result.get("field_verdicts", []) or []:
        rid = v.get("rule_id")
        verdict = v.get("verdict")
        if rid and verdict in ("hallucinated", "valid", "unsure"):
            verdicts[rid] = verdict
    return verdicts


def persist_t2_verdicts(
    db,
    *,
    target_table: str,
    target_id: str,
    verdicts: dict[str, str],
    now_iso: str,
) -> dict[str, int]:
    """Update pending quality_reviews rows with T2 verdicts.

    Mapping:
      • 'hallucinated' → verdict='confirmed', tier=2 row inserted as
        the T2 paper trail. The original T1 row stays as 'confirmed'.
      • 'valid' → original T1 row's verdict='cleared'.
      • 'unsure' → original T1 row stays 'pending'; let admin / T3
        decide.

    Returns counts: {'confirmed': N, 'cleared': N, 'unsure': N}.
    """
    counts = {"confirmed": 0, "cleared": 0, "unsure": 0}
    rows = db.execute(
        "SELECT id, rule FROM quality_reviews "
        "WHERE target_table = ? AND target_id = ? "
        "  AND tier = 1 AND verdict = 'pending'",
        (target_table, target_id),
    ).fetchall()
    for r in rows:
        v = verdicts.get(r["rule"])
        if v == "hallucinated":
            db.execute(
                "UPDATE quality_reviews SET verdict = 'confirmed', "
                "  resolved_at = ?, resolved_by = 'haiku_review' "
                "WHERE id = ?",
                (now_iso, r["id"]),
            )
            counts["confirmed"] += 1
        elif v == "valid":
            db.execute(
                "UPDATE quality_reviews SET verdict = 'cleared', "
                "  resolved_at = ?, resolved_by = 'haiku_review' "
                "WHERE id = ?",
                (now_iso, r["id"]),
            )
            counts["cleared"] += 1
        else:
            counts["unsure"] += 1  # row stays 'pending'
    db.commit()
    return counts


# ── T3 Opus override ───────────────────────────────────────────────────────


_T3_OVERRIDE_TOOL = {
    "name": "override_enrichment_fields",
    "description": (
        "Emit corrected values for fields that the T1+T2 review "
        "pipeline confirmed as hallucinated. Also emit a 'lesson' "
        "explaining what the original enricher got wrong and what "
        "rule would have prevented it."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "corrections": {
                "type": "array",
                "description": (
                    "One correction per confirmed-hallucination field. "
                    "Set corrected_value to null to indicate the field "
                    "should be cleared (the original value was wrong "
                    "and no replacement is supportable from the page)."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {
                            "type": "string",
                            "description": (
                                "Field name being corrected — must "
                                "match a canonical entity field "
                                "(varietal, origin, process_raw, etc.)."
                            ),
                        },
                        "corrected_value": {
                            "type": ["string", "null"],
                            "description": (
                                "The corrected value, or null to "
                                "clear the field entirely."
                            ),
                        },
                        "reasoning": {
                            "type": "string",
                            "description": (
                                "1-2 sentences explaining the "
                                "correction with page-text citation."
                            ),
                        },
                    },
                    "required": ["field", "corrected_value", "reasoning"],
                },
            },
            "lesson": {
                "type": "string",
                "description": (
                    "1-3 sentences capturing what the original "
                    "enricher got wrong and what rule (T1 heuristic "
                    "or prompt-hardening edit) would have caught it. "
                    "This becomes training material for the next "
                    "sweep cycle."
                ),
            },
        },
        "required": ["corrections", "lesson"],
    },
}


_T3_OVERRIDE_SYSTEM = (
    "You are the FINAL ARBITER on a coffee-product enrichment.\n\n"
    "An earlier Haiku pass produced structured fields. A T1 "
    "heuristic layer flagged some of them. A T2 Haiku reviewer "
    "confirmed the flags. Your job: emit corrected values AND a "
    "lesson for prompt hardening.\n\n"
    "Rules:\n"
    "  • If the page text supports a DIFFERENT value than the "
    "original, emit that value as the correction.\n"
    "  • If the page text supports NO value for the field, set "
    "corrected_value=null. Clearing a field is preferable to "
    "leaving wrong data.\n"
    "  • The lesson should be actionable. Good: 'When a product "
    "name contains a spirit name (Bourbon/Whiskey/Rum) AND the "
    "process mentions barrel-aging, varietal should be null '\n"
    "    unless an explicit cultivar is named elsewhere on the "
    "page.' Bad: 'Be more careful with varietals.'"
)


def _build_t3_user_content(
    *,
    entity: dict,
    page_text: str,
    description_raw: Optional[str],
    confirmed_flags: list[dict],  # rows from quality_reviews
) -> str:
    parts = ["CONFIRMED HALLUCINATIONS (T1 → T2 review chain):"]
    for f in confirmed_flags:
        parts.append(
            f"  rule: {f['rule']}\n"
            f"  field: {f.get('field') or '(cross-field)'}\n"
            f"  current_value: {f.get('flagged_value')!r}\n"
            f"  T1 evidence: {f.get('evidence')}\n"
        )
    parts.append("\nFULL CURRENT ENRICHMENT:")
    for k in (
        "coffee_name", "origin", "varietal", "process_raw", "producer",
        "altitude_masl", "roast_level", "tasting_notes", "roaster_blurb",
    ):
        v = entity.get(k)
        if v is not None and v != "":
            parts.append(f"  {k}: {v!r}")
    if description_raw:
        parts.append(
            f"\nLISTING DESCRIPTION:\n{description_raw[:1500]}"
        )
    parts.append(
        f"\nCLEANED PAGE TEXT (full source):\n{(page_text or '')[:8000]}"
    )
    return "\n".join(parts)


def run_t3_override(
    *,
    entity: dict,
    page_text: str,
    description_raw: Optional[str],
    confirmed_flags: list[dict],
    roaster_slug: Optional[str] = None,
    target_id: Optional[str] = None,
    model: str = "claude-sonnet-4-5-20251001",
) -> dict[str, Any]:
    """Run the T3 final-arbiter pass on confirmed hallucinations.

    Uses Sonnet (or Opus, configurable via model arg) — the smarter,
    more expensive tier. Designed for sparse invocation: only fires
    on rows the T1+T2 chain has already confirmed need attention.

    Returns: {
        'corrections': [{'field': str, 'corrected_value': any, 'reasoning': str}],
        'lesson': str,
    }
    Empty dict if the call fails / returns no tool_use.
    """
    # DEPRECATED — T3 no longer runs an LLM call from the backend.
    # The orchestrator (Claude Code session) IS the T3 intelligence:
    # it fetches context bundles via crema_prepare_t3_review, reasons
    # over them, and submits corrections via crema_apply_t3_correction.
    #
    # Reasons (refined 2026-05-27 after the SDK attempt was rejected):
    #   • SDK calls burn Anthropic credits — the operator-routing rule
    #     reserves credits for human-fired calls only. Agent-fired
    #     calls (including T3) must run under the Claude Code
    #     subscription path.
    #   • Routing T3 through the call_llm queue means a Haiku drainer
    #     picks it up — but T3 is supposed to be the smarter tier.
    #     Defeats the purpose.
    #   • The orchestrator IS the smarter tier. When the orchestrator
    #     fires T3, the orchestrator reads the context and emits the
    #     correction directly. No credit burn, no Haiku-as-Sonnet
    #     impersonation, no queue.
    raise NotImplementedError(
        "run_t3_override is deprecated. Use prepare_t3_review_batch "
        "+ apply_t3_correction instead. The orchestrator (caller of "
        "the MCP tool) emits the correction; this module just builds "
        "the context bundle and persists the result."
    )


def prepare_t3_review_batch(
    db,
    *,
    target_table: str,
    target_id: Optional[str] = None,
    roaster_slug: Optional[str] = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Build the context bundles the orchestrator needs to make T3
    decisions. Returns one bundle per (target row, all confirmed
    flags). The orchestrator reads each bundle, decides corrections,
    and submits them via apply_t3_correction.

    Bundle shape: {
        target_table, target_id, entity_dict,
        roaster_name, description_raw,
        confirmed_flags: [{rule, field, evidence, flagged_value,
                           current_value_in_target}],
    }

    The orchestrator does NOT need page_text — for the retroactive
    T3 path, the description_raw on the row is usually enough
    context. If the orchestrator needs the full page text, it can
    fetch it via the page_fetcher entry points.
    """
    if target_table not in (
        "products", "roaster_articles", "roaster_profiles"
    ):
        raise ValueError(f"unsupported target_table: {target_table}")

    # Find target rows with at least one confirmed flag
    sql = (
        "SELECT target_id, COUNT(*) as flag_count "
        "FROM quality_reviews "
        "WHERE target_table = ? AND verdict = 'confirmed' "
    )
    params: list = [target_table]
    if target_id:
        sql += "AND target_id = ? "
        params.append(target_id)
    if roaster_slug:
        if target_table == "products":
            sql += (
                "AND EXISTS (SELECT 1 FROM products p "
                "  WHERE p.product_id = quality_reviews.target_id "
                "  AND p.roaster_slug = ?) "
            )
        elif target_table == "roaster_articles":
            sql += (
                "AND EXISTS (SELECT 1 FROM roaster_articles ra "
                "  WHERE ra.id = CAST(quality_reviews.target_id AS INTEGER) "
                "  AND ra.roaster_slug = ?) "
            )
        else:
            # roaster_profiles: target_id IS the roaster_slug
            sql += "AND quality_reviews.target_id = ? "
        params.append(roaster_slug)
    sql += "GROUP BY target_id ORDER BY flag_count DESC LIMIT ?"
    params.append(limit)
    candidates = db.execute(sql, tuple(params)).fetchall()

    bundles: list[dict[str, Any]] = []
    for c in candidates:
        tid = c["target_id"]
        if target_table == "products":
            target_row = db.execute(
                "SELECT * FROM products WHERE product_id = ?", (tid,),
            ).fetchone()
        elif target_table == "roaster_articles":
            try:
                target_row = db.execute(
                    "SELECT * FROM roaster_articles WHERE id = ?",
                    (int(tid),),
                ).fetchone()
            except (TypeError, ValueError):
                target_row = None
        else:
            # roaster_profiles: JOIN profile + source so orchestrator
            # sees the full bio context (about_blurb, specialties, ...
            # AND discovered_*_urls, platform, shop_url).
            target_row = db.execute(
                "SELECT rp.*, "
                "       rs.platform AS source_platform, "
                "       rs.shop_url AS source_shop_url, "
                "       rs.discovered_product_urls, "
                "       rs.discovered_article_urls, "
                "       rs.discovered_collection_urls, "
                "       rs.bio_discovery_at "
                "FROM roaster_profiles rp "
                "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
                "WHERE rp.roaster_slug = ?",
                (tid,),
            ).fetchone()
        if not target_row:
            continue
        entity = dict(target_row)

        # Resolve roaster_name for product context
        roaster_name = None
        if target_table == "products" and entity.get("roaster_slug"):
            rn = db.execute(
                "SELECT name FROM roaster_profiles WHERE roaster_slug = ?",
                (entity["roaster_slug"],),
            ).fetchone()
            roaster_name = (rn["name"] if rn else None) or entity["roaster_slug"]
        elif target_table == "roaster_profiles":
            roaster_name = entity.get("name") or tid

        flags = []
        for r in db.execute(
            "SELECT id, rule, field, evidence, flagged_value "
            "FROM quality_reviews "
            "WHERE target_table = ? AND target_id = ? "
            "  AND verdict = 'confirmed'",
            (target_table, tid),
        ).fetchall():
            flag_dict = dict(r)
            # Surface the current value in the target so the
            # orchestrator can compare flagged_value (from the time
            # T1 fired) against what's actually in the row now.
            field = flag_dict.get("field")
            flag_dict["current_value_in_target"] = (
                entity.get(field) if field else None
            )
            flags.append(flag_dict)

        bundles.append({
            "target_table": target_table,
            "target_id": tid,
            "entity": entity,
            "roaster_name": roaster_name,
            "description_raw": entity.get("description_raw"),
            "confirmed_flags": flags,
        })
    return bundles


def apply_t3_corrections(
    db,
    *,
    target_table: str,
    target_id: str,
    corrections: list[dict],
    lesson: str,
    now_iso: str,
) -> dict[str, int]:
    """Apply T3 corrections to the target row + update quality_reviews.

    For each correction:
      • UPDATE the target table column to the corrected_value
      • Find the matching quality_reviews row (verdict='confirmed',
        field matches) and flip to 'overridden' + record
        corrected_value + lesson

    Returns counts: {'applied': N, 'skipped': N}.
    """
    counts = {"applied": 0, "skipped": 0}
    if not corrections:
        return counts

    # Validate target table — also gates the SQL column name
    # construction below against injection.
    if target_table not in (
        "products", "roaster_articles", "roaster_profiles"
    ):
        raise ValueError(f"unsupported target_table: {target_table}")

    # For roaster_profiles, target_id is the roaster_slug, and the
    # field allowlist spans roaster_profiles (profile fields) AND
    # roaster_sources (scrape-config fields like platform/shop_url).
    # We route to the right table per-field.
    _PROFILE_FIELDS = {
        "about_blurb", "tagline", "specialties", "city", "state",
        "instagram_handle", "contact_email", "logo_url",
        "hero_image_url", "name",
    }
    _SOURCE_FIELDS = {
        "platform", "shop_url",
    }

    for c in corrections:
        field_name = c.get("field")
        new_value = c.get("corrected_value")
        if not field_name:
            counts["skipped"] += 1
            continue
        if target_table == "products":
            if field_name not in {
                "coffee_name", "origin", "varietal", "process_raw",
                "producer", "altitude_masl", "roast_level",
                "roast_level_name", "tasting_notes", "roaster_blurb",
                "bean_type", "origin_region",
            }:
                counts["skipped"] += 1
                continue
            db.execute(
                f"UPDATE products SET {field_name} = ? "
                f"WHERE product_id = ?",
                (new_value, target_id),
            )
        elif target_table == "roaster_articles":
            if field_name not in {
                "title", "excerpt", "topic_category", "tags",
            }:
                counts["skipped"] += 1
                continue
            db.execute(
                f"UPDATE roaster_articles SET {field_name} = ? "
                f"WHERE id = ?",
                (new_value, target_id),
            )
        elif target_table == "roaster_profiles":
            # target_id = roaster_slug. Route per-field.
            if field_name in _PROFILE_FIELDS:
                db.execute(
                    f"UPDATE roaster_profiles SET {field_name} = ? "
                    f"WHERE roaster_slug = ?",
                    (new_value, target_id),
                )
            elif field_name in _SOURCE_FIELDS:
                # Look up website via roaster_profiles, then UPDATE
                # roaster_sources by website.
                db.execute(
                    f"UPDATE roaster_sources SET {field_name} = ? "
                    f"WHERE website = (SELECT website FROM "
                    f"  roaster_profiles WHERE roaster_slug = ?)",
                    (new_value, target_id),
                )
            else:
                counts["skipped"] += 1
                continue

        db.execute(
            "UPDATE quality_reviews "
            "SET verdict = 'overridden', "
            "    corrected_value = ?, "
            "    lesson = ?, "
            "    resolved_at = ?, "
            "    resolved_by = 'opus_override' "
            "WHERE target_table = ? AND target_id = ? "
            "  AND field = ? AND verdict = 'confirmed'",
            (
                str(new_value) if new_value is not None else None,
                lesson, now_iso, target_table, target_id, field_name,
            ),
        )
        counts["applied"] += 1
    db.commit()
    return counts


# ── Retroactive sweep ──────────────────────────────────────────────────────


def run_retroactive_sweep(
    db,
    *,
    target_table: str = "products",
    slug: Optional[str] = None,
    since: Optional[str] = None,
    limit: Optional[int] = None,
    run_t2: bool = True,
    skip_already_reviewed: bool = True,
) -> dict[str, Any]:
    """Run T1 (and optionally T2) over already-enriched catalog rows.

    Why this exists: the inline T1+T2 wiring in
    enrichment_runner._run_quality_review only fires when the v2
    enrichment_runner path is used. The bulk-sweep path
    (crema_full_reenrich_roaster → catalog_ops.scrape_one_roaster →
    subprocess scrape) bypasses run_for_roaster, so the quality
    reviewer never gets called on those rows. The 2026-05-27 audit
    showed only ~1% T1 trigger coverage post-sweep for this reason.

    This sweep retroactively scans enriched rows + applies T1 +
    optionally T2. Uses the row's description_raw as the "page text"
    source (no live re-fetch — that would burn Playwright cycles).
    Text-dependent rules are more conservative against description_raw
    than against the full page text; T2 catches the resulting false
    positives.

    Args:
        target_table: 'products' or 'roaster_articles'.
        slug: scope to one roaster.
        since: ISO timestamp; only rows enriched_at >= since.
        limit: cap on rows scanned.
        run_t2: when True (default), run T2 review on T1-flagged
            rows. False to skip T2 entirely (T1 only, faster).
        skip_already_reviewed: when True (default), skip rows that
            already have a pending or resolved quality_reviews row.
            Set False to force a re-scan.

    Returns a summary dict with counts. Idempotent at the row level
    (persist_flags wipes existing pending flags before re-inserting).
    """
    if target_table not in (
        "products", "roaster_articles", "roaster_profiles"
    ):
        raise ValueError(f"unsupported target_table: {target_table}")

    # Build the row-selection SQL
    if target_table == "products":
        sql = (
            "SELECT * FROM products "
            "WHERE enrichment_status = 'enriched' "
        )
    elif target_table == "roaster_articles":
        sql = (
            "SELECT * FROM roaster_articles "
            "WHERE published = 1 "
        )
    else:
        # roaster_profiles + roaster_sources join — bio T1 needs both
        sql = (
            "SELECT rp.*, "
            "       rs.platform AS source_platform, "
            "       rs.shop_url AS source_shop_url, "
            "       rs.discovered_product_urls, "
            "       rs.discovered_article_urls, "
            "       rs.discovered_collection_urls, "
            "       rs.bio_discovery_at "
            "FROM roaster_profiles rp "
            "LEFT JOIN roaster_sources rs ON rs.website = rp.website "
            "WHERE rp.published = 1 "
        )
    params: list = []
    if slug:
        if target_table == "roaster_profiles":
            sql += "AND rp.roaster_slug = ? "
        else:
            sql += "AND roaster_slug = ? "
        params.append(slug)
    if since:
        if target_table == "products":
            sql += "AND enriched_at >= ? "
        elif target_table == "roaster_articles":
            sql += "AND created_at >= ? "
        else:
            sql += "AND rs.bio_discovery_at >= ? "
        params.append(since)
    if skip_already_reviewed:
        # Exclude rows that already have at least one quality_reviews row
        sql += (
            "AND NOT EXISTS ("
            "  SELECT 1 FROM quality_reviews qr "
            "  WHERE qr.target_table = ? AND qr.target_id = "
        )
        if target_table == "products":
            sql += "products.product_id"
        elif target_table == "roaster_articles":
            sql += "CAST(roaster_articles.id AS TEXT)"
        else:
            sql += "rp.roaster_slug"
        sql += ") "
        params.append(target_table)
    sql += "ORDER BY "
    if target_table == "products":
        sql += "enriched_at DESC "
    elif target_table == "roaster_articles":
        sql += "created_at DESC "
    else:
        sql += "rs.bio_discovery_at DESC NULLS LAST "
    if limit:
        sql += "LIMIT ? "
        params.append(limit)

    rows = db.execute(sql, tuple(params)).fetchall()

    now_iso = _now_iso_utc()
    stats = {
        "target_table": target_table,
        "slug": slug,
        "since": since,
        "rows_scanned": len(rows),
        "rows_flagged_by_t1": 0,
        "total_t1_flags": 0,
        "t2_runs": 0,
        "t2_confirmed": 0,
        "t2_cleared": 0,
        "t2_unsure": 0,
        "t2_failed": 0,
    }

    # Resolve roaster_name lookups in bulk for products (avoid N+1)
    roaster_names: dict[str, str] = {}
    if target_table == "products":
        slug_set = {r["roaster_slug"] for r in rows if r["roaster_slug"]}
        if slug_set:
            placeholders = ",".join("?" for _ in slug_set)
            for r in db.execute(
                f"SELECT roaster_slug, name FROM roaster_profiles "
                f"WHERE roaster_slug IN ({placeholders})",
                tuple(slug_set),
            ).fetchall():
                roaster_names[r["roaster_slug"]] = r["name"] or r["roaster_slug"]

    for row in rows:
        entity = dict(row)
        if target_table == "products":
            rn = roaster_names.get(entity.get("roaster_slug")) or entity.get("roaster_slug")
            bundle = run_t1_product(
                entity=entity, page_text="", roaster_name=rn,
                product_id=str(entity["product_id"]),
            )
        elif target_table == "roaster_articles":
            bundle = run_t1_article(
                entity=entity, page_text="",
                article_id=str(entity["id"]),
            )
        else:
            # roaster_profiles: split entity into profile + source halves
            # (the JOIN produced columns from both tables). Look up the
            # current catalog URLs for the roaster.
            rslug = entity.get("roaster_slug")
            catalog_urls = [
                r["product_url"] for r in db.execute(
                    "SELECT product_url FROM products "
                    "WHERE roaster_slug = ? AND product_url IS NOT NULL "
                    "AND product_url != ''",
                    (rslug,),
                ).fetchall()
            ]
            # Reconstruct source dict from the JOIN columns
            source_dict = {
                "platform": entity.get("source_platform"),
                "shop_url": entity.get("source_shop_url"),
                "discovered_product_urls": entity.get(
                    "discovered_product_urls"
                ),
                "discovered_article_urls": entity.get(
                    "discovered_article_urls"
                ),
                "discovered_collection_urls": entity.get(
                    "discovered_collection_urls"
                ),
                "bio_discovery_at": entity.get("bio_discovery_at"),
            }
            bundle = run_t1_bio(
                roaster_slug=str(rslug),
                profile=entity,
                source=source_dict,
                catalog_product_urls=catalog_urls,
            )

        # Bio flags are deterministic → persist as 'confirmed' directly.
        # Product / article flags go through 'pending' → T2 review.
        bio_mode = target_table == "roaster_profiles"
        persist_flags(
            db, bundle, now_iso=now_iso,
            default_verdict="confirmed" if bio_mode else "pending",
        )
        if not bundle.flags:
            continue
        stats["rows_flagged_by_t1"] += 1
        stats["total_t1_flags"] += len(bundle.flags)

        if not run_t2 or bio_mode:
            # Bio: flags went straight to confirmed; no T2 step.
            continue

        description_raw = entity.get("description_raw")
        try:
            verdicts = run_t2_review(
                entity=entity, page_text="",
                description_raw=description_raw, flags=bundle.flags,
                roaster_slug=entity.get("roaster_slug"),
                target_id=bundle.target_id,
            )
        except Exception:
            stats["t2_failed"] += 1
            continue
        stats["t2_runs"] += 1
        if not verdicts:
            continue
        counts = persist_t2_verdicts(
            db, target_table=bundle.target_table,
            target_id=bundle.target_id, verdicts=verdicts,
            now_iso=now_iso,
        )
        stats["t2_confirmed"] += counts["confirmed"]
        stats["t2_cleared"] += counts["cleared"]
        stats["t2_unsure"] += counts["unsure"]

    return stats


def _now_iso_utc() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


__all__ = [
    "QualityFlag",
    "ReviewBundle",
    "run_t1_product",
    "run_t1_article",
    "run_t1_bio",
    "persist_flags",
    "run_t2_review",
    "persist_t2_verdicts",
    "prepare_t3_review_batch",
    "apply_t3_corrections",
    "run_retroactive_sweep",
]
