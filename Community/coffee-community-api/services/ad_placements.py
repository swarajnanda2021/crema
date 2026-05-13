"""Ad-placement suggestions — connects roaster articles to their own
catalog of coffees.

The matcher is deterministic Python: it walks each article's
text + tags + topic and scores every available product in the
roaster's catalog by signal weight. Top-scoring matches above a
threshold become suggested placements. The roaster sees the
suggestions in their profile's ADS tab and can keep / remove /
replace (replace UI ships later — initial cut is read-only).

Signal weights are tuned so a direct name mention always
dominates thematic matches (the "MOGRA" mention in article 796
should never be outranked by a varietal-tag overlap somewhere
else). A coffee mentioned by name in the body gets +20; in the
title +30; in the excerpt +25. Each thematic signal contributes
+2 to +5.

Why Python deterministic instead of Haiku: matching is
mechanical. The same article + catalog should always produce
the same suggestions. Haiku would drift between runs and we'd
lose the ability to debug a specific placement decision. The
roaster can trust deterministic output to be honest.
"""

from __future__ import annotations

import json
import re
from typing import Optional


# Minimum total score for a coffee to surface as a suggestion.
# Below this, the match is too weak to recommend — we'd rather
# show "no suggestion" than a low-confidence one.
SCORE_THRESHOLD = 4

# Cap per article — most articles only have 1-2 strong placements;
# 3 leaves headroom for variety on long pieces (brew guides etc.).
MAX_SUGGESTIONS_PER_ARTICLE = 3

# Signal weights — keep the direct-name signals well above the
# thematic ones so they dominate ordering.
WEIGHTS = {
    "name_in_title": 30,
    "name_in_excerpt": 25,
    "name_in_body": 20,
    "varietal_in_body": 5,
    "varietal_in_tags": 5,
    "origin_in_body": 4,
    "origin_in_tags": 4,
    "process_in_body": 3,
    "process_in_tags": 3,
    "topic_alignment": 2,
}


def _word_boundary_count(needle: str, haystack: str) -> int:
    """Count word-boundary occurrences of `needle` inside `haystack`.
    Both inputs are lowercased before scanning. Returns 0 for empty
    inputs.

    Word-boundary (`\\b`) ensures "Mogra" in body matches "MOGRA" but
    not "Mogrant" or "Mograndina". Multi-word needles (e.g. "cold
    brew") work because `\\b` matches at the space too — `\\bcold\\s+
    brew\\b` would match — but for simplicity we escape the whole
    needle and rely on whitespace-tolerant matching.
    """
    if not needle or not haystack:
        return 0
    pat = re.compile(
        r"\b" + re.escape(needle.strip().lower()).replace(r"\ ", r"\s+") + r"\b",
        re.IGNORECASE,
    )
    return len(pat.findall(haystack))


# Topic → catalog categories that thematically fit.
# Used to give a small boost when the article's topic_category
# loosely aligns with what kind of coffee makes sense to surface.
TOPIC_TO_PRODUCT_KIND = {
    "brew_guide": {"blend", "espresso", "single-origin"},
    "tasting_notes": {"single-origin", "experimental"},
    "sourcing_story": {"single-origin", "estate"},
    "origin_profile": {"single-origin", "estate"},
    "harvest_report": {"single-origin", "estate"},
    "company_update": set(),
    "industry_news": set(),
    "culture": set(),
    "health": set(),
    "miscellaneous": set(),
    "other": set(),
}


def _strip_html(s: Optional[str]) -> str:
    """Strip HTML tags for plaintext scanning. We keep the text
    inside <a>/<strong>/<em> etc. — only the markup goes."""
    if not s:
        return ""
    return re.sub(r"<[^>]+>", " ", s)


def _coffee_kind(product: dict) -> str:
    """Rough classifier — does the catalog row read as a blend, an
    espresso offering, a single-origin estate coffee, or experimental?
    Used for topic-alignment boost only; not surfaced to the user."""
    name = (product.get("coffee_name") or "").lower()
    blurb = (product.get("description_raw") or "").lower()
    varietal = (product.get("varietal") or "").lower()
    process = (product.get("process_raw") or "").lower()
    if "espresso" in name or "blend" in name or "blend" in varietal:
        return "blend"
    if "experimental" in process or "anaerobic" in process or "co-fermented" in process or "carbonic" in process:
        return "experimental"
    origin = (product.get("origin") or "").lower()
    if "estate" in origin or "single" in name.lower():
        return "estate"
    return "single-origin"


