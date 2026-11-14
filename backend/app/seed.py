"""Demo data: an owner account, a restaurant with a realistic menu, notes and two tables.

The menu comes from <repo>/demo/menu.json when it exists (the printed demo menu, so
what guests see on paper matches what the waiter knows), else from BUILTIN_MENU.
Idempotent: re-running updates the same rows (matched by email / name / title / label)
and resets the demo password, so the printed credentials always work.
"""

import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import create_owner, hasher
from app.api.tables import new_token
from app.catalog import ALLERGEN_IDS, DIETARY_TAG_IDS
from app.config import settings
from app.models import DiningTable, Dish, KnowledgeItem, Restaurant, User
from app.services import rag

DEMO_EMAIL = "demo@ding.local"
DEMO_PASSWORD = "ding-demo-2026"
DEMO_RESTAURANT = "Lantern Street Kitchen"

DISHES: list[dict] = [
    # Starters
    {
        "name": "Burrata & Heirloom Tomatoes",
        "category": "Starters",
        "price": 12.5,
        "description": "Creamy burrata on ripe heirloom tomatoes with basil, olive oil and sourdough croutons.",
        "ingredients": [
            "burrata",
            "heirloom tomatoes",
            "basil",
            "extra virgin olive oil",
            "sourdough croutons",
            "sea salt",
        ],
        "allergens": ["milk", "gluten"],
        "may_contain": [],
        "dietary_tags": ["vegetarian"],
    },
    {
        "name": "Garlic Butter Prawns",
        "category": "Starters",
        "price": 15.0,
        "description": "Tiger prawns sizzled in garlic butter and white wine with a kick of chili.",
        "ingredients": ["tiger prawns", "garlic", "butter", "white wine", "chili flakes", "parsley", "lemon"],
        "allergens": ["crustaceans", "milk", "sulphites"],
        "may_contain": ["molluscs"],
        "dietary_tags": ["spicy", "gluten_free"],
    },
    {
        "name": "Hummus with Warm Pita",
        "category": "Starters",
        "price": 9.0,
        "description": "Smooth chickpea and tahini hummus with smoked paprika and warm pita bread.",
        "ingredients": ["chickpeas", "tahini", "lemon juice", "garlic", "olive oil", "smoked paprika", "pita bread"],
        "allergens": ["sesame", "gluten"],
        "may_contain": [],
        "dietary_tags": ["vegan"],
    },
    {
        "name": "Caesar Salad",
        "category": "Starters",
        "price": 11.5,
        "description": "Crisp romaine, parmesan and croutons in a classic anchovy Caesar dressing.",
        "ingredients": [
            "romaine lettuce",
            "parmesan",
            "sourdough croutons",
            "egg yolk",
            "anchovies",
            "dijon mustard",
            "garlic",
            "lemon",
        ],
        "allergens": ["eggs", "fish", "milk", "gluten", "mustard"],
        "may_contain": [],
        "dietary_tags": [],
    },
    {
        "name": "Tom Yum Soup",
        "category": "Starters",
        "price": 10.5,
        "description": "Hot and sour Thai broth with shrimp, lemongrass, galangal and mushrooms.",
        "ingredients": [
            "shrimp",
            "lemongrass",
            "galangal",
            "kaffir lime leaves",
            "mushrooms",
            "chili",
            "fish sauce",
            "lime",
        ],
        "allergens": ["crustaceans", "fish"],
        "may_contain": ["soy"],
        "dietary_tags": ["spicy", "gluten_free"],
    },
    # Mains
    {
        "name": "Pad Thai",
        "category": "Mains",
        "price": 14.5,
        "description": "Stir-fried rice noodles with tofu, egg, bean sprouts and tamarind, topped with crushed peanuts.",
        "ingredients": [
            "rice noodles",
            "peanuts",
            "egg",
            "tofu",
            "bean sprouts",
            "tamarind",
            "fish sauce",
            "spring onion",
            "lime",
        ],
        "allergens": ["peanuts", "eggs", "soy", "fish"],
        "may_contain": ["sesame", "crustaceans"],
        "dietary_tags": [],
    },
    {
        "name": "Chicken Satay Skewers",
        "category": "Mains",
        "price": 16.0,
        "description": "Grilled chicken thigh skewers with peanut satay sauce, cucumber relish and jasmine rice.",
        "ingredients": [
            "chicken thigh",
            "peanut sauce",
            "coconut milk",
            "soy sauce",
            "lemongrass",
            "cucumber relish",
            "jasmine rice",
        ],
        "allergens": ["peanuts", "soy", "gluten"],
        "may_contain": ["sesame"],
        "dietary_tags": ["halal"],
    },
    {
        "name": "Margherita Pizza",
        "category": "Mains",
        "price": 13.0,
        "description": "Wood-fired pizza with San Marzano tomato, fior di latte mozzarella and fresh basil.",
        "ingredients": ["wheat dough", "san marzano tomatoes", "fior di latte mozzarella", "basil", "olive oil"],
        "allergens": ["gluten", "milk"],
        "may_contain": [],
        "dietary_tags": ["vegetarian"],
    },
    {
        "name": "Grilled Salmon with Lemon Dill Sauce",
        "category": "Mains",
        "price": 22.0,
        "description": "Salmon fillet with a creamy lemon and dill sauce, asparagus and new potatoes.",
        "ingredients": ["salmon fillet", "dill", "lemon", "cream", "butter", "asparagus", "new potatoes"],
        "allergens": ["fish", "milk"],
        "may_contain": [],
        "dietary_tags": ["gluten_free"],
    },
    {
        "name": "Mushroom Risotto",
        "category": "Mains",
        "price": 17.5,
        "description": "Slow-cooked arborio rice with porcini mushrooms, parmesan and a splash of white wine.",
        "ingredients": [
            "arborio rice",
            "porcini mushrooms",
            "parmesan",
            "butter",
            "white wine",
            "vegetable stock",
            "celery",
            "shallots",
        ],
        "allergens": ["milk", "sulphites", "celery"],
        "may_contain": [],
        "dietary_tags": ["vegetarian", "gluten_free"],
    },
    {
        "name": "Lamb Khorovats",
        "category": "Mains",
        "price": 21.0,
        "description": "Armenian-style charcoal-grilled lamb skewers with grilled peppers and tomatoes, sumac onions and lavash.",
        "ingredients": ["lamb", "grilled peppers", "grilled tomatoes", "red onion", "sumac", "lavash bread"],
        "allergens": ["gluten"],
        "may_contain": ["sesame"],
        "dietary_tags": ["halal"],
    },
    {
        "name": "Seafood Linguine",
        "category": "Mains",
        "price": 23.5,
        "description": "Fresh egg linguine with mussels, clams, prawns and squid in garlic, white wine and cherry tomato.",
        "ingredients": [
            "egg linguine",
            "mussels",
            "clams",
            "prawns",
            "squid",
            "garlic",
            "white wine",
            "cherry tomatoes",
            "parsley",
        ],
        "allergens": ["gluten", "eggs", "crustaceans", "molluscs", "sulphites"],
        "may_contain": ["fish"],
        "dietary_tags": [],
    },
    {
        "name": "Vegan Buddha Bowl",
        "category": "Mains",
        "price": 15.5,
        "description": "Quinoa, roasted sweet potato, chickpeas, kale and avocado with pumpkin seeds and tahini dressing.",
        "ingredients": [
            "quinoa",
            "roasted sweet potato",
            "chickpeas",
            "kale",
            "avocado",
            "pumpkin seeds",
            "tahini dressing",
        ],
        "allergens": ["sesame"],
        "may_contain": ["tree_nuts"],
        "dietary_tags": ["vegan", "gluten_free"],
    },
    {
        "name": "Truffle Tagliatelle",
        "category": "Mains",
        "price": 26.0,
        "description": "Fresh egg tagliatelle with black truffle, butter and parmesan.",
        "ingredients": ["egg tagliatelle", "black truffle", "butter", "parmesan"],
        "allergens": ["gluten", "eggs", "milk"],
        "may_contain": [],
        "dietary_tags": ["vegetarian"],
        "available": False,
    },
    # Desserts
    {
        "name": "Tiramisu",
        "category": "Desserts",
        "price": 8.5,
        "description": "Espresso-soaked ladyfingers layered with mascarpone cream and cocoa.",
        "ingredients": ["mascarpone", "eggs", "savoiardi biscuits", "espresso", "cocoa", "marsala wine"],
        "allergens": ["milk", "eggs", "gluten", "sulphites"],
        "may_contain": [],
        "dietary_tags": ["vegetarian"],
    },
    {
        "name": "Pistachio Baklava",
        "category": "Desserts",
        "price": 7.5,
        "description": "Crisp filo layered with pistachios and walnuts, soaked in honey syrup.",
        "ingredients": ["filo pastry", "pistachios", "walnuts", "butter", "honey syrup", "cinnamon"],
        "allergens": ["tree_nuts", "gluten", "milk"],
        "may_contain": ["peanuts", "sesame"],
        "dietary_tags": ["vegetarian"],
    },
    {
        "name": "Mango Sorbet",
        "category": "Desserts",
        "price": 6.5,
        "description": "Refreshing sorbet made from ripe Alphonso mango and a squeeze of lime.",
        "ingredients": ["mango", "sugar", "lime juice"],
        "allergens": [],
        "may_contain": ["milk"],
        "dietary_tags": ["vegan", "gluten_free"],
    },
    # Drinks
    {
        "name": "Fresh Mint Lemonade",
        "category": "Drinks",
        "price": 4.5,
        "description": "House-squeezed lemonade with fresh mint and sparkling water.",
        "ingredients": ["lemons", "fresh mint", "cane sugar", "sparkling water"],
        "allergens": [],
        "may_contain": [],
        "dietary_tags": ["vegan", "gluten_free"],
    },
    {
        "name": "Armenian Coffee",
        "category": "Drinks",
        "price": 3.5,
        "description": "Strong, finely ground coffee brewed in a jazzve with a hint of cardamom.",
        "ingredients": ["finely ground coffee", "cardamom", "water"],
        "allergens": [],
        "may_contain": [],
        "dietary_tags": ["vegan", "gluten_free"],
    },
]

