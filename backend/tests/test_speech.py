import asyncio
import base64

from app.services.language import detect_language, to_iso1
from app.services.speech import SentenceSplitter, SpeechPipeline, split_sentences
from app.services.stt import clean


def test_split_english_merges_short_fragments():
    assert split_sentences("Sure. The noodles have peanuts in them. Would you like something else?") == [
        "Sure. The noodles have peanuts in them.",
        "Would you like something else?",
    ]


def test_split_keeps_decimals_together():
    assert split_sentences("That comes to fourteen fifty, or 14.50 dollars. Anything else for you today?") == [
        "That comes to fourteen fifty, or 14.50 dollars.",
        "Anything else for you today?",
    ]


def test_split_spanish_and_armenian():
    assert split_sentences("¡Claro que sí, con mucho gusto! ¿Tiene alguna alergia alimentaria?") == [
        "¡Claro que sí, con mucho gusto!",
        "¿Tiene alguna alergia alimentaria?",
    ]
    assert split_sentences("Իհարկե, սիրով կօգնեմ ձեզ։ Ունե՞ք որևէ սննդային ալերգիա։") == [
        "Իհարկե, սիրով կօգնեմ ձեզ։",
        "Ունե՞ք որևէ սննդային ալերգիա։",
    ]


def test_streaming_split_matches_whole_split():
    text = "Great choice, the risotto is lovely. It has parmesan and butter. Shall I add it?"
    splitter = SentenceSplitter()
    out = []
    for ch in text:
        out += splitter.feed(ch)
    out += splitter.flush()
    assert out == split_sentences(text)


async def test_audio_is_emitted_strictly_in_order_after_its_text():
    delays = {
        "First sentence is the longest to synthesize.": 0.05,
        "Second one comes back much faster than that.": 0.0,
        "And a third, also quick to come back.": 0.01,
    }

    async def synth(sentence: str) -> bytes:
        await asyncio.sleep(delays[sentence])
        return sentence.encode()

    events = []

    async def emit(e):
        events.append(e)

    p = SpeechPipeline(emit, synth)
    p.feed(" ".join(delays))
    spoken = await p.commit()
    audio = [e for e in events if e["type"] == "audio"]
    assert [e["seq"] for e in audio] == [0, 1, 2]
    assert [base64.b64decode(e["b64"]).decode() for e in audio] == list(delays)
    first_audio = next(i for i, e in enumerate(events) if e["type"] == "audio")
    assert all(e["type"] == "text" for e in events[:first_audio])
    assert spoken == " ".join(delays)


async def test_failed_sentence_does_not_leave_a_seq_gap():
    async def synth(sentence: str) -> bytes:
        if sentence.startswith("Broken"):
            raise RuntimeError("tts down")
        return b"ok"

    events = []

    async def emit(e):
        events.append(e)

    p = SpeechPipeline(emit, synth)
    p.feed("Broken sentence that fails to synthesize. A healthy sentence that works fine.")
    await p.commit()
    assert [e["seq"] for e in events if e["type"] == "audio"] == [0]


async def test_discard_cancels_speculative_tts():
    started = asyncio.Event()

    async def synth(sentence: str) -> bytes:
        started.set()
        await asyncio.sleep(10)
        return b""

    p = SpeechPipeline(lambda e: None, synth)  # type: ignore[arg-type]
    p.feed("Let me check that for you right away. ")
    await asyncio.wait_for(started.wait(), 1)
    tasks = [t for _, t in p.items]
    p.discard()
    await asyncio.sleep(0)
    assert all(t.cancelled() or t.done() for t in tasks)


def test_language_detection_and_mapping():
    assert detect_language("¿Qué me recomienda? Quiero algo sin gluten") == "es"
    assert detect_language("Что вы посоветуете?") == "ru"
    assert detect_language("Ինչ կառաջարկեք") == "hy"
    assert detect_language("What do you recommend?") == "en"
    assert to_iso1("hye") == "hy" and to_iso1("spa") == "es" and to_iso1("en") == "en"


def test_stt_noise_is_silence():
    assert clean("(background noise)") == ""
    assert clean("[music] Hola, quiero pedir") == "Hola, quiero pedir"
