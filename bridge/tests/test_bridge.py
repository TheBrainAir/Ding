"""The bridge orchestrator end to end, with a scripted streaming backend and fake audio/serial."""

import asyncio
import base64
import io
import json

import httpx
import numpy as np
import pytest

from ding_bridge.app import Bridge, OrderedChunks, info_line
from ding_bridge.backend import Backend
from ding_bridge.console import Console


class FakePlayer:
    sample_rate = 8000

    def __init__(self) -> None:
        self.played: list = []
        self.stops = 0
        self.hold = False  # pretend audio is still playing

    def play(self, pcm) -> None:
        self.played.append(("pcm", int(pcm[0])))

    def stop_now(self) -> None:
        self.stops += 1
        self.hold = False

    @property
    def busy(self) -> bool:
        return self.hold


class FakeRecorder:
    def __init__(self, seconds: float = 1.5) -> None:
        self.recording = False
        self.seconds = seconds
        self.starts = 0

    def start(self) -> None:
        self.recording, self.starts = True, self.starts + 1

    def stop(self):
        self.recording = False
        return b"RIFF-fake-wav", self.seconds

    def cancel(self) -> None:
        self.recording = False


class FakeLink:
    connected, port = True, "fake"

    def __init__(self) -> None:
        self.states: list[str] = []
        self.infos: list[str] = []

    def send_state(self, s: str) -> None:
        self.states.append(s)

    def send_info(self, text: str) -> None:
        if not self.infos or self.infos[-1] != text:
            self.infos.append(text)

    def resend_state(self) -> None:
        pass


def line(event: dict) -> bytes:
    return (json.dumps(event) + "\n").encode()


def audio_event(seq: int, marker: int) -> dict:
    return {"type": "audio", "seq": seq, "mime": "audio/mpeg", "b64": base64.b64encode(str(marker).encode()).decode()}


def fake_decode(data: bytes, _sr: int) -> np.ndarray:
    return np.full(4, int(data.decode()), dtype=np.float32)


class Server:
    """Scripted NDJSON turns. A script item is an event dict or an asyncio.Event to wait on."""

    def __init__(self) -> None:
        self.scripts: list[list] = []
        self.requests: list[httpx.Request] = []
        self.closed: list[bool] = []
        self.resets = 0

    def transport(self) -> httpx.MockTransport:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/reset"):
                self.resets += 1
                return httpx.Response(204)
            self.requests.append(request)
            script = self.scripts.pop(0)
            index = len(self.closed)
            self.closed.append(False)

            async def body():
                try:
                    for item in script:
                        if isinstance(item, asyncio.Event):
                            await item.wait()
                        else:
                            yield line(item)
                finally:
                    self.closed[index] = True

            return httpx.Response(200, headers={"content-type": "application/x-ndjson"}, content=body())

        return httpx.MockTransport(handler)


async def until(predicate, limit: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + limit
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.005)


@pytest.fixture
async def rig():
    server = Server()
    backend = Backend("http://ding.test", "tok", transport=server.transport())
    player, recorder, link = FakePlayer(), FakeRecorder(), FakeLink()
    bridge = Bridge(
        backend,
        player,
        recorder,
        link=link,
        table_label="Table 4",
        console=Console(stream=io.StringIO()),
        tap_ms=50,
        tick_after=0.05,
        tick_every=0.05,
        decode=fake_decode,
    )
    earcons: list[str] = []
    bridge.earcon = lambda name: (earcons.append(name), player.played.append(("earcon", name)))
    task = asyncio.create_task(bridge.run())
    await asyncio.sleep(0)
    yield {"bridge": bridge, "server": server, "player": player, "recorder": recorder, "link": link, "earcons": earcons}
    bridge.post("quit")
    await asyncio.wait_for(task, 2)
    await bridge.shutdown()
    await backend.aclose()


async def hold(bridge: Bridge, seconds: float = 0.08) -> None:
    bridge.post("press")
    await asyncio.sleep(seconds)
    bridge.post("release")


TRANSCRIPT = {"type": "transcript", "text": "¿Qué me recomienda?", "language": "es"}
STATE = {
    "type": "state",
    "order": None,
    "language": "es",
    "allergies": {"confirmed": False, "allergens": [], "notes": "", "none_declared": False},
}


