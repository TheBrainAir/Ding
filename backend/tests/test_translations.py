"""Table endpoints carry the session-language dish names when cached, null otherwise."""

from fastapi.testclient import TestClient

from app.main import app
from app.models import Dish, DishTranslation
from app.services import translate
from tests.conftest import call, dish_id
from tests.fixtures import PEANUT_DISH


def test_table_endpoint_local_names(db, demo, ctx):
    call(ctx, "set_allergies", allergens=[], notes="", none_declared=True)
    call(
        ctx, "add_to_order", dish_id=dish_id(db, PEANUT_DISH), quantity=1, notes="", guest_confirmed_allergen_risk=False
    )
    dish = db.get(Dish, dish_id(db, PEANUT_DISH))
    db.add(
        DishTranslation(
            dish_id=dish.id,
            restaurant_id=dish.restaurant_id,
            language="ru",
            name="Лапша с арахисом",
            description="Рисовая лапша.",
            source_hash=translate.source_hash(dish),
        )
    )
    ctx.session.language = "ru"
    db.commit()
    with TestClient(app) as client:
        item = client.get(f"/api/table/{demo['table'].token}").json()["session"]["order"]["items"][0]
        assert item["local_name"] == "Лапша с арахисом" and item["name"] == PEANUT_DISH

        ctx.session.language = "en"  # the menu language: no local names
        db.commit()
        item = client.get(f"/api/table/{demo['table'].token}").json()["session"]["order"]["items"][0]
        assert item["local_name"] is None

        dish.name = "Renamed"  # an edited dish invalidates its translation
        ctx.session.language = "ru"
        db.commit()
        item = client.get(f"/api/table/{demo['table'].token}").json()["session"]["order"]["items"][0]
        assert item["local_name"] is None
