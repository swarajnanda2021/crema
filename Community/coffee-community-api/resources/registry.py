"""
╔══════════════════════════════════════════════════════════════════════════╗
║  CRUD UTOPIA — THIS FILE IS THE BACKEND SPEC                             ║
║                                                                          ║
║  Every CRUD resource lives here. The generic engine in crud.py reads     ║
║  these declarations and generates SQL. Adding a resource is a ~20-line   ║
║  entry — not a new router file.                                          ║
║                                                                          ║
║  Before editing: read CRUD_UTOPIA.md at repo root.                       ║
║  Before adding: check if it fits an existing pattern first.              ║
╚══════════════════════════════════════════════════════════════════════════╝

Resource Registry — declarative definitions for every CRUD resource.

Each resource maps to a database table and declares:
- fields with types, validation, defaults
- auth requirements per operation
- joins (eager-loaded related data)
- counts (aggregated sub-resource counts)
- current_user_flags (e.g. liked_by_me)
- embeds (nested resource objects, e.g. original_post inside a repost)
- hooks (on_create, on_toggle_on) for side-effects like notifications
"""

RESOURCES = {
    # ── Users ─────────────────────────────────────────────────────────────
    "users": {
        "table": "users",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "username": {"type": "str"},
            "display_name": {"type": "str"},
            "bio": {"type": "str"},
            "avatar_url": {"type": "str"},
            "location": {"type": "str"},
            "coffee_preference": {"type": "str"},
            "brewing_style": {"type": "str"},
            "favorite_drink": {"type": "str"},
            "favorite_cafe": {"type": "str"},
            "avatar_crop_x": {"type": "float", "default": 50},
            "avatar_crop_y": {"type": "float", "default": 50},
            "avatar_zoom": {"type": "float", "default": 1},
            "account_type": {"type": "str", "default": "user"},
            "roaster_slug": {"type": "str"},
            "created_at": {"type": "str", "ro": True},
        },
        "hidden": ["password_hash"],
        "auth": {"list": None, "read": None, "update": "owner"},
        "owner": "id",
        "order": "id ASC",
    },

    # ── Posts ─────────────────────────────────────────────────────────────
    "posts": {
        "table": "roaster_posts",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "roaster_slug": {"type": "str", "auto": "user_slug"},
            "title": {"type": "str"},
            "teaser": {"type": "str"},
            "external_url": {"type": "str"},
            "cover_image_url": {"type": "str"},
            "post_type": {"type": "str", "default": "note"},
            "location": {"type": "str"},
            "cafe_slug": {"type": "str"},  # optional café tag (CRUD Utopia: see CRUD_UTOPIA.md)
            "images_json": {"type": "json"},
            "repost_of_id": {"type": "int"},
            "repost_comment": {"type": "str"},
            "tasting_note_id": {"type": "int"},
            "is_featured": {"type": "int", "default": 0},
            "featured_order": {"type": "int"},
            "is_pinned": {"type": "int", "default": 0},
            "published_at": {"type": "str", "auto": "now"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "author", "on": "user_id",
             "fields": ["username", "display_name", "avatar_url", "avatar_crop_x", "avatar_crop_y", "avatar_zoom"]},
        ],
        "counts": [
            {"name": "like_count", "table": "post_likes", "fk": "post_id"},
            {"name": "comment_count", "table": "post_comments", "fk": "post_id"},
            {"name": "repost_count", "table": "roaster_posts", "fk": "repost_of_id"},
        ],
        "flags": [
            {"name": "liked_by_me", "table": "post_likes", "fk": "post_id", "user_col": "user_id"},
        ],
        "embeds": [
            {"name": "original_post", "self_fk": "repost_of_id"},
        ],
        "order": "published_at DESC",
        "limit": 20,
        "hooks": {"on_create": ["notify_repost"]},
    },

    # ── Post Likes (toggle) ──────────────────────────────────────────────
    "post_likes": {
        "table": "post_likes",
        "type": "toggle",
        "parent": "posts",
        "parent_table": "roaster_posts",
        "fk": "post_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
        "hooks": {"on_toggle_on": ["notify_like"]},
    },

    # ── Post Comments ────────────────────────────────────────────────────
    "post_comments": {
        "table": "post_comments",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "post_id": {"type": "int", "required": True},
            "comment": {"type": "str", "required": True},
            "parent_id": {"type": "int"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        "parent": "posts",
        "parent_table": "roaster_posts",
        "fk": "post_id",
        "auth": {"list": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "user", "on": "user_id",
             "fields": ["id", "username", "display_name", "avatar_url"]},
        ],
        "counts": [
            {"name": "like_count", "table": "comment_likes", "fk": "comment_id"},
        ],
        "flags": [
            {"name": "liked_by_me", "table": "comment_likes", "fk": "comment_id", "user_col": "user_id"},
        ],
        "order": "created_at ASC",
        "hooks": {"on_create": ["notify_comment"]},
    },

    # ── Comment Likes (toggle) ───────────────────────────────────────────
    "comment_likes": {
        "table": "comment_likes",
        "type": "toggle",
        "parent": "post_comments",
        "parent_table": "post_comments",
        "fk": "comment_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
        "hooks": {"on_toggle_on": ["notify_comment_like"]},
    },

    # ── Follows (toggle by slug) ─────────────────────────────────────────
    "follows": {
        "table": "follows",
        "type": "toggle",
        "fk": "roaster_slug",
        "fk_type": "str",
        "user_col": "follower_user_id",
        "auth": {"toggle": "required"},
        "hooks": {"on_toggle_on": ["notify_follow"]},
    },

    # ── Shelves ──────────────────────────────────────────────────────────
    "shelves": {
        "table": "shelf_entries",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "product_id": {"type": "str", "required": True},
            "shelf": {"type": "str", "required": True},
            "added_at": {"type": "str", "ro": True, "auto": "now"},
            "moved_at": {"type": "str", "auto": "now"},
        },
        "auth": {"list": None, "create": "required", "delete": "owner"},
        "owner": "user_id",
        "order": "moved_at DESC",
        "limit": 200,
        "group_by": "shelf",
        "hooks": {"on_create": ["shelf_upsert"]},
    },

    # ── Tasting Notes ────────────────────────────────────────────────────
    "tasting_notes": {
        "table": "tasting_notes",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "product_id": {"type": "str", "required": True},
            "acidity": {"type": "int"},
            "body": {"type": "int"},
            "sweetness": {"type": "int"},
            "aftertaste": {"type": "int"},
            "flavor_tags": {"type": "json"},
            "brew_method": {"type": "str"},
            "drink_style": {"type": "str"},
            "milk_type": {"type": "str"},
            "dose_grams": {"type": "float"},
            "yield_grams": {"type": "float"},
            "water_ml": {"type": "float"},
            "extraction_time_secs": {"type": "int"},
            "water_temp_celsius": {"type": "int"},
            "grind_size": {"type": "str"},
            "brew_ratio": {"type": "str"},
            "blend_components": {"type": "json"},
            "comment": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "author", "on": "user_id",
             "fields": ["username", "display_name", "avatar_url", "location"]},
        ],
        "order": "created_at DESC",
        "limit": 20,
        "hooks": {"on_create": ["validate_dictionary", "auto_create_post"]},
    },

    # ── Note Likes (toggle) ──────────────────────────────────────────────
    "note_likes": {
        "table": "note_likes",
        "type": "toggle",
        "parent": "tasting_notes",
        "parent_table": "tasting_notes",
        "fk": "note_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Note Comments ────────────────────────────────────────────────────
    "note_comments": {
        "table": "note_comments",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "note_id": {"type": "int", "required": True},
            "comment": {"type": "str", "required": True},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "parent": "tasting_notes",
        "parent_table": "tasting_notes",
        "fk": "note_id",
        "auth": {"list": None, "create": "required", "delete": "owner"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "user", "on": "user_id",
             "fields": ["username", "display_name"]},
        ],
        "order": "created_at ASC",
    },

    # ── Notifications ────────────────────────────────────────────────────
    "notifications": {
        "table": "notifications",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True},
            "type": {"type": "str"},
            "actor_id": {"type": "int"},
            "post_id": {"type": "int"},
            "comment_id": {"type": "int"},
            "read": {"type": "int", "default": 0},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": "self", "update": "self"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "actor", "on": "actor_id",
             "fields": ["username", "display_name", "avatar_url", "avatar_crop_x", "avatar_crop_y", "avatar_zoom"]},
        ],
        "order": "created_at DESC",
        "limit": 50,
    },

    # ── Products (unified table) ─────────────────────────────────────────
    "products": {
        "table": "products",
        "pk": "product_id",
        "pk_type": "str",
        "fields": {
            "product_id": {"type": "str", "required": True},
            "roaster_slug": {"type": "str", "required": True},
            "roaster_name": {"type": "str"},
            "coffee_name": {"type": "str", "required": True},
            "roast_level": {"type": "str"},
            "tasting_notes": {"type": "str"},
            "origin": {"type": "str"},
            "process": {"type": "str"},
            "varietal": {"type": "str"},
            "altitude_masl": {"type": "int"},
            "bean_type": {"type": "str"},
            "flavor_notes": {"type": "str"},
            "weight_grams": {"type": "int"},
            "price_inr": {"type": "float"},
            "image_url": {"type": "str"},
            "product_url": {"type": "str"},
            "description_raw": {"type": "str"},
            "available": {"type": "int", "default": 1},
            "source": {"type": "str", "default": "scraped"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": None, "read": None, "create": "required", "delete": "required"},
        "order": "coffee_name ASC",
        "limit": 500,
        "subfields": [
            {"name": "roaster_city", "sql": "(SELECT rp.city FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
            {"name": "roaster_state", "sql": "(SELECT rp.state FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
        ],
    },

    # ── Roaster Profiles ─────────────────────────────────────────────────
    "roaster_profiles": {
        "table": "roaster_profiles",
        "pk": "roaster_slug",
        "pk_type": "str",
        "fields": {
            "roaster_slug": {"type": "str", "required": True},
            "name": {"type": "str"},
            "about_blurb": {"type": "str"},
            "specialties": {"type": "json"},
            "website": {"type": "str"},
            "city": {"type": "str"},
            "state": {"type": "str"},
            "logo_url": {"type": "str"},
            "hero_image_url": {"type": "str"},
            "hero_crop_x": {"type": "float", "default": 50},
            "hero_crop_y": {"type": "float", "default": 50},
            "hero_zoom": {"type": "float", "default": 1},
            "updated_at": {"type": "str"},
        },
        "auth": {"list": None, "read": None, "update": "required"},
        "order": "roaster_slug ASC",
    },

    # ── Click Events (write-only) ────────────────────────────────────────
    "click_events": {
        "table": "click_events",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int"},
            "product_id": {"type": "str"},
            "roaster_slug": {"type": "str"},
            "source_page": {"type": "str"},
            "clicked_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"create": None},
        "write_only": True,
    },

    # ── Café entity (see CRUD_UTOPIA.md) ─────────────────────────────────
    "cafe_profiles": {
        "table": "cafe_profiles",
        "pk": "cafe_slug",
        "fields": {
            "cafe_slug": {"type": "str", "required": True},
            "name": {"type": "str", "required": True},
            "about_blurb": {"type": "str"},
            "cover_image_url": {"type": "str"},
            "logo_url": {"type": "str"},
            "hero_crop_x": {"type": "float", "default": 50},
            "hero_crop_y": {"type": "float", "default": 50},
            "hero_zoom": {"type": "float", "default": 1},
            "address": {"type": "str"},
            "city": {"type": "str"},
            "state": {"type": "str"},
            "lat": {"type": "float"},
            "lng": {"type": "float"},
            "instagram_handle": {"type": "str"},
            "website": {"type": "str"},
            "phone": {"type": "str"},
            "hours_json": {"type": "json"},
            "seasonal_open_month": {"type": "int"},
            "seasonal_close_month": {"type": "int"},
            "stamps_enabled": {"type": "int", "default": 0},
            "stamp_target": {"type": "int", "default": 10},
            "stamp_reward": {"type": "str", "default": "Free coffee"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "cafe_slug",
        "owner_user_field": "cafe_slug",  # user.cafe_slug must match row.cafe_slug
        "pk_type": "str",
        "counts": [
            {"name": "stamps_given", "table": "stamps", "fk": "cafe_slug"},
            {"name": "rewards_redeemed", "table": "stamp_rewards", "fk": "cafe_slug"},
        ],
        "order": "name ASC",
        "limit": 100,
    },

    "cafe_menu_items": {
        "table": "cafe_menu_items",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "cafe_slug": {"type": "str", "required": True},
            "drink_name": {"type": "str", "required": True},
            "drink_order": {"type": "int", "default": 0},
            "roaster_slug": {"type": "str"},
            "product_id": {"type": "str"},
            "manual_roaster_name": {"type": "str"},
            "manual_roaster_url": {"type": "str"},
            "manual_bean_name": {"type": "str"},
            "roast_level": {"type": "str"},
            "process": {"type": "str"},
            "notes": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "parent": "cafe_profiles",
        "parent_table": "cafe_profiles",
        "fk": "cafe_slug",
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "cafe_slug",
        "owner_user_field": "cafe_slug",
        "order": "drink_order ASC, id ASC",
        "limit": 50,
    },

    "cafe_baristas": {
        "table": "cafe_baristas",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "cafe_slug": {"type": "str", "required": True},
            "name": {"type": "str", "required": True},
            "photo_url": {"type": "str"},
            "specialty": {"type": "str"},
            "display_order": {"type": "int", "default": 0},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "parent": "cafe_profiles",
        "parent_table": "cafe_profiles",
        "fk": "cafe_slug",
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "cafe_slug",
        "owner_user_field": "cafe_slug",
        "order": "display_order ASC, id ASC",
        "limit": 30,
    },

    "stamps": {
        "table": "stamps",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "required": True},
            "cafe_slug": {"type": "str", "required": True},
            "barista_id": {"type": "int"},
            "scanned_at": {"type": "str", "ro": True, "auto": "now"},
        },
        # Creation happens via specific endpoint (QR verification + rate limit);
        # list allowed so user profiles can show stamp history
        "auth": {"list": None, "read": None, "create": "blocked", "delete": "blocked"},
        "order": "scanned_at DESC",
        "limit": 500,
    },

    "stamp_rewards": {
        "table": "stamp_rewards",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "required": True},
            "cafe_slug": {"type": "str", "required": True},
            "stamps_used": {"type": "int", "required": True},
            "redeemed_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": None, "read": None, "create": "blocked", "delete": "blocked"},
        "order": "redeemed_at DESC",
        "limit": 200,
    },
}


def get_resource(name):
    """Get resource definition by name, raise if not found."""
    if name not in RESOURCES:
        raise KeyError(f"Unknown resource: {name}")
    return RESOURCES[name]
