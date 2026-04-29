"""
Roaster enrichment v2 — Tab 1 of Catalog Ops.

The previous version (v1) had three structural problems that the
admin caught while testing on naivo.in / 7elementscoffee.com:

  1. The roaster `name` was extracted from the HTML `<title>` via a
     regex that split on `|`/`-`/`—`. Sites with marketing slogans in
     the title ("I've Got Stories To Tell · Buy Freshly Roasted Coffee
     Online") got the slogan saved as the brand name. Sonnet was
     never asked for the name.
  2. The schema asked Sonnet for `tagline`, `year_founded`, `roast_focus`
     — none of which had columns on `roaster_profiles`, so they were
     silently discarded. Meanwhile `city`, `state`, `platform`,
     `bean_catalog_url` — all of which we DO use — weren't asked for
     at all.
  3. The scraper entry point (`shop_url` on `roaster_sources`) was
     filled in by the admin manually, bouncing through "guess the
     right products page" exercises. For non-Shopify sites where the
     bean catalog isn't at `/products` (e.g. 7 Elements has it at
     `/single-origin/`, not `/shop`) the manual step was both
     necessary and easy to get wrong.

v2 fixes all three by:

  - Pre-fetching homepage + about page + sitemap.xml so Sonnet has
    the full nav surface to reason over.
  - Regex-sniffing the platform up-front (cheap signal) and passing
    it as a HINT, then letting Sonnet confirm or override.
  - Asking Sonnet for everything we actually store, in one call:
    name, tagline, about_blurb, specialties, city, state, platform,
    bean_catalog_url, instagram_handle, contact_email.
  - Letting Sonnet pick the bean-catalog URL from the candidate set
    (nav links + sitemap entries) — it's much better than regex at
    "this URL says 'single-origin' so it's probably the bean
    listing."

The single Sonnet call costs ~$0.03 and runs once per roaster
onboarding (or on explicit re-enrich). The extra context is worth it.

Pipeline:
  1. Fetch homepage, about page (try several paths), sitemap.xml.
  2. Regex-sniff platform from homepage HTML.
  3. Extract nav links + sitemap URL list as candidate signals.
  4. One Sonnet call with the rich context → structured profile.
  5. Return a dict the admin endpoint upserts into `roaster_profiles`
     plus the platform + shop_url it should mirror onto
     `roaster_sources`.

The admin reviews + edits in the page route (`/admin/roaster/[slug]`)
before flipping `published=1`. Lighter than the standalone batch
script: no checkpoint file, no parallelism — admin runs one roaster
at a time.
"""

from __future__ import annotations

import json
import os
import re
from typing import Optional
from urllib.parse import urljoin, urlparse

# Local-import `requests` and `bs4` because they're scraper-side deps —
# we want the rest of the API process to start clean even if the
# scraper venv hasn't been pip-installed.

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 2000
HTTP_TIMEOUT = 15
HEADERS = {
    "User-Agent": "CoffeeAggregator/1.0 (roaster-profiles; admin tab)",
    "Accept": "text/html,application/xhtml+xml,application/xml",
}

# Where the about-page prose typically lives on Shopify / WooCommerce stores.
_ABOUT_PATHS = (
    "/pages/about-us", "/pages/about", "/pages/our-story", "/pages/story",
    "/about-us", "/about", "/our-story", "/story",
)

# Where sitemaps typically live.
_SITEMAP_PATHS = (
    "/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml",
)

_LOGO_SELECTORS = (
    "header .logo img", "header img.logo", "header img[class*='logo']",
    ".site-header img", ".header__logo img", "#logo img", "a.logo img",
    ".navbar-brand img", "header a img", ".header img",
)

_HERO_SELECTORS = (
    ".hero img", ".banner img", ".slideshow img", ".carousel img",
    "section.hero img", "div.hero img", "div[class*='hero'] img",
    ".main-banner img", "main img",
)

_NAV_SELECTORS = ("header nav a", "nav a", "header a", ".navigation a")


# ── Tool-use schema (v2) ────────────────────────────────────────────────────

