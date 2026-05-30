"""Canonical entity schemas for the scraper v2 pipeline.

ONE Pydantic source of truth for what a scraped+enriched product or
article looks like. The scraper v2 plan (see AGENTIC_UTOPIA.md +
the v1→v2 handoff) calls for collapsing five drifting representations
("scraper raw dict / normalizer output / DB columns / Haiku tool
schema / TS interface") into one model that all five layers derive
from.

This module defines the models. The generator script at
`scripts/generate_canonical_schemas.py` emits the SQL DDL preview,
Haiku tool_schema JSON, and TypeScript interface stubs from these
models so the layers stay aligned by construction.

This file is data-only. No I/O, no DB, no LLM. Pure Pydantic.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


EntityKind = Literal["product", "article"]

Provenance = Literal[
    "haiku",
    "haiku_site_hinted",
    "admin_manual",
    "bs4_fallback",
    "unknown",
]

EnrichmentStatus = Literal["pending", "enriched", "failed", "skipped", "source_thin"]


class BaseEntity(BaseModel):
    """Common fields for any catalog-ops entity (product or article)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    url: str = Field(description="Source URL of the page this entity was extracted from.")
    roaster_slug: str = Field(description="Canonical roaster slug from roaster_profiles.")
    scraped_at: str = Field(description="ISO 8601 UTC timestamp of the scrape.")
    extraction_provenance: Provenance = Field(
        default="unknown",
        description=(
            "Where the canonical data came from. 'haiku' = a successful "
            "Haiku extraction with the static prompt; 'haiku_site_hinted' "
            "= Haiku with the per-roaster site-quirk addendum applied; "
            "'admin_manual' = a human admin edited this row (sticky — "
            "never overwritten by Haiku without explicit force); "
            "'bs4_fallback' = Haiku failed and a deterministic extractor "
            "filled the row (admin review recommended); 'unknown' = "
            "legacy / pre-provenance row."
        ),
    )
    enrichment_status: EnrichmentStatus = Field(
        default="pending",
        description="Lifecycle state for the per-entity enrichment task.",
    )


# ── Product ────────────────────────────────────────────────────────────────


RoastLevel = Literal["Light", "Medium-Light", "Medium", "Medium-Dark", "Dark"]
BeanType = Literal["Arabica", "Robusta", "Blend", "Liberica", "Excelsa"]


class BrewRecommendation(BaseModel):
    """Roaster-recommended brew parameters, when extractable from the page."""

    model_config = ConfigDict(extra="forbid")

    method: Optional[str] = Field(
        default=None,
        description="Brew method e.g. 'Espresso', 'V60', 'AeroPress', 'French Press'.",
    )
    dose_grams: Optional[float] = Field(default=None, description="Coffee dose in grams.")
    ratio: Optional[str] = Field(
        default=None,
        description="Brew ratio as the roaster wrote it, e.g. '1:2', '1:16'.",
    )
    water_temp_celsius: Optional[int] = Field(
        default=None,
        description="Brew water temperature in degrees Celsius.",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Free-text notes from the roaster about brewing this bean.",
    )


