"""
Per-article Haiku enrichment for Discover JOURNALS.

Wraps a single Haiku tool-use call that takes the bs4-cleaned page
text + og: hints + the article URL and returns a structured payload:

    {
      "is_article":     bool,           # gate — false rejects the URL
      "title":          str,
      "body_html":      str,            # clean structured HTML
      "image_url":      Optional[str],  # hero (preferred over og:image)
      "published_at":   Optional[str],  # ISO 8601 if extractable
      "word_count":     int,
    }

The Figma 801:155 article-card design (title + parent-domain + hero
image only) doesn't render any per-article excerpt, so the prior
`summary` field was dropped from this schema — Haiku doesn't spend
output tokens on a 1-2 sentence summary the UI never shows. The
scraper's stub/og:description excerpt still lands in
`roaster_articles.excerpt` as a robustness fallback for the
article reader when body_html parsing failed.

Why Haiku instead of the bs4 body extraction:

  * bs4 selectors over-match on Shopify themes (sidebars, recommended-
    article rails, footer "subscribe" CTAs) and under-match on custom
    sites with no <article> tag.
  * Haiku reads structure from semantics — it knows where the article
    body ENDS even when the surrounding markup doesn't say so.
  * Haiku rewrites to a clean HTML subset (h2/h3, p, ul/ol/li,
    blockquote, img) that maps 1:1 to the consumer reader's
    `htmlToBlocks` walker. No inline tags survive, so the renderer
    never has to handle stray <span>/<font>/<style="..."> noise.
  * Haiku also picks the hero image even when og:image is missing or
    points to a generic logo — it understands that "the first
    600+ px image inside the body" is the right hero.

Latency + cost: ~3-5s per article, ~$0.01 each at Haiku 4.5 prices
(~5K input + ~1.5K output tokens). For a roaster with 30 articles
that's ~$0.30 + ~3 minutes; comparable to the per-product enrichment
budget.

Failure mode: returns `None`. Caller (run_article_scrape_job) keeps
the bs4 body as a fallback and stamps `enrichment_status='failed'`
so the admin can see which articles need a re-enrich.
"""

from __future__ import annotations

import os
import re
from typing import Optional


# Match JSON-style and JS-style string escapes that Haiku passes
# through verbatim from source CMS output. Two classes:
#
#   1. Unicode escapes — `\uXXXX` (BMP) or `\uXXXX\uXXXX` surrogate
#      pair (codepoints above U+FFFF, emoji etc.). Grey Soul's CMS
#      exports JSON-style encoding into the rendered HTML.
#   2. JS punctuation escapes — `\'`, `\"`, `\/`, `\\`. Caffena's
#      CMS exports JS-string-escaped prose (so `it's` arrives as
#      `it\'s`).
#
# Haiku passes both classes through verbatim per the v3 prompt's
# "preserve EVERY prose paragraph from the source" rule. The
# Anthropic SDK can't re-decode them because they're already
# inside a normal Python str (the SDK only decodes JSON-encoded
# escapes once at parse time; a literal `\\u2019` in the JSON
# wire format becomes the 6-char string `’`, not the
# apostrophe). `_decode_string_escapes` fixes both classes at the
# enricher boundary so future enrichments are clean. A one-off
# backfill script handles existing rows
# (`tmp/backfill_unicode_escapes.py`).
#
# Whitespace escapes (`\n`, `\t`, `\r`) are NOT decoded — HTML
# collapses whitespace anyway, and decoding them risks introducing
# layout intent the source didn't have. Add them here if a future
# corpus needs it.
_STRING_ESCAPE_RE = re.compile(
    r"\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][cCdDeEfF][0-9a-fA-F]{2})"
    r"|\\u([0-9a-fA-F]{4})"
    r"|\\([\"'/\\])"
)


def _decode_string_escapes(s: str) -> str:
    """Replace literal `\\uXXXX` unicode escapes AND JS punctuation
    escapes (`\\'`, `\\"`, `\\/`, `\\\\`) with their actual characters.
    Handles single BMP codepoints AND surrogate pairs for non-BMP
    codepoints (emoji etc.).

    Returns the input unchanged when no backslash is present, so the
    common case is essentially free.
    """
    if not s or "\\" not in s:
        return s

    def _repl(m: re.Match) -> str:
        if m.group(3):
            return chr(int(m.group(3), 16))
        if m.group(1) and m.group(2):
            # Surrogate pair → combined codepoint
            high = int(m.group(1), 16)
            low = int(m.group(2), 16)
            return chr(0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00))
        # JS punctuation escape — \', \", \/, \\
        return m.group(4)

    return _STRING_ESCAPE_RE.sub(_repl, s)


MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 4000

# Page text gets clipped to keep input cost bounded. 16K characters
# is roughly 4-5K tokens — enough for a long sourcing-story article
# (~3000 words of body + some surrounding markup) without burning
# tokens on full archived blog landings.
PAGE_TEXT_LIMIT = 16_000


class ArticleEnricherError(RuntimeError):
    """Surfaces to the admin tab as a clear 503 / 422."""


# ── Tool schema ────────────────────────────────────────────────────────────


# Topic taxonomy — locked. The taxonomy is HAIKU-DRIVEN: every value
# in this tuple must also appear in three other places that Haiku
# reads or that consume Haiku's output:
#
#   1. `_ARTICLE_TOOL.input_schema.properties.topic_category.enum`
#      below — the JSON-schema enum Haiku is constrained to pick
#      from.
#   2. `_ARTICLE_SYSTEM` cascade ("### topic_category" section) —
#      the priority-ordered rules Haiku walks through. EVERY new
#      bucket needs a cascade rule + an anchor example, otherwise
#      Haiku will fall through to `misc` by default.
#   3. `crema-app/src/utils/articleMeta.ts:TOPIC_LABELS` +
#      `TOPIC_CHIPS` — the consumer-side labels and filter chips.
#      Without an entry there, Haiku's output renders as a tag
#      with no label and no filter affordance.
#
# Adding a bucket without all four edits silently breaks the
# pipeline. The frontend can't filter by an unknown topic; Haiku
# will pick a value the validator rejects; the row lands with
# topic_category=NULL.
#
# v4 (2026-05-14): collapsed the prior 10-bucket scheme into 7
# consumer-mental-model buckets after a corpus audit (716 articles,
# `tmp/heuristic_classifications.json`) showed the 10-bucket version
# was over-classifying into `brew_guide` (58% of corpus) because:
#   - `brew_guide` priority-1 absorbed recipes-using-coffee,
#     buyer's guides, X-vs-Y terminology comparisons, and roast
#     primers that all belonged elsewhere.
#   - `health` + `culture` were positions 8-9 in the cascade and
#     starved (1% combined despite the corpus carrying ~17%).
#   - `harvest_report` had 1 article — collapsed into origins.
#   - `company_update` + `industry_news` blurred — collapsed into
#     `news`.
#   - `other` + `miscellaneous` were duplicates — collapsed into
#     `misc`.
# Plus carved `roast` out of `brew_guide` (~52 articles in the
# corpus share one consumer question — "how does roast level
# affect what I drink?" — that the prior taxonomy had no home for).
# Legacy 10-bucket values (`sourcing_story`, `origin_profile`,
# `harvest_report`, `culture`, `health`, `industry_news`,
# `company_update`, `tasting_notes`, `brew_guide`, `miscellaneous`,
# `other`) are migrated in-place at boot via
# `services.catalog_ops.migrate_topic_categories_v4`. Frontend
# `resolveTopicLabel` does not need legacy fallback — the migration
# guarantees no row carries an old value post-migration.
TOPIC_CATEGORIES = (
    "brew", "roast", "origins", "taste", "lifestyle", "news", "misc",
)


