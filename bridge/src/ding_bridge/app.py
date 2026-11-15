"""The bridge itself: button presses in, recorded speech to the backend, the reply out loud.

Everything runs on one asyncio loop. The serial thread and the keyboard thread only post
events; the audio callbacks only touch thread-safe buffers.

    idle --press--> listening --release/tap--> thinking --first audio--> speaking --done--> idle
                        ^                          |                         |
                        +------- press (barge-in: stop playback, drop the request) ----+
"""

import asyncio
import base64
from contextlib import aclosing
from dataclasses import dataclass, field
from enum import StrEnum

from ding_bridge import audio, earcons
from ding_bridge.backend import BackendError
from ding_bridge.console import Console
from ding_bridge.press import TAP_THRESHOLD_MS, PressController
from ding_bridge.serial_link import LCD_WIDTH, lcd_text


class State(StrEnum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"


_DOLLAR = {"USD", "CAD", "AUD", "NZD", "SGD", "HKD", "MXN"}


def info_line(order: dict | None, table_label: str) -> str:
    """LCD line 2, same rules as the guest screen: label, "N items $X", or where the order is."""
    label = lcd_text(table_label) or "Ding"
    if not order or not order.get("items"):
        return label
    status = order.get("status")
    if status == "draft":
        count = sum(int(i.get("quantity", 1)) for i in order["items"])
        items = f"{count} item{'' if count == 1 else 's'}"
        total, currency = float(order.get("total", 0)), str(order.get("currency", "")).upper()

        def money(cents: bool) -> str:
            amount = f"{total:.2f}" if cents else str(round(total))
            return f"${amount}" if currency in _DOLLAR else f"{amount} {currency}"

        for line in (f"{items} {money(True)}", f"{items} {money(False)}", f"{items} {round(total)}", items):
            if len(line) <= LCD_WIDTH:
                return lcd_text(line)
        return items
    return {"placed": "Order sent", "preparing": "Being prepared", "served": "Enjoy your meal"}.get(status, label)


class OrderedChunks:
    """Releases audio chunks strictly in `seq` order, whatever order they arrive in."""

    def __init__(self) -> None:
        self.next = 0
        self._pending: dict[int, object] = {}

    def add(self, seq: int, item: object) -> list[object]:
        if seq < self.next:
            return []  # duplicate
        self._pending[seq] = item
        ready = []
        while self.next in self._pending:
            ready.append(self._pending.pop(self.next))
            self.next += 1
        return ready

    def flush(self) -> list[object]:
        """Everything still waiting (a missing seq should not hold the rest hostage)."""
        ready = [self._pending[k] for k in sorted(self._pending)]
        self._pending.clear()
        return ready


@dataclass
class TurnResult:
    transcript: str = ""
    language: str | None = None
    reply: str = ""
    audio_chunks: int = 0
    state: dict | None = None
    error: str | None = None
    done: bool = False
    waiter_called: list[str] = field(default_factory=list)


class Bridge:
    def __init__(
        self,
        backend,
        player,
        recorder,
        *,
        link=None,
        console: Console | None = None,
        tap_ms: int = TAP_THRESHOLD_MS,
        max_seconds: float = 30.0,
        min_seconds: float = 0.35,
        tick_after: float = 1.5,
        tick_every: float = 1.5,
        decode=audio.decode,
        table_label: str = "",
    ) -> None:
        self.backend = backend
        self.table_label = table_label
        self.player = player
        self.recorder = recorder
        self.link = link
        self.console = console or Console()
        self.max_seconds = max_seconds
        self.min_seconds = min_seconds
        self.tick_after = tick_after
        self.tick_every = tick_every
        self.decode = decode
        self.press = PressController(self._start_recording, self._stop_recording, tap_threshold_ms=tap_ms)
        self.state = State.IDLE
        self.history: list[TurnResult] = []
        self.states: list[str] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._events: asyncio.Queue | None = None
        self._turn: asyncio.Task | None = None
        self._max_timer: asyncio.TimerHandle | None = None
        self._running = False

    # ------------------------------------------------------------ events

    def post(self, kind: str, *args) -> None:
        """Thread-safe: queue an event for the loop."""
        if self._loop is None or self._events is None:
            return
        self._loop.call_soon_threadsafe(self._events.put_nowait, (kind, args))

    def on_serial_line(self, line: str) -> None:
        kind = {"PRESS": "press", "RELEASE": "release", "READY": "ready"}.get(line.strip().upper())
        if kind:
            self.post(kind)
        else:
            self.post("debug", f"serial: ignored {line!r}")

    def on_serial_status(self, kind: str, message: str) -> None:
        self.post("link", kind, message)

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._events = asyncio.Queue()
        self._running = True
        self._set_state(State.IDLE, force=True)
        self._send_info(None)
        while self._running:
            kind, args = await self._events.get()
            await self.handle(kind, *args)

    async def handle(self, kind: str, *args) -> None:
        if kind == "press":
            self.press.press()
        elif kind == "release":
            self.press.release()
        elif kind == "toggle":  # keyboard: a tap
            self.press.press()
            self.press.release()
        elif kind == "max":
            if self.recorder.recording:
                self.console.warn(f"recording hit {self.max_seconds:.0f} s, sending it")
                self.press.reset()
                self._stop_recording()
        elif kind == "reset":
            await self.reset_table()
        elif kind == "status":
            self.status()
        elif kind == "ready":
            self.console.info("table button ready")
            if self.link is not None:
                self.link.resend_state()
        elif kind == "link":
            status, message = args
            if status == "connected":
                self.console.ok(f"table button connected on {message}")
            elif status == "disconnected":
                self.console.warn(f"table button disconnected ({message}); waiting for it to come back")
            else:
                self.console.warn(message)
        elif kind == "debug":
            self.console.debug(args[0])
        elif kind == "help":
            self.console.info(HELP)
        elif kind == "quit":
            self._running = False

    # ------------------------------------------------------------ state

    def _set_state(self, state: State, *, force: bool = False) -> None:
        if state == self.state and not force:
            return
        self.state = state
        self.states.append(state.value)
        self.console.state(state.value)
        if self.link is not None:
            self.link.send_state(state.value)

    def _send_info(self, order: dict | None) -> None:
        if self.link is not None and hasattr(self.link, "send_info"):
            self.link.send_info(info_line(order, self.table_label))

    def earcon(self, name: str) -> None:
        self.player.play(earcons.ALL[name](self.player.sample_rate))

    def status(self) -> None:
        link = "keyboard only" if self.link is None else (self.link.port if self.link.connected else "disconnected")
        self.console.info(f"state={self.state.value} button={link} turns={len(self.history)}")
        if self.history and self.history[-1].state:
            self.console.turn_state(self.history[-1].state)

    # ------------------------------------------------------------ recording

    def _cancel_turn(self) -> bool:
        if self._turn is not None and not self._turn.done():
            self._turn.cancel()
            return True
        return False

    def _start_recording(self) -> None:
        if self._cancel_turn():
            self.console.info("barge-in: reply stopped")
        self.player.stop_now()
        try:
            self.recorder.start()
        except audio.AudioError as e:
            self.console.error(str(e))
            self.press.reset()
            self.earcon("error")
            self._set_state(State.IDLE)
            return
        self.earcon("listening")
        self._set_state(State.LISTENING)
        if self._loop is not None:
            self._max_timer = self._loop.call_later(self.max_seconds, self.post, "max")

    def _stop_recording(self) -> None:
        if self._max_timer is not None:
            self._max_timer.cancel()
            self._max_timer = None
        if not self.recorder.recording:
            return
        wav, seconds = self.recorder.stop()
        if seconds < self.min_seconds:
            self.console.warn(f"recording too short ({seconds:.2f} s), ignored")
            self.earcon("error")
            self._set_state(State.IDLE)
            return
        self.console.debug(f"recorded {seconds:.1f} s ({len(wav) // 1024} KB)")
        self.earcon("got_it")
        self._set_state(State.THINKING)
        self._turn = asyncio.get_running_loop().create_task(self._run_turn(wav))

    async def reset_table(self) -> None:
        self._cancel_turn()
        self.player.stop_now()
        if self.recorder.recording:
            self.recorder.cancel()
        self.press.reset()
        self._set_state(State.IDLE)
        try:
            await self.backend.reset()
            self.console.ok("table reset: the next press starts a new guest")
            self._send_info(None)
        except BackendError as e:
            self.console.error(f"reset failed: {e}")

    # ------------------------------------------------------------ the turn

    async def _ticks(self) -> None:
        """Soft ticks while the waiter is thinking, so the guest knows the press registered."""
        await asyncio.sleep(self.tick_after)
        while self.state == State.THINKING:
            self.earcon("thinking")
            await asyncio.sleep(self.tick_every)

    def _play_chunk(self, pcm, result: TurnResult, ticker: asyncio.Task) -> None:
        if pcm is None:
            return
        self.player.play(pcm)
        result.audio_chunks += 1
        if self.state != State.SPEAKING:
            ticker.cancel()
            self._set_state(State.SPEAKING)

    async def _run_turn(self, wav: bytes) -> None:
        result = TurnResult()
        ordered = OrderedChunks()
        ticker = asyncio.get_running_loop().create_task(self._ticks())
        try:
            # aclosing: on barge-in the cancellation closes the HTTP stream right away,
            # which drops the request (the backend cancels the turn when the client goes).
            async with aclosing(self.backend.turn(wav)) as events:
                async for event in events:
                    kind = event.get("type")
                    if kind == "transcript":
                        result.transcript = event.get("text") or ""
                        result.language = event.get("language")
                        self.console.guest(result.transcript, result.language)
                    elif kind == "text":
                        result.reply += event.get("delta", "")
                        self.console.waiter_delta(event.get("delta", ""))
                    elif kind == "audio":
                        try:
                            pcm = self.decode(base64.b64decode(event["b64"]), self.player.sample_rate)
                        except (audio.AudioError, KeyError, ValueError) as e:
                            self.console.warn(f"skipped an audio chunk: {e}")
                            pcm = None
                        for ready in ordered.add(int(event.get("seq", ordered.next)), pcm):
                            self._play_chunk(ready, result, ticker)
                    elif kind == "dishes":
                        names = ", ".join(d.get("name", "?") for d in event.get("dishes", []))
                        self.console.end_inline()
                        self.console.debug(f"looked up: {names}")
                    elif kind == "state":
                        result.state = event
                    elif kind == "waiter_called":
                        result.waiter_called.append(event.get("reason", ""))
                    elif kind == "error":
                        result.error = event.get("message") or "unknown error"
                    elif kind == "done":
                        result.done = True
        except BackendError as e:
            result.error = str(e)
        finally:
            ticker.cancel()
        for ready in ordered.flush():
            self._play_chunk(ready, result, ticker)
        if not result.done and not result.error:
            result.error = "the reply stream ended early"

        self.console.end_inline()
        if result.state:
            self.console.turn_state(result.state)
            self._send_info(result.state.get("order"))
        for reason in result.waiter_called:
            self.console.warn(f"staff called to the table: {reason}")
        if result.error:
            self.console.error(result.error)
            self.earcon("error")
        elif not result.transcript.strip():
            self.console.warn("didn't catch that")
            self.earcon("error")
        elif result.audio_chunks == 0:
            self.console.warn("the reply came without audio (TTS failed on the server?)")
            self.earcon("error")
        self.history.append(result)

        # The audio callback drains the queue on its own thread; poll until it is empty.
        while self.player.busy:  # noqa: ASYNC110
            await asyncio.sleep(0.03)
        self._set_state(State.IDLE)

    async def shutdown(self) -> None:
        self._cancel_turn()
        if self._turn is not None:
            await asyncio.gather(self._turn, return_exceptions=True)
        if self.recorder.recording:
            self.recorder.cancel()
        self.player.stop_now()
        self._set_state(State.IDLE)


HELP = (
    "controls: press the table button to talk (hold = talk while held, tap = start, tap again = send; "
    "press while the waiter talks to interrupt). Terminal: Enter = same as a tap, "
    "r = reset the table for a new guest, s = status, q = quit."
)
