"""Enumerations and the catalog of selectable models.

This is the single place that knows model ids: the lists offered in the dashboard
(`GET /api/models`) and the defaults a new restaurant row starts with. At runtime
every call reads the model id from the restaurant row, never from here.
"""

from dataclasses import dataclass
from typing import Literal

from app.config import APP_NAME

ALLERGENS: list[tuple[str, str]] = [
    ("gluten", "Gluten (cereals)"),
    ("crustaceans", "Crustaceans"),
    ("eggs", "Eggs"),
    ("fish", "Fish"),
    ("peanuts", "Peanuts"),
    ("soy", "Soy"),
    ("milk", "Milk / dairy"),
    ("tree_nuts", "Tree nuts"),
    ("celery", "Celery"),
    ("mustard", "Mustard"),
    ("sesame", "Sesame"),
    ("sulphites", "Sulphites"),
    ("lupin", "Lupin"),
    ("molluscs", "Molluscs"),
]
ALLERGEN_IDS = [a for a, _ in ALLERGENS]

DIETARY_TAGS: list[tuple[str, str]] = [
    ("vegan", "Vegan"),
    ("vegetarian", "Vegetarian"),
    ("halal", "Halal"),
    ("kosher", "Kosher"),
    ("gluten_free", "Gluten-free"),
    ("spicy", "Spicy"),
]
DIETARY_TAG_IDS = [t for t, _ in DIETARY_TAGS]

Allergen = Literal[
    "gluten",
    "crustaceans",
    "eggs",
    "fish",
    "peanuts",
    "soy",
    "milk",
    "tree_nuts",
    "celery",
    "mustard",
    "sesame",
    "sulphites",
    "lupin",
    "molluscs",
]
DietaryTag = Literal["vegan", "vegetarian", "halal", "kosher", "gluten_free", "spicy"]
OrderStatus = Literal["draft", "placed", "preparing", "served", "cancelled"]


@dataclass(frozen=True)
class LLMSpec:
    id: str
    label: str
    # Fast mode (`speed: "fast"`) is offered on Claude Opus 5.5 only.
    fast: bool
    # Server-side refusal fallbacks (`fallbacks: "default"`); Haiku has none.
    fallbacks: bool


LLM_MODELS: list[LLMSpec] = [
    LLMSpec("claude-opus-5-5", "Claude Opus 5.5 (recommended)", fast=True, fallbacks=True),
    LLMSpec("claude-sonnet-5-5", "Claude Sonnet 5.5", fast=False, fallbacks=True),
    LLMSpec("claude-haiku-5-5", "Claude Haiku 5.5", fast=False, fallbacks=False),
]

STT_MODELS: list[dict] = [
    {"id": "scribe_v3", "label": "ElevenLabs Scribe v3"},
    {"id": "scribe_v2", "label": "ElevenLabs Scribe v2"},
]

TTS_MODELS: list[dict] = [
    {"id": "eleven_v4_turbo", "label": "Eleven v4 Turbo (low latency, 90+ languages)"},
    {"id": "eleven_v3", "label": "Eleven v3"},
    {"id": "eleven_multilingual_v2", "label": "Eleven Multilingual v2"},
    {"id": "eleven_flash_v2_5", "label": "Eleven Flash v2.5"},
]

DEFAULT_RESTAURANT_SETTINGS: dict[str, str] = {
    "currency": "USD",
    "menu_language": "en",
    "persona_name": APP_NAME,
    # ElevenLabs premade multilingual voice ("Sarah"); changeable in Settings.
    "voice_id": "EXAVITQu4vr4xnSDxMaL",
    "llm_model": "claude-opus-5-5",
    "stt_model": "scribe_v3",
    "tts_model": "eleven_v4_turbo",
}


def llm_spec(model_id: str) -> LLMSpec:
    for spec in LLM_MODELS:
        if spec.id == model_id:
            return spec
    # Unknown id (typed by hand): send it as-is with the conservative feature set.
    return LLMSpec(model_id, model_id, fast=False, fallbacks=False)


LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "uk": "Ukrainian",
    "hy": "Armenian",
    "ka": "Georgian",
    "tr": "Turkish",
    "ar": "Arabic",
    "he": "Hebrew",
    "fa": "Persian",
    "hi": "Hindi",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "nl": "Dutch",
    "pl": "Polish",
    "el": "Greek",
    "th": "Thai",
    "vi": "Vietnamese",
}


def language_name(code: str | None) -> str:
    if not code:
        return "unknown"
    return LANGUAGE_NAMES.get(code, code)