_ARTICLE_TOOL = {
    "name": "extract_roaster_article",
    "description": (
        "Extract the canonical content of a roaster's blog/journal "
        "article from the page text + URL + Open Graph hints provided. "
        "Return clean structured HTML that strips navigation, footers, "
        "subscribe widgets, recommended-article rails, comment forms, "
        "and any other non-article chrome. Only include content "
        "actually present in the source — never fabricate. Also gate "
        "the page on whether it's actually about coffee (sourcing, "
        "brewing, origins, processing, café culture, roasting, "
        "tasting) — coffee-roaster sites also host founder bios, "
        "lifestyle/spirituality essays, and team pages, which we "
        "don't want surfacing in a coffee-discovery feed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "is_article": {
                "type": "boolean",
                "description": (
                    "False if the URL is NOT an article — e.g. it's a "
                    "category landing page, a tag index, the blog home, "
                    "an empty placeholder, a product listing that the "
                    "scraper mis-classified, or a 'page not found' "
                    "fallback. When false, the other fields can be "
                    "omitted; the scraper will skip the URL."
                ),
            },
            "is_about_coffee": {
                "type": "boolean",
                "description": (
                    "True only if the article's primary subject is "
                    "coffee — sourcing trips, brewing techniques, "
                    "origin profiles, harvest reports, processing, "
                    "café culture, roasting, tasting notes, or "
                    "company updates that mention beans/equipment/"
                    "roastery operations. False for: founder/team "
                    "biographies (even on a coffee site), wellness/"
                    "spirituality/lifestyle essays, café-event recaps "
                    "with no coffee content, generic motivation/"
                    "philosophy posts, product-page boilerplate that "
                    "leaked into a blog handle. When false, the "
                    "scraper still writes the row but hides it from "
                    "consumers — admin can override if Haiku is wrong. "
                    "Default to True only when the article clearly "
                    "talks about coffee; when in doubt, return False."
                ),
            },
            "topic_category": {
                "type": "string",
                "enum": [
                    "brew", "roast", "origins", "taste",
                    "lifestyle", "news", "misc",
                ],
                "description": (
                    "One of the seven fixed buckets. Pick the "
                    "best-fit single label by SUBJECT (what the "
                    "article is fundamentally about), not by "
                    "style or shape.\n"
                    "  • 'brew' — how to prepare a coffee drink. "
                    "Brewing methods, recipes whose FINAL PRODUCT "
                    "is coffee or an espresso drink, equipment "
                    "guides (grinders, kettles, scales), extraction "
                    "tutorials, cold brew at home, espresso "
                    "variations, water/filter/grind technique.\n"
                    "  • 'roast' — how coffee is roasted and how "
                    "roast affects what's in the cup. Roast levels "
                    "(light / medium / dark), roast profiles, "
                    "resting/freshness, the roasting process, "
                    "roast-flavor relationships.\n"
                    "  • 'origins' — where the coffee comes from "
                    "and who grew it. Country / region / varietal / "
                    "estate / terroir / altitude / processing "
                    "methods (washed / natural / anaerobic / honey) "
                    "as the SUBJECT, plus farmer profiles, sourcing "
                    "trips, supply-chain stories, harvest reports, "
                    "and 'where coffee is grown' explainers.\n"
                    "  • 'taste' — flavor evaluation and the "
                    "vocabulary of cupping. Tasting notes, flavor "
                    "wheel, acidity / body / sweetness deep-dives, "
                    "Q-grading, cupping protocol, X-vs-Y "
                    "terminology comparisons whose SUBJECT is how "
                    "they taste different (espresso vs cappuccino, "
                    "flat white vs latte).\n"
                    "  • 'lifestyle' — coffee as it fits into a "
                    "human's life or body. Caffeine effects, "
                    "fitness / sleep / focus / productivity / mood "
                    "(the body axis); ritual, gift-giving, café-"
                    "as-social-space, books / music / art "
                    "pairings, food pairings, recipes whose FINAL "
                    "PRODUCT is a NON-coffee dish (brownies, "
                    "desserts, snacks) that happens to use coffee, "
                    "drinker typologies, seasonal traditions (the "
                    "culture axis).\n"
                    "  • 'news' — what's happening in the coffee "
                    "world. Market trends, price shifts, "
                    "certifications, regulation, climate impact, "
                    "trade developments, industry events, "
                    "sustainability initiatives, AND THIS roaster's "
                    "milestones (launches, store openings, "
                    "awards, anniversaries, packaging changes, "
                    "café openings, founder press, new product "
                    "lines).\n"
                    "  • 'misc' — genuine leftovers that don't fit "
                    "any other bucket: FAQs, 'buy coffee online' "
                    "commerce / SEO posts, used-grounds reuse "
                    "hacks, primers / 'what is X?' explainers, "
                    "listicles that span multiple buckets without "
                    "a primary subject. LAST RESORT, NOT a "
                    "default — try every other bucket first.\n"
                    "Required when is_about_coffee=true; may be "
                    "omitted otherwise."
                ),
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "3-7 lowercase keyword tags drawn from THIS "
                    "article's content. Used for sitewide search. "
                    "Examples: ['ethiopia','natural-process','pour-over',"
                    "'single-origin'], ['arabica','robusta','blends',"
                    "'estate'], ['western-ghats','smallholder',"
                    "'shade-grown']. Style: lowercase, hyphenated "
                    "multi-word terms, no leading '#'. Avoid generic "
                    "tags like 'coffee', 'specialty', 'india' — every "
                    "article on this platform is about Indian "
                    "specialty coffee, so they're noise. Prefer "
                    "concrete proper nouns (origin regions, varietals, "
                    "processing methods, brew gear, café names) over "
                    "abstract themes. Required when is_about_coffee="
                    "true; may be empty when is_about_coffee=false."
                ),
            },
            "title": {
                "type": "string",
                "description": (
                    "The article's title — author's vocabulary and "
                    "structure, with NARROW editorial polish for "
                    "morphological errors only. A deterministic "
                    "Python pass downstream handles all case + "
                    "punctuation polish; you handle inflection.\n\n"
                    "SOURCE: prefer the og:title hint when present; "
                    "else the first <h1> in the body. NEVER use the "
                    "URL slug (the slug is a different artifact). "
                    "Strip site-name suffixes ('Article Title | "
                    "Roaster Name' → 'Article Title').\n\n"
                    "EDITORIAL POLISH — inflection only.\n"
                    "Fix obvious WORD-FORM errors where the "
                    "surrounding grammar demands a different "
                    "inflection of the SAME word stem:\n"
                    "  • 'Ethically Sources' → 'Ethically Sourced' "
                    "    (adverb requires adjective / past-"
                    "    participle; source word stem 'source' "
                    "    stays).\n"
                    "  • 'Freshly Roaster' → 'Freshly Roasted' "
                    "    (adverb requires past-participle; word "
                    "    stem 'roast' stays).\n"
                    "  • 'Coffee beans that tastes good' → 'Coffee "
                    "    beans that taste good' (plural subject "
                    "    needs plural verb).\n"
                    "  • 'A coffee that have' → 'A coffee that "
                    "    has' (singular subject needs singular "
                    "    verb).\n\n"
                    "THE INFLECTION TEST: would your change be a "
                    "ONE-WORD morphological swap that a copyeditor "
                    "would mark with a red pen — same word stem, "
                    "different ending? Apply. Otherwise leave "
                    "untouched.\n\n"
                    "WHAT YOU MUST NOT DO:\n"
                    "  • NEVER substitute vocabulary. 'associate' "
                    "    stays 'associate' (don't replace with "
                    "    'guide'). 'sap' stays 'sap' (don't replace "
                    "    with 'syrup'). 'dilettantes' stays. 'come "
                    "    across' stays. 'whole' stays. 'top rate' "
                    "    stays. The word CHOICE is the author's.\n"
                    "  • NEVER restructure sentences. Word order is "
                    "    the source's. You only swap the FORM of a "
                    "    wrongly-inflected word in place.\n"
                    "  • NEVER add or remove words. Same word "
                    "    count, same word stems, same order.\n"
                    "  • NEVER rewrite into 'fluent' English. If "
                    "    the source is awkward but grammatically "
                    "    correct, leave it. Polish only what is "
                    "    grammatically wrong.\n"
                    "  • NEVER sentence-case or alter capitals — "
                    "    the downstream Python pass handles all "
                    "    casing."
                ),
            },
            "excerpt": {
                "type": "string",
                "description": (
                    "A TEASER that entices a reader to TAP THROUGH "
                    "and read the article. Not a synopsis. Not a "
                    "summary. Not the conclusion. The reader already "
                    "doesn't know what's in the article — your job "
                    "is to make them curious enough to find out, not "
                    "to spoil what they'd learn.\n\n"
                    "FRAME AS INVITATION. Use teaser openers — "
                    "'Learn how…', 'Discover why…', 'How…', 'Why…', "
                    "'What it takes to…', 'Find out…'. Hint at the "
                    "question the article answers WITHOUT giving "
                    "the answer. If your excerpt could replace the "
                    "article (reader skips the tap and walks away "
                    "informed), it's a SUMMARY and it's wrong.\n\n"
                    "HARD CAP 150 CHARACTERS. ≤ 3 lines on mobile "
                    "(≈50 chars/line at feed width). Sweet spot is "
                    "60-100 chars — short, punchy, mysterious. ONE "
                    "sentence. Count after writing.\n\n"
                    "WITHHOLD THE ANSWER. Don't list the mechanism. "
                    "Don't enumerate the recipes / varietals / "
                    "regions / steps. Don't conclude. Don't reveal "
                    "the takeaway. Pose the question; the article "
                    "delivers the answer.\n\n"
                    "Examples — same article 'Best Coffee for Weight "
                    "Management' (an article explaining how caffeine "
                    "affects metabolism, with timing/dose guidance):\n"
                    "  BAD (conclusion, gives answer away, 191 "
                    "chars): 'Caffeine can support weight management "
                    "indirectly by boosting energy and metabolism, "
                    "but only when paired with movement, nutrition, "
                    "and sleep — plus timing, dose, and brew choice "
                    "matter.'\n"
                    "  BAD (summary opener, 96 chars): 'Coffee is "
                    "not just a morning habit anymore — it has "
                    "become part of many fitness routines.'\n"
                    "  BAD (over-cap content list, 220 chars): 'When "
                    "to drink coffee around training: how caffeine "
                    "timing affects performance, fat oxidation, and "
                    "recovery, with guidance on dose and brew choice "
                    "for pre- vs post-workout.'\n"
                    "  GOOD (teaser, 58 chars): 'Learn how caffeine "
                    "can support weight management indirectly.'\n"
                    "  GOOD (teaser, 82 chars): 'How coffee timing "
                    "and brew choice quietly shape weight-management "
                    "results.'\n"
                    "  GOOD (teaser, 67 chars): 'Why your coffee "
                    "habit might be working harder than the gym.'\n\n"
                    "More good teasers across topics:\n"
                    "  - 'Discover what makes Geisha, Bourbon, and "
                    "    SL28 so prized among specialty roasters.'\n"
                    "  - 'How grind size makes or breaks every "
                    "    brewing method.'\n"
                    "  - 'Learn what really separates filter coffee "
                    "    from instant.'\n"
                    "  - 'Why Moka Pot coffee fails — and the small "
                    "    fixes that save it.'\n\n"
                    "NEVER use og:description (that's the roaster's "
                    "homepage description for most blogs and reads "
                    "as gutter). NEVER quote the article's opening "
                    "line verbatim. NEVER conclude on behalf of the "
                    "article. Required when is_about_coffee=true."
                ),
            },
            "body_html": {
                "type": "string",
                "description": (
                    "Clean structured HTML of the article body. Allowed "
                    "tags: <h2>, <h3>, <p>, <ul>, <ol>, <li>, "
                    "<blockquote>, <figure>, <figcaption>, <img>, <hr>, "
                    "<video-embed src=\"...\" />, and the editorial "
                    "inline trio <a href=\"...\">, <strong>, <em>. "
                    "Forbidden: <span>, <div>, <table>, <iframe>, "
                    "<script>, any class/id/style attributes. "
                    "Preserve EVERY prose paragraph from the source "
                    "verbatim — don't summarize, don't drop 'less "
                    "important' paragraphs.\n\n"
                    "INLINE LINKS — keep every one of them.\n"
                    "  • DETECTED BODY LINKS in the user message lists "
                    "    every <a href> the scraper found inside the "
                    "    article body. EVERY ONE of those entries "
                    "    MUST appear in body_html as the exact same "
                    "    <a href=\"...\">visible-text</a> markup — "
                    "    same href, same anchor text. They are the "
                    "    editorial cross-references the renderer "
                    "    surfaces as embedded CoffeeCards / journal "
                    "    callouts; dropping them silently breaks the "
                    "    in-app navigation graph.\n"
                    "  • If the source has additional inline <a href> "
                    "    tags not in DETECTED BODY LINKS (rare; the "
                    "    scraper covers most cases), preserve those "
                    "    too. NEVER fabricate a link the source "
                    "    didn't author.\n"
                    "  • Use absolute URLs (resolve relative paths "
                    "    against the article URL). Keep visible link "
                    "    text exactly as written.\n\n"
                    "INLINE EMPHASIS — keep <strong> and <em>.\n"
                    "  • Preserve the source's <strong>/<b> as <strong> "
                    "    and <em>/<i> as <em>. These carry editorial "
                    "    weight (section labels, key concepts, "
                    "    quoted-phrase emphasis) that flatten reading "
                    "    if dropped.\n"
                    "  • Don't ADD emphasis the source didn't have. "
                    "    Drop redundant nesting (<strong><strong>x</...>"
                    "→ <strong>x</strong>).\n\n"
                    "EDITORIAL POLISH — narrow body cleanup.\n"
                    "Apply the same conservative polish in body prose "
                    "that the title rule applies:\n"
                    "  1. SENTENCE-START capitalisation. Within each "
                    "    <p>/<blockquote>/<li>, the first letter of "
                    "    every sentence is uppercase. Detect "
                    "    sentence starts: at the start of the block, "
                    "    AND after every '.', '!', '?', ':'. If the "
                    "    next non-whitespace letter is lowercase, "
                    "    uppercase it. Don't touch capitalisation "
                    "    mid-sentence (the title-polish rules cover "
                    "    that).\n"
                    "  2. INFLECTION — same-stem, wrong-ending fixes. "
                    "    'Ethically Sources' → 'Ethically Sourced'. "
                    "    'Freshly Roaster' → 'Freshly Roasted'. "
                    "    'A bean that have' → 'A bean that has'. "
                    "    The word stem stays; only the ending changes.\n"
                    "  3. SPELLING — only words NOT in any major "
                    "    English dictionary. Apply ONE TEST: would "
                    "    Merriam-Webster, Oxford, Collins, or "
                    "    Macquarie list this word (including as an "
                    "    informal, regional, slang, or archaic "
                    "    variant)? If yes — leave it. If no — "
                    "    correct it.\n"
                    "       Fix: 'mitsake' → 'mistake', 'recieve' → "
                    "       'receive', 'definately' → 'definitely', "
                    "       'occured' → 'occurred', 'seperate' → "
                    "       'separate', 'accomodate' → "
                    "       'accommodate', 'untill' → 'until'.\n"
                    "       Leave: 'thru' (informal, in dict), "
                    "       'tho' (informal, in dict), 'alright' "
                    "       (in dict), 'colour' / 'theatre' "
                    "       (regional spellings, in dict), 'gotta' "
                    "       / 'kinda' / 'wanna' (informal, in "
                    "       dict), 'apropos' (uncommon but in "
                    "       dict).\n\n"
                    "WHAT YOU MUST NOT DO:\n"
                    "  • NEVER substitute vocabulary. Unusual word "
                    "    choices stay the author's: 'sap', "
                    "    'associate', 'top rate', 'dilettantes', "
                    "    'come across', 'transport frequencies', "
                    "    'repast preferences', 'fidelity charge "
                    "    applications', 'expensive espresso' — all "
                    "    of these read odd but each word is in the "
                    "    dictionary and the choice is the author's.\n"
                    "  • NEVER restructure sentences. Word order is "
                    "    the source's.\n"
                    "  • NEVER add or remove sentences, phrases, or "
                    "    paragraphs.\n"
                    "  • NEVER 'improve' fluent-but-awkward English. "
                    "    If grammatically correct, leave it alone.\n\n"
                    "WHEN IN DOUBT — preserve verbatim. The cost of "
                    "a missed correction is small; the cost of "
                    "'correcting' a legitimate informal / regional / "
                    "uncommon spelling or substituting vocabulary is "
                    "loss of authorial voice.\n\n"
                    "BARE-URL AUTO-LINKING — wrap plaintext URLs as "
                    "anchor tags.\n"
                    "  • When the source prose contains a bare URL "
                    "    (`www.kruticoffee.com`, `https://example.com`, "
                    "    `coffeepro.com.hk`) NOT already wrapped in an "
                    "    <a> tag, emit it as <a href=\"...\">visible "
                    "    text</a>. Canonicalise the href: add https:// "
                    "    when missing, lowercase the host. Keep the "
                    "    visible text exactly as the source wrote it "
                    "    (with or without www., with or without https). "
                    "    Common in author bios, resource lists, "
                    "    footnotes.\n\n"
                    "VIDEO EMBEDS — emit <video-embed src=\"...\" />.\n"
                    "  • For every URL in the DETECTED VIDEOS list, "
                    "    place ONE <video-embed src=\"<that-url>\" /> "
                    "    block in body_html at the position the source "
                    "    references it. Use the URL exactly as given "
                    "    in DETECTED VIDEOS (the canonical youtu.be/ID "
                    "    or vimeo.com/ID form). Self-closing tag — no "
                    "    children, no other attributes.\n"
                    "  • PLACEMENT — when the prose has a clear video "
                    "    callout ('In this video Dr Das shares...', "
                    "    'Watch the harvest tour below', 'See our "
                    "    process'), place the embed immediately after "
                    "    that paragraph. When there's no in-prose "
                    "    callout, place a single embed at the very "
                    "    start of body_html (before the first <p>). "
                    "    For multi-video articles with no callouts, "
                    "    stack them at the start in source order.\n"
                    "  • NEVER emit a video URL not in DETECTED VIDEOS. "
                    "    NEVER emit <iframe> — that's blocked. NEVER "
                    "    fabricate a thumbnail URL — the renderer "
                    "    derives it from the platform + video_id.\n\n"
                    "Inline images become <figure><img "
                    "src=\"https://absolute-url\" alt=\"...\">"
                    "<figcaption>caption-from-source-only</figcaption>"
                    "</figure>; never fabricate caption text. Insert "
                    "<hr> immediately before every <h2> as the "
                    "ad-slot anchor (mechanical rule: hr count = h2 "
                    "count). Drop chrome — nav, footer, sidebar, "
                    "related posts, subscribe CTAs, comment forms, "
                    "share buttons, author-bio cards."
                ),
            },
            "image_url": {
                "type": "string",
                "description": (
                    "Absolute https URL of the article's hero. RULES "
                    "in order:\n"
                    "  1. REJECT logos. If a candidate URL's filename "
                    "     contains any of these tokens — `logo`, "
                    "     `favicon`, `wordmark`, `site-logo`, "
                    "     `brand-logo`, `sitelogo`, `header`, `icon` "
                    "     — it's the roaster's brand mark, NOT an "
                    "     article hero. Skip it. Never emit a logo as "
                    "     the article's hero, ever.\n"
                    "  2. Prefer body_images[0] when its alt/context "
                    "     shows it's article-specific (a farm photo, "
                    "     brew shot, infographic tied to the subject)."
                    "\n"
                    "  3. Else use bundle.og_image — but ONLY after "
                    "     applying rule 1 to its URL.\n"
                    "  4. Return null when no non-logo candidate "
                    "     exists. NULL is the right answer for "
                    "     text-only articles whose only available "
                    "     image is the roaster's logo. The consumer "
                    "     reader collapses cleanly when image_url is "
                    "     null — title sits at the top with no blank "
                    "     placeholder."
                ),
            },
            "published_at": {
                "type": "string",
                "description": (
                    "ISO 8601 publish date of THE ARTICLE ITSELF — "
                    "e.g. '2026-04-15T00:00:00Z' or '2026-04-15'. "
                    "Sources, in order of trust: the "
                    "OG:PUBLISHED_TIME hint when present, an in-body "
                    "'Posted on...' / 'Published...' / 'Updated...' "
                    "byline, a date appearing next to the author "
                    "credit, or a date in the URL slug "
                    "(`/blogs/2026/04/...`).\n\n"
                    "RETURN NULL when the source carries no "
                    "publication date. NEVER substitute today's "
                    "date, the scrape date, or any date derived from "
                    "scrape/enrichment time. NEVER fabricate a "
                    "plausible date — a missing date is data, not a "
                    "gap to fill. The renderer hides the date "
                    "cleanly when this field is null; an invented "
                    "date misleads the reader about how fresh the "
                    "content is.\n\n"
                    "If the page shows a relative date ('2 days "
                    "ago', 'Posted yesterday'), return null — "
                    "relative-to-scrape-time inputs aren't real "
                    "publication dates."
                ),
            },
            "word_count": {
                "type": "integer",
                "description": (
                    "Approximate word count of the body_html (count "
                    "the words, not the markup). Used by the reader to "
                    "show estimated reading time."
                ),
            },
        },
        "required": ["is_article"],
    },
}


