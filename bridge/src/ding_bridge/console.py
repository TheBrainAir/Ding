"""Operator output in the terminal (the guest never sees it)."""

import sys
import time

_COLORS = {"dim": "2", "red": "31", "green": "32", "yellow": "33", "blue": "34", "magenta": "35", "cyan": "36"}


class Console:
    def __init__(self, *, verbose: bool = False, stream=None) -> None:
        self.stream = stream or sys.stdout
        self.verbose = verbose
        self.color = hasattr(self.stream, "isatty") and self.stream.isatty()
        self._inline = False

    def _paint(self, text: str, color: str) -> str:
        return f"\033[{_COLORS[color]}m{text}\033[0m" if self.color else text

    def _line(self, text: str) -> None:
        if self._inline:
            self.stream.write("\n")
            self._inline = False
        stamp = self._paint(time.strftime("%H:%M:%S"), "dim")
        self.stream.write(f"{stamp} {text}\n")
        self.stream.flush()

    def ok(self, text: str) -> None:
        self._line(f"{self._paint('ok', 'green')}    {text}")

    def fail(self, text: str) -> None:
        self._line(f"{self._paint('FAIL', 'red')}  {text}")

    def info(self, text: str) -> None:
        self._line(text)

    def debug(self, text: str) -> None:
        if self.verbose:
            self._line(self._paint(text, "dim"))

    def warn(self, text: str) -> None:
        self._line(self._paint(f"! {text}", "yellow"))

    def error(self, text: str) -> None:
        self._line(self._paint(f"x {text}", "red"))

    def state(self, state: str) -> None:
        self._line(self._paint(f"[{state}]", "cyan"))

    def guest(self, text: str, language: str | None) -> None:
        heard = text if text else self._paint("(nothing intelligible)", "dim")
        self._line(f"{self._paint(f'guest ({language or "?"})', 'magenta')}: {heard}")

    def waiter_delta(self, delta: str) -> None:
        if not self._inline:
            self._line_start(self._paint("waiter", "blue") + ": ")
        self.stream.write(delta)
        self.stream.flush()

    def _line_start(self, prefix: str) -> None:
        stamp = self._paint(time.strftime("%H:%M:%S"), "dim")
        self.stream.write(f"{stamp} {prefix}")
        self._inline = True

    def end_inline(self) -> None:
        if self._inline:
            self.stream.write("\n")
            self.stream.flush()
            self._inline = False

    def turn_state(self, event: dict) -> None:
        allergies = event.get("allergies") or {}
        if not allergies.get("confirmed"):
            allergy_text = "not asked yet"
        elif allergies.get("none_declared") and not allergies.get("allergens"):
            allergy_text = "none"
        else:
            allergy_text = ", ".join(allergies.get("allergens") or []) or "none listed"
            if allergies.get("notes"):
                allergy_text += f" ({allergies['notes']})"
        self._line(f"  allergies: {allergy_text}")
        order = event.get("order")
        if not order or not order.get("items"):
            self._line("  order: empty")
            return
        items = ", ".join(
            f"{i['quantity']}x {i['name']}"
            + (self._paint(" [ALLERGEN RISK ACCEPTED]", "red") if i.get("allergen_flag") else "")
            for i in order["items"]
        )
        self._line(
            f"  order #{order['id']} ({order['status']}): {items} = {order['total']:.2f} {order.get('currency', '')}"
        )
