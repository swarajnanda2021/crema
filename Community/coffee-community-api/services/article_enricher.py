"""
Per-article Haiku enrichment for Discover JOURNALS.

Wraps a single Haiku tool-use call that takes the bs4-cleaned page
text + og: hints + the article URL and returns a structured payload:

    {
      "is_article":     bool,           # gate — false rejects the URL
      "title":          str,
      "body_html":      str,            # clean structured HTML
      "image_url":      Optional[str],  # hero (preferred over og:image)
      "published_at":   Optional[str],  # ISO 8601 if extractable
      "word_count":     int,
    }

The Figma 801:155 article-card design (title + parent-domain + hero
image only) doesn't render any per-article excerpt, so the prior
`summary` field was dropped from this schema — Haiku doesn't spend
output tokens on a 1-2 sentence summary the UI never shows. The
scraper's stub/og:description excerpt still lands in
`roaster_articles.excerpt` as a robustness fallback for the
article reader when body_html parsing failed.

Why Haiku instead of the bs4 body extraction:

  * bs4 selectors over-match on Shopify themes (sidebars, recommended-
    article rails, footer "subscribe" CTAs) and under-match on custom
    sites with no <article> tag.
  * Haiku reads structure from semantics — it knows where the article
    body ENDS even when the surrounding markup doesn't say so.
  * Haiku rewrites to a clean HTML subset (h2/h3, p, ul/ol/li,
    blockquote, img) that maps 1:1 to the consumer reader's
    `htmlToBlocks` walker. No inline tags survive, so the renderer
    never has to handle stray <span>/<font>/<style="..."> noise.
  * Haiku also picks the hero image even when og:image is missing or
    points to a generic logo — it understands that "the first
    600+ px image inside the body" is the right hero.

Latency + cost: ~3-5s per article, ~$0.01 each at Haiku 4.5 prices
(~5K input + ~1.5K output tokens). For a roaster with 30 articles
that's ~$0.30 + ~3 minutes; comparable to the per-product enrichment
budget.

Failure mode: returns `None`. Caller (run_article_scrape_job) keeps
the bs4 body as a fallback and stamps `enrichment_status='failed'`
so the admin can see which articles need a re-enrich.
"""

from __future__ import annotations

import os
from typing import Optional


MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 4000

# Page text gets clipped to keep input cost bounded. 16K characters
# is roughly 4-5K tokens — enough for a long sourcing-story article
# (~3000 words of body + some surrounding markup) without burning
# tokens on full archived blog landings.
PAGE_TEXT_LIMIT = 16_000


class ArticleEnricherError(RuntimeError):
    """Surfaces to the admin tab as a clear 503 / 422."""


# ── Tool schema ────────────────────────────────────────────────────────────


# Topic taxonomy — locked. New buckets require a schema migration AND
# a system-prompt update. Don't extend ad-hoc; the consumer JOURNALS
# tab and admin badges both group by these values.
TOPIC_CATEGORIES = (
    "sourcing_story", "brew_guide", "origin_profile", "industry_news",
    "harvest_report", "tasting_notes", "company_update", "other",
)


