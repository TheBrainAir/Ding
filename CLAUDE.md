# Ding: guide for coding agents

Voice AI waiter: a guest presses the table button, speaks any language, and the waiter (Claude)
answers by voice, asks about allergies, and takes the order. Owners manage everything in a web
dashboard. Everything user-facing is in English. Product name is one constant: `APP_NAME` in
`backend/app/config.py` (default persona name comes from it).

The repo is **public**. Secrets live only in `backend/.env` (gitignored). Never print, copy or
commit keys.

## Layout

| Path | Stack | Notes |
| --- | --- | --- |
| `backend/` | Python 3.12, uv, FastAPI, SQLAlchemy 2, SQLite | API on **:8010** (8000 is taken on the dev machine) |
| `web/` | React 19, Vite, TS, Tailwind | :5173, proxies `/api` and `/media` to :8010 |
| `bridge/` | Python 3.12, uv, sounddevice, pyserial | Headless mode (`ding-bridge --table <token>`): button + mic + speaker with no guest screen. Own uv project; talks to the backend only over HTTP. |
| `firmware/table_button_esp32/` | Arduino (esp32 core 3.x) | Mini ESP32: button D7, 16x2 LCD on D0-D5; USB serial 115200 + BLE Nordic UART (`Ding-XXXX`) |
| `firmware/table_button/` | Arduino Uno | Legacy: button D2, LED D9, USB only; ignores `INFO:` |
| `docs/API.md` | | **The contract** between backend and web. Change it together with the code. |
| `docs/HARDWARE.md` | | Wiring, flashing, protocol, troubleshooting |
| `demo/` | | Printed demo menu, owned by its generator. The seed reads `demo/menu.json`. |

## Commands

```bash
./dev.sh                    # backend + web
./dev.sh test               # = cd backend && uv run ruff check app && uv run pytest
cd backend
uv run uvicorn app.main:app --reload --reload-dir app --port 8010
uv run python scripts/seed_demo.py     # idempotent; demo/menu.json if present, else built-in menu
uv run python scripts/voice_smoke.py   # real voice round trip, needs ELEVENLABS_API_KEY
uv run ruff check app && uv run ruff format app
cd ../bridge
uv run ding-bridge --table <token> [--keyboard]   # headless mode; --list-devices / --list-ports
uv run pytest && uv run ruff check src tests      # no hardware needed (fakes + a pty)
```

The default guest setup is the browser guest screen (`/t/<token>`, Web Serial or Web Bluetooth to the
button; `web/src/lib/voice/{serialButton,bluetoothButton}.ts` share `buttonLink.ts`). The
bridge is the optional headless alternative; both use the same `POST /api/table/{token}/turn`
stream and the same serial protocol. Don't run both for one table.

SQLite file and uploaded photos: `backend/data/` (`ding.db`, `media/` served at `/media/...`).
Schema is `create_all` on startup, no migrations: when you change a model on a dev machine, delete
`backend/data/ding.db` and re-seed.

## Backend map

- `app/api/*`: routers. Dashboard routes use the `ding_session` cookie (`deps.current_restaurant`);
  `/api/table/*` and `/api/device/*` are public by table token.
- `app/services/waiter.py`: the agent loop for one guest turn.
- `app/services/tools.py`: tool definitions (strict JSON schemas) and their execution.
- `app/services/allergy.py`: the deterministic allergy guard.
- `app/services/llm.py`: every Claude call (request shape, fast mode, fallbacks, errors).
- `app/services/rag.py`: embeddings and search; `prompts.py`: system prompt + session state.
- `app/services/stt.py`, `tts.py`, `elevenlabs.py`, `speech.py`: voice (plain REST over httpx).
- `app/services/turns.py`: one turn per table, barge-in cancellation; `guest_sessions.py`: lifecycle.
- `app/catalog.py`: allergen and tag enums, selectable model lists and the defaults a new restaurant
  starts with. Runtime code reads model ids and the voice from the restaurant row, never from here.

## Rules that are easy to break

**Allergy safety lives in server code.** `add_to_order`, `update_order_item` and `place_order`
refuse until `set_allergies` was called; conflicting dishes (allergens or `may_contain`) are blocked
unless `guest_confirmed_allergen_risk` is true, and then flagged. Guard failures go back to the
model as `is_error` tool results it can act on, never as exceptions. Keep it that way and keep
`tests/test_allergy_guard.py` green.

**Claude Opus 5.5 request rules** (see `llm.py`): no `thinking` disabled, no `budget_tokens`, no
`temperature`, no forced `tool_choice`, no assistant prefill (all 400). Use `output_config.effort`
(`low` for the waiter), `speed="fast"` with a standard-speed retry on 429, `fallbacks="default"` with
beta `server-side-fallback-2026-07-01`, top-level `cache_control`. Check `stop_reason`
(`refusal`, `max_tokens`) before using content.

**Conversation history is append-only.** The full `response.content` (thinking blocks included) is
stored on the session and replayed byte for byte. Never edit or drop earlier messages, never change
a session's frozen `system_prompt`, never change tool definitions casually (it invalidates every
open conversation). Per-turn state goes at the end of the user message in `<session_state>`.

**Replies are written for the ear.** The guest hears the waiter (and may or may not see captions),
so the prompt never refers to a screen and never recites lists: a few options, then a question.

**SSE streams must end on shutdown.** `/api/events` checks `bus.shutting_down` (set by a signal hook
chained in front of uvicorn's) every second; otherwise `--reload` and Ctrl+C hang on open dashboards.

**Only final spoken text reaches the guest.** Text written next to a tool call is discarded, never
sent as `text` events or to TTS.

**Model ids are data.** LLM/STT/TTS ids and the voice are columns on `restaurants` and editable in
Settings. Don't add model ids to env vars or scatter them in code; `catalog.py` is the one list.

## Tests

`uv run pytest` uses a temp data dir and the fixture menu in `tests/fixtures.py` (never the demo
seed or `demo/menu.json`). The agent loop is tested with a scripted fake model
(`tests/test_waiter_loop.py`), so tests make no network calls. RAG tests load the real embedding
model from `backend/data/models/`.
