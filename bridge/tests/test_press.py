from ding_bridge.press import PressController


class Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def make():
    calls: list[str] = []
    clock = Clock()
    pc = PressController(lambda: calls.append("start"), lambda: calls.append("stop"), tap_threshold_ms=300, now=clock)
    return pc, calls, clock


def test_hold_records_while_held():
    pc, calls, clock = make()
    pc.press()
    clock.t += 1.2
    pc.release()
    assert calls == ["start", "stop"] and not pc.latched


def test_tap_latches_and_next_press_sends():
    pc, calls, clock = make()
    pc.press()
    clock.t += 0.1
    pc.release()
    assert calls == ["start"] and pc.latched
    clock.t += 3
    pc.press()
    assert calls == ["start", "stop"]
    clock.t += 0.05
    pc.release()  # swallowed: does not start anything
    assert calls == ["start", "stop"] and not pc.latched


def test_threshold_boundary():
    pc, calls, clock = make()
    pc.press()
    clock.t += 0.299
    pc.release()
    assert pc.latched
    pc.reset()
    calls.clear()
    pc.press()
    clock.t += 0.301
    pc.release()
    assert calls == ["start", "stop"]


def test_duplicate_presses_and_stray_releases_are_ignored():
    pc, calls, clock = make()
    pc.release()
    pc.press()
    pc.press()
    clock.t += 1
    pc.release()
    pc.release()
    assert calls == ["start", "stop"]


def test_reset_forgets_a_latched_recording():
    pc, calls, _clock = make()
    pc.press()
    pc.release()
    pc.reset()
    pc.press()  # a fresh recording, not "send"
    assert calls == ["start", "start"]


def test_reset_while_held_swallows_the_release():
    pc, calls, clock = make()
    pc.press()
    pc.reset()  # e.g. the recording hit its time limit while the button is still down
    clock.t += 2
    pc.release()
    assert calls == ["start"]
