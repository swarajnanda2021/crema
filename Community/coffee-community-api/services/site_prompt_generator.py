"""
Per-roaster site prompt generator — runs once per roaster after the
first Haiku enrichment pass.

Why this exists: Haiku is fast and cheap but loses precision compared
to Sonnet on long, varied product pages. The base extraction prompt
is generic across all roasters; without site-specific context, Haiku
keeps re-discovering the same conventions on every run (e.g. "this
roaster always reports altitude in feet — convert to metres",
"flavor notes live in a 'Cuppers Notes' section, not in the body
copy", "single-size variants — weight is in the title text"). A
short prompt addendum captures those quirks so future runs land them
on the first pass.

Cost shape: ONE Sonnet call per roaster, ~8K input + 150 output
tokens with prompt caching, ~$0.03. Triggered after the first
per-roaster enrichment run completes (or when the admin toggles
"Regenerate on next run" on the roaster page). The result lives in
`roaster_profiles.enrichment_prompt_hint` and is visible to the
admin in the same UI panel that triggers regeneration.

Token efficiency tactics:
  • Sample 3-5 representative products from the run, not the whole
    batch. Bias toward variety: bean + non-bean, fully-extracted +
    partially-extracted.
  • Per-sample page-text excerpt capped at 1500 chars (vs. the 12 KB
    Haiku gets for the live extraction). The meta-call only needs
    enough to spot patterns.
  • Per-sample extracted-fields summary as one-line `key=value`
    pairs instead of a JSON dump.
  • Tool-use response with strict schema — single field
    `site_addendum: string` capped at ~600 chars.
  • Prompt caching on the static system message (the 600-token
    instructions block). Back-to-back roaster runs hit the cache.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRAPER_DIR = PROJECT_ROOT / "Scraper"


class SitePromptGeneratorError(RuntimeError):
    """Surfaces to the admin tab as a clear non-fatal warning. Per
    the failure mode contract: meta-call failures leave the hint
    null and let the next run retry. Per-product extraction stays
    unaffected."""


# ── Config ────────────────────────────────────────────────────────

# Haiku-grade extractions are richer when the addendum captures real
# patterns. 5 samples gives Sonnet enough signal to spot conventions
# without inflating cost.
SAMPLE_TARGET = 5
PAGE_TEXT_CAP_PER_SAMPLE = 1500
# Sonnet sees a soft "aim for under 3000 chars" target in the prompt;
# the backend trims at 10000 as a defensive backstop hidden from
# Sonnet. 10K is roughly 1500 words — far enough above the 3K
# target that any output landing under it is the model's natural
# length, not a cap-induced truncation. Most outputs land
# 1000-2500 chars; the 10K backstop only catches outright runaway.
ADDENDUM_MAX_CHARS = 10000
META_MODEL = "claude-sonnet-4-6"
# Output budget tuned to allow ~3K chars comfortably: 3000 chars
# ≈ 750 tokens + ~100 tokens of tool-use wrapper. 2000 max_tokens
# gives Sonnet headroom up to ~8K chars without feeling capped,
# while still preventing pathological 30K runs.
META_MAX_TOKENS = 2000


# ── Tool schema ───────────────────────────────────────────────────

_TOOL = {
    "name": "write_site_addendum",
    "description": (
        "Write a 1-2 paragraph addendum to the base coffee-extraction "
        "system prompt that captures THIS roaster's quirks, conventions, "
        "and patterns. The addendum will be prepended to future "
        "extraction calls for this same roaster only."
    ),
    "input_schema": {
        "type": "object",
        "required": ["site_addendum"],
        "properties": {
            "site_addendum": {
                "type": "string",
                "description": (
                    "Concise terse bullet list. No preamble, no "
                    "padding, no throat-clearing, no summary at the "
                    "end. Each bullet earns its place. Aim for under "
                    "3000 characters total — use the room you need to "
                    "cover the real patterns, but don't pad. Lead "
                    "with the highest-signal patterns:\n"
                    "  • Units used unusually (altitude in feet, weight "
                    "in oz, etc.) and the conversion to apply.\n"
                    "  • Where info is buried that the base prompt "
                    "wouldn't naturally find (e.g. 'flavor notes live "
                    "under a `Cuppers Notes` heading, not in the body').\n"
                    "  • Naming conventions to strip or preserve "
                    "(e.g. 'titles always end in `– Fine Robusta` — "
                    "redundant, strip').\n"
                    "  • Fields that are unreliable / always blank for "
                    "this roaster (e.g. 'producer field is never "
                    "filled — don't search for it').\n"
                    "  • Anything else that would help the extractor "
                    "be both faster and more accurate.\n"
                    "Don't restate the base prompt. Don't invent rules "
                    "from a single example — only patterns that hold "
                    "across the samples. Return an empty string if no "
                    "useful pattern emerged."
                ),
            },
        },
    },
}


_SYSTEM = """\
You are tuning a coffee-product extraction pipeline. Be terse —
bullet list only, no preamble, no padding, no recap, no closing
summary. Each bullet earns its place or gets cut.

