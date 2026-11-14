"""Push-to-talk semantics for the table button (same as the browser guest screen).

- hold >= threshold: record while held, send on release;
- tap < threshold: recording stays on, the next press sends it;
- duplicate presses (two sources, contact bounce that slipped through) are ignored.

Barge-in is the caller's job: start_recording() is also what interrupts a reply.
"""

import time
from collections.abc import Callable

TAP_THRESHOLD_MS = 300


class PressController:
    def __init__(
        self,
        start_recording: Callable[[], None],
        stop_recording: Callable[[], None],
        *,
        tap_threshold_ms: int = TAP_THRESHOLD_MS,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._start = start_recording
        self._stop = stop_recording
        self.tap_threshold = tap_threshold_ms / 1000
        self._now = now
        self._down = False
        self._pressed_at = 0.0
        self._holding = False
        self._latched = False
        self._swallow_release = False

    @property
    def latched(self) -> bool:
        return self._latched

    def press(self) -> None:
        if self._down:
            return
        self._down = True
        if self._latched:
            self._latched = False
            self._swallow_release = True
            self._stop()
            return
        self._pressed_at = self._now()
        self._holding = True
        self._start()

    def release(self) -> None:
        if not self._down:
            return
        self._down = False
        if self._swallow_release:
            self._swallow_release = False
            return
        if not self._holding:
            return
        self._holding = False
        if self._now() - self._pressed_at < self.tap_threshold:
            self._latched = True
        else:
            self._stop()

    def reset(self) -> None:
        """Forget a held or latched recording (it was stopped or cancelled elsewhere)."""
        self._latched = False
        self._holding = False
        self._swallow_release = self._down
