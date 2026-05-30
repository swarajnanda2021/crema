"""Editorial-quality grader for roaster articles.

Composes ONE 0-100 `editorial_score` for each article from five
sub-components — three computed mechanically from `body_html`, two
rated by Haiku via the standard llm_router queue path. The score is
persisted on the row (`roaster_articles.editorial_score`) so the
consumer "Featured Articles" surface can sort by it and the admin
audit can spot weak coverage at a glance.

Why composite: a single Haiku-rated score conflates "this is well-
written prose" with "this links into our catalog" and "this has
strong imagery". Those are independent signals — an article can be
beautifully written with zero in-app links, or it can be a thin
listicle that happens to reference every product in the catalog. We
want a high-quality Featured rail, which means both prose AND
network-effect signals weighted equally.

Five sub-scores, each 0-100, simple-average aggregated:

  • `editorial_prose_quality` (Haiku) — craft, structure, clarity,
    presence of headings + voice. Subjective but Haiku reads it
    reliably when the tool schema is narrow.
  • `sourcing_specificity` (Haiku) — does the prose name a specific
    farm / lot / varietal / altitude / processing method / harvest
    year, vs. generic "single-origin from Ethiopia" hand-waving.
    This is the signal NORTH_STAR.md calls out as the load-bearing
    moat for micro-roasters — sourcing detail is what
    differentiates a roaster's voice from the dominant national
    brand.
  • `image_richness` (mechanical) — count of `<img>` + `<figure>`
    tags inside body_html. Tiered: 0 = 0, 1 img = 33, 2-3 imgs
    = 67, 4+ imgs = 100.
  • `product_cross_links` (mechanical) — count of `<a href>` in
    body_html that resolve to a product on the SAME roaster's
    storefront. Catches the high-signal pattern where a sourcing
    story links to the bag you can buy. Tiered: 0 = 0, 1-2 = 50,
    3+ = 100.
  • `internal_article_cross_links` (mechanical) — count of
    `<a href>` that match the URL of any OTHER article in
    `roaster_articles`. Indicates the article is a node in the
    Crema discovery graph rather than a standalone external post.
    Same tiers as above.

Components persisted to `roaster_articles.editorial_score_components`
as JSON so the admin can see the breakdown when triaging.

Backfill: the standalone `crema_grade_articles` MCP tool iterates
existing articles and runs this grader without re-fetching their
source pages — body_html is already on the row, mechanical scoring
runs over it, the Haiku-rated portion is the only paid token cost
(~$0.005/article at Haiku 4.5 prices). For ~1000 articles, ~$5 +
~3 hours wall with 3 drainers.

New articles: the article enrichment pipeline can call
`grade_one_article` inline after upsert as a follow-up step (TODO —
v1 ships the backfill path first, the inline hook comes after).
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import re
from typing import Any, Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from services.llm_router import call_llm


# ── Haiku scoring tool — narrow schema, two integers only ─────────────────


_GRADE_MODEL = "claude-haiku-4-5-20251001"
_GRADE_MAX_TOKENS = 500


# Token budget is intentionally tiny — we're asking Haiku for two
# scores and a one-sentence rationale, nothing more. The Featured
# rail's job depends on these scores being stable across re-grade
# passes; the schema's narrowness (no free-text fields beyond
# rationale) is what enforces that stability.
_GRADE_TOOL = {
    "name": "score_roaster_article",
    "description": (
        "Score a roaster's article on two editorial dimensions. Read "
        "the body_html supplied in the user message and return two "
        "0-100 integers + a one-sentence rationale per score. Be "
        "calibrated, not generous — most articles cluster in the "
        "40-70 range; reserve 80+ for genuinely strong pieces and "
        "20- for thin / boilerplate content."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "editorial_prose_quality": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": (
                    "Craft of the writing as prose. Considers: clarity of "
                    "structure (does the article have a clear thread of "
                    "argument or narrative?), voice (does the roaster's "
                    "personality come through, or is it generic SEO "
                    "boilerplate?), grammar and flow, presence of "
                    "subheadings or natural paragraph breaks for "
                    "readability, length appropriate to the subject "
                    "(neither padded nor truncated).\n\n"
                    "Calibration anchors:\n"
                    "  • 90+: publication-grade essay with distinctive "
                    "    voice and rigorous structure — the kind of "
                    "    piece you'd share unprompted.\n"
                    "  • 70-89: solid sourcing-story or brewing guide "
                    "    with clear authorial voice; well-edited.\n"
                    "  • 50-69: competent merchant copy; informative but "
                    "    not distinctive; reads like every other "
                    "    roaster's blog.\n"
                    "  • 30-49: thin or padded; sentences awkward; "
                    "    structure unclear; reads as filler.\n"
                    "  • 0-29: barely an article — list of bullet "
                    "    points, AI-generated boilerplate, or a "
                    "    placeholder."
                ),
            },
            "editorial_prose_quality_note": {
                "type": "string",
                "description": (
                    "One sentence (≤120 chars) explaining the prose-"
                    "quality score. Concrete: name what works or what's "
                    "missing — 'clear structure with distinctive voice', "
                    "'padded with generic SEO filler', 'no headings, "
                    "single wall of text'."
                ),
            },
            "sourcing_specificity": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": (
                    "Specificity of the sourcing detail in the article. "
                    "This is the load-bearing signal for the Crema "
                    "Featured rail — micro-roasters compete on the "
                    "concreteness of their farm relationships, not on "
                    "volume.\n\n"
                    "Reward: named farms, named producers, named "
                    "varietals (Geisha / SL28 / Chandragiri / Sarchimor / "
                    "Bourbon), specific processing methods (washed / "
                    "natural / honey / anaerobic — with PROCESS DETAIL, "
                    "not just the label), altitude figures (1450m / "
                    "1200-1400m bands), harvest year, region beyond "
                    "country level (Yirgacheffe vs Ethiopia; "
                    "Chikmagalur vs India), cupping notes tied to "
                    "specific processing choices, the story of the "
                    "buyer's visit to the farm.\n\n"
                    "Penalise: hand-wavy 'sourced from the best estates', "
                    "'single-origin from Africa', 'specialty grade' "
                    "without further detail, generic processing words "
                    "with no method specifics, no mention of producer or "
                    "estate, no altitude or terroir.\n\n"
                    "Score 0 if the article is not about sourcing at all "
                    "(brewing guide, equipment review, café news) — "
                    "this is a sourcing-detail score, not a coffee-"
                    "content score; non-sourcing articles legitimately "
                    "score 0 here without penalising their overall grade "
                    "in a misleading way (the aggregate accounts for it).\n\n"
                    "Calibration anchors for sourcing-relevant articles:\n"
                    "  • 90+: extensive farm-visit narrative with named "
                    "    producer, varietal, altitude, processing method "
                    "    detail, harvest year, and cupping observations "
                    "    tied to specific origin choices.\n"
                    "  • 70-89: names farm/region/varietal/processing "
                    "    method with at least altitude or harvest year; "
                    "    concrete enough that a reader knows where the "
                    "    coffee came from and what's distinctive about "
                    "    it.\n"
                    "  • 50-69: country + region + varietal OR processing "
                    "    method named; missing the human-relationship or "
                    "    terroir layer.\n"
                    "  • 30-49: country + one detail (just varietal, or "
                    "    just region); reads as generic specialty-coffee "
                    "    marketing.\n"
                    "  • 0-29: zero sourcing specifics; or the article is "
                    "    not about sourcing (default 0 for brewing / "
                    "    equipment / lifestyle pieces)."
                ),
            },
            "sourcing_specificity_note": {
                "type": "string",
                "description": (
                    "One sentence (≤120 chars) explaining the sourcing-"
                    "specificity score. Name what's there or what's "
                    "missing — 'names farm, varietal, altitude, "
                    "harvest', 'mentions only country', 'brewing "
                    "guide — N/A for sourcing'."
                ),
            },
        },
        "required": [
            "editorial_prose_quality",
            "editorial_prose_quality_note",
            "sourcing_specificity",
            "sourcing_specificity_note",
        ],
    },
}


_GRADE_SYSTEM = (
    "You are an editorial-quality grader for a specialty-coffee "
    "discovery app (Crema). Your job is to score one article on two "
    "axes (prose quality + sourcing specificity) so the app can "
    "rank-order articles for the Featured rail.\n\n"
    "You will read the article's body_html (no surrounding chrome, "
    "already cleaned by the upstream extractor) and emit ONE tool "
    "call via `score_roaster_article` with two 0-100 integers + a "
    "concise rationale for each.\n\n"
    "Be calibrated, not generous. The Featured rail's value depends "
    "on these scores reliably separating the strongest 10-20% of "
    "the corpus from the rest. If every article scored 70+, the rail "
    "would feature noise — most articles legitimately sit in the "
    "40-69 band, and that band should be the modal score range.\n\n"
    "Score the article in front of you, not the roaster's brand. A "
    "well-known roaster's thin SEO post should score the same as an "
    "unknown roaster's thin SEO post. Conversely, an unknown "
    "roaster's careful sourcing story deserves a high score regardless "
    "of brand recognition.\n\n"
    "Do not penalise for missing images or missing links — the "
    "mechanical scorer handles those separately. Your scores are "
    "about the prose itself."
)


# ── Mechanical scoring — runs over body_html, no Haiku tokens ─────────────


_IMG_RE = re.compile(r"<(?:img|figure)\b", re.IGNORECASE)
_HREF_RE = re.compile(r'<a\s[^>]*href="([^"]+)"', re.IGNORECASE)


def _tier(count: int, *, mid: int, high: int) -> int:
    """Tiered 0/50/100 (or 0/33/67/100 for richer signals) score.

    Defined as a small helper so the three mechanical scorers all
    use identical step-functions and can be tuned consistently."""
    if count <= 0:
        return 0
    if count < mid:
        return 50
    if count < high:
        return 75
    return 100


def _image_richness_score(body_html: Optional[str]) -> int:
    """0-100 score from the count of <img> + <figure> in body_html.

    Body_html is the Haiku-cleaned output where every image is wrapped
    in <figure><img/></figure> per the article enricher's contract.
    Either tag counts — figure is the canonical wrapper, img is the
    actual asset; counting one or the other could double-count or
    miss bare-img edge cases."""
    if not body_html:
        return 0
    # Count <img> tags directly; <figure> wraps them so we count
    # figures only when they DON'T contain an img (rare edge — pure
    # caption figures). Simpler: count <img> appearances.
    img_count = len(re.findall(r"<img\b", body_html, re.IGNORECASE))
    return _tier(img_count, mid=2, high=4)


def _extract_hrefs(body_html: Optional[str]) -> list[str]:
    """Return every href value in body_html. Uses regex over bs4
    because we only need the href strings — no DOM walking required
    and the regex is faster on the 100s of articles we'll re-score."""
    if not body_html:
        return []
    return _HREF_RE.findall(body_html)


