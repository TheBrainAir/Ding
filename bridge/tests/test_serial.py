"""The serial link against a pseudo-terminal standing in for the Arduino."""

import os
import select
import threading
import time
from types import SimpleNamespace

import pytest

from ding_bridge.serial_link import SerialLink, candidate_ports, lcd_text

pytestmark = pytest.mark.skipif(os.name != "posix", reason="uses a pty")


class FakeBoard:
    """The master side of a pty: what the Arduino would read and write."""

    def __init__(self) -> None:
        self.master, slave = os.openpty()
        self.path = os.ttyname(slave)
        os.close(slave)  # the link opens the path itself

    def send(self, text: str) -> None:
        os.write(self.master, text.encode())

    def received(self, timeout: float = 2.0) -> str:
        data, deadline = b"", time.monotonic() + timeout
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.master], [], [], 0.05)
            if ready:
                try:
                    data += os.read(self.master, 1024)
                except OSError:
                    break
            elif data:
                break
        return data.decode()

    def unplug(self) -> None:
        os.close(self.master)


def wait(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_lines_states_unplug_and_replug():
    board = FakeBoard()
    current = {"path": board.path}
    lines, statuses = [], []
    lock = threading.Lock()

    def on_status(kind, message):
        with lock:
            statuses.append(kind)

    link = SerialLink(
        lines.append, on_status, finder=lambda: [current["path"]] if current["path"] else [], retry_seconds=0.1
    )
    link.start()
    try:
        assert wait(lambda: "connected" in statuses)
        assert "STATE:idle" in board.received()  # current state is pushed on connect

        board.send("READY\r\nPRESS\r\n")
        board.send("REL")
        board.send("EASE\n")  # split across reads
        assert wait(lambda: lines == ["READY", "PRESS", "RELEASE"])

        link.send_state("listening")
        assert board.received() == "STATE:listening\n"
        link.send_info("Café 4 · Стол")
        link.send_info("Café 4 · Стол")  # repeat: not sent again
        assert board.received() == "INFO:Cafe 4 ? ????\n"

        board.unplug()
        current["path"] = None
        assert wait(lambda: "disconnected" in statuses)
        link.send_state("thinking")  # while unplugged: no crash, remembered
        assert wait(lambda: "waiting" in statuses)

        replugged = FakeBoard()
        current["path"] = replugged.path  # new port name after re-plug
        assert wait(lambda: statuses.count("connected") == 2)
        assert replugged.received() == "STATE:thinking\nINFO:Cafe 4 ? ????\n"  # screen restored
        replugged.send("PRESS\n")
        assert wait(lambda: lines[-1] == "PRESS")
    finally:
        link.stop()


def test_garbage_and_unknown_lines_do_not_break_the_link():
    board = FakeBoard()
    lines = []
    link = SerialLink(lines.append, lambda *_: None, port=board.path, retry_seconds=0.1)
    link.start()
    try:
        assert wait(lambda: link.connected)
        board.send("x" * 400 + "\nHELLO\n\n  PRESS  \n")
        assert wait(lambda: "PRESS" in lines)
        assert "HELLO" in lines
    finally:
        link.stop()


def port(device, description="", vid=None, manufacturer=""):
    return SimpleNamespace(device=device, description=description, vid=vid, manufacturer=manufacturer)


def test_candidate_ports_prefers_arduinos_and_skips_noise():
    ports = [
        port("/dev/cu.Bluetooth-Incoming-Port", "n/a"),
        port("/dev/cu.debug-console", "n/a"),
        port("/dev/tty.usbmodem1101", "IOUSBHostDevice", 0x2341),  # macOS tty.* twin of cu.*
        port("/dev/cu.usbserial-110", "USB Serial", 0x1A86),
        port("/dev/cu.usbmodem1101", "Arduino Uno", 0x2341),
        port("/dev/ttyS0", "ttyS0"),
    ]
    assert candidate_ports(lambda: ports) == ["/dev/cu.usbmodem1101", "/dev/cu.usbserial-110"]
    assert candidate_ports(lambda: [port("/dev/ttyACM0", "ttyACM0")]) == ["/dev/ttyACM0"]
    assert candidate_ports(lambda: [port("/dev/cu.HC-05", "n/a")]) == ["/dev/cu.HC-05"]  # Bluetooth serial module
    assert candidate_ports(list) == []


def test_lcd_text():
    assert lcd_text("Crème brûlée for table twelve") == "Creme brulee for"
    assert lcd_text("  Սեղան\t2 ") == "????? 2"
    assert lcd_text("Pizza 🍕!") == "Pizza ?!"
