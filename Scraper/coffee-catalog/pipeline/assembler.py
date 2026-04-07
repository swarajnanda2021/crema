"""
Phase 4: Catalog Assembly.
Merge discovery + verification + enrichment into the final verified catalog.
"""

import csv
import datetime
from utils import slugify


def _build_roaster_entry(discovery, verification, enrichment):
    """Merge the three phase outputs into a single roaster entry."""
    d = discovery or {}
    v = verification or {}
    e = enrichment or {}

    return {
        "roaster_slug": slugify(d.get("name", "")),
        "name": d.get("name", ""),
        "city": d.get("city", ""),
        "state": d.get("state", ""),
        "lat": d.get("lat", 0),
        "lng": d.get("lng", 0),
        "website": v.get("website") or d.get("website", ""),
        "shop_url": v.get("shop_url") or v.get("website") or d.get("website", ""),
        "platform": v.get("platform", "Custom"),
        "google_maps_url": d.get("google_maps_url"),
        "place_id": d.get("place_id"),
        "rating": d.get("rating"),
        "rating_count": d.get("rating_count"),
        # Enrichment fields
        "logo_url": e.get("logo_url"),
        "tagline": e.get("tagline"),
        "about_blurb": e.get("about_blurb"),
        "founding_year": e.get("founding_year"),
        "sourcing_regions": e.get("sourcing_regions"),
        "specialties": e.get("specialties"),
        "social_links": e.get("social_links"),
        # Metadata
        "verification_class": v.get("classification", "UNKNOWN"),
        "verification_evidence": v.get("evidence", {}),
        "enrichment_flags": e.get("enrichment_flags", []),
        "cataloged_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _build_dropped_entry(discovery, verification):
    """Build a dropped roaster summary."""
    d = discovery or {}
    v = verification or {}
    return {
        "name": d.get("name", v.get("name", "")),
        "website": v.get("website") or d.get("website"),
        "classification": v.get("classification", "UNKNOWN"),
        "evidence_summary": _summarize_evidence(v),
        "place_id": d.get("place_id"),
    }


def _summarize_evidence(verification):
    """Generate a human-readable evidence summary."""
    ev = verification.get("evidence", {})
    parts = []
    status = verification.get("homepage_status", 0)
    if status:
        parts.append(f"Homepage HTTP {status}.")
    coffee = ev.get("coffee_terms_found", [])
    if coffee:
        parts.append(f"Coffee terms: {', '.join(coffee[:3])}.")
    prices = ev.get("price_examples", [])
    if prices:
        parts.append(f"Prices: {', '.join(prices[:3])}.")
    carts = ev.get("cart_signals", [])
    if carts:
        parts.append(f"Cart: {', '.join(carts[:2])}.")
    shops = ev.get("shop_links_found", [])
    if shops:
        parts.append(f"Shop links: {len(shops)} found.")
    elif not shops:
        parts.append("No shop links found.")
    return " ".join(parts) if parts else "No evidence collected."


def assemble_catalog(discovery, verifications, enrichments):
    """
    Phase 4 entry point. Merge all phases into the final catalog.
    Returns (verified_list, dropped_list, summary_dict).
    """
    disc_map = {d["place_id"]: d for d in discovery}
    verify_map = {v["place_id"]: v for v in verifications}
    enrich_map = {e["place_id"]: e for e in enrichments}

    verified = []
    dropped = []

    for pid, v in verify_map.items():
        d = disc_map.get(pid, {})
        e = enrich_map.get(pid, {})

        if v["classification"] in ("VERIFIED", "VERIFIED_WHATSAPP"):
            verified.append(_build_roaster_entry(d, v, e))
        else:
            dropped.append(_build_dropped_entry(d, v))

    # Sort verified by name
    verified.sort(key=lambda r: r["name"])

    # Also include discovered candidates that had no website (weren't verified)
    for pid, d in disc_map.items():
        if pid not in verify_map:
            if not d.get("website"):
                dropped.append({
                    "name": d.get("name", ""),
                    "website": None,
                    "classification": "NO_WEBSITE",
                    "evidence_summary": "No website URL from Google Places.",
                    "place_id": pid,
                })

    # Unique states covered
    states = set(r["state"] for r in verified if r.get("state"))

    summary = {
        "total_discovered": len(discovery),
        "total_with_website": sum(1 for d in discovery if d.get("website")),
        "total_verified": len(verified),
        "total_dropped": len(dropped),
        "states_covered": len(states),
    }

    return verified, dropped, summary


def write_csv(path, roasters):
    """Write the verified roasters to a flat CSV."""
    if not roasters:
        return

    # Flatten for CSV
    fieldnames = [
        "roaster_slug", "name", "city", "state", "lat", "lng",
        "website", "shop_url", "platform",
        "rating", "rating_count",
        "logo_url", "tagline", "about_blurb", "founding_year",
        "sourcing_regions", "specialties", "social_links",
        "verification_class", "enrichment_flags", "cataloged_at",
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in roasters:
            row = dict(r)
            # Serialize arrays/objects for CSV
            if row.get("sourcing_regions"):
                row["sourcing_regions"] = ", ".join(row["sourcing_regions"])
            if row.get("specialties"):
                row["specialties"] = ", ".join(row["specialties"])
            if row.get("social_links"):
                sl = row["social_links"]
                row["social_links"] = ", ".join(f"{k}: {v}" for k, v in sl.items())
            if row.get("enrichment_flags"):
                row["enrichment_flags"] = ", ".join(row["enrichment_flags"])
            writer.writerow(row)
