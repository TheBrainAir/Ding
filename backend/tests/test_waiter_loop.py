"""The agent loop against a scripted model: what is spoken, what is stored, what is sent."""

import copy

from sqlalchemy import select

from app.models import Order, WaiterCall
from app.services import waiter
from app.services.llm import FALLBACK_BETA
from tests.conftest import dish_id
from tests.fixtures import PEANUT_DISH


class FakeBlock:
    def __init__(self, data: dict) -> None:
        self.data = data
        self.type = data["type"]
        self.text = data.get("text", "")

    def to_dict(self, mode: str = "python") -> dict:
        return copy.deepcopy(self.data)


class FakeMessage:
    def __init__(self, blocks: list[dict], stop_reason: str) -> None:
        self.content = [FakeBlock(b) for b in blocks]
        self.stop_reason = stop_reason


class ScriptedLLM:
    """Plays back (blocks, stop_reason) responses, streaming text in small chunks."""

    def __init__(self, responses: list) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    async def __call__(self, params, handler, *, use_fast):
        self.calls.append({"params": copy.deepcopy(params), "use_fast": use_fast})
        blocks, stop = self.responses.pop(0)
        for i, block in enumerate(blocks):
            handler.on_block_start(i, block["type"])
            if block["type"] == "text":
                text = block["text"]
                for j in range(0, len(text), 7):
                    handler.on_text(i, text[j : j + 7])
        return FakeMessage(blocks, stop)


def thinking(sig: str) -> dict:
    return {"type": "thinking", "thinking": "", "signature": sig}


def text(t: str) -> dict:
    return {"type": "text", "text": t}


def tool_use(tid: str, name: str, **tool_input) -> dict:
    return {"type": "tool_use", "id": tid, "name": name, "input": tool_input}


async def run(db, ctx, llm, guest_text="Hello", language="en"):
    events: list[dict] = []

    async def emit(e: dict) -> None:
        events.append(e)

    spoken = await waiter.run_turn(
        db=db,
        session=ctx.session,
        restaurant=ctx.restaurant,
        guest_text=guest_text,
        language=language,
        speak=False,
        emit=emit,
        stream=llm,
    )
    return spoken, events


def spoken_text(events: list[dict]) -> str:
    return "".join(e["delta"] for e in events if e["type"] == "text").strip()


async def test_ordering_before_allergies_is_refused_and_chatter_is_not_spoken(db, ctx):
    pad = dish_id(db, PEANUT_DISH)
    question = "Before I add it, does anyone at the table have any food allergies?"
    llm = ScriptedLLM(
        [
            (
                [
                    thinking("sig-1"),
                    text("Great choice, adding it now."),
                    tool_use(
                        "tu_1", "add_to_order", dish_id=pad, quantity=1, notes="", guest_confirmed_allergen_risk=False
                    ),
                ],
                "tool_use",
            ),
            ([thinking("sig-2"), text(question)], "end_turn"),
        ]
    )
    _spoken, events = await run(db, ctx, llm, f"I'll have the {PEANUT_DISH}")

    assert spoken_text(events) == question
    assert "adding it now" not in spoken_text(events)
    assert db.scalars(select(Order)).all() == []

    # The tool refusal went back to the model as an error tool_result it can act on.
    second = llm.calls[1]["params"]["messages"]
    assert [m["role"] for m in second] == ["user", "assistant", "user"]
    assert second[1]["content"][0] == thinking("sig-1")  # thinking replayed verbatim
    result = second[2]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu_1" and result["is_error"] is True
    assert "allergies_not_recorded" in result["content"]

    # Append-only: each request extends the previous one.
    assert second[: len(llm.calls[0]["params"]["messages"])] == llm.calls[0]["params"]["messages"]
    history = ctx.session.messages
    assert len(history) == 4 and history[-1]["content"][-1] == text(question)

    state = next(e for e in events if e["type"] == "state")
    assert state["allergies"]["confirmed"] is False and state["order"] is None
    assert [t["role"] for t in ctx.session.transcript] == ["guest", "waiter"]


async def test_request_shape_follows_model_rules(db, ctx):
    llm = ScriptedLLM([([text("Hi! What can I get you?")], "end_turn")])
    await run(db, ctx, llm)
    call = llm.calls[0]
    p = call["params"]
    assert p["model"] == ctx.restaurant.llm_model
    assert p["output_config"] == {"effort": "low"}
    assert p["cache_control"] == {"type": "ephemeral"}
    assert p["fallbacks"] == "default" and FALLBACK_BETA in p["betas"]
    for forbidden in ("temperature", "thinking", "tool_choice", "top_p", "top_k"):
        assert forbidden not in p
    assert call["use_fast"] is True
    for tool in p["tools"]:
        assert tool["strict"] is True
        assert tool["input_schema"]["additionalProperties"] is False
        assert set(tool["input_schema"]["required"]) == set(tool["input_schema"]["properties"])
    # Volatile state rides at the end of the user message, not in the system prompt.
    user_blocks = p["messages"][-1]["content"]
    assert user_blocks[-1]["text"].startswith("<session_state>")
    system_text = p["system"][0]["text"]
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "draft_order:" not in system_text and "allergies: not asked" not in system_text


