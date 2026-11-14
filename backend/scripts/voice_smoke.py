"""End-to-end voice check against a running backend (needs ELEVENLABS_API_KEY).

For each language it synthesizes a guest phrase with ElevenLabs, posts it as audio to
POST /api/table/{token}/turn, and checks the streamed reply: transcript, detected
language, reply language, and that audio chunks arrived in order.

    uv run python scripts/seed_demo.py            # once
    uv run uvicorn app.main:app --port 8010       # in another terminal
    uv run python scripts/voice_smoke.py [--base http://localhost:8010] [--token TABLE_TOKEN]
"""

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.seed import DEMO_EMAIL, DEMO_PASSWORD
from app.services.language import detect_language

PHRASES = [
    ("es", "Hola, buenas noches. ¿Qué plato principal me recomienda? No tengo ninguna alergia."),
    ("hy", "Բարև ձեզ։ Ի՞նչ հիմնական ուտեստ կառաջարկեք։ Ես ալերգիա չունեմ։"),
]


def synthesize(text: str, language: str, voice_id: str, model_id: str) -> bytes:
    resp = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": settings.elevenlabs_api_key.strip()},
        json={"text": text, "model_id": model_id, "language_code": language},
        timeout=60,
    )
    if resp.status_code in (400, 422):  # model refuses language_code: let it infer
        resp = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": settings.elevenlabs_api_key.strip()},
            json={"text": text, "model_id": model_id},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content


def run_turn(client: httpx.Client, token: str, audio: bytes) -> dict:
    t0 = time.monotonic()
    out: dict = {"events": [], "timings": {}}
    with client.stream(
        "POST", f"/api/table/{token}/turn", files={"audio": ("guest.mp3", audio, "audio/mpeg")}, timeout=120
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line.strip():
                continue
            event = json.loads(line)
            kind = event["type"]
            out["timings"].setdefault(kind, round(time.monotonic() - t0, 2))
            if kind == "audio":
                event = {**event, "b64": f"<{len(event['b64'])} b64 chars>"}
            out["events"].append(event)
    out["timings"]["total"] = round(time.monotonic() - t0, 2)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:8010")
    parser.add_argument("--token", help="table token (default: the demo restaurant's first table)")
    args = parser.parse_args()

    if not settings.voice_enabled:
        print("ELEVENLABS_API_KEY is empty in backend/.env, so the voice path cannot be tested.")
        print("Add the key, restart the backend, and run this script again.")
        return 2

    client = httpx.Client(base_url=args.base)
    login = client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    if login.status_code != 200:
        print(f"Could not log in as the demo owner ({login.status_code}). Run scripts/seed_demo.py first.")
        return 1
    restaurant = login.json()["restaurant"]
    token = args.token or client.get("/api/tables").json()[0]["token"]
    voices = client.get("/api/voices").json()
    voice_id = restaurant["voice_id"] or (voices[0]["voice_id"] if voices else "")
    print(f"table {token}  voice {voice_id}  stt {restaurant['stt_model']}  tts {restaurant['tts_model']}")

    failures = 0
    for language, phrase in PHRASES:
        client.post(f"/api/table/{token}/reset")
        audio = synthesize(phrase, language, voice_id, restaurant["tts_model"])
        result = run_turn(client, token, audio)
        events = result["events"]
        transcript = next((e for e in events if e["type"] == "transcript"), {})
        reply = "".join(e.get("delta", "") for e in events if e["type"] == "text").strip()
        seqs = [e["seq"] for e in events if e["type"] == "audio"]
        checks = {
            "transcript heard": bool(transcript.get("text")),
            f"transcript language = {language}": transcript.get("language") == language,
            f"reply language = {language}": detect_language(reply) == language,
            "audio chunks arrived": len(seqs) > 0,
            "audio in order": seqs == list(range(len(seqs))),
            "ended with done": bool(events) and events[-1]["type"] == "done",
        }
        print(f"\n[{language}] guest said: {phrase}")
        print(f"  heard ({transcript.get('language')}): {transcript.get('text')}")
        print(f"  reply: {reply}")
        print(f"  audio chunks: {len(seqs)}  timings: {result['timings']}")
        for name, ok in checks.items():
            print(f"  {'PASS' if ok else 'FAIL'}  {name}")
            failures += 0 if ok else 1
        if events and events[-1]["type"] == "error":
            print(f"  error: {events[-1]['message']}")
    print("\nvoice smoke:", "OK" if failures == 0 else f"{failures} check(s) failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
