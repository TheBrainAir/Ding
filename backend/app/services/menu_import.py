"""AI helpers for the dashboard: menu import from a photo/PDF and allergen suggestions.

Both return drafts only. Nothing is saved until a person reviews it.
"""

import base64
import io
import logging

from PIL import Image, ImageOps
from pydantic import ValidationError

from app.catalog import ALLERGEN_IDS, ALLERGENS, DIETARY_TAG_IDS
from app.schemas import DishDraft
from app.services.llm import LLMError, structured_call

log = logging.getLogger(__name__)

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIDE = 2400
MAX_IMAGE_BYTES = 4_500_000
MAX_PDF_BYTES = 30_000_000

_ALLERGEN_ARRAY = {"type": "array", "items": {"type": "string", "enum": ALLERGEN_IDS}}
_TAG_ARRAY = {"type": "array", "items": {"type": "string", "enum": DIETARY_TAG_IDS}}

_DISH_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "category": {"type": "string"},
        "price": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "allergens": _ALLERGEN_ARRAY,
        "may_contain": _ALLERGEN_ARRAY,
        "dietary_tags": _TAG_ARRAY,
    },
    "required": ["name", "description", "category", "price", "ingredients", "allergens", "may_contain", "dietary_tags"],
    "additionalProperties": False,
}

IMPORT_SCHEMA = {
    "type": "object",
    "properties": {"dishes": {"type": "array", "items": _DISH_SCHEMA}},
    "required": ["dishes"],
    "additionalProperties": False,
}

SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "allergens": _ALLERGEN_ARRAY,
        "may_contain": _ALLERGEN_ARRAY,
        "dietary_tags": _TAG_ARRAY,
        "rationale": {"type": "string"},
    },
    "required": ["allergens", "may_contain", "dietary_tags", "rationale"],
    "additionalProperties": False,
}

_ALLERGEN_GUIDE = ", ".join(f"{a} ({label})" for a, label in ALLERGENS)

IMPORT_PROMPT = f"""\
This is a restaurant menu. Extract every dish and drink on it as a draft for the menu database.

For each item:
- name: exactly as printed.
- description: the printed description, cleaned up; if there is none, one short plain sentence.
- category: the menu section it is under (for example Starters, Mains, Desserts, Drinks).
- price: the number only, without currency; null if no price is shown.
- ingredients: lowercase list of the ingredients the menu states, plus the core ingredients the dish name makes certain (pizza dough is wheat, a carbonara has egg). Do not invent garnishes.
- allergens: from this fixed list only, for allergens that the ingredients clearly contain: {_ALLERGEN_GUIDE}.
- may_contain: only allergens the menu itself warns about as possible traces; otherwise empty.
- dietary_tags: only tags the menu marks (symbols or words) or that are certain from the ingredients.

A person will review every draft before saving, so prefer leaving a field empty to guessing."""

SUGGEST_PROMPT = f"""\
Suggest allergen information for this dish, for a restaurant owner who will check it before saving.

Use only this fixed allergen list: {_ALLERGEN_GUIDE}.
- allergens: what the listed ingredients contain (soy sauce contains soy and gluten, pesto contains tree nuts and milk, and so on).
- may_contain: common cross-contamination risks only when typical for the dish (fried in shared oil, made with nut-containing pastry); keep it short.
- dietary_tags: from vegan, vegetarian, halal, kosher, gluten_free, spicy, only when the ingredients make it clear (halal and kosher only if stated).
- rationale: one or two sentences explaining the choices, mentioning anything the owner should double-check.

Dish:
"""


def _image_block(data: bytes, content_type: str) -> dict:
    """Downscale big photos so they fit the API image limits."""
    if len(data) > MAX_IMAGE_BYTES or content_type not in IMAGE_TYPES:
        try:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        except Exception as e:
            raise LLMError("Could not read that image. Use JPEG, PNG or WebP.") from e
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        data, content_type = buf.getvalue(), "image/jpeg"
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": content_type, "data": base64.standard_b64encode(data).decode()},
    }


def _clean_drafts(raw: list) -> list[dict]:
    drafts = []
    for item in raw:
        try:
            drafts.append(DishDraft.model_validate(item).model_dump())
        except ValidationError:
            log.warning("dropping an unreadable dish draft: %r", item)
    return drafts


async def import_menu(data: bytes, content_type: str, filename: str, *, model: str) -> list[dict]:
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    if is_pdf:
        if len(data) > MAX_PDF_BYTES:
            raise LLMError("That PDF is too large (30 MB max).")
        source = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(data).decode(),
            },
        }
    else:
        source = _image_block(data, content_type)
    result = await structured_call(
        model=model,
        content=[source, {"type": "text", "text": IMPORT_PROMPT}],
        schema=IMPORT_SCHEMA,
        effort="medium",
        max_tokens=32000,
    )
    return _clean_drafts(result.get("dishes", []))


async def suggest_allergens(name: str, description: str, ingredients: list[str], *, model: str) -> dict:
    dish = f"Name: {name}\nDescription: {description or '-'}\nIngredients: {', '.join(ingredients) or '-'}"
    result = await structured_call(
        model=model,
        content=[{"type": "text", "text": SUGGEST_PROMPT + dish}],
        schema=SUGGEST_SCHEMA,
        effort="low",
        max_tokens=4096,
    )
    return {
        "allergens": [a for a in ALLERGEN_IDS if a in set(result.get("allergens", []))],
        "may_contain": [a for a in ALLERGEN_IDS if a in set(result.get("may_contain", []))],
        "dietary_tags": [t for t in DIETARY_TAG_IDS if t in set(result.get("dietary_tags", []))],
        "rationale": str(result.get("rationale", "")),
    }