_ROASTER_TOOL = {
    "name": "extract_roaster_profile",
    "description": (
        "Extract the canonical brand profile of a specialty coffee roaster "
        "from their website's homepage + about page + nav + sitemap. "
        "Return the structured fields below. Only include information "
        "actually present in the source — never fabricate."
    ),
    "input_schema": {
        "type": "object",
        "required": [
            "name", "about_blurb", "specialties",
            "platform", "bean_catalog_url",
        ],
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "The roaster's canonical brand name as it would appear "
                    "in a directory listing. Take it from the logo alt text, "
                    "the brand mark, the about-page heading, or the footer "
                    "copyright — NOT from the HTML <title> tag, which often "
                    "contains marketing slogans (e.g. 'I've Got Stories To Tell — "
                    "Buy Freshly Roasted Coffee'). Strip suffixes like 'Coffee "
                    "Roasters', 'Coffee Co', 'Pvt Ltd' only if the brand is "
                    "clearly recognisable without them; otherwise keep the full "
                    "form ('Naivo Coffee Company', '7 Elements Coffee')."
                ),
            },
            "tagline": {
                "type": ["string", "null"],
                "description": (
                    "A single punchy sentence under 15 words capturing the "
                    "roaster's identity. Take it from the homepage hero or "
                    "about-page lead-in if explicit; otherwise infer from "
                    "their mission. Null if nothing concise fits."
                ),
            },
            "about_blurb": {
                "type": "string",
                "description": (
                    "A clean 2-3 paragraph third-person bio: their story, "
                    "philosophy, sourcing approach, what makes them distinctive. "
                    "If the source text is sparse, write a 1-paragraph summary. "
                    "Do not invent details. Do not include marketing taglines "
                    "verbatim — distill into prose."
                ),
            },
            "specialties": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Short searchable tags (2-4 words each) describing what "
                    "the roaster is known for. Examples: 'Single Origin', "
                    "'Indian Estates', 'Natural Process', 'Espresso Blends', "
                    "'Light Roast', 'Filter Coffee', 'Direct Trade'. Max 6."
                ),
            },
            "city": {
                "type": ["string", "null"],
                "description": (
                    "The Indian city the roaster is based in. Take it from "
                    "the contact / footer / about page. Title-case (e.g. "
                    "'Bengaluru', 'New Delhi', 'Mumbai'). Null if not findable."
                ),
            },
            "state": {
                "type": ["string", "null"],
                "description": (
                    "The Indian state, full name. Examples: 'Karnataka', "
                    "'Maharashtra', 'Tamil Nadu'. Null if not findable."
                ),
            },
            "platform": {
                "type": ["string", "null"],
                "enum": [
                    "shopify", "woocommerce", "wix", "squarespace",
                    "magento", "custom", None,
                ],
                "description": (
                    "The e-commerce platform powering the shop. Use the "
                    "PLATFORM HINT in the user message if confident, otherwise "
                    "look at HTML signatures (cdn.shopify.com → shopify; "
                    "wp-content/plugins/woocommerce → woocommerce; "
                    "static.parastorage.com → wix; "
                    "static1.squarespace.com → squarespace). Use 'custom' for "
                    "hand-rolled or unrecognised platforms. Null only if you "
                    "genuinely can't tell."
                ),
            },
            "bean_catalog_url": {
                "type": ["string", "null"],
                "description": (
                    "The ABSOLUTE URL of the page that lists the roaster's "
                    "specialty COFFEE BEANS for sale — not the homepage, not "
                    "the merch page, not blog posts. Pick from the candidate "
                    "URLs in NAV LINKS + SITEMAP. Prefer pages whose path "
                    "says 'single-origin', 'beans', 'coffee', 'shop/coffee', "
                    "'collections/all-coffee'. AVOID '/merch', '/equipment', "
                    "'/subscriptions', '/blog', '/cart'. For Shopify default "
                    "to '/collections/all' or '/collections/coffee'; for "
                    "WooCommerce default to '/shop' if no narrower coffee "
                    "page exists. Return the FULL URL with protocol and host "
                    "(e.g. 'https://7elementscoffee.com/single-origin/'). "
                    "Null if the site has no shop / no coffee listing yet."
                ),
            },
            "instagram_handle": {
                "type": ["string", "null"],
                "description": (
                    "The roaster's Instagram handle WITHOUT the leading @ — "
                    "just the username (e.g. 'naivocoffee', not "
                    "'@naivocoffee' or 'instagram.com/naivocoffee'). Look in "
                    "footer social links and contact pages. Null if not found."
                ),
            },
            "contact_email": {
                "type": ["string", "null"],
                "description": (
                    "Primary contact email for the roaster. Prefer "
                    "hello@/info@/contact@ over personal addresses. Null if "
                    "no email is on the public site."
                ),
            },
        },
    },
}

