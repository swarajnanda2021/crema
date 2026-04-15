"""Pydantic models for request/response validation."""

from typing import Optional
from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$")
    display_name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    location: Optional[str] = None
    coffee_preference: Optional[str] = None
    brewing_style: Optional[str] = None
    created_at: str


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=50)
    bio: Optional[str] = Field(None, max_length=280)
    avatar_url: Optional[str] = Field(None, max_length=500)
    location: Optional[str] = Field(None, max_length=100)
    coffee_preference: Optional[str] = Field(None, pattern=r"^(light|medium|dark)$")
    brewing_style: Optional[str] = Field(None, pattern=r"^(espresso|filter|both)$")
    favorite_drink: Optional[str] = Field(None, max_length=100)
    favorite_cafe: Optional[str] = Field(None, max_length=100)
    avatar_crop_x: Optional[float] = None
    avatar_crop_y: Optional[float] = None
    avatar_zoom: Optional[float] = None


class AuthResponse(BaseModel):
    user: UserResponse
    token: str


# ── Shelves ───────────────────────────────────────────────────────────────────

class ShelfAddRequest(BaseModel):
    product_id: str
    shelf: str = Field(pattern=r"^(open_bags|on_the_list)$")


class ShelfEntryResponse(BaseModel):
    id: int
    product_id: str
    shelf: str
    added_at: str
    moved_at: str
    tasting_note_count: int = 0


# ── Tasting Notes ─────────────────────────────────────────────────────────────

class BlendComponent(BaseModel):
    product_id: str
    percentage: int = Field(ge=1, le=100)


class TastingNoteCreate(BaseModel):
    product_id: str
    # Tasting attributes
    acidity: Optional[int] = Field(None, ge=1, le=5)
    body: Optional[int] = Field(None, ge=1, le=5)
    sweetness: Optional[int] = Field(None, ge=1, le=5)
    aftertaste: Optional[int] = Field(None, ge=1, le=5)
    flavor_tags: Optional[list[str]] = Field(None, max_length=8)
    # Brew recipe
    brew_method: Optional[str] = None
    drink_style: Optional[str] = None
    milk_type: Optional[str] = None
    dose_grams: Optional[float] = Field(None, ge=1, le=100)
    yield_grams: Optional[float] = Field(None, ge=1, le=500)
    water_ml: Optional[float] = Field(None, ge=10, le=2000)
    extraction_time_secs: Optional[int] = Field(None, ge=1, le=600)
    water_temp_celsius: Optional[int] = Field(None, ge=0, le=100)
    grind_size: Optional[str] = None
    brew_ratio: Optional[str] = Field(None, max_length=20)
    # Blend
    blend_components: Optional[list[BlendComponent]] = None
    # Meta
    comment: Optional[str] = Field(None, max_length=500)


class TastingNoteUpdate(BaseModel):
    acidity: Optional[int] = Field(None, ge=1, le=5)
    body: Optional[int] = Field(None, ge=1, le=5)
    sweetness: Optional[int] = Field(None, ge=1, le=5)
    aftertaste: Optional[int] = Field(None, ge=1, le=5)
    flavor_tags: Optional[list[str]] = Field(None, max_length=8)
    brew_method: Optional[str] = None
    drink_style: Optional[str] = None
    milk_type: Optional[str] = None
    dose_grams: Optional[float] = Field(None, ge=1, le=100)
    yield_grams: Optional[float] = Field(None, ge=1, le=500)
    water_ml: Optional[float] = Field(None, ge=10, le=2000)
    extraction_time_secs: Optional[int] = Field(None, ge=1, le=600)
    water_temp_celsius: Optional[int] = Field(None, ge=0, le=100)
    grind_size: Optional[str] = None
    brew_ratio: Optional[str] = Field(None, max_length=20)
    blend_components: Optional[list[BlendComponent]] = None
    comment: Optional[str] = Field(None, max_length=500)


# ── Click Tracking ────────────────────────────────────────────────────────────

class ClickRequest(BaseModel):
    product_id: str
    roaster_slug: str
    source_page: str = Field(
        pattern=r"^(card_front|card_back|coffee_detail|roaster_profile|shelf|partner_shelf)$"
    )
