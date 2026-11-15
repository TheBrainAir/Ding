"""Cached menu translations (dish name + short description per guest language).

One structured-output call per language, with the restaurant's llm_model, translates the
whole menu; results are stored in dish_translations and reused. Everything here is
best-effort: a failure is logged and callers fall back to the original names.
"""

import asyncio
import hashlib
import json
import logging
import time

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.catalog import language_name
from app.db import SessionLocal
from app.models import Dish, DishTranslation, Restaurant
from app.services.llm import structured_call

log = logging.getLogger(__name__)

RETRY_AFTER_FAILURE_SECONDS = 300
_inflight: dict[tuple[int, str], asyncio.Task] = {}
_failed_at: dict[tuple[int, str], float] = {}

SCHEMA = {
    "type": "object",
    "properties": {
        "dishes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["id", "name", "description"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["dishes"],
    "additionalProperties": False,
}

PROMPT = """\
Translate this restaurant menu from {source} into {target}, for guests who read and speak only {target}. \
A voice waiter says these names aloud; guests see them on a screen and say them back to order.

- name: the dish name the way a menu printed in {target} would show it. A dish known by its foreign name \
(Pad Thai, gyoza, tiramisu, ramen, bao, satay) keeps that name written in {target}'s script (transliterated; \
for Latin-alphabet languages usually unchanged); never invent a literal translation for it. A descriptive name \
gets a short, natural {target} name that is easy to say aloud.
- description: one short sentence in {target} with the same meaning. Never add or drop ingredients.
Keep every id exactly as given and return every dish.

Menu (JSON):
{menu}"""


def norm(language: str | None) -> str | None:
    return language.strip().lower().split("-")[0] or None if language else None


def needs_translation(restaurant: Restaurant, language: str | None) -> bool:
    lang = norm(language)
    return bool(lang) and lang != norm(restaurant.menu_language)


def source_hash(dish: Dish) -> str:
    return hashlib.sha1(f"{dish.name}\n{dish.description}".encode()).hexdigest()[:16]


def cached(db: Session, restaurant_id: int, language: str | None) -> dict[int, DishTranslation]:
    """Valid translations by dish id; empty for the menu language or on any error."""
    try:
        restaurant = db.get(Restaurant, restaurant_id)
        lang = norm(language)
        if restaurant is None or not needs_translation(restaurant, lang):
            return {}
        dishes = {d.id: d for d in db.scalars(select(Dish).where(Dish.restaurant_id == restaurant_id))}
        rows = db.scalars(
            select(DishTranslation).where(
                DishTranslation.restaurant_id == restaurant_id, DishTranslation.language == lang
            )
        ).all()
        return {r.dish_id: r for r in rows if r.dish_id in dishes and r.source_hash == source_hash(dishes[r.dish_id])}
    except Exception:
        log.exception("reading menu translations failed")
        return {}


async def translate_menu(restaurant_id: int, language: str) -> int:
    """Translate the dishes that have no valid row for `language`. Returns how many were stored."""
    lang = norm(language)
    with SessionLocal() as db:
        restaurant = db.get(Restaurant, restaurant_id)
        if restaurant is None or not needs_translation(restaurant, lang):
            return 0
        have = cached(db, restaurant_id, lang)
        todo = [d for d in db.scalars(select(Dish).where(Dish.restaurant_id == restaurant_id)) if d.id not in have]
        if not todo:
            return 0
        model, source = restaurant.llm_model, language_name(restaurant.menu_language)
        hashes = {d.id: source_hash(d) for d in todo}
        menu = [{"id": d.id, "name": d.name, "description": d.description} for d in todo]
    result = await structured_call(
        model=model,
        content=[
            {
                "type": "text",
                "text": PROMPT.format(
                    source=source, target=language_name(lang), menu=json.dumps(menu, ensure_ascii=False)
                ),
            }
        ],
        schema=SCHEMA,
        effort="low",
        max_tokens=16000,
    )
    rows = [
        DishTranslation(
            dish_id=int(item["id"]),
            restaurant_id=restaurant_id,
            language=lang,
            name=" ".join(str(item["name"]).split())[:200],
            description=" ".join(str(item.get("description", "")).split())[:600],
            source_hash=hashes[int(item["id"])],
        )
        for item in result.get("dishes", [])
        if isinstance(item, dict) and int(item.get("id", -1)) in hashes and str(item.get("name", "")).strip()
    ]
    with SessionLocal() as db:
        ids = [r.dish_id for r in rows]
        db.execute(delete(DishTranslation).where(DishTranslation.language == lang, DishTranslation.dish_id.in_(ids)))
        db.add_all(rows)
        db.commit()
    return len(rows)


def ensure_in_background(restaurant_id: int, language: str | None) -> None:
    """Start translating missing dishes unless already running or recently failed. Never raises."""
    try:
        lang = norm(language)
        key = (restaurant_id, lang or "")
        if not lang or (key in _inflight and not _inflight[key].done()):
            return
        if time.monotonic() - _failed_at.get(key, -1e9) < RETRY_AFTER_FAILURE_SECONDS:
            return

        async def run() -> None:
            started = time.monotonic()
            try:
                n = await translate_menu(restaurant_id, lang)
                log.info("translated %d dishes into %s in %.1fs", n, lang, time.monotonic() - started)
            except Exception:
                _failed_at[key] = time.monotonic()
                log.exception("menu translation into %s failed", lang)
            finally:
                _inflight.pop(key, None)

        _inflight[key] = asyncio.get_running_loop().create_task(run())
    except Exception:
        log.exception("could not start menu translation")
