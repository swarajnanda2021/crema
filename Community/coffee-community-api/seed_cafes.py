"""
CRUD Utopia — pilot café seeder. Idempotent; safe to re-run.

Seeds 10 Goa pilot cafés with:
- Full profiles (address, instagram, hours, seasonal flags, Google Maps links)
- Logo URLs (Google favicons / Instagram thumbnails as placeholders)
- Owner accounts (username = <slug>_cafe, password = same as username)
- Menus simulating: single-roaster, multi-roaster, hidden-roaster, manual-only
- Baristas where notable (Harsh Raikar at Mochasa)

Run: python3 seed_cafes.py

See CRUD_UTOPIA.md at repo root.
"""

import json
import datetime
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import get_db, init_db
import passlib.hash as _passlib

bcrypt = _passlib.bcrypt


def now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Café profiles ───────────────────────────────────────────────────────────

# Hours format: { day: "HH:MM-HH:MM" or "Closed" }
DEFAULT_HOURS = {
    "mon": "9:00-18:00", "tue": "9:00-18:00", "wed": "9:00-18:00",
    "thu": "9:00-18:00", "fri": "9:00-18:00", "sat": "9:00-19:00",
    "sun": "9:00-19:00",
}

CAFES = [
    {
        "cafe_slug": "brightside-mandrem",
        "name": "Brightside Café",
        "about_blurb": "A small café opposite the Mahalaxmi Temple in Mandrem. Bagels, continental brunch, and some of the best coffee in Goa. Closed during monsoon.",
        "address": "Junas Waddo, opposite Mahalaxmi Temple, Mandrem, Goa 403527",
        "city": "Mandrem", "state": "Goa",
        "lat": 15.6770, "lng": 73.7180,
        "instagram_handle": "brightsidecafe_goa",
        "phone": None,
        "website": "https://maps.google.com/?q=Brightside+Cafe+Mandrem+Goa",
        "logo_url": "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:30-18:30", "tue": "8:30-18:30", "wed": "8:30-18:30", "thu": "8:30-18:30", "fri": "8:30-18:30", "sat": "8:30-18:30", "sun": "8:30-18:30"},
        "seasonal_open_month": 10, "seasonal_close_month": 5,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "brightside_cafe",
        "menu": [
            {"drink_name": "Pour Over", "roaster_slug": "subko-coffee-roasters", "manual_bean_name": "Single Origin Rotating", "roast_level": "Light", "process": "Washed"},
            {"drink_name": "Espresso", "roaster_slug": "subko-coffee-roasters", "manual_bean_name": "House Blend", "roast_level": "Medium", "process": "Washed"},
            {"drink_name": "Cold Brew", "roaster_slug": "subko-coffee-roasters", "hide_roaster": 1, "manual_bean_name": "House blend"},
            {"drink_name": "Cortado", "roaster_slug": "subko-coffee-roasters", "roast_level": "Medium"},
        ],
        "baristas": [
            {"name": "Apoorv"},
        ],
    },
    {
        "cafe_slug": "prana-goa",
        "name": "Prana Goa",
        "about_blurb": "Wellness café at Vaayu Waterman's Village in Ashwem. Multi-roaster pour menu featuring Pondicherry and Bangalore beans. Open year-round.",
        "address": "Vaayu Waterman's Village, Ashwem, Mandrem, Goa",
        "city": "Mandrem", "state": "Goa",
        "lat": 15.6850, "lng": 73.7220,
        "instagram_handle": "prana.goa",
        "website": "https://pranagoa.com",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=pranagoa.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:30-22:30", "tue": "8:30-22:30", "wed": "8:30-22:30", "thu": "8:30-22:30", "fri": "8:30-22:30", "sat": "8:30-22:30", "sun": "8:30-22:30"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "prana",
        "menu": [
            # Multi-roaster: same drink, different beans across rotations.
            # Pondicherry roaster isn't on our catalog yet — leave roaster blank for that one.
            {"drink_name": "Espresso", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Signature Blend", "roast_level": "Medium-Dark", "process": "Washed"},
            {"drink_name": "Espresso", "manual_bean_name": "Pondicherry Single Estate", "roast_level": "Medium", "process": "Natural"},
            {"drink_name": "Pour Over", "manual_bean_name": "Estate Reserve", "roast_level": "Light", "process": "Washed"},
            {"drink_name": "Pour Over", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Single Origin Ethiopia", "roast_level": "Light", "process": "Natural"},
            {"drink_name": "Cold Brew", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Cold Brew Reserve"},
            {"drink_name": "Cortado", "roaster_slug": "third-wave-coffee-roasters"},
        ],
        "baristas": [
            {"name": "Chef Varoon"},
        ],
    },
    {
        "cafe_slug": "moka-candolim",
        "name": "Moka",
        "about_blurb": "Specialty coffee with a barista-forward ethos. Single-estate Indian beans, manual brews celebrating local terroir, no artificial syrups. Featured in the Sprudge Guide to Coffee in Goa.",
        "address": "1204/D, Anna Vaddo Road, Candolim, Goa 403515",
        "city": "Candolim", "state": "Goa",
        "lat": 15.5226, "lng": 73.7625,
        "instagram_handle": "mokacoffeehouse",
        "website": "https://maps.google.com/?q=Mochasa+Coffee+House+Candolim",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:00-22:00", "tue": "8:00-22:00", "wed": "8:00-22:00", "thu": "8:00-22:00", "fri": "8:00-22:00", "sat": "8:00-22:00", "sun": "8:00-22:00"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "moka",
        "menu": [
            {"drink_name": "Espresso", "roaster_slug": "blue-tokai-coffee-roasters", "manual_bean_name": "Attikan Estate", "roast_level": "Medium", "process": "Washed"},
            {"drink_name": "AeroPress", "roaster_slug": "naivo-coffee-company", "manual_bean_name": "Berry Dawn Naturals", "roast_level": "Light", "process": "Natural"},
            {"drink_name": "AeroPress", "roaster_slug": "bombay-island-coffee-company", "manual_bean_name": "Vienna Roast", "roast_level": "Dark", "process": "Washed"},
            {"drink_name": "V60", "roaster_slug": "subko-coffee-roasters", "manual_bean_name": "Single Origin", "roast_level": "Light", "process": "Honey"},
            {"drink_name": "Mocha", "roaster_slug": "blue-tokai-coffee-roasters", "manual_bean_name": "House Blend", "roast_level": "Medium"},
            {"drink_name": "On the Rocks Cold Brew", "hide_roaster": 1, "manual_bean_name": "House blend"},
        ],
        "baristas": [
            {"name": "Harsh Raikar"},
            {"name": "Ashwini"},
        ],
    },
    {
        "cafe_slug": "alag-siolim",
        "name": "alag.",
        "about_blurb": "Women-led café in Siolim, sourcing from farms in Nagaland and Assam. Slow-living, community-focused, signature Japanese cheesecake and chunky cookies. Has its own loyalty program (alag.together).",
        "address": "House 9A-1A, Igroz Vaddo, Siolim, Goa",
        "city": "Siolim", "state": "Goa",
        "lat": 15.6271, "lng": 73.7551,
        "instagram_handle": "alag.cafe",
        "website": "https://alag.co",
        "phone": "+91 98348 03384",
        "logo_url": "https://www.google.com/s2/favicons?domain=alag.co&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "Closed", "tue": "9:00-18:00", "wed": "9:00-18:00", "thu": "9:00-18:00", "fri": "9:00-18:00", "sat": "9:00-19:00", "sun": "9:00-19:00"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "alag",
        "menu": [
            {"drink_name": "Pour Over", "manual_bean_name": "Northeast India Single Origin", "roast_level": "Light", "process": "Washed"},
            {"drink_name": "Espresso", "manual_bean_name": "House Blend", "roast_level": "Medium"},
            {"drink_name": "Cortado", "manual_bean_name": "House Blend"},
            {"drink_name": "Cold Brew"},
        ],
        "baristas": [],
    },
    {
        "cafe_slug": "cafe-69-morjim",
        "name": "Café 69",
        "about_blurb": "Cozy, homely café in Morjim known for its eggs benedict, crepes, and unique interior. Also has a sister location in Arambol.",
        "address": "EHN 43, New Wada, Morjim, Goa",
        "city": "Morjim", "state": "Goa",
        "lat": 15.6304, "lng": 73.7332,
        "instagram_handle": "69coffeefood",
        "website": "https://maps.google.com/?q=Cafe+69+Morjim",
        "phone": "+91 9960361350",
        "logo_url": "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "9:30-18:00", "tue": "9:30-18:00", "wed": "9:30-18:00", "thu": "9:30-18:00", "fri": "9:30-18:00", "sat": "9:30-18:00", "sun": "9:30-18:00"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "cafe69",
        "menu": [
            {"drink_name": "Espresso", "roaster_slug": "blue-tokai-coffee-roasters", "manual_bean_name": "House Blend", "roast_level": "Medium"},
            {"drink_name": "Iced Coffee", "roaster_slug": "blue-tokai-coffee-roasters", "manual_bean_name": "Cold Brew Blend"},
            {"drink_name": "Latte", "roaster_slug": "blue-tokai-coffee-roasters"},
        ],
        "baristas": [],
    },
    {
        "cafe_slug": "ondo-ashvem",
        "name": "Ondo Goa",
        "about_blurb": "Gelato + coffee on Ashvem Beach Road. Affogato is the signature.",
        "address": "Shop 147, Ashvem Beach Road, Mandrem, Goa 403527",
        "city": "Mandrem", "state": "Goa",
        "lat": 15.6810, "lng": 73.7195,
        "instagram_handle": "ondo.gelato",
        "website": "https://maps.google.com/?q=Ondo+Goa+Ashvem",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "11:00-22:00", "tue": "11:00-22:00", "wed": "11:00-22:00", "thu": "11:00-22:00", "fri": "11:00-22:00", "sat": "11:00-23:00", "sun": "11:00-23:00"},
        "seasonal_open_month": 10, "seasonal_close_month": 5,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free affogato",
        "owner_password": "ondo",
        "menu": [
            {"drink_name": "Affogato"},
            {"drink_name": "Iced Coffee"},
            {"drink_name": "Espresso", "roast_level": "Medium"},
        ],
        "baristas": [],
    },
    {
        "cafe_slug": "third-wave-panjim",
        "name": "Third Wave Coffee — Panjim",
        "about_blurb": "Bangalore's Third Wave outpost in Panjim. Reliable specialty coffee, signature filter, friendly seating.",
        "address": "18th June Road, Panjim, Goa 403001",
        "city": "Panjim", "state": "Goa",
        "lat": 15.4989, "lng": 73.8278,
        "instagram_handle": "thirdwavecoffeeroasters",
        "website": "https://thirdwavecoffeeroasters.com",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=thirdwavecoffeeroasters.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:00-22:00", "tue": "8:00-22:00", "wed": "8:00-22:00", "thu": "8:00-22:00", "fri": "8:00-23:00", "sat": "8:00-23:00", "sun": "8:00-22:00"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "thirdwave",
        "menu": [
            {"drink_name": "Espresso", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Signature Blend", "roast_level": "Medium", "process": "Washed"},
            {"drink_name": "Filter Coffee", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "South Indian Filter Blend", "roast_level": "Dark", "process": "Washed"},
            {"drink_name": "Pour Over", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Single Origin Rotation", "roast_level": "Light"},
            {"drink_name": "Cold Brew", "roaster_slug": "third-wave-coffee-roasters", "manual_bean_name": "Cold Brew Blend"},
            {"drink_name": "Cortado", "roaster_slug": "third-wave-coffee-roasters"},
        ],
        "baristas": [],
    },
    {
        "cafe_slug": "artjuna-anjuna",
        "name": "Artjuna",
        "about_blurb": "Garden café in Anjuna with a Mediterranean-Israeli kitchen. Live music nights, shaded courtyard, all-day breakfast.",
        "address": "Monteiro Vaddo, Anjuna, Goa 403509",
        "city": "Anjuna", "state": "Goa",
        "lat": 15.5750, "lng": 73.7430,
        "instagram_handle": "artjuna",
        "website": "https://maps.google.com/?q=Artjuna+Anjuna+Goa",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:30-22:30", "tue": "8:30-22:30", "wed": "8:30-22:30", "thu": "8:30-22:30", "fri": "8:30-23:00", "sat": "8:30-23:00", "sun": "8:30-22:30"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "artjuna",
        "menu": [
            {"drink_name": "Espresso", "roaster_slug": "subko-coffee-roasters", "manual_bean_name": "Signature Blend", "roast_level": "Medium"},
            {"drink_name": "Cortado", "roaster_slug": "subko-coffee-roasters", "manual_bean_name": "Signature Blend"},
            {"drink_name": "Cold Brew", "roaster_slug": "subko-coffee-roasters"},
        ],
        "baristas": [],
    },
    {
        "cafe_slug": "nada-anjuna",
        "name": "Nada Coffee Roasters — Anjuna",
        "about_blurb": "The Anjuna roastery and café from Nada Coffee Roasters. They roast their own beans on-site — taste them straight from the source.",
        "address": "Monteiro Vaddo, Anjuna, Goa 403509",
        "city": "Anjuna", "state": "Goa",
        "lat": 15.5740, "lng": 73.7400,
        "instagram_handle": "nadacoffee",
        "website": "https://nadacoffee.in",
        "phone": None,
        "logo_url": "https://www.google.com/s2/favicons?domain=nadacoffee.in&sz=128",
        "cover_image_url": None,
        "hours_json": {"mon": "8:00-20:00", "tue": "8:00-20:00", "wed": "8:00-20:00", "thu": "8:00-20:00", "fri": "8:00-21:00", "sat": "8:00-21:00", "sun": "8:00-20:00"},
        "seasonal_open_month": None, "seasonal_close_month": None,
        "stamps_enabled": 1, "stamp_target": 10, "stamp_reward": "Free coffee",
        "owner_password": "nadacafe",
        "menu": [
            # All Nada — they're a roaster + café, so all beans are theirs
            {"drink_name": "Espresso", "roaster_slug": "nada-coffee", "product_id": "nada-coffee_gangecool-estate-washed", "manual_bean_name": "Gangecool Estate — Washed", "roast_level": "Medium", "process": "Washed"},
            {"drink_name": "Pour Over", "roaster_slug": "nada-coffee", "product_id": "nada-coffee_ratnagiri-estate-l8-washed", "manual_bean_name": "Ratnagiri L8 Washed", "roast_level": "Medium", "process": "Anaerobic"},
            {"drink_name": "Pour Over", "roaster_slug": "nada-coffee", "product_id": "nada-coffee_ratnagiri-estate-rg-3", "manual_bean_name": "Ratnagiri RG-3", "roast_level": "Medium", "process": "Anaerobic"},
            {"drink_name": "Cortado", "roaster_slug": "nada-coffee", "product_id": "nada-coffee_gangecool-estate-washed", "manual_bean_name": "Gangecool Estate — Washed"},
            {"drink_name": "AeroPress", "roaster_slug": "nada-coffee", "product_id": "nada-coffee_ratnagiri-estate-dh-5", "manual_bean_name": "Ratnagiri DH-5", "roast_level": "Medium"},
        ],
        "baristas": [],
    },
]


def upsert_cafe(db, cafe):
    """Insert or update a café profile."""
    existing = db.execute("SELECT cafe_slug FROM cafe_profiles WHERE cafe_slug = ?", (cafe["cafe_slug"],)).fetchone()
    fields = {
        "cafe_slug": cafe["cafe_slug"],
        "name": cafe["name"],
        "about_blurb": cafe["about_blurb"],
        "cover_image_url": cafe.get("cover_image_url"),
        "logo_url": cafe.get("logo_url"),
        "address": cafe.get("address"),
        "city": cafe.get("city"),
        "state": cafe.get("state"),
        "lat": cafe.get("lat"),
        "lng": cafe.get("lng"),
        "instagram_handle": cafe.get("instagram_handle"),
        "website": cafe.get("website"),
        "phone": cafe.get("phone"),
        "hours_json": json.dumps(cafe.get("hours_json")) if cafe.get("hours_json") else None,
        "seasonal_open_month": cafe.get("seasonal_open_month"),
        "seasonal_close_month": cafe.get("seasonal_close_month"),
        "stamps_enabled": cafe.get("stamps_enabled", 1),
        "stamp_target": cafe.get("stamp_target", 10),
        "stamp_reward": cafe.get("stamp_reward", "Free coffee"),
        "updated_at": now(),
    }
    if existing:
        sets = ", ".join(f"{k} = ?" for k in fields if k != "cafe_slug")
        vals = [v for k, v in fields.items() if k != "cafe_slug"] + [cafe["cafe_slug"]]
        db.execute(f"UPDATE cafe_profiles SET {sets} WHERE cafe_slug = ?", vals)
        print(f"  ✓ Updated café: {cafe['name']}")
    else:
        cols = list(fields.keys()) + ["created_at"]
        placeholders = ", ".join("?" * len(cols))
        vals = list(fields.values()) + [now()]
        db.execute(f"INSERT INTO cafe_profiles ({', '.join(cols)}) VALUES ({placeholders})", vals)
        print(f"  + Inserted café: {cafe['name']}")


def upsert_owner_account(db, cafe):
    """Create/update a user account for the café owner. Mirrors the
    café's logo + crop into users.avatar_* so the navbar / dropdown /
    every sitewide avatar thumbnail renders the café's brand mark
    without waiting for the sync_cafe_logo_to_user hook (which only
    fires on profile updates, not on seed-time INSERTs)."""
    username = f"{cafe['cafe_slug'].replace('-', '_')}_cafe"
    password = cafe.get("owner_password", cafe["cafe_slug"].replace("-", "_"))
    pwd_hash = bcrypt.hash(password)

    # Pull the logo that was just written to cafe_profiles so the new
    # user row starts life with a visible avatar.
    profile_row = db.execute(
        "SELECT logo_url, logo_crop_x, logo_crop_y, logo_zoom FROM cafe_profiles WHERE cafe_slug = ?",
        (cafe["cafe_slug"],),
    ).fetchone()
    avatar_url = profile_row["logo_url"] if profile_row else None
    crop_x = (profile_row["logo_crop_x"] if profile_row else None) or 50
    crop_y = (profile_row["logo_crop_y"] if profile_row else None) or 50
    zoom   = (profile_row["logo_zoom"]   if profile_row else None) or 1

    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        # On update we only refresh the avatar when it was previously
        # empty — the owner may have picked a different avatar in-app.
        db.execute(
            """UPDATE users
               SET password_hash = ?, account_type = 'cafe', cafe_slug = ?, display_name = ?,
                   avatar_url = CASE WHEN (avatar_url IS NULL OR avatar_url = '') THEN ? ELSE avatar_url END,
                   avatar_crop_x = CASE WHEN (avatar_url IS NULL OR avatar_url = '') THEN ? ELSE avatar_crop_x END,
                   avatar_crop_y = CASE WHEN (avatar_url IS NULL OR avatar_url = '') THEN ? ELSE avatar_crop_y END,
                   avatar_zoom   = CASE WHEN (avatar_url IS NULL OR avatar_url = '') THEN ? ELSE avatar_zoom END
               WHERE username = ?""",
            (pwd_hash, cafe["cafe_slug"], cafe["name"],
             avatar_url, crop_x, crop_y, zoom, username),
        )
        print(f"    ✓ Updated owner: {username} / {password}")
    else:
        db.execute(
            "INSERT INTO users (username, display_name, password_hash, account_type, cafe_slug, "
            "avatar_url, avatar_crop_x, avatar_crop_y, avatar_zoom, created_at) "
            "VALUES (?, ?, ?, 'cafe', ?, ?, ?, ?, ?, ?)",
            (username, cafe["name"], pwd_hash, cafe["cafe_slug"],
             avatar_url, crop_x, crop_y, zoom, now()),
        )
        print(f"    + Created owner: {username} / {password}")


def replace_menu(db, cafe):
    """Wipe and re-seed the menu for a café (idempotent)."""
    db.execute("DELETE FROM cafe_menu_items WHERE cafe_slug = ?", (cafe["cafe_slug"],))
    for i, item in enumerate(cafe.get("menu", [])):
        cols = ["cafe_slug", "drink_name", "drink_order", "roaster_slug", "product_id",
                "manual_roaster_name", "manual_roaster_url", "manual_bean_name",
                "roast_level", "process", "notes", "hide_roaster", "created_at"]
        vals = [
            cafe["cafe_slug"],
            item["drink_name"],
            i,
            item.get("roaster_slug"),
            item.get("product_id"),
            item.get("manual_roaster_name"),
            item.get("manual_roaster_url"),
            item.get("manual_bean_name"),
            item.get("roast_level"),
            item.get("process"),
            item.get("notes"),
            item.get("hide_roaster", 0),
            now(),
        ]
        db.execute(
            f"INSERT INTO cafe_menu_items ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            vals,
        )
    print(f"    + {len(cafe.get('menu', []))} menu items")


def cleanup_obsolete(db):
    """Remove cafés that were seeded under old slugs but consolidated/renamed,
    plus any lingering cafe_baristas rows now that the feature is removed."""
    obsolete_slugs = ["moka-siolim", "mochasa-candolim"]
    for slug in obsolete_slugs:
        existing = db.execute("SELECT cafe_slug FROM cafe_profiles WHERE cafe_slug = ?", (slug,)).fetchone()
        if existing:
            db.execute("DELETE FROM cafe_menu_items WHERE cafe_slug = ?", (slug,))
            db.execute("DELETE FROM stamps WHERE cafe_slug = ?", (slug,))
            db.execute("DELETE FROM stamp_rewards WHERE cafe_slug = ?", (slug,))
            db.execute("DELETE FROM cafe_profiles WHERE cafe_slug = ?", (slug,))
            # Also remove orphaned owner accounts
            owner_username = f"{slug.replace('-', '_')}_cafe"
            db.execute("DELETE FROM users WHERE username = ?", (owner_username,))
            print(f"  - Removed obsolete: {slug}")
    # Best-effort wipe of the (now unused) baristas table; ignore if the
    # table no longer exists on fresh installs.
    try:
        db.execute("DELETE FROM cafe_baristas")
    except Exception:
        pass
    db.commit()


def main():
    print("Initializing DB…")
    init_db()
    db = get_db()
    try:
        cleanup_obsolete(db)
        print(f"\nSeeding {len(CAFES)} pilot cafés:\n")
        for cafe in CAFES:
            print(f"\n{cafe['name']}:")
            upsert_cafe(db, cafe)
            upsert_owner_account(db, cafe)
            replace_menu(db, cafe)
        db.commit()

        # Print credentials summary
        print("\n" + "=" * 60)
        print("CAFÉ OWNER CREDENTIALS:")
        print("=" * 60)
        for cafe in CAFES:
            username = f"{cafe['cafe_slug'].replace('-', '_')}_cafe"
            password = cafe.get("owner_password", cafe["cafe_slug"].replace("-", "_"))
            print(f"  {cafe['name']:40s}  →  {username}  /  {password}")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
