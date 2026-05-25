"""
Canonical JSON-LD extraction for the catalog-ops pipeline.

Replaces four prior implementations that diverged subtly:
  - Scraper/enrich.py::_extract_jsonld_strings
    (pulled strings for LLM context, Product schemas)
  - Scraper/scraper/custom_scraper.py::_extract_jsonld_product +
    _product_from_jsonld (extracted Product dicts for the canonical
    pipeline, with Wix-specific Offers/offers case-tolerance)
  - Scraper/scraper/wix_fetcher.py (extracted product data from
    JSON-LD plus Wix-specific JSON blocks)
  - Community/coffee-community-api/services/article_scraper.py::
    _extract_jsonld_date (pulled dates from Article / BlogPosting /
    NewsArticle schemas)

## What this module provides

Three layers of API, each calling into the layer below:

### Layer 1 — raw JSON-LD discovery
  `extract_jsonld_blocks(html_or_soup) -> List[Any]`

Parse every `<script type="application/ld+json">` on the page and
return the parsed JSON payloads (dicts, lists, or @graph-unwrapped
arrays). Tolerates: invalid JSON (silently drops), nested @graph
wrappers, top-level arrays, single objects.

### Layer 2 — schema-typed lookups
  `find_first(blocks, schema_type) -> Optional[dict]`
  `find_all(blocks, schema_type) -> List[dict]`

Walk the parsed blocks and return objects matching the requested
schema.org @type. Handles common variants (Product, BlogPosting,
NewsArticle, Article, Recipe, etc.). Case-insensitive on the type
match. Walks @graph arrays and inline arrays.

### Layer 3 — typed extractors
  `extract_product(blocks) -> Optional[CanonicalProduct]`
  `extract_article_date(blocks) -> Optional[str]`
  `extract_strings_for_llm(blocks) -> List[str]`

Higher-level helpers that turn JSON-LD into the canonical shapes
downstream code expects:
  - CanonicalProduct → unified product schema (replaces the
    per-platform normalize_* functions for the JSON-LD path).
  - extract_article_date → datePublished as ISO 8601, walking
    Article / BlogPosting / NewsArticle types.
  - extract_strings_for_llm → flat string list pulled from
    Product-relevant fields, joined by the caller into the
    [JSON-LD STRUCTURED DATA] block that Haiku is trained to read.

## Schema.org tolerances we explicitly handle

  - `@type` can be string OR list — we accept either.
  - `@graph` array wrapping — common in Yoast / Rank Math output.
  - Case drift: `offers` vs `Offers` (Wix). We accept both.
  - `image` field can be: string URL, ImageObject dict (with
    contentUrl or url), or array of either.
  - `additionalProperty` array of PropertyValue objects — Wix
    Stores' canonical way to expose Producer / Variety / Process /
    Altitude / etc. as separate KV pairs.
  - Numeric values as strings ("1,200.00") — coerce.
  - `offers.priceCurrency` for currency code.
  - Schema.org's lowerCamelCase vs occasional lowercase variants
    (`datepublished` vs `datePublished`) — case-insensitive walk.
"""

from __future__ import annotations

import datetime
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, List, Optional, Union


# ── Layer 1: raw JSON-LD discovery ──────────────────────────────────


def extract_jsonld_blocks(html_or_soup: Union[str, Any]) -> List[Any]:
    """Parse every `<script type="application/ld+json">` on the page.

    Accepts either a raw HTML string or a BeautifulSoup-parsed
    document. Returns a list of parsed JSON payloads — each entry
    is whatever was in one script tag (typically a dict, sometimes
    a list of dicts).

    Invalid JSON is silently dropped — themes occasionally emit
    malformed payloads (trailing commas, embedded `<script>`
    closers, etc.) and we'd rather skip than crash.
    """
    soup = _ensure_soup(html_or_soup)
    if soup is None:
        return []

    out: List[Any] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        raw = tag.string or tag.get_text() or ""
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            # Some themes emit JSON with HTML entities or trailing
            # commas. Try a one-shot cleanup.
            cleaned = _try_repair_json(raw)
            if cleaned is None:
                continue
            try:
                payload = json.loads(cleaned)
            except (json.JSONDecodeError, TypeError):
                continue
        out.append(payload)
    return out


