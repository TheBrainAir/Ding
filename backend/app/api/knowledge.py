from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_restaurant
from app.models import KnowledgeItem, Restaurant
from app.schemas import KnowledgeIn, KnowledgePatch
from app.serializers import knowledge_out
from app.services import rag

router = APIRouter(tags=["knowledge"])


def _get(db: Session, r: Restaurant, item_id: int) -> KnowledgeItem:
    item = db.get(KnowledgeItem, item_id)
    if item is None or item.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Note not found")
    return item


@router.get("/knowledge")
def list_knowledge(r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> list[dict]:
    items = db.scalars(
        select(KnowledgeItem).where(KnowledgeItem.restaurant_id == r.id).order_by(KnowledgeItem.id)
    ).all()
    return [knowledge_out(k) for k in items]


@router.post("/knowledge", status_code=201)
def create_knowledge(
    body: KnowledgeIn, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    item = KnowledgeItem(restaurant_id=r.id, title=body.title.strip(), content=body.content)
    rag.reindex_knowledge(item)
    db.add(item)
    db.commit()
    return knowledge_out(item)


@router.patch("/knowledge/{item_id}")
def update_knowledge(
    item_id: int, body: KnowledgePatch, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    item = _get(db, r, item_id)
    if body.title is not None:
        item.title = body.title.strip()
    if body.content is not None:
        item.content = body.content
    rag.reindex_knowledge(item)
    db.commit()
    return knowledge_out(item)


@router.delete("/knowledge/{item_id}", status_code=204)
def delete_knowledge(
    item_id: int, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> Response:
    db.delete(_get(db, r, item_id))
    db.commit()
    return Response(status_code=204)
