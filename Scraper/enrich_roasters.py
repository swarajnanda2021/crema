#!/usr/bin/env python3
"""
LLM + HTML enrichment pipeline for roaster profiles.

For each roaster in verified_roasters_catalog.json, this script:
  1. Fetches the homepage — extracts logo URL, hero/coffee images, social links
  2. Fetches the about page (tries multiple URL patterns)
  3. Calls Claude Sonnet to synthesize a clean about description, tagline,
     founding year, and specialties from the raw text
  4. Writes roasters_enriched.json — ready for a Roasters page

Usage (from the Scraper/ directory):
    ANTHROPIC_API_KEY=sk-...  python enrich_roasters.py
    ANTHROPIC_API_KEY=sk-...  python enrich_roasters.py --resume
    ANTHROPIC_API_KEY=sk-...  python enrich_roasters.py --no-checkpoint

Output: output/roasters_enriched.json
"""

import argparse
import json
import os
import re
import sys
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

import anthropic
import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1500
INTER_REQUEST_PAUSE = 1.0
MAX_RETRIES = 3
HTTP_TIMEOUT = 15

HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (roaster-profiles; contact@example.com)",
    "Accept": "text/html,application/xhtml+xml",
}

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_CATALOG_PATH = os.path.join(_BASE_DIR, "input", "verified_roasters_catalog.json")
_OUTPUT = os.path.join(_BASE_DIR, "output", "roasters_enriched.json")
_CHECKPOINT = os.path.join(_BASE_DIR, "output", "roasters_checkpoint.jsonl")

# About page URL candidates (tried in order)
_ABOUT_PATHS = [
    "/pages/about-us",
    "/pages/about",
    "/pages/our-story",
    "/pages/story",
    "/about-us",
    "/about",
    "/our-story",
]

# Logo: CSS selectors to try in order (homepage)
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
]

# Hero / feature images (homepage — first large image)
_HERO_SELECTORS = [
    ".hero img",
    ".banner img",
    ".slideshow img",
    ".hero-image img",
    ".featured-image img",
    "section.hero img",
    ".home-hero img",
]

# Social link patterns
_SOCIAL_PATTERNS = {
    "instagram": re.compile(r"instagram\.com/([\w.]+)"),
    "facebook": re.compile(r"facebook\.com/([\w./]+)"),
    "twitter": re.compile(r"(?:twitter|x)\.com/([\w]+)"),
    "youtube": re.compile(r"youtube\.com/(?:@|channel/|user/)?([\w-]+)"),
    "linkedin": re.compile(r"linkedin\.com/(?:company/)?([\w-]+)"),
}

# Selectors for the main body text on an about page
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
]


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _fetch(url: str) -> Optional[requests.Response]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT, allow_redirects=True)
        if r.status_code == 200:
            return r
    except Exception:
        pass
    return None


def _fetch_html(url: str) -> Optional[str]:
    r = _fetch(url)
    return r.text if r else None


def _absolute(url: str, base: str) -> str:
    if url.startswith("//"):
        return "https:" + url
    return urljoin(base, url)


# ── Image / logo extraction ───────────────────────────────────────────────────

def _best_src(img_tag) -> Optional[str]:
    """Return the best src from an <img> tag, preferring srcset largest entry."""
    srcset = img_tag.get("srcset") or img_tag.get("data-srcset") or ""
    if srcset:
        # srcset entries: "url 800w, url2 1200w" — pick largest width
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

    return (
        img_tag.get("src")
        or img_tag.get("data-src")
        or img_tag.get("data-lazy-src")
        or None
    )