def _ensure_soup(obj: Union[str, Any]):
    """Coerce string-or-soup input into a BeautifulSoup."""
    if obj is None:
        return None
    if isinstance(obj, str):
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return None
        try:
            return BeautifulSoup(obj, "html.parser")
        except Exception:
            return None
    # Assume it's already a soup-ish object with find_all.
    if hasattr(obj, "find_all"):
        return obj
    return None


def _try_repair_json(raw: str) -> Optional[str]:
    """Last-ditch JSON cleanup for common theme malformations."""
    # Trailing commas before } or ]
    cleaned = re.sub(r",(\s*[}\]])", r"\1", raw)
    # Unescaped newlines inside string values are rare but happen
    # — we don't try to fix those; they'd need a real parser.
    if cleaned == raw:
        return None
    return cleaned


# ── Layer 2: schema-typed lookups ───────────────────────────────────


def _iter_candidates(blocks: List[Any]) -> Iterable[dict]:
    """Yield every dict-shaped object discoverable in `blocks`.

    Walks:
      - Top-level dicts.
      - Top-level lists (yields each dict inside).
      - `@graph` arrays inside a top-level dict.
      - Nested `@graph` arrays inside list entries.
    """
    for block in blocks:
        if isinstance(block, dict):
            graph = block.get("@graph")
            if isinstance(graph, list):
                for item in graph:
                    if isinstance(item, dict):
                        yield item
            else:
                yield block
        elif isinstance(block, list):
            for item in block:
                if isinstance(item, dict):
                    graph = item.get("@graph")
                    if isinstance(graph, list):
                        for g in graph:
                            if isinstance(g, dict):
                                yield g
                    else:
                        yield item


def _type_matches(obj: dict, want: str) -> bool:
    """Schema-tolerant @type match. Accepts string OR list, case-
    insensitive."""
    t = obj.get("@type")
    if isinstance(t, str):
        return t.lower() == want.lower()
    if isinstance(t, list):
        return any(isinstance(x, str) and x.lower() == want.lower() for x in t)
    return False


def find_first(blocks: List[Any], schema_type: str) -> Optional[dict]:
    """Return the first object whose @type matches `schema_type`."""
    for obj in _iter_candidates(blocks):
        if _type_matches(obj, schema_type):
            return obj
    return None


def find_all(blocks: List[Any], schema_type: str) -> List[dict]:
    """Return every object whose @type matches `schema_type`."""
    return [obj for obj in _iter_candidates(blocks) if _type_matches(obj, schema_type)]


def find_first_of(blocks: List[Any], schema_types: Iterable[str]) -> Optional[dict]:
    """Return the first object matching ANY of the requested types.

    Order matters — types listed earlier take precedence when
    multiple types are present in the same page (e.g. an `Article`
    that's also marked `BlogPosting` will return as the first
    listed type).
    """
    wanted = [t.lower() for t in schema_types]
    for obj in _iter_candidates(blocks):
        t = obj.get("@type")
        types_here: List[str] = []
        if isinstance(t, str):
            types_here = [t.lower()]
        elif isinstance(t, list):
            types_here = [x.lower() for x in t if isinstance(x, str)]
        for want in wanted:
            if want in types_here:
                return obj
    return None


# ── Layer 3a: canonical Product extraction ──────────────────────────


@dataclass
class CanonicalProduct:
    """Unified product shape extracted from a JSON-LD Product schema.

    Field names mirror the existing pipeline's product dict so the
    normalizer can consume this directly. None means "JSON-LD didn't
    have this field" — caller may fill from other sources (HTML
    body text, listing-endpoint data, OCR).
    """
    name: Optional[str] = None
    description: Optional[str] = None
    sku: Optional[str] = None
    brand: Optional[str] = None
    image_url: Optional[str] = None
    product_url: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    available: Optional[bool] = None
    weight_raw: Optional[str] = None       # e.g. "250g" if present
    weight_grams: Optional[int] = None
    additional_properties: dict = field(default_factory=dict)
    # Catch-all: keep the source dict so callers needing exotic
    # fields can dig deeper without re-parsing.
    raw: dict = field(default_factory=dict)


