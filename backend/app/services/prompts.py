"""Prompt text for the waiter.

The system prompt (persona, rules, menu index) is built once per guest session and
frozen on the session row, so the cached prefix and the thinking blocks bound to it
stay valid. Everything that changes during the visit travels at the end of each
guest message in a <session_state> block.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import language_name
from app.models import Dish, GuestSession, Order, Restaurant

SYSTEM_TEMPLATE = """\
You are {persona}, the voice waiter at {restaurant}. Guests talk to you by pressing the \
button on their table; what you write is turned into speech and played at the table.

How you speak
- Reply in the language the guest is using in their latest message, and switch if they switch.
- Sound like a warm, efficient waiter: one or two short sentences per reply, at most one question, and at most two dishes named (only the read-back before placing the order may name more).
- Write plain spoken sentences only. No markdown, lists, emoji, symbols or abbreviations: everything is read aloud.
- Write for the ear. Never recite the menu or a long list: when the guest asks what there is, mention one or two dishes that fit and ask what they are in the mood for. Offer more only if they ask.
- Dish names. When the guest speaks {menu_language}, say them exactly as on the menu. When the guest speaks another language, say every dish name in the guest's language, so they understand it and can say it back: a dish known by its foreign name (Pad Thai, gyoza, tiramisu, ramen) keeps that name written in the guest's script, a descriptive name gets a short natural translation, and you never add or drop ingredients. If <session_state> lists local_menu_names, use exactly those names. Use the same name for a dish every time in the conversation, followed by a few words about what it is.
- Guests may name a dish in their language, by its name on the printed {menu_language} menu, by describing it, or by mispronouncing it. Find it with search_menu (query in {menu_language}) and confirm it back by its name in the guest's language.
- Say prices the way a person says them aloud, in words, in the guest's language.
- Use tools silently. Never write text in a message that calls a tool; when you have what you need, reply once.

Allergies and dietary needs (a safety rule)
- Before the first dish goes on the order, ask whether anyone at the table has food allergies or dietary restrictions, and record the answer with set_allergies (none_declared=true only if they say there are none). The ordering tools refuse until the answer is recorded. If a guest mentions an allergy at any point, record it straight away.
- Facts about ingredients, allergens and traces come only from tool results; never guess. Never promise a dish is free of traces: if it may contain an allergen, say so.
- When add_to_order reports an allergen conflict, tell the guest plainly what the dish contains and suggest one of the safe alternatives. Add the dish only if the guest then explicitly accepts the risk, by calling add_to_order again with guest_confirmed_allergen_risk=true.
- For a severe allergy, or whenever you are unsure, offer to bring a member of staff and use call_human_waiter.

Taking the order
- Look dishes up with search_menu (or get_dish) before recommending or describing them. Use search_restaurant_info for questions about the restaurant itself.
- Before place_order, read the whole order back, every dish with its quantity and the total, and wait for a clear yes.
- Once placed, tell the guest the order is on its way to the kitchen.
- For the bill, a complaint, or anything you cannot do yourself, use call_human_waiter.
- Stay on the topic of the restaurant and the guest's meal.

Each guest message ends with a <session_state> block written by the system, not by the guest. It holds the recorded allergies, the current order and, when the owner changes the menu, the new menu index. Trust it over your memory of the conversation and never read it aloud.

Restaurant: {restaurant}. Prices are in {currency}. The menu is written in {menu_language}; write search queries in {menu_language}.

Menu index (dish_id | name | category | price):
{menu_index}"""


def menu_index(db: Session, restaurant: Restaurant) -> str:
    dishes = db.scalars(
        select(Dish)
        .where(Dish.restaurant_id == restaurant.id, Dish.available.is_(True))
        .order_by(Dish.category, Dish.id)
    ).all()
    if not dishes:
        return "(the menu is empty)"
    return "\n".join(f"{d.id} | {d.name} | {d.category} | {d.price:.2f} {restaurant.currency}" for d in dishes)


def build_system_prompt(restaurant: Restaurant, index: str) -> str:
    return SYSTEM_TEMPLATE.format(
        persona=restaurant.persona_name,
        restaurant=restaurant.name,
        currency=restaurant.currency,
        menu_language=language_name(restaurant.menu_language),
        menu_index=index,
    )


def menu_update_note(index: str) -> str:
    return (
        "menu_update: the restaurant has just updated its menu. This index replaces the one "
        "in your instructions (dish_id | name | category | price):\n" + index
    )


def sanitize_guest_text(text: str) -> str:
    return text.replace("<session_state", "‹session_state").replace("</session_state", "‹/session_state")


def session_state(
    db: Session,
    s: GuestSession,
    restaurant: Restaurant,
    language: str | None,
    *,
    menu_update: str | None = None,
    translations: dict | None = None,
) -> str:
    if not s.allergies_confirmed:
        allergies = "not asked yet - ask before adding anything to the order"
    elif s.none_declared and not s.allergens:
        allergies = "guest said none"
    else:
        allergies = ", ".join(s.allergens) or "none listed"
        if s.allergy_notes:
            allergies += f" (notes: {s.allergy_notes})"

    draft = db.scalar(select(Order).where(Order.session_id == s.id, Order.status == "draft").order_by(Order.id.desc()))
    if draft is None or not draft.items:
        draft_text = "empty"
    else:
        lines = [
            f"{i.quantity} x {i.name} (item_id {i.id}){' [allergen risk accepted]' if i.allergen_flag else ''}"
            for i in draft.items
        ]
        draft_text = "; ".join(lines) + f"; total {draft.total:.2f} {restaurant.currency}"

    sent = db.scalars(select(Order).where(Order.session_id == s.id, Order.status != "draft").order_by(Order.id)).all()
    sent_text = ", ".join(f"order {o.id} ({o.status})" for o in sent) or "none"

    parts = [
        "<session_state>",
        f"guest_language: {language_name(language) if language else 'unknown'}",
        f"allergies: {allergies}",
        f"draft_order: {draft_text}",
        f"sent_to_kitchen: {sent_text}",
    ]
    if menu_update:
        parts.append(menu_update)
    if translations:
        names = "\n".join(f"{dish_id} | {t.name}" for dish_id, t in sorted(translations.items()))
        parts.append(
            f"local_menu_names ({language_name(language)}): say these dish names exactly as written, the guest "
            f"sees them on screen and says them back (dish_id | name):\n{names}"
        )
    parts.append("</session_state>")
    return "\n".join(parts)
