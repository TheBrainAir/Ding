"""In-process pub/sub for the dashboard SSE stream (`GET /api/events`).

Publishing is safe from the event loop and from threadpool endpoints.
"""

import asyncio
import logging
from collections import defaultdict

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

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
            if running is not None and (self._loop is None or running is self._loop):
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
