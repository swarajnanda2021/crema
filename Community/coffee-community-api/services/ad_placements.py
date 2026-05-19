"""Ad-placement suggestions — connects roaster articles to their own
catalog of coffees.

# Bottom-up causal matching (2026-05-14 rewrite)

The matcher walks each coffee in the roaster's catalog and asks
"what about THIS coffee makes it attributable to this article?"
Every attribution carries an explicit cause: name match, estate
match, varietal match, region match, process match, or roast
match. If no cause exists, the coffee is not attributed — that's
the bottom-up principle.

The prior top-down scorer accumulated weak signals (process +
topic + thematic alignment) above a threshold, which produced
noise like "Tamil Nadu coffee suggested on a Nagaland article
because both mention washed process." The new model surfaces the
exact reason in the placement payload so the user can judge —
"Recommended due to: Same process (Anaerobic)" — and the reader
splices the card next to the paragraph where the cause occurred,
not at a fixed mid-body position.

Causes are ordered by specificity. A name match (exact mention)
wins over an estate match wins over a varietal match wins over
a region match wins over a process match wins over a roast match.
The strongest cause becomes the primary attribution_cause; the
others ride along as all_causes for the owner's debug surface.

Why Python deterministic instead of Haiku: matching is mechanical.
The same article + catalog should always produce the same
suggestions. Haiku would drift between runs and we'd lose the
ability to debug a specific placement decision.
"""

from __future__ import annotations

import re
from html import unescape


# Cap per article. Strong matches (name, estate) typically only
# resolve to 1-2 coffees; 3 leaves headroom for tasting-notes
# articles that legitimately compare multiple beans.
MAX_SUGGESTIONS_PER_ARTICLE = 3


def _word_boundary_count(needle: str, haystack: str) -> int:
    """Count word-boundary occurrences of `needle` inside `haystack`.
    Both inputs are lowercased before scanning. Returns 0 for empty
    inputs."""
    if not needle or not haystack:
        return 0
    pat = re.compile(
        r"\b" + re.escape(needle.strip().lower()).replace(r"\ ", r"\s+") + r"\b",
        re.IGNORECASE,
    )
    return len(pat.findall(haystack))


def _strip_html(s: str | None) -> str:
    """Strip HTML tags for plaintext scanning. We keep the text
    inside <a>/<strong>/<em> etc. — only the markup goes."""
    if not s:
        return ""
    return re.sub(r"<[^>]+>", " ", s)


# ── Causal matcher ──────────────────────────────────────────────

