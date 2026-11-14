"""Guest-facing endpoints, public and addressed by the table token."""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.events import bus
from app.models import DiningTable, Restaurant
from app.schemas import TurnIn
from app.serializers import allergies_out, latest_order, order_out, session_summary_out
from app.services import guest_sessions, turns

log = logging.getLogger(__name__)
router = APIRouter(tags=["table"])

MAX_AUDIO_BYTES = 25_000_000


def _table(db: Session, token: str) -> DiningTable:
    t = db.scalar(select(DiningTable).where(DiningTable.token == token))
    if t is None:
        raise HTTPException(status_code=404, detail="Unknown table")
    return t


@router.get("/table/{token}")
def table_info(token: str, db: Session = Depends(get_db)) -> dict:
    t = _table(db, token)
    r = db.get(Restaurant, t.restaurant_id)
    s = guest_sessions.active_session(db, t)
    session = None
    if s is not None:
        order = latest_order(db, s.id)
        session = {
            "id": s.id,
            "language": s.language,
            "allergies": allergies_out(s),
            "order": order_out(order) if order else None,
            "transcript": list(s.transcript or []),
        }
    return {
        "table_label": t.label,
        "restaurant_name": r.name,
        "persona_name": r.persona_name,
        "currency": r.currency,
        "voice_enabled": settings.voice_enabled,
        "session": session,
    }


@router.post("/table/{token}/reset", status_code=204)
async def reset_table(token: str, db: Session = Depends(get_db)) -> Response:
    t = _table(db, token)
    await turns.cancel_turn(token)
    s = guest_sessions.active_session(db, t)
    if s is not None:
        guest_sessions.close(db, s)
        db.commit()
        bus.publish(t.restaurant_id, "session.updated", session_summary_out(db, s))
    return Response(status_code=204)


async def read_turn_request(request: Request) -> tuple[str | None, turns.AudioInput | None, bool]:
    """Either multipart with `audio` (optional `speak`) or JSON {text, speak}."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("audio")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(status_code=422, detail="Send the recording in a form field named 'audio'")
        data = await upload.read()
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Recording is too long")
        speak = str(form.get("speak", "true")).lower() not in ("false", "0", "no")
        audio = turns.AudioInput(
            data=data,
            filename=upload.filename or "speech.webm",
            content_type=upload.content_type or "audio/webm",
        )
        return None, audio, speak
    try:
        body = TurnIn.model_validate_json(await request.body())
    except ValidationError:
        raise HTTPException(
            status_code=422, detail='Send JSON {"text": "...", "speak": true} or multipart audio'
        ) from None
    return body.text, None, body.speak


@router.post("/table/{token}/turn")
async def turn(token: str, request: Request, db: Session = Depends(get_db)) -> StreamingResponse:
    _table(db, token)
    text, audio, speak = await read_turn_request(request)
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict) -> None:
        await queue.put(event)

    def finished(t: asyncio.Task) -> None:
        if t.cancelled():
            queue.put_nowait({"type": "error", "message": "Interrupted by a newer turn."})
        queue.put_nowait(None)

    task = await turns.start_turn(
        token, lambda: turns.run_guest_turn(token, emit=emit, text=text, audio=audio, speak=speak)
    )
    task.add_done_callback(finished)

    async def ndjson():
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False) + "\n"
        finally:
            # Client went away (barge-in / closed tab): stop working on this turn.
            if not task.done():
                task.cancel()

    return StreamingResponse(
        ndjson(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
