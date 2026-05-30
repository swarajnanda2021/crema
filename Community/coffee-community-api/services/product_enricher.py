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
    """RETIRED as of 2026-05-26.

    v1 product enrichment is removed. It coexisted with the v2 stack
    (services/page_fetcher + entity_enricher + entity_reenricher +
    entity_upserter) and the orchestrator's choice between them was
    stochastic — the 2026-05-25 full sweep landed on v1, which is why
    that pass introduced 149 denorm_drift rows, +67 silent_empties,
    and only healed 2 of 56 missing images. v1 used a different
    roaster_name lookup than v2's canonical resolution; it didn't
    have the image picker, Rs/INR price regex, brand-strip, Wix
    dropdown click, or Shopify noise-tag filter.

    Eliminating the choice. Every product enrichment goes through v2.

    Callers that hit this method (services.scrape_runner's per-product
    loop, services.catalog_ops's proposal-apply, the
    /admin/proposals/{id}/apply route) will fail loudly with this
    error — that surfaces to crema_enrich_all / crema_enrich_roaster /
    crema_onboard_roaster's BG job log as a 503-class failure.

    To enrich products, use:
      • `crema_bulk_reenrich_roaster(slug)` — catalog-wide per roaster
      • `crema_reenrich_product(product_id)` — single row

    Both go through services.entity_reenricher.reenrich_one_product
    (v2). Bio + article enrichment have their own paths
    (services.roaster_enricher, services.article_enricher) and are
    unaffected by this retirement.
    """
    raise ProductEnricherError(
        "v1 services.product_enricher.enrich_product is RETIRED "
        "(2026-05-26). Use crema_bulk_reenrich_roaster(slug) or "
        "crema_reenrich_product(product_id) — both go through the v2 "
        "stack via services.entity_reenricher. v1 / v2 coexistence "
        "produced stochastic routing; eliminating the choice."
    )
