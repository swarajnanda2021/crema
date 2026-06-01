"""
Catalog-side CRUD hooks — identity / avatar sync side-effects.

Called by the CRUD engine hooks system (and a couple of specific.py
routes directly). The social-feed notification fanout — likes, comments,
follows, reposts, sourcing-story and catalog-change notifications, plus
the tasting-note auto-post — was removed for the catalog-only launch.
The full social version is preserved at git tag `social-v1`.
"""

from __future__ import annotations

import datetime


def _now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def run_hook(hook_name, db, *, resource_name=None, item=None, current_user=None, target_id=None, extra=None):
    """Dispatch a named hook. Called by the CRUD engine after create/toggle
    operations, and directly by a few specific.py routes. Only the
    catalog-side identity/avatar sync hooks remain; any other (legacy
    social) hook name is a no-op."""
    if hook_name == "shelf_upsert":
        _handle_shelf_upsert(db, item, current_user)
    elif hook_name == "sync_roaster_logo_to_user":
        _handle_sync_roaster_logo(db, item, current_user)
    elif hook_name == "sync_roaster_name_to_user":
        _handle_sync_roaster_name_to_user(db, item, current_user)
    elif hook_name == "sync_user_avatar_from_roaster":
        _handle_sync_user_avatar_from_roaster(db, item, current_user)


def _handle_shelf_upsert(db, item, user):
    """Shelf-entry create hook. Currently inert — the bean's catalog page
    is the source of truth and there's no fanout. Kept as the wiring
    point for a future 'recently saved' surface."""
    if not item:
        return
    product_id = item.get("product_id")
    if not product_id:
        return
    # No-op: a shelf upsert isn't a public catalog event.


def sync_roaster_name_to_user(db, slug: str, name: str) -> None:
    """Mirror a roaster_profile name change onto the owner user's
    display_name so the navbar greeting stays accurate.

    Public helper — called both from the registry hook dispatcher (via
    `_handle_sync_roaster_name_to_user`) and directly from the bio
    re-enrich endpoint, which writes SQL outside the registry path.
    """
    if not name or not slug:
        return
    db.execute(
        "UPDATE users SET display_name = ? WHERE account_type = 'roaster' AND roaster_slug = ?",
        (name, slug),
    )
    db.commit()


def _handle_sync_roaster_name_to_user(db, item, actor):
    """Registry-hook variant — unpacks item dict, then delegates."""
    if not item:
        return
    sync_roaster_name_to_user(db, item.get("roaster_slug"), item.get("name"))


def _handle_sync_roaster_logo(db, item, actor):
    """When a roaster_profile logo_url changes, mirror it onto the owner's
    user.avatar_url so the navbar avatar updates automatically."""
    if not item:
        return
    logo = item.get("logo_url")
    slug = item.get("roaster_slug")
    if not slug:
        return
    db.execute(
        "UPDATE users SET avatar_url = ? WHERE account_type = 'roaster' AND roaster_slug = ?",
        (logo, slug),
    )
    db.commit()


def _handle_sync_user_avatar_from_roaster(db, item, actor):
    """Inverse of `sync_roaster_logo_to_user` — fires when a user's row
    is updated. If the user has just become (or already is) a roaster
    account linked to a slug, AND the user's avatar_url is empty,
    backfill it from the matching `roaster_profiles.logo_url`.

    Closes the gap where a user signs up AFTER catalog ops has already
    enriched their roaster: the on_update hook on `roaster_profiles`
    fired before the user existed, so the sync never mirrored to them.
    """
    if not item:
        return
    if (item.get("account_type") or "") != "roaster":
        return
    if item.get("avatar_url"):
        return  # user already has an avatar — don't overwrite
    slug = item.get("roaster_slug")
    if not slug:
        return
    row = db.execute(
        "SELECT logo_url FROM roaster_profiles WHERE roaster_slug = ?",
        (slug,),
    ).fetchone()
    if not row or not row["logo_url"]:
        return
    db.execute(
        "UPDATE users SET avatar_url = ? WHERE id = ?",
        (row["logo_url"], item.get("id")),
    )
    db.commit()