You will receive 3-5 sample products from ONE Indian specialty coffee
roaster's online catalog. For each sample you see:
  • The product URL.
  • A trimmed excerpt of the live product page text (what the
    extraction LLM saw).
  • A one-line summary of the structured fields the extraction LLM
    produced from that page.

Your job: write a short addendum to the base extraction system
prompt that captures what's idiosyncratic about THIS roaster — the
conventions, units, layouts, and quirks that would help a future
extraction call land cleaner data on the first try.

Rules:
  • Concrete and specific to this roaster; never restate base-prompt
    rules.
  • Only patterns that hold across MULTIPLE samples — never invent
    rules from one example.
  • Aim for under 3000 characters. Use the room you need to cover
    the real patterns; don't pad to fill it.
  • Bullet format. No prose paragraphs. No ledes. No conclusions.
  • If nothing site-specific emerges across the samples, return an
    empty string and let the base prompt do its job."""


# ── Public entry point ───────────────────────────────────────────

def generate_site_prompt_hint(
    roaster_name: str,
    samples: list[dict],
) -> Optional[str]:
    """Run the Sonnet meta-call. Returns the addendum text, an empty
    string if nothing useful emerged, or None on failure (caller
    should leave the hint null and retry on the next run).

    `samples` is a list of dicts shaped like:
        {
            "product_url": "https://…",
            "page_text": "…",  # trimmed to PAGE_TEXT_CAP_PER_SAMPLE
            "extracted": { "coffee_name": "...", "origin": "...", … },
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

    try:
        client = anthropic.Anthropic(max_retries=2)
        # Prompt caching: mark the system block as cacheable so back-
        # to-back runs on different roasters reuse the static
        # instructions. The user message changes per call (sample
        # data) and stays uncached.
        resp = client.messages.create(
            model=META_MODEL,
            max_tokens=META_MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "write_site_addendum"},
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception:
        # Per the failure-mode contract: any Sonnet hiccup leaves the
        # hint null and the next run retries. Don't crash the parent
        # enrichment job.
        return None

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            input_dict = getattr(block, "input", {}) or {}
            addendum = (input_dict.get("site_addendum") or "").strip()
            if not addendum:
                return ""
            # Trim defensively — schema description says 600 but
            # Sonnet sometimes overshoots.
            return addendum[:ADDENDUM_MAX_CHARS]
    return None


# ── Helpers ───────────────────────────────────────────────────────

def _build_user_content(roaster_name: str, samples: list[dict]) -> str:
    """Format samples as a compact text block. One sample per chunk:
    URL + excerpt + extracted-field summary. Page-text excerpt is
    pre-trimmed by the caller (we cap defensively here too)."""
    parts = [f"ROASTER: {roaster_name}", ""]
    for i, sample in enumerate(samples, start=1):
        url = sample.get("product_url") or "(no url)"
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
    """One-line `key=value` per non-null field. Compact compared to
    JSON dump (~3x fewer tokens for the same payload), still
    readable for the model."""
    if not extracted:
        return "(no fields extracted)"
    keys = [
        "is_coffee_bean",
        "coffee_name_clean",
        "coffee_name",
        "origin",
        "altitude_masl",
        "roast_level",
        "roast_level_name",
        "process_raw",
        "process",
        "varietal",
        "bean_type",
        "weight_grams",
        "producer",
        "tasting_notes",
        "flavor_notes",
        "roaster_blurb",
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
        # Truncate long values — addendum-generation only needs to
        # see whether the field landed cleanly, not the full prose.
        if len(v_str) > 200:
            v_str = v_str[:200] + "…"
        lines.append(f"  {k} = {v_str}")
    return "\n".join(lines) if lines else "(all fields empty)"


def pick_samples(products: list[dict], target: int = SAMPLE_TARGET) -> list[dict]:
    """Pick a representative subset for the meta-call.

    Bias toward variety: prefer products where extraction landed the
    most fields (high signal), but include at least one that's
    sparse / failed so the addendum can also speak to common
    failure modes.

    `products` are scraped+enriched dicts — same shape `_enrich_one`
    returned. Each must carry at least `product_url` and the LLM
    fields. Caller is responsible for re-fetching `page_text` for
    each sample (we don't store live page text anywhere).
    """
    if not products:
        return []
    # Score by extraction completeness — count non-empty key fields.
    scored = []
    for p in products:
        score = sum(
            1
            for k in ("origin", "altitude_masl", "process_raw", "varietal",
                      "tasting_notes", "roaster_blurb", "weight_grams",
                      "producer", "bean_type")
            if p.get(k)
        )
        scored.append((score, p))
    # Sort highest-signal first; take top (target-1), then add one
    # sparse one if available so the addendum sees a failure mode.
    scored.sort(key=lambda t: -t[0])
    picks = [p for _, p in scored[: max(1, target - 1)]]
    if len(scored) >= target and scored[-1][0] < scored[0][0]:
        picks.append(scored[-1][1])
    seen_urls = set()
    deduped = []
    for p in picks:
        url = p.get("product_url")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        deduped.append(p)
    return deduped[:target]