# ── Article enricher system prompt — v3.1 ─────────────────────────────────
#
# Lifecycle:
#   v1 — original prompt; inconsistent excerpts (og:description leaked
#        across all of a roaster's articles), too-conservative heros
#        (29% NULL), inconsistent JSON-tag/topic decisions.
#   v2 — shipped 2026-05-09. Synthetic excerpt rule, mechanical hero
#        cascade, appearance-order tag generation, locked topic
#        cascade. Convergence trajectory iter 0 → 5: JSON-validity
#        1/3 → 3/3, topic agreement split → unanimous, excerpt drift
#        → identical-verbatim. (See tmp/article_pilot_v2/.)
#        v2's body_html allow-list excluded inline editorial markup
#        — no <a>, no <strong>, no <em> — which collapsed every
#        article into plain paragraphs. Caffena's articles, which
#        rely on inline links to products + sibling guides, lost
#        every cross-reference (4 links → 0) and every emphasis
#        (~20 <b> tags → 0) on every pass.
#   v3 — shipped 2026-05-10. Body_html allow-list extended to
#        <a href>, <strong>, <em>. Same hero/topic/tag/excerpt
#        rules as v2 — only inline markup changed. The downstream
#        renderer matches inline hrefs against the in-app product
#        + article caches and surfaces matched references as
#        embedded CoffeeCard / journal-link callouts under the
#        referencing paragraph; unmatched links open externally.
#        Re-enrichment is triggered by the per-roaster admin
#        button (POST /admin/roasters/{slug}/scrape-articles
#        with force_enrich=true). Caffena rolled out first as
#        the editorial test case.
#   v3.1 — shipped 2026-05-10. Catch-all `other` bucket replaced
#          with three concrete buckets: `culture` (ritual /
#          lifestyle / gift-giving / café-as-social-space),
#          `health` (caffeine effects / fitness / focus / sleep),
#          `miscellaneous` (genuine leftovers — FAQs, commerce
#          posts, used-grounds hacks). The cascade now has 10
#          buckets and `miscellaneous` is the LAST RESORT, not a
#          default. Pre-v3.1 rows with `topic_category='other'`
#          continue to render as "Miscellaneous" via
#          frontend/articleMeta.resolveTopicLabel; new
#          enrichments must pick one of the three explicit
#          buckets.
#
_ARTICLE_SYSTEM = (
    "You extract roaster blog/journal articles from raw page text "
    "and emit a single structured tool call via "
    "`extract_roaster_article`. These articles surface in Crema, a "
    "coffee-discovery app for specialty-coffee drinkers.\n\n"
    "## DETERMINISM RULES — apply mechanically, not interpretively\n\n"
    "Each bundle may be enriched multiple times (for cross-validation, "
    "retry, A/B). Most rules below are mechanical to ensure the same "
    "source produces the same output. The excerpt is the one field "
    "that must be a SYNTHETIC summary — read the whole article, write "
    "what's in it.\n\n"
    "### Excerpt (REQUIRED when is_about_coffee=true)\n"
    "Write a TEASER, not a summary. The reader has NOT read the "
    "article — your job is to entice them to tap and read, NOT to "
    "spoil what's inside. If your excerpt could replace the article "
    "(reader walks away informed without tapping), it's a summary "
    "and you've failed. Pose the question; the article delivers "
    "the answer.\n"
    "FRAME as invitation. Use 'Learn how…', 'Discover why…', "
    "'How…', 'Why…', 'What it takes to…', 'Find out…' openers. "
    "Hint at the question the piece answers WITHOUT delivering it.\n"
    "HARD CAP 150 characters. ≤ 3 lines on mobile (~50 chars/line "
    "at feed width). Sweet spot 60-100 chars. ONE sentence.\n"
    "WITHHOLD the conclusion. Don't list the mechanism. Don't "
    "enumerate recipes / varietals / regions / steps. Don't "
    "reveal the takeaway.\n"
    "  BAD (conclusion gives answer away, 191 chars): 'Caffeine "
    "can support weight management indirectly by boosting energy "
    "and metabolism, but only when paired with movement, "
    "nutrition, and sleep — plus timing, dose, and brew choice "
    "matter.'\n"
    "  BAD (summary opener, 96 chars): 'Coffee is not just a "
    "morning habit anymore — it has become part of many fitness "
    "routines.'\n"
    "  BAD (over-cap content-list, 220 chars): 'When to drink "
    "coffee around training: how caffeine timing affects "
    "performance, fat oxidation, and recovery, with guidance on "
    "dose and brew choice for pre- vs post-workout.'\n"
    "  GOOD (teaser, 58 chars): 'Learn how caffeine can support "
    "weight management indirectly.'\n"
    "  GOOD (teaser, 82 chars): 'How coffee timing and brew choice "
    "quietly shape weight-management results.'\n"
    "  GOOD (teaser, 67 chars): 'Why your coffee habit might be "
    "working harder than the gym.'\n"
    "More good teasers across topics:\n"
    "  - 'Discover what makes Geisha, Bourbon, and SL28 so prized "
    "    among specialty roasters.'\n"
    "  - 'How grind size makes or breaks every brewing method.'\n"
    "  - 'Learn what really separates filter coffee from instant.'\n"
    "  - 'Why Moka Pot coffee fails — and the small fixes that "
    "    save it.'\n"
    "Read the WHOLE body_html, then write a TEASER. Never quote "
    "the opener verbatim. Never use og:description. NEVER "
    "conclude on behalf of the article.\n\n"
    "### published_at\n"
    "Pull from the OG:PUBLISHED_TIME hint when present, else an "
    "in-body 'Posted on…' / 'Published…' byline, else a date in the "
    "URL slug ('/blogs/2026/04/…'). RETURN NULL when the source "
    "carries no publication date — NEVER substitute today's date, "
    "the scrape date, or any date derived from scrape/enrichment "
    "time. NEVER fabricate a plausible date. A missing publish date "
    "is data; the renderer hides the line cleanly when it's null. "
    "Relative dates ('2 days ago', 'Posted yesterday') → null.\n\n"
    "### Tags (REQUIRED when is_about_coffee=true)\n"
    "Output 3-5 tags via APPEARANCE-ORDER:\n"
    "  1. Walk body_html top to bottom.\n"
    "  2. Maintain an ordered list of distinct concrete coffee-domain "
    "     terms as you encounter them. Concrete = origin region "
    "     (Coorg, Wayanad, Chikmagalur, Ethiopia, Kerala, BR Hills, "
    "     Araku, Nilgiris); varietal (S795, Bourbon, Gesha, "
    "     Chandragiri); processing method (washed, natural, honey, "
    "     anaerobic, monsoon-malabar); brew gear/method (V60, "
    "     Aeropress, Chemex, French Press, Moka Pot, Espresso, "
    "     Pour-Over, Cold Brew, Channi); specific concept "
    "     (shade-grown, single-origin, fair-trade, direct-trade, "
    "     biodiversity, micro-lot, traceability); proper-name "
    "     roaster/café/farm/estate.\n"
    "  3. Apply the NOISE FILTER — drop these terms entirely: "
    "     coffee, india, indian, specialty, beans, bean, roast, "
    "     roasting, roaster, roasters, cup, cupping, flavor, flavour, "
    "     taste, aroma, brew, brewing, farm, farming, farmer, "
    "     farmers, grower, growers, producer, producers, production, "
    "     harvest, crop, green, lot, lots, blog, article, news, post, "
    "     morning, evening, home, world, quality, process, "
    "     processing, journey, experience, story, culture, technique, "
    "     bangalore, mumbai, delhi, pune, chennai. They appear on "
    "     every coffee article and are useless for search.\n"
    "  4. Normalize: lowercase, hyphenate spaces (`pour over` → "
    "     `pour-over`), strip trailing punctuation. Synonym "
    "     collapse: kodagu → coorg, chikkamagaluru → chikmagalur.\n"
    "  5. Take the FIRST 3-5 entries. Sort alphabetically.\n\n"
    "### topic_category (REQUIRED when is_about_coffee=true)\n"
    "Decide via this priority cascade — pick the FIRST that matches "
    "by SUBJECT (what the piece is fundamentally about), not by "
    "style. The cascade is ordered so the bucket whose subject is "
    "the SHARPEST signal wins.\n"
    "  1. SUBJECT is how coffee is roasted, or how roast level / "
    "     roast profile / freshness-of-roast / roast-rest affects "
    "     the cup → `roast`. ('Light vs Medium vs Dark', 'Why "
    "     Freshly Roasted Coffee Matters', 'Coffee Roasting "
    "     Process - Steps and Methods', 'Resting Roasted Coffee: "
    "     Optimal Rest Duration', 'The Art of the Light Roast', "
    "     'Roast profiles in specialty coffee'.)\n"
    "  2. SUBJECT is preparing a coffee drink — how-to-brew, "
    "     equipment, recipes whose FINAL PRODUCT IS COFFEE or an "
    "     espresso drink, grind technique, extraction → `brew`. "
    "     ('V60 Brew Guide', 'Cold Brew Concentrate at Home', "
    "     'How to Make Espresso', 'Best Manual Coffee Grinders', "
    "     'AeroPress Inverted'.) NOTE — recipes whose FINAL "
    "     PRODUCT is a NON-coffee dish using coffee (brownies, "
    "     ice cream, peda, snacks) go to `lifestyle`, not "
    "     `brew`. Buyer's-criteria / 'things to consider when "
    "     buying coffee' guides go to `misc`, not `brew`.\n"
    "  3. SUBJECT is where the coffee comes from or who grew it — "
    "     country / region / varietal / estate / terroir / "
    "     altitude / processing-method-as-subject, plus farmer "
    "     profiles, sourcing trips, supply-chain stories, year-"
    "     specific harvest reports, 'where coffee is grown' "
    "     explainers → `origins`. ('Why Chikmagalur Is Famous "
    "     for Coffee', 'What Is Anaerobic Coffee?', 'Producer "
    "     Series Lot 10', 'A Coffee Story from the Central "
    "     Himalayas', 'Rethink Robusta: The Global Landscape', "
    "     'Harvest 2025 Report'.)\n"
    "  4. SUBJECT is flavor evaluation or tasting vocabulary — "
    "     cupping notes, flavor wheel, acidity / body / "
    "     sweetness deep-dives, Q-grading, sensory training, "
    "     X-vs-Y terminology comparisons whose payoff is HOW THEY "
    "     TASTE DIFFERENT → `taste`. ('Decoding Coffee Tasting "
    "     Notes', 'Understanding Coffee Acidity', 'Espresso vs "
    "     Cappuccino', 'The Coffee Flavour Wheel', 'How to "
    "     Identify Flavor Notes'.)\n"
    "  5. SUBJECT is the relationship between coffee and a "
    "     human's body OR life → `lifestyle`. The BODY axis: "
    "     caffeine effects, fitness / pre- or post-workout, "
    "     focus / productivity, sleep / digestion / mood, "
    "     science-of-coffee-on-humans. The CULTURE axis: ritual, "
    "     gift-giving, café-as-social-space, books / music / "
    "     art pairings, food pairings, recipes whose FINAL "
    "     PRODUCT is a non-coffee dish that uses coffee, drinker "
    "     typologies as identity, seasonal traditions tied to "
    "     coffee. ('Love Coffee? Here's Why It Probably Loves "
    "     You Back!', 'Coffee Gifts for Diwali', 'Books and "
    "     Coffee', 'Health Benefits of Drinking Coffee', 'Family "
    "     Bonding Over Coffee', 'Raw Cocoa & Espresso "
    "     Brownies'.)\n"
    "  6. SUBJECT is news about the coffee world or a specific "
    "     roaster's milestone → `news`. INDUSTRY: market shifts, "
    "     price trends, regulation, certifications, climate "
    "     impact, trade developments, sustainability "
    "     initiatives, industry-event recaps. COMPANY: launches, "
    "     store / café openings, awards, anniversaries, packaging "
    "     changes, new product lines, founder press, instant-"
    "     coffee positioning. ('2025 Specialty Coffee Surpasses "
    "     Gold', 'Tulum Coffee Turns 2', 'Mumbai Coffee Festival "
    "     2025', 'Kruti Coffee Co-founder Awarded', 'Why Our "
    "     Coffee Prices Are Going Up', 'All About Our "
    "     Packaging'.)\n"
    "  7. NONE of the above SUBJECTS — `misc`. Genuine "
    "     leftovers: FAQs, 'buy coffee online' / SEO commerce "
    "     posts, used-grounds reuse hacks, primers / 'what is "
    "     X?' explainers that span multiple subjects without a "
    "     primary one, multi-topic listicles ('A Beginner's "
    "     Guide to Understanding Specialty Coffee', 'Top 20 "
    "     Most Asked Questions About Coffee', 'Where to Buy "
    "     Coffee Online', '7 Benefits of Buying Coffee Beans "
    "     Online'). LAST RESORT — exhaust the other 6 buckets "
    "     first.\n\n"
    "#### Tie-breakers\n"
    "  • Both `roast` and `brew` could fit (e.g. 'How to Brew "
    "    Dark Roast Coffee') → `roast` wins because it's the "
    "    sharper SUBJECT signal; brewing is the secondary topic.\n"
    "  • Both `origins` and `news` could fit (e.g. 'Why "
    "    Specialty Coffee from India Costs More') → pick by "
    "    what the article spends most of its words on. If the "
    "    body is about the bean / the region / the processing, "
    "    `origins`. If the body is about the market dynamic, "
    "    `news`.\n"
    "  • Both `taste` and `roast` could fit (e.g. 'How Roast "
    "    Levels Affect Coffee Flavor') → `roast` wins; the "
    "    flavor outcome is downstream of the roast subject.\n"
    "  • Both `lifestyle` and `news` could fit (e.g. 'How Cothas "
    "    Preserved Heritage in a Fast Coffee World') → pick by "
    "    SUBJECT. If the article frames the roaster's milestone, "
    "    `news`. If it frames coffee-as-cultural-ritual, "
    "    `lifestyle`.\n"
    "  • `misc` is a LAST RESORT, not a default — exhaust the "
    "    other 6 buckets before falling through.\n\n"
    "### Hero (`image_url`) — NEVER emit a logo\n"
    "Order of preference:\n"
    "  (a) Reject any candidate whose URL filename contains "
    "      `logo`, `favicon`, `wordmark`, `site-logo`, "
    "      `brand-logo`, `sitelogo`, `header`, or `icon`. The "
    "      roaster's brand mark is NOT this article's hero. Ever.\n"
    "  (b) Prefer body_images[0] when its alt/context shows it's "
    "      article-specific (a farm photo, brew shot, infographic "
    "      tied to the subject).\n"
    "  (c) Else use bundle.og_image — AFTER applying rule (a) to "
    "      its URL.\n"
    "  (d) Else return null. The reader collapses gracefully when "
    "      image_url is null. NULL is the right answer for "
    "      text-only articles whose only image is the roaster's "
    "      logo — better blank than a misleading brand mark on "
    "      every card.\n\n"
    "### body_html\n"
    "Allowed tags: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, "
    "<figure>, <figcaption>, <img>, <hr>, <video-embed src=\"...\" />, "
    "plus the editorial inline trio <a href=\"...\">, <strong>, <em>. "
    "Forbidden: <span>, <div>, <table>, <iframe>, <script>, and ALL "
    "class/id/style attributes. Preserve EVERY prose paragraph "
    "verbatim — do not summarize, do not drop. Same source bundle → "
    "same word_count (±1% from whitespace handling).\n"
    "  • Inline LINKS: every entry in DETECTED BODY LINKS must "
    "    appear verbatim in body_html as the same <a href=\"...\">"
    "anchor-text</a> markup. Same href, same anchor text. They "
    "    are the editorial cross-references the renderer surfaces "
    "    as embedded CoffeeCards / journal callouts. If the source "
    "    has additional inline <a> tags not in DETECTED BODY LINKS, "
    "    preserve those too. NEVER fabricate a link the source "
    "    didn't author.\n"
    "  • Inline EMPHASIS: <b>/<strong> → <strong>; <i>/<em> → <em>. "
    "    These carry editorial weight (section labels, key concepts, "
    "    quoted-phrase emphasis); dropping them flattens the read. "
    "    Don't add emphasis the source didn't have. Don't nest "
    "    redundantly.\n"
    "  • BARE-URL AUTO-LINKING: when prose mentions a URL in "
    "    plaintext (`www.kruticoffee.com`, `https://example.com`, "
    "    `coffeepro.com.hk`), wrap it as <a href=\"<canonical>\">"
    "<visible-text></a>. Canonicalise href: add `https://` if "
    "    missing, lowercase the host, keep the path verbatim. Keep "
    "    visible text exactly as the source wrote it. Common in "
    "    author bios + footnote-style references.\n"
    "  • VIDEO EMBEDS: for every URL in DETECTED VIDEOS, emit one "
    "    self-closing <video-embed src=\"<exact-url>\" /> block at "
    "    the position the source references that video. Placement "
    "    rules:\n"
    "      - Prose has a clear callout ('In this video Dr Das "
    "        shares...', 'Watch the harvest tour below') → place "
    "        immediately AFTER the callout paragraph.\n"
    "      - No callout in prose → place a single embed at the very "
    "        start of body_html, before the first <p>. Multi-video "
    "        articles with no callouts → stack at the start in "
    "        source order.\n"
    "    NEVER emit a video URL not in DETECTED VIDEOS. NEVER emit "
    "    <iframe> — that's still forbidden. NEVER emit children or "
    "    extra attributes on <video-embed>; it carries `src` only.\n"
    "Inline images become <figure><img src=\"https://absolute\" "
    "alt=\"...\">[<figcaption>caption-from-source-only</figcaption>]"
    "</figure> — NEVER fabricate caption text. Insert <hr> "
    "immediately before every <h2> as the ad-slot anchor "
    "(mechanical rule: hr count = h2 count). Drop chrome — nav, "
    "footer, sidebar, related posts, subscribe CTAs, comment forms, "
    "share buttons, author-bio cards.\n\n"
    "  • EDITORIAL POLISH in body prose — same as the title rule, "
    "    applied per-block. Sentence-start capitalisation "
    "    (lowercase letter after period/!/?/: or at block start → "
    "    uppercase). Inflection (same-stem, wrong-ending → fix: "
    "    'Ethically Sources' → 'Ethically Sourced'). Spelling NOT "
    "    in any major dictionary (Merriam-Webster, Oxford, "
    "    Collins, Macquarie — including informal/regional/slang "
    "    variants) → fix ('mitsake' → 'mistake'; 'recieve' → "
    "    'receive'). Leave informal-but-dictionary words alone "
    "    ('thru', 'tho', 'alright', 'gotta', 'colour'). NEVER "
    "    substitute vocabulary — 'sap', 'associate', 'top rate', "
    "    'come across', 'fidelity charge applications' all stay. "
    "    NEVER restructure sentences. Polish word forms, not word "
    "    choices.\n\n"
    "## COFFEE-RELEVANCE GATE — be GENEROUS, default true\n\n"
    "is_about_coffee=true if the article is ABOUT coffee in any "
    "meaningful way. ACCEPT all of:\n"
    "  • Sourcing, origin, harvest, processing\n"
    "  • Brewing, equipment, tasting\n"
    "  • Café culture, barista interviews\n"
    "  • Industry news, certifications, climate impact\n"
    "  • Company updates (launches, awards, milestones)\n"
    "  • Health/wellness ABOUT coffee (caffeine, benefits, effects)\n"
    "  • Lifestyle pieces where coffee IS the subject (food "
    "    pairings, morning rituals, coffee in poetry)\n"
    "  • Biodiversity / sustainability / shade-grown — central to "
    "    specialty sourcing\n"
    "  • Founder essays where the topic IS coffee (relationship "
    "    with coffee, origin reflections)\n\n"
    "REJECT (is_about_coffee=false) ONLY for genuinely off-topic:\n"
    "  • Founder/team biographies (a bio about a PERSON, not coffee)\n"
    "  • Spirituality / meditation / esoteric wellness unrelated "
    "    to coffee (Osho, Tibetan Pulsing, gong baths, generic "
    "    spiritual essays)\n"
    "  • Café-event recaps with no substantive coffee content (a "
    "    poetry night, a pet adoption drive)\n"
    "  • Shopify product-page boilerplate (page dominated by "
    "    'Taxes included' / 'Add to cart' / shipping chrome)\n"
    "  • Generic lifestyle/business/motivation that mentions "
    "    coffee in passing — test: would the article still make "
    "    sense if every mention of coffee were removed? if yes → "
    "    reject; if no → accept.\n\n"
    "When in doubt → ACCEPT. The downstream topic_category + tags "
    "give users the right filter; an over-strict gate just hides "
    "legitimate coffee content.\n\n"
    "## is_article gate\n"
    "Set is_article=false (and omit other fields) when the URL is "
    "not a real article: category landing, tag index, blog home, "
    "404 page, empty placeholder, product listing the scraper "
    "mis-classified. The scraper skips these without writing a row."
)


