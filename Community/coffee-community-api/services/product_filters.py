"""Two-stage product filter for v2 enrichment.

Per the user's directive: exclusion-only filtering is unbounded
("Blue Tokai may choose to sell live tickets to a BDSM gathering
and we're fucked"). Inclusion-grounded filtering BOUNDS the problem
because coffee beans have a specific, finite set of provenance
markers (roast level, processing method, origin region, varietal,
single-origin/blend language).

Stage 1 — URL/title exclusion (zero-cost, pre-fetch):
  Mirror of the existing `Scraper/scraper/filters.py:is_coffee_product`
  but lives in the API codebase so `uvicorn --reload` picks up
  every keyword tweak immediately. Drops bundles, samplers, gift
  sets, merch, equipment, capsules, instant, RTD, etc.

Stage 2 — Page-text inclusion (page-fetch cost, NO LLM):
  After fetching the page, require ≥`min_matches` distinct bean-
  specific markers in the cleaned page text. Real bean pages match
  5-15+ markers; non-bean pages (sweatshirts, brewers, workshops,
  blog posts) match 0-1. This is the inclusion gate that prevents
  the "infinite universe of not-bean" problem.

Both stages are cheap relative to a Haiku call (~$0.01 per Haiku
vs ~free for the filter), so the savings compound over a 90+ URL
catalog.
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse


# ── Stage 1: exclusion keywords (substring match on lowercased title) ──────


_HARD_EXCLUDE_TITLE: tuple[str, ...] = (
    # Equipment & accessories
    "grinder", "dripper", "mug", " cup", "cup ", "kettle", "filter paper",
    "paper filter",  # reverse word order — "Coffee Paper Filter" (Kafeido CAFEC)
    "scale", "tote", "carafe", "tumbler", "bottle", "frother",
    "french press", "moka pot", "aeropress", "chemex", "v60",
    "siphon", "percolator", "plunger", "portafilter", "tamper",
    "knock box", "brassware", "brass set", " maker",
    "ceramic", "stainless steel", "brewer", "kompresso", "cafflano",
    "wacaco", "minipresso", "espresso maker", "coffee maker",
    "espresso machine", "coffee machine", " machine",
    "pour-over kit", "brewing kit",
    # Kafeido equipment brands (added 2026-05-25)
    "tsubame", "abaca", "cafec", "arita ware",
    # Hand-grinder variants (the word "grinder" already catches, but
    # "Mill" used alone for grinders doesn't — Kafeido "Tsubame Mill").
    " mill", "hand mill", "burr mill",

    # Chocolate / confectionery / sweets
    "chocolate", "cocoa", "cacao",
    "truffle", "cookie", "biscuit", "brownie", "croissant",
    "cake", "pastry", "jaggery", "nibs", "morsels",

    # Ready-to-drink / liquid / cans / bottles
    "cold coffee", "iced coffee", "iced latte", "cold brew can",
    "cold brew bottle", "bottled cold brew", "rtd ", " rtd",
    "ready to drink", "ready-to-drink", "concentrate", "syrup",
    # Flavored cold brew = RTD beverage. Plain "cold brew" alone is
    # AMBIGUOUS (could be beans for cold brew) so we only catch
    # flavored/bottled forms here. Generic "cold brew" without can/
    # bottle context falls through to Stage 2 bean-marker check.
    "orange cold brew", "mint cold brew", "lemon cold brew",
    # Cold-brew bundles/packs that aren't bottled but still aren't
    # roasted beans (added 2026-05-26 — Sleepy Owl / Third Wave /
    # Rossette / 7000-steps shipped these as "Easy Cold Brew Filter
    # Coffee Pack" etc.).
    "cold brew packs", "easy cold brew", "cold brew blend",
    "cold-brew packs", "easy-cold-brew", "cold-brew blend",

    # Instant coffee
    "instant coffee", "instant ",

    # Brew bags / sachets / single-serve pre-portioned FORMATS.
    # Crema is a WHOLE-BEANS catalog — grind is a roaster fulfillment
    # option (a coffee offered ground / with a grind selector stays;
    # it's the bean), but single-serve BREW FORMATS are out of scope
    # regardless of whether they contain real coffee. This reverses the
    # 2026-05-27 "let Haiku decide on drip bags" call per the beans-only
    # directive (see NORTH_STAR.md §scope + repo CLAUDE.md).
    #
    # IMPORTANT — these match FORMATS, not grind. Bare "filter coffee" /
    # "South Indian filter" (a ground bean) is intentionally NOT here;
    # "drip filter(s)" (the single-serve drip cone/bag) IS. We also leave
    # out the ambiguous bare "coffee bag" (a roaster may call a bean bag
    # that) and bare "drip coffee" (a brew style).
    "easy bag", "easy brew", "easy pour", "hot brew bag",
    "cold brew bag", "cold brew pack",
    "dip bag", "drip bag", "drip-bag", "brew bag", "sachet",
    "drip pack", "drip-pack", "drip filter bag", "drip coffee bag",
    "drip filter", "drip-filter", "drip filters",
    "single serve", "single-serve", "on-the-go", "on the go",
    "pour-over bag", "pour over bag", "pour-over pack", "pour over pack",
    # Single-serve multi-count packs (e.g. Nandan "Pour Over- ...
    # (Pack of 10)") — a pack of N single-serve units is a FORMAT, not a
    # bean bag. Re-added 2026-05-29 (narrowly, explicit counts only) after
    # the is_coffee_bean prompt was flipped to treat single-serve pour-over
    # / drip packs as non-beans. Bare "pack of" stays OUT to avoid catching
    # legit multi-size bean bundles; only enumerated single-serve counts.
    "pack of 10", "pack of 6", "pack of 5", "pack of 12",
    "pack-of-10", "pack-of-6", "pack-of-5", "pack-of-12",
    # Kafeido GO-60 brand (single-serve drip-coffee filter cones,
    # equipment — added 2026-05-25 after they slipped past Stage 1).
    "go-60", "go 60",

    # Capsules / pods
    "capsule", "pod",

    # Non-coffee botanicals
    "matcha", "tea ", " tea", "chai",
    "lavender", "hibiscus", "chamomile", "turmeric",
    "mushroom coffee", "lion's mane",

    # Food items
    "almond ", "cashew", "trail mix", "salted ",

    # Apparel
    "sweatshirt", "t-shirt", "tshirt", "tee shirt", " tee ",
    "hoodie", "apparel", "beanie",
    "socks", "scarf", "bandana",

    # Paper goods / books / journals
    "brew book", "log book", "logbook", "journal", "notebook",
    "diary", "planner", "guidebook", "recipe book", "cookbook",
    "coffee book", "art print", "poster",
    "paperback", "hardcover", "(paperback)", "(hardcover)",

    # Wholesale / bulk-pack tiers — Crema is a consumer-facing
    # catalog, not a B2B procurement surface. Devans 2026-05-25
    # shipped an "Arabica French Roast Coffee - Whole Sale" 10kg
    # SKU at ₹17500 that survived Stage 1.
    "wholesale", "whole sale", "whole-sale", "bulk pack",
    "bulk order", "10kg", "10 kg", "5kg pack", "5 kg pack",

    # Gifts / bundles / samplers — Crema policy: never adopt a
    # roaster's bundling strategy as catalog entries.
    "gift card", "hamper", "merchandise", "gift box", "gift set",
    "coffee gift", "gift pack", "box of comfort", "box of love",
    "assorted 6", "6-pack", "6 pack",
    "sampler", "sample pack", "sample set", "sample packet",
    "starter pack", "starter kit",
    "trial pack", "pick & mix", "pick and mix", "steal deal",
    "tasting pack", "tasting box", "tasting set",
    "discovery box", "discovery pack", "discovery duo",
    " combo", "combo ", "bundle", "assorted box",
    # NOTE: bare "pack of" was REMOVED 2026-05-27. It conflicted
    # with the Haiku prompt's "single-serve pour-over bags are
    # coffee" rule — Nandan's "Lil'More Pour Over- Light Roast
    # (Pack of 10)" is legitimate roasted coffee that this keyword
    # was over-rejecting. Multi-coffee bundles are caught by the
    # specific keywords above (sampler/trio/duo/combo/etc.) AND by
    # Haiku's `is_single_coffee_sku` check downstream.
    # Multi-bean tasting bundles by shape.
    "trio pack", "duo pack", "quad pack", "explorer pack",
    "tasting trio", "tasting duo", "trio set", "duo set",
    "blend duo", "blend trio",  # caarabi "Specialty Blend Duo"
    "taster pack",              # bombay-island "Dark Roast Taster Pack"
    "dip-n-sip", "dipnsip", "dip n sip",  # caffena
    "drip kit", "drip-kit",     # savorworks "Coffee Drip Kit"
    "5-in-1", "4-in-1", "3-in-1", "2-in-1",
    "5 in 1", "4 in 1", "3 in 1", "2 in 1",

    # Storage
    "canister", "storage jar",

    # Subscriptions / experiences / events / stays
    "subscription", "experience", "workshop", "tour",
    "private stay", "sharing room", "hotel", "accommodation",
    "event", "ticket", "course", "masterclass",
    "training", "cupping session",
    # Placeholder / pre-launch product pages (added 2026-05-26 after
    # 7-elements landed an "On The Horizon" stub in the catalog).
    "coming soon", "launching soon", "on the horizon", "in the works",
    "pre-launch", "pre launch", "tba", "to be announced",

    # Chocolate-bar patterns (no "chocolate" in name)
    "dark/milk", "milk/white", "% white",

    # Flavored drinks
    "french vanilla", "vanilla flavour",

    # Cascara (dried cherry husks)
    "cascara", "coffee cherry husk",

    # Unroasted green coffee — we only carry roasted beans
    "green coffee", "green beans", "unroasted",

    # Listing / category / collection pages (added 2026-05-25 after
    # aromasofcoorg.com/shop/ and curiouslifecoffee.com/category/coffee/
    # slipped into the product discovery queue 4x). These slugs are
    # NEVER product detail pages; they're storefront listings or
    # taxonomy archives. Catch them at the slug-derived title level.
    "/shop/", "/shop ", "shop ", " shop",
    "/collections/", "/collections ", "collections ", " collections",
    "/category/", "/category ", "category ", " category",
    "/tag/", "/tag ", " tag",
    "/blog-page/", "/blog ", " blog",
    "/page/", " page ",

    # Single-noun spice products (added 2026-05-25 after Agastya's
    # storefront emitted cardamom / cloves / peppercorn / golden milk
    # as "product" rows). Crema policy: catalog is roasted coffee
    # beans only — spices, dairy adjuncts, weight-loss powders all
    # out.
    "cardamom", "elaichi", "elachi",
    "cloves", "lavang",
    "peppercorn", "black pepper", "white pepper",
    "cinnamon", "dalchini",
    "ginger ", " ginger",
    "mustard", "fennel", "saunf",
    "golden milk", "haldi milk",
    "biryani", "garam masala", "spice blend",
    "weight loss", "weight-loss",
)


_HARD_EXCLUDE_TYPE: frozenset[str] = frozenset({
    "equipment", "merchandise", "accessory", "accessories",
    "gift", "gifting", "apparel", "drinkware", "tool", "tools",
    "book", "stationery",
})


_HARD_EXCLUDE_TAGS: frozenset[str] = frozenset()


# ── Beans-only scope markers (single source of truth for the audit) ──────────
#
# Crema is a WHOLE-BEANS catalog: grind is a roaster fulfillment option
# (a coffee offered ground / with a grind selector is still the bean and
# stays), but single-serve BREW FORMATS and non-bean products are out of
# scope. These markers are the FORMAT subset of `_HARD_EXCLUDE_TITLE` and
# are what `crema_catalog_quality_audit.non_bean_format` counts, so the
# audit measures exactly the scope the Stage-1 filter enforces. NOT grind
# terms — bare "filter"/"ground"/"espresso" are deliberately absent.
NON_BEAN_FORMAT_MARKERS: tuple[str, ...] = (
    # Drip / pour-over / brew-bag single-serve FORMATS. Kept in sync with
    # the FORMAT subset of _HARD_EXCLUDE_TITLE above so the audit counts
    # exactly what Stage-1 rejects. (2026-05-29: added pourtable / pourover
    # / pour-over box / drip-kit / easy-* / go-60 / k-cup — these were in
    # _HARD_EXCLUDE_TITLE but missing here, so subko "Pourtable Pourover"
    # leaked past the audit's non_bean_format counter while Stage-1 would
    # have rejected it on re-enrich.)
    "drip bag", "drip-bag", "dip bag", "brew bag", "drip pack", "drip-pack",
    "drip filter", "drip-filter", "drip filters", "drip filter bag",
    "drip coffee bag", "drip kit", "drip-kit", "sachet",
    "single serve", "single-serve", "single-serve sachet",
    "single serve sachet",
    "pour over bag", "pour-over bag", "pour over pack", "pour-over pack",
    "pour over box", "pour-over box", "pourover box", "pourover", "pourtable",
    "easy bag", "easy brew", "easy pour", "easy-pour",
    "hot brew bag", "cold brew bag", "cold brew pack", "go-60", "go 60",
    "pack of 10", "pack of 6", "pack of 5", "pack of 12",
    "pack-of-10", "pack-of-6", "pack-of-5", "pack-of-12",
    # Capsules / pods / instant.
    "capsule", "nespresso", "k-cup", "k cup", "pod pack", "coffee pods",
    "instant coffee", "instant-coffee",
    # Ready-to-drink.
    "cold brew bottle", "cold brew can", "cold brew concentrate",
    "nitro cold brew", "ready to drink", "ready-to-drink",
)


def is_non_bean_format(title) -> bool:
    """True when a product title denotes a single-serve / non-bean FORMAT
    (drip bag, drip filter, sachet, capsule, pod, instant, RTD) rather than
    a bag of beans. Used by the beans-only scope audit. Targets FORMAT, not
    grind — "South Indian Filter Coffee" / "Gachatha AA Filter" are beans
    and return False; "Drip Filters - Kent Microlot" returns True."""
    if not title:
        return False
    t = str(title).lower()
    return any(m in t for m in NON_BEAN_FORMAT_MARKERS)


# Body-text FORMAT phrases. Unambiguous single-serve / brew-bag
# constructions that appear in the prose of an actual non-bean-format
# product page but never on a whole-bean listing. Deliberately
# MULTI-WORD and specific — NOT bare "drip" / "bag" / "pour over" /
# "sachet" — so a bean page that merely cross-sells a brew method or
# mentions "a single cup" is never rejected. These catch FORMATS whose
# marker was stripped from the catalog coffee_name on a prior enrich and
# now survives only in body prose (e.g. ARAKU "Pocket Brew" lists "10
# single-serve drip bag sachets" in the body while the title is just
# "Pocket Brew - Selection"). (2026-05-29)
_NON_BEAN_FORMAT_TEXT_PHRASES: tuple[str, ...] = (
    "single-serve drip bag", "single serve drip bag",
    "single-serve pour over", "single serve pour over",
    "single-serve pour-over", "single serve pour-over",
    "drip bag sachet", "drip-bag sachet",
    "pour over sachet", "pour-over sachet", "pourover sachet",
    "brew bag sachet",
    # Single-serve product-DECLARATION prose (added to Stage-2a 2026-05-30,
    # Class G — re-enrich stability). These also live in the strict DESC set;
    # adding them here closes the re-enrich gap where a single-serve's weight
    # flips OUT of the economic range (dripface staged 120 g then re-enriched
    # to 12 g — at 120 g the ≤15 g economic gate misses, so Stage-2a needs a
    # text catch). Product-declaration / bag-opening phrases only, so a real
    # bean's brewing recipe never trips them (verified motley-safe in Class A).
    "pocket brew",
    "tear the filter bag", "tear the top of the filter",
    "remove the bag and enjoy",
    # NOTE (2026-05-30, Class A): bare "cold brew bag" / "hot brew bag"
    # were REMOVED. They are recipe-TOOL nouns, not product declarations —
    # a real whole-bean listing routinely says "Steep coffee in a cold brew
    # bag or a muslin cloth" in its brewing recipe (motley-brew "Arabica
    # Honey Sun Dried Giri", a real 200 g single-origin), so matching them
    # on the fetched body would filter_reject a real bean on its next
    # re-enrich. Genuine cold-brew-BAG products are still caught by the
    # economic gate (≤ 15 g / ≥ 15 ₹/g), Stage-1 title markers ("cold brew
    # packs" / "pack of N"), and the "…sachet" phrases above. Keep this set
    # to product-SELF-DECLARATION phrases only.
)


# Stored-DESCRIPTION FORMAT phrases (2026-05-30, Class A). A STRICTER
# cousin of `_NON_BEAN_FORMAT_TEXT_PHRASES`, used against a product's
# full saved `description_raw` (sweep + audit) rather than the cleaned
# Stage-2 page text. The distinction matters: a real whole-bean listing
# routinely embeds a BREWING RECIPE that mentions brew TOOLS — motley-brew
# "Arabica Honey Sun Dried Giri Coffee" (a real 200 g single-origin) says
# "Steep coffee in a cold brew bag or a muslin cloth". So bare recipe-tool
# nouns ("cold brew bag", "hot brew bag") are EXCLUDED here — they're
# brew-method mentions, not product declarations, and would filter_reject
# a real bean. Only phrases a listing uses to declare the PRODUCT ITSELF
# is a single-serve survive: "single-serve" + format, "pocket brew", or a
# bag-OPENING instruction ("tear the filter bag") that only makes sense if
# the product is the bag. ninetytwo "Riverside Estate" ("Our single-serve
# drip bags let you enjoy …", 120 g — too heavy for the ₹/g detector) is
# the case this catches that the economic gate alone misses.
_NON_BEAN_FORMAT_DESC_PHRASES: tuple[str, ...] = (
    "single-serve drip bag", "single serve drip bag",
    "single-serve pour over", "single serve pour over",
    "single-serve pour-over", "single serve pour-over",
    "single-serve sachet", "single serve sachet",
    "pocket brew",
    "tear the filter bag", "tear the top of the filter",
    "remove the bag and enjoy",
)


def is_non_bean_format_desc(text) -> Optional[str]:
    """Return the matched product-declaration FORMAT phrase if a product's
    stored `description_raw` shows the PRODUCT ITSELF is a single-serve
    format, else None. Stricter than `is_non_bean_format_text`: it omits
    recipe-tool nouns (e.g. "cold brew bag") that a real whole-bean
    listing legitimately mentions inside a brewing recipe, so it gates
    FORMAT, not a bean that merely explains how to cold-brew it."""
    if not text:
        return None
    t = str(text).lower()
    for p in _NON_BEAN_FORMAT_DESC_PHRASES:
        if p in t:
            return p
    return None


def is_non_bean_format_text(text) -> Optional[str]:
    """Return the matched FORMAT phrase if the page BODY describes a
    single-serve / brew-bag FORMAT, else None.

    Stage-2 companion to `is_non_bean_format(title)`: catches formats
    whose marker was cleaned out of the catalog coffee_name and survives
    only in body prose. CONSERVATIVE by design — matches only unambiguous
    multi-word constructions (e.g. 'single-serve drip bag sachets') that a
    whole-bean listing never contains, so it gates FORMAT, not grind, and
    never rejects a real bean SKU that happens to mention a brew style."""
    if not text:
        return None
    t = str(text).lower()
    for p in _NON_BEAN_FORMAT_TEXT_PHRASES:
        if p in t:
            return p
    return None


# Single-serve economic signature (2026-05-30, Class A). The text/URL/slug
# matchers above miss single-serves whose FORMAT marker never reaches the
# coffee_name, the URL slug, OR the body prose — e.g. roast-coffee "Monsoon
# Malabar" (pure bean name, slug 'ep-monsoon-malabar', description_raw NULL).
# What gives those away is their ECONOMICS: a 5-12 g pre-portioned bag at a
# per-cup price reads as ₹25-108 / g — literally the most expensive per gram
# in the catalog, far above any whole bean. Real specialty beans ship at
# 50 g minimum (the smallest legit format seen is a 50 g teaspoon-card
# sample) and sit at ~₹0.6-8 / g, so the (weight ≤ 15 g AND ₹/g ≥ 15) box
# contains ONLY single-serve formats. This is the detector lesson 94 calls
# the near-perfect Stage-2 gate; the ₹/g audit self-flags the same rows.
_SINGLE_SERVE_MAX_GRAMS: int = 15
_SINGLE_SERVE_MIN_INR_PER_G: float = 15.0


def is_single_serve_by_economics(
    weight_grams,
    price_inr,
    *,
    max_grams: int = _SINGLE_SERVE_MAX_GRAMS,
    min_inr_per_g: float = _SINGLE_SERVE_MIN_INR_PER_G,
) -> bool:
    """True when a row's weight + price form the single-serve economic
    signature: a tiny pre-portioned bag (≤ `max_grams` g) priced at a
    per-cup rate (≥ `min_inr_per_g` ₹/g). Both conditions are required —
    the weight bound alone would be enough in practice (no whole-bean bag
    is ≤ 15 g) but the ₹/g floor guards against a stray mis-extracted
    weight on a genuinely cheap item. Returns False on missing/zero/
    negative weight or price (can't compute → don't reject)."""
    try:
        w = float(weight_grams)
        p = float(price_inr)
    except (TypeError, ValueError):
        return False
    if w <= 0 or p <= 0 or w > max_grams:
        return False
    return (p / w) >= min_inr_per_g


# ── Multi-coffee BUNDLE detection (Class B, 2026-05-30) ──────────────────────
#
# A bundle (gift box / curated set / duo / combo of ≥2 DISTINCT coffees, each
# in its own bag) is coffee but NOT a single purchasable bean SKU, so it's out
# of scope — same beans-only principle as formats. The Haiku `is_coffee_bean`
# gate conflates "is this coffee?" (yes) with "is this ONE bean SKU?" (no),
# and the "lean TRUE for coffee" pressure wins, so multi-coffee boxes leak in.
# The root fix is the model emitting `distinct_coffee_count` (see
# canonical_entity); this deterministic detector is the belt that flips the
# already-leaked rows and backstops the write path.
#
# THE BLEND-vs-BUNDLE TRAP (the precision crux — cf. Class A's recipe-vs-
# product trap): a BLEND mixes two coffees into ONE bag (a single SKU — KEEP),
# a BUNDLE packages them SEPARATELY (two SKUs — REJECT). Both prose say "two
# coffees", so a bare count is NOT enough — it would filter_reject real
# blends. We key only on SEPARATION structure the model writes for bundles and
# never for a blend: "includes/set of/pairing of N coffees", "N-coffee set",
# "combo pack" / "experience duo", "100g x N packs", "tasted side by side".
_BUNDLE_TEXT_PATTERNS: tuple[str, ...] = (
    # "includes (3 coffees)", "featuring three distinct coffees", "set of
    # three light-roasted coffees", "pairing of two barrel-aged coffees".
    # A trigger verb/noun of SEPARATION + a count + a coffee noun. A blend
    # says "blend OF two coffees" — 'blend' is deliberately NOT a trigger.
    r"\b(?:includes?|featuring|set\s+of|box\s+of|pairing\s+of|"
    r"collection\s+of|selection\s+of|duo\s+of|trio\s+of)\s+"
    r"\(?(?:two|three|four|five|six|\d+)\)?\s+"
    r"(?:[\w-]+\s+){0,3}(?:coffees|beans|blends|roasts|barrel)",
    # "3-coffee" / "2-coffee" HYPHENATED compound ("3-coffee curated set")
    # — but NOT "3-coffee blend" (one SKU) nor "...-coffee bean/maker". The
    # hyphen is load-bearing: a SPACE form ("795 coffee", "2025 coffee",
    # "9 coffees") matches varietals / years / counts on real single-origins,
    # so only the compound hyphen form counts.
    r"\b\d+-coffee(?:s)?\b(?!\s*(?:blend|bean|maker|machine|grinder|press))",
    # "curated set / collection / box / trio / duo / flight".
    r"\bcurated\s+(?:set|collection|box|trio|duo|flight)\b",
    # Explicit bundle nouns the merchant/model uses for separate-bag combos.
    # ("gift box" deliberately omitted — already a Stage-1 title token, and
    # a single premium bean can ship "in a gift box"; keep this set to nouns
    # that only a multi-coffee combo carries.)
    r"\b(?:combo\s+pack|two[- ]bag\s+combo|experience\s+(?:box|duo)|"
    r"tasting\s+flight|coffee\s+sampler)\b",
    # "made to be tasted side by side" — comparing multiple coffees. (Only
    # compare/taste/brew verbs — NOT 'enjoy', which a single bean uses.)
    r"\b(?:tasted?|brew(?:ed)?|compared?|tasting)\s+"
    r"(?:them\s+|these\s+)?side[\- ]by[\- ]side\b",
)
_BUNDLE_TEXT_RE = re.compile("|".join(_BUNDLE_TEXT_PATTERNS), re.IGNORECASE)


def is_multi_coffee_bundle(
    coffee_name=None,
    *,
    url: Optional[str] = None,
    description=None,
    blurb=None,
    tasting_notes=None,
) -> Optional[str]:
    """Return a short reason if this row is a MULTI-COFFEE bundle (≥2 distinct
    coffees in separate bags — gift box / curated set / duo / combo) rather
    than a single bean SKU, else None.

    Reads the enriched prose (name + blurb + tasting_notes + description)
    because the model ALWAYS describes the bundle in its own words even when
    the cleaned title doesn't — black-poetry "Java Joy Box" enriched to "a
    curated gift box featuring three distinct coffees". High precision by
    design: it keys on SEPARATION structure that a single-bag BLEND never
    uses, so a real blend ("a blend of two coffees", one SKU) is never
    rejected."""
    blob = " ".join(
        str(x) for x in (coffee_name, blurb, tasting_notes, description) if x
    )
    if blob:
        m = _BUNDLE_TEXT_RE.search(blob)
        if m:
            return f"bundle-text:{m.group(0).strip().lower()[:40]!r}"
    # NOTE: a URL "two coffee-token" heuristic was tried and REMOVED — Indian
    # roasters repeat "coffee" in SEO-heavy slugs ("rum-barrel-aged-coffee-
    # for-black-coffee", "filter-coffee-100-coffee"), so it false-flagged many
    # real single beans. The collapsed-enrich combo (93-degrees, whose
    # re-enrich overwrote the bundle prose into a single-origin row) has no
    # safe deterministic text signal left — it's caught by the model emitting
    # distinct_coffee_count on the WRITE path (see canonical_entity), not here.
    return None


# ── Stage 2: bean-inclusion markers (substring match on lowercased page text) ─
#
# Curated to be SPECIFIC to coffee bean product pages. Each marker is
# a substring that almost only appears on a real bean SKU. Categorized
# so we can require coverage across categories (real beans signal
# across multiple axes).


_BEAN_MARKERS_ROAST: tuple[str, ...] = (
    "light roast", "medium roast", "dark roast",
    "medium-dark", "medium dark", "medium-light", "medium light",
    "vienna roast", "vienna", "french roast", "city roast",
    "full city", "italian roast", "filter roast", "espresso roast",
    "light-medium", "medium-dark roast",
)


_BEAN_MARKERS_PROCESS: tuple[str, ...] = (
    "washed process", "natural process", "honey process",
    "anaerobic", "semi-washed", "semi washed",
    "monsoon malabar", "lactic fermented", "pulped natural",
    "carbonic maceration", "double fermented", "yeast inoculated",
    "barrel aged", "barrel-aged", "wet-hulled", "giling basah",
)


_BEAN_MARKERS_ORIGIN_INDIAN: tuple[str, ...] = (
    "chikmagalur", "chikkamagaluru", "coorg", "kodagu",
    "wayanad", "araku valley", "araku", "kalpetta", "bababudan",
    "baba budan", "sakleshpur", "manjarabad", "biligiri",
    "nilgiri", "br hills", "yercaud", "shevaroy",
)


_BEAN_MARKERS_ORIGIN_GLOBAL: tuple[str, ...] = (
    "ethiopia", "ethiopian", "colombia", "colombian",
    "kenya", "kenyan", "rwanda", "rwandan", "yemen",
    "panama", "panamanian", "brazil", "brazilian",
    "guatemala", "guatemalan", "costa rica", "costa rican",
    "indonesia", "indonesian", "sumatra", "java", "papua",
    "mexico", "mexican", "el salvador", "honduras",
    "tanzania", "uganda", "burundi", "yirgacheffe",
    "sidamo", "harrar", "tarrazu", "huila", "antioquia",
)


_BEAN_MARKERS_VARIETAL: tuple[str, ...] = (
    "arabica", "robusta", "liberica", "excelsa",
    "sln 9", "sln 795", "sln 274", "sln9", "sln795", "sln274",
    "selection 9", "selection 5b", "selection 274",
    "s 795", "s795", "s 274", "s274", "s5b",
    "chandragiri", "cauvery", "bourbon", "geisha", "gesha",
    "peaberry", "catimor", "sarchimor", "catuai", "kent",
    "typica", "caturra", "hemavathi", "hibrido de timor",
    "tafarikela",
)


_BEAN_MARKERS_SHAPE: tuple[str, ...] = (
    "single origin", "single-origin", "single estate",
    "single-estate", "microlot", "micro lot", "micro-lot",
    "whole bean", "whole-bean", "ground coffee",
    "coffee bean", "coffee beans", "freshly roasted",
    "roast date", "roasted on", "speciality coffee",
    "specialty coffee", "specialty arabica",
    " estate", " plantation",
)


_BEAN_MARKER_CATEGORIES: dict[str, tuple[str, ...]] = {
    "roast": _BEAN_MARKERS_ROAST,
    "process": _BEAN_MARKERS_PROCESS,
    "origin_indian": _BEAN_MARKERS_ORIGIN_INDIAN,
    "origin_global": _BEAN_MARKERS_ORIGIN_GLOBAL,
    "varietal": _BEAN_MARKERS_VARIETAL,
    "shape": _BEAN_MARKERS_SHAPE,
}


# ── Helpers ────────────────────────────────────────────────────────────────


def _tag_to_str(tag) -> str:
    if isinstance(tag, dict):
        return tag.get("name") or tag.get("slug") or ""
    return str(tag) if tag else ""


def _chocolate_is_tasting_note(title_l: str) -> bool:
    import re
    if re.search(r"\d+%.*chocolate", title_l):
        return False
    if re.search(r"roast.*-.*chocolate", title_l):
        return True
    if re.search(r",\s*(?:dark\s+)?chocolate", title_l):
        return True
    if re.search(r"chocolate\s*[,&]", title_l):
        return True
    return False


def _derive_title_from_url(url: str) -> str:
    """Fallback when augmenter title isn't available — derive from the
    URL slug so we can still match exclusion keywords like
    'sample-pack' → 'sample pack'."""
    try:
        path = urlparse(url).path
    except Exception:
        return ""
    slug = path.rstrip("/").rsplit("/", 1)[-1]
    return slug.replace("-", " ").replace("_", " ")


# Listing-page URL fragments (added 2026-05-25). The derived title
# strips slashes so a URL like /shop/ becomes the slug "shop" — which
# is too short / too common to keyword-match safely. Instead, match
# the URL PATH directly for these segments. Any URL whose path
# contains one of these fragments is a listing / archive / category
# page, never a product detail page.
_LISTING_PATH_FRAGMENTS: tuple[str, ...] = (
    "/shop/", "/shop?",
    "/collections/", "/collections?",
    "/category/", "/category?",
    "/categories/", "/categories?",
    "/tag/", "/tags/",
    "/blog-page/", "/blog/page/",
    "/page/",
    "/archive/", "/archives/",
    # Category-style sub-paths that surface as bare listing URLs in
    # the discovery queue (added 2026-05-26 — curious-life shipped a
    # /category/coffee/ collection root as a "product", 7-elements
    # placeholder pages live under /coffee/, and brewing-equipment /
    # master-classes are listing pages by definition).
    "/brewing-equipment/", "/master-classes/", "/masterclasses/",
    "/our-coffees/", "/our-coffee/",
)


def _has_listing_path_fragment(url: str) -> Optional[str]:
    """Return the matching listing fragment if `url`'s path is a
    listing/archive page; None otherwise. Tail-end `/shop` (no
    trailing slash) also counts since some stores serve the shop
    root that way."""
    try:
        parsed = urlparse(url)
    except Exception:
        return None
    path = (parsed.path or "").lower()
    # A product DETAIL page is never a listing, even when it lives under
    # a collection path. Shopify serves products at
    # /collections/<x>/products/<handle> and WooCommerce at
    # /product/<handle>; the /product(s)/<handle> segment is the
    # authoritative product marker. Without this guard the "/collections/"
    # fragment wrongly flags every real bean on stores that nest products
    # under a collection (caarabi, humble-express, el-bueno, kruti — all
    # whole-bean catalogs). Bare /collections/<x> (no /products/<handle>)
    # still falls through to the listing checks below.
    import re as _re
    # /products/<handle> or /product/<handle> = product detail. Also a
    # bare UUID segment is a product detail — custom storefronts like
    # Vithai serve each bean at /shop/<uuid> (no /products/ segment), so
    # the "/shop/" fragment would otherwise nuke their whole catalog.
    if _re.search(r"/products?/[^/?#]+", path) or _re.search(
        r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        path,
    ):
        return None
    for frag in _LISTING_PATH_FRAGMENTS:
        if frag in path:
            return frag
    # Exact-end matches without trailing slash: /shop, /collections.
    for tail in ("/shop", "/collections", "/category", "/tag",
                 "/blog", "/blog-page", "/archive", "/archives",
                 # Category-root tails (added 2026-05-26). Bare
                 # /coffee/ / /our-coffee/ / /menu/ at the end of a
                 # path is a category root, never a product page —
                 # real product URLs would be /coffee/<slug>/.
                 "/coffee", "/our-coffee", "/our-coffees", "/menu",
                 "/brewing-equipment", "/master-classes",
                 "/masterclasses"):
        if path.rstrip("/").endswith(tail):
            return tail
    return None


# ── Public API ─────────────────────────────────────────────────────────────


def is_url_excluded(
    url: str,
    *,
    title: Optional[str] = None,
    tags: Optional[list] = None,
    product_type: Optional[str] = None,
) -> tuple[bool, str]:
    """Stage 1: URL/title exclusion. Returns (excluded, reason).

    Uses augmenter title + tags + product_type when present; falls
    back to URL slug otherwise. Designed for catalog-scale catalogs
    where most URLs are obvious matches one way or the other.
    """
    effective_title = (title or "") or _derive_title_from_url(url)
    title_l = effective_title.lower()
    type_l = (product_type or "").lower()
    tags_l = [_tag_to_str(t).lower() for t in (tags or [])]

    # URL-path listing check (added 2026-05-25). Catches /shop/, /
    # collections/, /category/coffee/, /tag/, /blog/ etc. that the
    # derived-from-slug title alone can't catch (the slug-derivation
    # strips slashes so a URL like /shop/ becomes the single word
    # "shop" — too short / common to keyword-match safely).
    listing_frag = _has_listing_path_fragment(url)
    if listing_frag is not None:
        return True, f"exclude:url-listing={listing_frag!r}"

    # Non-bean FORMAT markers in the URL SLUG. On a re-enrich the
    # `title` arg is the augmenter/catalog name, which may already have
    # had the format word stripped on a prior enrich ("Single Serve Pour
    # Over - L'lmore" → "L'lmore"); the slug retains it
    # ("serve-pour-over-bag-..."). Re-derive the slug words (hyphens →
    # spaces) and test the FORMAT subset specifically — these are
    # unambiguous single-serve / brew-bag formats, never grind terms, so
    # a slug match never false-positives on a real bean SKU. Checked
    # independently of the title so a cleaned title can't mask it.
    # (2026-05-29)
    slug_words = _derive_title_from_url(url).lower()
    if slug_words:
        # Format words that, if present in the TITLE, confirm a genuine
        # single-serve format (so a URL-slug marker is trustworthy).
        _title_fmt_words = (
            "pour over", "pour-over", "pourover", "drip", "sachet",
            "instant", "capsule", " pod", "brew bag", "pack of",
            "box of", "k-cup", "k cup",
        )
        for kw in NON_BEAN_FORMAT_MARKERS:
            if kw in slug_words:
                # Coincidental brand-slug guard (2026-05-30): when a
                # format marker appears ONLY in the URL slug (NOT the
                # title) AND the title reads as a real bean (carries a
                # bean marker and has no format word of its own), the
                # slug is a generic roaster URL, not a single-serve
                # format — spare it. Without this, a real bean is
                # wrongly filter_rejected: world-of-coffee "Yellow Honey
                # Sun Dried Robusta 250g" lives at the brand-generic URL
                # '.../products/world-of-coffee-drip-bag' and matched
                # 'drip bag'. The title-format-word check keeps genuine
                # formats excluded (Nandan "Royale Pour Over (Pack of
                # 10)" → title has 'pour over'; agastya drip-filters →
                # title has no bean marker), so this only relaxes the
                # coincidental-slug case.
                if (kw not in title_l
                        and has_bean_markers(
                            title_l, min_total=1, min_categories=1)[0]
                        and not any(w in title_l
                                    for w in _title_fmt_words)):
                    continue
                return True, f"exclude:format-url={kw!r}"

    for kw in _HARD_EXCLUDE_TITLE:
        if kw in title_l:
            if kw == "chocolate" and _chocolate_is_tasting_note(title_l):
                continue
            snippet = (effective_title or "(no title)")[:60]
            return True, f"exclude:{kw!r} in {snippet!r}"

    for kw in _HARD_EXCLUDE_TYPE:
        if kw in type_l:
            return True, f"exclude:product_type={kw!r}"

    for tag in tags_l:
        for kw in _HARD_EXCLUDE_TYPE:
            if kw in tag:
                return True, f"exclude:tag~{kw!r}"
        if tag in _HARD_EXCLUDE_TAGS:
            return True, f"exclude:tag={tag!r}"

    return False, ""


def bean_marker_report(text: str) -> dict[str, int]:
    """Per-category hit counts for the bean-inclusion markers. Used
    by `has_bean_markers` and also surfaced in logs/debugging."""
    text_l = (text or "").lower()
    report = {}
    for cat, markers in _BEAN_MARKER_CATEGORIES.items():
        report[cat] = sum(1 for m in markers if m in text_l)
    return report


def has_bean_markers(
    text: str,
    *,
    min_total: int = 3,
    min_categories: int = 2,
) -> tuple[bool, dict[str, int]]:
    """Stage 2: page-text inclusion. Returns (passes, per-category hits).

    Two thresholds work jointly:
      * `min_total` — at least N total marker hits anywhere.
      * `min_categories` — at least M distinct categories with ≥1 hit.

    A real bean page typically matches 5-15+ markers across 3-5
    categories (roast + process + origin + varietal + shape). A
    sweatshirt / brewer / workshop page matches 0-1.

    Defaults are conservative: 3 total + 2 categories. Easy to
    relax later if we over-reject legit beans.
    """
    report = bean_marker_report(text)
    total = sum(report.values())
    categories_with_hits = sum(1 for v in report.values() if v > 0)
    passes = total >= min_total and categories_with_hits >= min_categories
    return passes, report


def should_enrich_product(
    url: str,
    *,
    title: Optional[str] = None,
    tags: Optional[list] = None,
    product_type: Optional[str] = None,
    page_text: Optional[str] = None,
) -> tuple[bool, str]:
    """Combined two-stage decision: should this product URL go to Haiku?

    Returns (enrich, reason). When `enrich=False`, the orchestrator
    skips fetch (if reason starts 'exclude:') OR skips enqueue (if
    reason starts 'no-bean-markers:'). When `enrich=True`, proceed
    to LLM enrichment.

    `page_text=None` means "Stage 2 not yet possible" — caller should
    fetch the page and re-call this function with text. (We don't
    fetch here because the orchestrator's `page_fetcher` already
    handles fetching with the right UA + JSON-LD extraction.)
    """
    excluded, reason = is_url_excluded(
        url, title=title, tags=tags, product_type=product_type,
    )
    if excluded:
        return False, reason

    if page_text is None:
        return True, "stage1-passed:fetch-page-then-stage2"

    passes, report = has_bean_markers(page_text)
    if not passes:
        return False, (
            f"no-bean-markers:total={sum(report.values())} "
            f"cats={sum(1 for v in report.values() if v > 0)} "
            f"{report}"
        )
    return True, f"bean-markers:{report}"


__all__ = [
    "bean_marker_report",
    "has_bean_markers",
    "is_non_bean_format",
    "is_non_bean_format_desc",
    "is_non_bean_format_text",
    "is_single_serve_by_economics",
    "is_url_excluded",
    "should_enrich_product",
]
