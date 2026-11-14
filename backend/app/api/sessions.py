from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_restaurant
from app.models import GuestSession, Restaurant
from app.serializers import session_detail_out, session_summary_out

router = APIRouter(tags=["sessions"])


@router.get("/sessions")
def list_sessions(
    limit: int = 100, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> list[dict]:
    sessions = db.scalars(
        select(GuestSession)
        .where(GuestSession.restaurant_id == r.id, GuestSession.turn_count > 0)
        .order_by(GuestSession.last_activity_at.desc())
        .limit(max(1, min(limit, 500)))
    ).all()
    return [session_summary_out(db, s) for s in sessions]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> dict:
    s = db.get(GuestSession, session_id)
    if s is None or s.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_detail_out(db, s)
