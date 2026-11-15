# Ding API contract

Backend on `:8010`, the web app calls same-origin `/api/*` and `/media/*` (Vite proxy in dev).
JSON everywhere, `snake_case` fields, ids are integers, timestamps are ISO-8601 UTC strings.
Errors: `{"detail": "human readable message"}` with a 4xx/5xx status.
Dashboard endpoints need the session cookie (`401` otherwise) and are scoped to the caller's
restaurant. `/api/table/*` and `/api/device/*` are public and addressed by the table token.

## Enums

```
Allergen     = gluten | crustaceans | eggs | fish | peanuts | soy | milk | tree_nuts
             | celery | mustard | sesame | sulphites | lupin | molluscs
DietaryTag   = vegan | vegetarian | halal | kosher | gluten_free | spicy
OrderStatus  = draft | placed | preparing | served | cancelled
ButtonState  = idle | listening | thinking | speaking
```

`GET /api/meta` (public) → `{ "allergens": [{ "id", "label" }], "dietary_tags": [{ "id", "label" }] }`

## Objects

```jsonc
// User
{ "id": 1, "email": "owner@example.com" }

// Restaurant (settings live here — model ids are data, not code)
{ "id": 1, "name": "Ginger & Coal", "currency": "USD", "menu_language": "en",
  "persona_name": "Ding", "voice_id": "…", "llm_model": "claude-opus-5-5",
  "stt_model": "scribe_v3", "tts_model": "eleven_v4_turbo" }

// Dish
{ "id": 7, "name": "Pad Thai", "description": "…", "category": "Mains",
  "price": 14.5, "photo_url": "/media/dishes/7.jpg" /* or null */,
  "ingredients": ["rice noodles", "peanuts", "egg"],
  "allergens": ["peanuts", "eggs", "soy"], "may_contain": ["sesame"],
  "dietary_tags": ["spicy"], "available": true,
  "created_at": "…", "updated_at": "…" }

// DishDraft (menu import / allergen suggestion — never saved automatically)
{ "name", "description", "category", "price" /* number|null */, "ingredients": [],
  "allergens": [], "may_contain": [], "dietary_tags": [] }

// KnowledgeItem
{ "id": 3, "title": "Opening hours", "content": "…", "updated_at": "…" }

// Table
{ "id": 2, "label": "Table 4", "token": "k3J9…", "url": "/t/k3J9…",
  "active_session_id": 12 /* or null */, "created_at": "…" }

// OrderItem
{ "id": 31, "dish_id": 7, "name": "Pad Thai", "price": 14.5, "quantity": 2,
  "notes": "no cilantro", "allergen_flag": false, "photo_url": "…" /* or null */ }

// Order
{ "id": 9, "table_id": 2, "table_label": "Table 4", "session_id": 12, "status": "placed",
  "items": [OrderItem], "total": 29.0, "currency": "USD",
  "allergies": ["peanuts"], "allergy_note": "severe peanut allergy",
  "language": "es", "placed_at": "…" /* or null */, "created_at": "…" }

// WaiterCall
{ "id": 4, "table_id": 2, "table_label": "Table 4", "reason": "…", "resolved": false, "created_at": "…" }

// GuestAllergies
{ "confirmed": true, "allergens": ["peanuts"], "notes": "…", "none_declared": false }

// SessionSummary
{ "id": 12, "table_id": 2, "table_label": "Table 4", "status": "active" /* | closed */,
  "language": "es", "allergies": GuestAllergies, "turn_count": 6,
  "order_id": 9 /* or null */, "started_at": "…", "last_activity_at": "…" }

// SessionDetail = SessionSummary + transcript (spoken text only, no tool noise)
{ …, "transcript": [{ "role": "guest" | "waiter", "text": "…", "at": "…" }], "order": Order /* or null */ }
```

