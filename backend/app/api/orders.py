from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_restaurant
from app.events import bus
from app.models import Order, Restaurant, WaiterCall, utcnow
from app.schemas import OrderPatch, WaiterCallPatch
from app.serializers import order_out, waiter_call_out

router = APIRouter(tags=["orders"])

ORDER_STATUSES = {"draft", "placed", "preparing", "served", "cancelled"}


@router.get("/orders")
def list_orders(
    status: str | None = None,
    limit: int = 200,
    r: Restaurant = Depends(current_restaurant),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(Order).where(Order.restaurant_id == r.id)
    if status:
        wanted = {s.strip() for s in status.split(",") if s.strip()}
        unknown = wanted - ORDER_STATUSES
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown status: {', '.join(sorted(unknown))}")
        stmt = stmt.where(Order.status.in_(wanted))
    else:
        stmt = stmt.where(Order.status != "draft")
    orders = db.scalars(stmt.order_by(Order.id.desc()).limit(max(1, min(limit, 1000)))).all()
    return [order_out(o) for o in orders]


@router.patch("/orders/{order_id}")
def update_order(
    order_id: int, body: OrderPatch, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    order = db.get(Order, order_id)
    if order is None or order.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "draft" and body.status != "cancelled":
        raise HTTPException(status_code=409, detail="This order has not been placed yet")
    order.status = body.status
    if body.status == "placed" and order.placed_at is None:
        order.placed_at = utcnow()
    db.commit()
    data = order_out(order)
    bus.publish(r.id, "order.updated", data)
    return data


@router.get("/waiter-calls")
def list_waiter_calls(
    resolved: bool | None = None,
    r: Restaurant = Depends(current_restaurant),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(WaiterCall).where(WaiterCall.restaurant_id == r.id)
    if resolved is not None:
        stmt = stmt.where(WaiterCall.resolved.is_(resolved))
    calls = db.scalars(stmt.order_by(WaiterCall.id.desc()).limit(200)).all()
    return [waiter_call_out(c) for c in calls]


@router.patch("/waiter-calls/{call_id}")
def update_waiter_call(
    call_id: int, body: WaiterCallPatch, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    call = db.get(WaiterCall, call_id)
    if call is None or call.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Waiter call not found")
    call.resolved = body.resolved
    call.resolved_at = utcnow() if body.resolved else None
    db.commit()
    return waiter_call_out(call)