# Regex to capture each `<p>...</p>` block in the body. We index
# paragraphs left-to-right so the reader can splice a placement
# next to the paragraph where its cause was found.
_PARA_RE = re.compile(r"<p\b[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_TAG_INNER_RE = re.compile(r"<[^>]+>")


def _split_paragraphs(body_html: str | None) -> list[str]:
    """Extract paragraph plain text in order, filtering empties.
    Indexed by position — paragraph 0 is the first <p> in the body.

    Used both server-side (to find which paragraph contains a cause)
    and to align with the client's `htmlToBlocks()` paragraph
    sequence. Both sides count <p> blocks the same way; a placement
    with paragraph_idx=3 splices after the 4th paragraph in the
    client's rendered output."""
    if not body_html:
        return []
    out = []
    for m in _PARA_RE.finditer(body_html):
        text = _TAG_INNER_RE.sub(" ", m.group(1))
        text = unescape(text).strip()
        if text:
            out.append(text)
    return out


# ── Statistical rarity filter ────────────────────────────────────
#
# Instead of hardcoded GENERIC_VARIETALS / GENERIC_ORIGINS /
# GENERIC_ROAST_LEVELS lists (which need per-locale maintenance and
# drift as the catalog grows), we derive what's generic per roaster
# from the catalog itself: a term is "generic" if it appears in more
# than RARITY_THRESHOLD of the roaster's own coffees.
#
# Examples for a 15-coffee roaster (threshold = max(2, 25% × 15) = 4):
#   • "Arabica" — in 14 of 15 → generic → excluded
#   • "Multi-estate" — in 7 of 15 → generic → excluded
#   • "Wayanad" — in 2 of 15 → rare → trigger
#   • "Biligirirangan Hills" — in 5 of 15 → generic-ish → excluded
#   • "Yirgacheffe" (Ethiopian roaster, 2 of 12 coffees) — rare → trigger
#
# Works in any country, any catalog, any language. No curated lists.
RARITY_FRACTION = 0.25
RARITY_FLOOR = 2  # minimum absolute count for small catalogs


def _rarity_cap(catalog_size: int) -> int:
    """Maximum count below which a term is considered rare in the
    catalog. Floor protects small catalogs (a 3-coffee roaster whose
    coffees all share an attribute can still match on it via the
    floor, instead of being shut out entirely)."""
    return max(RARITY_FLOOR, int(catalog_size * RARITY_FRACTION + 0.5))


# Process keywords we extract from `process_raw`. These are the
# specialty-distinguishing terms — they pass through the same rarity
# filter as everything else, so common ones ("washed" in 30% of the
# catalog) get auto-excluded.
PROCESS_KEYWORDS_PRIORITY = [
    "anaerobic", "carbonic", "co-fermented", "co fermented", "yeast",
    "lactic", "honey", "pulped", "fermented", "natural", "washed",
]


def _find_in_paragraphs(needle: str, paragraphs: list[str]) -> int | None:
    """Return index of the first paragraph that contains `needle`
    on a word boundary. None if not found."""
    if not needle:
        return None
    pat = re.compile(
        r"\b" + re.escape(needle.strip().lower()).replace(r"\ ", r"\s+") + r"\b",
        re.IGNORECASE,
    )
    for i, p in enumerate(paragraphs):
        if pat.search(p):
            return i
    return None


def _process_keywords_for_product(product: dict) -> list[str]:
    """Pull specialty-relevant process keywords out of the product's
    process_raw field. Returns ordered list (most specific first)."""
    raw = (product.get("process_raw") or "").lower()
    if not raw:
        return []
    return [kw for kw in PROCESS_KEYWORDS_PRIORITY if kw in raw]


# ── Flavor notes parser ──────────────────────────────────────────
#
# `flavor_notes` is a JSON array of structured flavor tokens emitted
# by the enricher ("Hazelnut", "Dark Chocolate", "Jaggery"). These
# are higher-signal than scraping the bio: they're already condensed
# to the named flavor concepts a coffee expresses, with locale-neutral
# capitalised tokens.
def _flavor_tokens(product: dict) -> list[str]:
    """Parse the `flavor_notes` JSON column to a list of flavor
    tokens. Returns [] when the field is empty / malformed.

    Falls back to the `tasting_notes` free-text field, splitting on
    common separators. The structured JSON is preferred (cleaner
    tokens), but falling back gives coverage for coffees whose
    enricher run wrote the free-text but not the JSON."""
    import json as _json
    raw = product.get("flavor_notes")
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = _json.loads(raw)
            if isinstance(parsed, list):
                return [t.strip() for t in parsed if isinstance(t, str) and t.strip()]
        except (ValueError, _json.JSONDecodeError):
            pass
    # Fallback — split tasting_notes on comma / ampersand. Brittle
    # for prose-heavy fields but better than nothing.
    text = (product.get("tasting_notes") or "").strip()
    if not text:
        return []
    parts = re.split(r"[,&]|\band\b", text, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip() and len(p.strip()) >= 3]


# Cause strength — drives ordering when a coffee has multiple causes.
# Hierarchy: a coffee mentioned by name beats one matched by farm,
# beats estate, beats varietal, beats flavor, beats region/process,
# beats bean type, beats roast, beats altitude.
STRENGTH_NAME_TITLE = 100
STRENGTH_NAME_BODY = 95
STRENGTH_NAME_EXCERPT = 90
STRENGTH_ESTATE = 80
STRENGTH_PRODUCER = 75
STRENGTH_VARIETAL = 60
STRENGTH_REGION = 55
STRENGTH_FLAVOR = 50
STRENGTH_PROCESS = 40
STRENGTH_BEAN_TYPE = 35
STRENGTH_ROAST = 30
STRENGTH_ALTITUDE = 25


def _build_catalog_frequency(products: list[dict]) -> dict[str, int]:
    """Count, across the roaster's catalog, how many coffees mention
    each term in either a structured field or a bio token. Returns
    a lowercase `term -> count` map used by the rarity filter.

    A "term" here includes:
      • coffee_name (single string per coffee)
      • origin + origin_stem (both forms, since articles sometimes
        drop the "Estate" suffix)
      • varietal
      • origin_region
      • each process keyword present in process_raw
      • roast_level
      • every word ≥3 chars in the bio (roaster_blurb || description_raw)

    Counted per-coffee (a coffee whose bio mentions "Wayanad" three
    times still counts as 1 for "wayanad"). This is what makes the
    rarity filter measure "how many coffees mention X", not "how
    often X appears across the catalog total."
    """
    counts: dict[str, int] = {}
    for p in products:
        seen_in_this_product: set[str] = set()

        def bump(term: str | None):
            if not term:
                return
            key = term.strip().lower()
            if not key or key in seen_in_this_product:
                return
            seen_in_this_product.add(key)
            counts[key] = counts.get(key, 0) + 1

        bump(p.get("coffee_name"))
        origin = (p.get("origin") or "").strip()
        if origin:
            bump(origin)
            stem = re.sub(r"\s*estate\s*$", "", origin, flags=re.IGNORECASE).strip()
            if stem and stem != origin:
                bump(stem)
        bump(p.get("producer"))
        bump(p.get("varietal"))
        bump(p.get("origin_region"))
        bump(p.get("bean_type"))
        bump(p.get("roast_level"))
        altitude = p.get("altitude_masl")
        if isinstance(altitude, (int, float)) and altitude > 0:
            # Numeric — index both "1200" and "1,200" string forms so
            # the rarity index reflects how this coffee's altitude
            # appears in prose.
            n = int(altitude)
            bump(str(n))
            if n >= 1000:
                bump(f"{n // 1000},{n % 1000:03d}")
        for kw in _process_keywords_for_product(p):
            bump(kw)
        # Flavor notes — each token in the JSON array counts as a
        # bumped term so the rarity filter knows how common each
        # flavor is across the catalog.
        for flavor in _flavor_tokens(p):
            bump(flavor)
    return counts


def _is_rare(term: str | None, freq: dict[str, int], cap: int) -> bool:
    """A term is rare (a valid trigger candidate) if it appears in
    `cap` or fewer coffees in the catalog. Returns False for empty /
    None terms."""
    if not term:
        return False
    return freq.get(term.strip().lower(), 0) <= cap


def _find_attribution_causes(
    product: dict,
    article: dict,
    paragraphs: list[str],
    catalog_freq: dict[str, int],
    rarity_cap: int,
) -> list[dict]:
    """For one (product, article) pair, walk the product's catalog
    attributes + bio and return every cause that resolves to a
    paragraph (or title/excerpt) in the article. Sorted strongest
    first.

    Each cause is a dict: { kind, label, trigger, strength, paragraph_idx }.
      • `kind` — stable enum the client switches on for badge
        formatting: 'name' | 'estate' | 'bio' | 'varietal' | 'region'
        | 'process' | 'roast'.
      • `label` — debug/admin string ("Same estate: Baarbara Estate").
      • `trigger` — the exact word/phrase that matched in the
        article. Used as the chip-badge text and the reader's
        caption ("because this paragraph mentioned {trigger}").
      • `paragraph_idx` — 0-based <p> block index where the trigger
        was found; -1 means title/excerpt (no body anchor).
      • `strength` — ordering weight.

    Each attribute is gated by the rarity filter — a value that
    appears in more than `rarity_cap` coffees of the catalog is
    treated as generic and skipped. This replaces the prior
    hardcoded GENERIC_VARIETALS / GENERIC_ORIGINS / GENERIC_ROAST
    sets with a single statistical rule that works for any roaster
    in any geography (Ethiopian, Colombian, anywhere — the matcher
    derives what's specific from the catalog itself)."""
    title = (article.get("title") or "").lower()
    excerpt = (article.get("excerpt") or "").lower()
    causes: list[dict] = []

    # Cause — Mentioned by name. Coffee names are inherently unique
    # within a roaster's catalog, so we don't gate this on rarity.
    # Title is strongest; body next; excerpt third.
    name = (product.get("coffee_name") or "").strip()
    if name:
        if _word_boundary_count(name, title):
            causes.append({
                "kind": "name",
                "label": "Mentioned by name",
                "trigger": name,
                "strength": STRENGTH_NAME_TITLE,
                "paragraph_idx": -1,
            })
        else:
            idx = _find_in_paragraphs(name, paragraphs)
            if idx is not None:
                causes.append({
                    "kind": "name",
                    "label": "Mentioned by name",
                    "trigger": name,
                    "strength": STRENGTH_NAME_BODY,
                    "paragraph_idx": idx,
                })
            elif _word_boundary_count(name, excerpt):
                causes.append({
                    "kind": "name",
                    "label": "Mentioned by name",
                    "trigger": name,
                    "strength": STRENGTH_NAME_EXCERPT,
                    "paragraph_idx": -1,
                })

    # Cause — Same estate. Try stem ("Baarbara") then full
    # ("Baarbara Estate"). Each is gated by rarity — Multi-estate
    # naturally fails the filter and gets skipped.
    origin = (product.get("origin") or "").strip()
    if origin:
        origin_stem = re.sub(r"\s*estate\s*$", "", origin, flags=re.IGNORECASE).strip()
        needles = [origin_stem, origin] if origin_stem and origin_stem != origin else [origin]
        for needle in needles:
            if not _is_rare(needle, catalog_freq, rarity_cap):
                continue
            idx = _find_in_paragraphs(needle, paragraphs)
            if idx is not None:
                causes.append({
                    "kind": "estate",
                    "label": f"Same estate: {origin}",
                    "trigger": needle,
                    "strength": STRENGTH_ESTATE,
                    "paragraph_idx": idx,
                })
                break

    # Cause — Same producer. The enricher pulls farmer / cooperative
    # names ("M. Kethegowda", "Ashok Patre") into this field. Highly
    # specific — when a producer name appears in an article, the
    # attribution is editorially obvious.
    producer = (product.get("producer") or "").strip()
    if producer and _is_rare(producer, catalog_freq, rarity_cap):
        idx = _find_in_paragraphs(producer, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "producer",
                "label": f"Same producer: {producer}",
                "trigger": producer,
                "strength": STRENGTH_PRODUCER,
                "paragraph_idx": idx,
            })

    # Cause — Same varietal. Rarity filter excludes Arabica/Robusta/
    # blend automatically since they're in most of the catalog.
    varietal = (product.get("varietal") or "").strip()
    if varietal and _is_rare(varietal, catalog_freq, rarity_cap):
        idx = _find_in_paragraphs(varietal, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "varietal",
                "label": f"Same varietal: {varietal}",
                "trigger": varietal,
                "strength": STRENGTH_VARIETAL,
                "paragraph_idx": idx,
            })

    # Cause — Same region.
    region = (product.get("origin_region") or "").strip()
    if region and _is_rare(region, catalog_freq, rarity_cap):
        idx = _find_in_paragraphs(region, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "region",
                "label": f"Same region: {region}",
                "trigger": region,
                "strength": STRENGTH_REGION,
                "paragraph_idx": idx,
            })

    # Cause — Same flavor note. The enricher emits a JSON array of
    # named flavor tokens ("Jaggery", "Dark Chocolate", "Vanilla").
    # If any token resolves to a paragraph, attribute on that one.
    # Iterate in declared order so the first-listed flavor (usually
    # the dominant one) gets first shot at the cause.
    for flavor in _flavor_tokens(product):
        if not _is_rare(flavor, catalog_freq, rarity_cap):
            continue
        idx = _find_in_paragraphs(flavor, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "flavor",
                "label": f"Same flavor: {flavor}",
                "trigger": flavor,
                "strength": STRENGTH_FLAVOR,
                "paragraph_idx": idx,
            })
            break

    # Cause — Same process. Rarity filter excludes "washed" /
    # "natural" if they're shared across most of the catalog.
    for kw in _process_keywords_for_product(product):
        if not _is_rare(kw, catalog_freq, rarity_cap):
            continue
        idx = _find_in_paragraphs(kw, paragraphs)
        if idx is not None:
            display = kw.title().replace("-Fermented", "-fermented")
            causes.append({
                "kind": "process",
                "label": f"Same process: {display}",
                "trigger": display,
                "strength": STRENGTH_PROCESS,
                "paragraph_idx": idx,
            })
            break

    # Cause — Same bean type. Rarity filter excludes the dominant
    # bean type (catalog with 14 Arabica + 1 Robusta → Robusta is
    # rare for that 1 coffee and a valid trigger when an article
    # discusses Robusta specifically).
    bean_type = (product.get("bean_type") or "").strip()
    if bean_type and _is_rare(bean_type, catalog_freq, rarity_cap):
        idx = _find_in_paragraphs(bean_type, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "bean_type",
                "label": f"Same bean type: {bean_type}",
                "trigger": bean_type,
                "strength": STRENGTH_BEAN_TYPE,
                "paragraph_idx": idx,
            })

    # Cause — Same roast level. Rarity filter excludes "Medium" /
    # whatever roast level dominates this catalog.
    roast = (product.get("roast_level") or "").strip()
    if roast and _is_rare(roast, catalog_freq, rarity_cap):
        idx = _find_in_paragraphs(roast, paragraphs)
        if idx is not None:
            causes.append({
                "kind": "roast",
                "label": f"Same roast: {roast}",
                "trigger": roast,
                "strength": STRENGTH_ROAST,
                "paragraph_idx": idx,
            })

    # Cause — Same altitude. Numeric — try both "1200" and "1,200"
    # forms since prose can format either way. Word-boundary match
    # so we don't accidentally hit "1200" as part of a longer
    # number like "12005".
    altitude = product.get("altitude_masl")
    if isinstance(altitude, (int, float)) and altitude > 0:
        n = int(altitude)
        needles = [str(n)]
        if n >= 1000:
            needles.append(f"{n // 1000},{n % 1000:03d}")
        for needle in needles:
            if not _is_rare(needle, catalog_freq, rarity_cap):
                continue
            idx = _find_in_paragraphs(needle, paragraphs)
            if idx is not None:
                causes.append({
                    "kind": "altitude",
                    "label": f"Same altitude: {n}m",
                    "trigger": f"{n}m",
                    "strength": STRENGTH_ALTITUDE,
                    "paragraph_idx": idx,
                })
                break

    causes.sort(key=lambda c: -c["strength"])
    return causes


