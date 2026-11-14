from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.catalog import ALLERGENS, DIETARY_TAGS, LLM_MODELS, STT_MODELS, TTS_MODELS
from app.db import get_db
from app.deps import current_restaurant
from app.models import Restaurant
from app.schemas import RestaurantPatch
from app.serializers import restaurant_out
from app.services import elevenlabs

router = APIRouter(tags=["restaurant"])


@router.get("/meta")
def meta() -> dict:
    return {
        "allergens": [{"id": a, "label": label} for a, label in ALLERGENS],
        "dietary_tags": [{"id": t, "label": label} for t, label in DIETARY_TAGS],
    }


@router.get("/restaurant")
def get_restaurant(r: Restaurant = Depends(current_restaurant)) -> dict:
    return restaurant_out(r)


@router.patch("/restaurant")
def patch_restaurant(
    body: RestaurantPatch, r: Restaurant = Depends(current_restaurant), db: Session = Depends(get_db)
) -> dict:
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "llm_model" in changes and changes["llm_model"] not in {m.id for m in LLM_MODELS}:
        raise HTTPException(status_code=422, detail=f"Unknown LLM model '{changes['llm_model']}'")
    r = db.merge(r)
    for key, value in changes.items():
        setattr(r, key, value.strip() if isinstance(value, str) else value)
    db.commit()
    return restaurant_out(r)


@router.get("/voices")
async def voices(_: Restaurant = Depends(current_restaurant)) -> list[dict]:
    return await elevenlabs.list_voices()


@router.get("/models")
async def models(_: Restaurant = Depends(current_restaurant)) -> dict:
    tts = list(TTS_MODELS)
    known = {m["id"] for m in tts}
    for live in await elevenlabs.list_tts_models():
        if live["id"] not in known:
            tts.append(live)
    return {
        "llm": [{"id": m.id, "label": m.label} for m in LLM_MODELS],
        "stt": list(STT_MODELS),
        "tts": tts,
    }
