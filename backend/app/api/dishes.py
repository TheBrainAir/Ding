import io
import logging
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import current_restaurant
from app.models import Dish, Restaurant
from app.schemas import DishBulkIn, DishIn, DishPatch, SuggestAllergensIn
from app.serializers import dish_out
from app.services import menu_import, rag
from app.services.llm import LLMError

log = logging.getLogger(__name__)
router = APIRouter(tags=["dishes"])

MAX_PHOTO_BYTES = 15_000_000
MAX_IMPORT_BYTES = 30_000_000
PHOTO_MAX_SIDE = 1600


def _get(db: Session, r: Restaurant, dish_id: int) -> Dish:
    dish = db.get(Dish, dish_id)
    if dish is None or dish.restaurant_id != r.id:
        raise HTTPException(status_code=404, detail="Dish not found")
    return dish


def _remove_photo_file(dish: Dish) -> None:
    if dish.photo_path:
        path = settings.media_dir / dish.photo_path
        if path.is_file() and path.resolve().is_relative_to(settings.media_dir.resolve()):
            path.unlink(missing_ok=True)


@router.get("/dishes")
def list_dishes(
    category: str | None = None,
    q: str | None = None,
    r: Restaurant = Depends(current_restaurant),
    db: Session = Depends(get_db),
) -> list[dict]:
    dishes = db.scalars(select(Dish).where(Dish.restaurant_id == r.id).order_by(Dish.category, Dish.id)).all()
    if category:
        dishes = [d for d in dishes if d.category.lower() == category.lower()]
    if q and q.strip():
        needle = q.strip().lower()
        dishes = [
            d
            for d in dishes
            if needle in d.name.lower()
            or needle in d.description.lower()
            or any(needle in i.lower() for i in d.ingredients or [])
        ]
    return [dish_out(d) for d in dishes]


@router.post("/dishes", status_code=201)
def create_dish(body: DishIn, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> dict:
    dish = Dish(restaurant_id=r.id, **body.model_dump())
    rag.reindex_dish(dish)
    db.add(dish)
    db.commit()
    return dish_out(dish)


@router.post("/dishes/bulk", status_code=201)
def bulk_create(
    body: DishBulkIn, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> list[dict]:
    created = []
    for draft in body.dishes:
        fields = draft.model_dump()
        fields["price"] = fields["price"] if fields["price"] is not None else 0.0
        fields["category"] = fields["category"] or "Other"
        dish = Dish(restaurant_id=r.id, available=True, **fields)
        created.append(dish)
    vecs = rag.embed([rag.dish_document(d) for d in created]) if created else []
    for dish, vec in zip(created, vecs, strict=True):
        dish.embedding = rag.to_blob(vec)
        db.add(dish)
    db.commit()
    return [dish_out(d) for d in created]


@router.post("/dishes/suggest-allergens")
async def suggest_allergens(body: SuggestAllergensIn, r: Restaurant = Depends(current_restaurant)) -> dict:
    try:
        return await menu_import.suggest_allergens(body.name, body.description, body.ingredients, model=r.llm_model)
    except LLMError as e:
        raise HTTPException(status_code=502, detail=e.message) from e


@router.post("/menu/import")
async def import_menu(file: UploadFile = File(...), r: Restaurant = Depends(current_restaurant)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty")
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="The file is too large (30 MB max)")
    try:
        drafts = await menu_import.import_menu(data, file.content_type or "", file.filename or "", model=r.llm_model)
    except LLMError as e:
        raise HTTPException(status_code=502, detail=e.message) from e
    return {"dishes": drafts}


@router.patch("/dishes/{dish_id}")
def update_dish(
    dish_id: int, body: DishPatch, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    dish = _get(db, r, dish_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(dish, key, value)
    rag.reindex_dish(dish)
    db.commit()
    return dish_out(dish)


@router.delete("/dishes/{dish_id}", status_code=204)
def delete_dish(dish_id: int, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> Response:
    dish = _get(db, r, dish_id)
    _remove_photo_file(dish)
    db.delete(dish)
    db.commit()
    return Response(status_code=204)


@router.post("/dishes/{dish_id}/photo")
async def upload_photo(
    dish_id: int,
    file: UploadFile = File(...),
    r: Restaurant = Depends(current_restaurant),
    db: Session = Depends(get_db),
) -> dict:
    dish = _get(db, r, dish_id)
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo is too large (15 MB max)")
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read that image. Use JPEG, PNG or WebP.") from None
    img.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE))
    rel = f"dishes/{dish.id}-{secrets.token_hex(4)}.jpg"
    (settings.media_dir / "dishes").mkdir(parents=True, exist_ok=True)
    img.save(settings.media_dir / rel, "JPEG", quality=86, optimize=True)
    _remove_photo_file(dish)
    dish.photo_path = rel
    db.commit()
    return dish_out(dish)


@router.delete("/dishes/{dish_id}/photo")
def delete_photo(dish_id: int, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)) -> dict:
    dish = _get(db, r, dish_id)
    _remove_photo_file(dish)
    dish.photo_path = None
    db.commit()
    return dish_out(dish)
