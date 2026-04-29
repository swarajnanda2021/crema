#!/usr/bin/env python3
"""
User-level recommendations.

For each user, produces TWO segregated recommendation lists:

  A. Shelf-based — score every catalog coffee by similarity to the union of
     SCA addresses across the user's shelf, exclude what they already own,
     return the top N.

  B. Friend-based — collect coffees from the shelves of the users this person
     FOLLOWS (user-to-user only; roaster/cafe follows are excluded). Exclude
     coffees the user already has, then rank by (a) friend-count, (b)
     similarity to the user's own flavor profile.

Coffee data is sourced from `Scraper/output/products_enriched.json` first, then
falls back to the live SQLite at Community/coffee-community-api/coffee_community.db
for items the scrape missed. When `flavor_notes` is empty, comma-separated
`tasting_notes` is parsed as a fallback.

Usage:
    python tag_user_recs.py
"""

import json
import sqlite3
from pathlib import Path

import tag_resolver_test as trt


SCRIPT_DIR = Path(__file__).resolve().parent      # tasting_notes_tags/
PROJECT_ROOT = SCRIPT_DIR.parent                  # repo root
INPUT_PATH = PROJECT_ROOT / "Scraper" / "output" / "products_enriched.json"
DB_PATH = PROJECT_ROOT / "Community" / "coffee-community-api" / "coffee_community.db"
RES_PATH = SCRIPT_DIR / "tag_resolutions.json"

USERS = [("Swaraj Nanda", 2), ("Aayushi Kapadia", 8)]
TOP_N = 5


# ---------------------------------------------------------------------------
# Loading

def load_resolutions():
    with open(RES_PATH) as f:
        r = json.load(f)
    r.pop("_comment", None)
    return r


def load_catalog_index():
    """product_id → coffee dict (from JSON catalog)."""
    with open(INPUT_PATH) as f:
        data = json.load(f)
    return {c["product_id"]: c for c in data}, data


def parse_tags(coffee):
    """Prefer flavor_notes; fall back to comma-split tasting_notes string."""
    tags = list(coffee.get("flavor_notes") or [])
    if tags:
        return tags
    tn = coffee.get("tasting_notes")
    if isinstance(tn, str) and "," in tn:
        return [t.strip() for t in tn.split(",") if t.strip()]
    return []


