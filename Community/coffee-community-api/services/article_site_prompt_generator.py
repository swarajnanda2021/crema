"""
Per-roaster article-extraction site prompt generator — runs once per
roaster after the first Haiku-enriched article landed, generating a
short site-quirk addendum prepended to future `enrich_article` calls.

Why a parallel pipeline (vs. reusing services/site_prompt_generator):
the bean enricher's hint captures product-page conventions (units,
flavor-note headings, weight extraction). Articles need a different
kind of context — footer noise the bs4 strip didn't catch, infographic-
driven bodies that look short but ARE the content, stale `<img src>`
URL forms specific to this roaster's CDN, recurring section
delimiters that should NOT be treated as h2/h3, date formatting
quirks. The two hints don't overlap, and conflating them in one
column would force every future change to reason about both
extraction passes at once.

Cost shape: ONE Sonnet call per roaster, ~8K input + ~200 output
tokens with prompt caching, ~$0.03. Triggered automatically at the
end of `run_article_scrape_job` when the roaster has ≥1 enriched
article AND `article_enrichment_prompt_hint IS NULL` (or the
admin set `regenerate_article_hint=True` in the job body).

Failure mode contract: any Sonnet hiccup leaves the hint null and
the next run retries. Per-article extraction stays unaffected.
"""

from __future__ import annotations

import os
from typing import Optional


# ── Config ────────────────────────────────────────────────────────

# 5 samples gives Sonnet enough variety to spot real conventions
# without inflating cost. Bias toward enrichment-completeness so the
# meta-call sees what GOOD extractions look like, with one sparse
# sample to surface failure modes (footer noise, missing hero image,
# weird date formats, etc.).
SAMPLE_TARGET = 5
PAGE_TEXT_CAP_PER_SAMPLE = 1500
ADDENDUM_MAX_CHARS = 10_000
META_MODEL = "claude-haiku-4-5-20251001"
# Tuned to allow ~3K-char addendums without truncation; same shape
# as services/site_prompt_generator.py.
META_MAX_TOKENS = 2000


class ArticleSitePromptGeneratorError(RuntimeError):
    """Surfaces to the admin tab as a non-fatal warning. Per the
    failure-mode contract, meta-call failures leave the hint null
    and the next run retries."""


# ── Tool schema ───────────────────────────────────────────────────

_TOOL = {
    "name": "write_article_site_addendum",
    "description": (
        "Write a 1-2 paragraph addendum to the base article-extraction "
        "system prompt that captures THIS roaster's blog/journal "
        "quirks. The addendum will be prepended to future "
        "extract_roaster_article calls for this same roaster only."
    ),
    "input_schema": {
        "type": "object",
        "required": ["site_addendum"],
        "properties": {
            "site_addendum": {
                "type": "string",
                "description": (
                    "Concise terse bullet list. No preamble, no "
                    "padding, no throat-clearing, no closing summary. "
                    "Each bullet earns its place. Aim for under 3000 "
                    "characters. Lead with the highest-signal "
                    "patterns:\n"
                    "  • Footer / nav / sidebar text that bs4's "
                    "strip pass missed and Haiku keeps absorbing into "
                    "body_html (e.g. 'every article ends with a "
                    "Subscribe-to-newsletter block — drop everything "
                    "after the line `Stay in touch`').\n"
                    "  • Whether the roaster's articles are "
                    "infographic-driven (the meaningful content is a "
                    "single hero JPG and the body text is just 1-2 "
                    "paragraphs surrounding it) — Haiku should "
                    "preserve those short bodies rather than treat "
                    "them as failed extractions.\n"
                    "  • Recurring section delimiters that should NOT "
                    "become h2/h3 (e.g. '— — — — —' separators, ASCII "
                    "art).\n"
                    "  • Stale `<img src>` URL forms (HTTP-vs-HTTPS, "
                    "www-vs-bare, CDN host mismatches) that need "
                    "rewriting to absolute https URLs.\n"
                    "  • Date formats unique to this roaster (e.g. "
                    "'Posted 4th Apr, 2024' instead of ISO).\n"
                    "  • Convention drift on titles — leading "
                    "category labels, repeated site-name suffixes, "
                    "trailing ' | Roaster Name' that the base prompt "
                    "already strips but the roaster nests double "
                    "(e.g. 'Origins | Story | Roaster Name').\n"
                    "  • Any field that's reliably absent across all "
                    "samples (e.g. 'never has og:image — fall back "
                    "to first body image, the bs4 candidate is "
                    "reliable here').\n"
                    "Don't restate base-prompt rules. Don't invent "
                    "rules from a single example — only patterns that "
                    "hold across multiple samples. Return an empty "
                    "string if no useful pattern emerged."
                ),
            },
        },
    },
}


_SYSTEM = """\
You are tuning an article-extraction pipeline for a coffee-discovery
app. Be terse — bullet list only, no preamble, no padding, no recap,
no closing summary. Each bullet earns its place or gets cut.

You will receive 3-5 sample articles from ONE Indian specialty coffee
roaster's blog/journal. For each sample you see:
  • The article URL.
  • A trimmed excerpt of the live page text (what the extraction LLM
    saw).
  • A one-line summary of the structured fields the extraction LLM
    produced from that page (title, hero image, word_count, topic
    category, etc.).

Your job: write a short addendum to the base article-extraction
system prompt that captures what's idiosyncratic about THIS roaster
— the footer noise, infographic conventions, stale URL forms, date
formats, and quirks that would help a future extraction call land
cleaner data on the first try.

Rules:
  • Concrete and specific to THIS roaster; never restate base-prompt
    rules.
  • Only patterns that hold across MULTIPLE samples — never invent
    rules from one example.
  • Aim for under 3000 characters. Use the room you need to cover
    the real patterns; don't pad to fill it.
  • Bullet format. No prose paragraphs. No ledes. No conclusions.
  • If nothing site-specific emerges across the samples, return an
    empty string and let the base prompt do its job."""