KNOWLEDGE: list[dict] = [
    {
        "title": "Opening hours",
        "content": "Monday to Thursday 12:00 to 22:00. Friday and Saturday 12:00 to 23:30. "
        "Sunday 12:00 to 21:00. The kitchen takes last orders 30 minutes before closing.",
    },
    {
        "title": "Wi-Fi",
        "content": "The guest network is LanternGuest and the password is noodles2026.",
    },
    {
        "title": "Allergy policy",
        "content": "Our kitchen handles peanuts, tree nuts, sesame, gluten, milk, eggs, fish and shellfish. "
        "We prepare allergy orders separately where we can, but we cannot guarantee that any dish is "
        "completely free from traces. Guests with severe allergies should speak to the manager on duty.",
    },
    {
        "title": "Payment and tipping",
        "content": "We accept cards, Apple Pay, Google Pay and cash. Service is not included and tipping "
        "is optional. To pay, ask for the bill and a server brings the card machine to the table.",
    },
    {
        "title": "Happy hour",
        "content": "On weekdays from 17:00 to 19:00 lemonade and coffee are half price, and you get a free "
        "Hummus with Warm Pita with any two mains.",
    },
    {
        "title": "Families and pets",
        "content": "High chairs and a small kids' menu are available on request. Well-behaved dogs are "
        "welcome on the terrace.",
    },
]

