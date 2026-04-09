#!/usr/bin/env python3
"""
Enrich roasters in crema-app/src/data/roasters.json that are missing about_blurb.

For each roaster missing about_blurb:
  1. Fetch homepage — extract logo, hero images, social links
  2. Fetch about page (common URL patterns)
  3. Call Claude Sonnet to synthesise about_blurb, tagline, founding_year,
     specialties, roast_focus
  4. Update roasters.json in-place

Usage:
    ANTHROPIC_API_KEY=sk-...  python enrich_missing_roasters.py
    ANTHROPIC_API_KEY=sk-...  python enrich_missing_roasters.py --dry-run
    ANTHROPIC_API_KEY=sk-...  python enrich_missing_roasters.py --slug blue-tokai-coffee-roasters
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import anthropic
import requests
from bs4 import BeautifulSoup

# ── Paths ──────────────────────────────────────────────────────────────────────

_BASE_DIR = Path(__file__).parent
_ROASTERS_JSON = _BASE_DIR.parent / "crema-app" / "src" / "data" / "roasters.json"
_CHECKPOINT = _BASE_DIR / "output" / "missing_roasters_checkpoint.jsonl"

# ── Config ─────────────────────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1500
INTER_REQUEST_PAUSE = 1.2
MAX_RETRIES = 3
HTTP_TIMEOUT = 15

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CoffeeAggregator/1.0; +https://crema.coffee)",
    "Accept": "text/html,application/xhtml+xml,application/xhtml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

_ABOUT_PATHS = [
    "/pages/about-us",
    "/pages/about",
    "/pages/our-story",
    "/pages/story",
    "/pages/who-we-are",
    "/about-us",
    "/about",
    "/our-story",
    "/who-we-are",
]

_LOGO_SELECTORS = [
    "header .logo img",
    "header img.logo",
    "header img[class*='logo']",
    ".site-header img",
    ".header__logo img",
    "#logo img",
    "a.logo img",
    ".navbar-brand img",
    "header a img",
    ".header img",
    "img[alt*='logo' i]",
    "img[src*='logo' i]",
]

_HERO_SELECTORS = [
    ".hero img",
    ".banner img",
    ".slideshow img",
    ".hero-image img",
    ".featured-image img",
    "section.hero img",
    ".home-hero img",
    "[class*='hero'] img",
]

_SOCIAL_PATTERNS = {
    "instagram": re.compile(r"instagram\.com/([\w.]+)"),
    "facebook": re.compile(r"facebook\.com/([\w./]+)"),
    "twitter": re.compile(r"(?:twitter|x)\.com/([\w]+)"),
    "youtube": re.compile(r"youtube\.com/(?:@|channel/|user/)?([\w-]+)"),
    "linkedin": re.compile(r"linkedin\.com/(?:company/)?([\w-]+)"),
}

_ABOUT_TEXT_SELECTORS = [
    ".page-content",
    ".page__content",
    ".rte",
    "article",
    "main",
    ".about-content",
    ".about__content",
    "[class*='about']",
    ".content",
    ".entry-content",
]


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _fetch_html(url: str) -> Optional[str]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT, allow_redirects=True)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None


def _absolute(url: str, base: str) -> str:
    if not url:
        return url
    if url.startswith("//"):
        return "https:" + url
    return urljoin(base, url)


# ── Extraction ─────────────────────────────────────────────────────────────────

def _best_src(img_tag) -> Optional[str]:
    srcset = img_tag.get("srcset") or img_tag.get("data-srcset") or ""
    if srcset:
        candidates = []
        for part in srcset.split(","):
            part = part.strip()
            pieces = part.split()
            if pieces:
                url = pieces[0]
                width = 0
                if len(pieces) > 1 and pieces[1].endswith("w"):
                    try:
                        width = int(pieces[1][:-1])
                    except ValueError:
                        pass
                candidates.append((width, url))
        if candidates:
            return sorted(candidates, key=lambda x: -x[0])[0][1]
    return img_tag.get("src") or img_tag.get("data-src") or img_tag.get("data-lazy-src")


def _extract_logo(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    for selector in _LOGO_SELECTORS:
        img = soup.select_one(selector)
        if img:
            src = _best_src(img)
            if src and len(src) > 5 and not any(x in src.lower() for x in ["1x1", "pixel", "spacer"]):
                return _absolute(src, base_url)
    return None


def _extract_hero_image(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    for selector in _HERO_SELECTORS:
        img = soup.select_one(selector)
        if img:
            src = _best_src(img)
            if src:
                return _absolute(src, base_url)
    return None


def _extract_coffee_images(soup: BeautifulSoup, base_url: str, limit: int = 4) -> list:
    coffee_keywords = {"coffee", "roast", "bean", "espresso", "brew", "pour", "cup", "cafe", "kaapi", "filter"}
    results = []
    for img in soup.find_all("img"):
        if len(results) >= limit:
            break
        alt = (img.get("alt") or "").lower()
        src = _best_src(img) or ""
        src_l = src.lower()
        if any(kw in alt or kw in src_l for kw in coffee_keywords):
            if src and not any(x in src_l for x in ["logo", "icon", "1x1", "pixel"]):
                results.append(_absolute(src, base_url))
    return results


def _extract_social_links(soup: BeautifulSoup) -> dict:
    social = {}
    full_html = str(soup)
    for platform, pattern in _SOCIAL_PATTERNS.items():
        m = pattern.search(full_html)
        if m:
            handle = m.group(1).strip("/")
            # Skip generic/system handles
            if handle.lower() not in {"sharer", "share", "dialog", "login", ""}:
                social[platform] = handle
    return social


def _fetch_about_text(website: str) -> str:
    """Try common about-page paths; return best text found (up to 4000 chars)."""
    domain = website.rstrip("/")
    for path in _ABOUT_PATHS:
        url = domain + path
        html = _fetch_html(url)
        if not html:
            continue
        soup = BeautifulSoup(html, "lxml")
        for tag in soup.select("nav, footer, script, style, .header, header, .cookie-banner"):
            tag.decompose()
        for selector in _ABOUT_TEXT_SELECTORS:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(separator=" ", strip=True)
                if len(text) > 150:
                    return text[:4000]
        body_text = soup.get_text(separator=" ", strip=True)
        if len(body_text) > 200:
            return body_text[:4000]
    return ""


# ── LLM enrichment ─────────────────────────────────────────────────────────────

_ROASTER_TOOL = {
    "name": "extract_roaster_profile",
    "description": "Extract and synthesise a roaster's profile from their website text.",
    "input_schema": {
        "type": "object",
        "required": ["about_blurb", "tagline", "founding_year", "specialties", "roast_focus"],
        "properties": {
            "about_blurb": {
                "type": "string",
                "description": (
                    "A clean, engaging 2–3 paragraph description of the roaster — "
                    "their story, philosophy, sourcing approach, and what makes them distinctive. "
                    "Write in third person. Do NOT invent details not in the source text. "
                    "If the source text is sparse, write a shorter 1-paragraph summary. "
                    "Max 600 characters."
                ),
            },
            "tagline": {
                "type": ["string", "null"],
                "description": (
                    "A single punchy sentence (under 15 words) that captures the roaster's identity. "
                    "Infer from their mission/style if not stated. Null if not determinable."
                ),
            },
            "founding_year": {
                "type": ["integer", "null"],
                "description": "Year the roaster was founded, if mentioned. Null otherwise.",
            },
            "specialties": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Short tags (2–4 words each) describing what this roaster is known for. "
                    "E.g. ['Single Origin', 'Light Roast', 'Filter Coffee', 'Indian Estates', "
                    "'Natural Process', 'Espresso Blends']. Max 6 items."
                ),
            },
            "roast_focus": {
                "type": ["string", "null"],
                "description": (
                    "Their roast style in a few words. "
                    "E.g. 'Light to medium', 'Dark espresso focus', 'Full spectrum'. "
                    "Null if not discernible."
                ),
            },
            "sourcing_regions": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "List of Indian coffee estates, farms, or regions they source from. "
                    "E.g. ['Chikkamagaluru', 'Araku Valley', 'Coorg']. "
                    "Empty array if not mentioned."
                ),
            },
        },
    },
}

_SYSTEM = """\
You are writing concise roaster profile copy for a specialty coffee discovery platform.

