"""Speech to text: ElevenLabs Scribe, language detected automatically."""

import logging
import re
from dataclasses import dataclass

from app.catalog import STT_MODELS
from app.services import elevenlabs
from app.services.language import to_iso1

log = logging.getLogger(__name__)

_TAGS = re.compile(r"[\(\[][^\)\]]{0,60}[\)\]]")


@dataclass
class Transcript:
    text: str
    language: str | None  # ISO 639-1 when it maps, else None
    raw_language: str | None


def clean(text: str) -> str:
    """Drop audio-event tags like "(background noise)" and treat letterless output as silence."""
    text = " ".join(_TAGS.sub(" ", text or "").split())
    if sum(ch.isalpha() for ch in text) < 2:
        return ""
    return text


async def _request(audio: bytes, filename: str, content_type: str, model_id: str) -> dict:
    resp = await elevenlabs.client().post(
        "/v1/speech-to-text",
        headers=elevenlabs.headers(),
        data={"model_id": model_id, "tag_audio_events": "false"},
        files={"file": (filename, audio, content_type)},
        timeout=60.0,
    )
    elevenlabs.raise_for(resp)
    return resp.json()


async def transcribe(audio: bytes, *, filename: str, content_type: str, model_id: str) -> Transcript:
    try:
        data = await _request(audio, filename, content_type, model_id)
    except elevenlabs.ElevenLabsError as e:
        # Unknown / retired model id: retry once on the next catalog model.
        fallback = next((m["id"] for m in STT_MODELS if m["id"] != model_id), None)
        if e.status in (400, 404, 422) and "model" in e.message.lower() and fallback:
            log.warning("STT model %s rejected (%s); retrying with %s", model_id, e.message, fallback)
            data = await _request(audio, filename, content_type, fallback)
        else:
            raise
    raw_lang = data.get("language_code")
    return Transcript(text=clean(data.get("text", "")), language=to_iso1(raw_lang), raw_language=raw_lang)