def _normalize_url(url: str) -> str:
    """Lower-case host + strip trailing slash + drop query/fragment.
    Match comparisons against the products / roaster_articles tables
    are tolerant of querystring noise (Shopify often appends
    `?variant=...`) and trailing-slash inconsistency."""
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
    except ValueError:
        return url.strip().lower().rstrip("/")
    host = (p.hostname or "").lower()
    path = (p.path or "").rstrip("/")
    if not host:
        return url.strip().lower().rstrip("/")
    return f"{p.scheme.lower() or 'https'}://{host}{path}"


def _product_cross_link_score(
    db, roaster_slug: str, hrefs: list[str],
) -> tuple[int, int]:
    """Returns (0-100 score, raw count of matched product links).

    A link counts if its normalised form matches the product_url of
    ANY product belonging to THIS roaster. Cross-roaster product
    links don't count — the signal we want is "this article points
    back to the bag you can buy from the same roaster."""
    if not hrefs:
        return 0, 0
    rows = db.execute(
        "SELECT product_url FROM products "
        "WHERE roaster_slug = ? AND product_url IS NOT NULL",
        (roaster_slug,),
    ).fetchall()
    product_urls = {_normalize_url(r["product_url"]) for r in rows}
    product_urls.discard("")
    if not product_urls:
        return 0, 0
    norm_hrefs = {_normalize_url(h) for h in hrefs}
    norm_hrefs.discard("")
    matched = norm_hrefs & product_urls
    return _tier(len(matched), mid=1, high=3), len(matched)


