"""Side-by-side validation: services/entity_enricher (v2) on real URLs.

Pulls N product URLs + N article URLs from the local DB, fetches each
page live, runs `enrich_url(...)` from the new entity_enricher, and
writes the resulting CanonicalProduct / CanonicalArticle JSON to a
file for human inspection.

For comparison, the test also reads the existing DB row (the v1
enrichment that's already landed) and emits a per-field diff so we
can see whether v2's Haiku call produces the same shape.

This is a quality check, not a CI test. It makes live Haiku calls and
costs ~$0.10 per run (10 calls × ~$0.01 each).

Usage:
    cd Community/coffee-community-api
    python scripts/test_entity_enricher_v2.py
    python scripts/test_entity_enricher_v2.py --products 5 --articles 5
    python scripts/test_entity_enricher_v2.py --product-url URL --article-url URL
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Optional

_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parent.parent))

import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

from database import DB_PATH  # noqa: E402
from services.canonical_entity import CanonicalArticle, CanonicalProduct  # noqa: E402
from services.entity_enricher import enrich_url  # noqa: E402


USER_AGENT = "Mozilla/5.0 (compatible; CremaCatalog/2.0; +https://crema.app/about)"
PAGE_FETCH_TIMEOUT = 15


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _fetch_page(url: str) -> tuple[str, dict[str, Any]]:
    """Return (clean_text, og_hints). Plain requests+bs4, no fancy logic."""
    r = requests.get(
        url, headers={"User-Agent": USER_AGENT}, timeout=PAGE_FETCH_TIMEOUT,
        allow_redirects=True,
    )
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    for tag in soup.select("nav, header, footer, script, style, noscript, form, [aria-hidden='true']"):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    text = "\n".join(line for line in text.splitlines() if line.strip())

    def _og(name: str) -> Optional[str]:
        tag = soup.find("meta", attrs={"property": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
        return None

    title_tag = soup.find("title")
    page_title = title_tag.get_text(strip=True) if title_tag else None

    hints = {
        "og_title": _og("og:title") or page_title,
        "og_description": _og("og:description"),
        "og_image": _og("og:image"),
        "og_published_at": _og("article:published_time") or _og("og:article:published_time"),
    }
    return text, hints


def _pick_product_urls(conn: sqlite3.Connection, n: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT product_id, roaster_slug, coffee_name, product_url, image_url, "
        "       price_inr, weight_grams, available "
        "FROM products "
        "WHERE product_url IS NOT NULL AND product_url <> '' "
        "  AND enrichment_status = 'enriched' "
        "ORDER BY RANDOM() LIMIT ?",
        (n,),
    ).fetchall()
    return [dict(r) for r in rows]


def _pick_article_urls(conn: sqlite3.Connection, n: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, roaster_slug, url, title, image_url, published_at "
        "FROM roaster_articles "
        "WHERE enrichment_status = 'enriched' "
        "ORDER BY RANDOM() LIMIT ?",
        (n,),
    ).fetchall()
    return [dict(r) for r in rows]


def _existing_product_row(conn: sqlite3.Connection, product_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM products WHERE product_id = ?", (product_id,)
    ).fetchone()
    return dict(row) if row else {}


def _existing_article_row(conn: sqlite3.Connection, article_id: int) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM roaster_articles WHERE id = ?", (article_id,)
    ).fetchone()
    return dict(row) if row else {}


_PRODUCT_COMPARE_FIELDS = [
    "coffee_name", "origin", "altitude_masl", "roast_level", "roast_level_name",
    "process_raw", "tasting_notes", "varietal", "bean_type", "weight_grams",
    "producer", "roaster_blurb",
]

_ARTICLE_COMPARE_FIELDS = [
    "title", "excerpt", "image_url", "published_at",
    "is_about_coffee", "topic_category", "word_count",
]


def _diff_product(v2: dict[str, Any], v1: dict[str, Any]) -> list[str]:
    diffs = []
    for k in _PRODUCT_COMPARE_FIELDS:
        a = v2.get(k)
        b = v1.get(k)
        if a != b:
            diffs.append(f"{k}: v1={b!r} | v2={a!r}")
    return diffs


def _diff_article(v2: dict[str, Any], v1: dict[str, Any]) -> list[str]:
    diffs = []
    for k in _ARTICLE_COMPARE_FIELDS:
        a = v2.get(k)
        b = v1.get(k)
        if k == "is_about_coffee":
            a = bool(a) if a is not None else None
            b = bool(b) if b is not None else None
        if a != b:
            diffs.append(f"{k}: v1={b!r} | v2={a!r}")
    return diffs


def _run_product(row: dict[str, Any], conn: sqlite3.Connection) -> dict[str, Any]:
    url = row["product_url"]
    print(f"  [product] fetching {url}")
    try:
        page_text, og_hints = _fetch_page(url)
    except Exception as e:
        return {"url": url, "v2": None, "error": f"fetch failed: {e}"}

    hints = {
        "title": row.get("coffee_name") or og_hints.get("og_title"),
        "image_url": row.get("image_url") or og_hints.get("og_image"),
        "price_inr": row.get("price_inr"),
        "weight_grams": row.get("weight_grams"),
        "available": bool(row.get("available", 1)),
        "roaster_name": row["roaster_slug"],
    }

    print(f"  [product] calling Haiku ({len(page_text)} chars page text)")
    result = enrich_url(
        kind="product",
        url=url,
        roaster_slug=row["roaster_slug"],
        page_text=page_text,
        hints=hints,
        scraped_at=_now_iso(),
    )

    v2_dump = result.model_dump() if isinstance(result, CanonicalProduct) else None
    v1_row = _existing_product_row(conn, row["product_id"])
    diffs = _diff_product(v2_dump or {}, v1_row) if v2_dump else []

    return {
        "url": url,
        "product_id": row["product_id"],
        "v2": v2_dump,
        "v1_db_row": v1_row,
        "diffs_vs_v1_db": diffs,
        "error": None if v2_dump else "v2 enrich returned None",
    }


def _run_article(row: dict[str, Any], conn: sqlite3.Connection) -> dict[str, Any]:
    url = row["url"]
    print(f"  [article] fetching {url}")
    try:
        page_text, og_hints = _fetch_page(url)
    except Exception as e:
        return {"url": url, "v2": None, "error": f"fetch failed: {e}"}

    print(f"  [article] calling Haiku ({len(page_text)} chars page text)")
    result = enrich_url(
        kind="article",
        url=url,
        roaster_slug=row["roaster_slug"],
        page_text=page_text,
        hints=og_hints,
        scraped_at=_now_iso(),
    )

    v2_dump = result.model_dump() if isinstance(result, CanonicalArticle) else None
    v1_row = _existing_article_row(conn, row["id"])
    diffs = _diff_article(v2_dump or {}, v1_row) if v2_dump else []

    return {
        "url": url,
        "article_id": row["id"],
        "v2": v2_dump,
        "v1_db_row": v1_row,
        "diffs_vs_v1_db": diffs,
        "error": None if v2_dump else "v2 enrich returned None",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--products", type=int, default=3, help="How many product URLs to test")
    ap.add_argument("--articles", type=int, default=3, help="How many article URLs to test")
    ap.add_argument("--product-url", action="append", default=[],
                    help="Specific product URL(s) to test (overrides --products)")
    ap.add_argument("--article-url", action="append", default=[],
                    help="Specific article URL(s) to test (overrides --articles)")
    ap.add_argument("--out", default=None, help="Output JSON path (default /tmp/v2_test_<ts>.json)")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set — bail (this script makes real Haiku calls).")
        return 1

    out_path = args.out or f"/tmp/v2_test_{_dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if args.product_url:
        product_rows = []
        for u in args.product_url:
            r = conn.execute(
                "SELECT * FROM products WHERE product_url = ?", (u,)
            ).fetchone()
            if r:
                product_rows.append(dict(r))
            else:
                product_rows.append({"product_url": u, "roaster_slug": "unknown", "coffee_name": None})
    else:
        product_rows = _pick_product_urls(conn, args.products)

    if args.article_url:
        article_rows = []
        for u in args.article_url:
            r = conn.execute(
                "SELECT * FROM roaster_articles WHERE url = ?", (u,)
            ).fetchone()
            if r:
                article_rows.append(dict(r))
    else:
        article_rows = _pick_article_urls(conn, args.articles)

    print(f"\nSelected {len(product_rows)} product(s) + {len(article_rows)} article(s)")
    print(f"Output → {out_path}\n")

    results: dict[str, Any] = {"started_at": _now_iso(), "products": [], "articles": []}

    print("Products:")
    for row in product_rows:
        results["products"].append(_run_product(row, conn))

    print("\nArticles:")
    for row in article_rows:
        results["articles"].append(_run_article(row, conn))

    results["ended_at"] = _now_iso()

    Path(out_path).write_text(json.dumps(results, indent=2, default=str))

    print(f"\nWrote {out_path}\n")
    print("Summary:")
    for kind, items in (("products", results["products"]), ("articles", results["articles"])):
        ok = sum(1 for r in items if r.get("v2"))
        failed = len(items) - ok
        with_diffs = sum(1 for r in items if r.get("diffs_vs_v1_db"))
        print(f"  {kind}: {ok} succeeded, {failed} failed, {with_diffs} had v1↔v2 diffs")
        for r in items:
            tag = "FAIL" if r.get("error") else ("DIFF" if r.get("diffs_vs_v1_db") else "OK  ")
            print(f"    [{tag}] {r['url']}")
            if r.get("error"):
                print(f"           {r['error']}")
            elif r.get("diffs_vs_v1_db"):
                for d in r["diffs_vs_v1_db"][:5]:
                    print(f"           {d}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
