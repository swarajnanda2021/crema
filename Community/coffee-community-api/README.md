# Crema Community API

FastAPI backend for the Crema coffee community platform. Uses a **CRUD Utopia** architecture: a declarative resource registry generates endpoints, a generic SQL engine handles queries, and a standard response envelope wraps every response.

## Quick Start

```bash
pip install fastapi uvicorn passlib bcrypt python-multipart sse-starlette requests beautifulsoup4 lxml
uvicorn main:app --host 0.0.0.0 --port 8000
```

Swagger docs at http://localhost:8000/docs.

## Architecture

```
main.py (57 lines)
  ├── routes/auth.py           Login, register, profile
  ├── routes/resources.py      Auto-generated CRUD endpoints (from registry)
  ├── routes/specific.py       Fixed routes (feed, follow, catalog, profiles)
  ├── routes/uploads.py        Avatar + image uploads
  └── routes/dictionary_routes.py

resources/
  ├── registry.py    20 resource declarations (fields, auth, joins, counts, flags, hooks)
  ├── crud.py        Generic SQL engine (list, get, create, update, delete, toggle)
  └── envelope.py    { data, meta } response wrapper

services/
  ├── auth.py            Token verification, session management
  ├── notifications.py   Hook-driven notification dispatch
  └── catalog_sync.py    Import scraped products into the database
```

## The Registry Pattern

Every CRUD resource is declared once in `registry.py`. The engine generates SQL from declarations — no per-feature endpoint files.

```python
"post_comments": {
    "table": "post_comments",
    "fields": {
        "comment": {"type": "str", "required": True},
        "user_id": {"type": "int", "ro": True, "auto": "current_user"},
        "post_id": {"type": "int", "required": True},
        ...
    },
    "auth": {"list": None, "create": "required", "update": "owner", "delete": "owner"},
    "owner": "user_id",
    "joins": [
        {"table": "users", "alias": "user", "on": "user_id",
         "fields": ["username", "display_name", "avatar_url"]}
    ],
    "counts": [
        {"name": "like_count", "table": "comment_likes", "fk": "comment_id"}
    ],
    "flags": [
        {"name": "liked_by_me", "table": "comment_likes", "fk": "comment_id", "user_col": "user_id"}
    ],
    "hooks": {"on_create": ["notify_comment"]},
}
```

This single declaration gives you:
- **List/Get/Create/Update/Delete** endpoints with auth checks
- **Author join** — every comment includes the user's username, display_name, avatar_url as a nested `user` object
- **Like count** — inline subquery, no extra API call
- **liked_by_me flag** — per-viewer boolean, computed from the current user's auth token
- **Notification hook** — fires on comment creation

Adding a new resource: ~20 lines of registry, zero new router files.

## Response Envelope

Every endpoint returns the same shape:

```json
{
  "data": [ ... ],
  "meta": {
    "resource": "post_comments",
    "total": 42,
    "limit": 20,
    "offset": 0
  }
}
```

Toggle endpoints return:
```json
{ "data": { "toggled": true, "count": 15 }, "meta": { "resource": "post_likes" } }
```

## Resources (20 total)

### CRUD Resources
| Name | Table | Key Features |
|---|---|---|
| `posts` | `roaster_posts` | Author join, like/comment/repost counts, `liked_by_me`, `original_post` embed |
| `post_comments` | `post_comments` | User join, like count, `liked_by_me`, notification hook |
| `shelves` | `shelf_entries` | Grouped by shelf category, owner-only delete |
| `tasting_notes` | `tasting_notes` | Author join, like count, `liked_by_me` |
| `note_comments` | `note_comments` | User join, notification hook |
| `notifications` | `notifications` | Actor join, read status |
| `products` | `products` | Unified catalog (scraped + roaster-created) |
| `roaster_profiles` | `roaster_profiles` | |

### Toggle Resources (like/follow)
| Name | Table | Hook |
|---|---|---|
| `post_likes` | `post_likes` | `notify_like` |
| `comment_likes` | `comment_likes` | `notify_comment_like` |
| `note_likes` | `note_likes` | |
| `follows` | `follows` (by slug) | `notify_follow` |

### Write-Only
| Name | Table | Purpose |
|---|---|---|
| `click_events` | `click_events` | Outbound click tracking |

## Fixed Routes (specific.py)

Routes that need custom logic beyond generic CRUD:

| Category | Endpoints |
|---|---|
| **Feed** | `GET /feed-timeline`, `GET /posts-timeline` |
| **User activity** | `GET /users/{username}/posts\|likes\|comments` |
| **Roaster posts** | `GET /roasters/{slug}/posts`, `GET /roasters/{slug}/posts/featured` |
| **Follow** | `POST /roasters/{slug}/follow`, `GET /follow-status/{slug}`, `GET /my-following` |
| **Notifications** | `GET /notification-count`, `POST /notifications-mark-read` |
| **Products** | `GET /products/popularity`, `GET /products/{id}/users`, `POST /roasters/{slug}/products` |
| **Roasters** | `GET /roasters` (merged profiles + products) |

## Database

SQLite (`coffee_community.db`). Schema auto-created on startup via `database.py`.

Key tables: `users`, `sessions`, `roaster_posts`, `post_likes`, `post_comments`, `comment_likes`, `shelf_entries`, `tasting_notes`, `note_likes`, `note_comments`, `follows`, `notifications`, `products`, `roaster_profiles`, `click_events`.

## CRUD Engine Internals

`crud.py` exports these functions:

| Function | Purpose |
|---|---|
| `list_resource(db, name, ...)` | List with joins, counts, flags, embeds, pagination |
| `get_resource_by_id(db, name, id)` | Single resource with full processing |
| `create_resource(db, name, body, user)` | Create with auto-fields and hooks |
| `update_resource(db, name, id, body, user)` | Update with ownership check |
| `delete_resource(db, name, id, user)` | Delete with ownership check |
| `toggle_resource(db, name, target_id, user)` | Toggle on/off with count |
| `build_select(res, uid)` | Generate SELECT SQL from registry (public helper) |
| `row_to_dict(row, res)` | Process a row: nest joins, parse JSON, convert flags (public helper) |
| `resolve_embeds(db, items, res, uid)` | Resolve self-referencing embeds like `original_post` (public helper) |

The public helpers (`build_select`, `row_to_dict`, `resolve_embeds`) are available for custom endpoints in `specific.py` that need registry-aware SQL with non-standard JOINs.
