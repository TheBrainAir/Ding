"""Response shapes, exactly as documented in docs/API.md."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    DiningTable,
    Dish,
    GuestSession,
    KnowledgeItem,
    Order,
    OrderItem,
    Restaurant,
    User,
    WaiterCall,
)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def photo_url(path: str | None) -> str | None:
    return f"/media/{path}" if path else None


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email}


def restaurant_out(r: Restaurant) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "currency": r.currency,
        "menu_language": r.menu_language,
        "persona_name": r.persona_name,
        "voice_id": r.voice_id,
        "llm_model": r.llm_model,
        "stt_model": r.stt_model,
        "tts_model": r.tts_model,
    }


def dish_out(d: Dish) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "category": d.category,
        "price": d.price,
        "photo_url": photo_url(d.photo_path),
        "ingredients": list(d.ingredients or []),
        "allergens": list(d.allergens or []),
        "may_contain": list(d.may_contain or []),
        "dietary_tags": list(d.dietary_tags or []),
        "available": d.available,
        "created_at": iso(d.created_at),
        "updated_at": iso(d.updated_at),
    }


def knowledge_out(k: KnowledgeItem) -> dict:
    return {"id": k.id, "title": k.title, "content": k.content, "updated_at": iso(k.updated_at)}


def table_out(t: DiningTable, active_session_id: int | None) -> dict:
    return {
        "id": t.id,
        "label": t.label,
        "token": t.token,
        "url": f"/t/{t.token}",
        "active_session_id": active_session_id,
        "created_at": iso(t.created_at),
    }


def order_item_out(i: OrderItem) -> dict:
    return {
        "id": i.id,
        "dish_id": i.dish_id,
        "name": i.name,
        "price": i.price,
        "quantity": i.quantity,
        "notes": i.notes,
        "allergen_flag": i.allergen_flag,
        "photo_url": photo_url(i.dish.photo_path) if i.dish else None,
    }


def order_out(o: Order) -> dict:
    return {
        "id": o.id,
        "table_id": o.table_id,
        "table_label": o.table_label,
        "session_id": o.session_id,
        "status": o.status,
        "items": [order_item_out(i) for i in o.items],
        "total": o.total,
        "currency": o.currency,
        "allergies": list(o.allergens or []),
        "allergy_note": o.allergy_note,
        "language": o.language,
        "placed_at": iso(o.placed_at),
        "created_at": iso(o.created_at),
    }


def waiter_call_out(c: WaiterCall) -> dict:
    return {
        "id": c.id,
        "table_id": c.table_id,
        "table_label": c.table_label,
        "reason": c.reason,
        "resolved": c.resolved,
        "created_at": iso(c.created_at),
    }


def allergies_out(s: GuestSession) -> dict:
    return {
        "confirmed": s.allergies_confirmed,
        "allergens": list(s.allergens or []),
        "notes": s.allergy_notes,
        "none_declared": s.none_declared,
    }


def latest_order(db: Session, session_id: int) -> Order | None:
    """The order to show for a session: the open draft if any, else the newest order."""
    draft = db.scalar(
        select(Order).where(Order.session_id == session_id, Order.status == "draft").order_by(Order.id.desc())
    )
    if draft is not None and draft.items:
        return draft
    placed = db.scalar(
        select(Order).where(Order.session_id == session_id, Order.status != "draft").order_by(Order.id.desc())
    )
    return placed or draft


def session_summary_out(db: Session, s: GuestSession) -> dict:
    order = latest_order(db, s.id)
    return {
        "id": s.id,
        "table_id": s.table_id,
        "table_label": s.table_label,
        "status": s.status,
        "language": s.language,
        "allergies": allergies_out(s),
        "turn_count": s.turn_count,
        "order_id": order.id if order else None,
        "started_at": iso(s.started_at),
        "last_activity_at": iso(s.last_activity_at),
    }


def session_detail_out(db: Session, s: GuestSession) -> dict:
    order = latest_order(db, s.id)
    out = session_summary_out(db, s)
    out["transcript"] = list(s.transcript or [])
    out["order"] = order_out(order) if order else None
    return out


# ---- guest-facing (table endpoints only): original fields plus the session-language names


def guest_dish_out(d: Dish, translations: dict) -> dict:
    out = dish_out(d)
    local = translations.get(d.id)
    out["local_name"] = local.name if local is not None else None
    out["local_description"] = local.description if local is not None else None
    return out


def guest_order_out(o: Order, translations: dict) -> dict:
    out = order_out(o)
    for item_out, item in zip(out["items"], o.items, strict=True):
        local = translations.get(item.dish_id)
        item_out["local_name"] = local.name if local is not None else None
    return out