## Dashboard endpoints

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /api/auth/signup` | `{ email, password, restaurant_name }` | `{ user, restaurant }` + cookie |
| `POST /api/auth/login` | `{ email, password }` | `{ user, restaurant }` + cookie |
| `POST /api/auth/logout` | — | `204` |
| `GET /api/me` | — | `{ user, restaurant }` |
| `GET /api/restaurant` · `PATCH /api/restaurant` | partial Restaurant | Restaurant |
| `GET /api/voices` | — | `[{ voice_id, name, preview_url, labels }]` (empty list without an ElevenLabs key) |
| `GET /api/models` | — | `{ "llm": [{id,label}], "stt": [{id,label}], "tts": [{id,label}] }` |
| `GET /api/dishes` | `?category=&q=` | `[Dish]` |
| `POST /api/dishes` · `PATCH /api/dishes/{id}` | Dish fields (no id/photo_url) | Dish |
| `DELETE /api/dishes/{id}` | — | `204` |
| `POST /api/dishes/{id}/photo` | multipart `file` | Dish |
| `DELETE /api/dishes/{id}/photo` | — | Dish |
| `POST /api/dishes/suggest-allergens` | `{ name, description, ingredients }` | `{ allergens, may_contain, dietary_tags, rationale }` |
| `POST /api/menu/import` | multipart `file` (image or PDF) | `{ "dishes": [DishDraft] }` |
| `POST /api/dishes/bulk` | `{ "dishes": [DishDraft] }` | `[Dish]` |
| `GET/POST /api/knowledge` · `PATCH/DELETE /api/knowledge/{id}` | `{ title, content }` | KnowledgeItem |
| `GET/POST /api/tables` · `PATCH/DELETE /api/tables/{id}` | `{ label }` | Table |
| `GET /api/orders` | `?status=placed,preparing` (drafts excluded by default) | `[Order]` newest first |
| `PATCH /api/orders/{id}` | `{ status }` | Order |
| `GET /api/waiter-calls` · `PATCH /api/waiter-calls/{id}` | `?resolved=false` · `{ resolved }` | `[WaiterCall]` · WaiterCall |
| `GET /api/sessions` · `GET /api/sessions/{id}` | — | `[SessionSummary]` · SessionDetail |
| `GET /api/stats` | — | see below |
| `GET /api/events` | — | SSE stream, see below |

```jsonc
// GET /api/stats
{ "orders_today": 12, "revenue_today": 318.5, "currency": "USD", "active_tables": 3,
  "avg_order_value": 26.5, "open_waiter_calls": 1,
  "top_dishes": [{ "dish_id": 7, "name": "Pad Thai", "quantity": 9 }],
  "languages": [{ "language": "es", "sessions": 5 }],
  "orders_by_hour": [{ "hour": "2026-11-14T18:00:00Z", "orders": 4 }] }
```

### `GET /api/events` (Server-Sent Events)

`event:` is the name, `data:` is JSON. A `ping` comment is sent every 15 s.

- `order.placed` → Order
- `order.updated` → Order
- `waiter.called` → WaiterCall
- `session.updated` → SessionSummary

## Table (guest) endpoints — public, by token

`GET /api/table/{token}` →

```jsonc
{ "table_label": "Table 4", "restaurant_name": "Ginger & Coal", "persona_name": "Ding",
  "currency": "USD", "voice_enabled": true /* false without an ElevenLabs key */,
  "session": { "id": 12, "language": "es", "allergies": GuestAllergies,
               "order": Order /* draft or placed, or null */,
               "transcript": [{ "role", "text", "at" }] } /* or null when no active session */ }