# ── Public entry point ─────────────────────────────────────────────────────


def enrich_article(
    *,
    url: str,
    page_text: str,
    og_title: Optional[str] = None,
    og_description: Optional[str] = None,
    og_image: Optional[str] = None,
    og_published_at: Optional[str] = None,
    detected_videos: Optional[list[dict]] = None,
    detected_links: Optional[list[dict]] = None,
    system_addendum: Optional[str] = None,
) -> Optional[dict]:
    """Run Haiku over a single fetched article page, return the
    structured payload. Returns None on any caller-tolerable failure
    (transient API error, missing key, parse failure) so the runner
    can fall back to bs4 extraction.

    `system_addendum` (Layer B) is a per-roaster site-quirk hint — a
    short addendum prepended to the static system prompt that tells
    Haiku about THIS roaster's conventions (footer noise the bs4
    strip missed, infographic-driven bodies, stale `<img src>` URL
    forms, etc.). The runner threads `roaster_profiles
    .article_enrichment_prompt_hint` through here.

    Raises `ArticleEnricherError` only for setup failures we want to
    surface upstream (no SDK installed) — the runner short-circuits
    those across the whole job rather than retrying per-article.
    """
    if not url or not page_text:
        return None

    if not os.environ.get("ANTHROPIC_API_KEY"):
        # Don't raise — articles can still be scraped + stored from
        # the bs4 fallback even without Haiku. The runner stamps
        # enrichment_status='pending' for downstream re-enrich.
        return None

    try:
        import anthropic
    except ImportError as e:
        raise ArticleEnricherError(
            "anthropic SDK isn't installed. `pip install anthropic` in "
            "the FastAPI server's Python env."
        ) from e

    truncated = page_text[:PAGE_TEXT_LIMIT]
    if len(page_text) > PAGE_TEXT_LIMIT:
        truncated = truncated + "\n\n[...truncated, full body continues...]"

    # DETECTED VIDEOS — surface every YouTube/Vimeo embed the scraper
    # found in the raw HTML so Haiku can place <video-embed> blocks
    # at the right body position. BS4 strips iframes from page_text,
    # so without this block Haiku has zero signal that the article
    # has a video and can't restore it. The list is canonical-URL
    # form (`https://youtu.be/ID` / `https://vimeo.com/ID`).
    if detected_videos:
        videos_block = "\n".join(
            f"  - {v['url']}  (platform={v['platform']}, "
            f"video_id={v['video_id']})"
            for v in detected_videos
        )
    else:
        videos_block = "  (none)"

    # DETECTED BODY LINKS — every inline <a href> the bs4 scraper
    # found inside the cleaned body. The body_html rule requires
    # preserving these as <a href=...>...</a>. The downstream
    # renderer matches each href against the in-app product +
    # article catalog and surfaces matches as embedded cards.
    if detected_links:
        links_block = "\n".join(
            f"  - <a href=\"{l['url']}\">{l['text']}</a>"
            for l in detected_links
        )
    else:
        links_block = "  (none)"

    user_content = (
        f"ARTICLE URL: {url}\n\n"
        f"OG:TITLE (hint): {og_title or '(none)'}\n"
        f"OG:DESCRIPTION (hint): {og_description or '(none)'}\n"
        f"OG:IMAGE (hint): {og_image or '(none)'}\n"
        f"OG:PUBLISHED_TIME (hint): {og_published_at or '(none)'}\n\n"
        f"DETECTED VIDEOS (embed each via <video-embed src=\"...\" /> "
        f"in body_html at the source-referenced position):\n"
        f"{videos_block}\n\n"
        f"DETECTED BODY LINKS (every one of these <a href> tags MUST "
        f"appear verbatim in body_html — anchor text exactly as "
        f"shown, href exactly as shown; these are the editorial "
        f"cross-references the renderer surfaces as embedded "
        f"CoffeeCards / journal callouts):\n"
        f"{links_block}\n\n"
        f"CLEANED PAGE TEXT (nav/header/footer/script stripped, "
        f"first {PAGE_TEXT_LIMIT} chars):\n"
        f"---\n{truncated}\n---"
    )

    # Site-quirk addendum prepended to the static system prompt as a
    # SECOND cacheable block — keeps the static base block hot across
    # all roasters and lets the per-roaster addendum land separately.
    if system_addendum and system_addendum.strip():
        system_param = [
            {
                "type": "text",
                "text": _ARTICLE_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": (
                    "SITE-SPECIFIC NOTES for this roaster (overrides "
                    "where they conflict with the base prompt):\n"
                    + system_addendum.strip()
                ),
            },
        ]
    else:
        system_param = _ARTICLE_SYSTEM

    # Routed through services.llm_router (SDK or queue per provider).
    # The queue path serialises `system_param` (list-with-cache_control
    # or string) to a joined string — cache_control is SDK-only.
    from services.llm_router import call_llm, LLMCallError
    try:
        payload = call_llm(
            step="article_enrich",
            system=system_param,
            tool=_ARTICLE_TOOL,
            user_content=user_content,
            max_tokens=MAX_TOKENS,
            model=MODEL,
            target_id=url,
        )
    except LLMCallError:
        # Transient — caller falls back to bs4 + stamps 'failed'.
        return None

    if isinstance(payload, dict):
        return _normalise(payload)
    return None


