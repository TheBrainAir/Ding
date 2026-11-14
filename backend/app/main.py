import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import (
    auth,
    device,
    dishes,
    events,
    knowledge,
    orders,
    restaurant,
    sessions,
    stats,
    table_public,
    tables,
)
from app.config import APP_NAME, settings
from app.db import SessionLocal, init_db
from app.events import bus
from app.serializers import session_summary_out
from app.services import elevenlabs, guest_sessions, rag

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ding")

REAP_EVERY_SECONDS = 60


async def _reaper() -> None:
    """Close guest sessions that went quiet, so tables free up on their own."""
    while True:
        await asyncio.sleep(REAP_EVERY_SECONDS)
        try:
            with SessionLocal() as db:
                for s in guest_sessions.reap_stale(db):
                    bus.publish(s.restaurant_id, "session.updated", session_summary_out(db, s))
        except Exception:
            log.exception("session reaper failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    bus.bind_loop(asyncio.get_running_loop())
    # Load the embedding model (and rebuild the index if the model changed) before serving.
    await asyncio.to_thread(rag.warmup)
    if not settings.anthropic_api_key.strip():
        log.warning("ANTHROPIC_API_KEY is not set: the waiter cannot answer")
    if not settings.voice_enabled:
        log.warning("ELEVENLABS_API_KEY is not set: running in text mode (no speech in or out)")
    reaper = asyncio.create_task(_reaper())
    yield
    reaper.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await reaper
    await elevenlabs.aclose()


app = FastAPI(title=f"{APP_NAME} API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Waiter-Transcript", "X-Waiter-Reply"],
)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
        msg = str(err.get("msg", "invalid value")).removeprefix("Value error, ")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return JSONResponse(status_code=422, content={"detail": "; ".join(parts) or "Invalid request"})


for module in (auth, restaurant, dishes, knowledge, tables, orders, sessions, stats, events, table_public, device):
    app.include_router(module.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "app": APP_NAME,
        "voice_enabled": settings.voice_enabled,
        "llm_configured": bool(settings.anthropic_api_key.strip()),
    }


app.mount("/media", StaticFiles(directory=settings.media_dir, check_dir=False), name="media")
