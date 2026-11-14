"""Open SSE streams must not hold up a server shutdown or reload."""

import asyncio
import os
import signal
import time

import pytest

from app.api import events as events_api
from app.events import bus


class ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


async def test_sse_stream_closes_when_the_server_shuts_down(demo):
    rid = demo["restaurant"].id
    bus.bind_loop(asyncio.get_running_loop())
    bus.shutting_down = False  # an earlier TestClient app shutdown in this process raised it
    response = await events_api.events(ConnectedRequest(), r=demo["restaurant"])
    stream = response.body_iterator
    assert "connected" in await stream.__anext__()
    bus.publish(rid, "order.placed", {"id": 1})
    assert (await stream.__anext__()).startswith("event: order.placed\ndata: ")
    bus.shutting_down = True
    try:
        started = time.monotonic()
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(stream.__anext__(), 3)
        assert time.monotonic() - started < events_api.CHECK_SECONDS + 1
    finally:
        bus.shutting_down = False
    assert not bus._subs.get(rid)


def test_shutdown_hook_flags_and_chains_to_the_server_handler():
    seen = []
    saved = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
    signal.signal(signal.SIGTERM, lambda signum, _frame: seen.append(signum))  # stands in for uvicorn's
    try:
        bus.install_shutdown_hook()
        bus.install_shutdown_hook()  # idempotent: no double wrapping
        os.kill(os.getpid(), signal.SIGTERM)
        deadline = time.monotonic() + 2
        while not seen and time.monotonic() < deadline:
            time.sleep(0.01)
        assert seen == [signal.SIGTERM] and bus.shutting_down is True
    finally:
        for s, handler in saved.items():
            signal.signal(s, handler)
        bus.shutting_down = False
