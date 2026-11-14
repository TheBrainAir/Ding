"""Text to speech: ElevenLabs streaming endpoint, one request per sentence."""

import asyncio
import logging

from app.services import elevenlabs

log = logging.getLogger(__name__)

OUTPUT_FORMAT = "mp3_44100_128"
# ElevenLabs limits concurrent requests per plan; stay well inside it.
MAX_CONCURRENT = 3
_slots: dict[asyncio.AbstractEventLoop, asyncio.Semaphore] = {}


def _semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _slots:
        _slots[loop] = asyncio.Semaphore(MAX_CONCURRENT)
    return _slots[loop]


async def _request(text: str, voice_id: str, model_id: str, language_code: str | None) -> bytes:
    body: dict = {"text": text, "model_id": model_id}
    if language_code:
        body["language_code"] = language_code
    async with elevenlabs.client().stream(
        "POST",
        f"/v1/text-to-speech/{voice_id}/stream",
        params={"output_format": OUTPUT_FORMAT},
        headers=elevenlabs.headers(),
        json=body,
    ) as resp:
        if resp.status_code >= 400:
            await resp.aread()
            elevenlabs.raise_for(resp)
        return b"".join([chunk async for chunk in resp.aiter_bytes()])


async def synthesize(text: str, *, voice_id: str, model_id: str, language_code: str | None) -> bytes:
    async with _semaphore():
        try:
            return await _request(text, voice_id, model_id, language_code)
        except elevenlabs.ElevenLabsError as e:
            # Some models refuse an explicit language_code: retry without it.
            if language_code and e.status in (400, 422):
                log.warning("TTS rejected language_code=%s (%s); retrying without", language_code, e.message)
                return await _request(text, voice_id, model_id, None)
            raise