_PRODUCT_COLUMNS = """
  product_id, roaster_slug, coffee_name, varietal, origin,
  process_raw, description_raw, roaster_blurb, image_url, product_url,
  price_inr, weight_grams, available, tasting_notes,
  flavor_notes, roast_level, bean_type, origin_region,
  producer, altitude_masl
"""


def _canonicalise_url(raw: str | None) -> str | None:
    """Python port of the reader's `canonicaliseUrl`. Lowercases host,
    strips `www.` prefix, strips trailing slashes + query + fragment.
    Used by the inline-href detector to match `<a href>` URLs in the
    article body against the catalog's `product_url` column.

    Mirrors `crema-app/app/article/[id].tsx::canonicaliseUrl` so the
    server-side detection picks up the exact same matches the
    client-side `augmentBlocksWithEmbeds` would (predictability —
    same article on web + native shows the same "inline" set)."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    # Quick filter — schemes we don't care about (mailto:, tel:, etc.).
    if not re.match(r"^https?://", s, re.IGNORECASE) and "://" in s:
        return None
    # urlparse handles both absolute and relative; if relative (no
    # scheme), treat as unresolvable — we don't have a base URL.
    try:
        from urllib.parse import urlparse
        u = urlparse(s if "://" in s else "https://crema.placeholder/" + s.lstrip("/"))
        if u.scheme not in ("http", "https"):
            return None
        host = (u.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if host == "crema.placeholder" or not host:
            return None
        path = (u.path or "/").rstrip("/")
        if not path:
            path = "/"
        return f"{host}{path}"
    except Exception:
        return None


# Match every `<a href="...">` in the article body. Anchor href may
# be quoted with single or double quotes; we capture the URL.
_HREF_RE = re.compile(r"""<a\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]""", re.IGNORECASE)


def _detect_inline_placements(
    article: dict,
    products: list[dict],
) -> list[dict]:
    """Walk the article body for `<a href>` links that resolve to one
    of the roaster's catalog products. Returns the matched products
    in first-mention order, each tagged with `source='inline'`.

    These are the Crema-responsible placements — the roaster put the
    link in their article themselves, so the ADS tab UI renders them
    as non-removable (the chip has no X), and the reader labels the
    bucket "Referenced in this article". Detected on every owner /
    public GET so the inline set stays in sync with the article body
    automatically (no persistence needed).

    Each entry carries `paragraph_idx` — the index of the <p> block
    containing the href — so the reader can splice the card next to
    the linking paragraph instead of mid-body. Mirrors the auto
    bucket's positioning (every placement anchored to its evidence)."""
    body = article.get("body_html") or ""
    if not body or not products:
        return []
    products_by_url: dict[str, dict] = {}
    for p in products:
        canon = _canonicalise_url(p.get("product_url"))
        if canon:
            products_by_url[canon] = p
    if not products_by_url:
        return []

    # Build a per-paragraph index of hrefs so we can record which
    # paragraph each match came from. The reader uses this to splice
    # the inline-bucket card next to the linking paragraph.
    paragraphs = _split_paragraphs(body)
    # Map canonicalised URL → first paragraph index where the raw
    # href occurred (we walk paragraphs in order; first wins).
    href_para_idx: dict[str, int] = {}
    for i, m in enumerate(_PARA_RE.finditer(body)):
        # Re-extract hrefs from the FULL paragraph match (which
        # includes the <a> markup, unlike the plain-text paragraphs[])
        para_html = m.group(1)
        for href_m in _HREF_RE.finditer(para_html):
            canon = _canonicalise_url(href_m.group(1))
            if canon and canon not in href_para_idx:
                # The visible-paragraph index might differ from the
                # raw enumerate index because we filter empty <p>s
                # in `_split_paragraphs`. We compute the visible
                # index by counting non-empty paragraphs up to this
                # raw index — but since hrefs only occur in non-empty
                # paragraphs, raw index works as a proxy.
                href_para_idx[canon] = i

    # Recount paragraph indices in the visible-paragraph space so
    # they align with the reader's `htmlToBlocks()` output (which
    # also drops empty <p>s).
    visible_idx_for_raw: dict[int, int] = {}
    raw_idx = 0
    visible_idx = 0
    for m in _PARA_RE.finditer(body):
        text = _TAG_INNER_RE.sub(" ", m.group(1)).strip()
        if text:
            visible_idx_for_raw[raw_idx] = visible_idx
            visible_idx += 1
        raw_idx += 1

    seen: set[str] = set()
    out: list[dict] = []
    for match in _HREF_RE.finditer(body):
        href = match.group(1)
        canon = _canonicalise_url(href)
        if not canon:
            continue
        product = products_by_url.get(canon)
        if not product:
            continue
        pid = product["product_id"]
        if pid in seen:
            continue
        seen.add(pid)
        raw = href_para_idx.get(canon, -1)
        para_idx = visible_idx_for_raw.get(raw, -1) if raw >= 0 else -1
        out.append({
            "product": product,
            "attribution_cause": "Linked in article body",
            "cause_kind": "linked",
            # Inline placements don't display a caption (the URL is
            # itself the explanation), but we still pass the trigger
            # for completeness — the reader's caption logic checks
            # `source` and skips inline.
            "trigger": product.get("coffee_name") or "",
            "paragraph_idx": para_idx,
            "strength": 200,  # higher than any auto cause
            "all_causes": ["Linked in article body"],
            "source": "inline",
        })
    return out