async def test_history_and_system_prompt_stay_stable_across_turns(db, ctx):
    llm = ScriptedLLM(
        [
            ([thinking("s1"), text("Hello there.")], "end_turn"),
            ([thinking("s2"), text("Sure.")], "end_turn"),
        ]
    )
    await run(db, ctx, llm, "Hi")
    system_before = ctx.session.system_prompt
    # The owner edits the menu mid-visit: the frozen system prompt must not change.
    from app.models import Dish

    db.get(Dish, dish_id(db, PEANUT_DISH)).price = 99.0
    db.commit()
    await run(db, ctx, llm, "And now?")
    first, second = (c["params"] for c in llm.calls)
    assert second["system"] == first["system"]
    assert first["system"][0]["text"] == system_before
    assert second["messages"][: len(ctx.session.messages) - 2] == ctx.session.messages[:-2]
    assert second["messages"][:2] == ctx.session.messages[:2]
    state_block = second["messages"][-1]["content"][-1]["text"]
    assert "menu_update" in state_block and "99.00" in state_block


async def test_chatter_is_used_when_final_reply_is_empty(db, ctx):
    llm = ScriptedLLM(
        [
            ([text("One moment, let me check."), tool_use("tu_1", "get_order")], "tool_use"),
            ([thinking("s")], "end_turn"),
        ]
    )
    _spoken, events = await run(db, ctx, llm)
    assert spoken_text(events) == "One moment, let me check."


async def test_refusal_hands_over_to_staff_and_is_not_stored(db, ctx):
    llm = ScriptedLLM([([], "refusal")])
    spoken, events = await run(db, ctx, llm)
    assert "staff" in spoken
    assert any(e["type"] == "waiter_called" for e in events)
    assert db.scalars(select(WaiterCall)).one().table_label == ctx.session.table_label
    assert [m["role"] for m in ctx.session.messages] == ["user"]


async def test_truncated_tool_call_is_not_executed(db, ctx):
    pad = dish_id(db, PEANUT_DISH)
    llm = ScriptedLLM(
        [
            ([tool_use("tu_1", "set_allergies", allergens=[], notes="", none_declared=True)], "max_tokens"),
        ]
    )
    await run(db, ctx, llm)
    assert ctx.session.allergies_confirmed is False
    assert pad is not None


async def test_looked_up_dishes_are_sent_as_cards(db, ctx):
    llm = ScriptedLLM(
        [
            ([tool_use("tu_1", "search_menu", query="noodles with peanuts", category=None)], "tool_use"),
            ([text("We have peanut noodles.")], "end_turn"),
        ]
    )
    _, events = await run(db, ctx, llm)
    kinds = [e["type"] for e in events]
    assert kinds.index("text") < kinds.index("dishes") < kinds.index("state")
    cards = next(e for e in events if e["type"] == "dishes")["dishes"]
    assert PEANUT_DISH in [d["name"] for d in cards]
    assert {"photo_url", "allergens", "price"} <= set(cards[0])


async def test_full_order_flow_places_order(db, ctx):
    pad = dish_id(db, PEANUT_DISH)
    llm = ScriptedLLM(
        [
            (
                [
                    tool_use("a", "set_allergies", allergens=[], notes="", none_declared=True),
                    tool_use(
                        "b", "add_to_order", dish_id=pad, quantity=2, notes="", guest_confirmed_allergen_risk=False
                    ),
                ],
                "tool_use",
            ),
            ([tool_use("c", "place_order")], "tool_use"),
            ([text("Your order is on its way to the kitchen.")], "end_turn"),
        ]
    )
    _, events = await run(db, ctx, llm, "No allergies. Two peanut noodles please, that's all, yes send it.")
    order = db.scalars(select(Order)).one()
    assert order.status == "placed" and order.items[0].quantity == 2
    # Parallel tool calls answered in a single user message.
    assert [r["tool_use_id"] for r in llm.calls[1]["params"]["messages"][-1]["content"]] == ["a", "b"]
    state = next(e for e in events if e["type"] == "state")
    assert state["order"]["status"] == "placed" and state["allergies"]["none_declared"] is True
