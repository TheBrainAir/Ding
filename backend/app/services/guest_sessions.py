"""Guest session lifecycle.

A session starts with the first press at a table and closes on "New guest"
(reset), ten minutes after an order went to the kitchen and the table went quiet,
or after a long silence without any order.
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DiningTable, GuestSession, Order, Restaurant, utcnow
from app.services import prompts


def _has_sent_order(db: Session, session_id: int) -> bool:
    return (
        db.scalar(
            select(Order.id).where(Order.session_id == session_id, Order.status.in_(("placed", "preparing", "served")))
        )
        is not None
    )


def is_stale(db: Session, s: GuestSession) -> bool:
    idle = utcnow() - s.last_activity_at
    if idle > timedelta(minutes=settings.session_abandon_minutes):
        return True
    return idle > timedelta(minutes=settings.session_close_after_order_minutes) and _has_sent_order(db, s.id)


def close(db: Session, s: GuestSession) -> None:
    s.status = "closed"
    s.closed_at = utcnow()
    for order in db.scalars(select(Order).where(Order.session_id == s.id, Order.status == "draft")):
        if not order.items:
            db.delete(order)


def active_session(db: Session, table: DiningTable) -> GuestSession | None:
    """The table's open session, closing it first if it has gone stale."""
    s = db.scalar(
        select(GuestSession)
        .where(GuestSession.table_id == table.id, GuestSession.status == "active")
        .order_by(GuestSession.id.desc())
    )
    if s is not None and is_stale(db, s):
        close(db, s)
        db.commit()
        return None
    return s


def get_or_create(db: Session, table: DiningTable, restaurant: Restaurant) -> tuple[GuestSession, bool]:
    s = active_session(db, table)
    if s is not None:
        return s, False
    index = prompts.menu_index(db, restaurant)
    s = GuestSession(
        restaurant_id=restaurant.id,
        table_id=table.id,
        table_label=table.label,
        status="active",
        system_prompt=prompts.build_system_prompt(restaurant, index),
        menu_index=index,
        messages=[],
        transcript=[],
    )
    db.add(s)
    db.commit()
    return s, True


def reap_stale(db: Session) -> list[GuestSession]:
    closed = []
    for s in db.scalars(select(GuestSession).where(GuestSession.status == "active")).all():
        if is_stale(db, s):
            close(db, s)
            closed.append(s)
    if closed:
        db.commit()
    return closed