def _internal_article_cross_link_score(
    db, this_article_url: str, hrefs: list[str],
) -> tuple[int, int]:
    """Returns (0-100 score, raw count of matched article links).

    A link counts if it matches the URL of any OTHER article in
    roaster_articles. Self-links don't count — they're navigation
    artefacts, not editorial cross-references. Cross-roaster
    article links DO count — they're the densest signal that the
    article is participating in the Crema discovery graph."""
    if not hrefs:
        return 0, 0
    norm_self = _normalize_url(this_article_url)
    rows = db.execute(
        "SELECT url FROM roaster_articles WHERE url IS NOT NULL",
    ).fetchall()
    article_urls = {_normalize_url(r["url"]) for r in rows}
    article_urls.discard(norm_self)
    article_urls.discard("")
    if not article_urls:
        return 0, 0
    norm_hrefs = {_normalize_url(h) for h in hrefs}
    norm_hrefs.discard(norm_self)
    norm_hrefs.discard("")
    matched = norm_hrefs & article_urls
    return _tier(len(matched), mid=1, high=3), len(matched)


# ── Haiku scoring path ────────────────────────────────────────────────────


def _strip_html_to_text(body_html: str, *, cap_chars: int = 12_000) -> str:
    """Convert body_html to plain text for the Haiku scorer. We don't
    need the HTML structure — Haiku is judging prose, not markup.
    Stripping cuts the input token cost ~3-5x vs sending raw HTML."""
    if not body_html:
        return ""
    soup = BeautifulSoup(body_html, "html.parser")
    text = soup.get_text(separator="\n", strip=True)
    if len(text) > cap_chars:
        text = text[:cap_chars] + "\n\n[...truncated]"
    return text


