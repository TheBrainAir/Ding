# The table button

Ding's hardware is deliberately small: a box on the table with **one button and a 16x2 character
LCD**, built on a mini ESP32 board. The guest presses the button, speaks, and the waiter answers.

The board is only the **button and the display**. Audio goes through the laptop at the table
(microphone and speaker plugged into the laptop). The guest screen (`/t/<token>` in Chrome on that
laptop) records, plays the reply and shows captions, and talks to the box either

- over the **USB-C cable** (Web Serial), or
- over **Bluetooth LE** (Web Bluetooth), so the box can run on a battery with no cable.

The same firmware does both at once. Nothing depends on the hardware: without the box, the space bar
or a click on the big button on the guest screen does the same thing.

That is the default setup: **guest screen + button**. For a table with no screen at all there is
also a **headless mode**, where a small program on the laptop (the bridge) does the audio and talks
to the box over USB; see [Headless mode](#headless-mode-the-bridge).

The older Arduino Uno + LED box still works with everything here; see [Legacy: Arduino Uno](#legacy-arduino-uno-led).

## Parts

| Part | Notes |
| --- | --- |
| Mini ESP32 board with USB-C, pins labelled D0..D8 | Seeed XIAO ESP32-C3 / ESP32-S3, Arduino Nano ESP32 and similar. Needs Bluetooth LE for battery use (not ESP32-S2). |
| 16x2 character LCD, HD44780-compatible, 5 V | Used in 4-bit mode, write-only |
| Momentary push button | Any normally-open button; arcade buttons work well |
| 9 V battery + step-down (buck) module set to **5.0 V** | Only for battery use |
| USB microphone and speaker | Plugged into the laptop, not the board |

Firmware: `firmware/table_button_esp32/table_button_esp32.ino`.

## Wiring

Pins are named by the silkscreen labels on the board.

| LCD pin | Name | Connect to | Why |
| --- | --- | --- | --- |
| 1 | VSS | GND | |
| 2 | VDD | VBUS (5 V) | the LCD is a 5 V part |
| 3 | V0 | GND | contrast fixed at maximum (see [Troubleshooting](#troubleshooting) if it shows dark boxes) |
| 4 | RS | D0 | |
| 5 | RW | GND | write-only: the LCD never drives its 5 V data lines into the 3.3 V board |
| 6 | E | D1 | |
| 7-10 | DB0-DB3 | not connected | 4-bit mode |
| 11 | DB4 | D2 | |
| 12 | DB5 | D3 | |
| 13 | DB6 | D4 | |
| 14 | DB7 | D5 | |
| 15 | A (backlight +) | VBUS (5 V) | check the module has a backlight resistor (most do); if not, add 100-220 Ω |
| 16 | K (backlight -) | GND | |

| Board pin | Connect to |
| --- | --- |
| D8 | push button, other side to GND (internal pull-up, no resistor). The sketch also reads D7, so the button works on either pin. |
| VBUS | 5 V from the buck module when on battery (and LCD VDD, A) |
| GND | buck module GND, LCD VSS/V0/RW/K, button |

What D0..D8 are on common boards (GPIO numbers; the sketch uses the D-names, so this is only for
reference or for the raw-GPIO fallback):

| Board (Arduino board name) | D0 | D1 | D2 | D3 | D4 | D5 | D7 / D8 (button) | Strapping pins among them |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Seeed XIAO ESP32-C3 (`XIAO_ESP32C3`) | 2 | 3 | 4 | 5 | 6 | 7 | 20 / 8 | D0 (GPIO2), D8 (GPIO8): don't hold the button while powering on |
| Seeed XIAO ESP32-S3 (`XIAO_ESP32S3`) | 1 | 2 | 3 | 4 | 5 | 6 | 44 / 7 | D2 (GPIO3, harmless) |
| Seeed XIAO ESP32-C6 (`XIAO_ESP32C6`): the board in the demo box | 0 | 1 | 2 | 21 | 22 | 23 | 17 / 19 | none |
| Arduino Nano ESP32 (`nano_nora`) | D0..D8 as printed (the core maps them) | | | | | | | D0/D1 are also UART RX/TX: boot messages flicker the LCD before it starts, harmless |

If your board package does not define `D0`..`D8` (compile error `'D0' was not declared in this
scope`), set `DING_USE_RAW_GPIO` to `1` at the top of the sketch and type your board's GPIO numbers
into the block below it.

## Flashing

1. Install the board package: Arduino IDE > Boards Manager > **esp32 by Espressif Systems** (3.x; the
   firmware was compile-tested with 3.3.12). If it is not listed, add
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json` under Preferences >
   Additional boards manager URLs.
2. Install one library: Library Manager > **LiquidCrystal** (1.0.7). Bluetooth comes with the board
   package; nothing else to install.
3. Open `firmware/table_button_esp32/table_button_esp32.ino` (folder and file name must match).
   Tools > Board: your board (e.g. *XIAO_ESP32C3*, *XIAO_ESP32S3*, *Arduino Nano ESP32*).
   Tools > **USB CDC On Boot: Enabled** (the default on the XIAO boards). Without it the board's USB-C
   port is not a serial port, so neither the Serial Monitor nor the guest screen can talk to it.
4. Battery disconnected, USB-C plugged in. Pick the port and Upload. If the upload cannot connect:
   hold **BOOT**, tap reset (or plug the cable in while holding BOOT), release BOOT, upload again, then
   reset once more.
5. Serial Monitor at **115200** baud, line ending "Newline": you should see `READY`.

The same from a terminal, if you prefer `arduino-cli`:

```bash
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install LiquidCrystal
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32C3 firmware/table_button_esp32
arduino-cli upload  --fqbn esp32:esp32:XIAO_ESP32C3 -p /dev/cu.usbmodem1101 firmware/table_button_esp32
```

## Protocol

One message per line (`\n`; a `\r` before it is ignored), the same on the USB serial port
(**115200 baud**) and on Bluetooth LE. Unknown lines are ignored on both sides.

| Direction | Message | Meaning |
| --- | --- | --- |
| board → laptop | `READY` | The board started; also sent about a second after a Bluetooth host connects. The laptop answers with its current `STATE` and `INFO`. |
| board → laptop | `PRESS` | Button went down (debounced, 25 ms) |
| board → laptop | `RELEASE` | Button went up |
| laptop → board | `STATE:idle` \| `STATE:listening` \| `STATE:thinking` \| `STATE:speaking` | LCD line 1 |
| laptop → board | `INFO:<text>` | LCD line 2: ASCII, the first 16 characters are shown, anything else becomes `?` |

Bluetooth LE uses the **Nordic UART Service**: service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, the laptop
writes to `6E400002-…` (RX) and subscribes to notifications on `6E400003-…` (TX). The box advertises as
**`Ding-XXXX`** (the last four hex digits of its MAC address), without pairing or a PIN.

"Laptop" is the guest screen in the browser, or the bridge in headless mode. The board only reports
edges; the laptop decides what a press means:

- **hold to talk**: `PRESS` starts recording, `RELEASE` sends it;
- **tap to toggle**: a short tap starts recording, the next press sends it;
- a press while the waiter thinks or speaks interrupts it (barge-in) and starts a new recording.

The guest screen sends `INFO:` with the table label while nothing is ordered, `3 items $29.00` while
the order is a draft, and `Order sent` / `Being prepared` / `Enjoy your meal` once it went to the kitchen.

## What the LCD shows

| Line 1 | When |
| --- | --- |
| `Waiting for host` | after power-on until the first `STATE` arrives, and again when the Bluetooth host that was driving it drops |
| `Hold to talk` | idle |
| `Listening...` | recording |
| `Thinking` + animated dots | waiting for the reply |
| `Speaking...` | the waiter is talking |

Line 2 is the last `INFO` text. Before any arrives it shows the box's Bluetooth name (`Ding-XXXX`),
which is the name to pick in the browser's Bluetooth chooser. `BT connected` / `BT link lost` appear
there when a Bluetooth host connects or the link drops.

## Connecting from the guest screen

1. Run the app (`./dev.sh`) and open the guest screen for the table in Chrome or Edge:
   `http://localhost:5173/t/<token>` (the Tables page in the dashboard has the link).
2. Click **Connect table button** and choose:
   - **USB cable**: pick the board's serial port (`/dev/cu.usbmodem…` on macOS).
   - **Bluetooth (battery box)**: pick `Ding-XXXX` in the chooser. The chooser only lists boxes that
     advertise our service or a name starting with "Ding".
3. Allow microphone access the first time. The header shows `Button · USB` or `Button · Bluetooth`.

If the Bluetooth link drops (box moved away, battery swapped, board reset), the header shows
**Button reconnecting…** and the page reconnects by itself with increasing pauses (up to 15 s), no
click needed. Clicking it stops trying. After a page reload, Chrome reconnects to the box it already
knows only where `navigator.bluetooth.getDevices()` is available (recent Chrome; on some versions it
is behind `chrome://flags/#enable-web-bluetooth-new-permissions-backend`); otherwise click Connect
table button again. A USB box is reopened after a reload without a prompt.

`localhost` counts as a secure context, so the microphone, Web Serial and Web Bluetooth work over
plain HTTP on the laptop. Web Serial and Web Bluetooth need desktop Chrome or Edge (not Safari or
Firefox). To use a phone or tablet as the guest screen, serve it over HTTPS (for example
`cloudflared tunnel --url http://localhost:5173`); Web Serial does not exist on phones, and Web
Bluetooth works on Android Chrome only.

## Battery notes

- **Set the buck module to 5.0 V with a multimeter before connecting it to VBUS.** Many modules ship
  set higher or pass the input through, which would destroy the board and the LCD.
- Never connect the battery and the USB-C cable at the same time: both drive VBUS. Flash and debug
  on USB with the battery unplugged.
- A 9 V battery is small (about 400-550 mAh). With Bluetooth on and the backlight lit, expect very
  roughly 4-8 hours, less on an ESP32-S3 than on a -C3. Carry spares. A USB power bank into USB-C is the
  simpler battery (no buck module), but some banks switch themselves off when the load is this low.
- On battery the USB serial port is simply absent; the firmware does not wait for it.

## Troubleshooting

- **LCD backlight on but nothing visible, or a row of dark boxes**: the contrast is fixed at maximum
  (V0 to GND), which is too dark on many modules. Put a 1-2.2 kΩ resistor between V0 and GND, or a
  10 kΩ potentiometer (ends to 5 V and GND, wiper to V0).
- **Dark boxes on line 1 only, never any text**: the LCD is not initialised. Check RS/E/DB4-DB7 against
  the table (DB4-DB7 are the *upper* four data pins) and that RW is on GND.
- **Garbage characters**: loose wire on DB4-DB7 or E. Some LCDs do not read 3.3 V as a logic high when
  powered from 5 V; if the wiring is right and it still misbehaves, use a 3.3 V LCD or a 5 V level
  shifter (e.g. 74HCT245) on the six signal lines.
- **No backlight**: A/K swapped, or the module needs a jumper/resistor for the backlight.
- **Compile fails with `ctags: bad CPU type in executable`** (Apple Silicon Mac): Arduino's bundled
  ctags is an Intel binary. Install Rosetta once (`softwareupdate --install-rosetta`) and compile again.
- **No `READY` in the Serial Monitor**: USB CDC On Boot is disabled (Tools menu), wrong port, or the
  monitor opened after the message; press reset with the monitor open.
- **`Ding-XXXX` is not in the Bluetooth chooser**: the box is connected to another laptop or tab (it
  serves one host at a time; close the other page or power-cycle the box), Bluetooth is off on the
  Mac, the board has no BLE (ESP32-S2), or Chrome lacks Bluetooth permission (macOS System Settings >
  Privacy & Security > Bluetooth).
- **Keeps reconnecting**: the box is out of range or the battery is low; the LCD shows
  `BT link lost`. It recovers on its own once the box is back in range.

## Bench checklist

1. **Flash** the sketch over USB-C with the battery unplugged (see [Flashing](#flashing)). The LCD
   shows `Waiting for host` / `Ding-XXXX`.
2. **Serial Monitor** at 115200: `READY` appears after a reset.
3. **Type STATE lines** in the monitor: `STATE:idle` shows `Hold to talk`, `STATE:thinking` animates,
   `INFO:Table 4` changes line 2, `INFO:Стол` shows `????`.
4. **Press the button**: `PRESS` on the way down, `RELEASE` on the way up, once each per press.
5. **Bluetooth**: close the Serial Monitor, power the box from the battery, open the guest screen,
   Connect table button > Bluetooth > `Ding-XXXX`. Hold the button and speak: the LCD shows
   `Listening...`, then `Thinking...`, then `Speaking...`. Turn the box off and on: the page shows
   *reconnecting* and comes back by itself.

## Headless mode: the bridge

For a table with no screen, `bridge/` is a small Python program (its own uv project, so it can run on
a different machine from the backend) that does what the guest screen does, by sound alone. It talks
to the box over **USB serial only** (including a Bluetooth *serial* module, see below); Bluetooth LE is
not built into the bridge.

```bash
./dev.sh bridge <table token>                # or: cd bridge && uv run ding-bridge --table <token>
./dev.sh bridge <table token> --keyboard     # no box: Enter starts / sends a recording
cd bridge && uv run ding-bridge --list-devices    # pick --input-device / --output-device
cd bridge && uv run ding-bridge --list-ports      # pick --port (default: auto-detect)
```

- It finds the box on USB serial (`--port` to choose), keeps the display in sync with `STATE:...` and
  the same `INFO:` lines as the guest screen, and reconnects by itself when the box is unplugged and
  plugged back in.
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
  (`ELEVENLABS_API_KEY`), the speaker, the box and the microphone, and says what is wrong. On macOS
  the terminal app needs microphone permission (System Settings > Privacy & Security > Microphone).

Run either the guest screen or the bridge for a table, not both: a new turn for a table cancels the
one in progress.

## Other radios

A classic-Bluetooth serial module (HC-05 / HC-06) on a board's TX/RX pins shows up on the Mac as an
ordinary serial port (`/dev/cu.HC-05...`), so the same protocol works unchanged: pick that port under
**USB cable** on the guest screen, or pass it to the bridge with `--port` (the bridge also auto-detects
HC-05/HC-06 names). Set the module to 115200 baud (they ship at 9600). A Wi-Fi link would need a small
network listener on the laptop side; it is not built.

## Legacy: Arduino Uno + LED

The first box was an Arduino Uno R3 with an LED instead of the LCD:
`firmware/table_button/table_button.ino`. Button on D2 to GND, LED on D9 through 220 Ω, USB only, no
Bluetooth. It speaks the same protocol, shows the state as LED patterns and ignores `INFO:` lines, so
the guest screen and the bridge work with it unchanged. Flash it with Board: *Arduino Uno*.

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
