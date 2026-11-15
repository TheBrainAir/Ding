# Ding: a voice waiter for every table

Ding is an AI waiter you talk to. Each table has a small box with one button: press it, ask in
your own language, and the waiter answers out loud. It knows the menu, **always asks about
allergies before taking an order**, warns about dishes that clash with them, and sends the order
to the kitchen screen. Restaurant owners manage the menu, notes and tables in a web dashboard.

Hackathon project, runs locally (no deployment).

- **Brain**: Claude Opus 5.5 with tools (menu search, allergies, order editing, calling staff).
- **Voice**: ElevenLabs Scribe (speech to text, language detected automatically) and ElevenLabs
  TTS, streamed sentence by sentence.
- **Menu search**: local multilingual embeddings (fastembed) so "лапша", "fideos" or "պիցցա"
  find the English-described dish.
- **Safety**: the allergy rules are enforced by the server, not only by the prompt.

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 itself) and Node.js 20+.

```bash
cp backend/.env.example backend/.env    # add ANTHROPIC_API_KEY; ELEVENLABS_API_KEY for voice
./dev.sh                                # backend on :8010 + web on :5173; seeds demo data on first run
```

The seed prints a demo login (`demo@ding.local` / `ding-demo-2026`) and one URL per table.
Open `http://localhost:5173/login` for the dashboard and `http://localhost:5173/t/<token>` for a
table screen. The first start downloads the embedding model (~1.1 GB) into `backend/data/models/`.

Other commands:

```bash
./dev.sh seed       # create / refresh the demo restaurant (safe to re-run)
./dev.sh backend    # backend only
./dev.sh web        # web only
./dev.sh test       # backend + bridge lint and tests
./dev.sh bridge <token> [--keyboard]   # headless mode, see Hardware below
```

**Without an ElevenLabs key** everything still works in text mode: the table screen and the
dashboard's "Test the waiter" chat take typed messages, `voice_enabled` is `false`, and `/api/voices` is empty.
Add the key and restart the backend to turn voice on, then check it with
`cd backend && uv run python scripts/voice_smoke.py`.

## How a turn works

```
press button -> browser records (webm/opus) -> release
  -> POST /api/table/{token}/turn            (audio, or JSON {text})
     1. Scribe transcribes and detects the language
     2. Claude runs the tool loop (search menu, record allergies, edit the order...)
     3. the spoken reply is split into sentences, synthesized in parallel, sent in order
  <- NDJSON stream: transcript, text, audio (per sentence), dishes, state, done
```

Pressing the button while the waiter talks interrupts it (the next turn cancels the current one).

## Allergy guard

Allergens are structured data on each dish: the 14 EU allergens, `may_contain` traces, and diet
tags. The server enforces three rules no matter what the model says:

1. Nothing can be added to an order or sent to the kitchen until the guest's answer about
   allergies has been recorded.
2. A dish whose allergens or traces match the guest's allergies is refused, with the conflict and
   safe alternatives. It can be added only after the guest explicitly accepts the risk, and it is
   then flagged on the kitchen ticket.
3. When the order is placed every item is checked again against the allergies as recorded at that
   moment.

Free-text notes count too: "shellfish" adds crustaceans and molluscs, "vegan" requires the vegan
tag, and other food words ("pork", "mushrooms") are matched against ingredients.

## Repository

| Path | What |
| --- | --- |
| `backend/` | FastAPI + SQLAlchemy + SQLite API, the waiter agent, speech, RAG (Python 3.12, uv) |
| `web/` | React dashboard and table screen (Vite, TypeScript, Tailwind) |
| `bridge/` | Headless mode: `ding-bridge` drives the button box, mic and speaker without a screen (Python, uv) |
| `firmware/table_button_esp32/` | Table button firmware: mini ESP32 + 16x2 LCD, USB serial and Bluetooth LE |
| `firmware/table_button/` | Legacy Arduino Uno + LED sketch (same protocol, USB only) |
| `docs/API.md` | API contract between backend and web |
| `docs/HARDWARE.md` | Wiring, flashing, the button protocol, troubleshooting |
| `demo/` | Printed demo menu (`menu.json`, `menu.pdf`, photos); the seed loads `menu.json` when present |

Settings such as the LLM, STT and TTS model ids and the voice live on the restaurant record
(Dashboard, Settings), not in code or environment variables.

## Hardware

The default setup is the **guest screen plus the button**: `/t/<token>` in Chrome on the table's
laptop records, plays the reply and shows captions. The button box is a mini ESP32 with one button
and a 16x2 LCD (state on line 1, table or order on line 2); it talks to the guest screen over the
USB-C cable (Web Serial) or over Bluetooth LE (Web Bluetooth) when it runs on a battery. The
microphone and speaker plug into the laptop. Without the box, press the space bar or click the
button on screen.

**Headless mode** is for a box with no screen: `./dev.sh bridge <token>` runs the bridge, which
reads the button, records, plays the reply and gives audio cues instead of visuals. It can run on a
different machine from the backend (`--server`).

Wiring, flashing, the protocol, Bluetooth and battery notes, troubleshooting and a bench checklist:
[docs/HARDWARE.md](docs/HARDWARE.md).
