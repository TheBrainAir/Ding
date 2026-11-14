"""A small, fixed test menu. Tests never depend on the demo seed or demo/menu.json."""

PEANUT_DISH = "Peanut Noodles"  # contains peanuts
TRACE_PEANUT_DISH = "Pistachio Pastry"  # may contain peanuts
SAFE_DESSERT = "Fruit Sorbet"
SHELLFISH_DISH = "Garlic Prawns"
MUSHROOM_DISH = "Mushroom Risotto"
VEGETARIAN_DISH = "Tomato Pizza"
VEGAN_DISH = "Grain Bowl"
FISH_DISH = "Grilled Salmon"
LAMB_DISH = "Lamb Skewers"
COFFEE = "House Coffee"
UNAVAILABLE_DISH = "Seasonal Truffle Pasta"


def _dish(name, category, price, description, ingredients, allergens=(), may_contain=(), tags=(), **extra):
    return {
        "name": name,
        "category": category,
        "price": price,
        "description": description,
        "ingredients": list(ingredients),
        "allergens": list(allergens),
        "may_contain": list(may_contain),
        "dietary_tags": list(tags),
        "photo": None,
        **extra,
    }


TEST_MENU = {
    "restaurant": {"name": "Test Bistro", "tagline": "for tests", "currency": "USD"},
    "dishes": [
        _dish(
            SHELLFISH_DISH,
            "Starters",
            15.0,
            "Tiger prawns in garlic butter with chili.",
            ["tiger prawns", "garlic", "butter", "chili flakes"],
            ["crustaceans", "milk"],
            tags=["spicy"],
        ),
        _dish(
            PEANUT_DISH,
            "Mains",
            14.5,
            "Stir-fried rice noodles with tofu, egg and crushed peanuts.",
            ["rice noodles", "peanuts", "egg", "tofu", "bean sprouts"],
            ["peanuts", "eggs", "soy"],
            ["sesame"],
        ),
        _dish(
            MUSHROOM_DISH,
            "Mains",
            17.5,
            "Creamy arborio rice with porcini mushrooms and parmesan.",
            ["arborio rice", "porcini mushrooms", "parmesan", "butter"],
            ["milk"],
            tags=["vegetarian", "gluten_free"],
        ),
        _dish(
            VEGETARIAN_DISH,
            "Mains",
            13.0,
            "Wood-fired pizza with tomato, mozzarella and basil.",
            ["wheat dough", "tomato", "mozzarella", "basil"],
            ["gluten", "milk"],
            tags=["vegetarian"],
        ),
        _dish(
            VEGAN_DISH,
            "Mains",
            15.5,
            "Quinoa, chickpeas and kale with tahini dressing.",
            ["quinoa", "chickpeas", "kale", "tahini"],
            ["sesame"],
            tags=["vegan", "gluten_free"],
        ),
        _dish(
            FISH_DISH,
            "Mains",
            22.0,
            "Salmon fillet with lemon dill cream sauce.",
            ["salmon fillet", "dill", "lemon", "cream"],
            ["fish", "milk"],
            tags=["gluten_free"],
        ),
        _dish(
            LAMB_DISH,
            "Mains",
            21.0,
            "Charcoal-grilled lamb skewers with peppers and flatbread.",
            ["lamb", "peppers", "red onion", "flatbread"],
            ["gluten"],
            tags=["halal"],
        ),
        _dish(
            UNAVAILABLE_DISH,
            "Mains",
            26.0,
            "Fresh pasta with black truffle.",
            ["egg pasta", "black truffle", "butter"],
            ["gluten", "eggs", "milk"],
            available=False,
        ),
        _dish(
            TRACE_PEANUT_DISH,
            "Desserts",
            7.5,
            "Crisp filo pastry with pistachios and honey.",
            ["filo pastry", "pistachios", "butter", "honey"],
            ["tree_nuts", "gluten", "milk"],
            ["peanuts"],
            tags=["vegetarian"],
        ),
        _dish(
            SAFE_DESSERT,
            "Desserts",
            6.5,
            "Mango sorbet with lime.",
            ["mango", "sugar", "lime juice"],
            tags=["vegan", "gluten_free"],
        ),
        _dish(COFFEE, "Drinks", 3.5, "Strong black coffee.", ["coffee", "water"], tags=["vegan"]),
    ],
    "knowledge": [
        {"title": "Opening hours", "content": "Open every day from 12:00 to 22:00. Last orders at 21:30."},
        {"title": "Wi-Fi", "content": "The guest network is BistroGuest and the password is testing123."},
        {"title": "Payment", "content": "We accept cards and cash. Tipping is optional."},
    ],
}