def _extract_logo(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    for selector in _LOGO_SELECTORS:
        img = soup.select_one(selector)
        if img:
            src = _best_src(img)
            if src and len(src) > 5:
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
    """
    Collect image URLs whose alt/src suggests coffee content.
    Excludes tiny images (likely icons) and the logo.
    """
    coffee_keywords = {"coffee", "roast", "bean", "espresso", "brew", "pour", "cup", "cafe"}
    results = []
    for img in soup.find_all("img"):
        if len(results) >= limit:
            break
        alt = (img.get("alt") or "").lower()
        src = _best_src(img) or ""
        src_l = src.lower()
        if any(kw in alt or kw in src_l for kw in coffee_keywords):
            if src and "logo" not in src_l and "icon" not in src_l:
                results.append(_absolute(src, base_url))
    return results


def _extract_social_links(soup: BeautifulSoup) -> dict:
    social = {}
    full_html = str(soup)
    for platform, pattern in _SOCIAL_PATTERNS.items():
        m = pattern.search(full_html)
        if m:
            handle = m.group(1).strip("/")
            social[platform] = handle
    return social


# ── About page scraping ───────────────────────────────────────────────────────

def _fetch_about_text(website: str) -> str:
    """Try common about-page paths, return the best text found."""
    domain = website.rstrip("/")
    for path in _ABOUT_PATHS:
        url = domain + path
        html = _fetch_html(url)
        if not html:
            continue
        soup = BeautifulSoup(html, "lxml")
        # Remove nav / footer / script noise
        for tag in soup.select("nav, footer, script, style, .header, header"):
            tag.decompose()
        for selector in _ABOUT_TEXT_SELECTORS:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(separator=" ", strip=True)
                if len(text) > 150:
                    return text[:4000]
        # Fall back to body text
        body_text = soup.get_text(separator=" ", strip=True)
        if len(body_text) > 200:
            return body_text[:4000]
    return ""


# ── LLM enrichment ───────────────────────────────────────────────────────────

_ROASTER_TOOL = {
    "name": "extract_roaster_profile",
    "description": "Extract and synthesise a roaster's profile from their website text.",
    "input_schema": {
        "type": "object",
        "required": ["about", "tagline", "year_founded", "specialties", "roast_focus"],
        "properties": {
            "about": {
                "type": "string",
                "description": (
                    "A clean, engaging 2–3 paragraph description of the roaster — "
                    "their story, philosophy, sourcing approach, and what makes them distinctive. "
                    "Write in third person. Do not invent details not in the source text. "
                    "If the source text is sparse, write a shorter 1-paragraph summary."
                ),
            },
            "tagline": {
                "type": ["string", "null"],
                "description": (
                    "A single punchy sentence (under 15 words) that captures the roaster's "
                    "identity. Infer from their mission or style if not stated explicitly."
                ),
            },
            "year_founded": {
                "type": ["integer", "null"],
                "description": "Year the roaster was founded, if mentioned. Null otherwise.",
            },
            "specialties": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Short tags describing what this roaster is known for. "
                    "E.g. ['Single Origin', 'Light Roast', 'Filter Coffee', 'Indian Estates', "
                    "'Natural Process', 'Espresso Blends']. Max 6 items."
                ),
            },
            "roast_focus": {
                "type": ["string", "null"],
                "description": (
                    "Their roast style focus in a few words. "
                    "E.g. 'Light to medium', 'Dark espresso focus', 'Full spectrum'. "
                    "Null if not discernible."
                ),
            },
        },
    },
}

_ROASTER_SYSTEM = """\
You are writing concise roaster profile copy for a specialty coffee discovery website.

Given raw text scraped from a coffee roaster's website, extract and synthesise a clean profile.
- Write the 'about' in third person, engaging and informative.
- Only include information present in the source — do not fabricate details.
- Keep the tagline under 15 words.
- Specialties should be short, searchable tags (2–4 words each).
"""


def _enrich_roaster_llm(
    client: anthropic.Anthropic,
    roaster: dict,
    about_text: str,
) -> Optional[dict]:
    name = roaster["name"]
    city = roaster.get("city", "")
    state = roaster.get("state", "")

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
                system=_ROASTER_SYSTEM,
                tools=[_ROASTER_TOOL],
                tool_choice={"type": "tool", "name": "extract_roaster_profile"},
                messages=[{"role": "user", "content": user_content}],
            )
            for block in resp.content:
                if block.type == "tool_use":
                    return block.input

        except anthropic.RateLimitError:
            wait = 15 * (attempt + 1)
            print(f"    [rate limit] waiting {wait}s…", flush=True)
            time.sleep(wait)

        except anthropic.APIError as exc:
            print(f"    [API error] {exc}", flush=True)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)

    return None


# ── Checkpoint helpers ────────────────────────────────────────────────────────

def _roaster_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _load_checkpoint(path: str) -> dict:
    done = {}
    if not os.path.exists(path):
        return done
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                done[entry["slug"]] = entry["data"]
            except (json.JSONDecodeError, KeyError):
                pass
    return done