_ROASTER_SYSTEM = (
    "You are a structured-data extractor for a specialty coffee discovery "
    "platform's catalog. Given raw text + nav links + sitemap entries from "
    "a roaster's website, populate the profile schema with high-confidence, "
    "verbatim-where-possible values. "
    "Never fabricate fields — return null when the source genuinely doesn't "
    "say. Never echo marketing slogans into the `name` field. "
    "When picking the `bean_catalog_url`, optimise for *specialty coffee "
    "beans only* — narrower pages that list just single-origin / espresso "
    "beans are strictly better than the generic /shop, because the scraper "
    "downstream uses this URL as its entry point and we don't want merch "
    "or subscription products polluting the catalog."
)


# ── Errors the admin tab can surface verbatim ──────────────────────────────

class RoasterEnricherError(RuntimeError):
    """Surfaced to the admin as a 422 / 503 with the message."""


# ── Slugger ────────────────────────────────────────────────────────────────

def slugify(name: str) -> str:
    """Match the slug shape used elsewhere in the codebase
    (lowercase, hyphenated, no diacritics, no consecutive hyphens)."""
    s = name.lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


# ── HTTP fetch ─────────────────────────────────────────────────────────────

def _fetch(url: str, *, accept_xml: bool = False) -> Optional[str]:
    try:
        import requests
    except ImportError as e:
        raise RoasterEnricherError(
            "requests isn't installed. `pip install requests beautifulsoup4` "
            "in the FastAPI server's Python env."
        ) from e

    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT,
                              allow_redirects=True)
        if resp.status_code != 200:
            return None
        ct = resp.headers.get("content-type", "")
        if "text/html" in ct or "application/xhtml" in ct:
            return resp.text
        if accept_xml and ("xml" in ct or url.endswith(".xml")):
            return resp.text
        return None
    except Exception:
        return None


def _try_about_page(base_url: str) -> str:
    """Walk the candidate about-page URLs in order and return the first
    body text we find. Returns an empty string if none resolve."""
    for path in _ABOUT_PATHS:
        html = _fetch(urljoin(base_url, path))
        if not html:
            continue
        text = _extract_text(html)
        if text and len(text) > 200:
            return text
    return ""


def _try_sitemap(base_url: str) -> list[str]:
    """Pull the URL list from sitemap.xml (or sitemap_index.xml). Caps at
    the first 200 entries to keep prompt size bounded."""
    for path in _SITEMAP_PATHS:
        xml = _fetch(urljoin(base_url, path), accept_xml=True)
        if not xml:
            continue
        # Extract <loc>...</loc> entries — works for both sitemap and
        # sitemap-index documents.
        urls = re.findall(r"<loc>\s*([^<]+)\s*</loc>", xml)
        if urls:
            return urls[:200]
    return []


# ── HTML helpers ────────────────────────────────────────────────────────────

def _extract_text(html: str) -> str:
    """Strip nav / footer / script and return clean body prose."""
    try:
        from bs4 import BeautifulSoup
    except ImportError as e:
        raise RoasterEnricherError(
            "beautifulsoup4 isn't installed. "
            "`pip install beautifulsoup4` in the API's Python env."
        ) from e
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:8000]  # cap so the prompt stays bounded


