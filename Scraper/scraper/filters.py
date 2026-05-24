"""
Two-stage coffee bean classification:

Stage 1 (pre-scrape): is_coffee_product()
  Kill obvious non-beans before wasting HTTP requests.

Stage 2 (post-normalization): is_confirmed_coffee_bean()
  Structural check: real beans have roast + process + origin etc.,
  and sane weight (50g–5000g per unit).
"""


# ── Stage 1: hard-exclude title patterns ──────────────────────────────────────
# If ANY of these appear in the lowercased product title → not beans.

_HARD_EXCLUDE_TITLE = [
    # ── Equipment & accessories ──
    "grinder", "dripper", "mug", " cup", "cup ", "kettle", "filter paper",
    "scale", "tote", "carafe", "tumbler", "bottle", "frother",
    "french press", "moka pot", "aeropress", "chemex", "v60",
    "siphon", "percolator", "plunger", "portafilter", "tamper",
    "knock box", "brassware", "brass set", " maker",
    "ceramic", "stainless steel",

    # ── Chocolate / confectionery / sweets ──
    "chocolate", "cocoa", "cacao",
    "truffle", "cookie", "biscuit", "brownie", "croissant",
    "cake", "pastry", "jaggery", "nibs", "morsels",

    # ── Ready-to-drink / liquid / cans ──
    "cold coffee", "iced coffee", "iced latte", "cold brew can",
    "ready to drink", "concentrate", "syrup",

    # ── Instant coffee (powder, not beans) ──
    "instant coffee", "instant ",

    # ── Brew bags / sachets (pre-portioned, not loose beans) ──
    "dip bag", "drip bag", "brew bag", "sachet", "coffee bag",
    "easy bag", "easy brew", "easy pour", "hot brew bag",
    "cold brew bag", "cold brew pack",

    # ── Capsules / pods ──
    "capsule", "pod",

    # ── Non-coffee botanicals ──
    "matcha", "tea ", " tea", "chai",
    "lavender", "hibiscus", "chamomile", "turmeric",
    "mushroom coffee", "lion's mane",

    # ── Food items ──
    "almond ", "cashew", "trail mix", "salted ",

    # ── Gifts / bundles / assorted packs ──
    "gift card", "hamper", "merchandise", "gift box", "gift set",
    "coffee gift", "gift pack",
    "assorted 6", "6-pack", "6 pack",

    # ── Subscriptions / experiences / stays ──
    "subscription", "experience", "workshop", "tour",
    "private stay", "sharing room", "hotel", "accommodation",

    # ── Subko chocolate bar pattern (no "chocolate" in name) ──
    "dark/milk", "milk/white", "% white",

    # ── Flavored drinks masquerading as coffee ──
    "french vanilla", "vanilla flavour",

    # ── Cascara (dried cherry skin, not beans) ──
    "cascara",
]

_HARD_EXCLUDE_TYPE = {
    "equipment", "merchandise", "accessory", "accessories",
    "gift", "gifting", "apparel", "drinkware", "tool", "tools",
}

# Tags that prove it's NOT beans. CONSERVATIVE list — only tags that
# semantically mean "this product is the named non-bean thing" go
# here, NOT tags that are used as storefront-filter conventions
# regardless of the product's actual identity. Project Kaapi tags
# every product (including bean SKUs like "Chandragiri Crown",
# "God Bean", "Magic Potion") with both `bottle` and `Cans` for
# their UI filter chip — a single tag-only reject would (and did)
# kill their entire catalog. Cold-brew cans are still caught by
# the title check (`cold brew can`, `ready to drink`, etc.) so
# Blue Tokai's legitimate cans stay rejected without us needing a
# noisy tag rule. Leave this set empty for now; re-introduce
# specific tags here ONLY when a roaster's storefront proves the
# tag is a reliable non-bean signal across their whole catalog.
_HARD_EXCLUDE_TAGS: set[str] = set()


def _tag_to_str(tag) -> str:
    if isinstance(tag, dict):
        return tag.get("name") or tag.get("slug") or ""
    return str(tag) if tag else ""


def _chocolate_is_tasting_note(title_l: str) -> bool:
    """
    Return True if 'chocolate' appears as a tasting note descriptor,
    not as the product itself.
    """
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


def is_coffee_product(
    title: str,
    product_type: str = "",
    tags: list = None,
    body_html: str = "",
) -> tuple:
    """
    Stage 1: lightweight pre-filter.
    """
    title_l = (title or "").lower()
    type_l = (product_type or "").lower()
    tags_l = [_tag_to_str(t).lower() for t in (tags or [])]

    # Hard exclusion on title
    for kw in _HARD_EXCLUDE_TITLE:
        if kw in title_l:
            if kw == "chocolate" and _chocolate_is_tasting_note(title_l):
                continue
            return False, False

    # Hard exclusion on product_type
    for kw in _HARD_EXCLUDE_TYPE:
        if kw in type_l:
            return False, False

    # Hard exclusion on tags
    for tag in tags_l:
        for kw in _HARD_EXCLUDE_TYPE:
            if kw in tag:
                return False, False
        # Exact tag match for known non-bean tags
        if tag in _HARD_EXCLUDE_TAGS:
            return False, False

    return True, False


# ── Stage 2: post-normalization structural check ──────────────────────────────

def is_confirmed_coffee_bean(product: dict) -> bool:
    """
    Stage 2: a product is coffee beans only if:
    1. It has price AND weight.
    2. Weight is in sane range (50g–5000g) — below 50g is a chocolate bar,
       above 5000g is wholesale/non-consumer.
    3. It has at least 2 of: roast_level, process, origin, varietal, tasting_notes.
    """
    if not product:
        return False

    price = product.get("price_inr")
    weight = product.get("weight_grams")

    if price is None or weight is None:
        return False

    # Weight sanity: 50g–5000g
    if weight < 50 or weight > 5000:
        return False

    # Count coffee-bean-specific attributes
    signals = 0

    roast = product.get("roast_level")
    if roast and roast != "Unknown":
        signals += 1
    if product.get("process"):
        signals += 1
    if product.get("origin"):
        signals += 1
    if product.get("varietal"):
        signals += 1
    if product.get("tasting_notes"):
        signals += 1

    return signals >= 2
