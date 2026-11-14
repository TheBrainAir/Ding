"""Dashboard live feed: Server-Sent Events, one stream per signed-in browser tab."""

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.deps import current_restaurant
from app.events import bus
from app.models import Restaurant

router = APIRouter(tags=["events"])

PING_SECONDS = 15
CHECK_SECONDS = 1.0  # how quickly a stream notices a disconnect or a server shutdown


@router.get("/events")
async def events(request: Request, r: Restaurant = Depends(current_restaurant)) -> StreamingResponse:
    restaurant_id = r.id
    queue = bus.subscribe(restaurant_id)

    async def stream():
        try:
            yield ": connected\n\n"
            quiet = 0.0
            while not bus.shutting_down:
                if await request.is_disconnected():
                    break
                try:
                    name, data = await asyncio.wait_for(queue.get(), timeout=CHECK_SECONDS)
                except TimeoutError:
                    quiet += CHECK_SECONDS
                    if quiet >= PING_SECONDS:
                        quiet = 0.0
                        yield ": ping\n\n"
                    continue
                quiet = 0.0
                yield f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        finally:
            bus.unsubscribe(restaurant_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