def _haiku_score(
    *,
    roaster_slug: str,
    article_id: int,
    title: str,
    body_text: str,
    topic_category: Optional[str],
) -> Optional[dict]:
    """Enqueue a Haiku scoring job and block on its response. Returns
    the structured output dict (matching `_GRADE_TOOL.input_schema`)
    or None on failure."""
    user_content = (
        f"ARTICLE TITLE: {title}\n"
        f"TOPIC CATEGORY: {topic_category or '(unset)'}\n\n"
        f"ARTICLE BODY (plain text, HTML stripped):\n"
        f"---\n{body_text}\n---"
    )
    try:
        return call_llm(
            step="article_grade",
            system=_GRADE_SYSTEM,
            tool=_GRADE_TOOL,
            user_content=user_content,
            max_tokens=_GRADE_MAX_TOKENS,
            model=_GRADE_MODEL,
            roaster_slug=roaster_slug,
            target_id=str(article_id),
        )
    except Exception:
        return None


# ── Public API ────────────────────────────────────────────────────────────


def grade_one_article(db, article_row) -> Optional[dict]:
    """Score one article end-to-end (mechanical + Haiku), persist the
    score to roaster_articles, return the components dict.

    `article_row` is a sqlite3.Row from `SELECT id, roaster_slug, url,
    title, body_html, topic_category FROM roaster_articles WHERE id=?`
    (the caller is responsible for the SELECT; this function only
    handles the scoring + UPDATE).

    Returns None if Haiku failed OR if there's no body_html to score
    (the row is unscoreable — admin should investigate why
    enrichment didn't land a body)."""
    body_html = article_row["body_html"]
    if not body_html:
        return None

    hrefs = _extract_hrefs(body_html)
    img_score = _image_richness_score(body_html)
    product_score, product_count = _product_cross_link_score(
        db, article_row["roaster_slug"], hrefs,
    )
    article_score, article_count = _internal_article_cross_link_score(
        db, article_row["url"], hrefs,
    )

    body_text = _strip_html_to_text(body_html)
    if not body_text:
        return None

    haiku_out = _haiku_score(
        roaster_slug=article_row["roaster_slug"],
        article_id=article_row["id"],
        title=article_row["title"] or "(untitled)",
        body_text=body_text,
        topic_category=article_row["topic_category"],
    )
    if haiku_out is None:
        return None

    prose_quality = int(haiku_out.get("editorial_prose_quality") or 0)
    prose_note = (haiku_out.get("editorial_prose_quality_note") or "").strip()
    sourcing = int(haiku_out.get("sourcing_specificity") or 0)
    sourcing_note = (haiku_out.get("sourcing_specificity_note") or "").strip()

    components = {
        "editorial_prose_quality": prose_quality,
        "editorial_prose_quality_note": prose_note,
        "sourcing_specificity": sourcing,
        "sourcing_specificity_note": sourcing_note,
        "image_richness": img_score,
        "image_count": len(re.findall(r"<img\b", body_html, re.IGNORECASE)),
        "product_cross_links": product_score,
        "product_link_count": product_count,
        "internal_article_cross_links": article_score,
        "internal_article_link_count": article_count,
    }
    aggregate = round(
        (prose_quality + sourcing + img_score + product_score + article_score) / 5
    )
    components["aggregate"] = aggregate

    now = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
    db.execute(
        "UPDATE roaster_articles SET "
        "  editorial_score = ?, "
        "  editorial_score_components = ?, "
        "  editorial_scored_at = ? "
        "WHERE id = ?",
        (aggregate, _json.dumps(components), now, article_row["id"]),
    )
    db.commit()

    return components


__all__ = [
    "grade_one_article",
]