Given raw text scraped from an Indian coffee roaster's website, extract and synthesise a clean profile.
- Write about_blurb in third person, engaging and informative. Max 600 characters.
- Only include information present in the source — do not fabricate details.
- Keep the tagline under 15 words.
- Specialties should be short, searchable tags (2–4 words each), max 6.
- sourcing_regions: Indian coffee-growing areas or estate names only.
"""


def _llm_enrich(client: anthropic.Anthropic, roaster: dict, about_text: str) -> dict:
    name = roaster["name"]
    city = roaster.get("city") or ""
    state = roaster.get("state") or ""

    user_content = (
        f"Roaster: {name}\n"
        f"Location: {city}, {state}, India\n\n"
        f"Website text:\n{about_text or '(no about page found)'}"
    )

    for attempt in range(MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM,
                tools=[_ROASTER_TOOL],
                tool_choice={"type": "tool", "name": "extract_roaster_profile"},
                messages=[{"role": "user", "content": user_content}],
            )
            for block in resp.content:
                if block.type == "tool_use":
                    return block.input
        except anthropic.RateLimitError:
            wait = 20 * (attempt + 1)
            print(f"    [rate limit] waiting {wait}s…", flush=True)
            time.sleep(wait)
        except anthropic.APIError as exc:
            print(f"    [API error] {exc}", flush=True)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    return {}


# ── Checkpoint ─────────────────────────────────────────────────────────────────

def _load_checkpoint() -> dict:
    done = {}
    if not _CHECKPOINT.exists():
        return done
    with open(_CHECKPOINT, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                done[entry["slug"]] = entry["enrichment"]
            except (json.JSONDecodeError, KeyError):
                pass
    return done


def _save_checkpoint(slug: str, enrichment: dict) -> None:
    _CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    with open(_CHECKPOINT, "a", encoding="utf-8") as f:
        f.write(json.dumps({"slug": slug, "enrichment": enrichment}, ensure_ascii=False))
        f.write("\n")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich missing roaster profiles")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to roasters.json")
    parser.add_argument("--slug", help="Enrich only this roaster slug")
    parser.add_argument("--all", dest="enrich_all", action="store_true",
                        help="Re-enrich all roasters (not just missing about_blurb)")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    with open(_ROASTERS_JSON, encoding="utf-8") as f:
        roasters: list[dict] = json.load(f)

    print(f"Loaded {len(roasters)} roasters from {_ROASTERS_JSON}")

    # Filter to those that need enrichment
    if args.slug:
        targets = [r for r in roasters if r.get("roaster_slug") == args.slug]
        if not targets:
            print(f"ERROR: slug '{args.slug}' not found.", file=sys.stderr)
            sys.exit(1)
    elif args.enrich_all:
        targets = roasters
    else:
        targets = [r for r in roasters if not r.get("about_blurb")]

    print(f"Enriching {len(targets)} roasters\n")

    checkpoint = _load_checkpoint()
    if checkpoint:
        print(f"Checkpoint: {len(checkpoint)} already done\n")

    client = anthropic.Anthropic(api_key=api_key)
    slug_to_idx = {r["roaster_slug"]: i for i, r in enumerate(roasters)}

    done_count = 0
    cached_count = 0

    for i, roaster in enumerate(targets, start=1):
        slug = roaster["roaster_slug"]
        name = roaster["name"]
        website = roaster.get("website", "")

        print(f"[{i}/{len(targets)}] {name}", flush=True)

        # Check checkpoint
        if slug in checkpoint:
            print("  ↩ cached", flush=True)
            enrichment = checkpoint[slug]
            cached_count += 1
        else:
            if not website:
                print("  ✗ no website URL — skipping", flush=True)
                continue

            # Step 1: Homepage
            homepage_html = _fetch_html(website)
            logo_url = None
            hero_image_url = None
            coffee_image_urls = []
            social_links = {}

            if homepage_html:
                soup = BeautifulSoup(homepage_html, "lxml")
                logo_url = _extract_logo(soup, website)
                hero_image_url = _extract_hero_image(soup, website)
                coffee_image_urls = _extract_coffee_images(soup, website)
                social_links = _extract_social_links(soup)
                print(
                    f"  homepage ✓  logo: {'✓' if logo_url else '—'}  "
                    f"hero: {'✓' if hero_image_url else '—'}  "
                    f"social: {list(social_links.keys()) or '—'}",
                    flush=True,
                )
            else:
                print("  homepage fetch failed", flush=True)

            # Step 2: About page
            about_text = _fetch_about_text(website)
            if about_text:
                print(f"  about page ✓  ({len(about_text)} chars)", flush=True)
            else:
                print("  about page not found — using homepage text", flush=True)
                if homepage_html:
                    soup = BeautifulSoup(homepage_html, "lxml")
                    for tag in soup.select("nav, footer, script, style, header"):
                        tag.decompose()
                    about_text = soup.get_text(separator=" ", strip=True)[:4000]

            # Step 3: LLM
            llm = _llm_enrich(client, roaster, about_text)
            if llm:
                print(f"  LLM ✓  tagline: {(llm.get('tagline') or '')[:60]}", flush=True)
            else:
                print("  LLM failed — skipping text fields", flush=True)
                llm = {}

            enrichment = {
                "about_blurb": llm.get("about_blurb") or "",
                "tagline": llm.get("tagline"),
                "founding_year": llm.get("founding_year"),
                "specialties": llm.get("specialties") or [],
                "roast_focus": llm.get("roast_focus"),
                "sourcing_regions": llm.get("sourcing_regions") or [],
                "logo_url": logo_url,
                "hero_image_url": hero_image_url,
                "coffee_image_urls": coffee_image_urls,
                "social_links": social_links,
            }

            _save_checkpoint(slug, enrichment)
            done_count += 1

        # Step 4: Patch roasters list in-memory
        idx = slug_to_idx.get(slug)
        if idx is not None:
            r = roasters[idx]
            # Only overwrite if field is empty/null (don't clobber existing good data)
            for field in ["about_blurb", "tagline", "founding_year", "specialties",
                          "roast_focus", "sourcing_regions", "logo_url", "hero_image_url",
                          "coffee_image_urls", "social_links"]:
                existing = r.get(field)
                new_val = enrichment.get(field)
                if not existing and new_val:
                    r[field] = new_val

        print("", flush=True)
        if not (slug in checkpoint):
            time.sleep(INTER_REQUEST_PAUSE)

    # Write back
    if not args.dry_run:
        with open(_ROASTERS_JSON, "w", encoding="utf-8") as f:
            json.dump(roasters, f, ensure_ascii=False, indent=2)
        print(f"✓ Written {_ROASTERS_JSON}")
    else:
        print("(dry run — not writing)")

    print(f"\n{'═' * 55}")
    print("ENRICHMENT COMPLETE")
    print(f"  Targets      : {len(targets)}")
    print(f"  Newly done   : {done_count}")
    print(f"  From cache   : {cached_count}")
    print(f"  Skipped      : {len(targets) - done_count - cached_count}")
    print(f"{'═' * 55}")


if __name__ == "__main__":
    main()