_ARTICLE_TOOL = {
    "name": "extract_roaster_article",
    "description": (
        "Extract the canonical content of a roaster's blog/journal "
        "article from the page text + URL + Open Graph hints provided. "
        "Return clean structured HTML that strips navigation, footers, "
        "subscribe widgets, recommended-article rails, comment forms, "
        "and any other non-article chrome. Only include content "
        "actually present in the source — never fabricate. Also gate "
        "the page on whether it's actually about coffee (sourcing, "
        "brewing, origins, processing, café culture, roasting, "
        "tasting) — coffee-roaster sites also host founder bios, "
        "lifestyle/spirituality essays, and team pages, which we "
        "don't want surfacing in a coffee-discovery feed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "is_article": {
                "type": "boolean",
                "description": (
                    "False if the URL is NOT an article — e.g. it's a "
                    "category landing page, a tag index, the blog home, "
                    "an empty placeholder, a product listing that the "
                    "scraper mis-classified, or a 'page not found' "
                    "fallback. When false, the other fields can be "
                    "omitted; the scraper will skip the URL."
                ),
            },
            "is_about_coffee": {
                "type": "boolean",
                "description": (
                    "True only if the article's primary subject is "
                    "coffee — sourcing trips, brewing techniques, "
                    "origin profiles, harvest reports, processing, "
                    "café culture, roasting, tasting notes, or "
                    "company updates that mention beans/equipment/"
                    "roastery operations. False for: founder/team "
                    "biographies (even on a coffee site), wellness/"
                    "spirituality/lifestyle essays, café-event recaps "
                    "with no coffee content, generic motivation/"
                    "philosophy posts, product-page boilerplate that "
                    "leaked into a blog handle. When false, the "
                    "scraper still writes the row but hides it from "
                    "consumers — admin can override if Haiku is wrong. "
                    "Default to True only when the article clearly "
                    "talks about coffee; when in doubt, return False."
                ),
            },
            "topic_category": {
                "type": "string",
                "enum": list(TOPIC_CATEGORIES),
                "description": (
                    "One of the eight fixed categories. Pick the "
                    "best-fit single label; use 'other' only when "
                    "none of the seven specific buckets fit. "
                    "'sourcing_story' = trips to origins / farmer "
                    "profiles / supply-chain stories. 'brew_guide' = "
                    "how-to-brew / equipment guides / extraction "
                    "tutorials. 'origin_profile' = country/region/"
                    "varietal deep-dives. 'industry_news' = market "
                    "shifts, certifications, regulation, climate. "
                    "'harvest_report' = year-specific crop / season "
                    "summaries. 'tasting_notes' = cupping notes, "
                    "flavor breakdowns. 'company_update' = launches, "
                    "milestones, store openings, team news that's "
                    "tied to coffee. Required when is_about_coffee=true; "
                    "may be omitted otherwise."
                ),
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "3-7 lowercase keyword tags drawn from THIS "
                    "article's content. Used for sitewide search. "
                    "Examples: ['ethiopia','natural-process','pour-over',"
                    "'single-origin'], ['arabica','robusta','blends',"
                    "'estate'], ['western-ghats','smallholder',"
                    "'shade-grown']. Style: lowercase, hyphenated "
                    "multi-word terms, no leading '#'. Avoid generic "
                    "tags like 'coffee', 'specialty', 'india' — every "
                    "article on this platform is about Indian "
                    "specialty coffee, so they're noise. Prefer "
                    "concrete proper nouns (origin regions, varietals, "
                    "processing methods, brew gear, café names) over "
                    "abstract themes. Required when is_about_coffee="
                    "true; may be empty when is_about_coffee=false."
                ),
            },
            "title": {
                "type": "string",
                "description": (
                    "The article title as the roaster wrote it. Strip "
                    "site-name suffixes ('Article Title | Roaster Name' "
                    "→ 'Article Title'). Prefer the og:title hint when "
                    "it's clearly the article title; fall back to the "
                    "first <h1> in the body."
                ),
            },
            "body_html": {
                "type": "string",
                "description": (
                    "Clean structured HTML of the article body. Use "
                    "ONLY these tags: <h2>, <h3>, <p>, <ul>, <ol>, "
                    "<li>, <blockquote>, <img>, <hr>. No inline "
                    "styling, no <span>, <strong>, <em>, <a>, <div>, "
                    "<table>, <iframe>, or any class/id/style "
                    "attributes. Preserve paragraph breaks. Inline "
                    "images stay as <img src=\"absolute-url\" "
                    "alt=\"...\">. Drop anything that isn't article "
                    "body — nav, footer, sidebar, related posts, "
                    "subscribe CTAs, comment forms, share buttons."
                ),
            },
            "image_url": {
                "type": "string",
                "description": (
                    "Absolute URL of the article's hero image. Prefer "
                    "the og:image hint when it's an article-specific "
                    "photo; otherwise pick the first prominent image "
                    "(>=600px wide if known) inside the article body. "
                    "Return null if no suitable hero exists."
                ),
            },
            "published_at": {
                "type": "string",
                "description": (
                    "ISO 8601 publish date (e.g. '2026-04-15T00:00:00Z' "
                    "or '2026-04-15'). Pull from og:article:published_time, "
                    "<time datetime=...>, or in-body 'Posted on...' "
                    "lines. Return null if the page doesn't carry a date."
                ),
            },
            "word_count": {
                "type": "integer",
                "description": (
                    "Approximate word count of the body_html (count "
                    "the words, not the markup). Used by the reader to "
                    "show estimated reading time."
                ),
            },
        },
        "required": ["is_article"],
    },
}


