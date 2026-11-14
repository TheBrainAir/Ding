"""HTTP contract checks (docs/API.md) through the real app."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.seed import DEMO_EMAIL, DEMO_PASSWORD


@pytest.fixture
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def owner(client):
    r = client.post(
        "/api/auth/signup", json={"email": "Owner@Example.com", "password": "secret123", "restaurant_name": "Cafe Test"}
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def demo_client(client, demo):
    r = client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200
    return client


def test_auth_flow(client, owner):
    assert owner["user"]["email"] == "owner@example.com"
    assert owner["restaurant"]["persona_name"] == "Ding"
    assert owner["restaurant"]["llm_model"] == "claude-opus-5-5"
    assert client.get("/api/me").json()["restaurant"]["name"] == "Cafe Test"

    dup = client.post(
        "/api/auth/signup", json={"email": "owner@example.com", "password": "secret123", "restaurant_name": "X"}
    )
    assert dup.status_code == 409 and isinstance(dup.json()["detail"], str)

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/me").status_code == 401
    bad = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "nope"})
    assert bad.status_code == 401
    assert (
        client.post("/api/auth/login", json={"email": "owner@example.com", "password": "secret123"}).status_code == 200
    )


def test_validation_errors_are_readable(client):
    r = client.post("/api/auth/signup", json={"email": "bad", "password": "1", "restaurant_name": ""})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_restaurant_settings_and_catalogs(client, owner):
    r = client.patch("/api/restaurant", json={"persona_name": "Max", "currency": "EUR"})
    assert r.json()["persona_name"] == "Max" and r.json()["currency"] == "EUR"
    assert client.patch("/api/restaurant", json={"llm_model": "gpt-4"}).status_code == 422
    models = client.get("/api/models").json()
    assert {m["id"] for m in models["llm"]} >= {"claude-opus-5-5"}
    assert models["stt"] and models["tts"]
    assert client.get("/api/voices").json() == []  # no ElevenLabs key in tests
    meta = client.get("/api/meta").json()
    assert len(meta["allergens"]) == 14 and {"id": "gluten_free", "label": "Gluten-free"} in meta["dietary_tags"]


def test_dish_crud_and_photo(client, owner):
    body = {
        "name": "Soup",
        "description": "Hot soup",
        "category": "Starters",
        "price": 5.5,
        "ingredients": ["celery", "carrot"],
        "allergens": ["celery"],
        "may_contain": [],
        "dietary_tags": ["vegan"],
    }
    created = client.post("/api/dishes", json=body)
    assert created.status_code == 201
    dish = created.json()
    assert dish["photo_url"] is None and dish["available"] is True and dish["allergens"] == ["celery"]
    assert client.post("/api/dishes", json={**body, "allergens": ["nuts"]}).status_code == 422

    patched = client.patch(f"/api/dishes/{dish['id']}", json={"price": 6.0, "available": False}).json()
    assert patched["price"] == 6.0 and patched["available"] is False
    assert [d["id"] for d in client.get("/api/dishes", params={"q": "carrot"}).json()] == [dish["id"]]
    assert client.get("/api/dishes", params={"category": "Mains"}).json() == []

    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 120, 40)).save(buf, "PNG")
    up = client.post(f"/api/dishes/{dish['id']}/photo", files={"file": ("soup.png", buf.getvalue(), "image/png")})
    assert up.status_code == 200
    url = up.json()["photo_url"]
    assert url.startswith("/media/dishes/") and url.endswith(".jpg")
    served = client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert client.delete(f"/api/dishes/{dish['id']}/photo").json()["photo_url"] is None
    assert client.get(url).status_code == 404

    bulk = client.post("/api/dishes/bulk", json={"dishes": [{"name": "Tea", "price": None, "category": ""}]})
    assert bulk.status_code == 201 and bulk.json()[0]["price"] == 0.0 and bulk.json()[0]["category"] == "Other"
    assert client.delete(f"/api/dishes/{dish['id']}").status_code == 204
    assert client.patch(f"/api/dishes/{dish['id']}", json={"price": 1}).status_code == 404


def test_knowledge_and_tables(client, owner):
    k = client.post("/api/knowledge", json={"title": "Parking", "content": "Free parking behind the building."}).json()
    assert set(k) == {"id", "title", "content", "updated_at"}
    assert (
        client.patch(f"/api/knowledge/{k['id']}", json={"content": "Paid parking."}).json()["content"]
        == "Paid parking."
    )
    assert client.delete(f"/api/knowledge/{k['id']}").status_code == 204

    t = client.post("/api/tables", json={"label": "Table 9"}).json()
    assert t["url"] == f"/t/{t['token']}" and t["active_session_id"] is None
    assert client.patch(f"/api/tables/{t['id']}", json={"label": "Patio 1"}).json()["label"] == "Patio 1"

    info = client.get(f"/api/table/{t['token']}").json()
    assert info == {
        "table_label": "Patio 1",
        "restaurant_name": "Cafe Test",
        "persona_name": "Ding",
        "currency": "USD",
        "voice_enabled": False,
        "session": None,
    }
    assert client.get("/api/table/nope").status_code == 404
    assert client.delete(f"/api/tables/{t['id']}").status_code == 204


def test_dashboard_requires_login(client):
    for path in ("/api/restaurant", "/api/dishes", "/api/orders", "/api/stats", "/api/sessions", "/api/events"):
        assert client.get(path).status_code == 401, path


def ndjson(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_empty_turn_skips_the_model(demo_client, demo):
    token = demo["table"].token
    r = demo_client.post(f"/api/table/{token}/turn", json={"text": "   ", "speak": True})
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert ndjson(r) == [{"type": "transcript", "text": "", "language": None}, {"type": "done"}]


def test_audio_turn_without_voice_key_is_a_clear_error(demo_client, demo):
    token = demo["table"].token
    r = demo_client.post(f"/api/table/{token}/turn", files={"audio": ("a.webm", b"\x1a\x45", "audio/webm")})
    events = ndjson(r)
    assert events[-1]["type"] == "error" and "ELEVENLABS_API_KEY" in events[-1]["message"]
    assert demo_client.post(f"/api/device/{token}/turn", content=b"RIFF").status_code == 503


def test_reset_and_stats_and_sessions(demo_client, demo, db, ctx):
    from tests.conftest import call, dish_id
    from tests.fixtures import SAFE_DESSERT

    ctx.session.turn_count = 1
    ctx.session.language = "es"
    db.commit()
    call(ctx, "set_allergies", allergens=[], notes="", none_declared=True)
    call(
        ctx,
        "add_to_order",
        dish_id=dish_id(db, SAFE_DESSERT),
        quantity=3,
        notes="",
        guest_confirmed_allergen_risk=False,
    )
    call(ctx, "place_order")

    stats = demo_client.get("/api/stats").json()
    assert stats["orders_today"] == 1 and stats["revenue_today"] == 19.5 and stats["active_tables"] == 1
    assert stats["top_dishes"][0]["name"] == SAFE_DESSERT and stats["top_dishes"][0]["quantity"] == 3
    assert stats["languages"] == [{"language": "es", "sessions": 1}]
    assert sum(h["orders"] for h in stats["orders_by_hour"]) == 1

    sessions = demo_client.get("/api/sessions").json()
    assert sessions[0]["id"] == ctx.session.id and sessions[0]["allergies"]["none_declared"] is True
    detail = demo_client.get(f"/api/sessions/{ctx.session.id}").json()
    assert detail["order"]["status"] == "placed" and detail["transcript"] == []

    table = demo_client.get(f"/api/table/{demo['table'].token}").json()
    assert table["session"]["id"] == ctx.session.id and table["session"]["order"]["status"] == "placed"
    assert demo_client.post(f"/api/table/{demo['table'].token}/reset").status_code == 204
    assert demo_client.get(f"/api/table/{demo['table'].token}").json()["session"] is None