# ── Title polish (deterministic, post-Haiku) ───────────────────────────────
#
# Haiku returns the article title VERBATIM from the source. This pass
# applies sentence-case + clause-join colon insertion mechanically,
# with a proper-noun allowlist so place names / varietals / brand
# names / compound brew-method nouns keep their capitalisation.
#
# Why Python instead of Haiku: prompt-driven case rules kept producing
# vocabulary drift — Haiku's editorial reflex would rewrite odd
# author phrasing ("whole associate to top rate coffee") into
# fluent variants ("comprehensive guide to premium coffee") even
# when the prompt forbade it. Deterministic post-processing
# eliminates that surface entirely: vocabulary stays the author's,
# only mechanical case + punctuation changes.

# Canonical forms — these resolve to their authored case regardless
# of how the source rendered them. Multi-word entries are matched as
# atomic units; single-word entries by their lowercase key.
_TITLE_PROPER_NOUNS_MULTI = {
    "cold brew": "Cold Brew",
    "pour over": "Pour Over",
    "french press": "French Press",
    "moka pot": "Moka Pot",
    "single origin": "Single Origin",
    "flat white": "Flat White",
    "blue tokai": "Blue Tokai",
    "third wave": "Third Wave",
    "coffee culture": "Coffee Culture",
    "specialty coffee association": "Specialty Coffee Association",
}
_TITLE_PROPER_NOUNS_SINGLE = {
    # Places
    "india": "India", "indian": "Indian", "coorg": "Coorg",
    "ethiopia": "Ethiopia", "ethiopian": "Ethiopian",
    "chikmagalur": "Chikmagalur", "karnataka": "Karnataka",
    "brazil": "Brazil", "yemen": "Yemen", "colombia": "Colombia",
    "kenya": "Kenya", "rwanda": "Rwanda", "panama": "Panama",
    "vietnam": "Vietnam", "honduras": "Honduras", "guatemala": "Guatemala",
    "uganda": "Uganda", "kerala": "Kerala", "tamil": "Tamil", "nadu": "Nadu",
    "wayanad": "Wayanad", "araku": "Araku", "yercaud": "Yercaud",
    "bangalore": "Bangalore", "mumbai": "Mumbai", "delhi": "Delhi",
    # Varietals
    "arabica": "Arabica", "robusta": "Robusta", "liberica": "Liberica",
    "excelsa": "Excelsa", "bourbon": "Bourbon", "typica": "Typica",
    "geisha": "Geisha", "pacamara": "Pacamara", "catuai": "Catuai",
    "caturra": "Caturra", "sl28": "SL28", "sl34": "SL34", "sl9": "SL9",
    "cauvery": "Cauvery", "chandragiri": "Chandragiri",
    # Equipment brands
    "v60": "V60", "aeropress": "AeroPress", "chemex": "Chemex",
    "hario": "Hario", "moccamaster": "Moccamaster", "fellow": "Fellow",
    "baratza": "Baratza", "kalita": "Kalita", "timemore": "Timemore",
    "melitta": "Melitta",
    # Orgs / acronyms
    "sca": "SCA", "scaa": "SCAA", "scae": "SCAE", "ccri": "CCRI",
    # Roaster / café brand names (extend as needed)
    "caffena": "Caffena", "korebi": "Korebi", "subko": "Subko",
    "kruti": "Kruti", "nada": "Nada", "tulum": "Tulum", "chariot": "Chariot",
    "naivo": "Naivo", "coffeeverse": "Coffeeverse",
    # English convention
    "i": "I",
}