_ARTICLE_SYSTEM = (
    "You extract roaster blog/journal articles from raw page text. "
    "These articles surface in a coffee-discovery app called Crema "
    "for specialty-coffee drinkers. Acceptable subjects: sourcing "
    "trips, processing techniques, brew guides, harvest reports, "
    "origin profiles, café culture, roasting, tasting notes, "
    "industry news, and company updates that mention beans / "
    "equipment / roastery operations.\n\n"
    "REJECT pages that aren't ABOUT coffee, even when they're hosted "
    "on a coffee-roaster's site:\n"
    "  • Founder / team / staff biographies (look for /blogs/team/ "
    "    or 'Meet the founder' framing).\n"
    "  • Philosophical, spiritual, or wellness essays (commune "
    "    explanations, meditation guides, Tibetan Pulsing, Osho "
    "    references — these turn up on roaster sites whose owners "
    "    blog broadly).\n"
    "  • General lifestyle posts with no coffee subject.\n"
    "  • Café-event recaps that focus on attendees rather than "
    "    coffee.\n"
    "  • Shopify product-page boilerplate that bled into a blog "
    "    handle (page text dominated by 'Taxes included', 'Add to "
    "    cart', shipping disclaimers — these are misclassified "
    "    discovery hits).\n\n"
    "For every page set both gates:\n"
    "  • `is_article` = whether the URL is a real article at all "
    "    (false = category landing, 404, product listing, empty "
    "    placeholder; the scraper skips these without writing a row).\n"
    "  • `is_about_coffee` = whether the article is on-topic for a "
    "    coffee app (false = founder bio, wellness essay, etc.; the "
    "    scraper writes the row hidden from consumers, admin can "
    "    override). When in doubt, return False — the consumer feed "
    "    is the cost of a false positive.\n\n"
    "Also classify the topic and emit search tags. `topic_category` "
    "is one of the eight fixed buckets (sourcing_story, brew_guide, "
    "origin_profile, industry_news, harvest_report, tasting_notes, "
    "company_update, other). `tags` is 3-7 concrete keyword tags "
    "drawn from the article — origin regions, varietals, processing "
    "methods, brew gear, café names — never generic terms like "
    "'coffee' or 'india'.\n\n"
    "Your output goes into a consumer-facing 'Journals' feed and an "
    "in-app reader, so cleanliness matters: strip every chrome "
    "element (nav, footer, sidebar, recommended-article rails, "
    "subscribe boxes, comment forms, share buttons, breadcrumbs, "
    "author-bio cards), keep only the article body itself.\n\n"
    "Output HTML uses a strict subset of tags (h2, h3, p, ul, ol, li, "
    "blockquote, img, hr). NO inline tags (no span, strong, em, a, "
    "div, table, iframe). NO class/id/style attributes. NO inline "
    "styling. Paragraphs are bare <p>...</p>. The reader walks this "
    "HTML and renders each tag as a native primitive — anything "
    "outside the subset gets dropped, so don't bother emitting it.\n\n"
    "Use the `extract_roaster_article` tool. Set `is_article=false` "
    "and omit other fields when the URL is clearly not an article "
    "(category landing, blog home, product listing, 404, empty "
    "placeholder)."
)


# ── Public entry point ─────────────────────────────────────────────────────


