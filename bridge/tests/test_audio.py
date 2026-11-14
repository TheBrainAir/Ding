import io
import shutil
import subprocess
import wave

import numpy as np
import pytest

from ding_bridge import audio, earcons


def sine(seconds: float, sr: int, freq: float = 440.0) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (np.sin(2 * np.pi * freq * t) * 12000).astype(np.int16)


def test_wav_roundtrip():
    pcm = sine(0.25, 16000)
    data = audio.to_wav(pcm, 16000)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, pcm.size)


def test_decode_wav_resamples_to_playback_rate():
    out = audio.decode(audio.to_wav(sine(0.5, 16000), 16000), 44100)
    assert out.dtype == np.float32
    assert abs(out.size - 22050) < 200
    assert 0.3 < float(np.max(np.abs(out))) < 0.45


@pytest.mark.skipif(not shutil.which("lame"), reason="needs the lame encoder to build an mp3 fixture")
def test_decode_mp3_like_the_backend_sends(tmp_path):
    wav_path, mp3_path = tmp_path / "s.wav", tmp_path / "s.mp3"
    wav_path.write_bytes(audio.to_wav(sine(1.0, 44100), 44100))
    subprocess.run(["lame", "--quiet", "-b", "128", str(wav_path), str(mp3_path)], check=True)
    out = audio.decode(mp3_path.read_bytes(), 44100)
    assert abs(out.size - 44100) < 3000  # encoder delay / padding
    assert float(np.max(np.abs(out))) > 0.3


def test_decode_garbage_raises_audio_error():
    with pytest.raises(audio.AudioError):
        audio.decode(b"definitely not audio", 44100)


def test_pcm_queue_is_gapless_across_chunks():
    q = audio.PcmQueue()
    chunks = [np.arange(5, dtype=np.float32), np.arange(5, 12, dtype=np.float32), np.arange(12, 13, dtype=np.float32)]
    for c in chunks:
        q.push(c)
    assert q.pending() == 13
    got = np.concatenate([q.read(4), q.read(4), q.read(4), q.read(4)])
    assert got[:13].tolist() == list(range(13))
    assert got[13:].tolist() == [0, 0, 0]  # silence once empty, never stale data
    assert q.pending() == 0


def test_pcm_queue_clear_is_immediate():
    q = audio.PcmQueue()
    q.push(np.ones(1000, dtype=np.float32))
    q.read(10)
    q.clear()
    assert q.pending() == 0 and not np.any(q.read(64))


@pytest.mark.parametrize("name", list(earcons.ALL))
def test_earcons_are_short_quiet_and_click_free(name):
    tone = earcons.ALL[name](44100)
    assert tone.dtype == np.float32
    assert 0.03 < tone.size / 44100 < 0.6
    assert float(np.max(np.abs(tone))) <= 0.2
    assert abs(tone[0]) < 0.01 and abs(tone[-1]) < 0.01