# Words that signal a clause break when capitalised mid-title. When
# the source has '<lowercase phrase> <Capitalised opener> <rest>', the
# polish inserts a colon: 'X From Y' → 'X: From Y'. The opener stays
# capitalised because it's now the first word of a new clause.
_TITLE_CLAUSE_OPENERS = frozenset({
    "from", "how", "why", "where", "when", "what", "which", "who",
    "discover", "learn", "find", "meet", "understand", "explore",
})


def _polish_title(title: Optional[str]) -> Optional[str]:
    """Apply sentence-case + colon insertion mechanically, with a
    proper-noun allowlist. Vocabulary is preserved verbatim — only
    case + (insertion of) punctuation changes."""
    if not title:
        return title
    s = title.strip()
    if not s:
        return None

    # Pass 1 — clause-join colon insertion. Scan for capitalised
    # clause-opener words (From, How, Why, etc.) appearing mid-title
    # (not as the first word). Insert a colon immediately before
    # them. Works for both sentence-case sources (where "From" is
    # stranded) and Title-Case sources (where "From" is among many
    # capitalised words).
    def _insert_clause_colons(text: str) -> str:
        out: list[str] = []
        last = 0
        for m in re.finditer(r"\b([A-Z][a-z]+)\b", text):
            cap_word = m.group(1)
            cap_pos = m.start()
            # Skip the first word of the title — it's the sentence
            # start and naturally capitalised.
            if cap_pos == 0:
                continue
            # The cap-word must be a known clause opener.
            if cap_word.lower() not in _TITLE_CLAUSE_OPENERS:
                continue
            # Skip if the cap-word starts a multi-word proper noun
            # (e.g. 'Pour' starting 'Pour Over'). Peek ahead.
            tail = text[m.end():]
            next_word = re.match(r"\s+(\w+)", tail)
            if next_word:
                pair = f"{cap_word} {next_word.group(1)}".lower()
                if pair in _TITLE_PROPER_NOUNS_MULTI:
                    continue
            # Skip if the preceding character is already punctuation
            # (colon, em-dash, comma, semicolon) — author already
            # delimited the clause.
            preceded = text[max(0, cap_pos - 2):cap_pos]
            if re.search(r"[:—–,;\-]\s*$", preceded):
                continue
            # Insert ': ' before the cap-word, consuming the
            # preceding whitespace.
            insert_at = cap_pos
            while insert_at > 0 and text[insert_at - 1] in " \t":
                insert_at -= 1
            out.append(text[last:insert_at])
            out.append(": ")
            last = cap_pos
        out.append(text[last:])
        return "".join(out)

    s = _insert_clause_colons(s)

    # Pass 2 — sentence-case. Split into "sentences" by walking
    # punctuation. Capitalise first word of each sentence; lowercase
    # subsequent content words unless they're proper nouns.
    # Sentence boundaries: ".", "!", "?", ":". After an em-dash or
    # comma the next word is NOT a sentence start (so it stays
    # lowercase unless a proper noun).

    # Tokenize into atoms (words + punctuation/whitespace runs)
    tokens = re.findall(r"\w[\w'-]*|\s+|[^\w\s]+", s, re.UNICODE)
    if not tokens:
        return s

    # First, replace any multi-word proper-noun runs with their
    # canonical form. We scan for known multi-word phrases.
    polished_tokens: list[str] = []
    i = 0
    sentence_start = True
    while i < len(tokens):
        tok = tokens[i]
        # Whitespace passthrough
        if re.fullmatch(r"\s+", tok):
            polished_tokens.append(tok)
            i += 1
            continue
        # Punctuation: passthrough, set sentence_start flag
        if re.fullmatch(r"[^\w\s]+", tok):
            polished_tokens.append(tok)
            # A sentence-ending punctuation resets the flag
            if any(c in tok for c in ".!?:"):
                sentence_start = True
            elif "—" in tok or "–" in tok or "-" in tok or "," in tok:
                # Em-dash, en-dash, hyphen, comma — NOT a sentence
                # start. Next word stays in the same sentence.
                sentence_start = False
            i += 1
            continue
        # Word token. Try multi-word proper-noun match first by
        # peeking ahead.
        matched_multi = None
        for n in (3, 2):  # try 3-word, then 2-word matches
            if i + (n - 1) * 2 >= len(tokens):
                continue
            # Build candidate: tok + space + next word + ...
            words = [tok]
            ok = True
            for j in range(1, n):
                idx = i + 2 * j
                if idx >= len(tokens):
                    ok = False
                    break
                # The intervening token must be whitespace
                if not re.fullmatch(r"\s+", tokens[idx - 1]):
                    ok = False
                    break
                if not re.fullmatch(r"\w[\w'-]*", tokens[idx]):
                    ok = False
                    break
                words.append(tokens[idx])
            if not ok:
                continue
            candidate = " ".join(words).lower()
            if candidate in _TITLE_PROPER_NOUNS_MULTI:
                matched_multi = (n, _TITLE_PROPER_NOUNS_MULTI[candidate])
                break
        if matched_multi:
            n, canon = matched_multi
            polished_tokens.append(canon)
            # Skip n words and their whitespace separators
            i += 2 * n - 1
            sentence_start = False
            continue
        # Single-word proper noun
        lower = tok.lower()
        if lower in _TITLE_PROPER_NOUNS_SINGLE:
            polished_tokens.append(_TITLE_PROPER_NOUNS_SINGLE[lower])
            sentence_start = False
            i += 1
            continue
        # Number tokens (preserve as written)
        if tok.isdigit():
            polished_tokens.append(tok)
            sentence_start = False
            i += 1
            continue
        # Plain word: lowercase unless sentence-start
        if sentence_start:
            # Capitalise first letter only; preserve internal case
            # for words like "iPhone" (rare in titles, but defensive)
            polished_tokens.append(tok[:1].upper() + tok[1:].lower())
        else:
            polished_tokens.append(lower)
        sentence_start = False
        i += 1

    return "".join(polished_tokens)


