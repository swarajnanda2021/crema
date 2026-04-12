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
    shelf TEXT NOT NULL CHECK (shelf IN ('currently_drinking', 'drank', 'want_to_try')),
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
]


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
    conn.close()