def _score_match(article: dict, product: dict) -> tuple[int, list[str]]:
    """Score one (article, product) pair. Returns (total_score,
    reasons) where reasons is a list of short strings explaining
    each scoring contribution."""
    title = (article.get("title") or "").lower()
    excerpt = (article.get("excerpt") or "").lower()
    body_plain = _strip_html(article.get("body_html")).lower()
    tags_raw = article.get("tags")
    if isinstance(tags_raw, str):
        try:
            tags = [t.lower() for t in (json.loads(tags_raw) or [])]
        except (ValueError, json.JSONDecodeError):
            tags = []
    elif isinstance(tags_raw, list):
        tags = [t.lower() for t in tags_raw if isinstance(t, str)]
    else:
        tags = []
    tags_blob = " ".join(tags)

    coffee_name = product.get("coffee_name") or ""
    varietal = product.get("varietal") or ""
    origin = product.get("origin") or ""
    process_raw = product.get("process_raw") or ""

    score = 0
    reasons: list[str] = []

    # Signal A — direct name mention. Strongest.
    if coffee_name:
        nt = _word_boundary_count(coffee_name, title)
        if nt:
            score += WEIGHTS["name_in_title"] * nt
            reasons.append(f"'{coffee_name}' in title (×{nt})")
        nx = _word_boundary_count(coffee_name, excerpt)
        if nx:
            score += WEIGHTS["name_in_excerpt"] * nx
            reasons.append(f"'{coffee_name}' in excerpt (×{nx})")
        nb = _word_boundary_count(coffee_name, body_plain)
        if nb:
            score += WEIGHTS["name_in_body"] * nb
            reasons.append(f"'{coffee_name}' in body (×{nb})")

    # Signal B — varietal match. The catalog's varietal field
    # carries terms like "SLN 9", "Chandragiri", "Kent" — these are
    # genuine specialty-coffee tokens that often appear in articles
    # discussing varietals.
    if varietal and varietal.lower() not in ("multi-cultivar", "multi-varietal", "blended varietals"):
        if _word_boundary_count(varietal, body_plain):
            score += WEIGHTS["varietal_in_body"]
            reasons.append(f"varietal '{varietal}' in body")
        if _word_boundary_count(varietal, tags_blob):
            score += WEIGHTS["varietal_in_tags"]
            reasons.append(f"varietal '{varietal}' in tags")

    # Signal C — origin/region match. Many catalogs have generic
    # "Multi-estate" — skip those (no signal). Specific origins
    # like "Ratnagiri Estate", "St. Joseph Estate" carry signal.
    if origin and origin.lower() not in ("multi-estate", "multi estate", "multiple estates"):
        # Strip "Estate" suffix to widen matching against article
        # text that uses just the place name.
        origin_stem = re.sub(r"\s*estate\s*$", "", origin, flags=re.IGNORECASE).strip()
        for needle in (origin, origin_stem) if origin_stem != origin else (origin,):
            if not needle:
                continue
            if _word_boundary_count(needle, body_plain):
                score += WEIGHTS["origin_in_body"]
                reasons.append(f"origin '{needle}' in body")
                break  # only count one match for origin
        for needle in (origin, origin_stem) if origin_stem != origin else (origin,):
            if not needle:
                continue
            if _word_boundary_count(needle, tags_blob):
                score += WEIGHTS["origin_in_tags"]
                reasons.append(f"origin '{needle}' in tags")
                break

    # Signal D — processing method. Tokens like "anaerobic",
    # "honey", "natural", "washed", "fermented" are common in both
    # catalog rows and articles.
    process_tokens: set[str] = set()
    if process_raw:
        for tok in re.findall(r"[a-zA-Z][a-zA-Z\-]+", process_raw):
            t = tok.lower()
            if len(t) >= 4 and t not in {"with", "from", "using", "their", "their", "fresh", "sun", "raised", "natural", "natural", "dried"}:
                process_tokens.add(t)
    # Hand-curated process keywords (subset — we only want strong signals)
    process_keywords = {"anaerobic", "carbonic", "fermented", "honey", "natural", "washed", "co-fermented", "pulp"}
    relevant_tokens = process_tokens & process_keywords
    if relevant_tokens:
        for tok in relevant_tokens:
            if _word_boundary_count(tok, body_plain):
                score += WEIGHTS["process_in_body"]
                reasons.append(f"process '{tok}' in body")
                break  # one match max
        for tok in relevant_tokens:
            if _word_boundary_count(tok, tags_blob):
                score += WEIGHTS["process_in_tags"]
                reasons.append(f"process '{tok}' in tags")
                break

    # Signal E — topic alignment. Small thematic boost only when
    # the article's topic category loosely fits the product kind.
    topic = (article.get("topic_category") or "").lower()
    fitting_kinds = TOPIC_TO_PRODUCT_KIND.get(topic, set())
    if fitting_kinds and _coffee_kind(product) in fitting_kinds:
        score += WEIGHTS["topic_alignment"]
        reasons.append(f"topic '{topic}' fits coffee kind")

    return score, reasons


def suggest_journal_placements(roaster_slug: str, db) -> list[dict]:
    """For each published article belonging to the roaster, return
    ranked placement suggestions from the roaster's available
    catalog. Each entry shape:

        {
          "article": { id, title, excerpt, image_url, topic_category,
                       tags, published_at, word_count },
          "suggestions": [
            { "product": { product_id, coffee_name, image_url, ... },
              "score": int,
              "reasons": list[str] },
            ...
          ]
        }

    Articles with no suggestions above SCORE_THRESHOLD appear with
    an empty `suggestions` list — the UI displays these as "no
    placement suggested yet" so the roaster sees full coverage.
    """
    articles = db.execute("""
      SELECT id, roaster_slug, title, excerpt, body_html, image_url,
             topic_category, tags, published_at, word_count
      FROM roaster_articles
      WHERE roaster_slug = ? AND published = 1
      ORDER BY published_at DESC, id DESC
    """, (roaster_slug,)).fetchall()
    products = db.execute("""
      SELECT product_id, roaster_slug, coffee_name, varietal, origin,
             process_raw, description_raw, image_url, product_url,
             price_inr, weight_grams, available, tasting_notes,
             flavor_notes, roast_level, bean_type
      FROM products
      WHERE roaster_slug = ? AND available = 1
    """, (roaster_slug,)).fetchall()

    article_dicts = [dict(a) for a in articles]
    product_dicts = [dict(p) for p in products]

    results: list[dict] = []
    for article in article_dicts:
        scored: list[dict] = []
        for product in product_dicts:
            score, reasons = _score_match(article, product)
            if score >= SCORE_THRESHOLD:
                scored.append({
                    "product": product,
                    "score": score,
                    "reasons": reasons,
                })
        scored.sort(key=lambda x: (-x["score"], x["product"]["product_id"]))
        results.append({
            "article": article,
            "suggestions": scored[:MAX_SUGGESTIONS_PER_ARTICLE],
        })
    return results
