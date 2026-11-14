"""One guest turn end to end (STT -> waiter loop -> events), one at a time per table.

A new turn for a table cancels the one still running (barge-in), and waits for it
to unwind before touching the session.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.events import bus
from app.models import DiningTable, Restaurant
from app.serializers import session_summary_out
from app.services import guest_sessions, stt, waiter
from app.services.elevenlabs import ElevenLabsError
from app.services.language import detect_language
from app.services.llm import LLMError

log = logging.getLogger(__name__)

Emit = Callable[[dict], Awaitable[None]]

_active: dict[str, asyncio.Task] = {}


@dataclass
class AudioInput:
    data: bytes
    filename: str
    content_type: str


async def run_guest_turn(
    token: str,
    *,
    emit: Emit,
    text: str | None = None,
    audio: AudioInput | None = None,
    speak: bool = True,
) -> None:
    db = SessionLocal()
    try:
        table = db.scalar(select(DiningTable).where(DiningTable.token == token))
        if table is None:
            await emit({"type": "error", "message": "Unknown table."})
            return
        restaurant = db.get(Restaurant, table.restaurant_id)

        if audio is not None:
            if not settings.voice_enabled:
                await emit(
                    {"type": "error", "message": "Voice input needs ELEVENLABS_API_KEY on the server. Type instead."}
                )
                return
            heard = await stt.transcribe(
                audio.data,
                filename=audio.filename,
                content_type=audio.content_type,
                model_id=restaurant.stt_model,
            )
            guest_text, language = heard.text, heard.language
        else:
            guest_text = (text or "").strip()
            language = detect_language(guest_text)

        await emit({"type": "transcript", "text": guest_text, "language": language if guest_text else None})
        if not guest_text:
            await emit({"type": "done"})
            return

        session, created = guest_sessions.get_or_create(db, table, restaurant)
        if created:
            bus.publish(restaurant.id, "session.updated", session_summary_out(db, session))
        await waiter.run_turn(
            db=db,
            session=session,
            restaurant=restaurant,
            guest_text=guest_text,
            language=language,
            speak=speak,
            emit=emit,
        )
        await emit({"type": "done"})
    except asyncio.CancelledError:
        raise
    except LLMError as e:
        await emit({"type": "error", "message": e.message})
    except ElevenLabsError as e:
        log.error("speech service error: %s", e)
        await emit({"type": "error", "message": f"Speech service error ({e.status}): {e.message}"})
    except Exception:
        log.exception("turn failed")
        await emit({"type": "error", "message": "Something went wrong. Please try again."})
    finally:
        db.close()


async def start_turn(token: str, body: Callable[[], Awaitable[None]]) -> asyncio.Task:
    """Cancel the table's running turn (barge-in), then start `body` as the new one."""
    previous = _active.get(token)

    async def runner() -> None:
        await waiter.wait_cancelled(previous)
        await body()

    task = asyncio.create_task(runner())
    _active[token] = task

    def _cleanup(t: asyncio.Task) -> None:
        if _active.get(token) is t:
            del _active[token]

    task.add_done_callback(_cleanup)
    return task


async def cancel_turn(token: str) -> None:
    await waiter.wait_cancelled(_active.get(token))
