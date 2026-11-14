"""Request bodies. Responses are plain dicts built in app/serializers.py."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.catalog import Allergen, DietaryTag


def _clean_list(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        v = " ".join(str(v).split())
        if v and v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


class SignupIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=200)
    restaurant_name: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
            raise ValueError("enter a valid email address")
        return v


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.strip().lower()


class RestaurantPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    currency: str | None = Field(default=None, min_length=1, max_length=8)
    menu_language: str | None = Field(default=None, min_length=2, max_length=16)
    persona_name: str | None = Field(default=None, min_length=1, max_length=80)
    voice_id: str | None = Field(default=None, max_length=120)
    llm_model: str | None = Field(default=None, min_length=1, max_length=120)
    stt_model: str | None = Field(default=None, min_length=1, max_length=120)
    tts_model: str | None = Field(default=None, min_length=1, max_length=120)


class _DishFields(BaseModel):
    @field_validator("ingredients", check_fields=False)
    @classmethod
    def _ingredients(cls, v):
        return _clean_list(v) if v is not None else v

    @field_validator("allergens", "may_contain", "dietary_tags", check_fields=False)
    @classmethod
    def _enums(cls, v):
        return _dedupe(v) if v is not None else v


class DishIn(_DishFields):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    category: str = Field(default="Other", max_length=80)
    price: float = Field(default=0.0, ge=0)
    ingredients: list[str] = []
    allergens: list[Allergen] = []
    may_contain: list[Allergen] = []
    dietary_tags: list[DietaryTag] = []
    available: bool = True


class DishPatch(_DishFields):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(default=None, max_length=80)
    price: float | None = Field(default=None, ge=0)
    ingredients: list[str] | None = None
    allergens: list[Allergen] | None = None
    may_contain: list[Allergen] | None = None
    dietary_tags: list[DietaryTag] | None = None
    available: bool | None = None


class DishDraft(_DishFields):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    category: str = ""
    price: float | None = None
    ingredients: list[str] = []
    allergens: list[Allergen] = []
    may_contain: list[Allergen] = []
    dietary_tags: list[DietaryTag] = []


class DishBulkIn(BaseModel):
    dishes: list[DishDraft]


class SuggestAllergensIn(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    ingredients: list[str] = []


class KnowledgeIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = ""


class KnowledgePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = None


class TableIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)


class OrderPatch(BaseModel):
    status: Literal["placed", "preparing", "served", "cancelled"]


class WaiterCallPatch(BaseModel):
    resolved: bool


class TurnIn(BaseModel):
    text: str = Field(max_length=4000)
    speak: bool = True
