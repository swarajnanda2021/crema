"""
SQLite database connection and table creation.
Auto-creates coffee_community.db on first run.
"""

import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "coffee_community.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    shelf TEXT NOT NULL CHECK (shelf IN ('open_bags', 'on_the_list')),
    added_at TEXT NOT NULL,
    moved_at TEXT NOT NULL,
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS tasting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    -- Tasting attributes (1-5 sliders)
    acidity INTEGER CHECK (acidity BETWEEN 1 AND 5),
    body INTEGER CHECK (body BETWEEN 1 AND 5),
    sweetness INTEGER CHECK (sweetness BETWEEN 1 AND 5),
    aftertaste INTEGER CHECK (aftertaste BETWEEN 1 AND 5),
    flavor_tags TEXT,
    -- Brew recipe
    brew_method TEXT,
    drink_style TEXT,
    milk_type TEXT,
    dose_grams REAL,
    yield_grams REAL,
    water_ml REAL,
    extraction_time_secs INTEGER,
    water_temp_celsius INTEGER,
    grind_size TEXT,
    brew_ratio TEXT,
    -- Meta
    comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    product_id TEXT NOT NULL,
    roaster_slug TEXT NOT NULL,
    source_page TEXT NOT NULL,
    clicked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shelf_user ON shelf_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_shelf_product ON shelf_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON tasting_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_product ON tasting_notes(product_id);
CREATE INDEX IF NOT EXISTS idx_clicks_roaster ON click_events(roaster_slug);
CREATE INDEX IF NOT EXISTS idx_clicks_product ON click_events(product_id);

CREATE TABLE IF NOT EXISTS note_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    note_id INTEGER NOT NULL REFERENCES tasting_notes(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, note_id)
);

