"""Cross-language retrieval: guest words in Russian, Spanish or Armenian find the English dish."""

import pytest

from app.models import Dish
from app.services import rag
from tests.conftest import dish_id
from tests.fixtures import (
    FISH_DISH,
    LAMB_DISH,
    MUSHROOM_DISH,
    PEANUT_DISH,
    SAFE_DESSERT,
    SHELLFISH_DISH,
    UNAVAILABLE_DISH,
    VEGETARIAN_DISH,
)

CASES = [
    # Russian
    ("ru", "грибное ризотто", MUSHROOM_DISH),
    ("ru", "лосось", FISH_DISH),
    ("ru", "шашлык из баранины", LAMB_DISH),
    ("ru", "креветки с чесноком", SHELLFISH_DISH),
    # Spanish
    ("es", "sorbete de mango", SAFE_DESSERT),
    ("es", "brochetas de cordero", LAMB_DISH),
    ("es", "fideos con cacahuetes", PEANUT_DISH),
    ("es", "salmón a la plancha", FISH_DISH),
    # Armenian
    ("hy", "պիցցա", VEGETARIAN_DISH),
    ("hy", "գառան խորոված", LAMB_DISH),
    ("hy", "սնկով ռիզոտո", MUSHROOM_DISH),
    ("hy", "ծովախեցգետին սխտորով", SHELLFISH_DISH),
]


@pytest.mark.parametrize(("lang", "query", "expected"), CASES, ids=[f"{c[0]}:{c[2]}" for c in CASES])
def test_foreign_query_finds_english_dish(db, demo, lang, query, expected):
    hits = rag.search_dishes(db, demo["restaurant"].id, query, k=3)
    assert hits[0][0].name == expected, [d.name for d, _ in hits]


@pytest.mark.parametrize(
    ("query", "title"),
    [
        ("во сколько вы закрываетесь", "Opening hours"),
        ("¿cuál es la contraseña del wifi?", "Wi-Fi"),
        ("կարո՞ղ եմ վճարել քարտով", "Payment"),
    ],
)
def test_foreign_query_finds_restaurant_note(db, demo, query, title):
    hits = rag.search_knowledge(db, demo["restaurant"].id, query, k=1)
    assert hits[0][0].text.startswith(f"{title}:")


def test_unavailable_dishes_are_never_returned(db, demo):
    names = [d.name for d, _ in rag.search_dishes(db, demo["restaurant"].id, "black truffle pasta", k=20)]
    assert UNAVAILABLE_DISH not in names


def test_category_filter_and_reindex_on_update(db, demo):
    rid = demo["restaurant"].id
    hits = rag.search_dishes(db, rid, "something sweet", category="desserts", k=5)
    assert {d.category for d, _ in hits} == {"Desserts"}

    dish = db.get(Dish, dish_id(db, LAMB_DISH))
    dish.description = "Smoky charcoal-grilled octopus with paprika."
    dish.ingredients = ["octopus", "paprika", "olive oil"]
    rag.reindex_dish(dish)
    db.commit()
    assert rag.search_dishes(db, rid, "pulpo a la brasa", k=1)[0][0].id == dish.id


def test_index_rebuilds_when_the_model_changes(db, demo):
    from app.models import AppMeta

    db.merge(AppMeta(key=rag.INDEX_KEY, value="some-older-model"))
    db.commit()
    assert rag.ensure_index(db) is True
    assert rag.ensure_index(db) is False