# Schema.org product family — Shopify uses ProductGroup for variant-
# driven products (the default), WooCommerce + Wix typically use
# plain Product. ProductModel is a less common variant. Order =
# preference; we take the first match across the family.
_PRODUCT_TYPES = ("Product", "ProductGroup", "ProductModel")


def extract_product(blocks: List[Any]) -> Optional[CanonicalProduct]:
    """Pull the first JSON-LD Product (or ProductGroup) schema and
    convert to canonical.

    Shopify emits `@type: "ProductGroup"` for products with variants
    (the default for almost every Shopify store), and reserves
    `@type: "Product"` for the single-variant SKU rows inside the
    group's `hasVariant`. We treat ProductGroup as the canonical
    record because that's where the brand-facing fields live (name,
    description, image, category) — `hasVariant.[*].offers` then
    surfaces per-variant pricing.

    Returns None when no Product-family schema is present (caller
    falls back to body-text extraction).
    """
    ld = find_first_of(blocks, _PRODUCT_TYPES)
    if not ld:
        return None
    return _product_to_canonical(ld)


def _product_to_canonical(ld: dict) -> CanonicalProduct:
    out = CanonicalProduct(raw=ld)
    out.name = _str(ld.get("name"))
    out.description = _str(ld.get("description"))
    out.sku = _str(ld.get("sku") or ld.get("mpn") or ld.get("productID"))

    brand = ld.get("brand")
    if isinstance(brand, dict):
        out.brand = _str(brand.get("name"))
    elif isinstance(brand, str):
        out.brand = brand.strip()

    out.image_url = _extract_image_url(ld.get("image"))
    out.product_url = _str(ld.get("url") or ld.get("@id"))

    # Offers: direct (Product) or inside hasVariant[*].offers (ProductGroup).
    offers = ld.get("offers") or ld.get("Offers")  # Wix case-drift
    if not offers and isinstance(ld.get("hasVariant"), list):
        # Shopify ProductGroup: collect the FIRST variant's offers
        # as a representative (the per-variant pricing differs but
        # we just want one anchor here; the per-roaster scraper
        # gets full variant pricing from /products.json or the
        # platform-specific augmenter).
        for variant in ld["hasVariant"]:
            if isinstance(variant, dict):
                v_offers = variant.get("offers") or variant.get("Offers")
                if v_offers:
                    offers = v_offers
                    break
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if isinstance(offers, dict):
        # Price
        price_raw = offers.get("price") or offers.get("lowPrice") or offers.get("highPrice")
        if price_raw is not None:
            try:
                out.price = float(str(price_raw).replace(",", ""))
            except (ValueError, TypeError):
                pass
        # Currency
        out.currency = _str(offers.get("priceCurrency"))
        # Availability
        avail = _str(offers.get("availability"))
        if avail:
            avail_low = avail.lower()
            if "instock" in avail_low or "available" in avail_low:
                out.available = True
            elif "outofstock" in avail_low or "soldout" in avail_low or "discontinued" in avail_low:
                out.available = False

    # Weight — multiple shapes Schema.org supports.
    weight = ld.get("weight")
    if isinstance(weight, dict):
        val = weight.get("value")
        unit = _str(weight.get("unitCode") or weight.get("unitText"))
        if val is not None:
            out.weight_raw = f"{val}{unit or ''}".strip() or None
    elif isinstance(weight, (int, float)):
        out.weight_raw = str(weight)
    elif isinstance(weight, str):
        out.weight_raw = weight.strip()

    # additionalProperty — Wix Stores' canonical way to expose
    # Producer / Variety / Process / Altitude as separate KV pairs.
    ap = ld.get("additionalProperty")
    if isinstance(ap, list):
        for prop in ap:
            if not isinstance(prop, dict):
                continue
            name = _str(prop.get("name") or prop.get("propertyID"))
            value = prop.get("value")
            if isinstance(value, dict):
                # PropertyValue.value can itself be a typed object
                value = value.get("value") or value.get("name")
            if name and value is not None:
                out.additional_properties[name] = _str(value) if not isinstance(value, (int, float, bool)) else value

    return out