def db_product(con, product_id):
    """Fetch a single product row from the DB.products table as a dict."""
    cols = ["product_id", "coffee_name", "roaster_name", "tasting_notes",
            "flavor_notes", "process", "roast_level"]
    row = con.execute(
        f"SELECT {', '.join(cols)} FROM products WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(zip(cols, row))
    # flavor_notes is stored as JSON-string in this table
    fn_raw = d.get("flavor_notes")
    if isinstance(fn_raw, str) and fn_raw.strip():
        try:
            d["flavor_notes"] = json.loads(fn_raw)
        except json.JSONDecodeError:
            d["flavor_notes"] = []
    else:
        d["flavor_notes"] = []
    return d


def coffee_record(product_id, catalog_index, con):
    """Unified lookup: catalog first, DB fallback. Returns dict with parsed tags."""
    rec = catalog_index.get(product_id)
    if rec and parse_tags(rec):
        rec = dict(rec)
        rec["_tags"] = parse_tags(rec)
        rec["_source"] = "catalog"
        return rec
    db_rec = db_product(con, product_id)
    if db_rec and parse_tags(db_rec):
        db_rec["_tags"] = parse_tags(db_rec)
        db_rec["_source"] = "db"
        return db_rec
    if rec:  # catalog had it but no tags
        rec = dict(rec)
        rec["_tags"] = []
        rec["_source"] = "catalog (no tags)"
        return rec
    if db_rec:
        db_rec["_tags"] = []
        db_rec["_source"] = "db (no tags)"
        return db_rec
    return None


def addrs_from_tags(tags, resolutions):
    out = []
    unknown = []
    for t in tags:
        a = resolutions.get(t)
        if a is None:
            if t not in resolutions:
                unknown.append(t)
            continue
        if trt.is_valid_address(a, trt.TREE):
            out.append(a)
    return out, unknown


# ---------------------------------------------------------------------------
# DB queries

def get_shelf(con, user_id):
    """Returns list of (shelf, product_id) tuples, slug-form only (no integer noise)."""
    rows = con.execute(
        "SELECT shelf, product_id FROM shelf_entries WHERE user_id = ? ORDER BY shelf, added_at",
        (user_id,),
    ).fetchall()
    return [(s, pid) for s, pid in rows if not str(pid).isdigit()]


def get_user_follows(con, user_id):
    """Returns list of (followed_user_id, username, display_name)."""
    rows = con.execute(
        """SELECT u.id, u.username, u.display_name
           FROM follows f
           JOIN users u ON ('user_' || u.id) = f.roaster_slug
           WHERE f.follower_user_id = ? AND f.roaster_slug LIKE 'user_%'""",
        (user_id,),
    ).fetchall()
    return list(rows)


def get_user(con, user_id):
    row = con.execute(
        "SELECT username, display_name FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return row


# ---------------------------------------------------------------------------
# Recommendation engines

def shelf_based(user_addrs, user_pids, catalog_list, resolutions):
    """Score every catalog coffee against the user's flavor profile, exclude shelf."""
    scored = []
    for c in catalog_list:
        if c["product_id"] in user_pids:
            continue
        cand_addrs, _ = addrs_from_tags(parse_tags(c), resolutions)
        if not cand_addrs:
            continue
        s = trt.coffee_similarity(user_addrs, cand_addrs)
        if s > 0:
            scored.append((s, c, cand_addrs))
    scored.sort(key=lambda x: (-x[0], x[1].get("coffee_name") or "", x[1].get("roaster_name") or ""))
    return scored


def friend_based(user_addrs, user_pids, friend_ids, catalog_index, con, resolutions):
    """Coffees from friends' shelves (excluding the user's own shelf)."""
    by_pid = {}  # pid → set of friend usernames
    for fid in friend_ids:
        for _shelf, pid in get_shelf(con, fid):
            if pid in user_pids:
                continue
            by_pid.setdefault(pid, set()).add(fid)

    scored = []
    for pid, owners in by_pid.items():
        rec = coffee_record(pid, catalog_index, con)
        if not rec:
            continue
        cand_addrs, _ = addrs_from_tags(rec.get("_tags", []), resolutions)
        sim = trt.coffee_similarity(user_addrs, cand_addrs) if (user_addrs and cand_addrs) else 0
        scored.append({
            "pid": pid,
            "rec": rec,
            "owners": owners,
            "sim": sim,
            "addrs": cand_addrs,
        })
    # Sort: friend count desc, similarity desc, name
    scored.sort(key=lambda x: (-len(x["owners"]), -x["sim"], (x["rec"].get("coffee_name") or "")))
    return scored


# ---------------------------------------------------------------------------
# Pretty-printing

def fmt_addr(addr):
    return "[" + ", ".join(addr) + "]"


def print_shelf_summary(label, shelf_entries, catalog_index, con, resolutions):
    print(f"  {label}'s shelf ({len(shelf_entries)} entries):")
    aggregate_addrs = []
    aggregate_unknown = []
    for shelf, pid in shelf_entries:
        rec = coffee_record(pid, catalog_index, con)
        if not rec:
            print(f"    [{shelf:11s}] {pid}  ← not in catalog or DB")
            continue
        tags = rec.get("_tags", [])
        addrs, unknown = addrs_from_tags(tags, resolutions)
        aggregate_addrs.extend(addrs)
        aggregate_unknown.extend(unknown)
        name = rec.get("coffee_name") or "?"
        roaster = rec.get("roaster_name") or "?"
        tag_str = ", ".join(tags) if tags else "(no tags)"
        print(f"    [{shelf:11s}] {name} by {roaster}")
        print(f"                  tags: {tag_str}  ← from {rec.get('_source','?')}")
    if aggregate_unknown:
        print(f"  Unknown tags (not in resolutions): {sorted(set(aggregate_unknown))}")
    print(f"  → flavor profile has {len(aggregate_addrs)} resolved addresses")
    print()
    return aggregate_addrs


def print_shelf_recs(label, recs, n=TOP_N):
    print(f"  --- A. Shelf-based recommendations (top {n}) ---")
    if not recs:
        print("    (none — user has no resolvable flavor profile)")
        return
    for i, (score, c, addrs) in enumerate(recs[:n], 1):
        name = c.get("coffee_name")
        roaster = c.get("roaster_name")
        tags = parse_tags(c)
        print(f"  {i}. {name} by {roaster}  — similarity {score}")
        print(f"     tags: {', '.join(tags)}")
        print(f"     addresses: {'; '.join(fmt_addr(a) for a in addrs)}")
    print()


def print_friend_recs(label, friend_meta, recs, n=TOP_N):
    print(f"  --- B. Friend-based recommendations (top {n}) ---")
    if not friend_meta:
        print(f"    (none — {label} doesn't follow any other users yet)")
        return
    print(f"    Friends ({len(friend_meta)}): {', '.join(m[2] for m in friend_meta)}")
    if not recs:
        print("    (none — friends own no coffees the user doesn't already have)")
        return
    fid_to_name = {m[0]: m[2] for m in friend_meta}
    for i, r in enumerate(recs[:n], 1):
        name = r["rec"].get("coffee_name")
        roaster = r["rec"].get("roaster_name")
        tags = r["rec"].get("_tags", [])
        owner_names = sorted(fid_to_name.get(fid, f"user_{fid}") for fid in r["owners"])
        print(f"  {i}. {name} by {roaster}  — owned by {len(r['owners'])} friend(s): {', '.join(owner_names)}")
        if r["sim"]:
            print(f"     fit-to-your-taste (similarity): {r['sim']}")
        else:
            print(f"     fit-to-your-taste: n/a (no overlap or no flavor profile)")
        if tags:
            print(f"     tags: {', '.join(tags)}")
            if r["addrs"]:
                print(f"     addresses: {'; '.join(fmt_addr(a) for a in r['addrs'])}")
        else:
            print(f"     (no flavor data available)")
    print()


# ---------------------------------------------------------------------------
# Driver

def main():
    resolutions = load_resolutions()
    catalog_index, catalog_list = load_catalog_index()

    con = sqlite3.connect(DB_PATH)

    for label, uid in USERS:
        u = get_user(con, uid)
        u_label = f"{label} (id={uid}, @{u[0]})" if u else label
        print(f"╔══ {u_label}")
        print()

        # 1. Build user's shelf and flavor profile
        shelf = get_shelf(con, uid)
        user_pids = {pid for _, pid in shelf}
        user_addrs = print_shelf_summary(label.split()[0], shelf, catalog_index, con, resolutions)

        # 2. Type A — shelf-based
        if user_addrs:
            recs_a = shelf_based(user_addrs, user_pids, catalog_list, resolutions)
        else:
            recs_a = []
        print_shelf_recs(label.split()[0], recs_a)

        # 3. Type B — friend-based
        friends = get_user_follows(con, uid)
        recs_b = friend_based(user_addrs, user_pids, [f[0] for f in friends], catalog_index, con, resolutions)
        print_friend_recs(label.split()[0], friends, recs_b)

        print("╚" + "═" * 78)
        print()


if __name__ == "__main__":
    main()