def _extract_nav_links(html: str, base_url: str) -> list[str]:
    """Return absolute URLs of all <a> tags inside header / nav. Used as
    candidate URLs for `bean_catalog_url`."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []
    soup = BeautifulSoup(html, "html.parser")
    seen: set[str] = set()
    out: list[str] = []
    for sel in _NAV_SELECTORS:
        for a in soup.select(sel):
            href = (a.get("href") or "").strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            absolute = urljoin(base_url, href)
            if absolute in seen:
                continue
            seen.add(absolute)
            out.append(absolute)
    return out[:50]


def _select_image(html: str, base_url: str, selectors: tuple) -> Optional[str]:
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return None
    soup = BeautifulSoup(html, "html.parser")
    for sel in selectors:
        node = soup.select_one(sel)
        if node and node.get("src"):
            src = node["src"].strip()
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = urljoin(base_url, src)
            return src
    return None


def _detect_platform(html: str) -> Optional[str]:
    """Cheap regex sniff against the homepage HTML. Strong-prior pre-check
    that Sonnet then either confirms or overrides."""
    text = html[:80_000]  # bounded — we only need the head + body markers
    if re.search(r"cdn\.shopify\.com|Shopify\.theme|<meta[^>]*generator[^>]*Shopify", text, re.I):
        return "shopify"
    if re.search(r"wp-content/plugins/woocommerce|class\s*=\s*['\"][^'\"]*woocommerce|wc-block", text, re.I):
        return "woocommerce"
    if re.search(r"static\.parastorage\.com|wixstatic\.com|_wixCIDX", text, re.I):
        return "wix"
    if re.search(r"static1\.squarespace\.com|<meta[^>]*generator[^>]*Squarespace", text, re.I):
        return "squarespace"
    if re.search(r"Mage\.Cookies|/skin/frontend|Magento", text):
        return "magento"
    return None


# ── Sonnet call ────────────────────────────────────────────────────────────

def _call_sonnet(*, base_url: str, platform_hint: Optional[str],
                  homepage_text: str, about_text: str,
                  nav_links: list[str], sitemap_urls: list[str]) -> dict:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RoasterEnricherError(
            "ANTHROPIC_API_KEY is not set. Export it in the shell that runs "
            "the FastAPI server (export ANTHROPIC_API_KEY=sk-...)."
        )

    try:
        import anthropic
    except ImportError as e:
        raise RoasterEnricherError(
            "anthropic SDK isn't installed. `pip install anthropic` in the "
            "FastAPI server's Python env."
        ) from e

    nav_block = "\n".join(f"- {u}" for u in nav_links) if nav_links else "(none extracted)"
    sitemap_block = (
        "\n".join(f"- {u}" for u in sitemap_urls[:80])
        if sitemap_urls else "(no sitemap.xml found)"
    )

    user_content = (
        f"ROASTER URL: {base_url}\n"
        f"PLATFORM HINT (regex sniff, may be wrong): "
        f"{platform_hint or 'unknown'}\n\n"
        f"HOMEPAGE TEXT (cleaned, first ~6000 chars):\n"
        f"{homepage_text or '(empty)'}\n\n"
        f"ABOUT PAGE TEXT (cleaned, first ~6000 chars):\n"
        f"{about_text or '(no about page found)'}\n\n"
        f"NAV LINKS (extracted from header/nav, candidate URLs for "
        f"`bean_catalog_url`):\n{nav_block}\n\n"
        f"SITEMAP URLS (first 80 from /sitemap.xml; helps disambiguate "
        f"product-listing pages):\n{sitemap_block}"
    )

    client = anthropic.Anthropic(max_retries=3)
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_ROASTER_SYSTEM,
            tools=[_ROASTER_TOOL],
            tool_choice={"type": "tool", "name": "extract_roaster_profile"},
            messages=[{"role": "user", "content": user_content}],
        )
    except anthropic.APIError as e:
        raise RoasterEnricherError(f"Sonnet call failed: {e}") from e

    for block in resp.content:
        if block.type == "tool_use":
            return block.input  # type: ignore[return-value]
    raise RoasterEnricherError("Sonnet returned no tool_use block")


# ── Public entry point ─────────────────────────────────────────────────────

def enrich_roaster_from_url(website: str) -> dict:
    """Synthesize a `roaster_profiles` row + the matching
    `roaster_sources` shop_url + platform from one website URL.

    Returns a dict with two top-level shapes:
      - `profile`: keys for `roaster_profiles` upsert.
      - `source`: { platform, shop_url } the endpoint should mirror
        onto `roaster_sources`. Either may be None if Sonnet wasn't
        confident.

    Raises `RoasterEnricherError` for any caller-actionable failure
    (missing API key, missing SDK, unreachable site, Sonnet error).
    """
    if not website:
        raise RoasterEnricherError("website is required")
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    parsed = urlparse(website)
    if not parsed.netloc:
        raise RoasterEnricherError(f"Couldn't parse website URL: {website}")

    base_url = f"{parsed.scheme}://{parsed.netloc}"
    homepage = _fetch(base_url)
    if not homepage:
        raise RoasterEnricherError(
            f"Couldn't fetch homepage at {base_url}. The site may be down "
            "or blocking our user-agent."
        )

    # Image extraction stays HTML-based — Sonnet doesn't need to pick
    # logos, the marketing site already gives us a clean candidate.
    logo_url = _select_image(homepage, base_url, _LOGO_SELECTORS)
    hero_url = _select_image(homepage, base_url, _HERO_SELECTORS)

    homepage_text = _extract_text(homepage)
    about_text = _try_about_page(base_url)
    nav_links = _extract_nav_links(homepage, base_url)
    sitemap_urls = _try_sitemap(base_url)
    platform_hint = _detect_platform(homepage)

    sonnet = _call_sonnet(
        base_url=base_url,
        platform_hint=platform_hint,
        homepage_text=homepage_text,
        about_text=about_text,
        nav_links=nav_links,
        sitemap_urls=sitemap_urls,
    )

    name = (sonnet.get("name") or parsed.netloc.replace("www.", "")).strip()
    slug = slugify(name)

    profile = {
        "roaster_slug": slug,
        "name": name,
        "tagline": (sonnet.get("tagline") or None),
        "about_blurb": (sonnet.get("about_blurb") or "").strip(),
        "specialties": sonnet.get("specialties") or [],
        "city": sonnet.get("city") or None,
        "state": sonnet.get("state") or None,
        "instagram_handle": sonnet.get("instagram_handle") or None,
        "contact_email": sonnet.get("contact_email") or None,
        "website": website,
        "logo_url": logo_url,
        "hero_image_url": hero_url,
    }

    source = {
        # Sonnet's platform takes precedence over the regex hint, but
        # fall back to the hint if Sonnet returned null and the regex
        # was confident.
        "platform": (sonnet.get("platform") or platform_hint),
        "shop_url": sonnet.get("bean_catalog_url") or None,
    }

    return {"profile": profile, "source": source}


# ── Streaming variant ──────────────────────────────────────────────────────
#
# Same surface as `enrich_roaster_from_url` but emits Sonnet's tool_use
# JSON deltas as they stream from the API. Lets the admin page show
# fields populating progressively rather than dumping the whole
# enriched profile after the 5–10 s Sonnet round-trip.

def enrich_roaster_from_url_stream(website: str):
    """Generator. Same end-state as `enrich_roaster_from_url` but
    yields events along the way:

      ("delta", "<partial_json fragment>")
          Each Anthropic `input_json_delta` chunk verbatim. Frontend
          accumulates these into a buffer and runs a partial-JSON
          extractor against it to update fields in real time.

      ("complete", {"profile": {...}, "source": {...}})
          Final canonical payload — same shape `enrich_roaster_from_url`
          returns. Caller (the SSE endpoint) applies the DB upsert
          using this. Frontend should treat fields here as the
          source of truth and overwrite any partial state.

    Raises `RoasterEnricherError` for any caller-actionable failure;
    SSE handler converts those into an `error` event.
    """
    if not website:
        raise RoasterEnricherError("website is required")
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    parsed = urlparse(website)
    if not parsed.netloc:
        raise RoasterEnricherError(f"Couldn't parse website URL: {website}")

    base_url = f"{parsed.scheme}://{parsed.netloc}"
    homepage = _fetch(base_url)
    if not homepage:
        raise RoasterEnricherError(
            f"Couldn't fetch homepage at {base_url}. The site may be down "
            "or blocking our user-agent."
        )

    logo_url = _select_image(homepage, base_url, _LOGO_SELECTORS)
    hero_url = _select_image(homepage, base_url, _HERO_SELECTORS)
    homepage_text = _extract_text(homepage)
    about_text = _try_about_page(base_url)
    nav_links = _extract_nav_links(homepage, base_url)
    sitemap_urls = _try_sitemap(base_url)
    platform_hint = _detect_platform(homepage)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RoasterEnricherError(
            "ANTHROPIC_API_KEY is not set. Export it in the shell that runs "
            "the FastAPI server (export ANTHROPIC_API_KEY=sk-...)."
        )
    try:
        import anthropic
    except ImportError as e:
        raise RoasterEnricherError(
            "anthropic SDK isn't installed. `pip install anthropic` in the "
            "FastAPI server's Python env."
        ) from e

    nav_block = "\n".join(f"- {u}" for u in nav_links) if nav_links else "(none extracted)"
    sitemap_block = (
        "\n".join(f"- {u}" for u in sitemap_urls[:80])
        if sitemap_urls else "(no sitemap.xml found)"
    )
    user_content = (
        f"ROASTER URL: {base_url}\n"
        f"PLATFORM HINT (regex sniff, may be wrong): "
        f"{platform_hint or 'unknown'}\n\n"
        f"HOMEPAGE TEXT (cleaned, first ~6000 chars):\n"
        f"{homepage_text or '(empty)'}\n\n"
        f"ABOUT PAGE TEXT (cleaned, first ~6000 chars):\n"
        f"{about_text or '(no about page found)'}\n\n"
        f"NAV LINKS (extracted from header/nav, candidate URLs for "
        f"`bean_catalog_url`):\n{nav_block}\n\n"
        f"SITEMAP URLS (first 80 from /sitemap.xml; helps disambiguate "
        f"product-listing pages):\n{sitemap_block}"
    )

    client = anthropic.Anthropic(max_retries=3)
    sonnet_input: Optional[dict] = None
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_ROASTER_SYSTEM,
            tools=[_ROASTER_TOOL],
            tool_choice={"type": "tool", "name": "extract_roaster_profile"},
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            for event in stream:
                # The SDK surfaces tool_use input chunks as
                # `input_json_delta`. Other content_block_delta
                # variants (text deltas, citation deltas) shouldn't
                # appear given our `tool_choice` lock, but ignore
                # defensively.
                etype = getattr(event, "type", None)
                if etype == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    if delta is not None and getattr(delta, "type", "") == "input_json_delta":
                        partial = getattr(delta, "partial_json", "") or ""
                        if partial:
                            yield ("delta", partial)
            final = stream.get_final_message()
    except anthropic.APIError as e:
        raise RoasterEnricherError(f"Sonnet call failed: {e}") from e

    for block in final.content:
        if block.type == "tool_use":
            sonnet_input = block.input  # type: ignore[assignment]
            break
    if sonnet_input is None:
        raise RoasterEnricherError("Sonnet returned no tool_use block")

    name = (sonnet_input.get("name") or parsed.netloc.replace("www.", "")).strip()
    slug = slugify(name)
    profile = {
        "roaster_slug": slug,
        "name": name,
        "tagline": (sonnet_input.get("tagline") or None),
        "about_blurb": (sonnet_input.get("about_blurb") or "").strip(),
        "specialties": sonnet_input.get("specialties") or [],
        "city": sonnet_input.get("city") or None,
        "state": sonnet_input.get("state") or None,
        "instagram_handle": sonnet_input.get("instagram_handle") or None,
        "contact_email": sonnet_input.get("contact_email") or None,
        "website": website,
        "logo_url": logo_url,
        "hero_image_url": hero_url,
    }
    source = {
        "platform": (sonnet_input.get("platform") or platform_hint),
        "shop_url": sonnet_input.get("bean_catalog_url") or None,
    }
    yield ("complete", {"profile": profile, "source": source})