def enrich_article(
    *,
    url: str,
    page_text: str,
    og_title: Optional[str] = None,
    og_description: Optional[str] = None,
    og_image: Optional[str] = None,
    og_published_at: Optional[str] = None,
    system_addendum: Optional[str] = None,
) -> Optional[dict]:
    """Run Haiku over a single fetched article page, return the
    structured payload. Returns None on any caller-tolerable failure
    (transient API error, missing key, parse failure) so the runner
    can fall back to bs4 extraction.

    `system_addendum` (Layer B) is a per-roaster site-quirk hint — a
    short addendum prepended to the static system prompt that tells
    Haiku about THIS roaster's conventions (footer noise the bs4
    strip missed, infographic-driven bodies, stale `<img src>` URL
    forms, etc.). The runner threads `roaster_profiles
    .article_enrichment_prompt_hint` through here.

    Raises `ArticleEnricherError` only for setup failures we want to
    surface upstream (no SDK installed) — the runner short-circuits
    those across the whole job rather than retrying per-article.
    """
    if not url or not page_text:
        return None

    if not os.environ.get("ANTHROPIC_API_KEY"):
        # Don't raise — articles can still be scraped + stored from
        # the bs4 fallback even without Haiku. The runner stamps
        # enrichment_status='pending' for downstream re-enrich.
        return None

    try:
        import anthropic
    except ImportError as e:
        raise ArticleEnricherError(
            "anthropic SDK isn't installed. `pip install anthropic` in "
            "the FastAPI server's Python env."
        ) from e

    truncated = page_text[:PAGE_TEXT_LIMIT]
    if len(page_text) > PAGE_TEXT_LIMIT:
        truncated = truncated + "\n\n[...truncated, full body continues...]"

    user_content = (
        f"ARTICLE URL: {url}\n\n"
        f"OG:TITLE (hint): {og_title or '(none)'}\n"
        f"OG:DESCRIPTION (hint): {og_description or '(none)'}\n"
        f"OG:IMAGE (hint): {og_image or '(none)'}\n"
        f"OG:PUBLISHED_TIME (hint): {og_published_at or '(none)'}\n\n"
        f"CLEANED PAGE TEXT (nav/header/footer/script stripped, "
        f"first {PAGE_TEXT_LIMIT} chars):\n"
        f"---\n{truncated}\n---"
    )

    # Site-quirk addendum prepended to the static system prompt as a
    # SECOND cacheable block — keeps the static base block hot across
    # all roasters and lets the per-roaster addendum land separately.
    if system_addendum and system_addendum.strip():
        system_param = [
            {
                "type": "text",
                "text": _ARTICLE_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": (
                    "SITE-SPECIFIC NOTES for this roaster (overrides "
                    "where they conflict with the base prompt):\n"
                    + system_addendum.strip()
                ),
            },
        ]
    else:
        system_param = _ARTICLE_SYSTEM

    client = anthropic.Anthropic(max_retries=2)
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_param,
            tools=[_ARTICLE_TOOL],
            tool_choice={"type": "tool", "name": "extract_roaster_article"},
            messages=[{"role": "user", "content": user_content}],
        )
    except anthropic.APIError:
        # Transient — caller falls back to bs4 + stamps 'failed'.
        return None

    for block in resp.content:
        if block.type == "tool_use":
            payload = block.input  # type: ignore[attr-defined]
            if isinstance(payload, dict):
                return _normalise(payload)
            return None
    return None


def _normalise(raw: dict) -> dict:
    """Coerce nullable string fields and clamp word_count."""
    out = {
        "is_article": bool(raw.get("is_article", True)),
        # is_about_coffee defaults to True so legacy callers that
        # haven't been updated still get a no-op gate. New runners
        # treat the field as authoritative.
        "is_about_coffee": bool(raw.get("is_about_coffee", True)),
        "topic_category": _clean_topic(raw.get("topic_category")),
        "tags": _clean_tags(raw.get("tags")),
        "title": _clean_str(raw.get("title")),
        "body_html": _clean_str(raw.get("body_html")),
        "image_url": _clean_str(raw.get("image_url")),
        "published_at": _clean_str(raw.get("published_at")),
    }
    wc = raw.get("word_count")
    out["word_count"] = (
        max(0, int(wc)) if isinstance(wc, (int, float)) else None
    )
    return out


def _clean_topic(value) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    return v if v in TOPIC_CATEGORIES else None


def _clean_tags(value) -> list[str]:
    """Normalise the `tags` list — lowercase, strip leading '#',
    drop empties + the obvious noise tags, dedupe while preserving
    order, cap at 7. Always returns a list (possibly empty); never
    None — the caller stores it as a JSON array."""
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    noise = {"coffee", "specialty", "specialty-coffee", "india", "indian",
             "blog", "article", "post", "news"}
    for item in value:
        if not isinstance(item, str):
            continue
        v = item.strip().lstrip("#").lower()
        # Replace whitespace with hyphens for two-word tags.
        v = "-".join(v.split())
        if not v or v in seen or v in noise:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= 7:
            break
    return out


def _clean_str(value) -> Optional[str]:
    """Treat empty strings + the literal 'null'/'none' as None — a few
    Haiku turns return string sentinels instead of JSON null."""
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        if v.lower() in ("null", "none", "n/a", "(none)"):
            return None
        return v
    return str(value)
