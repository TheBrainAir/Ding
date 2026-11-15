"""Pre-translate the demo restaurant's menu: uv run python scripts/translate_menu.py ru hy es"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import Restaurant, User
from app.seed import DEMO_EMAIL
from app.services import translate


async def main(languages: list[str]) -> None:
    init_db()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        restaurant = db.get(Restaurant, user.restaurant_id) if user else db.scalar(select(Restaurant))
        rid, name = restaurant.id, restaurant.name
    for lang in languages:
        started = time.monotonic()
        n = await translate.translate_menu(rid, lang)
        with SessionLocal() as db:
            total = len(translate.cached(db, rid, lang))
        print(f"{name}: {lang}: {n} new, {total} cached, {time.monotonic() - started:.1f}s")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: uv run python scripts/translate_menu.py <lang> [<lang> ...]")
    asyncio.run(main(sys.argv[1:]))
