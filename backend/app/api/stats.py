"""Overview numbers. "Today" starts at local midnight of the machine running the server."""

from collections import Counter
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_restaurant
from app.models import GuestSession, Order, Restaurant, WaiterCall
from app.serializers import iso

router = APIRouter(tags=["stats"])


def _today_start_utc() -> datetime:
    local_midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(UTC).replace(tzinfo=None)


@router.get("/stats")
def stats(r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> dict:
    start = _today_start_utc()
    orders = db.scalars(
        select(Order).where(
            Order.restaurant_id == r.id,
            Order.placed_at.is_not(None),
            Order.placed_at >= start,
            Order.status.in_(("placed", "preparing", "served")),
        )
    ).all()
    revenue = round(sum(o.total for o in orders), 2)

    dishes: Counter = Counter()
    names: dict = {}
    for o in orders:
        for i in o.items:
            key = i.dish_id if i.dish_id is not None else f"name:{i.name}"
            dishes[key] += i.quantity
            names[key] = i.name

    sessions_today = db.scalars(
        select(GuestSession).where(
            GuestSession.restaurant_id == r.id,
            GuestSession.started_at >= start,
            GuestSession.turn_count > 0,
        )
    ).all()
    languages = Counter(s.language for s in sessions_today if s.language)

    active_tables = (
        db.scalar(
            select(func.count(func.distinct(GuestSession.table_id))).where(
                GuestSession.restaurant_id == r.id,
                GuestSession.status == "active",
                GuestSession.table_id.is_not(None),
                GuestSession.turn_count > 0,
            )
        )
        or 0
    )
    open_calls = (
        db.scalar(
            select(func.count(WaiterCall.id)).where(WaiterCall.restaurant_id == r.id, WaiterCall.resolved.is_(False))
        )
        or 0
    )

    hours: Counter = Counter()
    for o in orders:
        hours[o.placed_at.replace(minute=0, second=0, microsecond=0)] += 1
    by_hour = []
    hour = start.replace(minute=0, second=0, microsecond=0)
    now_hour = datetime.now(UTC).replace(tzinfo=None, minute=0, second=0, microsecond=0)
    while hour <= now_hour:
        by_hour.append({"hour": iso(hour), "orders": hours.get(hour, 0)})
        hour += timedelta(hours=1)

    return {
        "orders_today": len(orders),
        "revenue_today": revenue,
        "currency": r.currency,
        "active_tables": active_tables,
        "avg_order_value": round(revenue / len(orders), 2) if orders else 0.0,
        "open_waiter_calls": open_calls,
        "top_dishes": [
            {"dish_id": k if isinstance(k, int) else None, "name": names[k], "quantity": q}
            for k, q in dishes.most_common(5)
        ],
        "languages": [{"language": lang, "sessions": n} for lang, n in languages.most_common()],
        "orders_by_hour": by_hour,
    }