def _auto_suggestions_for_article(article: dict, products: list[dict]) -> list[dict]:
    """Walk every product in the roaster's catalog and check whether
    any of its coffee-specific attributes (name, estate, varietal,
    region, process, roast) appear in the article. Products with at
    least one cause are attributed; products with no cause are not.

    Returns the top-N entries by strength. Each entry carries the
    primary `attribution_cause` (the strongest cause found) + the
    paragraph index where the cause was found, so the reader can
    splice the card next to the relevant content.

    Shape per entry:
        {
          "product": {...},
          "attribution_cause": "Same estate: Baarbara Estate",
          "paragraph_idx": 4,   # -1 means title/excerpt
          "strength": 75,
          "all_causes": ["Same estate: Baarbara Estate", "Same process: Washed"],
        }
    """
    paragraphs = _split_paragraphs(article.get("body_html"))
    catalog_freq = _build_catalog_frequency(products)
    rarity_cap = _rarity_cap(len(products))
    scored: list[dict] = []
    for product in products:
        causes = _find_attribution_causes(
            product, article, paragraphs, catalog_freq, rarity_cap,
        )
        if not causes:
            continue
        primary = causes[0]
        scored.append({
            "product": product,
            "attribution_cause": primary["label"],
            "cause_kind": primary.get("kind") or "auto",
            "trigger": primary.get("trigger") or "",
            "paragraph_idx": primary["paragraph_idx"],
            "strength": primary["strength"],
            "all_causes": [c["label"] for c in causes],
        })
    # Strongest first; ties break on product_id for deterministic
    # ordering (same article + catalog always produces same order).
    scored.sort(key=lambda x: (-x["strength"], x["product"]["product_id"]))
    return scored[:MAX_SUGGESTIONS_PER_ARTICLE]


