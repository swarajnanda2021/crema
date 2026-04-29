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
            "favorite_cafe_slug": {"type": "str"},
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
            "cafe_slug": {"type": "str", "auto": "user_cafe_slug"},  # auto-set if poster is a café account; otherwise user supplies via tag
            "images_json": {"type": "json"},
            "repost_of_id": {"type": "int"},
            "repost_comment": {"type": "str"},
            "tasting_note_id": {"type": "int"},
            # Phase 1 §2.3 — long-form body for sourcing stories. Null
            # for every other post_type.
            "body_full": {"type": "str"},
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
            # Recommender-signal flags surfaced so the feed can locally
            # filter out posts the viewer already hid / disliked.
            {"name": "hidden_by_me", "table": "post_hides", "fk": "post_id", "user_col": "user_id"},
            {"name": "disliked_by_me", "table": "post_dislikes", "fk": "post_id", "user_col": "user_id"},
        ],
        "embeds": [
            {"name": "original_post", "self_fk": "repost_of_id"},
        ],
        "order": "published_at DESC",
        "limit": 20,
        # notify_repost handles repost authors; notify_sourcing_story is a
        # no-op for any post_type other than 'sourcing_story' so it can sit
        # alongside without an extra branch in the registry.
        "hooks": {"on_create": ["notify_repost", "notify_sourcing_story"]},
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

    # ── Post Hides (toggle — recommender negative signal) ────────────────
    # Tapping "Hide" from the three-dots menu on any non-owner post
    # records this row. The feed filters out posts with `hidden_by_me=1`
    # client-side on refetch (see the `posts` flag). Toggle shape means
    # repeated taps undo — useful if the user changes their mind. No
    # count surfaced; no notification fan-out.
    "post_hides": {
        "table": "post_hides",
        "type": "toggle",
        "parent": "posts",
        "parent_table": "roaster_posts",
        "fk": "post_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Post Dislikes (toggle — recommender negative signal) ─────────────
    # Silent "don't show me more like this" signal. Same shape as
    # post_hides but the feed doesn't filter out disliked posts — it
    # just records for future ranking. No count exposed to viewers.
    "post_dislikes": {
        "table": "post_dislikes",
        "type": "toggle",
        "parent": "posts",
        "parent_table": "roaster_posts",
        "fk": "post_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Post Reports (create-only — moderation signal) ───────────────────
    # Unlike hide/dislike, reports are NOT unique per (user, post) —
    # each tap records a fresh row so moderators can count repeat
    # reports from the same user. No update / delete from the viewer
    # side; only the admin can triage.
    "post_reports": {
        "table": "post_reports",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "post_id": {"type": "int", "required": True},
            "reason": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": "admin", "read": "admin", "create": "required", "update": None, "delete": "admin"},
        "owner": "user_id",
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
            "inquiry_id": {"type": "int"},
            "direct_thread_id": {"type": "int"},
            "target_slug": {"type": "str"},
            "subject": {"type": "str"},
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
            # Phase 1 §2.2 wholesale availability signal. Set by the
            # roaster owner in the product editor; rendered as a badge
            # on CoffeeCard (café viewers only).
            "wholesale_available": {"type": "int", "default": 0},
            "wholesale_minimum_kg": {"type": "int"},
            "wholesale_note": {"type": "str"},
            # Phase 3+ enricher fields — populated by Sonnet at staging
            # time, surfaced on the per-product card and the per-roaster
            # Coffees section.
            "process_raw": {"type": "str"},
            "producer": {"type": "str"},
            "brew_recommendation_json": {"type": "str"},
            "enrichment_status": {"type": "str", "default": "pending"},
            # Phase 6 — verbatim roast term + per-bean narrative blurb
            # (third-person, distilled from the roaster's own copy).
            "roast_level_name": {"type": "str"},
            "roaster_blurb": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": None, "read": None, "create": "required", "delete": "required"},
        "order": "coffee_name ASC",
        "limit": 500,
        "subfields": [
            {"name": "roaster_city", "sql": "(SELECT rp.city FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
            {"name": "roaster_state", "sql": "(SELECT rp.state FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
        ],
        # §2.20 — fan a wholesale_available notification to business
        # followers whenever a wholesale-flagged product is created or
        # saved. Roaster-side writes that go through the hand-rolled
        # routes/specific.py endpoints fire the same hook explicitly.
        "hooks": {
            "on_create": ["notify_wholesale_available"],
            "on_update": ["notify_wholesale_available"],
        },
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
            "tagline": {"type": "str"},
            "specialties": {"type": "json"},
            "website": {"type": "str"},
            "city": {"type": "str"},
            "state": {"type": "str"},
            "instagram_handle": {"type": "str"},
            "contact_email": {"type": "str"},
            "logo_url": {"type": "str"},
            "hero_image_url": {"type": "str"},
            "hero_crop_x": {"type": "float", "default": 50},
            "hero_crop_y": {"type": "float", "default": 50},
            "hero_zoom": {"type": "float", "default": 1},
            # Phase 1 — discoverability gate. Newly-enriched roasters land
            # at `published=0` and only flip to 1 once the admin opens the
            # profile drawer and toggles "Publish to Discover". Public
            # listings should filter on this column going forward.
            "published": {"type": "int", "default": 1},
            # Phase 6 follow-up — per-roaster site prompt addendum.
            # Sonnet writes this once after the first per-roaster Haiku
            # enrichment run completes; subsequent runs prepend it to
            # the base extraction system prompt. Visible to admin on
            # the roaster page so they can read what the model is
            # being told about THIS roaster on every run.
            "enrichment_prompt_hint": {"type": "str"},
            "updated_at": {"type": "str"},
        },
        "auth": {"list": None, "read": None, "update": "required"},
        "subfields": [
            # `products_count` lets the ROASTERS grid show "24 coffees in
            # catalog" on each roaster card without a second roundtrip.
            {"name": "products_count",
             "sql": "(SELECT COUNT(*) FROM products p WHERE p.roaster_slug = t.roaster_slug)"},
            # `scrape_ready` reflects whether the corresponding
            # `roaster_sources` row has both shop_url and platform set —
            # i.e., the scraper actually knows how to crawl it. Surface
            # this as the card's "✓ Scraper" / "⊘ Unverified" status.
            {"name": "scrape_ready",
             "sql": "(SELECT CASE WHEN rs.shop_url IS NOT NULL AND rs.platform IS NOT NULL "
                    "THEN 1 ELSE 0 END FROM roaster_sources rs WHERE rs.website = t.website)"},
        ],
        # When admin edits the roaster's display name via the inline
        # Name field on the admin page (PUT /api/roaster_profiles/{slug}),
        # propagate the change to `users.display_name` for the linked
        # roaster account so feed posts surface the canonical name
        # instead of the slug. Same pattern as `sync_roaster_logo_to_user`
        # (which lives explicit in the enrich routes); the dispatcher
        # entry is in services/notifications.py.
        "hooks": {"on_update": ["sync_roaster_name_to_user"]},
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
            "logo_crop_x": {"type": "float", "default": 50},
            "logo_crop_y": {"type": "float", "default": 50},
            "logo_zoom": {"type": "float", "default": 1},
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
            # Procurement profile (Phase 1 §2.6) — enriches the wholesale
            # inquiry notification so roasters can qualify a café lead.
            "monthly_volume_kg": {"type": "int"},
            "open_to_new_roasters": {"type": "int", "default": 0},
            "procurement_note": {"type": "str"},
            # Alt-milk surcharges. Array of { name, surcharge_inr }. The
            # café page renders this as a sentence at the top of the menu
            # ("Serves Oat ₹30, Almond ₹40, Soy, Coconut") and provides
            # an owner-edit modal in edit mode.
            "milk_options_json": {"type": "json"},
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
            # "Love count" — the scarce favorite-café signal. One per
            # user, so this is just COUNT(users WHERE favorite_cafe_slug).
            {"name": "love_count", "table": "users", "fk": "favorite_cafe_slug"},
        ],
        # When the café owner changes the logo, mirror it onto their
        # user.avatar_url so the navbar avatar reflects the new image.
        # notify_loyalty_changed (§2.20) is a no-op when stamps_enabled=0
        # so it can sit alongside without gating logic in the registry.
        "hooks": {"on_update": ["sync_cafe_logo_to_user", "notify_loyalty_changed"]},
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
            "hide_roaster": {"type": "int", "default": 0},
            # Per-cup pricing — `price_inr` is the hot-cup price, the
            # iced variant is captured separately so the menu table can
            # render two adjacent columns.
            "price_inr": {"type": "int"},
            "price_iced_inr": {"type": "int"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "parent": "cafe_profiles",
        "parent_table": "cafe_profiles",
        "fk": "cafe_slug",
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "cafe_slug",
        "owner_user_field": "cafe_slug",
        # Menu changes fan out to the café's followers as notifications.
        # `notify_menu_updated_business` (§2.20) is the B2B-flavored
        # parallel: same trigger, but only goes to followers whose
        # account_type is roaster/cafe and lands as `menu_updated_business`
        # so the Business tab can read it as procurement signal rather
        # than activity.
        "hooks": {
            "on_create": ["notify_menu_added"],
            "on_update": ["notify_menu_updated", "notify_menu_updated_business"],
            "on_delete": ["notify_menu_removed"],
        },
        "order": "drink_order ASC, id ASC",
        "limit": 50,
    },

    # cafe_baristas registry removed — baristas feature was cut. Existing
    # DB keeps the (now unused) table as dead weight; no DROP migration.

    "stamps": {
        "table": "stamps",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "required": True},
            "cafe_slug": {"type": "str", "required": True},
            "scanned_at": {"type": "str", "ro": True, "auto": "now"},
        },
        # Creation happens via specific endpoint (QR verification + rate limit);
        # list allowed so user profiles can show stamp history
        "auth": {"list": None, "read": None, "create": "blocked", "delete": "blocked"},
        "order": "scanned_at DESC",
        "limit": 500,
    },

    # ── Brew methods (Phase 1 §2.5) ─────────────────────────────────────
    # Roaster-authored recipe cards for a specific product. Nested under
    # `products` — list via /api/products/{product_id}/brew_methods.
    # Create/update/delete require auth; the owner filter is enforced by
    # the "owner": "roaster_slug" + the user having a matching
    # roaster_slug on their account.
    "brew_methods": {
        "table": "brew_methods",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "product_id": {"type": "str", "required": True},
            "roaster_slug": {"type": "str", "required": True, "auto": "user_slug"},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "method": {"type": "str", "required": True},
            "dose_grams": {"type": "float"},
            "yield_grams": {"type": "float"},
            "water_ml": {"type": "float"},
            "ratio": {"type": "str"},
            "brew_time_secs": {"type": "int"},
            "bloom_secs": {"type": "int"},
            "water_temp_celsius": {"type": "int"},
            "grind_size": {"type": "str"},
            "grind_setting": {"type": "str"},
            "notes": {"type": "str"},
            "fields_json": {"type": "json"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        "parent": "products",
        "parent_table": "products",
        "fk": "product_id",
        "auth": {"list": None, "read": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "roaster_slug",
        "owner_user_field": "roaster_slug",
        "subfields": [
            {"name": "author_display_name", "sql": "(SELECT u.display_name FROM users u WHERE u.id = t.user_id)"},
            {"name": "author_username", "sql": "(SELECT u.username FROM users u WHERE u.id = t.user_id)"},
        ],
        "order": "created_at ASC",
        "limit": 50,
    },

    # ── Wholesale inquiries (Phase 1 §2.1) ──────────────────────────────
    # Lightweight café-to-roaster "Interested" handshake. Auth is
    # "required" on all verbs; the specific route enforces the inquiry
    # filter (callers only see their own inquiries or inquiries sent to
    # their own roaster). Notifications fire via the on_create hook so
    # the roaster sees it in their Business tab (§2.4). Café context is
    # pulled in via subfields — the generic join helper only joins on
    # users.id, so we use subqueries the same way products does.
    "wholesale_inquiries": {
        "table": "wholesale_inquiries",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "cafe_slug": {"type": "str", "required": True, "auto": "user_cafe_slug"},
            "roaster_slug": {"type": "str", "required": True},
            "product_id": {"type": "str"},
            "note": {"type": "str"},
            "status": {"type": "str", "default": "open"},
            "cafe_last_read_at": {"type": "str"},
            "roaster_last_read_at": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        # list + read are blocked on the generic endpoint to prevent one café
        # from peeking at another's leads or a roaster from harvesting
        # inquiries sent to others. Use GET /api/my-wholesale-inquiries
        # (see routes/specific.py) which scopes to the current account.
        "auth": {"list": "blocked", "read": "blocked", "create": "required", "update": "owner", "delete": "owner"},
        "owner": "cafe_slug",
        "subfields": [
            {"name": "cafe_name", "sql": "(SELECT cp.name FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_city", "sql": "(SELECT cp.city FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_state", "sql": "(SELECT cp.state FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_logo_url", "sql": "(SELECT cp.logo_url FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_monthly_volume_kg", "sql": "(SELECT cp.monthly_volume_kg FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_open_to_new_roasters", "sql": "(SELECT cp.open_to_new_roasters FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "cafe_procurement_note", "sql": "(SELECT cp.procurement_note FROM cafe_profiles cp WHERE cp.cafe_slug = t.cafe_slug)"},
            {"name": "product_name", "sql": "(SELECT p.coffee_name FROM products p WHERE p.product_id = t.product_id)"},
        ],
        "order": "created_at DESC",
        "limit": 100,
        "hooks": {"on_create": ["notify_wholesale_inquiry"]},
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

    # ── Catalog Ops admin tabs (v0, local-only) ───────────────────────────
    # These three resources are admin-gated (`auth: {"list": "admin", ...}`).
    # The generic CRUD route in `routes/resources.py` enforces the admin
    # predicate (`is_admin=1 AND username='crema'`) on every verb tagged
    # "admin" — same shape as `_require_admin` in `routes/specific.py` so
    # there's exactly one definition of who counts as admin.

    "roaster_sources": {
        "table": "roaster_sources",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "name": {"type": "str", "required": True},
            "website": {"type": "str", "required": True},
            "shop_url": {"type": "str"},
            "platform": {"type": "str"},
            "city": {"type": "str"},
            "state": {"type": "str"},
            "enabled": {"type": "int", "default": 1},
            "added_at": {"type": "str", "ro": True, "auto": "now"},
            "last_scraped_at": {"type": "str"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            # Create goes through POST /api/admin/scrape/sources so we can
            # do a cheap title-fetch before the row lands; PATCH and DELETE
            # use the generic admin-gated update/delete paths.
            "create": "blocked", "update": "admin", "delete": "admin",
        },
        # `roaster_slug` and `products_count` are computed via subquery
        # so the admin tab can show "23 coffees in catalog" alongside
        # each row without a second roundtrip. The link is
        # roaster_sources.website → roaster_profiles.website
        # → roaster_profiles.roaster_slug → products.roaster_slug.
        # When a website doesn't match any roaster_profile (e.g. a
        # trailing-slash difference) the count is 0 — that's a data
        # cleanliness flag we surface honestly.
        "subfields": [
            {"name": "roaster_slug",
             "sql": "(SELECT rp.roaster_slug FROM roaster_profiles rp WHERE rp.website = t.website)"},
            {"name": "products_count",
             "sql": "COALESCE((SELECT COUNT(*) FROM products p "
                    "WHERE p.roaster_slug = "
                    "(SELECT rp.roaster_slug FROM roaster_profiles rp WHERE rp.website = t.website)), 0)"},
        ],
        "order": "name ASC",
        "limit": 500,
    },

    "jobs": {
        "table": "jobs",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "kind": {"type": "str", "ro": True},
            "status": {"type": "str", "ro": True},
            "started_by": {"type": "int", "ro": True},
            "started_at": {"type": "str", "ro": True},
            "finished_at": {"type": "str", "ro": True},
            "error_message": {"type": "str", "ro": True},
            "log_tail": {"type": "str", "ro": True},
            "result_summary": {"type": "json", "ro": True},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            # Jobs are only created by the runners (POST /api/admin/.../run)
            # and never updated / deleted by clients.
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "created_at DESC",
        "limit": 50,
    },

    # ── Catalog Ops audit log: deleted roasters ───────────────────────────
    # Read-only listing for the admin "Recently deleted" section. Rows are
    # written from the DELETE /api/admin/roasters/{slug} endpoint just
    # before the actual hard-delete, so the URL survives for re-enrichment.
    "deleted_roasters": {
        "table": "deleted_roasters",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "roaster_slug": {"type": "str", "ro": True},
            "name": {"type": "str", "ro": True},
            "website": {"type": "str", "ro": True},
            "city": {"type": "str", "ro": True},
            "state": {"type": "str", "ro": True},
            "deleted_at": {"type": "str", "ro": True, "auto": "now"},
            "deleted_by": {"type": "int", "ro": True},
        },
        "auth": {
            "list": "admin", "read": "admin",
            # Writes go through the DELETE-roaster admin endpoint; clients
            # never insert / update / delete log rows directly.
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "deleted_at DESC",
        "limit": 50,
    },

    "sca_addresses": {
        "table": "sca_addresses",
        "pk": "tag",
        "pk_type": "str",
        "fields": {
            "tag": {"type": "str", "required": True},
            "address_t1": {"type": "str"},
            "address_t2": {"type": "str"},
            "address_t3": {"type": "str"},
            "is_null": {"type": "int", "default": 0},
            "source": {"type": "str"},
            "classified_at": {"type": "str", "ro": True, "auto": "now"},
            "model_version": {"type": "str"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            # Inserted by the runner (`run_geolocate_job`); admin override
            # UI is parked under §3.8 so create/update/delete stay blocked.
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "tag ASC",
        "limit": 500,
    },

    "sca_tree_versions": {
        "table": "sca_tree_versions",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "uploaded_at": {"type": "str", "ro": True, "auto": "now"},
            "uploaded_by": {"type": "int", "ro": True},
            "tree_json": {"type": "str", "ro": True},
            "is_active": {"type": "int", "default": 0},
            "notes": {"type": "str"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            # Uploads come through POST /api/admin/geolocate/tree (which
            # validates structure + diff) and activations through
            # /tree/{id}/activate. The generic verbs stay blocked so the
            # validate→activate handshake is the only path.
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "uploaded_at DESC",
        "limit": 50,
    },

    # ── Process canonicalization (Phase 4 prep, Mapping sub-tab) ─────────
    # Mirrors `sca_addresses` + `sca_tree_versions` for processing methods.
    # Distinct `products.process_raw` strings get mapped to a canonical
    # bucket (Washed / Natural / Honey / Anaerobic / Carbonic Maceration /
    # Lactic / Yeast Inoculated / Wet-Hulled / Other-Experimental), with
    # the raw text preserved alongside so admin can re-canonicalize later.
    "process_addresses": {
        "table": "process_addresses",
        "pk": "raw_string",
        "pk_type": "str",
        "fields": {
            "raw_string": {"type": "str", "required": True},
            "canonical": {"type": "str"},
            "is_null": {"type": "int", "default": 0},
            "source": {"type": "str"},
            "classified_at": {"type": "str", "ro": True, "auto": "now"},
            "model_version": {"type": "str"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "raw_string ASC",
        "limit": 500,
    },

    "process_canonical_versions": {
        "table": "process_canonical_versions",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "uploaded_at": {"type": "str", "ro": True, "auto": "now"},
            "uploaded_by": {"type": "int", "ro": True},
            "taxonomy_json": {"type": "str", "ro": True},
            "is_active": {"type": "int", "default": 0},
            "notes": {"type": "str"},
        },
        "auth": {
            "list": "admin", "read": "admin",
            "create": "blocked", "update": "blocked", "delete": "blocked",
        },
        "order": "uploaded_at DESC",
        "limit": 50,
    },
}


def get_resource(name):
    """Get resource definition by name, raise if not found."""
    if name not in RESOURCES:
        raise KeyError(f"Unknown resource: {name}")
    return RESOURCES[name]