def _ensure_adslot_anchors(body_html: Optional[str]) -> Optional[str]:
    """Mechanical safety net for the 'hr count = h2 count' rule.
    Haiku is non-deterministic about adslot insertion (788 emitted
    0 <hr> on 11 <h2>s in a recent run). This pass guarantees an
    <hr> before every <h2> in body_html, deterministically, after
    Haiku returns. Existing <hr>s immediately preceding an <h2> are
    preserved; consecutive <hr>s get collapsed to one."""
    if not body_html:
        return body_html
    # Insert <hr> before every <h2 if there isn't already an <hr>
    # immediately preceding it (allowing optional whitespace).
    out = re.sub(
        r"(?<!<hr\s/>)(?<!<hr/>)(?<!<hr>)(\s*)<h2\b",
        lambda m: f"{m.group(1)}<hr><h2",
        body_html,
        flags=re.IGNORECASE,
    )
    # The lookbehind chain above only matches a few <hr> forms; do a
    # broader pass to handle "<hr />" with whitespace + trailing
    # newline between hr and h2. Find every <h2> and check the
    # preceding ~30 chars for an <hr>; if absent, prepend one.
    pieces: list[str] = []
    last = 0
    for m in re.finditer(r"<h2\b", out, re.IGNORECASE):
        prefix = out[max(0, m.start() - 40):m.start()]
        # Check if an <hr> appears in the immediate preceding window
        # with nothing between except whitespace.
        if not re.search(r"<hr\b[^>]*>\s*$", prefix, re.IGNORECASE):
            pieces.append(out[last:m.start()])
            pieces.append("<hr>")
            last = m.start()
        else:
            pieces.append(out[last:m.start()])
            last = m.start()
    pieces.append(out[last:])
    out = "".join(pieces)
    # Collapse runs of <hr> to a single <hr> (htmlToBlocks already
    # does this, but keeping the source clean avoids the parser
    # having to).
    out = re.sub(r"(?:<hr\b[^>]*>\s*){2,}", "<hr>", out, flags=re.IGNORECASE)
    return out