def _append_checkpoint(path: str, slug: str, data: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"slug": slug, "data": data}, ensure_ascii=False))
        f.write("\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="LLM roaster profile enrichment")
    parser.add_argument(
        "--catalog", default=_CATALOG_PATH,
        help=f"Roasters catalog JSON (default: {_CATALOG_PATH})",
    )
    parser.add_argument(
        "--output", default=_OUTPUT,
        help=f"Output JSON (default: {_OUTPUT})",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip roasters already in the checkpoint",
    )
    parser.add_argument(
        "--no-checkpoint", dest="no_checkpoint", action="store_true",
        help="Ignore existing checkpoint, start fresh",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    with open(args.catalog, encoding="utf-8") as f:
        roasters = json.load(f)
    print(f"Loaded {len(roasters)} roasters from {args.catalog}\n")

    checkpoint: dict = {}
    if not args.no_checkpoint:
        checkpoint = _load_checkpoint(_CHECKPOINT)
        if checkpoint:
            print(f"Checkpoint: {len(checkpoint)} roasters already enriched\n")

    client = anthropic.Anthropic(api_key=api_key)

    enriched_profiles: list[dict] = []

    for i, roaster in enumerate(roasters, start=1):
        name = roaster["name"]
        slug = _roaster_slug(name)
        website = roaster.get("website", "")

        print(f"[{i}/{len(roasters)}] {name}", flush=True)

        # Use checkpoint if available
        if slug in checkpoint:
            print("  ↩ cached", flush=True)
            enriched_profiles.append(checkpoint[slug])
            continue

        # ── Step 1: Fetch homepage ────────────────────────────────────────
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
                f"  homepage ✓  |  logo: {'✓' if logo_url else '—'}  "
                f"|  hero: {'✓' if hero_image_url else '—'}  "
                f"|  social: {list(social_links.keys()) or '—'}",
                flush=True,
            )
        else:
            print("  homepage fetch failed", flush=True)

        # ── Step 2: Fetch about page ──────────────────────────────────────
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

        # ── Step 3: LLM synthesis ─────────────────────────────────────────
        llm_data = _enrich_roaster_llm(client, roaster, about_text)
        if llm_data:
            print(f"  LLM ✓  |  tagline: {(llm_data.get('tagline') or '')[:60]}", flush=True)
        else:
            print("  LLM failed — profile will have empty text fields", flush=True)
            llm_data = {}

        # ── Step 4: Assemble profile ──────────────────────────────────────
        import datetime
        profile = {
            "slug": slug,
            "name": name,
            "city": roaster.get("city"),
            "state": roaster.get("state"),
            "lat": roaster.get("lat"),
            "lng": roaster.get("lng"),
            "website": website,
            "platform": roaster.get("platform"),
            # LLM-synthesised fields
            "about": llm_data.get("about") or "",
            "tagline": llm_data.get("tagline"),
            "year_founded": llm_data.get("year_founded"),
            "specialties": llm_data.get("specialties") or [],
            "roast_focus": llm_data.get("roast_focus"),
            # Scraped media
            "logo_url": logo_url,
            "hero_image_url": hero_image_url,
            "coffee_image_urls": coffee_image_urls,
            "social_links": social_links,
            "enriched_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        _append_checkpoint(_CHECKPOINT, slug, profile)
        enriched_profiles.append(profile)

        print("", flush=True)  # blank line between roasters
        time.sleep(INTER_REQUEST_PAUSE)

    # Write output
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(enriched_profiles, f, ensure_ascii=False, indent=2)

    # Summary
    total = len(enriched_profiles)
    with_about = sum(1 for p in enriched_profiles if p.get("about"))
    with_logo = sum(1 for p in enriched_profiles if p.get("logo_url"))
    with_hero = sum(1 for p in enriched_profiles if p.get("hero_image_url"))
    with_social = sum(1 for p in enriched_profiles if p.get("social_links"))
    with_year = sum(1 for p in enriched_profiles if p.get("year_founded"))

    print(f"\n{'═' * 60}")
    print("ROASTER ENRICHMENT COMPLETE")
    print(f"  Total roasters       : {total}")
    print(f"  With about text      : {with_about}")
    print(f"  With logo URL        : {with_logo}")
    print(f"  With hero image      : {with_hero}")
    print(f"  With social links    : {with_social}")
    print(f"  With founding year   : {with_year}")
    print(f"  Output               : {args.output}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()