```

`POST /api/table/{token}/reset` → `204` (closes the session; the next turn starts a fresh guest).

### `POST /api/table/{token}/turn`

Request is either `multipart/form-data` with `audio` (webm/opus, wav, mp3, m4a…) or
`application/json` `{ "text": "…", "speak": true }` (`speak: false` skips TTS — used by the
dashboard "Test the waiter" chat).

Response is `application/x-ndjson`, streamed: one JSON object per line, in this order.

```jsonc
{ "type": "transcript", "text": "¿Qué me recomiendas?", "language": "es" }   // once, first
{ "type": "text", "delta": "Con gusto. " }                                  // many; spoken text only
{ "type": "audio", "seq": 0, "mime": "audio/mpeg", "b64": "…" }              // one per sentence, play in seq order
{ "type": "dishes", "dishes": [Dish] }                                       // dishes the waiter just looked up / added — show as cards
{ "type": "state", "order": Order /* or null */, "allergies": GuestAllergies, "language": "es" }
{ "type": "waiter_called", "reason": "…" }                                   // optional
{ "type": "done" }                                                           // always last on success
{ "type": "error", "message": "…" }                                          // terminal instead of done
```

- If nothing intelligible was heard: `{ "type": "transcript", "text": "", "language": null }`
  then `{ "type": "done" }` — the client shows a gentle "didn't catch that" hint, no model call.
- `text` and `audio` interleave; audio for a sentence arrives after its text.
- One turn per table at a time. A new turn for the same token cancels the previous one;
  the client also aborts its fetch when the guest presses the button mid-reply (barge-in).

### `POST /api/device/{token}/turn` (hardware without a browser — later ESP32)

Body: raw `audio/wav`. Response: one `audio/mpeg` body (the whole reply), with headers
`X-Waiter-Transcript` and `X-Waiter-Reply` (URL-encoded). `204` when nothing was heard.

## Table button protocol (USB serial or Bluetooth LE, newline-terminated)

The same lines run over Web Serial (115200 baud) and over Bluetooth LE (Nordic UART Service:
service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, host writes to RX `6E400002-…`, board notifies on TX
`6E400003-…`; the box advertises as `Ding-XXXX`). Unknown lines are ignored on both sides.

- Board → host: `PRESS`, `RELEASE`, `READY` (after boot, and about a second after a Bluetooth host
  connects; the host answers with its current `STATE` and `INFO`)
- Host → board: `STATE:idle` | `STATE:listening` | `STATE:thinking` | `STATE:speaking` (LCD line 1)
- Host → board: `INFO:<text>` (LCD line 2; ASCII, up to 60 characters, other characters become `?`).
  Text longer than 16 characters scrolls as a marquee: hold 1.2 s, one character per 280 ms, hold
  1.2 s, repeat; a new `INFO` restarts it. While the order has items, the guest screen pages through
  them, one `INFO` per line: `<qty>x <name>` per item in the order added, then `N items $X` (draft)
  or `Order sent` / `Being prepared` / `Enjoy your meal`, then around again; 2.5 s per line, or one
  full scroll for long lines; a newly added item is shown first. With no items it sends the table
  label. The legacy Uno sketch ignores `INFO`.

The headless bridge (`bridge/`, `ding-bridge --table <token>`) speaks the same protocol over USB
serial in place of the browser and re-sends `STATE` / `INFO` after `READY` or a re-plug.
Wiring and firmware: `docs/HARDWARE.md`.

## Backend implementation notes

Additions and clarifications; none of them change the shapes above.

- Create endpoints return `201` (`POST /api/dishes`, `/api/dishes/bulk`, `/api/knowledge`,
  `/api/tables`); signup and login return `200`. Validation errors are `422` with `detail` as one
  readable string (`"email: enter a valid email address; password: ..."`).
- `PATCH /api/restaurant`: `llm_model` must be one of the `llm` ids from `GET /api/models` (`422`
  otherwise). STT/TTS ids are free text (the list merges in live ElevenLabs models when a key is set).
- `GET /api/orders` and `GET /api/sessions` accept `limit` (defaults 200 / 100). Sessions with no
  guest turns yet are not listed; the list is ordered by last activity.
- `PATCH /api/orders/{id}`: a `draft` order can only be set to `cancelled` (`409` otherwise).
- `GET /api/stats`: "today" starts at local midnight of the server machine; `top_dishes` (top 5) and
  `languages` cover today; `orders_by_hour` is zero-filled from local midnight to the current hour.
- `GET /api/events` sends a `: connected` comment right after opening.
- `POST /api/table/{token}/turn`:
  - multipart requests may add a `speak` form field (`false` skips TTS);
  - an audio turn without `ELEVENLABS_API_KEY` returns a single `error` event saying so;
  - `text` events arrive one per sentence, once the model has finished its reply (TTS for each
    sentence starts while the reply is still streaming); `audio` events follow in `seq` order,
    then `dishes`, `state`, any `waiter_called`, and `done`;
  - a turn cancelled by a newer turn for the same table ends with
    `{ "type": "error", "message": "Interrupted by a newer turn." }`.
- `POST /api/device/{token}/turn`: `503` without `ELEVENLABS_API_KEY`, `502` on an upstream error,
  `409` when a newer turn interrupted it.
- `GET /api/health` (public) → `{ "ok": true, "app": "Ding", "voice_enabled": false, "llm_configured": true }`.
