"""Mocked-LLM smoke test for entity_enricher.

Patches `call_llm` to return canned payloads matching the shape the
existing _EXTRACT_TOOL + _ARTICLE_TOOL emit, then runs
`enrich_url(...)` and asserts the result is a validated
CanonicalProduct / CanonicalArticle.

No live API calls. Run anytime to verify the adapter + validation
wiring is intact.

    cd Community/coffee-community-api
    python scripts/sanity_check_entity_enricher.py
"""

from __future__ import annotations

import datetime as _dt
import os
import sys
from pathlib import Path
from unittest.mock import patch

_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parent.parent))

# Pretend we have an API key so the early-return guard doesn't fire.
# Direct assignment (not setdefault) because an empty-string env var
# would otherwise leak through and trip the guard.
os.environ["ANTHROPIC_API_KEY"] = "sk-test-mock"

from services.canonical_entity import CanonicalArticle, CanonicalProduct  # noqa: E402
from services.entity_enricher import enrich_url  # noqa: E402


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


PRODUCT_PAYLOAD = {
    "is_coffee_bean": True,
    "coffee_name_clean": "Salawara Estate - Naturals",
    "origin": "Salawara Estate",
    "altitude_masl": 1200,
    "roast_level": "Medium",
    "roast_level_name": "Medium",
    "process_raw": "Natural",
    "tasting_notes": "bright citrus and dark chocolate finish",
    "flavor_notes": ["Citrus", "Dark Chocolate", "Caramel"],
    "varietal": "S795",
    "bean_type": "Arabica",
    "weight_grams": 250,
    "producer": "Mathew family",
    "brew_recommendation": {
        "method": "pour_over",
        "dose_grams": 22,
        "ratio": "1:16",
        "water_temp_celsius": 93,
        "notes": "30s bloom, 3m total brew time",
    },
    "roaster_blurb": (
        "A natural-process Arabica from the Mathew family's Salawara "
        "Estate in Chikmagalur, sun-dried in cherry for 18 days."
    ),
}

ARTICLE_PAYLOAD = {
    "is_article": True,
    "is_about_coffee": True,
    "topic_category": "origins",
    "tags": ["chikmagalur", "natural-process", "s795", "western-ghats"],
    "title": "How Salawara Estate Brings Its Naturals to Market",
    "excerpt": "Discover the 18-day cherry-drying process that defines this Chikmagalur natural.",
    "body_html": "<p>The Mathew family has farmed coffee on Salawara Estate since 1962...</p>",
    "image_url": "https://example.com/salawara-hero.jpg",
    "published_at": "2026-03-15",
    "word_count": 850,
}


def test_product() -> None:
    print("\n[product] mocking call_llm → PRODUCT_PAYLOAD")
    with patch("services.entity_enricher.call_llm", return_value=PRODUCT_PAYLOAD):
        result = enrich_url(
            kind="product",
            url="https://example.com/products/salawara-estate-naturals",
            roaster_slug="example-roaster",
            page_text="...sample page text with enough content for enrichment...",
            hints={
                "title": "Salawara Estate Naturals",
                "image_url": "https://example.com/img/salawara.jpg",
                "price_inr": 650.0,
                "weight_grams": 250,
                "available": True,
                "roaster_name": "Example Roaster",
            },
            scraped_at=_now(),
        )

    assert result is not None, "enrich_url returned None"
    assert isinstance(result, CanonicalProduct), f"wrong type: {type(result)}"
    assert result.coffee_name == "Salawara Estate - Naturals"
    assert result.origin == "Salawara Estate"
    assert result.altitude_masl == 1200
    assert result.bean_type == "Arabica"
    assert result.varietal == "S795"
    assert result.flavor_notes == ["Citrus", "Dark Chocolate", "Caramel"]
    assert result.brew_recommendation is not None
    assert result.brew_recommendation.method == "pour_over"
    assert result.brew_recommendation.ratio == "1:16"
    assert result.extraction_provenance == "haiku"
    assert result.enrichment_status == "enriched"
    assert result.image_url == "https://example.com/img/salawara.jpg"
    assert result.price_inr == 650.0
    print("[product] OK — CanonicalProduct validated, all fields correct")


