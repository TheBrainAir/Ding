"""HTTP client for the Ding backend (docs/API.md, table endpoints)."""

import json
from collections.abc import AsyncIterator

import httpx


class BackendError(Exception):
    pass


class BackendUnavailable(BackendError):
    pass


class UnknownTable(BackendError):
    pass


class Backend:
    def __init__(self, server: str, token: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.server = server.rstrip("/")
        self.token = token
        self.client = httpx.AsyncClient(
            base_url=self.server,
            timeout=httpx.Timeout(90.0, connect=5.0),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _get(self, path: str) -> httpx.Response:
        try:
            return await self.client.get(path)
        except httpx.HTTPError as e:
            raise BackendUnavailable(f"cannot reach the backend at {self.server} ({e.__class__.__name__})") from e

    async def health(self) -> dict:
        resp = await self._get("/api/health")
        if resp.status_code != 200:
            raise BackendUnavailable(f"{self.server} answered {resp.status_code}; is this the Ding backend?")
        return resp.json()

    async def table(self) -> dict:
        resp = await self._get(f"/api/table/{self.token}")
        if resp.status_code == 404:
            raise UnknownTable(f"unknown table token '{self.token}'")
        if resp.status_code != 200:
            raise BackendError(f"GET /api/table answered {resp.status_code}")
        return resp.json()

    async def reset(self) -> None:
        try:
            resp = await self.client.post(f"/api/table/{self.token}/reset")
        except httpx.HTTPError as e:
            raise BackendUnavailable(f"cannot reach the backend ({e.__class__.__name__})") from e
        if resp.status_code not in (200, 204):
            raise BackendError(f"reset answered {resp.status_code}")

    async def turn(self, wav: bytes) -> AsyncIterator[dict]:
        """POST the recording and yield NDJSON events as they arrive."""
        files = {"audio": ("speech.wav", wav, "audio/wav")}
        try:
            async with self.client.stream("POST", f"/api/table/{self.token}/turn", files=files) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread()).decode("utf-8", "replace")
                    try:
                        detail = json.loads(body).get("detail", body)
                    except ValueError:
                        detail = body
                    raise BackendError(f"turn failed ({resp.status_code}): {detail}")
                async for line in resp.aiter_lines():
                    if line.strip():
                        try:
                            yield json.loads(line)
                        except ValueError:
                            continue
        except httpx.HTTPError as e:
            raise BackendUnavailable(f"lost the backend during the turn ({e.__class__.__name__})") from e
