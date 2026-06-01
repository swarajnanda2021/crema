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
CREATE INDEX IF NOT EXISTS idx_clicks_roaster ON click_events(roaster_slug);
CREATE INDEX IF NOT EXISTS idx_clicks_product ON click_events(product_id);

-- ── Contact Crema (support) ──────────────────────────────────────────
-- Scoped support chat: every thread is a single user <-> Crema-admin
-- conversation (no peer-to-peer). This is the catalog-only replacement
-- for the removed DM system — feedback + roaster-join inquiries only.
CREATE TABLE IF NOT EXISTS support_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'open',
    unread_admin INTEGER NOT NULL DEFAULT 0,
    unread_user INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('user','admin')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at);
"""


def get_db():
    """Get a database connection (per-request). Creates tables on first call.

    PRAGMAs applied on every connection:
      • foreign_keys=ON — enforces referential integrity.
      • journal_mode=WAL — enables write-ahead logging so multiple
        readers can run concurrently with at most one writer (the
        default `delete` rollback-journal mode serializes everything
        and surfaces `database is locked` the moment a BackgroundTask
        and a sync request handler both want to write). WAL is a
        DB-file-level setting that persists across connections; setting
        it on every connection is harmless after the first.
      • busy_timeout=10s — when a writer can't immediately acquire the
        lock, wait up to 10 seconds before raising. Bridges the rare
        contention windows between the catalog-ops BackgroundTasks
        (roaster_enrich, scrape) and inline request handlers
        (refresh-all, etc.).
    """
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
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
    # Process display label — Haiku now returns BOTH a canonical bucket
    # (the 8 filterable categories: Washed/Natural/…/Experimental) AND
    # a cleaned display label (e.g. "Whiskey Barrel Aged" or "Carbonic
    # Maceration") that the CoffeeCard renders. Filter chips group by
    # canonical; cards show display.
    "ALTER TABLE process_addresses ADD COLUMN display_label TEXT",
    # ── Discover JOURNAL tab — roaster blog ingestion ─────────────────
    # `roaster_articles` stores articles scraped from each roaster's
    # blog/journal. Mirrors the `products` pattern (one row per article,
    # `roaster_slug` joins back to `roaster_profiles`) but skips the
    # proposals workflow — articles are roaster-authored content, not
    # catalog data we modify, so the scraper writes rows directly.
    # Admin curation lives on `published` (default 1 — auto-visible);
    # the consumer JOURNAL feed filters on it.
    """CREATE TABLE IF NOT EXISTS roaster_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        image_url TEXT,
        body_html TEXT,
        word_count INTEGER,
        published_at TEXT,
        scraped_at TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 1,
        enrichment_status TEXT NOT NULL DEFAULT 'pending'
    )""",
    "CREATE INDEX IF NOT EXISTS idx_roaster_articles_roaster ON roaster_articles(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_roaster_articles_published_at ON roaster_articles(published_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_roaster_articles_published ON roaster_articles(published)",
    # Per-roaster article-discovery state on `roaster_sources` so a
    # successful first-time discovery (Atom feed at /blogs/news.atom,
    # WP /feed/, or a list of Shopify blog handles via sitemap) is
    # cached — subsequent scrapes hit one URL instead of re-running
    # the full enumeration. `articles_handles` is a JSON array; the
    # other three are bare strings/timestamps. `articles_count` is
    # denormalized so the admin Roasters & Beans list doesn't have
    # to JOIN+COUNT roaster_articles per row.
    "ALTER TABLE roaster_sources ADD COLUMN articles_index_url TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN articles_feed_kind TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN articles_handles TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN last_articles_scraped_at TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN articles_count INTEGER NOT NULL DEFAULT 0",
    # Layer A — coffee-relevance gate + topic classifier + Haiku tags.
    # `is_about_coffee` (1/0) lets the admin badge "Off-topic" pages
    # without conflating the value with `published` (which the admin
    # may have toggled manually). `topic_category` is one of the
    # eight fixed buckets in services/article_enricher.TOPIC_CATEGORIES.
    # `tags` is a JSON array of 3-7 lowercase keywords powering
    # sitewide search via LIKE on the JSON-as-string. Default 1 for
    # is_about_coffee preserves the existing 173 rows as on-topic
    # until the next force_enrich pass re-evaluates them.
    "ALTER TABLE roaster_articles ADD COLUMN is_about_coffee INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE roaster_articles ADD COLUMN topic_category TEXT",
    "ALTER TABLE roaster_articles ADD COLUMN tags TEXT",
    "CREATE INDEX IF NOT EXISTS idx_roaster_articles_is_about_coffee ON roaster_articles(is_about_coffee)",
    # Layer B — per-roaster article-extraction site-quirk hint.
    # Mirrors the `enrichment_prompt_hint` columns used by the
    # bean enricher (see site_prompt_generator.py). Generated by
    # services/article_site_prompt_generator.py after the first
    # enriched-article run for a roaster.
    "ALTER TABLE roaster_profiles ADD COLUMN article_enrichment_prompt_hint TEXT",
    "ALTER TABLE roaster_profiles ADD COLUMN article_enrichment_prompt_hint_updated_at TEXT",
    # Perpetual "regenerate hint on next scrape" flag — server-side
    # state that's shared across admins and never auto-clears. While
    # set to 1, every article_scrape pass for this roaster regenerates
    # the site-quirk hint via the Sonnet meta-call. Admin flips back
    # to 0 once they're satisfied with the hint.
    "ALTER TABLE roaster_profiles ADD COLUMN article_hint_force_regenerate INTEGER NOT NULL DEFAULT 0",
    # Catalog Ops v2 — per-roaster diff interpretation hint. Read by
    # Haiku when staging diff proposals on Tab 2 (Refresh Catalog) so
    # the LLM can apply roaster-specific filters when interpreting
    # storefront diffs — e.g. "Caffena keeps gift-card SKUs at
    # /products/gift-card-*; treat them as non-bean and don't propose
    # them" or "This roaster archives by setting available=false
    # instead of unlisting". Same surface model as the bio + article
    # hints; admin-editable in the Refresh tab.
    "ALTER TABLE roaster_profiles ADD COLUMN diff_prompt_hint TEXT",
    "ALTER TABLE roaster_profiles ADD COLUMN diff_prompt_hint_updated_at TEXT",
    # Live job state — `current_target` is the slug (or other label) the
    # runner is iterating right now; the admin UI reads it during a
    # 2.5s poll to render "Looking at {target}" while the job is in
    # flight. `cancel_requested` is a sticky flag the admin Stop button
    # writes; the runner polls it at the top of each per-source loop
    # iteration and exits cleanly with whatever has already committed.
    "ALTER TABLE jobs ADD COLUMN current_target TEXT",
    "ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0",
    # ── Article engagement (parity with posts) ──────────────────────
    # Articles get the same like / comment / repost / hide / dislike /
    # report fan-out as posts. Tables mirror their post_* counterparts
    # exactly so the registry can declare them with the same shape.
    # Comment-likes get their own dedicated table (article_comment_likes)
    # rather than a polymorphic comment_likes — the cleaner long-term
    # answer would be a target_type column on comment_likes, but the
    # ship-speed call is to keep the post-side comment_likes untouched
    # and add a parallel article_comment_likes. Two paths to maintain
    # but no migration risk on the existing 200+ comment-likes rows.
    """CREATE TABLE IF NOT EXISTS article_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES roaster_articles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, article_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_likes_article ON article_likes(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_likes_user ON article_likes(user_id)",
    """CREATE TABLE IF NOT EXISTS article_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES roaster_articles(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        parent_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_comments(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_comments_user ON article_comments(user_id)",
    """CREATE TABLE IF NOT EXISTS article_comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, comment_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_comment_likes_comment ON article_comment_likes(comment_id)",
    """CREATE TABLE IF NOT EXISTS article_hides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES roaster_articles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, article_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_hides_user ON article_hides(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_hides_article ON article_hides(article_id)",
    """CREATE TABLE IF NOT EXISTS article_dislikes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES roaster_articles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, article_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_dislikes_user ON article_dislikes(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_dislikes_article ON article_dislikes(article_id)",
    """CREATE TABLE IF NOT EXISTS article_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES roaster_articles(id) ON DELETE CASCADE,
        reason TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_article_reports_article ON article_reports(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_reports_user ON article_reports(user_id)",
    # Reposts of articles ride on roaster_posts the same way reposts of
    # posts do — a "repost" row whose `repost_of_article_id` points at
    # the article. The posts registry's repost_count subquery and the
    # `original_article` cross-resource embed both key off this column.
    "ALTER TABLE roaster_posts ADD COLUMN repost_of_article_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_rposts_repost_of_article ON roaster_posts(repost_of_article_id)",
    # ── DM "delete chat for me" (per-party) ───────────────────────
    # Mirrors the per-party last_read pattern: each side of a DM
    # thread can stamp `user_a_deleted_at` / `user_b_deleted_at` to
    # hide the thread from THEIR inbox. The other party still sees
    # the conversation. If the other party sends a new message, the
    # thread's `updated_at` advances past the stamp and the thread
    # reappears for the deleter — same UX as Gmail trash + WhatsApp
    # "Delete chat" hybrid. Hard-deleting both sides would orphan
    # the other party's history; this is the safer default.
    "ALTER TABLE direct_threads ADD COLUMN user_a_deleted_at TEXT",
    "ALTER TABLE direct_threads ADD COLUMN user_b_deleted_at TEXT",
    # ── DM long-press actions: reply / per-message delete / pin ───
    # `reply_to_message_id` lets a message quote a prior one inline
    # (the bubble renders a small "in reply to X" header with the
    # original body excerpt). NULL means a normal message.
    "ALTER TABLE direct_messages ADD COLUMN reply_to_message_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_dmessages_reply_to ON direct_messages(reply_to_message_id)",
    # Per-message "Delete for you" stamps. Mirrors the per-thread
    # delete pattern but at message granularity: each side sets
    # their own stamp; the message stays in the table for the
    # other party. The /thread endpoint filters by these so a
    # deleted message doesn't reappear for the deleter even after
    # new activity (unlike thread-level delete which DOES reopen
    # on new activity — this is the WhatsApp "delete for me" leaf
    # behavior, intentionally one-way for the actor).
    "ALTER TABLE direct_messages ADD COLUMN deleted_for_user_a_at TEXT",
    "ALTER TABLE direct_messages ADD COLUMN deleted_for_user_b_at TEXT",
    # Single pinned message per DM thread. NULL = no pin. Either
    # party can set or clear it; the pin is visible to both. The
    # /thread endpoint surfaces it so the client can paint a banner
    # above the messages list.
    "ALTER TABLE direct_threads ADD COLUMN pinned_message_id INTEGER",
    """CREATE TABLE IF NOT EXISTS direct_message_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
        reason TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_direct_message_reports_message ON direct_message_reports(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_direct_message_reports_user ON direct_message_reports(user_id)",
    # ── Image attachments on DMs ──────────────────────────────────
    # Camera + gallery picker on the composer write a relative path
    # (`/uploads/dm/<id>.webp`) into this column. The body field can
    # be empty when the message is image-only — the post endpoint
    # accepts (body OR image_url) rather than requiring both.
    "ALTER TABLE direct_messages ADD COLUMN image_url TEXT",
    # ── Roaster ad placements (P0 — persistence for the ADS tab) ──
    # One row per (article, product) the roaster has committed to
    # surface in-article. Source distinguishes how the row landed:
    #   • 'auto'   — originally proposed by services/ad_placements.py
    #                and explicitly kept (or never touched — see below)
    #   • 'manual' — added by the roaster via AddCoffeesModal
    # The auto-suggester runs deterministically on every owner GET, so
    # we don't need to materialise its picks on initial load. The
    # client only writes to this table when the roaster's effective
    # set diverges from the auto-suggestions: removed auto-picks land
    # here as `source='auto', deleted_at=<ts>` tombstones; added
    # manual picks land as `source='manual', deleted_at=NULL`. The GET
    # endpoint reconciles auto-suggestions against this delta table to
    # produce the effective list both the owner and the public reader
    # see. Soft-delete preserves "the roaster rejected this
    # auto-suggestion" so the attribution work (next session) can
    # tell ad-slot clicks from organic Buy clicks AND so future
    # auto-runs don't keep proposing a coffee the roaster has already
    # said no to. UNIQUE(article_id, product_id) means we toggle
    # deleted_at in place rather than appending rows on each flip.
    """CREATE TABLE IF NOT EXISTS roaster_ad_placements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        article_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('auto','manual')),
        order_idx INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(article_id, product_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_ad_placements_article ON roaster_ad_placements(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_ad_placements_roaster ON roaster_ad_placements(roaster_slug)",
    # ── P1 — attribution (impressions + ad-aware clicks) ─────────────
    # click_events now carries the ad-slot context. A click on an
    # in-article placement populates `article_id` + `placement_source`;
    # an organic Buy click from /coffee/[id], /roaster/[slug], the
    # feed, etc. leaves both NULL. `placement_source` is one of:
    #   'inline' — a coffee whose product_url appears in the article body
    #              (Crema-responsible, non-removable in the ADS tab)
    #   'auto'   — a coffee the services/ad_placements.py scorer
    #              matched against the article above threshold and
    #              the roaster kept
    #   'manual' — a coffee the roaster explicitly added via
    #              AddCoffeesModal
    # The three values match the placement source enum the consumer
    # reader + ADS tab UI surface, so an analytics query can pivot
    # clicks by source without joining back to a placements snapshot.
    "ALTER TABLE click_events ADD COLUMN article_id INTEGER",
    "ALTER TABLE click_events ADD COLUMN placement_source TEXT",
    "CREATE INDEX IF NOT EXISTS idx_clicks_article ON click_events(article_id)",
    # ── Ad impressions ───────────────────────────────────────────────
    # One row per (session × article × product × placement_source).
    # `session_id` lets us de-duplicate re-renders within a browser
    # session — refreshes / scrolls past the placement / re-mounts
    # collapse to one row. A new session (tab close + reopen, app
    # restart on native, a stale-session-id rotation) gets a fresh
    # impression — that's the "reach over time" measurement roasters
    # want.
    #
    # `user_id` is nullable so anonymous viewers count too — the
    # pitch to roasters is "look at the traffic we're generating
    # for you," and gating impressions to authed users would
    # under-report.
    #
    # No `dwell_ms` for v1 — deferred until we know whether time-
    # on-screen pulls weight in the analytics surface (impressions +
    # clicks already compute reach + intent).
    """CREATE TABLE IF NOT EXISTS ad_impressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        session_id TEXT NOT NULL,
        article_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        roaster_slug TEXT NOT NULL,
        placement_source TEXT NOT NULL CHECK (placement_source IN ('inline','auto','manual')),
        seen_at TEXT NOT NULL,
        UNIQUE(session_id, article_id, product_id, placement_source)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_impr_article ON ad_impressions(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_impr_product ON ad_impressions(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_impr_roaster ON ad_impressions(roaster_slug)",
    "CREATE INDEX IF NOT EXISTS idx_impr_seen ON ad_impressions(seen_at)",
    # ── Catalog Ops v2 — CrawlSnapshot for the 3-tab sync pipeline.
    # Two tables holding N-1 retention of per-roaster crawl results:
    # `crawl_snapshots` is the latest; `crawl_snapshots_prev` holds
    # the prior snapshot for diffing. Each `payload_json` is the full
    # resource manifest (bio hash + product list with stable IDs +
    # article URL list with hashes). The Tab 2 refresh runner diffs
    # current vs prev to identify added/updated/removed entities; only
    # the diff goes through Haiku enrichment, keeping steady-state
    # refresh cost near zero. See services/sync_runner.py.
    """CREATE TABLE IF NOT EXISTS crawl_snapshots (
        roaster_slug TEXT PRIMARY KEY,
        taken_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS crawl_snapshots_prev (
        roaster_slug TEXT PRIMARY KEY,
        taken_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )""",
    # Agent-runs audit log — every MCP tool call writes one row here.
    # The MCP server (Community/coffee-community-api/mcp-server) wraps
    # every tool execution with an INSERT here. Future "Agent activity"
    # UI reads from this table to surface what each agent (Claude
    # Sonnet/Haiku, local Llama, cron-triggered routines) did, when,
    # with what inputs, what outputs. The `agent_identity` column is
    # the LLM+host string (e.g. `claude-haiku-4-5@anthropic`,
    # `llama-3.3-70b@macstudio.local`) so per-provider audit is free.
    """CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        agent_identity TEXT NOT NULL,
        operator_user_id INTEGER,
        tool_name TEXT NOT NULL,
        args_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        result_summary TEXT,
        error TEXT,
        prompt_hash TEXT,
        schema_hash TEXT
    )""",
    """CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_runs_tool ON agent_runs(tool_name)""",
    # LLM-jobs queue — the agent-fallback execution path. When the
    # FastAPI runner is invoked by a Claude operator (via the MCP
    # server with CREMA_AGENT_IDENTITY=claude-*), each enricher
    # enqueues a row here instead of calling the Anthropic SDK
    # directly. Claude polls `/admin/llm-jobs/next`, produces the
    # structured output, and POSTs `/admin/llm-jobs/{id}/respond` to
    # wake the awaiting enricher. Same prompt + same tool schema as
    # the SDK path — only the executor differs.
    # See: services/llm_router.py + mcp-server tools crema_haiku_*.
    """CREATE TABLE IF NOT EXISTS llm_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roaster_slug TEXT NOT NULL,
        step TEXT NOT NULL,
        target_id TEXT,
        parent_run_id INTEGER,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_schema_json TEXT NOT NULL,
        user_content TEXT NOT NULL,
        max_tokens INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        response_payload TEXT,
        error TEXT,
        agent_identity TEXT,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT
    )""",
    """CREATE INDEX IF NOT EXISTS idx_llm_jobs_status_created ON llm_jobs(status, created_at)""",
    """CREATE INDEX IF NOT EXISTS idx_llm_jobs_slug ON llm_jobs(roaster_slug)""",
    """CREATE INDEX IF NOT EXISTS idx_llm_jobs_parent ON llm_jobs(parent_run_id)""",

    # ── agent_summaries — explicit session-log for autonomous agents.
    # Every agent that performs catalog ops (drainer, orchestrator,
    # auto-approve runner, hint-regen, etc.) calls
    # `crema_log_agent_summary` at exit with a free-text task_label +
    # 3-5-sentence summary in its own voice + outcome + the roaster
    # slugs it touched. The UI digest reads this table.
    #
    # task_label is free-text by design — agents describe what they
    # actually did, searchable later. outcome is a closed enum so the
    # UI can color-code (success / partial / failed / aborted).
    # metrics is a free-form JSON object — agents can stash counters
    # like {"jobs_processed": 12, "approved": 9, "rejected": 0}.
    """CREATE TABLE IF NOT EXISTS agent_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_identity TEXT NOT NULL,
        task_label TEXT NOT NULL,
        prompt_excerpt TEXT,
        summary TEXT NOT NULL,
        outcome TEXT,
        tool_calls_count INTEGER,
        scope_slugs TEXT,
        metrics TEXT,
        started_at TEXT,
        ended_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )""",
    """CREATE INDEX IF NOT EXISTS idx_agent_summaries_ended ON agent_summaries(ended_at DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_summaries_agent ON agent_summaries(agent_identity, ended_at DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_summaries_outcome ON agent_summaries(outcome)""",

    # ── agent_actions — timestamped per-phase log within an agent session.
    # Granularity is INTENTIONALLY coarser than agent_runs (which captures
    # every MCP tool call). Each action represents a meaningful decision
    # or phase: "ran diff_sweep", "fired enrich_all on 10 stale roasters",
    # "spawned drainer L", "auto-approved 23 proposals", "investigated
    # humble-express deletions". The `reasoning` field is the agent's
    # own explanation in plain prose — WHY did it do this. This is the
    # human-readable activity timeline: 10-20 entries per session, not
    # the 250 MCP tool calls underneath.
    """CREATE TABLE IF NOT EXISTS agent_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_identity TEXT NOT NULL,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        action TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        metadata_json TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )""",
    """CREATE INDEX IF NOT EXISTS idx_agent_actions_session ON agent_actions(session_id, ts)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_actions_ts ON agent_actions(ts DESC)""",

    # ── agent_memory — durable lessons learned across sessions. This is
    # the "experience" surface. When an agent encounters something
    # surprising (a noise mode, a workaround, a discovered constraint
    # in the system), it can log a memory entry. Future agents reading
    # this scope at session start inherit the lesson without needing
    # the original incident report.
    #
    # `scope` groups lessons by domain (catalog-ops, scrape-noise,
    # wix-routing, drainer-discipline). Tags add finer slicing.
    #
    # `lesson` is the actionable takeaway, kept short — like a
    # one-line postmortem item: "When a Shopify /products.json returns
    # empty, retry once with backoff — Shopify rate-limit clears in
    # ~2s." Future agents can grep these for relevant context.
    #
    # `reference_count` and `last_referenced_at` track which lessons
    # are actually load-bearing vs vestigial — pruning candidates.
    """CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        lesson TEXT NOT NULL,
        tags_json TEXT,
        source_session_id TEXT,
        source_summary_id INTEGER REFERENCES agent_summaries(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_referenced_at TEXT,
        reference_count INTEGER NOT NULL DEFAULT 0
    )""",
    """CREATE INDEX IF NOT EXISTS idx_agent_memory_scope ON agent_memory(scope, created_at DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_agent_memory_last_ref ON agent_memory(last_referenced_at DESC)""",
    # severity column for agent_actions (info | warn | error). Default 'info'
    # keeps existing rows backwards-compatible. Server-side bulk operations
    # (diff_sweep crawl failures, etc.) write warn/error entries so the agent
    # can scan its journal for issues without parsing every action's
    # reasoning prose. Surfaced via crema_get_session_actions.
    "ALTER TABLE agent_actions ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'",
    "CREATE INDEX IF NOT EXISTS idx_agent_actions_severity ON agent_actions(severity, ts DESC)",
    # source_thin enrichment_status — for products where the ladder
    # exhausted all tiers and the source genuinely had no enrichment
    # data. Signals to UI: render the product as-is, show 'details
    # unavailable'. Distinct from 'failed' (transient errors worth
    # retrying) and 'enriched' (proper data landed).
    # No schema change required — enrichment_status is a free-text
    # TEXT column. Migration list kept for documentation continuity.
    # ── Scraper v2 — enrichment_tasks state-machine table ────────────────
    # Per-(url, kind) work-tracking row. v2's enrichment_runner inserts
    # one row per discovered URL and transitions it through the state
    # machine (discovered → fetching → llm_pending → enriched | failed |
    # skipped). The actual canonical data lives in `products` or
    # `roaster_articles`; this table tracks the work. `extraction_provenance`
    # is the publish-gate input — `haiku` / `haiku_site_hinted` land
    # directly, `bs4_fallback` routes to admin review, `admin_manual` is
    # sticky and v2 never overwrites it.
    # Empty during the first PR — no writers yet; the runner lands in a
    # later PR (see AGENTIC_UTOPIA.md + the v1→v2 handoff). FK to llm_jobs
    # and jobs is SET NULL so housekeeping deletes don't cascade away the
    # task lineage.
    """CREATE TABLE IF NOT EXISTS enrichment_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('product', 'article')),
        url TEXT NOT NULL,
        url_hash TEXT NOT NULL,
        roaster_slug TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'discovered'
            CHECK (state IN ('discovered', 'fetching', 'llm_pending',
                             'enriched', 'failed', 'skipped')),
        state_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        extraction_provenance TEXT,
        last_error TEXT,
        llm_job_id INTEGER REFERENCES llm_jobs(id) ON DELETE SET NULL,
        result_table TEXT CHECK (result_table IN ('products', 'roaster_articles')),
        result_id INTEGER,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(url, kind)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_enrichment_tasks_state ON enrichment_tasks(state, state_changed_at)",
    "CREATE INDEX IF NOT EXISTS idx_enrichment_tasks_roaster ON enrichment_tasks(roaster_slug, kind)",
    "CREATE INDEX IF NOT EXISTS idx_enrichment_tasks_job ON enrichment_tasks(job_id)",
    "CREATE INDEX IF NOT EXISTS idx_enrichment_tasks_provenance ON enrichment_tasks(extraction_provenance)",
    # ── Journal-style agent log body ───────────────────────────────────
    # `agent_summaries.summary` stays as the SHORT EXCERPT (1-3
    # sentences, shown on the card). `body_html` is the optional
    # long-form journal narrative — paragraphs / lists / quotes /
    # subheadings, rendered via the same `htmlToBlocks` walker the
    # consumer JOURNAL reader uses. Per the directive: every agent
    # log entry is written by the orchestrator, in plain English, as
    # if briefing a colleague (not a technical dump).
    #
    # Allowed tag subset (enforced by writer convention, not by the
    # column type): h2, h3, p, ul, ol, li, blockquote, strong, em, a.
    # Tags outside that subset get stripped at render time.
    "ALTER TABLE agent_summaries ADD COLUMN body_html TEXT",
    # `enriched_at` (added 2026-05-25) — UTC ISO timestamp the
    # entity_upserter writes on every product INSERT or UPDATE through
    # the v2 pipeline. Distinct from `created_at` (row birth, never
    # bumped). Version-tracking handle: "when did Haiku last touch this
    # row?". NULL means the row predates the enriched_at column or has
    # only ever flowed through the legacy v1 path. Surface in the
    # catalog quality audit so operators can spot stale rows that need
    # a fresh sweep.
    "ALTER TABLE products ADD COLUMN enriched_at TEXT",
    "CREATE INDEX IF NOT EXISTS idx_products_enriched_at ON products(enriched_at)",
    # Stuck-claim reaper bookkeeping (2026-05-26, L1) — when a Claude
    # Agent Haiku drainer subagent calls /admin/llm-jobs/next (atomic
    # claim) then exits without /admin/llm-jobs/{id}/respond, the job
    # stays status='in_progress' indefinitely and the bulk_reenrich BG
    # worker blocks waiting for the response — stalling the whole
    # roaster's bulk pass. The reaper at the top of admin_llm_jobs_next
    # flips claims older than a TTL (default 300s) back to 'pending' so
    # the next drainer can claim them. These two columns persist a
    # per-job record of when/how-many-times the row was reaped so the
    # operator can spot drainer-flakiness patterns via the standard
    # /admin/llm-jobs list endpoint without needing to grep server logs.
    "ALTER TABLE llm_jobs ADD COLUMN last_reaped_at TEXT",
    "ALTER TABLE llm_jobs ADD COLUMN reap_count INTEGER NOT NULL DEFAULT 0",
    # ── Background-applier columns (2026-05-29) ──────────────────────
    # The v2 queue path historically COUPLED the apply (entity_upserter
    # upsert) to the BG thread inline-polling llm_router._call_via_queue
    # for the drained response. If that thread timed out (600s, no
    # drainer answered) the eventually-completed job was ORPHANED — the
    # drainer's output landed nowhere and the product silently never
    # updated ("huge activity, zero consumer result"). These columns let
    # the drainer's own submit (POST /admin/llm-jobs/{id}/respond) BE the
    # applier: apply_context_json carries everything the upsert needs
    # (kind, url, roaster_slug, scraped_at, provenance, the resolved
    # deterministic hints, task_id) so the apply no longer depends on a
    # live waiting thread. applied_at marks the row applied (idempotency
    # + observability); apply_error records an apply failure WITHOUT
    # failing the job (the LLM output is still valid; QC surfaces it).
    "ALTER TABLE llm_jobs ADD COLUMN apply_context_json TEXT",
    "ALTER TABLE llm_jobs ADD COLUMN applied_at TEXT",
    "ALTER TABLE llm_jobs ADD COLUMN apply_error TEXT",
    # Article editorial grading (2026-05-26, M2) — populated by
    # services/article_grader.py. The grade combines Haiku-rated
    # subjective signals (editorial prose quality, sourcing
    # specificity) with deterministically-computed structural
    # signals from body_html (image richness, product cross-links to
    # this roaster's own catalog, internal article cross-links to
    # other Crema articles). High-scoring articles surface in the
    # consumer "Featured" rail and are weighted higher in roaster-
    # page article ordering. NULL means the row hasn't been graded
    # yet — bulk-grade backfill via crema_grade_articles handles the
    # one-time fill; new articles get graded inline when the
    # enrichment pipeline runs over them.
    "ALTER TABLE roaster_articles ADD COLUMN editorial_score INTEGER",
    "ALTER TABLE roaster_articles ADD COLUMN editorial_score_components TEXT",
    "ALTER TABLE roaster_articles ADD COLUMN editorial_scored_at TEXT",
    "CREATE INDEX IF NOT EXISTS idx_roaster_articles_editorial_score ON roaster_articles(editorial_score DESC)",
    # Three-tier quality reviewer (2026-05-26). Catches semantic
    # hallucinations Pydantic can't — varietal=spirit-name,
    # coffee_name=brand, origin-not-in-page-text, all-generic
    # cliche-bingo enrichments. One row per (target, tier, rule)
    # finding. Verdict 'pending' until T2 Haiku review fires;
    # 'confirmed' or 'cleared' after T2; 'overridden' after T3
    # Opus correction. lesson column captures what T3 learned so
    # the orchestrator can grow T1 rules over time.
    """CREATE TABLE IF NOT EXISTS quality_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_table TEXT NOT NULL CHECK (target_table IN ('products','roaster_articles')),
        target_id TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier IN (1,2,3)),
        rule TEXT NOT NULL,
        field TEXT,
        evidence TEXT,
        flagged_value TEXT,
        verdict TEXT NOT NULL DEFAULT 'pending'
            CHECK (verdict IN ('pending','confirmed','cleared','overridden')),
        corrected_value TEXT,
        lesson TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_quality_reviews_target ON quality_reviews(target_table, target_id)",
    "CREATE INDEX IF NOT EXISTS idx_quality_reviews_verdict ON quality_reviews(verdict, tier)",
    "CREATE INDEX IF NOT EXISTS idx_quality_reviews_created ON quality_reviews(created_at DESC)",
    # Bio-as-discovery (2026-05-27). The roaster bio enrich captures
    # the homepage link graph (product, article, collection URLs found
    # in <a href> anchors) as a structured artifact. Quality reviewer
    # cross-checks against the catalog — URL drift / replatform / dead
    # rows surface at the bio layer rather than via the diff layer's
    # heuristic handle-match. Discovered URLs are JSON arrays;
    # bio_discovery_at is the ISO timestamp of the last bio run that
    # populated them.
    "ALTER TABLE roaster_sources ADD COLUMN discovered_product_urls TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN discovered_article_urls TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN discovered_collection_urls TEXT",
    "ALTER TABLE roaster_sources ADD COLUMN bio_discovery_at TEXT",
    # Operation-level QC (2026-05-27). Every state-mutating catalog
    # operation logs its outcome here. Post-completion, T1
    # deterministic rules + T2 Haiku reviewer evaluate the summary
    # for anomalies (mass deletes, enriched-rate drops, duplicate
    # standardize bursts). Flags land in quality_reviews with
    # target_table='catalog_operations' so the orchestrator's
    # existing review queue surfaces them alongside row-level QC.
    """CREATE TABLE IF NOT EXISTS catalog_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        target_slug TEXT,
        params_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running'
            CHECK (status IN ('running','succeeded','failed','rolled_back')),
        summary_json TEXT,
        error_message TEXT,
        started_by TEXT,
        parent_operation_id INTEGER REFERENCES catalog_operations(id) ON DELETE SET NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_catalog_operations_kind ON catalog_operations(kind, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_catalog_operations_slug ON catalog_operations(target_slug)",
    "CREATE INDEX IF NOT EXISTS idx_catalog_operations_status ON catalog_operations(status)",
    "CREATE INDEX IF NOT EXISTS idx_catalog_operations_parent ON catalog_operations(parent_operation_id)",
    # Per-row pre-mutation snapshot. Captures the row state BEFORE
    # any destructive op writes — enables crema_rollback_operation
    # to restore deleted / mutated rows. Table-grain (not file-grain)
    # so rollbacks are precise to one operation without coupling.
    """CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id INTEGER NOT NULL
            REFERENCES catalog_operations(id) ON DELETE CASCADE,
        table_name TEXT NOT NULL,
        row_pk TEXT NOT NULL,
        row_json_before TEXT,
        mutation_kind TEXT NOT NULL
            CHECK (mutation_kind IN ('update','delete','insert')),
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_catalog_snapshots_op ON catalog_snapshots(operation_id)",
    "CREATE INDEX IF NOT EXISTS idx_catalog_snapshots_table ON catalog_snapshots(table_name, row_pk)",
]


# ── Catalog-only build: strip the social-feed schema ─────────────────────────
# The social feed and its tables — posts/follows/notifications/DMs, the
# tasting journal, and their like/comment sub-tables — were removed for the
# catalog-only launch. Rather than surgically deleting the (interleaved,
# multi-line) CREATE statements from the migration list above, filter any
# social CREATE/INDEX/ALTER statement out at load time so a fresh DB never
# creates them, then DROP any left over in an existing DB. The full social
# schema is preserved at git tag `social-v1`.
_SOCIAL_SCHEMA_TABLES = (
    "roaster_posts", "follows", "notifications", "post_likes", "post_comments",
    "comment_likes", "post_hides", "post_dislikes", "post_reports",
    "direct_threads", "direct_messages", "direct_message_reports",
    "article_hides", "article_dislikes",
    "tasting_notes", "note_likes", "note_comments",
)


def _is_social_schema_stmt(stmt: str) -> bool:
    s = " ".join(stmt.split()).lower()
    for t in _SOCIAL_SCHEMA_TABLES:
        if (f"create table if not exists {t} (" in s
                or f"on {t}(" in s
                or f"on {t} (" in s
                or f"alter table {t} " in s):
            return True
    return False


_MIGRATIONS = [m for m in _MIGRATIONS if not _is_social_schema_stmt(m)]

# Drop leftover social tables from an existing DB (no-op on a fresh DB via
# IF EXISTS). Children before parents; DROP TABLE also drops the table's
# indexes, so no explicit DROP INDEX is needed.
_MIGRATIONS += [
    "DROP TABLE IF EXISTS comment_likes",
    "DROP TABLE IF EXISTS post_comments",
    "DROP TABLE IF EXISTS post_likes",
    "DROP TABLE IF EXISTS post_hides",
    "DROP TABLE IF EXISTS post_dislikes",
    "DROP TABLE IF EXISTS post_reports",
    "DROP TABLE IF EXISTS note_likes",
    "DROP TABLE IF EXISTS note_comments",
    "DROP TABLE IF EXISTS direct_message_reports",
    "DROP TABLE IF EXISTS direct_messages",
    "DROP TABLE IF EXISTS direct_threads",
    "DROP TABLE IF EXISTS article_hides",
    "DROP TABLE IF EXISTS article_dislikes",
    "DROP TABLE IF EXISTS roaster_posts",
    "DROP TABLE IF EXISTS tasting_notes",
    "DROP TABLE IF EXISTS follows",
    "DROP TABLE IF EXISTS notifications",
]


def _migrate_quality_reviews_target_table(conn):
    """Rebuild quality_reviews to extend the target_table CHECK.

    The CHECK started as IN ('products', 'roaster_articles'). Two
    expansions over time:
      - 2026-05-27 (bio): + 'roaster_profiles'
      - 2026-05-27 (op-qc): + 'catalog_operations'

    SQLite can't ALTER a CHECK constraint, so we rebuild the table.

    Idempotent: skips when the CHECK already allows catalog_operations
    (the newest value), or when the table doesn't exist yet.
    """
    try:
        cur = conn.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type = 'table' AND name = 'quality_reviews'"
        )
        row = cur.fetchone()
    except sqlite3.OperationalError:
        return
    if not row:
        return
    schema_sql = row[0] or ""
    if "catalog_operations" in schema_sql:
        return  # Already at newest CHECK
    conn.executescript("""
        BEGIN TRANSACTION;
        CREATE TABLE quality_reviews_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_table TEXT NOT NULL CHECK (target_table IN (
                'products','roaster_articles','roaster_profiles',
                'catalog_operations'
            )),
            target_id TEXT NOT NULL,
            tier INTEGER NOT NULL CHECK (tier IN (1,2,3)),
            rule TEXT NOT NULL,
            field TEXT,
            evidence TEXT,
            flagged_value TEXT,
            verdict TEXT NOT NULL DEFAULT 'pending'
                CHECK (verdict IN ('pending','confirmed','cleared','overridden')),
            corrected_value TEXT,
            lesson TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            resolved_by TEXT
        );
        INSERT INTO quality_reviews_new SELECT * FROM quality_reviews;
        DROP TABLE quality_reviews;
        ALTER TABLE quality_reviews_new RENAME TO quality_reviews;
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_target
            ON quality_reviews(target_table, target_id);
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_verdict
            ON quality_reviews(verdict, tier);
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_created
            ON quality_reviews(created_at DESC);
        COMMIT;
    """)


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
    # Quality reviews target_table CHECK extension (table rebuild)
    try:
        _migrate_quality_reviews_target_table(conn)
    except Exception as e:
        print(f"Quality reviews migration note: {e}")
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
    # Roaster avatar backfill — covers any account_type='roaster' user
    # with NULL avatar_url whose roaster has a logo on file. The
    # registry's `sync_user_avatar_from_roaster` hook handles this on
    # every UPDATE, but raw-INSERT paths (admin seed scripts, dev
    # bootstrap, direct SQL) bypass the hook and land the row with
    # NULL avatar. Running the backfill on every init_db keeps the
    # invariant ("a roaster-account user has the roaster's logo as
    # their avatar") true regardless of how the user row was created.
    try:
        _backfill_roaster_avatars(conn)
    except Exception as e:
        print(f"Roaster avatar backfill note: {e}")
    conn.close()


def _backfill_roaster_avatars(conn):
    """Populate `users.avatar_url` for every account_type='roaster'
    user whose row has NULL/empty avatar but whose linked
    `roaster_profiles` row carries a non-empty `logo_url`. Idempotent —
    re-running finds zero rows after the first pass."""
    cur = conn.execute("""
        UPDATE users
        SET avatar_url = (
            SELECT logo_url FROM roaster_profiles
            WHERE roaster_profiles.roaster_slug = users.roaster_slug
        )
        WHERE account_type = 'roaster'
          AND (avatar_url IS NULL OR avatar_url = '')
          AND roaster_slug IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM roaster_profiles
            WHERE roaster_profiles.roaster_slug = users.roaster_slug
              AND roaster_profiles.logo_url IS NOT NULL
              AND roaster_profiles.logo_url <> ''
          )
    """)
    if cur.rowcount > 0:
        print(f"Roaster avatar backfill: synced {cur.rowcount} user(s)")
    conn.commit()


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
