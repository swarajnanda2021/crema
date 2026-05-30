"""Unified URL discovery for the v2 enrichment pipeline.

ONE entry point that asks: "for this roaster, what URLs do we need to
enrich?" Dispatches to the existing kind-specific discoverers:

  • kind='product' → `services.product_discovery.discover` (sitemap +
    Shopify/WooCommerce augmenters).
  • kind='article' → `services.article_scraper.discover` +
    `enumerate_articles` (Shopify sitemap_blogs → Atom; WordPress
    /feed/; generic feeds; HTML index fallback).

Returns a flat `List[DiscoveredUrl]` across all requested kinds. The
orchestrator (`enrichment_runner`) inserts one `enrichment_tasks` row
per result, enqueues the enrichment job, drains, upserts.

Discovery itself is platform-coupled (it has to be — Shopify and
WordPress expose products/articles via different endpoints) but the
ABOVE-the-discovery layer is generic: enrichment, upserting, hint
generation, coverage check all key on the kind, not the platform.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Literal, Optional

from services.canonical_entity import EntityKind


@dataclass(frozen=True)
class DiscoveredUrl:
    kind: EntityKind
    url: str
    roaster_slug: str
    # Platform-specific raw payload the augmenter attached. For
    # products this carries Shopify variants / WooCommerce attributes;
    # for articles this carries the stub bundle ({title, excerpt,
    # image_url, body_html?, published_at}) parsed from the feed.
    augmented: dict[str, Any] = field(default_factory=dict)
    lastmod: Optional[str] = None
    source: Optional[str] = None  # 'sitemap' | 'shopify_api' | 'atom_feed' | ...


@dataclass
class EntityDiscoveryResult:
    urls: list[DiscoveredUrl] = field(default_factory=list)
    per_kind_breakdown: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _discover_products(roaster: dict, log) -> list[DiscoveredUrl]:
    try:
        from services.product_discovery import discover as discover_products
    except ImportError as e:
        return []
    try:
        result = discover_products(roaster, log=log)
    except Exception as e:
        if log:
            log(f"  [discover/product] {roaster.get('roaster_slug')}: {e}")
        return []

    slug = roaster.get("roaster_slug") or ""
    out = []
    for d in result.urls:
        out.append(
            DiscoveredUrl(
                kind="product",
                url=d.url,
                roaster_slug=slug,
                augmented=d.augmented or {},
                lastmod=d.lastmod,
                source=d.source,
            )
        )
    return out


def _discover_articles(roaster: dict, log) -> list[DiscoveredUrl]:
    try:
        from services import article_scraper
    except ImportError:
        return []

    website = roaster.get("website") or ""
    platform = roaster.get("platform") or roaster.get("articles_feed_kind")
    slug = roaster.get("roaster_slug") or ""
    if not website:
        return []

    # Honor the cached discovery state on roaster_sources if present.
    index_url = roaster.get("articles_index_url")
    feed_kind = roaster.get("articles_feed_kind")
    handles = roaster.get("articles_handles") or None
    if isinstance(handles, str):
        import json
        try:
            handles = json.loads(handles)
        except Exception:
            handles = None

    if not index_url or not feed_kind:
        try:
            disco = article_scraper.discover(website, platform=platform)
        except Exception as e:
            if log:
                log(f"  [discover/article] {slug}: {e}")
            return []
        if not disco:
            return []
        index_url = disco.get("index_url")
        feed_kind = disco.get("kind")
        handles = disco.get("handles") or handles

    try:
        stubs = article_scraper.enumerate_articles(
            website, index_url=index_url, kind=feed_kind, handles=handles,
        )
    except Exception as e:
        if log:
            log(f"  [enumerate/article] {slug}: {e}")
        return []

    out = []
    for stub in stubs:
        url = stub.get("url")
        if not url:
            continue
        out.append(
            DiscoveredUrl(
                kind="article",
                url=url,
                roaster_slug=slug,
                augmented={k: v for k, v in stub.items() if k != "url"},
                lastmod=stub.get("published_at"),
                source=f"article_{feed_kind}",
            )
        )
    return out


def discover(
    roaster: dict,
    *,
    kinds: Iterable[EntityKind] = ("product", "article"),
    log=None,
) -> EntityDiscoveryResult:
    """Discover all URLs to enrich for `roaster`, across the requested
    `kinds`. Returns an EntityDiscoveryResult.

    `roaster` is a dict with at least `roaster_slug` + `website`.
    Optional fields the kind-specific discoverers honor: `platform`,
    `shop_url`, `articles_index_url`, `articles_feed_kind`,
    `articles_handles`.
    """
    result = EntityDiscoveryResult()
    for kind in kinds:
        if kind == "product":
            urls = _discover_products(roaster, log)
        elif kind == "article":
            urls = _discover_articles(roaster, log)
        else:
            result.errors.append(f"unknown kind: {kind!r}")
            continue
        result.urls.extend(urls)
        result.per_kind_breakdown[kind] = len(urls)
    return result


__all__ = ["DiscoveredUrl", "EntityDiscoveryResult", "discover"]
