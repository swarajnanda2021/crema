"""
Per-product Sonnet enrichment, called inline by `stage_scrape_proposals`.

Wraps the existing `Scraper/enrich.py` script's per-product extraction
function (`_enrich_one`) without copying its prompt or tool schema —
they live in one place, mutate together. The wrapper:

  1. Imports `enrich` lazily so the API process boots even when
     `anthropic` isn't installed (admin sees a clear 503).
  2. Calls `enrich._enrich_one(client, product)` per product.
  3. Merges the LLM result back into the scraped product via
     `enrich._merge(product, llm)` — same merge rules the standalone
     batch script uses, so admin-staged proposals look identical to
     what `enrich.py` would have produced offline.

Latency budget: ~5 s per product (Sonnet thinks it through). A 25-row
scrape adds ~2 min on top of the raw HTTP scrape — acceptable for v0.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRAPER_DIR = PROJECT_ROOT / "Scraper"


class ProductEnricherError(RuntimeError):
    """Surfaces to the admin tab as a clear 503 / 422."""


def _import_enrich():
    """Lazy import: only pulls in `enrich.py` (and transitively `anthropic`)
    when the runner actually needs to enrich. Lets the API boot on a host
    that hasn't pip-installed the scraper deps."""
    if str(SCRAPER_DIR) not in sys.path:
        sys.path.insert(0, str(SCRAPER_DIR))
    try:
        import enrich  # type: ignore[import-not-found]
    except ImportError as e:
        raise ProductEnricherError(
            "Couldn't import Scraper/enrich.py — confirm the Scraper "
            "directory exists at repo root and `anthropic` is installed "
            "in the FastAPI server's Python env (`pip install anthropic`)."
        ) from e
    return enrich


def _client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ProductEnricherError(
            "ANTHROPIC_API_KEY is not set. Export it in the shell that "
            "runs the FastAPI server."
        )
    try:
        import anthropic
    except ImportError as e:
        raise ProductEnricherError(
            "anthropic SDK isn't installed. `pip install anthropic`."
        ) from e
    return anthropic.Anthropic(max_retries=3)


def enrich_product(
    product: dict,
    *,
    system_addendum: str | None = None,
) -> Optional[dict]:
    """Run Haiku over a single scraped product, return the enriched dict.

    Returns the merged product (raw + LLM fields) on success, or `None`
    if the LLM call exhausted retries (transient — caller should fall
    back to the raw product and flag enrichment_status='failed').

    Raises `ProductEnricherError` for caller-actionable setup failures
    (no API key, no SDK, no scraper dir) — those shouldn't be silently
    retried per-product; the runner short-circuits and marks every
    proposal `enrichment_status='deferred'` instead.

    `system_addendum`: optional per-roaster prompt addendum (the
    `roaster_profiles.enrichment_prompt_hint` value). When provided,
    it's appended to the base extraction system prompt for THIS
    product so Haiku gets the past site-specific experience for free.
    The merged result also carries the `_page_text` key (private)
    that the runner uses for the post-run meta-prompt sampling
    without re-fetching the live page.
    """
    enrich = _import_enrich()
    client = _client()
    llm_data = enrich._enrich_one(  # noqa: SLF001 — intentional
        client, product, system_addendum=system_addendum,
    )
    if llm_data is None:
        return None
    return enrich._merge(product, llm_data)  # noqa: SLF001 — intentional