def _extract_image_url(image_field: Any) -> Optional[str]:
    """Pull a hero URL from JSON-LD's `image` (string/dict/array)."""
    if not image_field:
        return None
    if isinstance(image_field, str):
        return image_field.strip() or None
    if isinstance(image_field, list):
        for item in image_field:
            url = _extract_image_url(item)
            if url:
                return url
        return None
    if isinstance(image_field, dict):
        return _str(image_field.get("contentUrl") or image_field.get("url"))
    return None


def _str(v: Any) -> Optional[str]:
    """Coerce to a non-empty trimmed string or None."""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s or None
    return str(v)


# ── Layer 3b: article date extraction ───────────────────────────────


_ARTICLE_TYPES = ("Article", "BlogPosting", "NewsArticle", "Posting", "TechArticle")


def extract_article_date(blocks: List[Any]) -> Optional[str]:
    """Find `datePublished` on the first Article-typed JSON-LD object.

    Replaces `article_scraper._extract_jsonld_date`. Returns the
    raw string (callers' `_normalize_pubdate` coerces to ISO).
    """
    obj = find_first_of(blocks, _ARTICLE_TYPES)
    if not obj:
        return None
    # Schema.org canonical is `datePublished` but be tolerant.
    for key in ("datePublished", "datepublished", "dateCreated"):
        val = obj.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return None


def extract_article_iso(blocks: List[Any]) -> Optional[str]:
    """Like `extract_article_date` but returns ISO 8601 directly.

    Handy when the caller doesn't need to know about the various
    string formats Shopify / WordPress emit.
    """
    raw = extract_article_date(blocks)
    if not raw:
        return None
    return _coerce_iso(raw)


def _coerce_iso(raw: str) -> Optional[str]:
    """Best-effort parse → ISO 8601 (UTC Z form)."""
    if not raw:
        return None
    fmts = (
        "%a, %d %b %Y %H:%M:%S %z",        # RFC 822
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%SZ",              # canonical
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S %z",            # Shopify JSON-LD
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    )
    for f in fmts:
        try:
            dt = datetime.datetime.strptime(raw, f)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, TypeError):
            continue
    return raw  # last resort: return as-is rather than dropping


# ── Layer 3c: LLM-string flattener ──────────────────────────────────


_LLM_RELEVANT_KEYS = frozenset({
    "name", "description", "brand", "manufacturer", "sku", "gtin",
    "weight", "category", "productID", "color", "material",
    "alternativeHeadline", "headline", "articleBody",
    "additionalProperty", "value", "propertyID", "unitText",
    "offers", "price", "priceCurrency", "availability",
})


def extract_strings_for_llm(blocks: List[Any]) -> List[str]:
    """Flatten product-relevant JSON-LD fields into a string list.

    Used by `Scraper/enrich.py:_fetch_product_page_text` to build the
    `[JSON-LD STRUCTURED DATA]` block the Haiku per-product extractor
    is trained to read. Skips URLs / hash blobs / numeric IDs that
    don't carry semantic content for the LLM.
    """
    out: List[str] = []
    seen: set = set()

    def _looks_uninteresting(s: str) -> bool:
        s = s.strip()
        if not s or len(s) > 2000:
            return True
        # Drop URL-shaped strings (we want descriptions, not links).
        if s.startswith(("http://", "https://")):
            return True
        # Drop hash-like blobs.
        if re.fullmatch(r"[0-9a-f]{16,}", s, re.I):
            return True
        return False

    def _walk(node, key_hint: Optional[str] = None):
        if isinstance(node, str):
            if not _looks_uninteresting(node) and node not in seen:
                seen.add(node)
                out.append(node)
        elif isinstance(node, (int, float, bool)):
            # Numeric values are interesting if their key hint says so
            # (price, weight, etc.).
            if key_hint and key_hint.lower() in _LLM_RELEVANT_KEYS:
                v = str(node)
                if v not in seen:
                    seen.add(v)
                    out.append(v)
        elif isinstance(node, dict):
            for k, v in node.items():
                if isinstance(k, str) and (
                    k in _LLM_RELEVANT_KEYS or k.startswith("@")
                ):
                    _walk(v, key_hint=k)
        elif isinstance(node, list):
            for item in node:
                _walk(item, key_hint=key_hint)

    for block in blocks:
        _walk(block)

    return out
