"""Short, quiet feedback tones, generated in code (no asset files).

With no screen at the table, these are the guest's only signal that a press registered:

    ready       soft rising triad     the box is connected and listening for presses
    listening   two rising notes      recording started, speak now
    got_it      two falling notes     recording sent, the waiter is thinking
    thinking    very soft tick        still working (repeats while a reply takes long)
    error       low falling pair      didn't catch that / something went wrong
"""

import numpy as np

VOLUME = 0.16  # well below speech level


def _tone(freq: float, ms: float, sr: int, volume: float) -> np.ndarray:
    n = int(sr * ms / 1000)
    t = np.arange(n, dtype=np.float32) / sr
    wave = np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(4 * np.pi * freq * t)  # a little warmth
    fade = min(n // 2, int(sr * 0.012))
    env = np.ones(n, dtype=np.float32)
    if fade > 0:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade, dtype=np.float32))
        env[:fade] = ramp
        env[-fade:] = ramp[::-1]
    return (wave * env * volume / 1.18).astype(np.float32)


def _gap(ms: float, sr: int) -> np.ndarray:
    return np.zeros(int(sr * ms / 1000), dtype=np.float32)


def _join(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts).astype(np.float32)


def ready(sr: int) -> np.ndarray:
    return _join(
        _tone(523, 70, sr, VOLUME * 0.8),
        _gap(15, sr),
        _tone(659, 70, sr, VOLUME * 0.8),
        _gap(15, sr),
        _tone(784, 110, sr, VOLUME * 0.8),
    )


def listening(sr: int) -> np.ndarray:
    return _join(_tone(660, 60, sr, VOLUME), _gap(20, sr), _tone(990, 90, sr, VOLUME))


def got_it(sr: int) -> np.ndarray:
    return _join(_tone(880, 55, sr, VOLUME), _gap(15, sr), _tone(660, 100, sr, VOLUME))


def thinking(sr: int) -> np.ndarray:
    return _tone(520, 45, sr, VOLUME * 0.45)


def error(sr: int) -> np.ndarray:
    return _join(_tone(392, 130, sr, VOLUME), _gap(40, sr), _tone(311, 220, sr, VOLUME))


ALL = {"ready": ready, "listening": listening, "got_it": got_it, "thinking": thinking, "error": error}