TABLES = ["Table 1", "Table 2"]

BUILTIN_MENU: dict = {
    "restaurant": {"name": DEMO_RESTAURANT, "currency": "USD"},
    "dishes": DISHES,
    "knowledge": KNOWLEDGE,
}

# The printed demo menu lives at <repo>/demo/ (menu.json, photos/, menu.pdf).
DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"

# Dish fields from docs/API.md plus `photo` (path relative to demo/). id / photo_url /
# timestamps are tolerated and ignored, anything else is rejected.
_DISH_KEYS = {
    "name",
    "description",
    "category",
    "price",
    "ingredients",
    "allergens",
    "may_contain",
    "dietary_tags",
    "photo",
    "available",
    "id",
    "photo_url",
    "created_at",
    "updated_at",
}


class MenuFileError(ValueError):
    pass


def validate_menu(menu: dict, source: str = "menu") -> dict:
    """Check a menu document and normalise it. Raises MenuFileError on any unknown id."""
    if not isinstance(menu, dict) or not isinstance(menu.get("dishes"), list):
        raise MenuFileError(f"{source}: expected an object with a 'dishes' list")
    restaurant = menu.get("restaurant") or {}
    if not str(restaurant.get("name", "")).strip():
        raise MenuFileError(f"{source}: restaurant.name is required")
    allergens, tags = set(ALLERGEN_IDS), set(DIETARY_TAG_IDS)
    seen: set[str] = set()
    dishes = []
    for i, d in enumerate(menu["dishes"]):
        where = f"{source}: dishes[{i}] ({d.get('name', '?')!r})"
        name = str(d.get("name", "")).strip()
        if not name:
            raise MenuFileError(f"{where}: name is required")
        if name.lower() in seen:
            raise MenuFileError(f"{where}: duplicate dish name")
        seen.add(name.lower())
        unknown_keys = set(d) - _DISH_KEYS
        if unknown_keys:
            raise MenuFileError(f"{where}: unknown field(s) {sorted(unknown_keys)}")
        for field in ("allergens", "may_contain"):
            bad = [a for a in d.get(field, []) if a not in allergens]
            if bad:
                raise MenuFileError(f"{where}: unknown allergen id(s) in {field}: {bad}")
        bad_tags = [t for t in d.get("dietary_tags", []) if t not in tags]
        if bad_tags:
            raise MenuFileError(f"{where}: unknown dietary tag id(s): {bad_tags}")
        price = d.get("price", 0)
        if not isinstance(price, int | float) or price < 0:
            raise MenuFileError(f"{where}: price must be a non-negative number")
        dishes.append(
            {
                "name": name,
                "description": str(d.get("description", "")),
                "category": str(d.get("category") or "Other"),
                "price": float(price),
                "ingredients": [str(x) for x in d.get("ingredients", [])],
                "allergens": list(dict.fromkeys(d.get("allergens", []))),
                "may_contain": list(dict.fromkeys(d.get("may_contain", []))),
                "dietary_tags": list(dict.fromkeys(d.get("dietary_tags", []))),
                "available": bool(d.get("available", True)),
                "photo": d.get("photo"),
            }
        )
    knowledge = []
    for k in menu.get("knowledge", []):
        if not str(k.get("title", "")).strip():
            raise MenuFileError(f"{source}: every knowledge item needs a title")
        knowledge.append({"title": k["title"].strip(), "content": str(k.get("content", ""))})
    return {
        "restaurant": {"name": restaurant["name"].strip(), "currency": restaurant.get("currency") or "USD"},
        "dishes": dishes,
        "knowledge": knowledge,
    }


