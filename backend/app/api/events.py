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


@router.get("/events")
async def events(request: Request, r: Restaurant = Depends(current_restaurant)) -> StreamingResponse:
    restaurant_id = r.id
    queue = bus.subscribe(restaurant_id)

    async def stream():
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    name, data = await asyncio.wait_for(queue.get(), timeout=PING_SECONDS)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        finally:
            bus.unsubscribe(restaurant_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
