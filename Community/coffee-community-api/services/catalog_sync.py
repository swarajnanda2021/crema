"""
Catalog sync service — imports scraped/manual product JSON into the products table.

Replaces the old file-loading approach in main.py. Products live in the DB;
the scraper populates them via this sync service.
"""

import os
import json
import datetime

from database import get_db


_API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BASE = os.path.dirname(os.path.dirname(_API_DIR))  # Coffee_Aggregator root
_SCRAPER_OUTPUT = os.path.join(_BASE, "Scraper", "output")
_MANUAL_PRODUCTS = os.path.join(_SCRAPER_OUTPUT, "..", "input", "manual_products.json")
_CORRECTIONS = os.path.join(_SCRAPER_OUTPUT, "..", "input", "product_corrections.json")
# Bundled frontend data (full catalog with images, names, prices)
_BUNDLED_PRODUCTS = os.path.join(_BASE, "crema-app", "src", "data", "products.json")


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def sync_products():
    """Import all product sources into the products table. Upserts by product_id."""
    db = get_db()
    now = _now()
    imported = 0

    try:
        # Load products — prefer bundled (has images/names), then scraper output
        products = []
        for path in [_BUNDLED_PRODUCTS,
                     os.path.join(_SCRAPER_OUTPUT, "products_enriched.json"),
                     os.path.join(_SCRAPER_OUTPUT, "products.json")]:
            if os.path.exists(path):
                with open(path) as f:
                    products = json.load(f)
                if products:
                    break

        # Load manual products
        if os.path.exists(_MANUAL_PRODUCTS):
            with open(_MANUAL_PRODUCTS) as f:
                manual = json.load(f)
                # Avoid duplicating products already loaded
                existing_ids = {p.get("product_id") for p in products}
                products.extend(p for p in manual if p.get("product_id") not in existing_ids)

        # Load corrections
        corrections = {}
        if os.path.exists(_CORRECTIONS):
            with open(_CORRECTIONS) as f:
                corrections = {c["product_id"]: c for c in json.load(f) if "product_id" in c}

        # Upsert each product (with quality gate)
        for p in products:
            pid = p.get("product_id")
            if not pid:
                continue

            # Apply corrections
            if pid in corrections:
                p.update({k: v for k, v in corrections[pid].items() if k != "product_id"})

            # Quality gate: skip products that shouldn't be shown
            if not p.get("coffee_name"):
                continue
            if not p.get("available", True):
                continue
            # Skip non-coffee items (e.g. equipment, merchandise)
            if p.get("is_coffee_bean") is False:
                continue

            db.execute("""
                INSERT OR REPLACE INTO products
                (product_id, roaster_slug, roaster_name, coffee_name, roast_level,
                 tasting_notes, origin, process, varietal, altitude_masl, bean_type,
                 flavor_notes, weight_grams, price_inr, image_url, product_url,
                 description_raw, available, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pid, p.get("roaster_slug"), p.get("roaster_name"), p.get("coffee_name"),
                p.get("roast_level"),
                p.get("tasting_notes") if isinstance(p.get("tasting_notes"), str) else json.dumps(p.get("tasting_notes")) if p.get("tasting_notes") else None,
                p.get("origin"),
                p.get("process"), p.get("varietal"), p.get("altitude_masl"),
                p.get("bean_type"),
                json.dumps(p.get("flavor_notes")) if isinstance(p.get("flavor_notes"), list) else p.get("flavor_notes"),
                p.get("weight_grams"), p.get("price_inr"),
                p.get("image_url"), p.get("product_url"),
                p.get("description_raw") if isinstance(p.get("description_raw"), str) else None,
                1 if p.get("available", True) else 0,
                "scraped",
                now,
            ))
            imported += 1

        # Also import roaster-managed products from the old table
        rows = db.execute("SELECT * FROM roaster_products WHERE available = 1").fetchall()
        for r in rows:
            pid = f"{r['roaster_slug']}-{r['coffee_name'].lower().replace(' ', '-')}"
            db.execute("""
                INSERT OR REPLACE INTO products
                (product_id, roaster_slug, roaster_name, coffee_name, roast_level,
                 tasting_notes, origin, process, varietal, altitude_masl, bean_type,
                 flavor_notes, weight_grams, price_inr, image_url, product_url,
                 description_raw, available, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'roaster', ?)
            """, (
                pid, r["roaster_slug"], None, r["coffee_name"],
                r["roast_level"], r["tasting_notes"], r["origin"],
                r["process"], r["varietal"], r["altitude_masl"],
                r["bean_type"], r["flavor_notes"],
                r["weight_grams"], r["price_inr"],
                r["image_url"], r["product_url"],
                r["description_raw"], now,
            ))
            imported += 1

        db.commit()
        return {"imported": imported}
    finally:
        db.close()
