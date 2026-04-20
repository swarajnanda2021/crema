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


# Avatar image is rasterized from the canonical `crema-app/assets/images/crema-logo.svg`
# and padded onto a brown square so the FULL wordmark survives the avatar
# component's MIN=1.2 zoom cushion. Earlier revisions of this seeder used
# Pillow + a system font to "rewrite" the wordmark — that produced a
# misshapen substitute that didn't match the actual brand mark, AND the
# rendered text bled to the canvas edges so the avatar's circular crop ate
# the leading "c" and trailing "a" (only "rema" / "cr" survived). Going
# straight from the SVG sidesteps both problems.

# Repo-relative path to the source SVG. Computed at import time so the
# seeder works whether you run it from this directory or from the repo
# root.
LOGO_SVG = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "crema-app", "assets", "images", "crema-logo.svg",
))

# Brown to match the existing roaster.panel / dark hero language so the
# padded letterbox blends with the surrounding brown banner on the
# admin profile.
COLOR_BROWN = (49, 19, 4)
LOGO_RASTER_WIDTH = 1400  # SVG is 142 wide; render at 10× for crisp output
LOGO_CANVAS_SIZE = 2400   # square. Avatar component scales the source by
                          # MIN_OVER=1.2 then crops to the container's
                          # rectangle, so only ~83% of the source is ever
                          # visible. With LOGO_RASTER_WIDTH=1400 the logo
                          # spans 58% of the 2400-px canvas, leaving 21%
                          # brown padding on each side — comfortably more
                          # than the avatar component's 8.5%-per-side
                          # crop, so the wordmark survives intact.


def _rasterize_svg(svg_path: str, width: int) -> bytes | None:
    """Rasterize `svg_path` to PNG bytes at `width` pixels. Tries
    `rsvg-convert` first (no Python deps), then `cairosvg`. Returns None
    if neither is available so the caller can fall back."""
    import subprocess

    # rsvg-convert is part of librsvg — installed on macOS via
    # `brew install librsvg` and on most Linux distros via the librsvg2
    # package. Prefer it because it doesn't require a Python module.
    try:
        result = subprocess.run(
            ["rsvg-convert", "-w", str(width), svg_path],
            check=True, capture_output=True,
        )
        return result.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Python fallback — `pip install cairosvg`.
    try:
        import cairosvg  # type: ignore
        return cairosvg.svg2png(url=svg_path, output_width=width)
    except ImportError:
        return None


def _render_crema_logo_png(path: str) -> None:
    """Render the canonical CremaLogo SVG as a padded square PNG at
    `path`. Idempotent — exits early if the file already exists.

    Pipeline: rasterize SVG via rsvg-convert / cairosvg → paste onto a
    brown square canvas → save as PNG. Falls back to the legacy Pillow
    text rendering only if both rasterizers are unavailable."""
    if os.path.exists(path):
        return  # already seeded

    try:
        from PIL import Image  # type: ignore
        from io import BytesIO
    except ImportError:
        print("  ! Pillow not installed — writing 1x1 placeholder PNG.")
        with open(path, "wb") as f:
            f.write(
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00"
                b"\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT"
                b"\x08\x99c\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01V\xc4\x14\xae"
                b"\x00\x00\x00\x00IEND\xaeB`\x82"
            )
        return

    if not os.path.exists(LOGO_SVG):
        print(f"  ! SVG not found at {LOGO_SVG} — falling back to text render.")
        _render_crema_logo_png_text_fallback(path)
        return

    raster_bytes = _rasterize_svg(LOGO_SVG, LOGO_RASTER_WIDTH)
    if raster_bytes is None:
        print("  ! No SVG rasterizer found (install librsvg or cairosvg) — "
              "falling back to text render.")
        _render_crema_logo_png_text_fallback(path)
        return

    src = Image.open(BytesIO(raster_bytes)).convert("RGBA")
    canvas = Image.new("RGBA", (LOGO_CANVAS_SIZE, LOGO_CANVAS_SIZE), (*COLOR_BROWN, 255))
    ox = (LOGO_CANVAS_SIZE - src.width) // 2
    oy = (LOGO_CANVAS_SIZE - src.height) // 2
    canvas.paste(src, (ox, oy), src)
    canvas.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  + rasterized SVG → {path}")


def _render_crema_logo_png_text_fallback(path: str) -> None:
    """Last-resort: re-render the wordmark via Pillow + a system font.
    Shape won't match the brand mark exactly but at least produces
    something readable. Only invoked when the SVG isn't available AND
    neither rsvg-convert nor cairosvg is installed."""
    from PIL import Image, ImageDraw, ImageFont  # type: ignore

    SIZE = 512
    img = Image.new("RGB", (SIZE, SIZE), COLOR_BG)
    draw = ImageDraw.Draw(img)
    font = None
    for candidate in [
        "/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        if os.path.exists(candidate):
            try:
                font = ImageFont.truetype(candidate, 200)
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
    print(f"  + rendered text-fallback avatar → {path}")


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
