"""
Dictionary routes — static lookup data for flavors, brew methods, etc.
"""

from fastapi import APIRouter
from dictionary import (
    FLAVOR_DICTIONARY, BREW_METHODS, DRINK_STYLES,
    MILK_TYPES, GRIND_SIZES, PHYSICAL_ATTRIBUTES,
)
from resources.envelope import ok

router = APIRouter(prefix="/api/dictionary", tags=["Dictionary"])


@router.get("/flavors")
def get_flavors():
    return ok(FLAVOR_DICTIONARY, resource="dictionary")


@router.get("/brew-methods")
def get_brew_methods():
    return ok(BREW_METHODS, resource="dictionary")


@router.get("/drink-styles")
def get_drink_styles():
    return ok(DRINK_STYLES, resource="dictionary")


@router.get("/milk-types")
def get_milk_types():
    return ok(MILK_TYPES, resource="dictionary")


@router.get("/grind-sizes")
def get_grind_sizes():
    return ok(GRIND_SIZES, resource="dictionary")


@router.get("/physical-attributes")
def get_physical_attributes():
    return ok(PHYSICAL_ATTRIBUTES, resource="dictionary")


@router.get("/all")
def get_all():
    return ok({
        "flavors": FLAVOR_DICTIONARY,
        "brew_methods": BREW_METHODS,
        "drink_styles": DRINK_STYLES,
        "milk_types": MILK_TYPES,
        "grind_sizes": GRIND_SIZES,
        "physical_attributes": PHYSICAL_ATTRIBUTES,
    }, resource="dictionary")
