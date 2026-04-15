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
    # Admin flag — gates the /api/stats/traction endpoint. Only the seeded
    # "crema" account gets is_admin=1. Defense in depth: endpoint checks both
    # is_admin=1 AND username="crema".
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
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
    # Seed pilot cafés (idempotent)
    try:
        _seed_pilot_cafes(conn)
    except Exception as e:
        print(f"Café seed note: {e}")
    conn.close()


def _seed_pilot_cafes(conn):
    """Seed Brightside Café and Prana Goa — the Goa pilot. Idempotent."""
    import datetime as _dt
    now = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    existing = conn.execute("SELECT cafe_slug FROM cafe_profiles WHERE cafe_slug IN ('brightside-mandrem', 'prana-goa')").fetchall()
    existing_slugs = {r[0] for r in existing}

    if 'brightside-mandrem' not in existing_slugs:
        conn.execute("""
            INSERT INTO cafe_profiles (
                cafe_slug, name, about_blurb, address, city, state,
                instagram_handle, seasonal_open_month, seasonal_close_month,
                stamps_enabled, stamp_target, stamp_reward,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'brightside-mandrem',
            'Brightside Café',
            'A small café opposite the Mahalaxmi Temple in Mandrem. Known for bagels, continental brunch, and some of the best coffee in Goa. Closed during monsoon.',
            'Junas Waddo, opposite Mahalaxmi Temple, Mandrem',
            'Mandrem', 'Goa',
            'brightsidecafe_goa',
            10,  # opens October
            5,   # closes end of May (i.e. closed June-September)
            1, 10, 'Free coffee',
            now, now,
        ))

    if 'prana-goa' not in existing_slugs:
        conn.execute("""
            INSERT INTO cafe_profiles (
                cafe_slug, name, about_blurb, address, city, state,
                instagram_handle, website,
                seasonal_open_month, seasonal_close_month,
                stamps_enabled, stamp_target, stamp_reward,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'prana-goa',
            'Prana Goa',
            'Wellness café at Vaayu Waterman''s Village in Ashwem. Multi-roaster pour menu, open year-round.',
            'Vaayu Waterman''s Village, Ashwem, Mandrem',
            'Mandrem', 'Goa',
            'prana.goa',
            'https://pranagoa.com',
            None, None,  # year-round
            1, 10, 'Free coffee',
            now, now,
        ))

    conn.commit()