class CanonicalProduct(BaseEntity):
    """Canonical product (a roasted coffee bean SKU) as it lands in the
    catalog. Mirrors the `products` table columns plus the enrichment
    fields Haiku emits.
    """

    is_coffee_bean: bool = Field(
        default=True,
        description=(
            "Gate: false rejects the URL. True covers single-SKU roasted "
            "coffee (whole bean, ground, single-serve pour-over packs of "
            "the same coffee) AND traditional Indian filter coffee blends "
            "(coffee + chicory or other extender). False for: pure chicory "
            "powder, workshops, equipment, merch, RTD, MULTI-COFFEE BUNDLES "
            "(tasting set, trio of distinct origins, etc.). Full criteria "
            "in `Scraper/enrich.py`'s _EXTRACT_TOOL is_coffee_bean field — "
            "this docstring is a summary."
        ),
    )

    distinct_coffee_count: Optional[int] = Field(
        default=None,
        description=(
            "How many DISTINCT coffees this single product page sells as "
            "SEPARATE bags. 1 for a normal bean — INCLUDING a blend, which "
            "mixes several coffees into ONE bag (still one SKU). >1 ONLY for "
            "a multi-coffee BUNDLE: a gift box / curated set / duo / combo / "
            "sampler whose buyer receives two or more different coffees in "
            "their own bags (e.g. 'includes 3 coffees, 75g each'). This "
            "SEPARATES observation (count the coffees) from policy (reject "
            "bundles) — the model must only OBSERVE; deterministic code "
            "rejects >1. Leave null if genuinely unclear; do not guess >1 "
            "for a blend."
        ),
    )

    coffee_name: str = Field(description="Display-ready product name.")
    image_url: Optional[str] = Field(default=None, description="Hero image URL.")
    description_raw: Optional[str] = Field(
        default=None,
        description="Verbatim listing description from the source page.",
    )

    price_inr: Optional[float] = Field(
        default=None, description="Price in INR for the smallest bean variant."
    )
    weight_grams: Optional[int] = Field(
        default=None, description="Weight of the smallest bean variant in grams."
    )
    available: bool = Field(default=True, description="In-stock at scrape time.")
    sold_out_signal: Optional[bool] = Field(
        default=None,
        exclude=True,
        description=(
            "Transient page-text evidence of sold-out language — True when "
            "the page literally says 'sold out' / 'out of stock' / "
            "'currently unavailable' / 'notify me when available', False "
            "when the page was checked and none of those phrases appeared, "
            "None when no signal was extracted (legacy / Shopify-API path "
            "where the variant.available flag is the source of truth "
            "instead). Used by the K3 validator to distinguish 'really "
            "sold out' from 'price extraction failed'. Not persisted to "
            "the DB."
        ),
    )

    origin: Optional[str] = Field(
        default=None,
        description="Specific farm, estate, or named micro-region.",
    )
    origin_region: Optional[str] = Field(
        default=None,
        description="Broader origin region (Chikmagalur, Coorg, Wayanad, etc.).",
    )
    altitude_masl: Optional[int] = Field(
        default=None, description="Growing altitude in metres above sea level."
    )
    producer: Optional[str] = Field(
        default=None,
        description="Narrative-extracted producer/farmer/estate-owner name.",
    )

    roast_level: Optional[RoastLevel] = Field(
        default=None,
        description="Roast level bucketed to the 5-tier enum.",
    )
    roast_level_name: Optional[str] = Field(
        default=None,
        description="Verbatim roaster-written roast term (Vienna, Full City+, etc.).",
    )
    process_raw: Optional[str] = Field(
        default=None,
        description="Processing method exactly as the roaster wrote it.",
    )

    varietal: Optional[str] = Field(
        default=None, description="Coffee varietal (S795, Bourbon, Gesha, ...)."
    )
    bean_type: Optional[BeanType] = Field(default=None, description="Bean species.")

    tasting_notes: Optional[str] = Field(
        default=None, description="Roaster's tasting prose."
    )
    flavor_notes: list[str] = Field(
        default_factory=list,
        description="Concise flavor descriptors (title case, 1-3 words each, max 5).",
    )

    roaster_blurb: Optional[str] = Field(
        default=None,
        description=(
            "1-2 sentence third-person narrative about THIS bean — sourcing, "
            "processing, what makes it distinctive."
        ),
    )

    brew_recommendation: Optional[BrewRecommendation] = Field(
        default=None,
        description="Roaster's recommended brew parameters when extractable.",
    )

    @model_validator(mode="after")
    def _absurd_price_guard(self) -> "CanonicalProduct":
        """Symmetric absurd-price guard.

        High side (Vithai 2026-05-25 class): price_inr > 100k INR for
        weight_grams < 1kg is a concatenation bug in upstream price
        extraction (`₹900200g` → regex captured `900200`). Indian
        specialty coffee tops out around ₹3-8k/kg; a 200-500g bag at
        ₹9-lakh is impossible.

        Low side (Kuttinkhan Estate 2026-05-26 class): price_inr < 50
        INR for weight_grams >= 100g is implausible. Cheapest legit
        Indian specialty bean is ~₹0.6/g (₹150 per 250g). Anything
        below ~₹0.2/g signals a unit-error — Shopify variant.price
        returned in paise read as INR (700 → ₹7.00), a test variant
        the merchant forgot to remove, or page-text mis-parse.

        Either side: rejection routes to validation_error gate-status
        → state=failed for operator triage rather than letting the
        bad price land on the consumer card.
        """
        if self.price_inr is None:
            return self

        # High-side guard
        if self.price_inr > 100_000:
            if self.weight_grams is None or self.weight_grams < 1000:
                raise ValueError(
                    f"absurd price_inr={self.price_inr} (HIGH) for "
                    f"weight_grams={self.weight_grams!r} — likely a "
                    "concatenation bug in upstream price extraction "
                    "(Vithai class)"
                )

        # Low-side guard. price=0 is a sold-out signal — handled
        # separately by the no-price-means-sold-out validator below,
        # not rejected here (we want to record that the row is sold-
        # out, not toss it). The validator catches 0 < price < 50
        # with meaningful weight, which is the paise-read-as-INR
        # class.
        if 0 < self.price_inr < 50:
            if self.weight_grams is not None and self.weight_grams >= 100:
                raise ValueError(
                    f"absurd price_inr={self.price_inr} (LOW) for "
                    f"weight_grams={self.weight_grams} — Indian specialty "
                    "coffee below ~₹0.2/g is implausible (Kuttinkhan "
                    "Estate class — likely paise read as INR, or a "
                    "test/placeholder variant)"
                )

        return self

    @model_validator(mode="after")
    def _no_price_means_sold_out(self) -> "CanonicalProduct":
        """Platform-agnostic sold-out / ghost guard.

        Operator rule (originally): "no price means no catalog entry"
        (Zenforest 2026-05-26 — jamun-fermented, la-vida-mango etc. all
        landed enriched on the consumer browse despite being
        unavailable on the source storefront).

        Refinement 2026-05-26: require POSITIVE sold-out signal to flip
        available=False. The original rule conflated "extraction
        failed" with "product is genuinely sold out" — the bulk
        re-enrich that day wiped Nada and Agastya (both Wix) from
        consumer browse because the Wix bypass left price_inr=None
        even on real, in-stock products. Wix product pages DO show
        prices; the extraction pipeline was just broken (since fixed
        in page_fetcher._fetch_product — Wix now runs through
        _extract_product_from_html). To avoid a repeat we now require
        the page text to literally say "sold out" / "out of stock" /
        etc. before flipping available=False on a null-price row.

        Rules (Class D refinement, 2026-05-30 — honor the signal at ANY
        price):
          • sold_out_signal=True → flip to available=False, REGARDLESS of
            price. A priced product can still be unbuyable: araku NANOLOT
            #5 shows ₹2600 with a "Coming Soon" button, and the Shopify
            .json endpoint omits variant.available, so the page-text
            signal is the only evidence. The earlier rule gated this flip
            on a null/0 price, so a priced sold-out slipped through as
            available=1.
          • sold_out_signal=False/None → keep available=True, even at a
            null/0 price. Extraction may have failed silently (Wix
            Nada/Agastya class); let admin curation catch it via the
            thin-products surface rather than auto-hiding a real in-stock
            bean. The positive-signal requirement is what makes this safe.

        The Shopify-specific ghost detector in entity_reenricher still
        sets hints["available"]=False directly when variant.price=0 or
        variant.available=False — that path is independent.

        Direct mutation on the model is the Pydantic-2-correct way to
        mutate a non-frozen model in an after-mode validator.
        """
        if self.sold_out_signal is True and self.available:
            self.available = False
        return self

    @model_validator(mode="after")
    def _single_serve_format_economics(self) -> "CanonicalProduct":
        """Beans-only scope guard — hide single-serve FORMATS by their
        economic signature.

        Crema is a whole-beans catalog: single-serve drip / cold-brew /
        pour-over BAGS are out of scope (grind is fine; a pre-portioned
        single-cup format is not). Most are caught upstream by the
        Stage-1 title/URL filter or the Stage-2a body-text matcher, but
        the ones whose format marker never reaches the cleaned
        coffee_name, the URL slug, OR the body prose slip through and land
        on the consumer card — where the ₹/g sort floats them to #1 (a 5 g
        bag at ₹540 is 108 ₹/g, the most expensive per gram in the whole
        catalog). roast-coffee "Monsoon Malabar" (5 g, slug
        'ep-monsoon-malabar', description_raw NULL) is the canonical
        text-invisible case — only the economics give it away.

        Detector lives in product_filters.is_single_serve_by_economics:
        weight ≤ 15 g AND ≥ 15 ₹/g is a box that holds only single-serve
        formats (real specialty beans ship at 50 g minimum / ~₹0.6-8 ₹/g).
        Flip available=False (mirrors _no_price_means_sold_out — keep the
        enriched row, just drop it from consumer browse) rather than
        raising: it IS coffee, only the wrong format, so we hide it on
        every re-enrich, we don't fail it. This is the write-path half of
        the Class-A fix; crema_apply_filters_retro is the retroactive half.
        """
        from services.product_filters import is_single_serve_by_economics
        if self.available and is_single_serve_by_economics(
            self.weight_grams, self.price_inr
        ):
            self.available = False
        return self

    @model_validator(mode="after")
    def _multi_coffee_bundle_guard(self) -> "CanonicalProduct":
        """Beans-only scope guard — hide multi-coffee BUNDLES.

        A bundle (gift box / curated set / duo / combo of ≥2 distinct
        coffees, each in its own bag) is coffee but not a single bean SKU,
        so it's out of scope — same principle as single-serve formats. The
        Haiku `is_coffee_bean` gate conflates "is coffee?" (yes) with "is
        ONE bean SKU?" (no) and leans true, so bundles leak in.

        Two signals, OR'd — the root fix plus a belt:
          • distinct_coffee_count > 1 — the model's explicit OBSERVATION
            (it counts the coffees; this code applies the POLICY). This is
            the durable fix: caarabi/black-poetry/93-degrees all had Haiku
            describe the bundle in prose while is_coffee_bean returned true,
            because one boolean can't both observe and decide. A separate
            count field the model must fill removes that conflation.
          • is_multi_coffee_bundle(prose) — a deterministic text detector
            (see product_filters) as the belt, so the already-leaked rows
            stay hidden across a re-enrich even before the prompt change is
            live. Keys on separation structure ("includes/set of N
            coffees", "experience duo"), never a bare count, so a single-
            bag BLEND is never rejected.

        Flip available=False (mirrors the sold-out / single-serve guards) —
        it IS coffee, just not a single SKU, so we hide it, not fail it.
        """
        from services.product_filters import is_multi_coffee_bundle
        if not self.available:
            return self
        if (self.distinct_coffee_count is not None
                and self.distinct_coffee_count > 1):
            self.available = False
            return self
        if is_multi_coffee_bundle(
            self.coffee_name, url=self.url,
            description=self.description_raw,
            blurb=self.roaster_blurb, tasting_notes=self.tasting_notes,
        ):
            self.available = False
        return self


