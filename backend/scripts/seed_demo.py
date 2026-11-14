"""Create (or refresh) the demo restaurant. Safe to run any number of times.

    uv run python scripts/seed_demo.py

Uses <repo>/demo/menu.json (+ demo/photos/) when present, else the built-in menu.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import APP_NAME
from app.db import SessionLocal, init_db
from app.seed import MenuFileError, load_demo_menu, seed

WEB = "http://localhost:5173"


def main() -> None:
    try:
        menu, photo_dir = load_demo_menu()
    except MenuFileError as e:
        sys.exit(f"Invalid demo menu: {e}")
    init_db()
    with SessionLocal() as db:
        info = seed(db, menu, photo_dir)
    source = f"{photo_dir / 'menu.json'}" if photo_dir else "built-in menu (demo/menu.json not found)"
    print(f"{APP_NAME} demo data ready: {info['restaurant']}")
    print(f"  source            {source}")
    print(f"  menu              {info['dishes']} dishes ({info['photos']} with photos), {info['notes']} notes")
    for warning in info["warnings"]:
        print(f"  warning           {warning}")
    print()
    print(f"  Dashboard login   {WEB}/login")
    print(f"    email           {info['email']}")
    print(f"    password        {info['password']}")
    print()
    for t in info["tables"]:
        print(f"  {t['label']:<17} {WEB}/t/{t['token']}")


if __name__ == "__main__":
    main()
