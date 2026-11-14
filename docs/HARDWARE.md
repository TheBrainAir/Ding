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

That is the default setup: **guest screen + button**. For a box with no screen at all there is
also a **headless mode**, where a small program on the laptop (the bridge) does the audio and the
serial link instead of the browser; see [Headless mode](#headless-mode-the-bridge).

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
| board → laptop | `READY` | Sent once after reset |
| board → laptop | `PRESS` | Button went down (debounced, 25 ms) |
| board → laptop | `RELEASE` | Button went up |
| laptop → board | `STATE:idle` | Waiting: slow dim breathing |
| laptop → board | `STATE:listening` | Recording: solid light |
| laptop → board | `STATE:thinking` | Waiting for the reply: quick pulse |
| laptop → board | `STATE:speaking` | Playing the reply: medium pulse |

"Laptop" is the guest screen in the browser, or the bridge in headless mode. The board only
reports edges; the laptop side decides what a press means:

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

## Headless mode: the bridge

For a table with no screen, `bridge/` is a small Python program (its own uv project, so it can run on
a different machine from the backend) that does what the guest screen does, by sound alone:

```bash
./dev.sh bridge <table token>                # or: cd bridge && uv run ding-bridge --table <token>
./dev.sh bridge <table token> --keyboard     # no box: Enter starts / sends a recording
cd bridge && uv run ding-bridge --list-devices    # pick --input-device / --output-device
cd bridge && uv run ding-bridge --list-ports      # pick --port (default: auto-detect)
```

- It finds the board on USB serial (`--port` to choose), keeps the light in sync with `STATE:...`,
  and reconnects by itself when the board is unplugged and plugged back in.
- Same press rules as the guest screen: hold to talk, tap to start and tap again to send, a press
  while the waiter thinks or talks interrupts it.
- It records from the default microphone, streams the turn to `POST /api/table/{token}/turn` and plays
  the reply sentence by sentence as it arrives.
- With no screen, short tones tell the guest what is happening: two rising notes when recording
  starts, two falling notes when it is sent, a soft tick while a reply takes long, and a low falling
  pair for "didn't catch that" or an error.
- The terminal shows the operator the state, the transcript, the waiter's reply, the order and the
  allergies after each turn. Type `r` + Enter to reset the table for a new guest, `q` to quit.
- At startup it checks the backend, the table token, that voice is configured on the server
  (`ELEVENLABS_API_KEY`), the speaker, the board and the microphone, and says what is wrong. On macOS
  the terminal app needs microphone permission (System Settings > Privacy & Security > Microphone).

Run either the guest screen or the bridge for a table, not both: a new turn for a table cancels the
one in progress.

## Battery: Bluetooth or Wi-Fi instead of USB

The box can run on a battery with a radio module instead of the USB cable. A classic-Bluetooth
serial module (HC-05 / HC-06, wired to the board's TX/RX) pairs with the Mac and shows up as an
ordinary serial port (`/dev/cu.HC-05...`), so the same `PRESS` / `RELEASE` / `STATE:...` protocol works
unchanged: pick that port in **Connect table button** on the guest screen, or pass it to the bridge
with `--port` (it also auto-detects HC-05/HC-06 names). Set the module to 115200 baud (they ship at
9600). A BLE module (HM-10) or a Wi-Fi module is not a serial port to the Mac, so it would need a
small addition on the laptop side (Web Bluetooth in the browser, or a BLE/network listener in the
bridge); that is not built yet.

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