def _placements_index(roaster_slug: str, db) -> dict[int, dict[str, dict]]:
    """Index every persisted placement row for a roaster by article
    and product so the merge step can flip a single auto-suggestion
    on or off without re-running the scorer per row.

    Shape: { article_id: { product_id: row_dict } }
    Includes rows where `deleted_at` is set — callers consult that
    field to decide whether to surface or suppress."""
    rows = db.execute(
        """SELECT id, roaster_slug, article_id, product_id, source,
                  order_idx, created_at, deleted_at
           FROM roaster_ad_placements
           WHERE roaster_slug = ?""",
        (roaster_slug,),
    ).fetchall()
    index: dict[int, dict[str, dict]] = {}
    for r in rows:
        row = dict(r)
        index.setdefault(row["article_id"], {})[row["product_id"]] = row
    return index


def _effective_for_article(
    article: dict,
    products: list[dict],
    per_article: dict[str, dict],
) -> list[dict]:
    """Merge the three placement sources for one article. Returns a
    list of `{product, score, reasons, source}` entries representing
    what the consumer reader + the owner's ADS tab should see right
    now. `source` is one of:

      • 'inline' — the article body links to this product's
                   `product_url`. Crema-responsible; non-removable in
                   the ADS tab; the reader labels the bucket
                   "Referenced in this article".
      • 'auto'   — the deterministic scorer matched this product
                   against the article above threshold AND the
                   roaster hasn't dismissed it. Removable.
      • 'manual' — the roaster explicitly added this product via
                   AddCoffeesModal. Removable.

    Merge rules:
      • Inline placements come first (display order = first-mention
        in the article body). Always included; never deduped against
        auto/manual — if the same product is both inline AND a
        roaster pick, the inline row wins and the lower-priority
        bucket drops it.
      • Auto-suggestions follow, in score order, minus any tombstoned
        rows (`source='auto', deleted_at NOT NULL`) and minus any
        product already accounted for as inline.
      • Manual placements come last, in order_idx then created_at,
        minus any product already accounted for as inline or auto.

    Each entry carries `source` so the client can pick the right
    label + affordance per bucket; the score and reasons live
    alongside for the owner's debug surface."""
    products_by_id = {p["product_id"]: p for p in products}

    # Bucket 1 — inline references. Walks the body_html for
    # `<a href>` resolving to a catalog `product_url`. Each entry
    # carries `attribution_cause: "Linked in article body"` and the
    # paragraph_idx where the href appears.
    inline = _detect_inline_placements(article, products)
    seen: set[str] = {e["product"]["product_id"] for e in inline}

    # Bucket 2 — auto-suggestions from the bottom-up causal matcher.
    # Each entry carries `attribution_cause` (the strongest cause
    # found) and `paragraph_idx` (where the cause was located).
    auto = _auto_suggestions_for_article(article, products)
    kept_auto: list[dict] = []
    for entry in auto:
        pid = entry["product"]["product_id"]
        if pid in seen:
            continue
        row = per_article.get(pid)
        if row and row.get("source") == "auto" and row.get("deleted_at"):
            continue  # roaster removed this auto-suggestion
        kept_auto.append({**entry, "source": "auto"})
        seen.add(pid)

    # Bucket 3 — manual placements, minus anything already inline /
    # auto. In order_idx then created_at. No anchor paragraph
    # (the roaster picked these without referencing content), so
    # paragraph_idx = -1 and the reader splices them mid-body.
    manual_rows = [
        row for row in per_article.values()
        if row.get("source") == "manual" and not row.get("deleted_at")
    ]
    manual_rows.sort(key=lambda r: (r.get("order_idx", 0), r.get("created_at") or ""))
    kept_manual: list[dict] = []
    for row in manual_rows:
        pid = row["product_id"]
        if pid in seen:
            continue
        product = products_by_id.get(pid)
        if not product:
            continue  # catalog row was deleted underneath us
        kept_manual.append({
            "product": product,
            "attribution_cause": "Picked by the roaster",
            "cause_kind": "picked",
            # Manual placements show no caption — the roaster chose
            # them without referencing content, so explaining "why
            # this one" would be self-referential noise. Empty
            # trigger keeps the field shape consistent.
            "trigger": "",
            "paragraph_idx": -1,
            "strength": 0,
            "all_causes": ["Picked by the roaster"],
            "source": "manual",
        })
        seen.add(pid)

    return inline + kept_auto + kept_manual