def load_demo_menu(demo_dir: Path = DEMO_DIR) -> tuple[dict, Path | None]:
    """The printed demo menu if <repo>/demo/menu.json exists, else the built-in one."""
    path = demo_dir / "menu.json"
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise MenuFileError(f"{path}: not valid JSON ({e})") from e
        return validate_menu(raw, str(path)), demo_dir
    return validate_menu(BUILTIN_MENU, "built-in menu"), None


def _install_photo(dish: Dish, photo: str | None, base_dir: Path | None) -> str | None:
    """Copy a menu photo into the media dir (named by content hash, so re-runs are no-ops).
    Returns a warning instead of failing when the file is missing or unreadable."""
    if not photo or base_dir is None:
        return None
    src = (base_dir / photo).resolve()
    if not src.is_relative_to(base_dir.resolve()):
        raise MenuFileError(f"photo for {dish.name!r} points outside {base_dir}: {photo}")
    if not src.is_file():
        return f"photo for {dish.name!r} not found ({base_dir / photo}); dish seeded without it"
    data = src.read_bytes()
    rel = f"dishes/{dish.id}-{hashlib.sha1(data).hexdigest()[:10]}.jpg"
    if dish.photo_path == rel and (settings.media_dir / rel).is_file():
        return None
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        return f"photo for {dish.name!r} is not a readable image ({src}); skipped"
    img.thumbnail((1600, 1600))
    (settings.media_dir / "dishes").mkdir(parents=True, exist_ok=True)
    img.save(settings.media_dir / rel, "JPEG", quality=86, optimize=True)
    if dish.photo_path and dish.photo_path != rel:
        (settings.media_dir / dish.photo_path).unlink(missing_ok=True)
    dish.photo_path = rel
    return None