CREATE TABLE IF NOT EXISTS note_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    note_id INTEGER NOT NULL REFERENCES tasting_notes(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_likes_note ON note_likes(note_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON note_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_note ON note_comments(note_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON note_comments(user_id);
"""


def get_db():
    """Get a database connection (per-request). Creates tables on first call."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN bio TEXT",
    "ALTER TABLE users ADD COLUMN avatar_url TEXT",
    "ALTER TABLE users ADD COLUMN location TEXT",
    "ALTER TABLE users ADD COLUMN coffee_preference TEXT",
    "ALTER TABLE users ADD COLUMN brewing_style TEXT",
    "ALTER TABLE tasting_notes ADD COLUMN blend_components TEXT",
    # Roaster account columns
    "ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN roaster_slug TEXT",
    # Roaster posts table
    """CREATE TABLE IF NOT EXISTS roaster_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        teaser TEXT NOT NULL,
        external_url TEXT,
        cover_image_url TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_rposts_slug ON roaster_posts(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_rposts_user ON roaster_posts(user_id)",
    # Featured post columns
    "ALTER TABLE roaster_posts ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE roaster_posts ADD COLUMN featured_order INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_rposts_featured ON roaster_posts(roaster_slug, is_featured)",
    # Post type and location for note posts
    "ALTER TABLE roaster_posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'article'",
    "ALTER TABLE roaster_posts ADD COLUMN location TEXT",
    # Multiple images support
    "ALTER TABLE roaster_posts ADD COLUMN images_json TEXT",
    # Roaster profiles — editable metadata (overrides static enrichment data)
    """CREATE TABLE IF NOT EXISTS roaster_profiles (
        roaster_slug TEXT PRIMARY KEY,
        about_blurb TEXT,
        specialties TEXT,
        website TEXT,
        city TEXT,
        logo_url TEXT,
        hero_image_url TEXT,
        updated_at TEXT NOT NULL
    )""",
    "ALTER TABLE roaster_profiles ADD COLUMN hero_crop_y REAL DEFAULT 50",
    # Follows table
    """CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_user_id INTEGER NOT NULL REFERENCES users(id),
        roaster_slug TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(follower_user_id, roaster_slug)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_follows_slug ON follows(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(follower_user_id)",
    # Roaster-managed products (beans added by roaster accounts)
    """CREATE TABLE IF NOT EXISTS roaster_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        coffee_name TEXT NOT NULL,
        roast_level TEXT,
        tasting_notes TEXT,
        origin TEXT,
        process TEXT,
        varietal TEXT,
        altitude_masl INTEGER,
        bean_type TEXT,
        flavor_notes TEXT,
        weight_grams INTEGER,
        price_inr REAL,
        image_url TEXT,
        product_url TEXT,
        description_raw TEXT,
        available INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_rproducts_slug ON roaster_products(roaster_slug)",
    # Hidden products — lets roasters persistently hide scraped products they don't want
    """CREATE TABLE IF NOT EXISTS hidden_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        product_id TEXT NOT NULL,
        hidden_at TEXT NOT NULL,
        UNIQUE(roaster_slug, product_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_hidden_slug ON hidden_products(roaster_slug)",
    # ── Post system expansion: repost, tasting_note link, edit tracking ──
    "ALTER TABLE roaster_posts ADD COLUMN repost_of_id INTEGER",
    "ALTER TABLE roaster_posts ADD COLUMN repost_comment TEXT",
    "ALTER TABLE roaster_posts ADD COLUMN tasting_note_id INTEGER",
    "ALTER TABLE roaster_posts ADD COLUMN updated_at TEXT",
    # Post-level social interactions (likes + comments on posts, not just tasting notes)
    """CREATE TABLE IF NOT EXISTS post_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        post_id INTEGER NOT NULL REFERENCES roaster_posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, post_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id)",
    """CREATE TABLE IF NOT EXISTS post_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        post_id INTEGER NOT NULL REFERENCES roaster_posts(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id)",
    # Comment likes
    """CREATE TABLE IF NOT EXISTS comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        comment_id INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, comment_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id)",
    # Updated_at for post_comments (for edit tracking)
    "ALTER TABLE post_comments ADD COLUMN updated_at TEXT",
    # User profile extra fields
    "ALTER TABLE users ADD COLUMN favorite_drink TEXT",
    "ALTER TABLE users ADD COLUMN favorite_cafe TEXT",
    # Avatar crop position (0-100, default 50 = centered)
    "ALTER TABLE users ADD COLUMN avatar_crop_x REAL DEFAULT 50",
    "ALTER TABLE users ADD COLUMN avatar_crop_y REAL DEFAULT 50",
    "ALTER TABLE users ADD COLUMN avatar_zoom REAL DEFAULT 1",
    # Roaster hero crop X + zoom
    "ALTER TABLE roaster_profiles ADD COLUMN hero_crop_x REAL DEFAULT 50",
    "ALTER TABLE roaster_profiles ADD COLUMN hero_zoom REAL DEFAULT 1",
    # Roaster profile name + state (for city filter and display)
    "ALTER TABLE roaster_profiles ADD COLUMN name TEXT",
    "ALTER TABLE roaster_profiles ADD COLUMN state TEXT",
    # Notifications
    """CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        actor_id INTEGER NOT NULL REFERENCES users(id),
        post_id INTEGER,
        comment_id INTEGER,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read)",
    # Performance indexes added during codebase audit
    "CREATE INDEX IF NOT EXISTS idx_posts_slug_pub ON roaster_posts(roaster_slug, published_at)",
    "CREATE INDEX IF NOT EXISTS idx_posts_slug_feat ON roaster_posts(roaster_slug, is_featured)",
    "CREATE INDEX IF NOT EXISTS idx_posts_published ON roaster_posts(published_at)",
    "CREATE INDEX IF NOT EXISTS idx_posts_user ON roaster_posts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_follows_user_slug ON follows(follower_user_id, roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_users_roaster_slug ON users(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id)",
    # Comment replies
    "ALTER TABLE post_comments ADD COLUMN parent_id INTEGER",
    # Unified products table (CRUD utopia — replaces file-loading)
    """CREATE TABLE IF NOT EXISTS products (
        product_id TEXT PRIMARY KEY,
        roaster_slug TEXT NOT NULL,
        roaster_name TEXT,
        coffee_name TEXT NOT NULL,
        roast_level TEXT,
        tasting_notes TEXT,
        origin TEXT,
        process TEXT,
        varietal TEXT,
        altitude_masl INTEGER,
        bean_type TEXT,
        flavor_notes TEXT,
        weight_grams INTEGER,
        price_inr REAL,
        image_url TEXT,
        product_url TEXT,
        description_raw TEXT,
        available INTEGER DEFAULT 1,
        source TEXT DEFAULT 'scraped',
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_products_roaster ON products(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_available ON products(available)",
    # ── Café entity (see CRUD_UTOPIA.md) ───────────────────────────────────
    """CREATE TABLE IF NOT EXISTS cafe_profiles (
        cafe_slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        about_blurb TEXT,
        cover_image_url TEXT,
        logo_url TEXT,
        hero_crop_x REAL DEFAULT 50,
        hero_crop_y REAL DEFAULT 50,
        hero_zoom REAL DEFAULT 1,
        address TEXT,
        city TEXT,
        state TEXT,
        lat REAL,
        lng REAL,
        instagram_handle TEXT,
        website TEXT,
        phone TEXT,
        hours_json TEXT,
        seasonal_open_month INTEGER,
        seasonal_close_month INTEGER,
        stamps_enabled INTEGER DEFAULT 0,
        stamp_target INTEGER DEFAULT 10,
        stamp_reward TEXT DEFAULT 'Free coffee',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_cafes_city ON cafe_profiles(city)",
    """CREATE TABLE IF NOT EXISTS cafe_menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cafe_slug TEXT NOT NULL REFERENCES cafe_profiles(cafe_slug) ON DELETE CASCADE,
        drink_name TEXT NOT NULL,
        drink_order INTEGER DEFAULT 0,
        roaster_slug TEXT,
        product_id TEXT,
        manual_roaster_name TEXT,
        manual_roaster_url TEXT,
        manual_bean_name TEXT,
        roast_level TEXT,
        process TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_menu_cafe ON cafe_menu_items(cafe_slug, drink_order)",
    # cafe_baristas table removed — feature cut. Old installs keep it
    # as dead weight; no DROP migration.
    """CREATE TABLE IF NOT EXISTS stamps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        cafe_slug TEXT NOT NULL REFERENCES cafe_profiles(cafe_slug) ON DELETE CASCADE,
        scanned_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_stamps_user ON stamps(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_stamps_cafe ON stamps(cafe_slug)",
    "CREATE INDEX IF NOT EXISTS idx_stamps_user_cafe ON stamps(user_id, cafe_slug)",
    """CREATE TABLE IF NOT EXISTS stamp_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        cafe_slug TEXT NOT NULL REFERENCES cafe_profiles(cafe_slug) ON DELETE CASCADE,
        stamps_used INTEGER NOT NULL,
        redeemed_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_rewards_user_cafe ON stamp_rewards(user_id, cafe_slug)",
    """CREATE TABLE IF NOT EXISTS qr_tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_qr_user ON qr_tokens(user_id)",
    # Extend users to support café owner accounts
    "ALTER TABLE users ADD COLUMN cafe_slug TEXT",
    # Extend follows with target_type discriminator (for café follows alongside roaster follows)
    "ALTER TABLE follows ADD COLUMN target_type TEXT NOT NULL DEFAULT 'roaster'",
    # Posts can tag a café as location entity
    "ALTER TABLE roaster_posts ADD COLUMN cafe_slug TEXT",
    "CREATE INDEX IF NOT EXISTS idx_posts_cafe ON roaster_posts(cafe_slug)",
    # Café menu items: optional flag to hide roaster credit (some cafés safeguard their sourcing)
    "ALTER TABLE cafe_menu_items ADD COLUMN hide_roaster INTEGER NOT NULL DEFAULT 0",
    # Catalog-change notifications (add/remove coffee, add/remove/update menu
    # item): fanned out to all followers of the roaster or café.
    # target_slug: 'roaster:blue-tokai' or 'cafe:prana-goa'
    # subject: free-text label ("Gangecool Estate — Washed", "Filter Coffee")
    "ALTER TABLE notifications ADD COLUMN target_slug TEXT",
    "ALTER TABLE notifications ADD COLUMN subject TEXT",
    # Café logo drag/zoom reposition (same pattern as users.avatar_crop_* and
    # roaster_profiles.hero_crop_*). The resulting crop is mirrored to
    # users.avatar_crop_x/y/zoom on update so the navbar avatar matches.
    "ALTER TABLE cafe_profiles ADD COLUMN logo_crop_x REAL DEFAULT 50",
    "ALTER TABLE cafe_profiles ADD COLUMN logo_crop_y REAL DEFAULT 50",
    "ALTER TABLE cafe_profiles ADD COLUMN logo_zoom REAL DEFAULT 1",
    # Admin flag — gates the /api/stats/traction endpoint. Only the seeded
    # "crema" account gets is_admin=1. Defense in depth: endpoint checks both
    # is_admin=1 AND username="crema".
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    # ── Phase 1 §2.6 Café procurement profile ─────────────────────────────
    # Optional café-owner-editable fields that qualify a wholesale lead.
    # Exposed publicly on the café profile (owner edit) so roasters
    # receiving a §2.1 "Interested" inquiry can assess volume + fit.
    "ALTER TABLE cafe_profiles ADD COLUMN monthly_volume_kg INTEGER",
    "ALTER TABLE cafe_profiles ADD COLUMN open_to_new_roasters INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE cafe_profiles ADD COLUMN procurement_note TEXT",
    # ── Phase 1 §2.1 Wholesale inquiries ───────────────────────────────────
    # A café-to-roaster "Interested" handshake. `product_id` is optional:
    # an inquiry may target a specific product or the roaster in general.
    # Status lifecycle: open → responded → archived. The note is optional
    # café context ("we brew ~30 kg/mo, looking for a washed Ethiopian").
    """CREATE TABLE IF NOT EXISTS wholesale_inquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cafe_slug TEXT NOT NULL,
        roaster_slug TEXT NOT NULL,
        product_id TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_winquiries_roaster ON wholesale_inquiries(roaster_slug, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_winquiries_cafe ON wholesale_inquiries(cafe_slug, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_winquiries_status ON wholesale_inquiries(status)",
    # ── Phase 1 §2.2 Wholesale availability signal ──────────────────────
    # Roaster-set per-product flag + optional minimum order + note. A
    # "Wholesale" badge renders on the product card — visible only to
    # café accounts (filter enforced client-side; the field is public).
    "ALTER TABLE products ADD COLUMN wholesale_available INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN wholesale_minimum_kg INTEGER",
    "ALTER TABLE products ADD COLUMN wholesale_note TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_wholesale ON products(wholesale_available)",
    # Roaster-created beans live in a separate table — mirror the same
    # columns so the badge and filter behave consistently across both
    # catalog sources.
    "ALTER TABLE roaster_products ADD COLUMN wholesale_available INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE roaster_products ADD COLUMN wholesale_minimum_kg INTEGER",
    "ALTER TABLE roaster_products ADD COLUMN wholesale_note TEXT",
    "CREATE INDEX IF NOT EXISTS idx_rproducts_wholesale ON roaster_products(wholesale_available)",
    # ── Phase 1 §2.3 Sourcing story posts ──────────────────────────────
    # Long-form body for post_type = 'sourcing_story'. The existing
    # `teaser` column stays the short excerpt shown in the feed;
    # body_full holds the expanded content (up to ~5000 chars, no hard
    # SQL limit — enforced client-side). Null for any other post type.
    "ALTER TABLE roaster_posts ADD COLUMN body_full TEXT",
    # ── Avatar-mirror backfill ─────────────────────────────────────────
    # The `sync_cafe_logo_to_user` / `sync_roaster_logo_to_user` hooks
    # only fire when a café or roaster *updates* their profile. Rows
    # seeded via direct INSERT never triggered the hook, so users whose
    # entity had a logo set at seed time ended up with avatar_url=''.
    # Result: the navbar + dropdown + any avatar thumbnail site-wide
    # showed a blank circle for most café accounts.
    #
    # The two statements below fill the gap idempotently — they only
    # touch user rows whose avatar is still empty, so once an owner
    # picks a different avatar via the in-app editor the backfill won't
    # clobber it.
    """UPDATE users
       SET avatar_url  = (SELECT logo_url      FROM cafe_profiles cp WHERE cp.cafe_slug = users.cafe_slug),
           avatar_crop_x = COALESCE((SELECT logo_crop_x FROM cafe_profiles cp WHERE cp.cafe_slug = users.cafe_slug), avatar_crop_x),
           avatar_crop_y = COALESCE((SELECT logo_crop_y FROM cafe_profiles cp WHERE cp.cafe_slug = users.cafe_slug), avatar_crop_y),
           avatar_zoom   = COALESCE((SELECT logo_zoom   FROM cafe_profiles cp WHERE cp.cafe_slug = users.cafe_slug), avatar_zoom)
       WHERE account_type = 'cafe'
         AND cafe_slug IS NOT NULL
         AND (avatar_url IS NULL OR avatar_url = '')
         AND EXISTS (SELECT 1 FROM cafe_profiles cp WHERE cp.cafe_slug = users.cafe_slug AND cp.logo_url IS NOT NULL AND cp.logo_url <> '')
    """,
    """UPDATE users
       SET avatar_url = (SELECT logo_url FROM roaster_profiles rp WHERE rp.roaster_slug = users.roaster_slug)
       WHERE account_type = 'roaster'
         AND roaster_slug IS NOT NULL
         AND (avatar_url IS NULL OR avatar_url = '')
         AND EXISTS (SELECT 1 FROM roaster_profiles rp WHERE rp.roaster_slug = users.roaster_slug AND rp.logo_url IS NOT NULL AND rp.logo_url <> '')
    """,
    # ── Phase 1 §2.5 Brew method cards ─────────────────────────────────
    # Roaster-submitted recipe cards that sit in a product's carousel
    # alongside user-submitted tasting notes. One row per method per
    # product. `method` is a short enum ('espresso', 'pour_over',
    # 'aeropress', 'french_press', 'cold_brew', 'moka', 'other'). Shared
    # recipe fields are explicit columns; anything method-specific that
    # doesn't fit lands in `fields_json` so the schema doesn't need a
    # migration every time a new method-specific field shows up.
    """CREATE TABLE IF NOT EXISTS brew_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        roaster_slug TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        method TEXT NOT NULL,
        dose_grams REAL,
        yield_grams REAL,
        water_ml REAL,
        ratio TEXT,
        brew_time_secs INTEGER,
        bloom_secs INTEGER,
        water_temp_celsius INTEGER,
        grind_size TEXT,
        grind_setting TEXT,
        notes TEXT,
        fields_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_brew_methods_product ON brew_methods(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_brew_methods_roaster ON brew_methods(roaster_slug)",
    # ── Inquiry thread messages (short-form chat between café + roaster) ─
    # One row per message. Either party (the inquiring café or the
    # recipient roaster) can read + write. Deletion cascades with the
    # parent inquiry.
    """CREATE TABLE IF NOT EXISTS inquiry_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inquiry_id INTEGER NOT NULL REFERENCES wholesale_inquiries(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_inquiry_msgs_inquiry ON inquiry_messages(inquiry_id, created_at)",
    # Notifications grow an optional inquiry_id so a wholesale_inquiry
    # or inquiry_reply notification can deep-link to the exact thread.
    "ALTER TABLE notifications ADD COLUMN inquiry_id INTEGER",
    # Per-party last-read timestamps on wholesale inquiries — powers
    # the unread badge in the Messages inbox. Split by party so one
    # side marking a thread read doesn't clear the other's badge.
    "ALTER TABLE wholesale_inquiries ADD COLUMN cafe_last_read_at TEXT",
    "ALTER TABLE wholesale_inquiries ADD COLUMN roaster_last_read_at TEXT",
    # ── Favorite café "like" (scarce, exactly one per user) ─────────────
    # Distinct from follows: follows are plural + casual, this is one
    # cult-status café per user. Stored as FK on users; the old free-
    # text `favorite_cafe` column stays for a migration period.
    "ALTER TABLE users ADD COLUMN favorite_cafe_slug TEXT",
    "CREATE INDEX IF NOT EXISTS idx_users_fav_cafe ON users(favorite_cafe_slug)",
    # ── User-to-user direct messages ────────────────────────────────────
    # Canonical pair ordering: user_a_id < user_b_id so (A↔B) and (B↔A)
    # collapse to the same row. Last-read stamped per participant.
    """CREATE TABLE IF NOT EXISTS direct_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a_id INTEGER NOT NULL REFERENCES users(id),
        user_b_id INTEGER NOT NULL REFERENCES users(id),
        user_a_last_read_at TEXT,
        user_b_last_read_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        CHECK (user_a_id < user_b_id),
        UNIQUE (user_a_id, user_b_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_dthreads_a ON direct_threads(user_a_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_dthreads_b ON direct_threads(user_b_id, updated_at)",
    """CREATE TABLE IF NOT EXISTS direct_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL REFERENCES direct_threads(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_dmessages_thread ON direct_messages(thread_id, created_at)",
    # Notifications can now deep-link to a direct_thread too.
    "ALTER TABLE notifications ADD COLUMN direct_thread_id INTEGER",
    # ── Recycle bin / trash ───────────────────────────────────────────────
    # Central capture table for every destructive delete a user performs.
    # `entity_type` maps to a registry resource name ("posts", "post_comments",
    # "tasting_notes", "shelf_entries", "cafe_menu_items", "brew_methods")
    # or a synthetic label for non-registry deletes ("roaster_products").
    # `payload_json` is a verbatim snapshot of the row at delete time, used
    # both for the bin UI preview and for the restore INSERT. `owner_user_id`
    # is the user whose bin the item lives in — for user-owned rows it's
    # `row.user_id`; for café / roaster-owned rows it's the account-owner's
    # user id resolved through `cafe_profiles.owner_user_id` /
    # `roaster_profiles.owner_user_id`.
    """CREATE TABLE IF NOT EXISTS trash (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        label TEXT,
        deleted_at TEXT NOT NULL,
        deleted_by_user_id INTEGER REFERENCES users(id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_trash_owner ON trash(owner_user_id, deleted_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_trash_entity ON trash(entity_type, entity_id)",
    # ── Café menu pricing — hot + iced split + alt-milk surcharges ──────
    # Until now `cafe_menu_items` had no pricing column at all; the menu
    # table fell back to the joined catalog product price (which is the
    # roaster's retail bag price, not what the café charges per cup).
    # `price_inr` holds the hot-cup price; `price_iced_inr` is the iced
    # variant where applicable (null = not served iced). Both nullable
    # so cafés can leave them blank rather than guess.
    "ALTER TABLE cafe_menu_items ADD COLUMN price_inr INTEGER",
    "ALTER TABLE cafe_menu_items ADD COLUMN price_iced_inr INTEGER",
    # Alternative milks served by the café + per-option surcharge.
    # JSON array of { name, surcharge_inr } so the order is preserved
    # (cafés care that "Oat" comes before "Soy" in the displayed
    # sentence). Nullable; an empty list and NULL both render as
    # "no alt milks listed yet".
    "ALTER TABLE cafe_profiles ADD COLUMN milk_options_json TEXT",
    # ── Post recommender signals (Phase 2 engine food) ──────────────────
    # Three per-user × per-post actions surfaced in the non-owner
    # three-dots menu. None of them affect post counts (no "dislike_count"
    # exposed to viewers); they record intent for a recommender that
    # reads them as negative signals. Scoped unique per (user, post) on
    # hide + dislike so repeated taps idempotently toggle; reports are
    # NOT unique — each tap records a separate report row so the admin
    # view can count pile-ons.
    """CREATE TABLE IF NOT EXISTS post_hides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES roaster_posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, post_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_post_hides_user ON post_hides(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_post_hides_post ON post_hides(post_id)",
    """CREATE TABLE IF NOT EXISTS post_dislikes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES roaster_posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, post_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_post_dislikes_user ON post_dislikes(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_post_dislikes_post ON post_dislikes(post_id)",
    """CREATE TABLE IF NOT EXISTS post_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES roaster_posts(id) ON DELETE CASCADE,
        reason TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_post_reports_post ON post_reports(post_id)",
    "CREATE INDEX IF NOT EXISTS idx_post_reports_user ON post_reports(user_id)",
    # ── Catalog ops admin tabs (v0, local-only) ─────────────────────────────
    # Three concerns share these tables:
    #   * Scraper tab — `roaster_sources` is the live list of websites the
    #     scraper crawls (seeded from Scraper/verified_roasters_catalog.json
    #     once, then editable via the admin tab).
    #   * Taste Graph tab — `sca_addresses` is the per-tag → SCA address
    #     resolution store (replaces tasting_notes_tags/tag_resolutions.json
    #     as the live source). `sca_tree_versions` keeps every uploaded SCA
    #     tree JSON by version with exactly one row marked active.
    #   * Both tabs — `jobs` records every triggered background job (scrape
    #     / geolocate / tree_validate) with status, timing, and a log tail.
    # See LAUNCH_TODO §3.8 — the prod-deployment hardening (queue worker,
    # restart safety, log rotation, cron) is deliberately deferred.
    """CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_by INTEGER NOT NULL REFERENCES users(id),
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        log_tail TEXT,
        result_summary TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_jobs_kind_status ON jobs(kind, status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC)",
    """CREATE TABLE IF NOT EXISTS roaster_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        website TEXT NOT NULL UNIQUE,
        shop_url TEXT,
        platform TEXT,
        city TEXT,
        state TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL,
        last_scraped_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_roaster_sources_enabled ON roaster_sources(enabled)",
    """CREATE TABLE IF NOT EXISTS sca_addresses (
        tag TEXT PRIMARY KEY,
        address_t1 TEXT,
        address_t2 TEXT,
        address_t3 TEXT,
        is_null INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        model_version TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sca_addresses_t1 ON sca_addresses(address_t1)",
    "CREATE INDEX IF NOT EXISTS idx_sca_addresses_source ON sca_addresses(source)",
    """CREATE TABLE IF NOT EXISTS sca_tree_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uploaded_at TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        tree_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        notes TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sca_tree_active ON sca_tree_versions(is_active)",
    # ── Scrape approval workflow ────────────────────────────────────────────
    # Every product change a scrape job *wants* to make lands here as a row
    # with `status='pending'`. The admin reviews proposals and approves /
    # rejects them; only on approve does `products` get touched. `prev_state`
    # captures the row's pre-change shape so undo can reverse cleanly.
    #
    # change_type values:
    #   'insert'           → propose creating a new products row
    #   'update'           → propose refreshing an existing row's columns
    #   'mark_sold_out'    → propose flipping available=1 → 0 (when scrape
    #                        finds a slug's products no longer listed)
    #   'restore_available'→ propose flipping available=0 → 1 (when scrape
    #                        sees a previously sold-out bean back in stock
    #                        with matching product_id)
    #
    # status values:
    #   'pending'  → awaiting admin review
    #   'applied'  → approved + written to products
    #   'rejected' → admin discarded the proposal; no DB change
    #   'reverted' → previously applied, then undone by job-undo
    """CREATE TABLE IF NOT EXISTS scrape_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        change_type TEXT NOT NULL,
        proposed_state_json TEXT,
        prev_state_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        applied_at TEXT,
        reverted_at TEXT,
        rejected_at TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_scrape_proposals_job ON scrape_proposals(job_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_scrape_proposals_status ON scrape_proposals(status)",
    # ── Catalog Ops Phase 1: enrichment fields on products ──────────────────
    # The scrape pipeline will run `enrich.py` per product before staging
    # the proposal, so every approved row carries the full 13-field payload
    # the admin reviewed. `process_raw` keeps the roaster's verbatim text
    # alongside the existing `process` enum bucket — no fidelity loss for
    # experimental methods (anaerobic carbonic, lactic, yeast inoculated,
    # etc.). `producer` and `brew_recommendation_json` are LLM-extracted
    # from narrative description text. `enrichment_status` lets the admin
    # tab flag rows where Sonnet was unavailable so they can be re-enriched
    # later without re-scraping.
    "ALTER TABLE products ADD COLUMN process_raw TEXT",
    "ALTER TABLE products ADD COLUMN producer TEXT",
    "ALTER TABLE products ADD COLUMN brew_recommendation_json TEXT",
    "ALTER TABLE products ADD COLUMN enrichment_status TEXT NOT NULL DEFAULT 'pending'",
    # Phase 6 enricher rewrite — three more LLM-extracted fields per
    # the bean wishlist:
    #   • `roast_level_name` — verbatim roaster term (Vienna / Full City+ /
    #     Espresso roast / Filter roast). The existing `roast_level` enum
    #     stays for filterability but the original phrasing is the truth.
    #   • `roaster_blurb` — short third-person narrative about THIS bean
    #     (sourcing story, processing technique, why the roaster chose
    #     it). Distinct from tasting_notes (those have their own field).
    #   • `weight_grams` already existed; nothing to add for it.
    "ALTER TABLE products ADD COLUMN roast_level_name TEXT",
    "ALTER TABLE products ADD COLUMN roaster_blurb TEXT",
    # Phase 6 follow-up — per-roaster site prompt hint. After the
    # first per-roaster Haiku enrichment run completes, a Sonnet
    # meta-call samples 3-5 of the products + their page text and
    # writes a 1-2 paragraph addendum to the extraction system
    # prompt that captures THIS roaster's quirks (units, where info
    # is buried, naming conventions, fields that are unreliable).
    # Subsequent per-roaster runs prepend this addendum to the base
    # system prompt so Haiku gets the past experience for free.
    # Admin can opt to regenerate by toggling the per-run flag on
    # the roaster page.
    "ALTER TABLE roaster_profiles ADD COLUMN enrichment_prompt_hint TEXT",
    # Tracks when the hint was last written by the Sonnet meta-call —
    # distinct from `updated_at`, which moves on any profile edit. The
    # admin's roaster page reads this to surface "Updated 2d ago" so
    # the operator can tell at a glance whether the cached hint is
    # stale relative to recent changes on the roaster's storefront.
    "ALTER TABLE roaster_profiles ADD COLUMN enrichment_prompt_hint_updated_at TEXT",
    # ── Catalog Standardization ─────────────────────────────────────────────
    # The MAPPING tab (renamed STANDARDIZATION) runs a single Haiku pass
    # that maps three roaster-side fields onto Crema canonical values:
    #   • tasting tags → SCA address (existing `sca_addresses` table)
    #   • origin → estate name / Multi-estate / International / Unknown
    #   • varietal → canonical variety + species + morphology
    # Each address table mirrors `sca_addresses`'s shape so the
    # exemplar-selection / classification machinery can be shared.
    """CREATE TABLE IF NOT EXISTS origin_addresses (
        raw_string TEXT PRIMARY KEY,
        estate_canonical TEXT,
        source TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        model_version TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_origin_addresses_canonical ON origin_addresses(estate_canonical)",
    """CREATE TABLE IF NOT EXISTS varietal_addresses (
        raw_string TEXT PRIMARY KEY,
        canonical_varietal TEXT,
        bean_type TEXT,
        morphology TEXT,
        source TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        model_version TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_varietal_addresses_canonical ON varietal_addresses(canonical_varietal)",
    "CREATE INDEX IF NOT EXISTS idx_varietal_addresses_morphology ON varietal_addresses(morphology)",
    # Products writeback columns. `varietal_canonical` already exists —
    # the standardization pass starts writing it (superseding the
    # `services/canonicalize.py` regex backfill). Estate and morphology
    # are new. `bean_type_canonical` lets standardization refine the
    # scraper-set `bean_type` without clobbering it; consumer queries
    # COALESCE(bean_type_canonical, bean_type).
    "ALTER TABLE products ADD COLUMN origin_estate_canonical TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_origin_estate ON products(origin_estate_canonical)",
    "ALTER TABLE products ADD COLUMN bean_type_canonical TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_bean_type_canonical ON products(bean_type_canonical)",
    "ALTER TABLE products ADD COLUMN morphology TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_morphology ON products(morphology)",
    # Cached exemplar block — one row per task. The standardization run
    # reuses the cached block across calls so Anthropic's prompt cache
    # stays warm. Admin can flip `regenerate_next` on the
    # STANDARDIZATION sub-tab; the next run resamples then resets the
    # flag (sticky for one click). Tasks are: tasting, origin,
    # varietal, roast, process.
    """CREATE TABLE IF NOT EXISTS standardize_exemplars (
        task TEXT PRIMARY KEY,
        exemplars_json TEXT NOT NULL,
        regenerate_next INTEGER NOT NULL DEFAULT 0,
        generated_at TEXT NOT NULL
    )""",
    # ── Standardization expansion: roast + process ──────────────────────────
    # `roast_addresses` is new; `process_addresses` was prepped earlier
    # for the Process Graph admin tab — we now wire it up. Both mirror
    # the varietal_addresses shape: raw_string PK → canonical bucket.
    """CREATE TABLE IF NOT EXISTS roast_addresses (
        raw_string TEXT PRIMARY KEY,
        roast_canonical TEXT,
        source TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        model_version TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_roast_addresses_canonical ON roast_addresses(roast_canonical)",
    # Denormalized canonical columns on products. Consumer Discover
    # filters read these directly (with the legacy column as fallback)
    # so chips stay accurate without per-row joins.
    "ALTER TABLE products ADD COLUMN roast_level_canonical TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_roast_canonical ON products(roast_level_canonical)",
    "ALTER TABLE products ADD COLUMN process_canonical TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_process_canonical ON products(process_canonical)",
    # Discoverability gate: enriched roasters land here as `published=0` so
    # the admin reviews the synthesized bio + edits it before pushing the
    # row to the public Discover surface. Existing 121 profiles all default
    # to 1 since they were already live.
    "ALTER TABLE roaster_profiles ADD COLUMN published INTEGER NOT NULL DEFAULT 1",
    "CREATE INDEX IF NOT EXISTS idx_roaster_profiles_published ON roaster_profiles(published)",
    # ── Catalog Ops Phase 4 prep: process canonicalization (Process Graph) ──
    # Mirrors `sca_addresses` + `sca_tree_versions` — the admin will run a
    # Haiku batch on distinct `process_raw` strings, mapping each onto a
    # canonical taxonomy version. Tables seed empty; first activation
    # happens via the Mapping sub-tab.
    """CREATE TABLE IF NOT EXISTS process_addresses (
        raw_string TEXT PRIMARY KEY,
        canonical TEXT,
        is_null INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        model_version TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_process_addresses_canonical ON process_addresses(canonical)",
    """CREATE TABLE IF NOT EXISTS process_canonical_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uploaded_at TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        taxonomy_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        notes TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_process_canonical_active ON process_canonical_versions(is_active)",
    # ── Catalog Ops audit: deleted roasters log ────────────────────────
    # When admin removes a roaster from Catalog Ops we still want a way to
    # find the original website, in case the deletion was a mistake or the
    # admin wants to re-enrich later. Hard-deleting `roaster_profiles` +
    # `roaster_sources` removes operational state; this table preserves
    # just enough to recover (name + website + when). Append-only.
    """CREATE TABLE IF NOT EXISTS deleted_roasters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        name TEXT,
        website TEXT,
        city TEXT,
        state TEXT,
        deleted_at TEXT NOT NULL,
        deleted_by INTEGER REFERENCES users(id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_deleted_roasters_at ON deleted_roasters(deleted_at)",
    # ── Phase: roaster enrichment v2 ───────────────────────────────────
    # Three free-text fields that Sonnet is now asked to extract during
    # bio enrichment. Tagline shows under the name on the admin page;
    # instagram + contact_email feed wholesale-outreach + the future
    # roaster page. NULL until enrichment / admin manually fills.
    "ALTER TABLE roaster_profiles ADD COLUMN tagline TEXT",
    "ALTER TABLE roaster_profiles ADD COLUMN instagram_handle TEXT",
    "ALTER TABLE roaster_profiles ADD COLUMN contact_email TEXT",
    # ── §2.42 café-removal pivot ───────────────────────────────────────
    # Hard-delete every café / wholesale / stamp / QR surface. Phase 1
    # is consumer + roaster only; cafés return as a Phase N rewrite-
    # from-scratch. Order matters: row deletions BEFORE column drops,
    # child tables BEFORE parent tables. The `init_db` migration loop
    # wraps each statement in try/except so re-running this block on a
    # cleaned DB is a no-op.
    #
    # NOTE: SQLite 3.35+ is required for ALTER TABLE … DROP COLUMN.
    # The runtime build is 3.37; verify with `sqlite3 --version`
    # before running on a different host.
    #
    # Row-impact at draft time (audit 2026-04-29):
    #   users.account_type='cafe'        : 10
    #   cafe_profiles                    : 9   (cascades to children)
    #   cafe_menu_items                  : 39
    #   cafe_baristas                    : 4
    #   stamps                           : 2
    #   stamp_rewards                    : 0
    #   qr_tokens                        : 1
    #   wholesale_inquiries              : 5   (cascades to inquiry_messages)
    #   inquiry_messages                 : 1
    #   notifications (café-flavored)    : 7   (5 wholesale_inquiry + 2 inquiry_reply)
    #   roaster_posts.cafe_slug NOT NULL : 0
    "DELETE FROM roaster_posts WHERE cafe_slug IS NOT NULL",
    """DELETE FROM notifications WHERE type IN (
        'wholesale_inquiry','inquiry_reply','stamp_awarded',
        'menu_updated_business','loyalty_changed','wholesale_available',
        'menu_added','menu_removed','menu_updated'
    )""",
    # NOTE: deleting account_type='cafe' users runs OUTSIDE this list
    # via _remove_cafe_users() — `init_db` wraps that call in
    # PRAGMA foreign_keys = OFF / ON because the user rows are
    # referenced from many tables without ON DELETE CASCADE.
    # Drop child tables first — even with PRAGMA foreign_keys = ON, this
    # ordering keeps us safe if any FK clause turns out to lack ON DELETE
    # CASCADE.
    "DROP INDEX IF EXISTS idx_inquiry_msgs_inquiry",
    "DROP TABLE IF EXISTS inquiry_messages",
    "DROP INDEX IF EXISTS idx_winquiries_status",
    "DROP INDEX IF EXISTS idx_winquiries_cafe",
    "DROP INDEX IF EXISTS idx_winquiries_roaster",
    "DROP TABLE IF EXISTS wholesale_inquiries",
    "DROP INDEX IF EXISTS idx_qr_user",
    "DROP TABLE IF EXISTS qr_tokens",
    "DROP INDEX IF EXISTS idx_rewards_user_cafe",
    "DROP TABLE IF EXISTS stamp_rewards",
    "DROP INDEX IF EXISTS idx_stamps_user_cafe",
    "DROP INDEX IF EXISTS idx_stamps_cafe",
    "DROP INDEX IF EXISTS idx_stamps_user",
    "DROP TABLE IF EXISTS stamps",
    "DROP INDEX IF EXISTS idx_baristas_cafe",
    "DROP TABLE IF EXISTS cafe_baristas",
    "DROP INDEX IF EXISTS idx_menu_cafe",
    "DROP TABLE IF EXISTS cafe_menu_items",
    "DROP INDEX IF EXISTS idx_cafes_city",
    "DROP TABLE IF EXISTS cafe_profiles",
    # Column drops on surviving tables. account_type 'cafe' has no
    # CHECK-constraint enforcement at the DB level (verified — it's
    # purely Pydantic-side), so no table rebuild is required for that
    # decision.
    "DROP INDEX IF EXISTS idx_users_fav_cafe",
    "ALTER TABLE users DROP COLUMN favorite_cafe_slug",
    "ALTER TABLE users DROP COLUMN cafe_slug",
    "DROP INDEX IF EXISTS idx_posts_cafe",
    "ALTER TABLE roaster_posts DROP COLUMN cafe_slug",
    "DROP INDEX IF EXISTS idx_products_wholesale",
    "ALTER TABLE products DROP COLUMN wholesale_available",
    "ALTER TABLE products DROP COLUMN wholesale_minimum_kg",
    "ALTER TABLE products DROP COLUMN wholesale_note",
    "DROP INDEX IF EXISTS idx_rproducts_wholesale",
    "ALTER TABLE roaster_products DROP COLUMN wholesale_available",
    "ALTER TABLE roaster_products DROP COLUMN wholesale_minimum_kg",
    "ALTER TABLE roaster_products DROP COLUMN wholesale_note",
    "ALTER TABLE notifications DROP COLUMN inquiry_id",
    # ── Discover filter axes (specialty-catalog nuance) ────────────────
    # Two canonical columns derived from free-text origin / varietal so
    # the Discover BEANS filter drawer can offer chip-based Region +
    # Varietal filters without exposing 397 raw flavor-tokens or
    # estate-specific origin strings. Populated by
    # `services/canonicalize.py` — both at scrape-time (in
    # `_product_lite_from_scraped`) and via the one-shot backfill in
    # `services/catalog_ops.py:backfill_canonical_columns`. Heavier
    # curation lives in the planned Coffee Standardization sub-tab.
    "ALTER TABLE products ADD COLUMN origin_region TEXT",
    "ALTER TABLE products ADD COLUMN varietal_canonical TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_origin_region ON products(origin_region)",
    "CREATE INDEX IF NOT EXISTS idx_products_varietal_canonical ON products(varietal_canonical)",
]


def _migrate_shelf_categories(conn):
    """Migrate shelf categories: currently_drinking→open_bags, want_to_try→on_the_list, delete drank.
    Rebuilds the table to update the CHECK constraint (SQLite doesn't support ALTER CONSTRAINT)."""
    # Check if migration is needed
    row = conn.execute("SELECT shelf FROM shelf_entries WHERE shelf = 'currently_drinking' LIMIT 1").fetchone()
    if not row:
        return  # Already migrated or empty

    conn.executescript("""
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;
        CREATE TABLE shelf_entries_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            product_id TEXT NOT NULL,
            shelf TEXT NOT NULL CHECK (shelf IN ('open_bags', 'on_the_list')),
            added_at TEXT NOT NULL,
            moved_at TEXT NOT NULL,
            UNIQUE(user_id, product_id)
        );
        INSERT INTO shelf_entries_new (id, user_id, product_id, shelf, added_at, moved_at)
            SELECT id, user_id, product_id,
                CASE shelf
                    WHEN 'currently_drinking' THEN 'open_bags'
                    WHEN 'want_to_try' THEN 'on_the_list'
                END,
                added_at, moved_at
            FROM shelf_entries
            WHERE shelf IN ('currently_drinking', 'want_to_try');
        DROP TABLE shelf_entries;
        ALTER TABLE shelf_entries_new RENAME TO shelf_entries;
        COMMIT;
        PRAGMA foreign_keys = ON;
    """)


def init_db():
    """Initialize the database schema and run migrations."""
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    # Run migrations (ignore if column already exists)
    for sql in _MIGRATIONS:
        try:
            conn.execute(sql)
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists
    # Shelf category migration (table rebuild — must run after normal migrations)
    try:
        _migrate_shelf_categories(conn)
    except Exception as e:
        print(f"Shelf migration note: {e}")
    # §2.42 — drop café user rows. Lives outside the migration list
    # because the account_type='cafe' users are referenced from many
    # tables (sessions, posts, follows, …) without ON DELETE CASCADE,
    # and PRAGMA foreign_keys is ON for the rest of the loop. Wrapping
    # the delete with FK pragma OFF is the cleanest path; the orphaned
    # rows in unrelated tables become inert (queries that JOIN to
    # users naturally drop them).
    try:
        _remove_cafe_users(conn)
    except Exception as e:
        print(f"Café user cleanup note: {e}")
    # Catalog-ops seed (idempotent — populates roaster_sources from the
    # on-disk catalog JSON, sca_addresses from the cached resolutions, and
    # sca_tree_versions with the canonical SCA tree). Lives in services/
    # so the seed logic can be reused by tests / scripts without dragging
    # in the rest of database.py.
    try:
        from services.catalog_ops import seed_initial_state
        seed_initial_state(conn)
    except Exception as e:
        print(f"Catalog-ops seed note: {e}")
    conn.close()


def _remove_cafe_users(conn):
    """Drop every account_type='cafe' user row. Wraps the DELETE in
    PRAGMA foreign_keys = OFF so the user-id references that live in
    sessions / shelf_entries / post_likes / follows / direct_threads /
    notifications / etc. don't block the delete. Those tables don't
    declare ON DELETE CASCADE on user_id, so the rows that reference
    deleted users become orphans — inert in practice because every
    user-facing query JOINs to users(id), and the orphaned rows
    silently drop out of the result set. A future cleanup pass can
    purge them; doing it inline would mean enumerating every table
    that references users(id), which is brittle."""
    rows = conn.execute(
        "SELECT COUNT(*) FROM users WHERE account_type='cafe'"
    ).fetchone()
    n = rows[0] if rows else 0
    if not n:
        return
    conn.executescript("""
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;
        DELETE FROM users WHERE account_type='cafe';
        COMMIT;
        PRAGMA foreign_keys = ON;
    """)
    print(f"Café user cleanup: deleted {n} users where account_type='cafe'")
