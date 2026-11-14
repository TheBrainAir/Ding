"""The waiter's tools: definitions sent to Claude and their server-side execution.

Tools never raise into the agent loop. Every failure, including a guard refusal,
comes back as a tool result the model can act on (usually by asking the guest).
Each tool commits its own effects (a failing tool rolls back only itself); there is
no await inside a tool, so a barge-in cancellation can never split one. Dashboard
events are queued and published by the caller via ToolContext.flush_events().
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import ALLERGEN_IDS, Allergen
from app.events import bus
from app.models import Dish, GuestSession, Order, OrderItem, Restaurant, WaiterCall, utcnow
from app.serializers import order_out, session_summary_out, waiter_call_out
from app.services import allergy, rag

log = logging.getLogger(__name__)

MAX_QUANTITY = 20

_NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}


def _tool(name: str, description: str, properties: dict) -> dict:
    return {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        },
    }


# Order and text are frozen: changing a definition mid-session would break the
# cached / thinking-bound prefix of every open conversation.
TOOLS: list[dict] = [
    _tool(
        "search_menu",
        "Search this restaurant's menu by meaning: a dish, an ingredient, a taste, a diet "
        "or a craving. Call it before recommending or describing any dish, and whenever the "
        "guest asks what is in a dish or what they can eat. Write the query in the menu's "
        "language. Returns up to 5 available dishes with ingredients, allergens, may_contain "
        "(possible traces), dietary tags, price, and conflicts with the guest's recorded "
        "allergies.",
        {
            "query": {"type": "string", "description": "What to look for, in the menu's language."},
            "category": {
                **_NULLABLE_STRING,
                "description": "Optional menu category to restrict to, exactly as in the menu index, or null.",
            },
        },
    ),
    _tool(
        "get_dish",
        "Get the full card of one dish by id (from the menu index or a search result): "
        "description, ingredients, allergens, traces, dietary tags, price, availability.",
        {"dish_id": {"type": "integer"}},
    ),
    _tool(
        "search_restaurant_info",
        "Search the restaurant's own notes: opening hours, wifi, payment and tipping, "
        "promotions, policies, kids, pets, parking. Call it for any question about the "
        "restaurant rather than its dishes.",
        {"query": {"type": "string"}},
    ),
    _tool(
        "set_allergies",
        "Record the guest's answer about food allergies and dietary restrictions. Call it "
        "as soon as the guest answers (or volunteers an allergy), before adding anything to "
        "the order; ordering is refused until it is recorded. Calling it again replaces the "
        "record.",
        {
            "allergens": {
                "type": "array",
                "items": {"type": "string", "enum": ALLERGEN_IDS},
                "description": "Allergens from the fixed list that apply to anyone at the table.",
            },
            "notes": {
                "type": "string",
                "description": "Anything else in English: severity, other foods to avoid, diets "
                "(vegan, vegetarian, halal, kosher). Empty string if nothing to add.",
            },
            "none_declared": {
                "type": "boolean",
                "description": "True only when the guest said there are no allergies or restrictions.",
            },
        },
    ),
    _tool(
        "add_to_order",
        "Add a dish to the guest's order. Refused until set_allergies has been called. If "
        "the dish conflicts with the recorded allergies it is blocked and the result lists the "
        "conflicts and safe alternatives: tell the guest, and only if they explicitly accept "
        "the risk call again with guest_confirmed_allergen_risk=true.",
        {
            "dish_id": {"type": "integer"},
            "quantity": {"type": "integer", "description": "Number of portions, 1 or more."},
            "notes": {
                "type": "string",
                "description": "Preparation notes for the kitchen in English, or empty string.",
            },
            "guest_confirmed_allergen_risk": {
                "type": "boolean",
                "description": "True only after the guest was warned about this dish's allergen "
                "conflict and explicitly accepted it. Otherwise false.",
            },
        },
    ),
    _tool(
        "update_order_item",
        "Change the quantity or notes of an item in the current draft order (quantity 0 "
        "removes it). Set guest_confirmed_allergen_risk=true only when the guest explicitly "
        "accepted an allergen conflict reported for this item.",
        {
            "item_id": {"type": "integer"},
            "quantity": {"type": "integer"},
            "notes": {**_NULLABLE_STRING, "description": "New notes, or null to keep the current ones."},
            "guest_confirmed_allergen_risk": {"type": "boolean"},
        },
    ),
    _tool(
        "remove_from_order",
        "Remove an item from the current draft order.",
        {"item_id": {"type": "integer"}},
    ),
    _tool(
        "get_order",
        "Read the current draft order and the orders already sent to the kitchen this visit.",
        {},
    ),
    _tool(
        "place_order",
        "Send the current draft order to the kitchen. Only call it after reading the whole "
        "order back to the guest (dishes, quantities, total) and hearing an explicit yes.",
        {},
    ),
    _tool(
        "call_human_waiter",
        "Alert the restaurant staff to come to this table: severe allergies or any doubt "
        "about safety, the bill, complaints, or anything you cannot do yourself.",
        {"reason": {"type": "string", "description": "Short reason for the staff, in English."}},
    ),
]

TOOL_NAMES = [t["name"] for t in TOOLS]


# ---------------------------------------------------------------- input validation


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SearchMenuIn(_In):
    query: str
    category: str | None


class GetDishIn(_In):
    dish_id: int


class SearchInfoIn(_In):
    query: str


class SetAllergiesIn(_In):
    allergens: list[Allergen]
    notes: str
    none_declared: bool


class AddToOrderIn(_In):
    dish_id: int
    quantity: int
    notes: str
    guest_confirmed_allergen_risk: bool


class UpdateItemIn(_In):
    item_id: int
    quantity: int
    notes: str | None
    guest_confirmed_allergen_risk: bool


class ItemIdIn(_In):
    item_id: int


class EmptyIn(_In):
    pass


class CallWaiterIn(_In):
    reason: str


_INPUTS: dict[str, type[_In]] = {
    "search_menu": SearchMenuIn,
    "get_dish": GetDishIn,
    "search_restaurant_info": SearchInfoIn,
    "set_allergies": SetAllergiesIn,
    "add_to_order": AddToOrderIn,
    "update_order_item": UpdateItemIn,
    "remove_from_order": ItemIdIn,
    "get_order": EmptyIn,
    "place_order": EmptyIn,
    "call_human_waiter": CallWaiterIn,
}


# ---------------------------------------------------------------- context


@dataclass
class ToolContext:
    db: Session
    session: GuestSession
    restaurant: Restaurant
    shown_dishes: dict[int, Dish] = field(default_factory=dict)
    waiter_calls: list[str] = field(default_factory=list)
    # (event name, ORM object) published after the loop commits
    pending_events: list[tuple[str, Any]] = field(default_factory=list)

    def flush_events(self) -> None:
        """Publish queued dashboard events. Call after db.commit()."""
        rid = self.restaurant.id
        for name, obj in self.pending_events:
            if isinstance(obj, Order):
                data = order_out(obj)
            elif isinstance(obj, WaiterCall):
                data = waiter_call_out(obj)
            elif isinstance(obj, GuestSession):
                data = session_summary_out(self.db, obj)
            else:
                continue
            bus.publish(rid, name, data)
        self.pending_events.clear()


@dataclass
class ToolOutcome:
    result: dict
    is_error: bool = False

    def content(self) -> str:
        return json.dumps(self.result, ensure_ascii=False)


def execute_tool(ctx: ToolContext, name: str, raw_input: Any) -> ToolOutcome:
    model = _INPUTS.get(name)
    if model is None:
        return ToolOutcome({"ok": False, "error": "unknown_tool", "message": f"No tool named {name}."}, True)
    try:
        args = model.model_validate(raw_input if isinstance(raw_input, dict) else {})
    except ValidationError as e:
        return ToolOutcome(
            {"ok": False, "error": "invalid_input", "message": e.errors(include_url=False)[0]["msg"]},
            True,
        )
    try:
        outcome = _HANDLERS[name](ctx, args)
        ctx.db.commit()
        return outcome
    except Exception:  # never let a bug take down the turn
        log.exception("tool %s failed", name)
        ctx.db.rollback()
        ctx.pending_events.clear()
        return ToolOutcome(
            {
                "ok": False,
                "error": "internal_error",
                "message": "The tool failed. Apologise and offer to call a member of staff.",
            },
            True,
        )


# ---------------------------------------------------------------- views for the model


def _dish_view(ctx: ToolContext, d: Dish, *, full: bool = True) -> dict:
    view = {
        "dish_id": d.id,
        "name": d.name,
        "category": d.category,
        "price": d.price,
        "currency": ctx.restaurant.currency,
        "available": d.available,
    }
    if full:
        view.update(
            description=d.description,
            ingredients=list(d.ingredients or []),
            allergens=list(d.allergens or []),
            may_contain=list(d.may_contain or []),
            dietary_tags=list(d.dietary_tags or []),
        )
    if ctx.session.allergies_confirmed:
        view["conflicts_with_guest_allergies"] = allergy.session_conflicts(d, ctx.session)
    return view


def _order_view(o: Order | None) -> dict | None:
    if o is None:
        return None
    return {
        "order_id": o.id,
        "status": o.status,
        "items": [
            {
                "item_id": i.id,
                "dish_id": i.dish_id,
                "name": i.name,
                "quantity": i.quantity,
                "unit_price": i.price,
                "notes": i.notes,
                "allergen_risk_accepted": i.allergen_flag,
            }
            for i in o.items
        ],
        "total": o.total,
        "currency": o.currency,
    }


def _draft(ctx: ToolContext) -> Order | None:
    return ctx.db.scalar(
        select(Order).where(Order.session_id == ctx.session.id, Order.status == "draft").order_by(Order.id.desc())
    )


def _draft_or_create(ctx: ToolContext) -> Order:
    order = _draft(ctx)
    if order is None:
        s = ctx.session
        order = Order(
            restaurant_id=ctx.restaurant.id,
            session_id=s.id,
            table_id=s.table_id,
            table_label=s.table_label,
            status="draft",
            allergens=list(s.allergens or []),
            allergy_note=_allergy_note(s),
            language=s.language,
            currency=ctx.restaurant.currency,
        )
        ctx.db.add(order)
        ctx.db.flush()
    return order


def _allergy_note(s: GuestSession) -> str:
    if s.none_declared and not s.allergens:
        return s.allergy_notes or "No allergies declared"
    return s.allergy_notes or ""


def _get_dish(ctx: ToolContext, dish_id: int) -> Dish | None:
    d = ctx.db.get(Dish, dish_id)
    if d is None or d.restaurant_id != ctx.restaurant.id:
        return None
    return d


def _safe_alternatives(ctx: ToolContext, dish: Dish, k: int = 3) -> list[dict]:
    candidates = [
        d
        for d in ctx.db.scalars(select(Dish).where(Dish.restaurant_id == ctx.restaurant.id, Dish.available.is_(True)))
        if d.id != dish.id and not allergy.session_conflicts(d, ctx.session)
    ]
    if not candidates:
        return []

    def score(d: Dish) -> float:
        same_cat = 1.0 if d.category == dish.category else 0.0
        sim = 0.0
        if d.embedding and dish.embedding:
            sim = float(rag.from_blob(d.embedding) @ rag.from_blob(dish.embedding))
        return same_cat + sim

    candidates.sort(key=score, reverse=True)
    return [{"dish_id": d.id, "name": d.name, "category": d.category, "price": d.price} for d in candidates[:k]]


def _require_allergies(ctx: ToolContext) -> ToolOutcome | None:
    if not ctx.session.allergies_confirmed:
        return ToolOutcome(dict(allergy.ALLERGIES_NOT_RECORDED), True)
    return None


# ---------------------------------------------------------------- handlers


def _search_menu(ctx: ToolContext, a: SearchMenuIn) -> ToolOutcome:
    hits = rag.search_dishes(ctx.db, ctx.restaurant.id, a.query, category=a.category, k=5)
    for d, _ in hits[:3]:
        ctx.shown_dishes.setdefault(d.id, d)
    return ToolOutcome(
        {
            "ok": True,
            "allergies_recorded": ctx.session.allergies_confirmed,
            "results": [_dish_view(ctx, d) for d, _ in hits],
        }
    )


def _get_dish_handler(ctx: ToolContext, a: GetDishIn) -> ToolOutcome:
    d = _get_dish(ctx, a.dish_id)
    if d is None:
        return ToolOutcome(
            {"ok": False, "error": "not_found", "message": "No dish with that id. Use search_menu."}, True
        )
    ctx.shown_dishes.setdefault(d.id, d)
    return ToolOutcome({"ok": True, "dish": _dish_view(ctx, d)})


def _search_info(ctx: ToolContext, a: SearchInfoIn) -> ToolOutcome:
    hits = rag.search_knowledge(ctx.db, ctx.restaurant.id, a.query, k=3)
    return ToolOutcome({"ok": True, "results": [c.text for c, _ in hits]})


def _set_allergies(ctx: ToolContext, a: SetAllergiesIn) -> ToolOutcome:
    notes = a.notes.strip()
    allergens = [x for x in ALLERGEN_IDS if x in set(a.allergens)]
    inferred = [x for x in allergy.allergens_from_notes(notes) if x not in allergens]
    allergens = [x for x in ALLERGEN_IDS if x in set(allergens) | set(inferred)]
    if not allergens and not notes and not a.none_declared:
        return ToolOutcome(
            {
                "ok": False,
                "error": "empty_answer",
                "message": "Nothing to record. Pass the allergens and/or notes the guest gave, "
                "or none_declared=true if they said they have none.",
            },
            True,
        )
    s = ctx.session
    s.allergens = allergens
    s.allergy_notes = notes
    s.none_declared = bool(a.none_declared and not allergens and not notes)
    s.allergies_confirmed = True

    now_conflicting = []
    draft = _draft(ctx)
    if draft is not None:
        draft.allergens = list(allergens)
        draft.allergy_note = _allergy_note(s)
        for item in draft.items:
            if item.dish is None:
                continue
            conflicts = allergy.session_conflicts(item.dish, s)
            item.conflicts = conflicts
            if conflicts and not item.allergen_flag:
                now_conflicting.append(
                    {
                        "item_id": item.id,
                        "name": item.name,
                        "conflicts": conflicts,
                        "summary": allergy.describe_conflicts(conflicts),
                    }
                )
    ctx.db.flush()
    result: dict = {
        "ok": True,
        "recorded": {"allergens": allergens, "notes": notes, "none_declared": s.none_declared},
    }
    if inferred:
        result["also_recorded_from_notes"] = inferred
    if now_conflicting:
        result["draft_items_now_conflicting"] = now_conflicting
        result["message"] = (
            "Some items already in the draft conflict with these allergies. Tell the guest; "
            "remove them or get explicit confirmation before placing the order."
        )
    return ToolOutcome(result)


def _add_to_order(ctx: ToolContext, a: AddToOrderIn) -> ToolOutcome:
    if refused := _require_allergies(ctx):
        return refused
    if a.quantity < 1 or a.quantity > MAX_QUANTITY:
        return ToolOutcome(
            {"ok": False, "error": "invalid_quantity", "message": f"Quantity must be 1 to {MAX_QUANTITY}."}, True
        )
    dish = _get_dish(ctx, a.dish_id)
    if dish is None:
        return ToolOutcome(
            {"ok": False, "error": "not_found", "message": "No dish with that id. Use search_menu."}, True
        )
    if not dish.available:
        return ToolOutcome(
            {
                "ok": False,
                "error": "unavailable",
                "message": f"{dish.name} is not available today. Suggest something else.",
                "alternatives": _safe_alternatives(ctx, dish),
            },
            True,
        )
    ctx.shown_dishes.setdefault(dish.id, dish)

    conflicts = allergy.session_conflicts(dish, ctx.session)
    if conflicts and not a.guest_confirmed_allergen_risk:
        return ToolOutcome(
            {
                "ok": False,
                "blocked": "allergen_conflict",
                "dish": {"dish_id": dish.id, "name": dish.name},
                "conflicts": conflicts,
                "summary": f"{dish.name} {allergy.describe_conflicts(conflicts)}.",
                "safe_alternatives": _safe_alternatives(ctx, dish),
                "message": (
                    "Not added. Warn the guest clearly about this conflict and suggest a safe "
                    "alternative. Add it only if the guest explicitly accepts the risk, by calling "
                    "add_to_order again with guest_confirmed_allergen_risk=true."
                ),
            },
            True,
        )

    order = _draft_or_create(ctx)
    flagged = bool(conflicts)
    notes = a.notes.strip()
    item = next(
        (i for i in order.items if i.dish_id == dish.id and i.notes == notes and i.allergen_flag == flagged),
        None,
    )
    if item is not None:
        item.quantity = min(MAX_QUANTITY, item.quantity + a.quantity)
    else:
        item = OrderItem(
            dish_id=dish.id,
            name=dish.name,
            price=dish.price,
            quantity=a.quantity,
            notes=notes,
            allergen_flag=flagged,
            conflicts=conflicts,
        )
        item.dish = dish
        order.items.append(item)
    order.recompute_total()
    ctx.db.flush()
    result = {
        "ok": True,
        "added": {"item_id": item.id, "name": dish.name, "quantity": a.quantity},
        "order": _order_view(order),
    }
    if flagged:
        result["allergen_risk_accepted"] = allergy.describe_conflicts(conflicts)
    return ToolOutcome(result)


def _find_draft_item(ctx: ToolContext, item_id: int) -> tuple[Order | None, OrderItem | None]:
    order = _draft(ctx)
    if order is None:
        return None, None
    return order, next((i for i in order.items if i.id == item_id), None)


def _update_item(ctx: ToolContext, a: UpdateItemIn) -> ToolOutcome:
    if refused := _require_allergies(ctx):
        return refused
    order, item = _find_draft_item(ctx, a.item_id)
    if item is None or order is None:
        return ToolOutcome(
            {"ok": False, "error": "not_found", "message": "No such item in the draft order. Use get_order."}, True
        )
    if a.quantity < 0 or a.quantity > MAX_QUANTITY:
        return ToolOutcome(
            {"ok": False, "error": "invalid_quantity", "message": f"Quantity must be 0 to {MAX_QUANTITY}."}, True
        )
    if a.quantity == 0:
        order.items.remove(item)
    else:
        item.quantity = a.quantity
        if a.notes is not None:
            item.notes = a.notes.strip()
        if item.dish is not None:
            item.conflicts = allergy.session_conflicts(item.dish, ctx.session)
        if a.guest_confirmed_allergen_risk and item.conflicts:
            item.allergen_flag = True
    order.recompute_total()
    ctx.db.flush()
    return ToolOutcome({"ok": True, "order": _order_view(order)})


def _remove_item(ctx: ToolContext, a: ItemIdIn) -> ToolOutcome:
    order, item = _find_draft_item(ctx, a.item_id)
    if item is None or order is None:
        return ToolOutcome(
            {"ok": False, "error": "not_found", "message": "No such item in the draft order. Use get_order."}, True
        )
    order.items.remove(item)
    order.recompute_total()
    ctx.db.flush()
    return ToolOutcome({"ok": True, "order": _order_view(order)})


def _get_order(ctx: ToolContext, _a: EmptyIn) -> ToolOutcome:
    placed = ctx.db.scalars(
        select(Order).where(Order.session_id == ctx.session.id, Order.status != "draft").order_by(Order.id)
    ).all()
    draft = _draft(ctx)
    return ToolOutcome(
        {
            "ok": True,
            "draft": _order_view(draft) if draft is not None and draft.items else None,
            "sent_to_kitchen": [_order_view(o) for o in placed],
        }
    )


def _place_order(ctx: ToolContext, _a: EmptyIn) -> ToolOutcome:
    if refused := _require_allergies(ctx):
        return refused
    order = _draft(ctx)
    if order is None or not order.items:
        return ToolOutcome(
            {"ok": False, "error": "empty_order", "message": "There is nothing in the draft order."}, True
        )

    blocked, problems = [], []
    for item in order.items:
        dish = item.dish
        if dish is None:
            problems.append({"item_id": item.id, "name": item.name, "problem": "no longer on the menu"})
            continue
        if not dish.available:
            problems.append({"item_id": item.id, "name": item.name, "problem": "not available today"})
            continue
        # Re-check against the allergies as recorded now: they may have changed
        # after the item was added.
        conflicts = allergy.session_conflicts(dish, ctx.session)
        item.conflicts = conflicts
        if conflicts and not item.allergen_flag:
            blocked.append(
                {
                    "item_id": item.id,
                    "name": item.name,
                    "conflicts": conflicts,
                    "summary": allergy.describe_conflicts(conflicts),
                }
            )
    if problems:
        return ToolOutcome(
            {
                "ok": False,
                "error": "items_unavailable",
                "items": problems,
                "message": "Remove these items (tell the guest) before placing the order.",
            },
            True,
        )
    if blocked:
        return ToolOutcome(
            {
                "ok": False,
                "blocked": "allergen_conflict",
                "items": blocked,
                "message": "Not placed. These items conflict with the guest's allergies. Tell the guest; "
                "remove them, or if the guest explicitly accepts the risk mark them with "
                "update_order_item(guest_confirmed_allergen_risk=true).",
            },
            True,
        )

    s = ctx.session
    order.status = "placed"
    order.placed_at = utcnow()
    order.allergens = list(s.allergens or [])
    order.allergy_note = _allergy_note(s)
    order.language = s.language
    order.currency = ctx.restaurant.currency
    order.recompute_total()
    ctx.db.flush()
    ctx.pending_events.append(("order.placed", order))
    return ToolOutcome({"ok": True, "placed": _order_view(order), "message": "The order is on its way to the kitchen."})


def _call_waiter(ctx: ToolContext, a: CallWaiterIn) -> ToolOutcome:
    s = ctx.session
    call = WaiterCall(
        restaurant_id=ctx.restaurant.id,
        table_id=s.table_id,
        table_label=s.table_label,
        session_id=s.id,
        reason=a.reason.strip() or "Guest asked for staff",
    )
    ctx.db.add(call)
    ctx.db.flush()
    ctx.waiter_calls.append(call.reason)
    ctx.pending_events.append(("waiter.called", call))
    return ToolOutcome({"ok": True, "message": "Staff have been notified and will come to the table."})


_HANDLERS = {
    "search_menu": _search_menu,
    "get_dish": _get_dish_handler,
    "search_restaurant_info": _search_info,
    "set_allergies": _set_allergies,
    "add_to_order": _add_to_order,
    "update_order_item": _update_item,
    "remove_from_order": _remove_item,
    "get_order": _get_order,
    "place_order": _place_order,
    "call_human_waiter": _call_waiter,
}
