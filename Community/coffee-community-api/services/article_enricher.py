"""
Per-article Haiku enrichment for Discover JOURNAL.

Wraps a single Haiku tool-use call that takes the bs4-cleaned page
text + og: hints + the article URL and returns a structured payload:

    {
      "is_article":     bool,           # gate — false rejects the URL
      "title":          str,
      "summary":        str,            # 1-2 sentences for the feed card
      "body_html":      str,            # clean structured HTML
      "image_url":      Optional[str],  # hero (preferred over og:image)
      "published_at":   Optional[str],  # ISO 8601 if extractable
      "word_count":     int,
    }

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


_ARTICLE_TOOL = {
    "name": "extract_roaster_article",
    "description": (
        "Extract the canonical content of a roaster's blog/journal "
        "article from the page text + URL + Open Graph hints provided. "
        "Return clean structured HTML that strips navigation, footers, "
        "subscribe widgets, recommended-article rails, comment forms, "
        "and any other non-article chrome. Only include content "
        "actually present in the source — never fabricate."
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
            "summary": {
                "type": "string",
                "description": (
                    "1-2 sentence excerpt for the JOURNAL feed card. "
                    "Maximum 280 characters. Pull the opening paragraph "
                    "if the page has a clear lede; otherwise summarise "
                    "the article in the roaster's own voice."
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
    "These are stories about coffee — sourcing trips, processing "
    "techniques, brew guides, harvest reports, café event recaps, "
    "long-form essays. They are NOT product listings, not category "
    "indexes, not contact forms.\n\n"
    "Your output goes into a consumer-facing 'Journal' feed and an "
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
) -> Optional[dict]:
    """Run Haiku over a single fetched article page, return the
    structured payload. Returns None on any caller-tolerable failure
    (transient API error, missing key, parse failure) so the runner
    can fall back to bs4 extraction.

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

    client = anthropic.Anthropic(max_retries=2)
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_ARTICLE_SYSTEM,
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
        "title": _clean_str(raw.get("title")),
        "summary": _clean_str(raw.get("summary")),
        "body_html": _clean_str(raw.get("body_html")),
        "image_url": _clean_str(raw.get("image_url")),
        "published_at": _clean_str(raw.get("published_at")),
    }
    wc = raw.get("word_count")
    out["word_count"] = (
        max(0, int(wc)) if isinstance(wc, (int, float)) else None
    )
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
