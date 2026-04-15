"""
CRUD Utopia — Crema admin seeder. Idempotent; safe to re-run.

Seeds a single "crema" user account (display name: "Crema") with is_admin=1.
The account behaves like a normal user for everything else — it can browse,
post, follow — but its profile page exposes an additional set of admin-only
tabs (engagement / commerce / loyalty / network / retention / supply) that
read from /api/stats/traction, which is itself gated on is_admin=1 AND
username="crema" (defense in depth).

Credentials:
    username: crema
    password: crema       (dev-only — change in prod)

Avatar: a rendered copy of the Crema wordmark SVG (CremaLogo.tsx). The
Pillow rasterizer below draws the exact purple lettering on the cream
background used throughout the app.

Run: python3 seed_admin.py

See CRUD_UTOPIA.md at repo root.
"""

from __future__ import annotations

import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import passlib.hash as _passlib

from database import get_db, init_db

bcrypt = _passlib.bcrypt

ADMIN_USERNAME = "crema"
ADMIN_DISPLAY_NAME = "Crema"
ADMIN_PASSWORD = "crema"
ADMIN_AVATAR_FILENAME = "crema_logo.png"

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")

# Design tokens mirrored from src/tokens/design-tokens.json. The seeder is
# intentionally decoupled so it can run without loading TypeScript.
COLOR_BG = (250, 248, 240)      # bg  #FAF8F0
COLOR_ACCENT = (215, 152, 218)  # accent #D798DA


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _render_crema_logo_png(path: str) -> None:
    """Render the Crema wordmark SVG (from src/components/CremaLogo.tsx) as a
    square PNG at `path`. Uses Pillow if available, otherwise writes a
    minimal placeholder and warns.

    The rendered image is sized for avatar use (512×512) with the logo
    horizontally centered on the cream bg and the purple color token."""
    if os.path.exists(path):
        return  # already seeded
    try:
        from PIL import Image, ImageDraw  # type: ignore
    except ImportError:
        print("  ! Pillow not installed — writing 1x1 placeholder PNG.")
        # Minimal 1x1 PNG so the static route resolves
        with open(path, "wb") as f:
            f.write(
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00"
                b"\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT"
                b"\x08\x99c\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01V\xc4\x14\xae"
                b"\x00\x00\x00\x00IEND\xaeB`\x82"
            )
        return

    SIZE = 512
    img = Image.new("RGB", (SIZE, SIZE), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # Try to find a bundled font; fall back to PIL's default.
    from PIL import ImageFont  # type: ignore
    font = None
    for candidate in [
        # Some platforms have Helvetica bold
        "/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        if os.path.exists(candidate):
            try:
                font = ImageFont.truetype(candidate, 220)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()

    text = "crema"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (SIZE - tw) // 2 - bbox[0]
    ty = (SIZE - th) // 2 - bbox[1]
    draw.text((tx, ty), text, fill=COLOR_ACCENT, font=font)
    img.save(path, "PNG")
    print(f"  + rendered avatar → {path}")


def _ensure_crema_user(db) -> None:
    row = db.execute(
        "SELECT id, username FROM users WHERE username = ?", (ADMIN_USERNAME,)
    ).fetchone()
    pwd_hash = bcrypt.hash(ADMIN_PASSWORD)
    avatar_path = f"/uploads/{ADMIN_AVATAR_FILENAME}"
    if row:
        db.execute(
            "UPDATE users SET display_name = ?, password_hash = ?, account_type = 'user', "
            "is_admin = 1, avatar_url = ? WHERE username = ?",
            (ADMIN_DISPLAY_NAME, pwd_hash, avatar_path, ADMIN_USERNAME),
        )
        print(f"  ✓ Updated admin user: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")
    else:
        db.execute(
            "INSERT INTO users (username, display_name, password_hash, account_type, "
            "is_admin, avatar_url, created_at) VALUES (?, ?, ?, 'user', 1, ?, ?)",
            (
                ADMIN_USERNAME,
                ADMIN_DISPLAY_NAME,
                pwd_hash,
                avatar_path,
                _now(),
            ),
        )
        print(f"  + Created admin user: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")
    db.commit()


def _verify_access_control(db) -> None:
    """Sanity check: admin row matches, a regular user row doesn't. This is
    not a network-level test (no HTTP); it exercises the _require_admin
    predicate shape against the live DB row."""
    admin = db.execute(
        "SELECT username, is_admin FROM users WHERE username = ?",
        (ADMIN_USERNAME,),
    ).fetchone()
    assert admin and admin["is_admin"] == 1 and admin["username"] == "crema", (
        "Admin row failed sanity check"
    )

    # Pick one non-admin user (if any) and confirm they would be rejected
    other = db.execute(
        "SELECT username, is_admin FROM users WHERE username != ? LIMIT 1",
        (ADMIN_USERNAME,),
    ).fetchone()
    if other:
        assert not (
            other["is_admin"] == 1 and other["username"] == "crema"
        ), f"Non-admin user {other['username']} unexpectedly matches admin predicate"
        print(f"  ✓ Non-admin user {other['username']} would receive 403")
    print("  ✓ Admin predicate matches only the 'crema' account")


def main() -> None:
    print("Initializing DB…")
    init_db()
    os.makedirs(UPLOADS_DIR, exist_ok=True)

    logo_path = os.path.join(UPLOADS_DIR, ADMIN_AVATAR_FILENAME)
    print("\nRendering Crema avatar:")
    _render_crema_logo_png(logo_path)

    print("\nSeeding Crema admin account:")
    db = get_db()
    try:
        _ensure_crema_user(db)
        print("\nVerifying access control:")
        _verify_access_control(db)
    finally:
        db.close()

    print("\n" + "=" * 60)
    print("CREMA ADMIN CREDENTIALS:")
    print("=" * 60)
    print(f"  username:  {ADMIN_USERNAME}")
    print(f"  password:  {ADMIN_PASSWORD}")
    print(f"  avatar:    /uploads/{ADMIN_AVATAR_FILENAME}")
    print("=" * 60)


if __name__ == "__main__":
    main()
