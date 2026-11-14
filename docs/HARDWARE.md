# The table button

Ding's hardware is deliberately small: a box on the table with one button and one light.
The guest presses the button, speaks, and the waiter answers through a speaker.

An Arduino Uno R3 has no network and 2 KB of RAM, so it cannot record or play speech.
The board is only the **button and the light**. Audio goes through the laptop the board is
plugged into: hide a USB microphone and a small speaker in the box and connect them to the
laptop. The table screen (`/t/<token>` in Chrome) records, plays the reply, and talks to the
board over **Web Serial**.

Nothing depends on the hardware. Without the board, the space bar or a click on the big
button on the table screen does the same thing.

## Parts

| Part | Notes |
| --- | --- |
| Arduino Uno R3 (or any board with USB serial) | Reference sketch: `firmware/table_button/table_button.ino` |
| Momentary push button | Arcade buttons work well; any normally-open button is fine |
| LED + 220 ohm resistor | Any colour; it shows the button state |
| USB microphone and small speaker | Plugged into the laptop, not the board |
| USB cable | Board to laptop |

## Wiring

```
D2  ── button ── GND          (internal pull-up, no resistor needed)
D9  ── 220 Ω ── LED(+)  LED(−) ── GND      (PWM pin, the light)
D13    on-board LED mirrors "listening"
```

## Flashing

1. Open `firmware/table_button/table_button.ino` in the Arduino IDE (folder and file name must match).
2. Board: *Arduino Uno*. Port: the board's USB port.
3. Upload. Open the Serial Monitor at **115200** baud: you should see `READY`, then `PRESS` / `RELEASE`
   as you press the button. Typing `STATE:listening` (newline) turns the light on.

## Serial protocol

USB serial, **115200 baud**, one message per line (`\n`, a preceding `\r` is ignored).

| Direction | Message | Meaning |
| --- | --- | --- |
| board → browser | `READY` | Sent once after reset |
| board → browser | `PRESS` | Button went down (debounced, 25 ms) |
| board → browser | `RELEASE` | Button went up |
| browser → board | `STATE:idle` | Waiting: slow dim breathing |
| browser → board | `STATE:listening` | Recording: solid light |
| browser → board | `STATE:thinking` | Waiting for the reply: quick pulse |
| browser → board | `STATE:speaking` | Playing the reply: medium pulse |

The board only reports edges. The browser decides what a press means:

- **hold to talk**: `PRESS` starts recording, `RELEASE` sends it;
- **tap to toggle**: a short tap starts recording, the next tap sends it;
- a press while the waiter is speaking interrupts it (barge-in) and starts a new recording.

Unknown lines are ignored on both sides, so the protocol can grow.

## Connecting in the browser

1. Run the app (`./dev.sh`) and open the table screen for a table: `http://localhost:5173/t/<token>`
   (the URLs are printed by `uv run python scripts/seed_demo.py` and shown on the Tables page).
2. Click **Connect table button** and pick the board's serial port. Chrome or Edge on desktop is required
   (Web Serial is not available in Safari or Firefox).
3. Allow microphone access the first time.

`localhost` counts as a secure context, so the microphone and Web Serial work over plain HTTP on the
laptop. To use a phone or tablet as the table screen instead, the page must be served over HTTPS,
for example through a tunnel: `cloudflared tunnel --url http://localhost:5173`. (Web Serial does not
exist on phones; there the on-screen button is the control.)

## Later: a board with its own network

A board with Wi-Fi and I2S audio (an ESP32 with a microphone and an amplifier) can skip the laptop.
It records a WAV and posts it straight to the backend:

```
POST /api/device/<table token>/turn
Content-Type: audio/wav
<raw wav bytes>
```

The answer is one `audio/mpeg` body with the whole reply, plus `X-Waiter-Transcript` and
`X-Waiter-Reply` headers (URL-encoded text). `204` means nothing intelligible was heard. This
endpoint needs `ELEVENLABS_API_KEY` on the server; see `docs/API.md`.