async def test_hold_to_talk_streams_and_plays_audio_as_it_arrives(rig):
    gate = asyncio.Event()
    rig["server"].scripts.append(
        [
            TRANSCRIPT,
            {"type": "text", "delta": "Con gusto. "},
            audio_event(0, 10),
            gate,
            audio_event(1, 11),
            STATE,
            {"type": "done"},
        ]
    )
    await hold(rig["bridge"])
    # The first chunk plays while the stream is still open (the gate holds the rest back).
    await until(lambda: ("pcm", 10) in rig["player"].played)
    assert rig["bridge"].state == "speaking" and ("pcm", 11) not in rig["player"].played
    gate.set()
    await until(lambda: rig["bridge"].state == "idle" and rig["bridge"].history)
    assert [p for p in rig["player"].played if p[0] == "pcm"] == [("pcm", 10), ("pcm", 11)]
    assert rig["link"].states == ["idle", "listening", "thinking", "speaking", "idle"]
    assert rig["earcons"][:2] == ["listening", "got_it"] and "error" not in rig["earcons"]
    result = rig["bridge"].history[-1]
    assert result.transcript == TRANSCRIPT["text"] and result.reply == "Con gusto. " and result.audio_chunks == 2
    request = rig["server"].requests[0]
    assert request.url.path == "/api/table/tok/turn"
    assert b'name="audio"; filename="speech.wav"' in request.read() and b"RIFF-fake-wav" in request.read()


async def test_out_of_order_chunks_play_in_seq_order(rig):
    rig["server"].scripts.append(
        [TRANSCRIPT, audio_event(2, 32), audio_event(0, 30), audio_event(1, 31), {"type": "done"}]
    )
    await hold(rig["bridge"])
    await until(lambda: rig["bridge"].history)
    assert [p for p in rig["player"].played if p[0] == "pcm"] == [("pcm", 30), ("pcm", 31), ("pcm", 32)]


async def test_tap_starts_and_next_press_sends(rig):
    rig["server"].scripts.append([TRANSCRIPT, audio_event(0, 1), {"type": "done"}])
    b = rig["bridge"]
    b.post("press")
    b.post("release")  # quick tap: keeps recording
    await until(lambda: b.state == "listening")
    await asyncio.sleep(0.1)
    assert rig["recorder"].recording and not rig["server"].requests
    b.post("press")  # sends
    b.post("release")
    await until(lambda: b.history)
    assert rig["recorder"].starts == 1 and len(rig["server"].requests) == 1


async def test_barge_in_stops_playback_and_drops_the_request(rig):
    never = asyncio.Event()
    rig["server"].scripts.append([TRANSCRIPT, audio_event(0, 5), never])
    b, player = rig["bridge"], rig["player"]
    await hold(b)
    await until(lambda: b.state == "speaking")
    player.hold = True  # audio still coming out of the speaker
    stops_before = player.stops
    b.post("press")  # barge-in
    await until(lambda: b.state == "listening")
    assert player.stops > stops_before and rig["recorder"].recording
    await until(lambda: rig["server"].closed[0])  # the in-flight stream was closed
    rig["server"].scripts.append([TRANSCRIPT, audio_event(0, 6), {"type": "done"}])
    await asyncio.sleep(0.08)
    b.post("release")  # it was a hold: the new recording is sent
    await until(lambda: len(b.history) == 1 and b.state == "idle")
    assert len(rig["server"].requests) == 2 and b.history[0].audio_chunks == 1


@pytest.mark.parametrize(
    "script",
    [
        [{"type": "transcript", "text": "", "language": None}, {"type": "done"}],
        [TRANSCRIPT, {"type": "error", "message": "Voice input needs ELEVENLABS_API_KEY on the server."}],
        [TRANSCRIPT, {"type": "text", "delta": "Hola."}],  # stream cut before done
        [TRANSCRIPT, {"type": "text", "delta": "Hola."}, {"type": "done"}],  # reply without audio
    ],
    ids=["nothing-heard", "error-event", "cut-off", "no-audio"],
)
async def test_no_reply_audio_always_ends_with_the_error_earcon(rig, script):
    rig["server"].scripts.append(script)
    await hold(rig["bridge"])
    await until(lambda: rig["bridge"].history and rig["bridge"].state == "idle")
    assert rig["earcons"][-1] == "error"


