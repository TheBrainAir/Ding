"""Order lifecycle: draft -> placed -> preparing -> served, with dashboard events."""

import asyncio
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api import orders as orders_api
from app.events import bus
from app.models import GuestSession, Order
from app.schemas import OrderPatch
from app.services import guest_sessions
from tests.conftest import call, dish_id
from tests.fixtures import FISH_DISH, PEANUT_DISH, SAFE_DESSERT


def drain(q: asyncio.Queue) -> list[tuple[str, dict]]:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


async def test_order_lifecycle_and_events(db, ctx, demo):
    bus.bind_loop(asyncio.get_running_loop())
    q = bus.subscribe(ctx.restaurant.id)
    r = ctx.restaurant
    try:
        call(ctx, "set_allergies", allergens=["peanuts"], notes="severe", none_declared=False)
        call(
            ctx,
            "add_to_order",
            dish_id=dish_id(db, FISH_DISH),
            quantity=2,
            notes="no sauce",
            guest_confirmed_allergen_risk=False,
        )
        call(
            ctx,
            "add_to_order",
            dish_id=dish_id(db, SAFE_DESSERT),
            quantity=1,
            notes="",
            guest_confirmed_allergen_risk=False,
        )

        # Drafts are invisible to the kitchen.
        assert orders_api.list_orders(status=None, limit=200, r=r, db=db) == []
        assert len(orders_api.list_orders(status="draft", limit=200, r=r, db=db)) == 1

        placed = call(ctx, "place_order")
        assert placed.result["ok"] is True
        ctx.flush_events()
        events = drain(q)
        assert [name for name, _ in events] == ["order.placed"]
        order = events[0][1]
        assert order["status"] == "placed" and order["table_label"] == demo["table"].label
        assert order["total"] == 22.0 * 2 + 6.5
        assert order["allergies"] == ["peanuts"] and order["allergy_note"] == "severe"
        assert [i["notes"] for i in order["items"]] == ["no sauce", ""]
        assert order["placed_at"] and order["currency"] == "USD"

        listed = orders_api.list_orders(status=None, limit=200, r=r, db=db)
        assert [o["id"] for o in listed] == [order["id"]]

        for status in ("preparing", "served"):
            updated = orders_api.update_order(order["id"], OrderPatch(status=status), r=r, db=db)
            assert updated["status"] == status
        assert [(n, d["status"]) for n, d in drain(q)] == [("order.updated", "preparing"), ("order.updated", "served")]
        assert orders_api.list_orders(status="placed,preparing", limit=200, r=r, db=db) == []

        # A second round in the same visit starts a new draft.
        call(
            ctx,
            "add_to_order",
            dish_id=dish_id(db, SAFE_DESSERT),
            quantity=1,
            notes="",
            guest_confirmed_allergen_risk=False,
        )
        drafts = db.scalars(select(Order).where(Order.status == "draft")).all()
        assert len(drafts) == 1 and drafts[0].id != order["id"]
        with pytest.raises(HTTPException) as exc:
            orders_api.update_order(drafts[0].id, OrderPatch(status="preparing"), r=r, db=db)
        assert exc.value.status_code == 409
    finally:
        bus.unsubscribe(ctx.restaurant.id, q)


def test_flagged_items_reach_the_ticket(db, ctx):
    call(ctx, "set_allergies", allergens=["peanuts"], notes="", none_declared=False)
    call(
        ctx, "add_to_order", dish_id=dish_id(db, PEANUT_DISH), quantity=1, notes="", guest_confirmed_allergen_risk=True
    )
    call(ctx, "place_order")
    order = orders_api.list_orders(status=None, limit=200, r=ctx.restaurant, db=db)[0]
    assert order["items"][0]["allergen_flag"] is True


def test_session_closes_after_order_and_silence(db, ctx, demo):
    call(ctx, "set_allergies", allergens=[], notes="", none_declared=True)
    call(
        ctx,
        "add_to_order",
        dish_id=dish_id(db, SAFE_DESSERT),
        quantity=1,
        notes="",
        guest_confirmed_allergen_risk=False,
    )
    assert guest_sessions.active_session(db, demo["table"]) is not None
    ctx.session.last_activity_at -= timedelta(minutes=11)
    db.commit()
    # Quiet, but nothing was sent to the kitchen yet: still the same guest.
    assert guest_sessions.active_session(db, demo["table"]) is not None
    call(ctx, "place_order")
    ctx.session.last_activity_at -= timedelta(minutes=11)
    db.commit()
    assert guest_sessions.active_session(db, demo["table"]) is None
    assert db.get(GuestSession, ctx.session.id).status == "closed"
    fresh, created = guest_sessions.get_or_create(db, demo["table"], demo["restaurant"])
    assert created and fresh.id != ctx.session.id and fresh.allergies_confirmed is False