def seed(db: Session, menu: dict | None = None, photo_dir: Path | None = None) -> dict:
    """Create or sync the demo owner, restaurant, menu, notes and tables.

    The demo restaurant mirrors the menu document: dishes and notes are matched by
    name / title and updated in place; ones no longer in the document are removed.
    """
    menu = validate_menu(menu, "menu") if menu is not None else validate_menu(BUILTIN_MENU, "built-in menu")
    info = menu["restaurant"]

    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = create_owner(db, DEMO_EMAIL, DEMO_PASSWORD, info["name"])
    else:
        user.password_hash = hasher.hash(DEMO_PASSWORD)
    restaurant = db.get(Restaurant, user.restaurant_id)
    restaurant.name = info["name"]
    restaurant.currency = info["currency"]

    existing = {d.name: d for d in db.scalars(select(Dish).where(Dish.restaurant_id == restaurant.id))}
    dishes, photos = [], []
    for data in menu["dishes"]:
        dish = existing.pop(data["name"], None) or Dish(restaurant_id=restaurant.id)
        for key, value in data.items():
            if key != "photo":
                setattr(dish, key, value)
        db.add(dish)
        dishes.append(dish)
        photos.append(data["photo"])
    for stale in existing.values():
        if stale.photo_path:
            (settings.media_dir / stale.photo_path).unlink(missing_ok=True)
        db.delete(stale)
    db.flush()  # dish ids for photo file names
    warnings = []
    for dish, photo in zip(dishes, photos, strict=True):
        if warning := _install_photo(dish, photo, photo_dir):
            warnings.append(warning)
    vecs = rag.embed([rag.dish_document(d) for d in dishes]) if dishes else []
    for dish, vec in zip(dishes, vecs, strict=True):
        dish.embedding = rag.to_blob(vec)

    notes = {k.title: k for k in db.scalars(select(KnowledgeItem).where(KnowledgeItem.restaurant_id == restaurant.id))}
    for data in menu["knowledge"]:
        item = notes.pop(data["title"], None) or KnowledgeItem(restaurant_id=restaurant.id, title=data["title"])
        item.content = data["content"]
        db.add(item)
        rag.reindex_knowledge(item)
    for stale in notes.values():
        db.delete(stale)

    tables = {t.label: t for t in db.scalars(select(DiningTable).where(DiningTable.restaurant_id == restaurant.id))}
    for label in TABLES:
        if label not in tables:
            tables[label] = DiningTable(restaurant_id=restaurant.id, label=label, token=new_token())
            db.add(tables[label])
    db.commit()
    return {
        "email": DEMO_EMAIL,
        "password": DEMO_PASSWORD,
        "restaurant_id": restaurant.id,
        "restaurant": restaurant.name,
        "dishes": len(dishes),
        "photos": sum(1 for d in dishes if d.photo_path),
        "notes": len(menu["knowledge"]),
        "tables": [{"label": label, "token": tables[label].token} for label in TABLES],
        "warnings": warnings,
    }
