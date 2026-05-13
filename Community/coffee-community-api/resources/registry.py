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
        # `sync_user_avatar_from_roaster` runs on every user update.
        # The handler is a no-op except when the user is a roaster
        # account with empty avatar_url and a roaster_slug — then it
        # backfills the avatar from `roaster_profiles.logo_url`.
        # Closes the gap where a user signs up AFTER catalog ops has
        # already enriched their roaster (the on_update hook on
        # `roaster_profiles` fired before the user existed, so the
        # sync never mirrored). See
        # `services/notifications.py::_handle_sync_user_avatar_from_roaster`.
        "hooks": {"on_update": ["sync_user_avatar_from_roaster"]},
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
            "images_json": {"type": "json"},
            "repost_of_id": {"type": "int"},
            # Article reposts ride on the same `roaster_posts` row pattern
            # as post reposts — a "repost" row carrying `repost_of_article_id`
            # rather than `repost_of_id`. The `original_article` cross-
            # resource embed below resolves the article on the way out.
            "repost_of_article_id": {"type": "int"},
            "repost_comment": {"type": "str"},
            "tasting_note_id": {"type": "int"},
            # Tagged coffee — the composer's "Tag a coffee" sub-flow
            # writes the picked coffee's `product_id` here. Renders
            # as the in-feed coffee chip below the body image
            # (Figma 825:2657) and drives the "Posted about a coffee"
            # subtitle copy.
            "product_id": {"type": "str"},
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
            # Cross-resource embed — `repost_of_article_id` points into
            # the `articles` resource (table `roaster_articles`). Carries
            # the same shape an article would when fetched directly, so
            # the feed renderer can surface a reposted article via
            # `<ArticlePreviewCard>` without an extra round-trip.
            {"name": "original_article", "fk": "repost_of_article_id", "resource": "articles"},
        ],
        "order": "published_at DESC",
        "limit": 20,
        # notify_repost handles repost authors; notify_sourcing_story is a
        # no-op for any post_type other than 'sourcing_story' so it can sit
        # alongside without an extra branch in the registry. Article reposts
        # (where `repost_of_article_id` is set instead of `repost_of_id`)
        # currently no-op — `notify_repost` exits early because there's no
        # post-author to notify. Adding a notif type for the article's roaster
        # is a follow-up; for v1 the roaster discovers reposts via the feed.
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

    # ── Articles ─────────────────────────────────────────────────────────
    # The article catalog itself (`roaster_articles`). Specific.py already
    # owns the listing endpoint (publish-gate JOINs to `roaster_profiles`
    # are per-route logic), so the auto-routes here are intentionally
    # restricted: list/read are blocked on the generic /api/articles
    # endpoint, and create/update/delete are admin-only via the existing
    # specific.py admin endpoints. The registration is here so the
    # generic engine can wire up:
    #   • the cross-resource `original_article` embed on posts (article
    #     reposts in the feed)
    #   • the nested /api/articles/{id}/article_comments routes
    #   • the auto /api/article_likes/{id}/toggle route
    # Specific.py's `/articles` endpoint will continue to call
    # build_select(get_resource("articles"), uid) so the chronological
    # feed payload picks up the like/comment/repost counts and the
    # liked_by_me flag for free.
    "articles": {
        "table": "roaster_articles",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "roaster_slug": {"type": "str"},
            "url": {"type": "str"},
            "title": {"type": "str"},
            "excerpt": {"type": "str"},
            "image_url": {"type": "str"},
            "body_html": {"type": "str"},
            "word_count": {"type": "int"},
            "published_at": {"type": "str"},
            "scraped_at": {"type": "str"},
            "published": {"type": "int", "default": 1},
            "is_about_coffee": {"type": "int", "default": 1},
            "topic_category": {"type": "str"},
            "tags": {"type": "str"},
            "enrichment_status": {"type": "str"},
        },
        "auth": {"list": "blocked", "read": "blocked",
                 "create": "blocked", "update": "blocked", "delete": "blocked"},
        # Mirror the existing _ARTICLE_CARD_COLS in specific.py — roaster
        # name + logo come from `roaster_profiles` on the roaster_slug
        # foreign key. Subqueries (rather than a JOIN) so the resource's
        # generic build_select path doesn't depend on a JOIN clause that
        # the engine's _build_select doesn't know about.
        "subfields": [
            {"name": "roaster_name",
             "sql": "(SELECT rp.name FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
            {"name": "roaster_logo_url",
             "sql": "(SELECT rp.logo_url FROM roaster_profiles rp WHERE rp.roaster_slug = t.roaster_slug)"},
        ],
        "counts": [
            {"name": "like_count", "table": "article_likes", "fk": "article_id"},
            {"name": "comment_count", "table": "article_comments", "fk": "article_id"},
            # Counts every roaster_post repost row that points at this
            # article via `repost_of_article_id`. Mirrors the posts
            # registry's `repost_count` shape.
            {"name": "repost_count", "table": "roaster_posts", "fk": "repost_of_article_id"},
        ],
        "flags": [
            {"name": "liked_by_me", "table": "article_likes", "fk": "article_id", "user_col": "user_id"},
            {"name": "hidden_by_me", "table": "article_hides", "fk": "article_id", "user_col": "user_id"},
            {"name": "disliked_by_me", "table": "article_dislikes", "fk": "article_id", "user_col": "user_id"},
        ],
        "order": "id DESC",
        "limit": 50,
    },

    # ── Article Likes (toggle) ───────────────────────────────────────────
    "article_likes": {
        "table": "article_likes",
        "type": "toggle",
        "parent": "articles",
        "parent_table": "roaster_articles",
        "fk": "article_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Article Hides (toggle — recommender negative signal) ─────────────
    "article_hides": {
        "table": "article_hides",
        "type": "toggle",
        "parent": "articles",
        "parent_table": "roaster_articles",
        "fk": "article_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Article Dislikes (toggle) ────────────────────────────────────────
    "article_dislikes": {
        "table": "article_dislikes",
        "type": "toggle",
        "parent": "articles",
        "parent_table": "roaster_articles",
        "fk": "article_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
    },

    # ── Article Reports (create-only) ────────────────────────────────────
    "article_reports": {
        "table": "article_reports",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "article_id": {"type": "int", "required": True},
            "reason": {"type": "str"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
        },
        "auth": {"list": "admin", "read": "admin", "create": "required",
                 "update": None, "delete": "admin"},
        "owner": "user_id",
    },

    # ── Article Comments ─────────────────────────────────────────────────
    # Same shape as post_comments. Comment-likes route through the
    # parallel `article_comment_likes` toggle resource (see below) — we
    # didn't generalise the existing `comment_likes` table because that
    # would mean a schema migration on the 200+ existing rows. The
    # frontend's `<CommentThread>` already takes a `likeResource` prop
    # so swapping per parent type is one-line.
    "article_comments": {
        "table": "article_comments",
        "pk": "id",
        "fields": {
            "id": {"type": "int", "ro": True},
            "user_id": {"type": "int", "ro": True, "auto": "current_user"},
            "article_id": {"type": "int", "required": True},
            "comment": {"type": "str", "required": True},
            "parent_id": {"type": "int"},
            "created_at": {"type": "str", "ro": True, "auto": "now"},
            "updated_at": {"type": "str"},
        },
        "parent": "articles",
        "parent_table": "roaster_articles",
        "fk": "article_id",
        "auth": {"list": None, "create": "required", "update": "owner", "delete": "owner"},
        "owner": "user_id",
        "joins": [
            {"table": "users", "alias": "user", "on": "user_id",
             "fields": ["id", "username", "display_name", "avatar_url"]},
        ],
        "counts": [
            {"name": "like_count", "table": "article_comment_likes", "fk": "comment_id"},
        ],
        "flags": [
            {"name": "liked_by_me", "table": "article_comment_likes", "fk": "comment_id", "user_col": "user_id"},
        ],
        "order": "created_at ASC",
    },

    # ── Article Comment Likes (toggle) ───────────────────────────────────
    "article_comment_likes": {
        "table": "article_comment_likes",
        "type": "toggle",
        "parent": "article_comments",
        "parent_table": "article_comments",
        "fk": "comment_id",
        "user_col": "user_id",
        "auth": {"toggle": "required"},
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
            # Discover filter axes — light-touch canonicalization of
            # the free-text origin / varietal columns so the BEANS
            # filter drawer can offer chip-based Region + Varietal
            # filters. Populated by `services/canonicalize.py` at
            # scrape-time + via the user_version=4 backfill. Heavier
            # curation lands later via the Coffee Standardization
            # sub-tab — same column, admin overrides win.
            "origin_region": {"type": "str"},
            "varietal_canonical": {"type": "str"},
            # Standardization writes the canonical process bucket here
            # (Washed/Natural/Honey/Anaerobic/Wet-Hulled/Monsooned/
            # Experimental/Decaf). The Discover BEANS process filter
            # chip set groups by this so 60+ raw process strings
            # collapse to the 8 buckets. The display column
            # (`products.process`) holds Haiku's cleaned method name
            # for the CoffeeCard.
            "process_canonical": {"type": "str"},
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
            # Timestamp of the most recent hint write — see database.py
            # migration. The admin page surfaces this as "Updated 2d
            # ago" inside the hint card so freshness is visible without
            # diving into a job log.
            "enrichment_prompt_hint_updated_at": {"type": "str"},
            # Article-extraction site-quirk hint (Layer B follow-up to
            # the bean enricher hint above). Mirrors the precedent
            # exactly: same type, same auth treatment, same admin
            # surface (the Journals expand row's hint card). The
            # `_force_regenerate` flag is a perpetual server-side
            # toggle — while 1, every article_scrape pass regenerates
            # the hint via a Sonnet meta-call. Never auto-clears;
            # admin flips back to 0 from the Journals expand row when
            # satisfied.
            "article_enrichment_prompt_hint": {"type": "str"},
            "article_enrichment_prompt_hint_updated_at": {"type": "str"},
            "article_hint_force_regenerate": {"type": "int", "default": 0},
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
            # Live article-count + most-recent-scrape time keyed by
            # `roaster_slug` (NOT by website) — the panel display reads
            # these as the source of truth, so the row never disagrees
            # with the underlying `roaster_articles` table. The
            # denormalized `roaster_sources.articles_count` cache used
            # to drive the row, but it's stamped only at the end of
            # `run_article_scrape_job`'s per-source loop — articles
            # written by other paths (sample scripts, partial runs that
            # errored before the stamp) leave the cache at 0 even
            # though the article rows exist. Subfields below bypass
            # that cache mismatch entirely.
            {"name": "articles_count_live",
             "sql": "(SELECT COUNT(*) FROM roaster_articles ra "
                    "WHERE ra.roaster_slug = t.roaster_slug)"},
            {"name": "last_article_scraped_at",
             "sql": "(SELECT MAX(ra.scraped_at) FROM roaster_articles ra "
                    "WHERE ra.roaster_slug = t.roaster_slug)"},
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