# ── Article ────────────────────────────────────────────────────────────────


TopicCategory = Literal[
    "brew", "roast", "origins", "taste", "lifestyle", "news", "misc",
]


class CanonicalArticle(BaseEntity):
    """Canonical article (a roaster's blog/journal post) as it lands in
    the catalog. Mirrors the `roaster_articles` table.
    """

    is_article: bool = Field(
        default=True,
        description=(
            "Gate: false rejects the URL (category landing, tag index, "
            "blog home, 404 page, mis-classified product listing)."
        ),
    )

    is_about_coffee: bool = Field(
        default=True,
        description=(
            "Coffee-relevance gate: false hides the article from consumers "
            "by setting published=0. Admin may override."
        ),
    )

    title: str = Field(description="Article title.")
    excerpt: Optional[str] = Field(
        default=None,
        description="≤150-char teaser shown in the feed (frame as invitation).",
    )
    image_url: Optional[str] = Field(default=None, description="Hero image URL (NEVER a logo).")
    body_html: Optional[str] = Field(
        default=None,
        description=(
            "Clean structured HTML restricted to the renderer's tag subset "
            "(h2/h3, p, ul/ol/li, blockquote, figure, img, hr, "
            "video-embed, a, strong, em)."
        ),
    )
    word_count: Optional[int] = Field(default=None, description="Body word count.")
    published_at: Optional[str] = Field(
        default=None,
        description="ISO 8601 publish date. NEVER the scrape date; null when source has none.",
    )

    topic_category: Optional[TopicCategory] = Field(
        default=None,
        description="One of seven fixed topic buckets (required when is_about_coffee=true).",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="3-7 lowercase keyword tags for sitewide search.",
    )

    published: bool = Field(
        default=True,
        description="Curation flag. Off-topic rows insert with published=False.",
    )

    editorial_score: Optional[int] = Field(
        default=None,
        ge=0,
        le=100,
        description=(
            "0-100 composite editorial-quality score. NULL until the "
            "article has been graded (services/article_grader.py)."
        ),
    )
    editorial_score_components: Optional[dict] = Field(
        default=None,
        description=(
            "JSON breakdown of the 5 sub-scores that compose "
            "editorial_score: {editorial_prose_quality, "
            "sourcing_specificity, image_richness, "
            "product_cross_links, internal_article_cross_links}. "
            "Each 0-100. Aggregate is a simple average."
        ),
    )
    editorial_scored_at: Optional[str] = Field(
        default=None,
        description="UTC ISO when the editorial score was last computed.",
    )