async def test_backend_down_during_a_turn(rig):
    b = rig["bridge"]
    b.backend.client._transport = httpx.MockTransport(lambda r: (_ for _ in ()).throw(httpx.ConnectError("down")))
    await hold(b)
    await until(lambda: b.history and b.state == "idle")
    assert "cannot" in b.history[0].error or "lost" in b.history[0].error
    assert rig["earcons"][-1] == "error"


async def test_thinking_ticks_until_the_first_audio(rig):
    gate = asyncio.Event()
    rig["server"].scripts.append([gate, TRANSCRIPT, audio_event(0, 1), {"type": "done"}])
    await hold(rig["bridge"])
    await until(lambda: rig["earcons"].count("thinking") >= 2)
    gate.set()
    await until(lambda: rig["bridge"].state == "idle" and rig["bridge"].history)
    ticks = rig["earcons"].count("thinking")
    await asyncio.sleep(0.15)
    assert rig["earcons"].count("thinking") == ticks


async def test_too_short_recording_is_not_sent(rig):
    rig["recorder"].seconds = 0.1
    await hold(rig["bridge"])
    await until(lambda: rig["earcons"] and rig["earcons"][-1] == "error")
    assert not rig["server"].requests and rig["bridge"].state == "idle"


async def test_recording_is_sent_at_the_time_limit(rig):
    rig["bridge"].max_seconds = 0.1
    rig["server"].scripts.append([TRANSCRIPT, audio_event(0, 1), {"type": "done"}])
    rig["bridge"].post("press")  # held down and never released
    await until(lambda: len(rig["server"].requests) == 1)
    rig["bridge"].post("release")  # the late release must not start anything
    await until(lambda: rig["bridge"].history and rig["bridge"].state == "idle")
    assert rig["recorder"].starts == 1


async def test_reset_and_serial_lines(rig):
    b = rig["bridge"]
    b.on_serial_line("PRESS")
    await until(lambda: b.state == "listening")
    b.post("reset")
    await until(lambda: rig["server"].resets == 1)
    assert b.state == "idle" and not rig["recorder"].recording
    b.on_serial_line("RELEASE")  # stray release after the reset: ignored
    b.on_serial_line("garbage")
    await asyncio.sleep(0.05)
    assert b.state == "idle" and not rig["server"].requests


def test_ordered_chunks():
    o = OrderedChunks()
    assert o.add(1, "b") == []
    assert o.add(0, "a") == ["a", "b"]
    assert o.add(0, "dup") == []
    assert o.add(3, "d") == []
    assert o.flush() == ["d"]


async def test_lcd_info_follows_the_order(rig):
    items = [{"name": "Pad Thai", "quantity": 2, "allergen_flag": False}, {"name": "Tea", "quantity": 1}]
    draft = {"id": 7, "status": "draft", "items": items, "total": 29.0, "currency": "USD"}
    placed = {**draft, "status": "placed"}
    for turns, order in enumerate((draft, placed), start=1):
        rig["server"].scripts.append([TRANSCRIPT, audio_event(0, 1), {**STATE, "order": order}, {"type": "done"}])
        await hold(rig["bridge"])
        await until(lambda n=turns: rig["bridge"].state == "idle" and len(rig["bridge"].history) == n)
    rig["bridge"].post("reset")
    await until(lambda: rig["server"].resets == 1)
    assert rig["link"].infos == ["Table 4", "3 items $29.00", "Order sent", "Table 4"]


def test_info_line_rules():
    assert info_line(None, "Терраса 2") == "??????? 2"
    assert (
        info_line({"status": "draft", "items": [{"quantity": 2}], "total": 29, "currency": "EUR"}, "T")
        == "2 items 29 EUR"
    )
    assert info_line({"status": "served", "items": [{"quantity": 1}], "total": 9}, "T") == "Enjoy your meal"
    assert info_line({"status": "cancelled", "items": [{"quantity": 1}], "total": 9}, "Table 4") == "Table 4"
