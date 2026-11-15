"""USB serial link to the table button (docs/HARDWARE.md).

board -> bridge: PRESS, RELEASE, READY
bridge -> board: STATE:idle|listening|thinking|speaking, INFO:<text> (LCD line 2, ASCII, 16 chars)

A background thread keeps the link alive: if the board is unplugged it waits, looks for
it again (the port name can change on re-plug) and re-sends the current light state.
"""

import logging
import re
import threading
import time
import unicodedata
from collections.abc import Callable

log = logging.getLogger(__name__)

BAUD = 115200
# USB vendor ids of Arduino boards and the usual USB-serial chips on clones.
KNOWN_VIDS = {0x2341, 0x2A03, 0x1A86, 0x0403, 0x10C4, 0x239A, 0x1B4F, 0x16C0}
_IGNORED = ("bluetooth", "debug-console", "wlan", "airpods")
LCD_WIDTH = 16


def lcd_text(text: str, width: int = LCD_WIDTH) -> str:
    """What the 16x2 LCD can show: ASCII, accents stripped, one '?' per other character."""
    decomposed = unicodedata.normalize("NFKD", text)
    chars = []
    for ch in decomposed:
        if unicodedata.combining(ch):
            continue
        if ch.isspace():
            chars.append(" ")
        elif 0x20 <= ord(ch) < 0x7F:
            chars.append(ch)
        else:
            chars.append("?")
    return re.sub(r" +", " ", "".join(chars)).strip()[:width].rstrip()


def candidate_ports(comports: Callable[[], list] | None = None) -> list[str]:
    """Serial ports that look like a table button, best first."""
    if comports is None:
        from serial.tools import list_ports

        comports = list_ports.comports
    scored = []
    for p in comports():
        device = str(p.device)
        text = f"{device} {p.description or ''} {getattr(p, 'manufacturer', '') or ''}".lower()
        if any(word in text for word in _IGNORED):
            continue
        if device.startswith("/dev/tty.") and device.replace("/dev/tty.", "/dev/cu.") != device:
            continue  # macOS: use the call-out device (/dev/cu.*), which does not block on open
        score = 0
        if getattr(p, "vid", None) in KNOWN_VIDS:
            score += 10
        if "arduino" in text:
            score += 5
        if any(tag in device for tag in ("usbmodem", "usbserial", "ttyACM", "ttyUSB", "wchusbserial")):
            score += 3
        if any(tag in text for tag in ("hc-05", "hc-06", "hc05", "hc06")):
            score += 3  # classic-Bluetooth serial module (battery-powered box)
        if device.upper().startswith("COM") and getattr(p, "vid", None):
            score += 2
        if score:
            scored.append((score, device))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [device for _, device in scored]


class SerialLink:
    def __init__(
        self,
        on_line: Callable[[str], None],
        on_status: Callable[[str, str], None],
        *,
        port: str | None = None,
        finder: Callable[[], list[str]] = candidate_ports,
        retry_seconds: float = 1.0,
        open_port: Callable[[str], object] | None = None,
    ) -> None:
        self.on_line = on_line
        self.on_status = on_status  # (kind, message): kind in connected | disconnected | waiting
        self.fixed_port = port
        self.finder = finder
        self.retry_seconds = retry_seconds
        self._open_port = open_port or self._default_open
        self._serial = None
        self._state = "idle"
        self._info = ""
        self._write_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.port: str | None = None

    @staticmethod
    def _default_open(path: str):
        import serial

        return serial.Serial(path, BAUD, timeout=0.2, write_timeout=1)

    @property
    def connected(self) -> bool:
        return self._serial is not None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="serial-link", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._close()

    def send_state(self, state: str) -> None:
        self._state = state
        self._write(f"STATE:{state}\n")

    def send_info(self, text: str) -> None:
        """LCD line 2 of the ESP32 box (the old Uno sketch ignores it). Repeats are skipped."""
        info = lcd_text(text)
        if not info or info == self._info:
            return
        self._info = info
        self._write(f"INFO:{info}\n")

    def resend_state(self) -> None:
        """After (re)connecting or a READY from the board: it shows nothing of ours."""
        self._write(f"STATE:{self._state}\n")
        if self._info:
            self._write(f"INFO:{self._info}\n")

    def _write(self, text: str) -> None:
        with self._write_lock:
            ser = self._serial
            if ser is None:
                return
            try:
                # No flush(): pyserial's flush is tcdrain(), which can block forever when the
                # other end stops reading. write() with write_timeout hands bytes to the driver.
                ser.write(text.encode("ascii"))
            except Exception as e:  # unplugged mid-write; the reader notices and reconnects
                log.debug("serial write failed: %s", e)

    def _close(self) -> None:
        with self._write_lock:
            ser, self._serial = self._serial, None
        if ser is not None:
            try:
                ser.close()
            except Exception:
                pass

    def _run(self) -> None:
        announced_wait = False
        while not self._stop.is_set():
            path = self.fixed_port or next(iter(self.finder()), None)
            if path is None:
                if not announced_wait:
                    self.on_status("waiting", "no table button on USB serial; waiting for it to be plugged in")
                    announced_wait = True
                self._stop.wait(self.retry_seconds)
                continue
            try:
                ser = self._open_port(path)
            except Exception as e:
                if not announced_wait:
                    self.on_status("waiting", f"cannot open {path} ({e}); retrying")
                    announced_wait = True
                self._stop.wait(self.retry_seconds)
                continue
            announced_wait = False
            with self._write_lock:
                self._serial = ser
            self.port = path
            self.on_status("connected", path)
            self.resend_state()
            self._read_lines(ser)
            self._close()
            if not self._stop.is_set():
                self.on_status("disconnected", path)
                self._stop.wait(self.retry_seconds)

    def _read_lines(self, ser) -> None:
        buf = b""
        while not self._stop.is_set():
            try:
                chunk = ser.read(64)
            except Exception:
                return  # unplugged
            if not chunk:
                if not getattr(ser, "is_open", True):
                    return
                continue
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("ascii", "ignore").strip()
                if line:
                    self.on_line(line)
            if len(buf) > 256:
                buf = b""  # garbage without newlines


def wait_for_port(finder: Callable[[], list[str]] = candidate_ports, seconds: float = 0.0) -> str | None:
    deadline = time.monotonic() + seconds
    while True:
        ports = finder()
        if ports or time.monotonic() >= deadline:
            return ports[0] if ports else None
        time.sleep(0.25)