# ── Helpers ────────────────────────────────────────────────────────────────


_MODEL_BY_KIND: dict[EntityKind, type[BaseEntity]] = {
    "product": CanonicalProduct,
    "article": CanonicalArticle,
}


def model_for_kind(kind: EntityKind) -> type[BaseEntity]:
    """Return the Pydantic model class for a given entity kind."""
    if kind not in _MODEL_BY_KIND:
        raise ValueError(
            f"Unknown entity kind {kind!r}; expected one of {list(_MODEL_BY_KIND)}"
        )
    return _MODEL_BY_KIND[kind]


def tool_schema_for_kind(kind: EntityKind) -> dict:
    """Return a Haiku tool input_schema derived from the Pydantic model.

    Uses Pydantic's native JSON Schema emitter. Anthropic's tool_use
    accepts a JSON Schema-flavored object directly. Suitable for
    side-by-side validation against the existing hand-written schemas;
    not yet wired as the live Haiku tool (the existing schemas in
    `Scraper/enrich.py` and `services/article_enricher.py` carry the
    load-bearing per-field tuning prose that this minimal model
    descriptions don't).
    """
    model = model_for_kind(kind)
    schema = model.model_json_schema()
    schema.pop("$defs", None)
    return schema


__all__ = [
    "BaseEntity",
    "BeanType",
    "BrewRecommendation",
    "CanonicalArticle",
    "CanonicalProduct",
    "EnrichmentStatus",
    "EntityKind",
    "Provenance",
    "RoastLevel",
    "TopicCategory",
    "model_for_kind",
    "tool_schema_for_kind",
]
