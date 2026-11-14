"""Shared ElevenLabs REST client (httpx) plus the voice and model listings.

Without ELEVENLABS_API_KEY everything here degrades quietly: listings are empty
and `voice_enabled` is false, so the app runs in text mode.
"""

import logging
import time

import httpx

from app.config import settings

log = logging.getLogger(__name__)

BASE_URL = "https://api.elevenlabs.io"

_client: httpx.AsyncClient | None = None
_cache: dict[str, tuple[float, object]] = {}
CACHE_SECONDS = 300


class ElevenLabsError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"ElevenLabs {status}: {message}")
        self.status = status
        self.message = message


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=10),
        )
    return _client


def headers() -> dict[str, str]:
    return {"xi-api-key": settings.elevenlabs_api_key.strip()}


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def raise_for(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    try:
        detail = resp.json().get("detail")
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
    except Exception:
        message = resp.text[:300]
    raise ElevenLabsError(resp.status_code, message or resp.reason_phrase)


async def _cached(key: str, loader):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = await loader()
    _cache[key] = (time.monotonic(), value)
    return value


async def list_voices() -> list[dict]:
    if not settings.voice_enabled:
        return []

    async def load():
        resp = await client().get("/v1/voices", headers=headers())
        raise_for(resp)
        return [
            {
                "voice_id": v.get("voice_id"),
                "name": v.get("name"),
                "preview_url": v.get("preview_url"),
                "labels": v.get("labels") or {},
            }
            for v in resp.json().get("voices", [])
        ]

    try:
        return await _cached("voices", load)
    except Exception:
        log.exception("could not list ElevenLabs voices")
        return []


async def list_tts_models() -> list[dict]:
    """Live TTS models from GET /v1/models (empty without a key or on error)."""
    if not settings.voice_enabled:
        return []

    async def load():
        resp = await client().get("/v1/models", headers=headers())
        raise_for(resp)
        return [
            {"id": m["model_id"], "label": m.get("name") or m["model_id"]}
            for m in resp.json()
            if m.get("can_do_text_to_speech", True) and m.get("model_id")
        ]

    try:
        return await _cached("models", load)
    except Exception:
        log.exception("could not list ElevenLabs models")
        return []
