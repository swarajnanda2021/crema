"""OCR for product info-card images.

Why this exists:
  Some specialty roasters (notably 729 Grams, but the pattern recurs)
  design their product info cards in Canva/Figma and upload them as
  PNG/JPG images instead of HTML tables. The lavender "HIGH SCORING
  LOT COFFEES" cards on 729's site contain Producer / Variety / Notes
  / Process / Altitude — all in pixels, none in DOM. No text scraper,
  not even Playwright, can extract them via text. Vision/OCR is the
  only path.

Approach — Tesseract primary, Haiku vision as future escalation:
  1. Tesseract handles ~90% of cases for free in ~0.5s/image. Its
     known weakness is digit/letter confusion in stylized fonts
     (e.g. variety code "74110" → "7AN10").
  2. For the small remainder, a Haiku vision call resolves them
     reliably — but it costs ~$0.08/image and requires an API key
     with credit. Wired as an opt-in callback so the enrichment
     pipeline can use Tesseract-only by default (no extra cost,
     no extra dependency) and escalate when configured.

Output shape:
  `ocr_product_image(url) -> str` returns cleaned OCR text suitable
  for direct inclusion in the LLM user_content under a
  `IMAGE OCR (extracted from product image)` section. Returns ""
  on any failure (network, missing tesseract, garbled image).
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import tempfile
from typing import Optional

import requests


# Max bytes we'll download for an OCR pass — guards against accidentally
# pulling 50MB hero images. Most product image cards are <1MB.
_IMAGE_FETCH_MAX_BYTES = 6 * 1024 * 1024  # 6MB
_IMAGE_FETCH_TIMEOUT_S = 15
_TESSERACT_TIMEOUT_S = 20

# Suspicion heuristics — patterns Tesseract is known to garble on
# stylized fonts. Any of these in the OCR output triggers a
# "low-confidence" verdict that callers can use to escalate to a
# vision model.
_SUSPICIOUS_TOKEN_PATTERNS = (
    # Mixed digits and letters in what looks like a code field
    # (e.g. "7AN10" where "74110" was the real value).
    re.compile(r"\b[A-Z]?\d+[A-Z]+\d+[A-Z]?\b"),
    # Lone digit followed by 'O' or 'l' (common substitutions)
    re.compile(r"\b\d{1,3}[OIl]\d{1,3}\b"),
)


def ocr_product_image(
    url: str,
    *,
    haiku_vision_callback: Optional[callable] = None,
) -> str:
    """Download a product image and OCR it.

    `haiku_vision_callback`, if provided, is invoked when Tesseract's
    output looks suspicious. Signature: `(image_bytes: bytes) -> str`.
    The callback's return value (if non-empty) overrides Tesseract.

    Returns "" if the fetch or OCR fails entirely. Successful return
    is cleaned multi-line text ready to drop into user_content.
    """
    if not url or not url.startswith(("http://", "https://")):
        return ""

    img_bytes = _fetch_image(url)
    if not img_bytes:
        return ""

    text = _tesseract_ocr(img_bytes)

    if haiku_vision_callback and _looks_suspicious(text):
        try:
            haiku_text = haiku_vision_callback(img_bytes)
            if haiku_text and haiku_text.strip():
                return _clean(haiku_text)
        except Exception:
            # Fall through to tesseract output — better than nothing.
            pass

    return _clean(text)


# ─────────────────────────────────────────────────────────────────────
# Fetch
# ─────────────────────────────────────────────────────────────────────

def _fetch_image(url: str) -> bytes:
    """Download an image with a size cap. Returns b"" on failure."""
    try:
        resp = requests.get(
            url,
            timeout=_IMAGE_FETCH_TIMEOUT_S,
            stream=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            },
        )
        if resp.status_code != 200:
            return b""
        buf = io.BytesIO()
        downloaded = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            downloaded += len(chunk)
            if downloaded > _IMAGE_FETCH_MAX_BYTES:
                return b""  # too large, abort
            buf.write(chunk)
        return buf.getvalue()
    except (requests.RequestException, OSError):
        return b""


# ─────────────────────────────────────────────────────────────────────
# Tesseract
# ─────────────────────────────────────────────────────────────────────

def _tesseract_ocr(img_bytes: bytes) -> str:
    """Run tesseract against an in-memory image. Returns text or ""."""
    if not img_bytes:
        return ""
    # Tesseract reads from a file path; write to a temp file.
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(img_bytes)
        path = f.name
    try:
        proc = subprocess.run(
            ["tesseract", path, "-", "-l", "eng"],
            capture_output=True,
            timeout=_TESSERACT_TIMEOUT_S,
            text=True,
        )
        if proc.returncode != 0:
            return ""
        return proc.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _looks_suspicious(text: str) -> bool:
    """Heuristic — does Tesseract's output show signs of digit/letter
    confusion that a vision model would resolve better?"""
    if not text or len(text) < 30:
        return True  # too little extracted = suspicious
    for pat in _SUSPICIOUS_TOKEN_PATTERNS:
        if pat.search(text):
            return True
    return False


# ─────────────────────────────────────────────────────────────────────
# Cleaning
# ─────────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """Collapse blank lines + strip whitespace. Same shape as the
    page-text cleaner used elsewhere."""
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines)
