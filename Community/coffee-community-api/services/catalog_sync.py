"""
Catalog sync service — imports scraped/manual product JSON into the products table.

Replaces the old file-loading approach in main.py. Products live in the DB;
the scraper populates them via this sync service.
"""

import os
import json
import datetime

from database import get_db


_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRAPER_OUTPUT = os.path.join(_BASE, "Scraper", "output")
_MANUAL_PRODUCTS = os.path.join(_SCRAPER_OUTPUT, "..", "input", "manual_products.json")
_CORRECTIONS = os.path.join(_SCRAPER_OUTPUT, "..", "input", "product_corrections.json")


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def sync_products():
    """Import all product sources into the products table. Upserts by product_id."""
    db = get_db()
    now = _now()
    imported = 0

    try:
        # Load scraped products
        products = []
        for fname in ["products_enriched.json", "products.json"]:
            path = os.path.join(_SCRAPER_OUTPUT, fname)
            if os.path.exists(path):
                with open(path) as f:
                    products = json.load(f)
                break

        # Load manual products
        if os.path.exists(_MANUAL_PRODUCTS):
            with open(_MANUAL_PRODUCTS) as f:
                products.extend(json.load(f))

        # Load corrections
        corrections = {}
        if os.path.exists(_CORRECTIONS):
            with open(_CORRECTIONS) as f:
                corrections = {c["product_id"]: c for c in json.load(f) if "product_id" in c}

        # Upsert each product
        for p in products:
            pid = p.get("product_id")
            if not pid:
                continue

            # Apply corrections
            if pid in corrections:
                p.update({k: v for k, v in corrections[pid].items() if k != "product_id"})

            db.execute("""
                INSERT OR REPLACE INTO products
                (product_id, roaster_slug, roaster_name, coffee_name, roast_level,
                 tasting_notes, origin, process, varietal, altitude_masl, bean_type,
                 flavor_notes, weight_grams, price_inr, image_url, product_url,
                 description_raw, available, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pid, p.get("roaster_slug"), p.get("roaster_name"), p.get("coffee_name"),
                p.get("roast_level"), p.get("tasting_notes"), p.get("origin"),
                p.get("process"), p.get("varietal"), p.get("altitude_masl"),
                p.get("bean_type"), p.get("flavor_notes"),
                p.get("weight_grams"), p.get("price_inr"),
                p.get("image_url"), p.get("product_url"),
                p.get("description_raw"),
                1 if p.get("available", True) else 0,
                "manual" if p in products[-10:] else "scraped",  # rough heuristic
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