def _normalise(raw: dict) -> dict:
    """Coerce nullable string fields and clamp word_count."""
    out = {
        "is_article": bool(raw.get("is_article", True)),
        # is_about_coffee defaults to True so legacy callers that
        # haven't been updated still get a no-op gate. New runners
        # treat the field as authoritative.
        "is_about_coffee": bool(raw.get("is_about_coffee", True)),
        "topic_category": _clean_topic(raw.get("topic_category")),
        "tags": _clean_tags(raw.get("tags")),
        "title": _polish_title(_clean_str(raw.get("title"))),
        # excerpt added in v2 prompt (2026-05-09) — derived from
        # body's first sentence, NOT og:description (which is the
        # roaster's site description for most blogs and looked like
        # gutter when it duplicated across all of one roaster's
        # articles).
        "excerpt": _clean_str(raw.get("excerpt")),
        "body_html": _ensure_adslot_anchors(_clean_str(raw.get("body_html"))),
        "image_url": _clean_str(raw.get("image_url")),
        "published_at": _clean_str(raw.get("published_at")),
    }
    wc = raw.get("word_count")
    out["word_count"] = (
        max(0, int(wc)) if isinstance(wc, (int, float)) else None
    )
    return out


def _clean_topic(value) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    return v if v in TOPIC_CATEGORIES else None


def _clean_tags(value) -> list[str]:
    """Normalise the `tags` list — lowercase, strip leading '#',
    drop empties + the obvious noise tags, dedupe while preserving
    order, cap at 7. Always returns a list (possibly empty); never
    None — the caller stores it as a JSON array."""
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    noise = {"coffee", "specialty", "specialty-coffee", "india", "indian",
             "blog", "article", "post", "news"}
    for item in value:
        if not isinstance(item, str):
            continue
        v = _decode_string_escapes(item).strip().lstrip("#").lower()
        # Replace whitespace with hyphens for two-word tags.
        v = "-".join(v.split())
        if not v or v in seen or v in noise:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= 7:
            break
    return out


def _clean_str(value) -> Optional[str]:
    """Treat empty strings + the literal 'null'/'none' as None — a few
    Haiku turns return string sentinels instead of JSON null. Decode
    any literal `\\uXXXX` unicode escapes AND `\\'` / `\\"` / `\\/` /
    `\\\\` JS punctuation escapes Haiku passed through verbatim from a
    source CMS that exported string-escaped output into its HTML
    (Grey Soul, Caffena, occasional Coffeeverse) — see
    `_decode_string_escapes`.
    """
    if value is None:
        return None
    if isinstance(value, str):
        v = _decode_string_escapes(value).strip()
        if not v:
            return None
        if v.lower() in ("null", "none", "n/a", "(none)"):
            return None
        return v
    return str(value)
