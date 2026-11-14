import secrets

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_restaurant
from app.models import DiningTable, Restaurant
from app.schemas import TableIn
from app.serializers import table_out
from app.services import guest_sessions

router = APIRouter(tags=["tables"])


def new_token() -> str:
    return secrets.token_urlsafe(9)


def _get(db: Session, r: Restaurant, table_id: int) -> DiningTable:
    t = db.get(DiningTable, table_id)
    if t is None or t.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Table not found")
    return t


def _out(db: Session, t: DiningTable) -> dict:
    s = guest_sessions.active_session(db, t)
    return table_out(t, s.id if s else None)


@router.get("/tables")
def list_tables(r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> list[dict]:
    tables = db.scalars(select(DiningTable).where(DiningTable.restaurant_id == r.id).order_by(DiningTable.id)).all()
    return [_out(db, t) for t in tables]


@router.post("/tables", status_code=201)
def create_table(body: TableIn, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> dict:
    t = DiningTable(restaurant_id=r.id, label=body.label.strip(), token=new_token())
    db.add(t)
    db.commit()
    return _out(db, t)


@router.patch("/tables/{table_id}")
def update_table(
    table_id: int, body: TableIn, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    t = _get(db, r, table_id)
    t.label = body.label.strip()
    db.commit()
    return _out(db, t)


@router.delete("/tables/{table_id}", status_code=204)
def delete_table(table_id: int, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> Response:
    db.delete(_get(db, r, table_id))
    db.commit()
    return Response(status_code=204)
