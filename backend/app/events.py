"""In-process pub/sub for the dashboard SSE stream (`GET /api/events`).

Publishing is safe from the event loop and from threadpool endpoints.

SSE streams never end on their own, and uvicorn waits for open connections before it
shuts down (on --reload and on Ctrl+C). `install_shutdown_hook` chains a handler in
front of uvicorn's SIGINT/SIGTERM handlers that raises `bus.shutting_down`; the
streams check it every second and close, so shutdown is not held up.
"""

import asyncio
import logging
import signal
import threading
from collections import defaultdict

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None
        self.shutting_down = False

    def install_shutdown_hook(self) -> None:
        """Call from startup (main thread, after the server installed its own handlers)."""
        self.shutting_down = False
        if threading.current_thread() is not threading.main_thread():
            return
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous = signal.getsignal(sig)
            if getattr(previous, "_ding_shutdown_hook", False):
                continue

            def handler(signum, frame, _previous=previous) -> None:
                self.shutting_down = True
                if callable(_previous):
                    _previous(signum, frame)
                elif _previous == signal.SIG_DFL and signum == signal.SIGINT:
                    raise KeyboardInterrupt

            handler._ding_shutdown_hook = True  # type: ignore[attr-defined]
            signal.signal(sig, handler)

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, restaurant_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs[restaurant_id].add(q)
        return q

    def unsubscribe(self, restaurant_id: int, q: asyncio.Queue) -> None:
        self._subs[restaurant_id].discard(q)

    def publish(self, restaurant_id: int, event: str, data: dict) -> None:
        subs = list(self._subs.get(restaurant_id, ()))
        if not subs:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        for q in subs:
            if running is not None and (self._loop is None or running is self._loop or self._loop.is_closed()):
                self._put(q, event, data)
            elif self._loop is not None:
                self._loop.call_soon_threadsafe(self._put, q, event, data)

    @staticmethod
    def _put(q: asyncio.Queue, event: str, data: dict) -> None:
        try:
            q.put_nowait((event, data))
        except asyncio.QueueFull:
            log.warning("SSE subscriber queue full; dropping %s", event)


bus = EventBus()
