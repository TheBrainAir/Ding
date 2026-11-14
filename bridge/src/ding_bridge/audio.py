"""Microphone recording, gapless playback and audio decoding (sounddevice + miniaudio)."""

import io
import threading
import time
import wave
from collections import deque

import miniaudio
import numpy as np

PLAYBACK_RATE = 44100  # the backend's TTS sends mp3_44100_128
RECORD_RATE = 16000  # plenty for speech recognition, keeps uploads small


class AudioError(Exception):
    pass


def _sd():
    import sounddevice  # imported lazily so tests and --help work without audio hardware

    return sounddevice


# ---------------------------------------------------------------- devices


def list_devices() -> str:
    return str(_sd().query_devices())


def resolve_device(spec: str | None, kind: str) -> int | None:
    """Device index from an index or a case-insensitive name fragment; None = system default."""
    sd = _sd()
    if spec is None or spec == "":
        try:
            sd.query_devices(kind=kind)
        except Exception as e:
            raise AudioError(f"No {'microphone' if kind == 'input' else 'speaker'} found ({e}).") from e
        return None
    channels_key = "max_input_channels" if kind == "input" else "max_output_channels"
    devices = list(sd.query_devices())
    if spec.isdigit():
        idx = int(spec)
        if idx < len(devices) and devices[idx][channels_key] > 0:
            return idx
        raise AudioError(f"Device {idx} is not an {kind} device. See --list-devices.")
    matches = [i for i, d in enumerate(devices) if spec.lower() in d["name"].lower() and d[channels_key] > 0]
    if not matches:
        raise AudioError(f"No {kind} device matching '{spec}'. See --list-devices.")
    return matches[0]


def device_name(index: int | None, kind: str) -> str:
    sd = _sd()
    info = sd.query_devices(index, kind=kind) if index is None else sd.query_devices(index)
    return str(info["name"])


# ---------------------------------------------------------------- decoding / encoding


def decode(data: bytes, sample_rate: int = PLAYBACK_RATE) -> np.ndarray:
    """Any of mp3 / wav / flac / ogg bytes -> mono float32 at `sample_rate`."""
    try:
        decoded = miniaudio.decode(
            data, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=sample_rate
        )
    except miniaudio.DecodeError as e:
        raise AudioError(f"could not decode audio chunk ({e})") from e
    return np.frombuffer(decoded.samples, dtype=np.float32).copy()


def to_wav(pcm16: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(np.asarray(pcm16, dtype=np.int16).tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------- playback


class PcmQueue:
    """Thread-safe FIFO of float32 mono samples, read by the audio callback."""

    def __init__(self) -> None:
        self._chunks: deque[np.ndarray] = deque()
        self._offset = 0
        self._pending = 0
        self._lock = threading.Lock()

    def push(self, pcm: np.ndarray) -> None:
        if pcm.size == 0:
            return
        with self._lock:
            self._chunks.append(pcm.astype(np.float32, copy=False))
            self._pending += pcm.size

    def clear(self) -> None:
        with self._lock:
            self._chunks.clear()
            self._offset = 0
            self._pending = 0

    def pending(self) -> int:
        with self._lock:
            return self._pending

    def read(self, frames: int) -> np.ndarray:
        out = np.zeros(frames, dtype=np.float32)
        filled = 0
        with self._lock:
            while filled < frames and self._chunks:
                chunk = self._chunks[0]
                take = min(frames - filled, chunk.size - self._offset)
                out[filled : filled + take] = chunk[self._offset : self._offset + take]
                filled += take
                self._offset += take
                if self._offset >= chunk.size:
                    self._chunks.popleft()
                    self._offset = 0
            self._pending -= filled
        return out


class Player:
    """One always-open output stream; chunks queue up back to back, so playback is gapless."""

    def __init__(self, device: int | None = None) -> None:
        self.device = device
        self.queue = PcmQueue()
        self.sample_rate = PLAYBACK_RATE
        self._stream = None

    def open(self) -> None:
        sd = _sd()

        def callback(outdata, frames, _time, _status) -> None:
            outdata[:, 0] = self.queue.read(frames)

        last_error: Exception | None = None
        default_rate = int(sd.query_devices(self.device, kind="output")["default_samplerate"])
        for rate in dict.fromkeys((PLAYBACK_RATE, default_rate)):
            try:
                stream = sd.OutputStream(
                    samplerate=rate,
                    channels=1,
                    dtype="float32",
                    device=self.device,
                    callback=callback,
                    latency="low",
                )
                stream.start()
            except Exception as e:  # sounddevice.PortAudioError and friends
                last_error = e
                continue
            self._stream, self.sample_rate = stream, rate
            return
        raise AudioError(f"Could not open the speaker ({last_error}).")

    def play(self, pcm: np.ndarray) -> None:
        self.queue.push(pcm)

    def stop_now(self) -> None:
        self.queue.clear()

    @property
    def busy(self) -> bool:
        return self.queue.pending() > 0

    def close(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None


# ---------------------------------------------------------------- recording


class Recorder:
    """Opens the microphone for each recording (the mic indicator is on only while recording)."""

    def __init__(self, device: int | None = None) -> None:
        self.device = device
        self._stream = None
        self._frames: list[np.ndarray] = []
        self._lock = threading.Lock()
        self._started = 0.0
        self.sample_rate = RECORD_RATE

    @property
    def recording(self) -> bool:
        return self._stream is not None

    def start(self) -> None:
        if self._stream is not None:
            return
        sd = _sd()
        self._frames = []

        def callback(indata, _frames, _time, _status) -> None:
            with self._lock:
                self._frames.append(indata[:, 0].copy())

        last_error: Exception | None = None
        default_rate = int(sd.query_devices(self.device, kind="input")["default_samplerate"])
        for rate in dict.fromkeys((RECORD_RATE, default_rate)):
            try:
                stream = sd.InputStream(
                    samplerate=rate, channels=1, dtype="int16", device=self.device, callback=callback
                )
                stream.start()
            except Exception as e:
                last_error = e
                continue
            self._stream, self.sample_rate, self._started = stream, rate, time.monotonic()
            return
        raise AudioError(f"Could not open the microphone ({last_error}).")

    def _close(self) -> np.ndarray:
        stream, self._stream = self._stream, None
        if stream is not None:
            stream.stop()
            stream.close()
        with self._lock:
            frames, self._frames = self._frames, []
        return np.concatenate(frames) if frames else np.zeros(0, dtype=np.int16)

    def stop(self) -> tuple[bytes, float]:
        """Stop and return (wav bytes, seconds recorded)."""
        pcm = self._close()
        return to_wav(pcm, self.sample_rate), pcm.size / self.sample_rate

    def cancel(self) -> None:
        self._close()


def probe_microphone(device: int | None, seconds: float = 0.4) -> str | None:
    """Record a moment of audio. Returns a problem description, or None if the mic works.

    On macOS a microphone blocked by privacy settings still opens but delivers pure zeros."""
    rec = Recorder(device)
    try:
        rec.start()
    except AudioError as e:
        return str(e)
    time.sleep(seconds)
    pcm = rec._close()
    if pcm.size == 0:
        return "The microphone delivered no audio."
    if not np.any(pcm):
        return (
            "The microphone records pure silence, which usually means the OS is blocking it. On macOS: "
            "System Settings > Privacy & Security > Microphone, allow your terminal app, then run again "
            "(if a permission prompt just appeared, accept it and run again)."
        )
    return None
