"""
File upload routes — avatar and general image uploads.
"""

import os
import uuid
import re
from fastapi import APIRouter, Depends, UploadFile, File, Query
from services.auth import get_current_user
from resources.envelope import ok

router = APIRouter(prefix="/api/upload", tags=["Uploads"])

_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
os.makedirs(_UPLOADS_DIR, exist_ok=True)


def _safe_filename(original: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", original.rsplit("/", 1)[-1])
    uid = uuid.uuid4().hex[:8]
    base, ext = os.path.splitext(name)
    return f"{base}_{uid}{ext}"


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user=Depends(get_current_user)):
    fname = _safe_filename(file.filename or "avatar.jpg")
    path = os.path.join(_UPLOADS_DIR, fname)
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    url = f"/uploads/{fname}"
    return ok({"avatar_url": url}, resource="uploads")


@router.post("/image")
async def upload_image(file: UploadFile = File(...), purpose: str = Query("post"),
                       user=Depends(get_current_user)):
    fname = _safe_filename(file.filename or "image.jpg")
    path = os.path.join(_UPLOADS_DIR, fname)
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    url = f"/uploads/{fname}"
    return ok({"url": url, "purpose": purpose}, resource="uploads")
