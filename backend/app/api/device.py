"""Hardware without a browser (e.g. a future ESP32 button): WAV in, one MP3 out."""

import asyncio
import base64
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import DiningTable
from app.services import turns

router = APIRouter(tags=["device"])

MAX_AUDIO_BYTES = 25_000_000


@router.post("/device/{token}/turn")
async def device_turn(token: str, request: Request, db: Session = Depends(get_db)) -> Response:
    if db.scalar(select(DiningTable.id).where(DiningTable.token == token)) is None:
        raise HTTPException(status_code=404, detail="Unknown table")
    if not settings.voice_enabled:
        raise HTTPException(status_code=503, detail="Voice is not configured (ELEVENLABS_API_KEY is missing)")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=422, detail="Send the recording as the raw request body (audio/wav)")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too long")
    content_type = request.headers.get("content-type", "audio/wav").split(";")[0] or "audio/wav"

    transcript, reply, audio, error = "", [], {}, None

    async def emit(event: dict) -> None:
        nonlocal transcript, error
        kind = event.get("type")
        if kind == "transcript":
            transcript = event.get("text", "")
        elif kind == "text":
            reply.append(event["delta"])
        elif kind == "audio":
            audio[event["seq"]] = base64.b64decode(event["b64"])
        elif kind == "error":
            error = event.get("message")

    task = await turns.start_turn(
        token,
        lambda: turns.run_guest_turn(
            token, emit=emit, audio=turns.AudioInput(data, "speech.wav", content_type), speak=True
        ),
    )
    try:
        await task
    except asyncio.CancelledError:
        raise HTTPException(status_code=409, detail="Interrupted by a newer turn") from None

    if error:
        raise HTTPException(status_code=502, detail=error)
    if not transcript:
        return Response(status_code=204)
    reply_text = "".join(reply).strip()
    return Response(
        content=b"".join(audio[k] for k in sorted(audio)),
        media_type="audio/mpeg",
        headers={"X-Waiter-Transcript": quote(transcript), "X-Waiter-Reply": quote(reply_text)},
    )