def test_article() -> None:
    print("\n[article] mocking call_llm → ARTICLE_PAYLOAD")
    with patch("services.entity_enricher.call_llm", return_value=ARTICLE_PAYLOAD):
        result = enrich_url(
            kind="article",
            url="https://example.com/blogs/news/salawara-estate-naturals",
            roaster_slug="example-roaster",
            page_text="...full article body with paragraphs about the estate...",
            hints={
                "og_title": "Salawara Estate Naturals — Origin Story",
                "og_description": "Inside the Mathew family's natural-process program.",
                "og_image": "https://example.com/og/salawara.jpg",
                "og_published_at": "2026-03-15",
            },
            scraped_at=_now(),
        )

    assert result is not None, "enrich_url returned None"
    assert isinstance(result, CanonicalArticle), f"wrong type: {type(result)}"
    assert result.title == "How Salawara Estate Brings Its Naturals to Market"
    assert result.topic_category == "origins"
    assert result.tags == ["chikmagalur", "natural-process", "s795", "western-ghats"]
    assert result.is_about_coffee is True
    assert result.published is True  # mirrors is_about_coffee
    assert result.published_at == "2026-03-15"
    assert result.word_count == 850
    assert result.extraction_provenance == "haiku"
    print("[article] OK — CanonicalArticle validated, all fields correct")


def test_site_hinted_provenance() -> None:
    print("\n[provenance] system_addendum → 'haiku_site_hinted'")
    with patch("services.entity_enricher.call_llm", return_value=PRODUCT_PAYLOAD):
        result = enrich_url(
            kind="product",
            url="https://example.com/products/x",
            roaster_slug="example-roaster",
            page_text="page text",
            hints={"title": "X"},
            scraped_at=_now(),
            system_addendum="This roaster lists altitudes in feet — convert.",
        )
    assert result is not None
    assert result.extraction_provenance == "haiku_site_hinted"
    print("[provenance] OK — site_addendum sets provenance correctly")


def test_gate_rejection() -> None:
    print("\n[gate] is_coffee_bean=False → returns None")
    payload = dict(PRODUCT_PAYLOAD, is_coffee_bean=False)
    with patch("services.entity_enricher.call_llm", return_value=payload):
        result = enrich_url(
            kind="product",
            url="https://example.com/products/barista-workshop",
            roaster_slug="example-roaster",
            page_text="page text",
            hints={"title": "Barista Workshop"},
            scraped_at=_now(),
        )
    assert result is None, f"expected None, got {result}"
    print("[gate] OK — non-bean rejected")

    payload = dict(ARTICLE_PAYLOAD, is_article=False)
    with patch("services.entity_enricher.call_llm", return_value=payload):
        result = enrich_url(
            kind="article",
            url="https://example.com/category/news",
            roaster_slug="example-roaster",
            page_text="page text",
            hints={},
            scraped_at=_now(),
        )
    assert result is None, f"expected None, got {result}"
    print("[gate] OK — non-article rejected")


def test_off_topic_article() -> None:
    print("\n[off-topic] is_about_coffee=False → published=False")
    payload = dict(ARTICLE_PAYLOAD, is_about_coffee=False, topic_category=None)
    with patch("services.entity_enricher.call_llm", return_value=payload):
        result = enrich_url(
            kind="article",
            url="https://example.com/blogs/news/founder-bio",
            roaster_slug="example-roaster",
            page_text="page text",
            hints={},
            scraped_at=_now(),
        )
    assert result is not None
    assert isinstance(result, CanonicalArticle)
    assert result.is_about_coffee is False
    assert result.published is False
    print("[off-topic] OK — off-topic landed as published=False")


def main() -> int:
    test_product()
    test_article()
    test_site_hinted_provenance()
    test_gate_rejection()
    test_off_topic_article()
    print("\nAll sanity checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
