"""
Seed script: create roaster accounts for all roasters in crema-app/src/data/roasters.json.

Username = roaster name lowercased, spaces and special chars removed.
Password = same as username.
account_type = "roaster", roaster_slug = slug from JSON.

Also resets passwords of ALL existing users to match convention: password = username.

Idempotent — safe to run multiple times.
"""

import json
import os
import re
import sqlite3
import bcrypt

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "coffee_community.db")
ROASTERS_JSON = os.path.join(
    os.path.dirname(__file__), "..", "..", "crema-app", "src", "data", "roasters.json"
)


def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def slugify_username(name: str) -> str:
    """Convert roaster name to username: lowercase, remove non-alphanumeric."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    # Load roasters
    with open(ROASTERS_JSON, encoding="utf-8") as f:
        roasters = json.load(f)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    created = 0
    skipped = 0
    updated = 0

    ts = now_iso()

    for r in roasters:
        slug = r["roaster_slug"]
        name = r.get("name") or r.get("roaster_name") or slug.replace("-", " ").title()
        username = slugify_username(name)
        city = r.get("city") or ""
        state = r.get("state") or ""
        location = f"{city}, {state}".strip(", ") if city or state else None

        if not username or len(username) < 3:
            print(f"  SKIP  {name!r} → username {username!r} too short")
            skipped += 1
            continue

        # Check if user already exists
        existing = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()

        if existing:
            # Update password and ensure roaster fields are set
            pw_hash = hash_pw(username)
            conn.execute(
                "UPDATE users SET password_hash = ?, account_type = 'roaster', roaster_slug = ? WHERE id = ?",
                (pw_hash, slug, existing["id"]),
            )
            print(f"  UPDATE  {username} (id={existing['id']}) → pw reset, roaster_slug={slug}")
            updated += 1
        else:
            pw_hash = hash_pw(username)
            conn.execute(
                """INSERT INTO users (username, display_name, password_hash, created_at,
                   account_type, roaster_slug, location)
                   VALUES (?, ?, ?, ?, 'roaster', ?, ?)""",
                (username, name, pw_hash, ts, slug, location),
            )
            print(f"  CREATE  {username} → {name} (slug={slug})")
            created += 1

    # Reset passwords for existing non-roaster test users too
    test_users = conn.execute(
        "SELECT id, username FROM users WHERE account_type != 'roaster' OR account_type IS NULL"
    ).fetchall()
    for u in test_users:
        pw_hash = hash_pw(u["username"])
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, u["id"]))
        print(f"  RESET PW  {u['username']} (id={u['id']})")
        updated += 1

    conn.commit()
    conn.close()

    print(f"\nDone: {created} created, {updated} updated, {skipped} skipped.")


if __name__ == "__main__":
    main()
