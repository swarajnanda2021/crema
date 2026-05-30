"""Unified Haiku enrichment for products + articles.

ONE function — `enrich_url(kind, url, page_text, hints, ...)` —
replaces the two existing per-kind enrichers
(`services/product_enricher.enrich_product` and
`services/article_enricher.enrich_article`) with a single dispatch
point that:

  1. Picks the right system prompt + tool schema by `kind`.
  2. Builds kind-appropriate user_content from primitive inputs.
  3. Calls `llm_router.call_llm` — inheriting agent/SDK routing for
     free per AGENTIC_UTOPIA.md rule 1.
  4. Validates the response against the matching Pydantic model
     (CanonicalProduct / CanonicalArticle) so callers get a typed
     entity instead of an untrusted dict.

First-PR scope: reuses the existing _EXTRACT_TOOL + _SYSTEM
(Scraper/enrich.py) and _ARTICLE_TOOL + _ARTICLE_SYSTEM
(services/article_enricher) verbatim. The Pydantic models are the
output validator only; they don't yet drive the live Haiku schema.
Future PR ports the per-field Haiku-tuning descriptions into the
Pydantic Field(description=...) prose and switches the tool schema
to the model-derived one.

Failure modes (all return None — caller decides what to do):
  • Gate rejected (is_coffee_bean=False or is_article=False)
  • Haiku call returned nothing
  • Validation failed (LLM emitted a malformed payload)
  • SDK / queue path raised
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from services.canonical_entity import (
    BaseEntity,
    CanonicalArticle,
    CanonicalProduct,
    EntityKind,
    Provenance,
)
from services.llm_router import LLMCallError, call_llm


_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_SCRAPER_DIR = _PROJECT_ROOT / "Scraper"


PAGE_TEXT_LIMIT = 16_000


class EntityEnricherError(RuntimeError):
    """Surfaces to the orchestrator as a clear 503 / 422."""


# ── Tool + system loaders (lazy — keep API boot light) ─────────────────────


def _load_product_tool_and_system() -> tuple[dict, str]:
    """Lazy-import the canonical product tool + system prompt from the
    existing scraper. Keeps the v2 entity_enricher in sync with the
    well-tuned v1 prompt during the cutover.
    """
    if str(_SCRAPER_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRAPER_DIR))
    try:
        import enrich  # type: ignore[import-not-found]
    except ImportError as e:
        raise EntityEnricherError(
            "Couldn't import Scraper/enrich.py — confirm the Scraper "
            "directory exists at repo root."
        ) from e
    return enrich._EXTRACT_TOOL, enrich._SYSTEM  # noqa: SLF001


def _load_article_tool_and_system() -> tuple[dict, str]:
    from services import article_enricher
    return article_enricher._ARTICLE_TOOL, article_enricher._ARTICLE_SYSTEM  # noqa: SLF001


# ── user_content builders (one per kind) ───────────────────────────────────


def _truncate(text: str, limit: int = PAGE_TEXT_LIMIT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[...truncated, full body continues...]"


def _build_product_user_content(
    *,
    url: str,
    roaster_slug: str,
    page_text: str,
    hints: dict[str, Any],
) -> str:
    title = hints.get("title") or "(none)"
    listing_description = hints.get("listing_description") or "(none)"
    variants = hints.get("variants") or []
    tags = hints.get("tags") or []
    roaster_name = hints.get("roaster_name") or roaster_slug

    # CURRENT NAME IN CATALOG — the products row's last-known
    # coffee_name. Seeded by the reenrich helper so Haiku can anchor
    # coffee_name_clean to the catalog's existing value when the source
    # page doesn't carry an obvious product title (Vithai's UUID-shop
    # URLs are the canonical case — the page text is just "Lot 7"
    # without a separate "title" cue, and Haiku has been observed
    # returning null or echoing the roaster brand). This hint moves the
    # ambiguity downstream into the prompt itself rather than relying
    # on the adapter's fallback chain alone.
    existing_name = hints.get("existing_coffee_name") or "(not in catalog yet)"

    if variants:
        variant_block = "\n".join(
            f"  - {v.get('title') or '(untitled)'} | "
            f"weight={v.get('weight_grams') or '?'}g | "
            f"price_inr={v.get('price_inr') or '?'}"
            for v in variants
        )
    else:
        variant_block = "  (no variants exposed)"

    # Defensive: tags should already be a list of strings (the runner
    # normalizes Shopify comma-strings + WooCommerce dict-tags via
    # _normalize_platform_tags), but coerce non-string items so a stray
    # dict can never raise "sequence item N: expected str instance".
    tags_block = (
        ", ".join(
            t if isinstance(t, str)
            else str((t.get("name") or t.get("title") or t.get("slug") or "")).strip()
            if isinstance(t, dict)
            else str(t)
            for t in tags
        ).strip(", ")
        if tags else "(none)"
    )

    return (
        f"ROASTER: {roaster_name} ({roaster_slug})\n"
        f"PRODUCT URL: {url}\n"
        f"PRODUCT TITLE: {title}\n"
        f"CURRENT NAME IN CATALOG: {existing_name}\n\n"
        f"VARIANTS (smallest size is canonical):\n"
        f"{variant_block}\n\n"
        f"TAGS: {tags_block}\n\n"
        f"LISTING DESCRIPTION:\n{listing_description}\n\n"
        f"PAGE TEXT (first {PAGE_TEXT_LIMIT} chars, nav/footer stripped):\n"
        f"---\n{_truncate(page_text)}\n---"
    )


def _build_article_user_content(
    *,
    url: str,
    page_text: str,
    hints: dict[str, Any],
) -> str:
    og_title = hints.get("og_title") or "(none)"
    og_description = hints.get("og_description") or "(none)"
    og_image = hints.get("og_image") or "(none)"
    og_published_at = hints.get("og_published_at") or "(none)"
    detected_videos = hints.get("detected_videos") or []
    detected_links = hints.get("detected_links") or []

    if detected_videos:
        videos_block = "\n".join(
            f"  - {v['url']}  (platform={v.get('platform','?')}, "
            f"video_id={v.get('video_id','?')})"
            for v in detected_videos
        )
    else:
        videos_block = "  (none)"

    if detected_links:
        links_block = "\n".join(
            f"  - <a href=\"{l['url']}\">{l['text']}</a>"
            for l in detected_links
        )
    else:
        links_block = "  (none)"

    return (
        f"ARTICLE URL: {url}\n\n"
        f"OG:TITLE (hint): {og_title}\n"
        f"OG:DESCRIPTION (hint): {og_description}\n"
        f"OG:IMAGE (hint): {og_image}\n"
        f"OG:PUBLISHED_TIME (hint): {og_published_at}\n\n"
        f"DETECTED VIDEOS (embed each via <video-embed src=\"...\" /> "
        f"in body_html at the source-referenced position):\n"
        f"{videos_block}\n\n"
        f"DETECTED BODY LINKS (every one of these <a href> tags MUST "
        f"appear verbatim in body_html — anchor text exactly as "
        f"shown, href exactly as shown):\n"
        f"{links_block}\n\n"
        f"CLEANED PAGE TEXT (nav/header/footer/script stripped, "
        f"first {PAGE_TEXT_LIMIT} chars):\n"
        f"---\n{_truncate(page_text)}\n---"
    )


# ── Adapters: LLM dict → CanonicalEntity ───────────────────────────────────


def _adapt_product_payload(
    payload: dict[str, Any],
    *,
    url: str,
    roaster_slug: str,
    scraped_at: str,
    hints: dict[str, Any],
    provenance: Provenance,
) -> dict[str, Any]:
    """Map the existing _EXTRACT_TOOL output keys onto CanonicalProduct."""
    # coffee_name fallback chain. Reorder 2026-05-25: existing catalog
    # name (already brand-filtered by the reenrich helper) takes
    # precedence over augmenter title / og:title — the catalog is the
    # curated truth-state, hints are noisy. Then heuristic page-first-
    # line. Then the placeholder, which the upserter NULLIFs out.
    coffee_name = (
        payload.get("coffee_name_clean")
        or hints.get("existing_coffee_name")
        or hints.get("title")
        or hints.get("og_title")
        or hints.get("page_first_line")
        or "Unknown coffee"
    )
    brew = payload.get("brew_recommendation")
    out: dict[str, Any] = {
        "url": url,
        "roaster_slug": roaster_slug,
        "scraped_at": scraped_at,
        "extraction_provenance": provenance,
        "enrichment_status": "enriched",
        "is_coffee_bean": bool(payload.get("is_coffee_bean", True)),
        # Class B (2026-05-30): the model's distinct-coffee OBSERVATION. The
        # CanonicalProduct._multi_coffee_bundle_guard applies the POLICY
        # (>1 → available=False). Absent on pre-change job snapshots → None →
        # the guard's deterministic text detector is the fallback.
        "distinct_coffee_count": payload.get("distinct_coffee_count"),
        "coffee_name": coffee_name,
        "image_url": hints.get("image_url"),
        "description_raw": hints.get("listing_description"),
        "price_inr": hints.get("price_inr"),
        # weight_grams is hints-FIRST (like price_inr): the deterministic
        # platform/variant/URL-size weight is authoritative over Haiku's
        # page-text parse. Haiku-first was the variant_mismatch root cause —
        # Takaraa's "Coral Rum ... -1-kg" was correctly scraped at 1000g,
        # then a re-enrich let Haiku's mis-read "20g" (a per-serving/sample
        # mention on the page) overwrite it → ₹3799/20g flagged. Hints-first
        # keeps the real bag size; Haiku is only the fallback when the
        # platform/URL gave no weight.
        "weight_grams": hints.get("weight_grams") or payload.get("weight_grams"),
        "available": hints.get("available", True),
        "sold_out_signal": hints.get("sold_out_signal"),
        "origin": payload.get("origin"),
        "origin_region": payload.get("origin_region"),
        "altitude_masl": payload.get("altitude_masl"),
        "producer": payload.get("producer"),
        "roast_level": payload.get("roast_level"),
        "roast_level_name": payload.get("roast_level_name"),
        "process_raw": payload.get("process_raw"),
        "varietal": payload.get("varietal"),
        "bean_type": payload.get("bean_type"),
        "tasting_notes": payload.get("tasting_notes"),
        "flavor_notes": payload.get("flavor_notes") or [],
        "roaster_blurb": payload.get("roaster_blurb"),
        "brew_recommendation": brew if isinstance(brew, dict) else None,
    }
    # Honest source_thin classification for BLENDS. Haiku reliably sets
    # bean_type='Blend' for blends (confirmed on both explicit "20%
    # Arabica/80% Robusta" and branded "Decadence" Robusta-chicory blends).
    # A blend genuinely has NO single-origin traceability — varietal,
    # process, altitude, producer are legitimately absent, NOT an extraction
    # miss — so it can never satisfy the per-product spec fields and is
    # perpetually flagged silent_empty while status stays 'enriched'. Mark
    # it source_thin instead (the goal's prescribed honest classification for
    # genuinely-thin sources); the silent_empty audit keys on
    # enrichment_status='enriched', so a genuine blend drops out WITHOUT
    # weakening the rule. CONSERVATIVE: requires not-single-origin AND the
    # three DEEP-traceability fields (process_raw, altitude, producer) all
    # null — a single-origin (is_single_origin=True) is never touched, and a
    # blend that DOES carry a real process / altitude / producer stays
    # 'enriched'. A species-level varietal alone does NOT exempt a blend. Visibility is unaffected: the public
    # catalog lists WHERE available=1, independent of enrichment_status, so a
    # source_thin blend stays live. (Single-species COMMODITY — 100% Robusta,
    # Monsoon Malabar — is a separate sub-class needing an is_single_origin
    # Haiku signal; left as silent_empty here, never hidden.)
    _bt = (out.get("bean_type") or "").strip().lower()
    # NOT a traceable single-origin: Haiku's explicit is_single_origin=False
    # (covers single-species COMMODITY like "100% Pure Robusta" / "Monsoon
    # Malabar" AND all blends) OR bean_type=='Blend' (belt-and-suspenders for
    # multi-species). The is_single_origin signal was added because the dev
    # metric on mokkafarms proved bean_type alone can't separate single-species
    # commodity from a single-origin lot — both come back Arabica/Robusta.
    _not_single_origin = payload.get("is_single_origin") is False or _bt == "blend"
    # The three DEEP-traceability fields. A species-level varietal (Arabica /
    # Robusta / "Blend") does NOT make a commodity blend traceable, so varietal
    # is deliberately NOT part of the test. Exuberance (90/10) + Vivacious
    # (85/15) chicory blends were stuck at silent_empty: identical thinness to
    # their source_thin siblings (Decadence et al., which also carry tasting/
    # flavor) but a "Blend"/species varietal blocked the old `not varietal`
    # clause. (2026-05-29)
    _no_deep = (
        not out.get("process_raw")
        and not out.get("altitude_masl")
        and not out.get("producer")
    )
    # Clause 1 — blend/commodity with no deep traceability (the original rule).
    _thin_blend = _not_single_origin and _no_deep
    # Clause 2 — genuinely-thin SOURCE, regardless of single-origin status. A
    # bean whose page carried NO deep provenance AND NO descriptors at all (at
    # most origin/varietal/roast/blurb) is a thin source, not a defect — e.g.
    # la-cuppa "Altaghat Plantation", whose entire WooCommerce body is one line
    # ("Thalanar Valley, Anamalais. 100% Arabica, Customisable Roast & Grind")
    # so there is nothing to extract. These read as single-origin
    # (is_single_origin=True), so clause 1 never fires, yet they are perpetually
    # ≥5/10-null silent_empty. The GOAL's own carve-out is "genuinely-thin
    # sources classified honestly as source_thin". CONSERVATIVE: requires the
    # three deep fields AND tasting_notes AND flavor_notes ALL empty, so a page
    # that yielded ANY real descriptor (a successful extraction) is never
    # relabelled — this can only fire when Haiku genuinely found nothing deep,
    # never to mask an extraction miss on a rich page. source_thin keeps
    # available=1, so visibility is unchanged. (2026-05-29)
    _zero_provenance = (
        _no_deep
        and not out.get("tasting_notes")
        and not out.get("flavor_notes")
    )
    if out["is_coffee_bean"] and (_thin_blend or _zero_provenance):
        out["enrichment_status"] = "source_thin"
    return out


def _adapt_article_payload(
    payload: dict[str, Any],
    *,
    url: str,
    roaster_slug: str,
    scraped_at: str,
    provenance: Provenance,
) -> dict[str, Any]:
    is_about_coffee = bool(payload.get("is_about_coffee", True))
    return {
        "url": url,
        "roaster_slug": roaster_slug,
        "scraped_at": scraped_at,
        "extraction_provenance": provenance,
        "enrichment_status": "enriched",
        "is_article": bool(payload.get("is_article", True)),
        "is_about_coffee": is_about_coffee,
        "title": payload.get("title") or "(untitled)",
        "excerpt": payload.get("excerpt"),
        "image_url": payload.get("image_url"),
        "body_html": payload.get("body_html"),
        "word_count": payload.get("word_count"),
        "published_at": payload.get("published_at"),
        "topic_category": payload.get("topic_category"),
        "tags": payload.get("tags") or [],
        "published": is_about_coffee,
    }


# ── Output → entity (shared by inline enrich + background applier) ──────────


def build_entity_from_output(
    payload: Optional[dict[str, Any]],
    *,
    kind: EntityKind,
    url: str,
    roaster_slug: str,
    scraped_at: str,
    provenance: Provenance,
    hints: Optional[dict[str, Any]] = None,
) -> tuple[Optional[BaseEntity], Optional[str]]:
    """Adapt a raw Haiku tool-output dict into a validated CanonicalEntity.

    Shared by the inline enrich path (`enrich_url`, SDK or in-window
    queue) AND the background applier (the drainer's /respond submit,
    which rebuilds the entity from the job's stored apply_context so the
    apply no longer depends on a live waiting thread). Returns
    `(entity, None)` on success, or `(None, gate_status)` for a gate
    decision / empty payload / validation failure — the same
    discriminator vocabulary `enrich_url` uses, so callers route task
    state identically.
    """
    if not payload:
        return None, "empty_payload"
    hints = hints or {}
    if kind == "product":
        if not payload.get("is_coffee_bean", True):
            return None, "gated_not_coffee_bean"
        adapted = _adapt_product_payload(
            payload, url=url, roaster_slug=roaster_slug,
            scraped_at=scraped_at, hints=hints, provenance=provenance,
        )
        model_cls: type[BaseEntity] = CanonicalProduct
    elif kind == "article":
        if not payload.get("is_article", True):
            return None, "gated_not_article"
        adapted = _adapt_article_payload(
            payload, url=url, roaster_slug=roaster_slug,
            scraped_at=scraped_at, provenance=provenance,
        )
        model_cls = CanonicalArticle
    else:
        return None, "invalid_kind"
    try:
        return model_cls.model_validate(adapted), None
    except ValidationError:
        return None, "validation_error"


# ── Public entry point ─────────────────────────────────────────────────────


def enrich_url(
    *,
    kind: EntityKind,
    url: str,
    roaster_slug: str,
    page_text: str,
    hints: Optional[dict[str, Any]] = None,
    scraped_at: str,
    system_addendum: Optional[str] = None,
    parent_run_id: Optional[int] = None,
    task_id: Optional[int] = None,
    model: str = "claude-haiku-4-5-20251001",
    max_tokens: int = 4000,
) -> tuple[Optional[BaseEntity], Optional[str]]:
    """Run one Haiku call to enrich a single URL into a CanonicalEntity.

    Returns `(entity, gate_status)`:
      - `(CanonicalProduct | CanonicalArticle, None)` on success
      - `(None, "gated_not_coffee_bean")` — Haiku's is_coffee_bean gate fired
      - `(None, "gated_not_article")` — Haiku's is_article gate fired
      - `(None, "invalid_input")` — empty url or page_text
      - `(None, "llm_error")` — call_llm raised LLMCallError
      - `(None, "empty_payload")` — call_llm returned nothing
      - `(None, "validation_error")` — Pydantic schema rejected the response

    The discriminator lets the runner distinguish a successful
    "this isn't coffee" gate decision (route to state=skipped) from a
    transient LLM/validation failure (route to state=failed for triage).

    Raises `EntityEnricherError` only for setup failures the
    orchestrator wants to short-circuit on (no API key on SDK path,
    missing scraper module).
    """
    if not url or not page_text:
        return None, "invalid_input"
    # The API-key check lives in llm_router._call_via_sdk only — in
    # queue mode the drainer agent (not this orchestrator process)
    # owns credentials, so this process shouldn't need a key.

    hints = hints or {}

    if kind == "product":
        tool, base_system = _load_product_tool_and_system()
        user_content = _build_product_user_content(
            url=url, roaster_slug=roaster_slug, page_text=page_text, hints=hints,
        )
        step = "product_enrich"
        adapter = _adapt_product_payload
        adapter_kwargs = {"hints": hints}
        model_cls: type[BaseEntity] = CanonicalProduct
    elif kind == "article":
        tool, base_system = _load_article_tool_and_system()
        user_content = _build_article_user_content(
            url=url, page_text=page_text, hints=hints,
        )
        step = "article_enrich"
        adapter = _adapt_article_payload
        adapter_kwargs = {}
        model_cls = CanonicalArticle
    else:
        raise EntityEnricherError(f"Unknown kind: {kind!r}")

    if system_addendum and system_addendum.strip():
        system_param: Any = [
            {"type": "text", "text": base_system,
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": system_addendum.strip(),
             "cache_control": {"type": "ephemeral"}},
        ]
        provenance: Provenance = "haiku_site_hinted"
    else:
        system_param = base_system
        provenance = "haiku"

    # apply_context is persisted on the llm_jobs row (queue path only) so
    # the drainer's /respond submit can apply the result itself — the
    # background applier that decouples the upsert from this thread's
    # inline poll. Carries the fully-resolved deterministic hints (price/
    # weight/image/availability already merged by run_for_roaster) + the
    # task_id so /respond can mark the right enrichment_tasks row.
    apply_context = {
        "kind": kind,
        "url": url,
        "roaster_slug": roaster_slug,
        "scraped_at": scraped_at,
        "provenance": provenance,
        "hints": hints,
        "task_id": task_id,
    }
    try:
        payload = call_llm(
            step=step,
            system=system_param,
            tool=tool,
            user_content=user_content,
            max_tokens=max_tokens,
            model=model,
            roaster_slug=roaster_slug,
            target_id=url,
            parent_run_id=parent_run_id,
            apply_context=apply_context,
        )
    except LLMCallError:
        return None, "llm_error"

    # In-window / SDK path: the response is back inline, so adapt +
    # validate + return here exactly as before. In queue mode the
    # drainer's /respond ALSO applies from apply_context — idempotent
    # with this inline upsert (COALESCE), and the safety net that lands
    # the row even if this thread already timed out at 600s.
    return build_entity_from_output(
        payload,
        kind=kind,
        url=url,
        roaster_slug=roaster_slug,
        scraped_at=scraped_at,
        provenance=provenance,
        hints=hints,
    )


__all__ = ["enrich_url", "build_entity_from_output", "EntityEnricherError"]
