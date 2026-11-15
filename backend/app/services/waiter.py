"""The waiter agent loop: one guest utterance in, a spoken reply (and tool effects) out.

Per step the model response is streamed. Text that ends up next to a tool call is
tool chatter and is never spoken; text of the final response is spoken (TTS starts
speculatively while the response is still streaming). The conversation history is
append-only: every assistant turn is stored exactly as returned, thinking blocks
included, and tool results go back in one user message per step.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from sqlalchemy.orm import Session

from app.config import settings
from app.events import bus
from app.models import GuestSession, Restaurant, utcnow
from app.serializers import (
    allergies_out,
    guest_dish_out,
    guest_order_out,
    iso,
    latest_order,
    session_summary_out,
)
from app.services import elevenlabs, llm, prompts, translate, tts
from app.services.speech import SpeechPipeline
from app.services.tools import TOOLS, ToolContext, execute_tool

log = logging.getLogger(__name__)

MAX_STEPS = 8

Emit = Callable[[dict], Awaitable[None]]

CANNED = {
    "repeat": {
        "en": "Sorry, I didn't quite catch that. Could you say it again?",
        "es": "Perdón, no le he entendido bien. ¿Me lo puede repetir?",
        "fr": "Pardon, je n'ai pas bien compris. Pouvez-vous répéter ?",
        "de": "Entschuldigung, das habe ich nicht verstanden. Können Sie es wiederholen?",
        "it": "Mi scusi, non ho capito bene. Può ripetere?",
        "ru": "Извините, я не расслышал. Повторите, пожалуйста.",
        "hy": "Ներողություն, լավ չհասկացա։ Կարո՞ղ եք կրկնել։",
    },
    "staff": {
        "en": "I'm sorry, I can't help with that myself. I've asked a member of staff to come to your table.",
        "es": "Lo siento, con eso no puedo ayudarle yo. He avisado a un compañero para que venga a su mesa.",
        "fr": "Désolé, je ne peux pas vous aider pour cela. J'ai demandé à un collègue de venir à votre table.",
        "de": "Das kann ich leider nicht selbst erledigen. Ich habe eine Kollegin an Ihren Tisch gebeten.",
        "it": "Mi dispiace, non posso aiutarla io. Ho chiesto a un collega di venire al suo tavolo.",
        "ru": "Извините, с этим я помочь не могу. Я попросил сотрудника подойти к вашему столику.",
        "hy": "Ներողություն, դրանում չեմ կարող օգնել։ Խնդրել եմ աշխատակցին մոտենալ ձեր սեղանին։",
    },
}


def _log_step(session_id: int, step: int, message, tool_uses: list[dict], elapsed: float) -> None:
    usage = getattr(message, "usage", None)
    log.info(
        "session %s step %s: %.2fs stop=%s tools=%s speed=%s in=%s cache_read=%s cache_write=%s out=%s",
        session_id,
        step,
        elapsed,
        message.stop_reason,
        [t["name"] for t in tool_uses],
        getattr(usage, "speed", None),
        getattr(usage, "input_tokens", None),
        getattr(usage, "cache_read_input_tokens", None),
        getattr(usage, "cache_creation_input_tokens", None),
        getattr(usage, "output_tokens", None),
    )


def canned(kind: str, language: str | None) -> str:
    table = CANNED[kind]
    return table.get(language or "en", table["en"])


class _Collector:
    """Feeds streamed text into the speech pipeline until a tool call shows up."""

    def __init__(self, pipeline: SpeechPipeline) -> None:
        self.pipeline = pipeline
        self.saw_tool = False
        self.chatter = ""

    def on_block_start(self, index: int, block_type: str) -> None:
        if block_type in ("tool_use", "server_tool_use") and not self.saw_tool:
            self.saw_tool = True
            self.chatter = self.pipeline.text
            self.pipeline.discard()  # stop speculative TTS for tool chatter

    def on_text(self, index: int, text: str) -> None:
        if not self.saw_tool:
            self.pipeline.feed(text)


async def _make_synth(r: Restaurant, language: str | None):
    voice_id = r.voice_id
    if not voice_id:
        voices = await elevenlabs.list_voices()
        voice_id = voices[0]["voice_id"] if voices else ""
    if not voice_id:
        return None

    async def synth(text: str) -> bytes:
        return await tts.synthesize(text, voice_id=voice_id, model_id=r.tts_model, language_code=language)

    return synth


async def run_turn(
    *,
    db: Session,
    session: GuestSession,
    restaurant: Restaurant,
    guest_text: str,
    language: str | None,
    speak: bool,
    emit: Emit,
    stream=llm.stream_message,
) -> str:
    """Run one guest turn to completion, emitting text/audio/dishes/state events.
    Returns the spoken reply. `stream` is injectable for tests."""
    s, r = session, restaurant
    now = utcnow()
    if language:
        s.language = language
    lang = language or s.language

    # Append the guest message. If the owner changed the menu since the model last saw
    # it, the new index rides along inside the system-written state block (a separate
    # role=system message would break the history if a barge-in cut the turn short).
    index = prompts.menu_index(db, r)
    menu_update = prompts.menu_update_note(index) if index != s.menu_index else None
    s.menu_index = index
    # Dish names in the guest's language: cached ones go in the state block; missing ones are
    # translated in the background (never blocking this turn).
    translations = translate.cached(db, r.id, lang)
    if translate.needs_translation(r, lang) and not translations:
        translate.ensure_in_background(r.id, lang)
    state = prompts.session_state(db, s, r, lang, menu_update=menu_update, translations=translations)
    user_content = [
        {"type": "text", "text": prompts.sanitize_guest_text(guest_text)},
        {"type": "text", "text": state},
    ]
    s.messages = list(s.messages or []) + [{"role": "user", "content": user_content}]
    s.transcript = list(s.transcript or []) + [{"role": "guest", "text": guest_text, "at": iso(now)}]
    s.turn_count += 1
    s.last_activity_at = now
    db.commit()

    synth = await _make_synth(r, lang) if speak and settings.voice_enabled else None
    ctx = ToolContext(db=db, session=s, restaurant=r)
    seq = 0
    chatter = ""
    spoken = ""
    pipeline: SpeechPipeline | None = None

    async def say(text: str) -> str:
        nonlocal seq
        p = SpeechPipeline(emit, synth, seq_start=seq)
        p.feed(text)
        out = await p.commit()
        seq = p.next_seq
        return out

    try:
        for _step in range(MAX_STEPS):
            pipeline = SpeechPipeline(emit, synth, seq_start=seq)
            collector = _Collector(pipeline)
            # Explicit breakpoint after tools + system so every new guest of this
            # restaurant reuses the cached prefix; the top-level automatic breakpoint
            # covers the growing conversation.
            system = [{"type": "text", "text": s.system_prompt, "cache_control": {"type": "ephemeral"}}]
            params, use_fast = llm.build_params(model=r.llm_model, system=system, tools=TOOLS, messages=s.messages)
            started = time.monotonic()
            message = await stream(params, collector, use_fast=use_fast)
            content = llm.sanitize_fallback_turn(llm.content_to_dicts(message))
            stop = message.stop_reason
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            _log_step(s.id, _step, message, tool_uses, time.monotonic() - started)

            if stop == "refusal":
                # The whole fallback chain declined. Nothing is appended; hand over to staff.
                pipeline.discard()
                log.warning("session %s: model refusal; calling staff", s.id)
                execute_tool(
                    ctx,
                    "call_human_waiter",
                    {"reason": "The voice waiter could not help with a request at this table."},
                )
                ctx.flush_events()
                spoken = await say(canned("staff", lang))
                break

            if stop == "max_tokens" and tool_uses:
                pipeline.discard()  # a truncated tool call must not run
                spoken = await say(canned("repeat", lang))
                break

            if tool_uses:
                chatter = collector.chatter or pipeline.text or chatter
                pipeline.discard()
                results = []
                for block in tool_uses:
                    outcome = execute_tool(ctx, block["name"], block.get("input"))
                    result = {"type": "tool_result", "tool_use_id": block["id"], "content": outcome.content()}
                    if outcome.is_error:
                        result["is_error"] = True
                    results.append(result)
                s.messages = list(s.messages) + [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": results},
                ]
                s.last_activity_at = utcnow()
                db.commit()
                ctx.flush_events()
                continue

            # Final answer. Persist first, then speak (a barge-in during TTS keeps history whole).
            if not pipeline.text and chatter:
                pipeline.feed(chatter)  # never leave the guest in silence
            s.messages = list(s.messages) + [{"role": "assistant", "content": content}]
            db.commit()
            spoken = await pipeline.commit()
            seq = pipeline.next_seq
            break
        else:
            log.warning("session %s: tool loop hit %s steps", s.id, MAX_STEPS)
            spoken = await say(canned("repeat", lang))
    except BaseException:
        if pipeline is not None:
            pipeline.discard()
        raise

    if spoken:
        s.transcript = list(s.transcript) + [{"role": "waiter", "text": spoken, "at": iso(utcnow())}]
    s.last_activity_at = utcnow()
    db.commit()

    translations = translate.cached(db, r.id, lang)  # may have arrived during the turn
    if ctx.shown_dishes:
        await emit({"type": "dishes", "dishes": [guest_dish_out(d, translations) for d in ctx.shown_dishes.values()]})
    order = latest_order(db, s.id)
    await emit(
        {
            "type": "state",
            "order": guest_order_out(order, translations) if order else None,
            "allergies": allergies_out(s),
            "language": lang,
        }
    )
    for reason in ctx.waiter_calls:
        await emit({"type": "waiter_called", "reason": reason})
    bus.publish(r.id, "session.updated", session_summary_out(db, s))
    return spoken


async def wait_cancelled(task: asyncio.Task | None, grace_seconds: float = 5.0) -> None:
    """Cancel a running turn and give it a moment to unwind."""
    if task is None or task.done():
        return
    task.cancel()
    await asyncio.wait({task}, timeout=grace_seconds)