def suggest_journal_placements(roaster_slug: str, db) -> list[dict]:
    """For each published article belonging to the roaster, return
    the EFFECTIVE placement set — auto-suggestions reconciled against
    persisted owner edits. Owner-facing endpoint.

    Shape per entry:
        {
          "article": { id, title, excerpt, image_url, topic_category,
                       tags, published_at, word_count },
          "suggestions": [
            { "product": { product_id, coffee_name, image_url, ... },
              "score": int,
              "reasons": list[str],
              "source": "auto" | "manual" },
            ...
          ]
        }

    Articles with no effective placements appear with an empty
    `suggestions` list — the UI shows the AdAddChip on its own."""
    articles = db.execute(
        """SELECT id, roaster_slug, title, excerpt, body_html, image_url,
                  topic_category, tags, published_at, word_count
           FROM roaster_articles
           WHERE roaster_slug = ? AND published = 1
           ORDER BY published_at DESC, id DESC""",
        (roaster_slug,),
    ).fetchall()
    products = db.execute(
        f"SELECT {_PRODUCT_COLUMNS} FROM products "
        f"WHERE roaster_slug = ? AND available = 1",
        (roaster_slug,),
    ).fetchall()

    article_dicts = [dict(a) for a in articles]
    product_dicts = [dict(p) for p in products]
    placement_index = _placements_index(roaster_slug, db)

    results: list[dict] = []
    for article in article_dicts:
        per_article = placement_index.get(article["id"], {})
        results.append({
            "article": article,
            "suggestions": _effective_for_article(
                article, product_dicts, per_article,
            ),
        })
    return results


