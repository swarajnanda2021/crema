"""
File upload routes — avatar and general image uploads.

§2.12 — converts raster uploads to WebP at write time. Pillow handles
JPEG / PNG / HEIC / GIF → WebP; anything it can't open (SVG, unknown
binary) is stored verbatim so we never *lose* an upload. WebP cuts
payloads by ~30% at visually identical quality for photos, which
matters most for hero / cover / post images where the asset is the
content itself.

Existing images under `/uploads/` are NOT migrated — that's option
(c) from the roadmap entry. New uploads only. If the corpus gets big
enough to care about, a one-shot backfill script re-encodes on disk
and patches DB references.
"""

import io
import os
import re
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Query
from PIL import Image, UnidentifiedImageError

from services.auth import get_current_user
from resources.envelope import ok

router = APIRouter(prefix="/api/upload", tags=["Uploads"])

_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
os.makedirs(_UPLOADS_DIR, exist_ok=True)

# Quality tuned to Pillow's default sweet spot. 82 gives files that
# are visibly indistinguishable from the source for product and
# profile photography while still taking ~30% off the bytes.
_WEBP_QUALITY = 82


def _safe_stem(original: str) -> str:
    """Sanitised filename stem with a unique suffix. Extension is
    always replaced with `.webp` by the caller, so whatever the
    source extension is doesn't matter here."""
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", (original or "upload").rsplit("/", 1)[-1])
    uid = uuid.uuid4().hex[:8]
    base, _ext = os.path.splitext(name)
    return f"{base}_{uid}"


def _save_converted(raw: bytes, stem: str) -> str:
    """Convert `raw` bytes to WebP and write to disk. Falls back to
    saving the original bytes verbatim if Pillow can't decode — keeps
    SVGs and other unsupported formats working without a special case.

    Returns the path stem (filename) the caller should expose as a
    URL under /uploads/.
    """
    try:
        img = Image.open(io.BytesIO(raw))
        # Flatten animated sources (GIF) to a single frame — we don't
        # use animated images on the site and WebP's anim support is
        # spotty across older clients.
        if getattr(img, "is_animated", False):
            img.seek(0)
        # Convert palette / 16-bit / CMYK to RGB(A) so .save("webp")
        # doesn't choke. Preserve alpha where it exists.
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        fname = f"{stem}.webp"
        out_path = os.path.join(_UPLOADS_DIR, fname)
        img.save(out_path, format="WEBP", quality=_WEBP_QUALITY, method=4)
        return fname
    except (UnidentifiedImageError, OSError):
        # Pillow couldn't open it (probably SVG or some other vector /
        # non-raster format). Save the bytes as-is with the original
        # extension so the upload still succeeds.
        fallback = f"{stem}.bin"
        out_path = os.path.join(_UPLOADS_DIR, fallback)
        with open(out_path, "wb") as f:
            f.write(raw)
        return fallback


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user=Depends(get_current_user)):
    stem = _safe_stem(file.filename or "avatar")
    content = await file.read()
    fname = _save_converted(content, stem)
    url = f"/uploads/{fname}"
    return ok({"avatar_url": url}, resource="uploads")


@router.post("/image")
async def upload_image(file: UploadFile = File(...), purpose: str = Query("post"),
                       user=Depends(get_current_user)):
    stem = _safe_stem(file.filename or "image")
    content = await file.read()
    fname = _save_converted(content, stem)
    url = f"/uploads/{fname}"
    return ok({"url": url, "purpose": purpose}, resource="uploads")
