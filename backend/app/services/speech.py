"""Turning the waiter's reply into ordered speech events.

The reply streams in as text deltas. Complete sentences are cut off as soon as
they appear and handed to TTS right away (concurrently). Nothing is emitted until
the caller knows the text is the final spoken reply (`commit`); text written next
to a tool call is tool chatter and is thrown away (`discard`), cancelling any
speculative synthesis. Audio is always emitted strictly in sentence order.
"""

import asyncio
import base64
import logging
import re
from collections.abc import Awaitable, Callable

log = logging.getLogger(__name__)

# Sentence end: . ! ? … and CJK / Armenian full stops, followed by space or end.
_END = re.compile(r"([.!?…。！？։]+[\"'»”)\]]*)(\s+|$)")
MIN_SENTENCE_CHARS = 24

Emit = Callable[[dict], Awaitable[None]]
Synthesize = Callable[[str], Awaitable[bytes | None]]


class SentenceSplitter:
    """Incremental splitter. Short fragments are merged with the next sentence so
    TTS gets natural chunks ("Sure." + "The Pad Thai has peanuts.")."""

    def __init__(self, min_chars: int = MIN_SENTENCE_CHARS) -> None:
        self.buf = ""
        self.min_chars = min_chars

    def feed(self, delta: str) -> list[str]:
        self.buf += delta
        out: list[str] = []
        start = 0
        pending = ""
        for m in _END.finditer(self.buf):
            if m.group(2) == "":
                # Punctuation at the very end of the buffer: wait for what follows
                # (could be "3.5" or a closing quote still streaming).
                break
            sentence = (pending + self.buf[start : m.end(1)]).strip()
            start = m.end()
            if len(sentence) < self.min_chars:
                pending = sentence + " "
                continue
            out.append(sentence)
            pending = ""
        self.buf = pending + self.buf[start:]
        return out

    def flush(self) -> list[str]:
        rest = " ".join(self.buf.split())
        self.buf = ""
        return [rest] if rest else []


def split_sentences(text: str, min_chars: int = MIN_SENTENCE_CHARS) -> list[str]:
    s = SentenceSplitter(min_chars)
    return s.feed(text) + s.flush()


class SpeechPipeline:
    """Collects one model response's text; commit() speaks it, discard() drops it."""

    def __init__(self, emit: Emit, synthesize: Synthesize | None, seq_start: int = 0) -> None:
        self.emit = emit
        self.synthesize = synthesize
        self.splitter = SentenceSplitter()
        self.items: list[tuple[str, asyncio.Task | None]] = []
        self.next_seq = seq_start
        self.raw_text = ""

    def feed(self, delta: str) -> None:
        self.raw_text += delta
        for sentence in self.splitter.feed(delta):
            self._add(sentence)

    def _add(self, sentence: str) -> None:
        task = asyncio.create_task(self._tts(sentence)) if self.synthesize else None
        self.items.append((sentence, task))

    async def _tts(self, sentence: str) -> bytes | None:
        try:
            return await self.synthesize(sentence)  # type: ignore[misc]
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("TTS failed for a sentence; continuing without its audio")
            return None

    @property
    def text(self) -> str:
        return " ".join(self.raw_text.split())

    def discard(self) -> None:
        for _, task in self.items:
            if task is not None and not task.done():
                task.cancel()
        self.items.clear()
        self.splitter = SentenceSplitter()
        self.raw_text = ""

    async def commit(self) -> str:
        """Emit every sentence as text, then its audio in order. Returns the spoken text."""
        for sentence in self.splitter.flush():
            self._add(sentence)
        try:
            for sentence, _ in self.items:
                await self.emit({"type": "text", "delta": sentence + " "})
            for _, task in self.items:
                if task is None:
                    continue
                audio = await task
                if audio:
                    await self.emit(
                        {
                            "type": "audio",
                            "seq": self.next_seq,
                            "mime": "audio/mpeg",
                            "b64": base64.b64encode(audio).decode("ascii"),
                        }
                    )
                    self.next_seq += 1
        finally:
            for _, task in self.items:
                if task is not None and not task.done():
                    task.cancel()
        spoken = " ".join(s for s, _ in self.items)
        self.items.clear()
        self.raw_text = ""
        return spoken
