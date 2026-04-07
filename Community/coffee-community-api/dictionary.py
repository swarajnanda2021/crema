"""
Tasting vocabulary: flavor tags, brew methods, physical attribute labels.
Derived from SCA Coffee Taster's Flavor Wheel, curated for Indian specialty.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/dictionary", tags=["Dictionary"])

FLAVOR_DICTIONARY = {
    "Fruity": {
        "Berry": ["blueberry", "strawberry", "raspberry", "blackberry"],
        "Citrus": ["lemon", "orange", "grapefruit", "lime"],
        "Stone Fruit": ["peach", "plum", "apricot", "cherry"],
        "Tropical": ["mango", "pineapple", "passionfruit", "guava"],
        "Dried Fruit": ["raisin", "fig", "date", "prune"],
    },
    "Floral": ["jasmine", "rose", "lavender", "hibiscus", "chamomile"],
    "Sweet": ["honey", "caramel", "brown sugar", "vanilla", "molasses", "toffee", "maple"],
    "Nutty": ["almond", "hazelnut", "peanut", "walnut", "cashew"],
    "Chocolate": ["dark chocolate", "milk chocolate", "cocoa", "white chocolate"],
    "Spices": ["cinnamon", "cardamom", "clove", "black pepper", "nutmeg", "ginger"],
    "Roasted": ["toasted", "smoky", "malty", "burnt sugar", "roasted grain"],
    "Earthy & Woody": ["cedar", "sandalwood", "tobacco", "leather", "earthy", "mushroom"],
    "Green & Herbal": ["herbal", "grassy", "tea-like", "mint"],
}

BREW_METHODS = [
    {"key": "pour_over", "label": "Pour Over / V60"},
    {"key": "south_indian_filter", "label": "South Indian Filter"},
    {"key": "french_press", "label": "French Press"},
    {"key": "aeropress", "label": "AeroPress"},
    {"key": "espresso", "label": "Espresso"},
    {"key": "moka_pot", "label": "Moka Pot"},
    {"key": "cold_brew", "label": "Cold Brew"},
    {"key": "chemex", "label": "Chemex"},
    {"key": "clever_dripper", "label": "Clever Dripper"},
    {"key": "turkish", "label": "Turkish / Ibrik"},
    {"key": "siphon", "label": "Siphon"},
    {"key": "instant", "label": "Instant / Sachets"},
]

DRINK_STYLES = [
    {"key": "black", "label": "Black (Neat)"},
    {"key": "americano", "label": "Americano"},
    {"key": "cortado", "label": "Cortado"},
    {"key": "macchiato", "label": "Macchiato"},
    {"key": "flat_white", "label": "Flat White"},
    {"key": "cappuccino", "label": "Cappuccino"},
    {"key": "latte", "label": "Latte"},
    {"key": "mocha", "label": "Mocha"},
    {"key": "iced", "label": "Iced"},
    {"key": "cold_brew_neat", "label": "Cold Brew (Neat)"},
    {"key": "filter_black", "label": "Filter (Black)"},
    {"key": "south_indian_filter_coffee", "label": "South Indian Filter Coffee"},
    {"key": "affogato", "label": "Affogato"},
    {"key": "lungo", "label": "Lungo"},
    {"key": "ristretto", "label": "Ristretto"},
]

MILK_TYPES = [
    {"key": "none", "label": "None (Black)"},
    {"key": "whole", "label": "Whole Milk"},
    {"key": "toned", "label": "Toned Milk"},
    {"key": "skim", "label": "Skim Milk"},
    {"key": "oat", "label": "Oat Milk"},
    {"key": "almond", "label": "Almond Milk"},
    {"key": "soy", "label": "Soy Milk"},
    {"key": "coconut", "label": "Coconut Milk"},
]

GRIND_SIZES = [
    {"key": "extra_fine", "label": "Extra Fine (Turkish)"},
    {"key": "fine", "label": "Fine (Espresso)"},
    {"key": "medium_fine", "label": "Medium-Fine (Pour Over)"},
    {"key": "medium", "label": "Medium (Drip / Filter)"},
    {"key": "medium_coarse", "label": "Medium-Coarse (Chemex)"},
    {"key": "coarse", "label": "Coarse (French Press)"},
]

PHYSICAL_ATTRIBUTES = {
    "acidity": {
        "1": "Flat", "2": "Soft", "3": "Balanced", "4": "Crisp", "5": "Bright",
    },
    "body": {
        "1": "Tea-like", "2": "Light", "3": "Medium", "4": "Full", "5": "Syrupy",
    },
    "sweetness": {
        "1": "Absent", "2": "Faint", "3": "Moderate", "4": "Pronounced", "5": "Intense",
    },
    "aftertaste": {
        "1": "Clean", "2": "Brief", "3": "Moderate", "4": "Lasting", "5": "Lingering",
    },
}

# Build flat set of all valid flavor tags for validation
ALL_VALID_TAGS = set()
for category, value in FLAVOR_DICTIONARY.items():
    if isinstance(value, list):
        ALL_VALID_TAGS.update(value)
    elif isinstance(value, dict):
        for sub_value in value.values():
            if isinstance(sub_value, list):
                ALL_VALID_TAGS.update(sub_value)

VALID_BREW_KEYS = {m["key"] for m in BREW_METHODS}
VALID_DRINK_STYLES = {d["key"] for d in DRINK_STYLES}
VALID_MILK_TYPES = {m["key"] for m in MILK_TYPES}
VALID_GRIND_SIZES = {g["key"] for g in GRIND_SIZES}


def validate_flavor_tags(tags: list[str]) -> list[str]:
    """Return list of invalid tags (empty if all valid)."""
    return [t for t in tags if t not in ALL_VALID_TAGS]


def validate_brew_method(method: str) -> bool:
    return method in VALID_BREW_KEYS


def validate_drink_style(style: str) -> bool:
    return style in VALID_DRINK_STYLES


def validate_milk_type(milk: str) -> bool:
    return milk in VALID_MILK_TYPES


def validate_grind_size(grind: str) -> bool:
    return grind in VALID_GRIND_SIZES


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/flavors")
def get_flavors():
    return FLAVOR_DICTIONARY


@router.get("/brew-methods")
def get_brew_methods():
    return BREW_METHODS


@router.get("/physical-attributes")
def get_physical_attributes():
    return PHYSICAL_ATTRIBUTES


@router.get("/drink-styles")
def get_drink_styles():
    return DRINK_STYLES


@router.get("/milk-types")
def get_milk_types():
    return MILK_TYPES


@router.get("/grind-sizes")
def get_grind_sizes():
    return GRIND_SIZES


@router.get("/all")
def get_all_dictionaries():
    """Single endpoint returning all dictionaries (reduces frontend fetch calls)."""
    return {
        "flavors": FLAVOR_DICTIONARY,
        "brew_methods": BREW_METHODS,
        "drink_styles": DRINK_STYLES,
        "milk_types": MILK_TYPES,
        "grind_sizes": GRIND_SIZES,
        "physical_attributes": PHYSICAL_ATTRIBUTES,
    }