# ── Public entry point ───────────────────────────────────────────


def generate_article_site_prompt_hint(
    roaster_name: str,
    samples: list[dict],
) -> Optional[str]:
    """Run the Sonnet meta-call. Returns the addendum text, an empty
    string if nothing useful emerged, or None on failure (caller
    should leave the hint null and retry on the next run).

    `samples` is a list of dicts shaped like:
        {
            "article_url": "https://…",
            "page_text": "…",  # trimmed to PAGE_TEXT_CAP_PER_SAMPLE
            "extracted": {
                "title": "...",
                "image_url": "...",
                "word_count": 123,
                "topic_category": "sourcing_story",
                "is_about_coffee": True,
                "tags": ["ethiopia", "natural-process"],
            },
        }

    Caller is responsible for sample selection — this function just
    formats and dispatches.
    """
    if not samples:
        return None
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None

    try:
        import anthropic
    except ImportError:
        return None

    user_content = _build_user_content(roaster_name, samples)

    # Routed through services.llm_router (SDK or queue per provider).
    # Prompt caching: cache_control on the system block keeps the
    # static rules hot across back-to-back per-roaster runs. The
    # queue path serialises the list to a joined string —
    # cache_control is SDK-only.
    from services.llm_router import call_llm
    try:
        input_dict = call_llm(
            step="journal_hint",
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tool=_TOOL,
            user_content=user_content,
            max_tokens=META_MAX_TOKENS,
            model=META_MODEL,
        ) or {}
    except Exception:
        # Per the failure-mode contract: any LLM hiccup leaves the
        # hint null and the next run retries. Don't crash the parent
        # article scrape job.
        return None

    addendum = (input_dict.get("site_addendum") or "").strip()
    if not addendum:
        return ""
    return addendum[:ADDENDUM_MAX_CHARS]


# ── Helpers ───────────────────────────────────────────────────────


def _build_user_content(roaster_name: str, samples: list[dict]) -> str:
    """Format samples as a compact text block. One sample per chunk:
    URL + excerpt + extracted-field summary."""
    parts = [f"ROASTER: {roaster_name}", ""]
    for i, sample in enumerate(samples, start=1):
        url = sample.get("article_url") or "(no url)"
        page = (sample.get("page_text") or "").strip()
        if len(page) > PAGE_TEXT_CAP_PER_SAMPLE:
            page = page[:PAGE_TEXT_CAP_PER_SAMPLE] + "…"
        extracted = sample.get("extracted") or {}
        parts.append(f"── SAMPLE {i} ──")
        parts.append(f"URL: {url}")
        parts.append("")
        parts.append("PAGE TEXT EXCERPT:")
        parts.append(page if page else "(no page text)")
        parts.append("")
        parts.append("EXTRACTED FIELDS:")
        parts.append(_format_extracted(extracted))
        parts.append("")
    parts.append(
        "Now write the site-specific addendum. Lead with patterns "
        "that hold across multiple samples; skip anything you only "
        "saw once."
    )
    return "\n".join(parts)


def _format_extracted(extracted: dict) -> str:
    """One-line `key=value` per non-null field. Same compact shape
    as services/site_prompt_generator._format_extracted."""
    if not extracted:
        return "(no fields extracted)"
    keys = [
        "title",
        "summary",
        "image_url",
        "word_count",
        "published_at",
        "topic_category",
        "is_about_coffee",
        "tags",
        "enrichment_status",
    ]
    lines = []
    for k in keys:
        if k not in extracted:
            continue
        v = extracted[k]
        if v is None or v == "" or v == [] or v == {}:
            continue
        if isinstance(v, (list, dict)):
            import json
            v_str = json.dumps(v, ensure_ascii=False)
        else:
            v_str = str(v)
        if len(v_str) > 200:
            v_str = v_str[:200] + "…"
        lines.append(f"  {k} = {v_str}")
    return "\n".join(lines) if lines else "(all fields empty)"


def pick_samples(articles: list[dict],
                 target: int = SAMPLE_TARGET) -> list[dict]:
    """Pick a representative subset for the meta-call.

    Bias toward variety: prefer articles where extraction landed the
    most fields (high signal), but include at least one sparse one
    so the addendum can speak to failure modes.

    `articles` are scraped+enriched dicts in the shape Layer B's
    runner pulls from the DB: each must carry `url`, `title`,
    `image_url`, `word_count`, `topic_category`, `is_about_coffee`,
    `tags`, `enrichment_status`. The runner is responsible for
    re-fetching `page_text` for each pick — we don't store live
    page text anywhere."""
    if not articles:
        return []
    scored = []
    for a in articles:
        score = sum(
            1
            for k in ("title", "summary", "image_url", "word_count",
                      "published_at", "topic_category", "tags")
            if a.get(k)
        )
        scored.append((score, a))
    scored.sort(key=lambda t: -t[0])
    picks = [a for _, a in scored[: max(1, target - 1)]]
    if len(scored) >= target and scored[-1][0] < scored[0][0]:
        picks.append(scored[-1][1])
    seen_urls = set()
    deduped = []
    for a in picks:
        url = a.get("url") or a.get("article_url")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        deduped.append(a)
    return deduped[:target]
