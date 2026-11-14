"""The allergy guard is enforced by the server, whatever the model decides to do."""

from sqlalchemy import select

from app.models import Order
from tests.conftest import call, dish_id
from tests.fixtures import (
    MUSHROOM_DISH,
    PEANUT_DISH,
    SAFE_DESSERT,
    SHELLFISH_DISH,
    TRACE_PEANUT_DISH,
    UNAVAILABLE_DISH,
    VEGAN_DISH,
    VEGETARIAN_DISH,
)


def add(ctx, db, name, confirmed=False, quantity=1):
    return call(
        ctx,
        "add_to_order",
        dish_id=dish_id(db, name),
        quantity=quantity,
        notes="",
        guest_confirmed_allergen_risk=confirmed,
    )


def set_allergies(ctx, allergens=(), notes="", none_declared=False):
    return call(ctx, "set_allergies", allergens=list(allergens), notes=notes, none_declared=none_declared)


def test_add_refused_before_allergies_recorded(ctx, db):
    out = add(ctx, db, VEGETARIAN_DISH)
    assert out.is_error
    assert out.result["error"] == "allergies_not_recorded"
    assert db.scalars(select(Order)).all() == []


def test_add_refused_even_with_confirmation_flag(ctx, db):
    out = add(ctx, db, VEGETARIAN_DISH, confirmed=True)
    assert out.result["error"] == "allergies_not_recorded"


def test_place_refused_before_allergies_recorded(ctx):
    out = call(ctx, "place_order")
    assert out.is_error and out.result["error"] == "allergies_not_recorded"


def test_update_refused_before_allergies_recorded(ctx):
    out = call(ctx, "update_order_item", item_id=1, quantity=2, notes=None, guest_confirmed_allergen_risk=True)
    assert out.result["error"] == "allergies_not_recorded"


def test_empty_allergy_answer_is_not_a_record(ctx):
    out = set_allergies(ctx)
    assert out.is_error and out.result["error"] == "empty_answer"
    assert ctx.session.allergies_confirmed is False


def test_contains_conflict_is_blocked_with_safe_alternatives(ctx, db):
    assert not set_allergies(ctx, ["peanuts"]).is_error
    out = add(ctx, db, PEANUT_DISH)
    assert out.is_error
    assert out.result["blocked"] == "allergen_conflict"
    assert {"allergen": "peanuts", "source": "contains"} in out.result["conflicts"]
    alternatives = out.result["safe_alternatives"]
    assert alternatives
    from app.models import Dish

    for alt in alternatives:
        d = db.get(Dish, alt["dish_id"])
        assert "peanuts" not in d.allergens and "peanuts" not in d.may_contain
    assert db.scalars(select(Order)).all() == []


def test_may_contain_conflict_is_blocked(ctx, db):
    set_allergies(ctx, ["peanuts"])
    out = add(ctx, db, TRACE_PEANUT_DISH)  # may contain peanuts
    assert out.result["blocked"] == "allergen_conflict"
    assert out.result["conflicts"] == [{"allergen": "peanuts", "source": "may_contain"}]


def test_confirmed_risk_is_added_flagged_and_reaches_the_kitchen(ctx, db):
    set_allergies(ctx, ["peanuts"], notes="mild peanut allergy, accepts the risk")
    out = add(ctx, db, PEANUT_DISH, confirmed=True)
    assert out.result["ok"] is True
    assert out.result["allergen_risk_accepted"]
    safe = add(ctx, db, SAFE_DESSERT)
    assert safe.result["ok"] is True

    placed = call(ctx, "place_order")
    assert placed.result["ok"] is True
    order = db.scalars(select(Order)).one()
    assert order.status == "placed"
    assert order.allergens == ["peanuts"]
    assert order.allergy_note == "mild peanut allergy, accepts the risk"
    flags = {i.name: i.allergen_flag for i in order.items}
    assert flags == {PEANUT_DISH: True, SAFE_DESSERT: False}


def test_safe_dish_is_added_unflagged(ctx, db):
    set_allergies(ctx, none_declared=True)
    out = add(ctx, db, PEANUT_DISH, quantity=2)
    assert out.result["ok"] is True
    item = out.result["order"]["items"][0]
    assert item["quantity"] == 2 and item["allergen_risk_accepted"] is False
    assert ctx.session.none_declared is True


def test_allergies_changed_after_adding_block_placing(ctx, db):
    set_allergies(ctx, none_declared=True)
    add(ctx, db, PEANUT_DISH)
    changed = set_allergies(ctx, ["peanuts"])
    assert changed.result["draft_items_now_conflicting"][0]["name"] == PEANUT_DISH

    blocked = call(ctx, "place_order")
    assert blocked.result["blocked"] == "allergen_conflict"

    item_id = blocked.result["items"][0]["item_id"]
    call(ctx, "update_order_item", item_id=item_id, quantity=1, notes=None, guest_confirmed_allergen_risk=True)
    assert call(ctx, "place_order").result["ok"] is True


def test_notes_add_eu_allergens(ctx, db):
    out = set_allergies(ctx, [], notes="severe shellfish allergy")
    recorded = out.result["recorded"]["allergens"]
    assert "crustaceans" in recorded and "molluscs" in recorded
    assert add(ctx, db, SHELLFISH_DISH).result["blocked"] == "allergen_conflict"


def test_notes_food_word_matches_ingredients(ctx, db):
    set_allergies(ctx, [], notes="cannot eat mushrooms")
    out = add(ctx, db, MUSHROOM_DISH)
    assert out.result["blocked"] == "allergen_conflict"
    assert out.result["conflicts"][0]["source"] == "ingredient"
    assert add(ctx, db, VEGETARIAN_DISH).result["ok"] is True


def test_diet_in_notes_requires_tag(ctx, db):
    set_allergies(ctx, [], notes="vegetarian")
    assert add(ctx, db, PEANUT_DISH).result["blocked"] == "allergen_conflict"
    assert add(ctx, db, VEGETARIAN_DISH).result["ok"] is True
    assert add(ctx, db, VEGAN_DISH).result["ok"] is True


def test_unavailable_dish_is_refused(ctx, db):
    set_allergies(ctx, none_declared=True)
    out = add(ctx, db, UNAVAILABLE_DISH)
    assert out.is_error and out.result["error"] == "unavailable"


def test_search_results_flag_conflicts(ctx):
    set_allergies(ctx, ["peanuts"])
    out = call(ctx, "search_menu", query="noodles with peanuts", category=None)
    top = out.result["results"][0]
    assert top["name"] == PEANUT_DISH
    assert top["conflicts_with_guest_allergies"] == [{"allergen": "peanuts", "source": "contains"}]


def test_invalid_tool_input_is_a_tool_error(ctx):
    out = call(ctx, "add_to_order", dish_id="seven", quantity=1, notes="", guest_confirmed_allergen_risk=False)
    assert out.is_error and out.result["error"] == "invalid_input"