def effective_placements_for_article(article_id: int, db) -> list[dict]:
    """Public-reader counterpart — returns placements bucketed by
    source so the reader can render one carousel per bucket with the
    appropriate label. Each entry includes the attribution cause and
    the paragraph index where the cause was found, so the reader can
    splice the card next to the relevant paragraph AND show
    'Recommended due to: <cause>' under the card.

    Shape per entry:
      { product_id, source, attribution_cause, paragraph_idx,
        roaster_slug }

    The reader looks up full product details from its own
    `useCoffeeData` cache; this endpoint just carries the minimum
    fields so the network payload stays small."""
    article_row = db.execute(
        """SELECT id, roaster_slug, title, excerpt, body_html,
                  topic_category, tags, image_url, published_at, word_count
           FROM roaster_articles
           WHERE id = ? AND published = 1""",
        (article_id,),
    ).fetchone()
    if not article_row:
        return []
    article = dict(article_row)
    products = db.execute(
        f"SELECT {_PRODUCT_COLUMNS} FROM products "
        f"WHERE roaster_slug = ? AND available = 1",
        (article["roaster_slug"],),
    ).fetchall()
    product_dicts = [dict(p) for p in products]
    placement_index = _placements_index(article["roaster_slug"], db)
    per_article = placement_index.get(article["id"], {})
    effective = _effective_for_article(article, product_dicts, per_article)
    return [
        {
            "product_id": e["product"]["product_id"],
            "source": e["source"],
            "attribution_cause": e.get("attribution_cause"),
            "cause_kind": e.get("cause_kind"),
            "trigger": e.get("trigger", ""),
            "paragraph_idx": e.get("paragraph_idx", -1),
            "roaster_slug": article["roaster_slug"],
        }
        for e in effective
    ]


def apply_placement_delta(
    roaster_slug: str,
    article_id: int,
    product_ids: list[str],
    db,
) -> list[dict]:
    """Persist a new effective product set for one article. Diffs
    `product_ids` against the auto-suggester output AND the current
    persisted state, then writes the minimum number of rows to make
    the delta table reflect what the roaster just submitted.

    Cases handled per product_id:
      • In auto AND in product_ids → revive any tombstone (clear
        deleted_at) so the kept-auto path lights up again.
      • In auto AND NOT in product_ids → write/revive an
        auto-tombstone (source='auto', deleted_at=now).
      • NOT in auto AND in product_ids → upsert a manual row
        (source='manual', deleted_at=NULL).
      • NOT in auto AND a stale manual row exists not in product_ids
        → soft-delete it.

    Order_idx on manual rows tracks insertion order so the carousel
    surfaces them stably across refreshes.

    Returns the new effective list, same shape as the GET endpoint
    emits — the client uses it to refresh state without a round-trip."""
    import datetime as _dt
    now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    article_row = db.execute(
        """SELECT id, roaster_slug, title, excerpt, body_html,
                  topic_category, tags, image_url, published_at, word_count
           FROM roaster_articles
           WHERE id = ? AND roaster_slug = ?""",
        (article_id, roaster_slug),
    ).fetchone()
    if not article_row:
        return []
    article = dict(article_row)
    products = db.execute(
        f"SELECT {_PRODUCT_COLUMNS} FROM products "
        f"WHERE roaster_slug = ? AND available = 1",
        (roaster_slug,),
    ).fetchall()
    product_dicts = [dict(p) for p in products]
    auto = _auto_suggestions_for_article(article, product_dicts)
    auto_ids = {entry["product"]["product_id"] for entry in auto}
    # Inline placements are Crema-responsible and non-removable. They
    # don't roundtrip through the delta table — server detects them
    # from the article body on every read. If the client somehow
    # includes an inline product_id in the requested list (e.g. the
    # delete-X was wired up by mistake on an inline chip, or someone
    # is hitting the API directly), we silently ignore it for both
    # add AND remove purposes. The reader will keep showing the
    # inline placement either way; we just refuse to persist
    # spurious manual/tombstone rows for it.
    inline = _detect_inline_placements(article, product_dicts)
    inline_ids = {entry["product"]["product_id"] for entry in inline}

    existing_rows = db.execute(
        """SELECT id, product_id, source, deleted_at, order_idx
           FROM roaster_ad_placements
           WHERE article_id = ? AND roaster_slug = ?""",
        (article_id, roaster_slug),
    ).fetchall()
    existing = {row["product_id"]: dict(row) for row in existing_rows}
    # Drop inline ids from the requested list — they live outside the
    # delta table by design.
    requested = [pid for pid in dict.fromkeys(product_ids) if pid not in inline_ids]

    # Step 1: process requested ids (kept-auto or manual-add).
    next_manual_idx = max(
        (row.get("order_idx") or 0)
        for row in existing.values()
        if row.get("source") == "manual"
    ) + 1 if any(r.get("source") == "manual" for r in existing.values()) else 0
    for pid in requested:
        prev = existing.get(pid)
        if pid in auto_ids:
            # kept-auto — wipe any tombstone
            if prev:
                db.execute(
                    """UPDATE roaster_ad_placements
                       SET deleted_at = NULL, source = 'auto'
                       WHERE id = ?""",
                    (prev["id"],),
                )
        else:
            # manual add or revive
            if prev:
                db.execute(
                    """UPDATE roaster_ad_placements
                       SET deleted_at = NULL, source = 'manual'
                       WHERE id = ?""",
                    (prev["id"],),
                )
            else:
                db.execute(
                    """INSERT INTO roaster_ad_placements
                       (roaster_slug, article_id, product_id, source,
                        order_idx, created_at)
                       VALUES (?, ?, ?, 'manual', ?, ?)""",
                    (roaster_slug, article_id, pid, next_manual_idx, now),
                )
                next_manual_idx += 1

    # Step 2: process removed ids (auto-tombstone or manual delete).
    # Inline ids are excluded — they're not in the delta table and
    # absence from `requested` shouldn't tombstone the inline row
    # (there isn't one to tombstone) nor should it tombstone the
    # auto/manual rows for the same product (an inline reference
    # already supersedes them in the merge).
    requested_set = set(requested)
    for auto_pid in auto_ids - requested_set - inline_ids:
        prev = existing.get(auto_pid)
        if prev and prev.get("deleted_at"):
            continue  # already tombstoned
        if prev:
            db.execute(
                """UPDATE roaster_ad_placements
                   SET deleted_at = ?, source = 'auto'
                   WHERE id = ?""",
                (now, prev["id"]),
            )
        else:
            db.execute(
                """INSERT INTO roaster_ad_placements
                   (roaster_slug, article_id, product_id, source,
                    order_idx, created_at, deleted_at)
                   VALUES (?, ?, ?, 'auto', 0, ?, ?)""",
                (roaster_slug, article_id, auto_pid, now, now),
            )
    # Manual rows the roaster just dropped → soft-delete. Skip rows
    # whose product is now inline (the inline placement supersedes
    # the manual row; tombstoning would be cosmetic noise — but
    # leaving the manual row active wouldn't surface it either since
    # `_effective_for_article` dedups inline > auto > manual).
    for pid, row in existing.items():
        if (
            row.get("source") == "manual"
            and pid not in requested_set
            and pid not in inline_ids
            and not row.get("deleted_at")
        ):
            db.execute(
                "UPDATE roaster_ad_placements SET deleted_at = ? WHERE id = ?",
                (now, row["id"]),
            )

    db.commit()

    # Re-read and return the effective list so the client sees the
    # canonical post-save shape.
    placement_index = _placements_index(roaster_slug, db)
    per_article = placement_index.get(article_id, {})
    return _effective_for_article(article, product_dicts, per_article)
