"""Claude calls (official `anthropic` SDK, async, beta namespace for server-side fallbacks).

Request shape for every call (Claude Opus 5.5 rules):
- thinking is left at its adaptive default (it cannot be disabled); `output_config.effort`
  is the latency control. No temperature, no budget_tokens, no prefill, no forced
  tool_choice.
- `speed="fast"` where the model supports it; on a 429 the same request is retried at
  standard speed and fast mode rests for a while.
- `fallbacks="default"` + beta `server-side-fallback-2026-07-01` so a classifier refusal
  is re-run on Anthropic's recommended fallback model inside the same call.
- top-level `cache_control` (automatic prompt caching of the stable prefix).
"""

import json
import logging
import time
from typing import Any, Protocol

import anthropic
from anthropic import AsyncAnthropic

from app.catalog import llm_spec
from app.config import settings

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
FAST_COOLDOWN_SECONDS = 120


class LLMError(Exception):
    """A failure the caller should surface to the user as-is."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class StreamHandler(Protocol):
    def on_block_start(self, index: int, block_type: str) -> None: ...
    def on_text(self, index: int, text: str) -> None: ...


_client: AsyncAnthropic | None = None
_fast_paused_until = 0.0


def client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key.strip() or None, max_retries=2, timeout=90.0)
    return _client


def build_params(
    *,
    model: str,
    messages: list[dict],
    system: str | list[dict] | None = None,
    tools: list[dict] | None = None,
    max_tokens: int = 4096,
    effort: str = "low",
    output_format: dict | None = None,
) -> tuple[dict[str, Any], bool]:
    """Request kwargs for client.beta.messages.stream, plus whether fast mode applies."""
    spec = llm_spec(model)
    output_config: dict[str, Any] = {"effort": effort}
    if output_format is not None:
        output_config["format"] = output_format
    params: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
        "output_config": output_config,
        "cache_control": {"type": "ephemeral"},
    }
    if system:
        params["system"] = system
    if tools:
        params["tools"] = tools
    if spec.fallbacks:
        params["fallbacks"] = "default"
        params["betas"] = [FALLBACK_BETA]
    return params, spec.fast


async def _stream_once(c: AsyncAnthropic, params: dict, handler: StreamHandler | None):
    async with c.beta.messages.stream(**params) as stream:
        async for event in stream:
            if handler is None:
                continue
            if event.type == "content_block_start":
                handler.on_block_start(event.index, event.content_block.type)
            elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                handler.on_text(event.index, event.delta.text)
        return await stream.get_final_message()


async def stream_message(params: dict, handler: StreamHandler | None, *, use_fast: bool):
    """Stream one model response, feeding text deltas to `handler`. Returns the final message."""
    global _fast_paused_until
    model = params.get("model")
    try:
        if use_fast and time.monotonic() >= _fast_paused_until:
            try:
                # No SDK retries here: a 429 should drop to standard speed immediately.
                return await _stream_once(client().with_options(max_retries=0), {**params, "speed": "fast"}, handler)
            except anthropic.RateLimitError:
                _fast_paused_until = time.monotonic() + FAST_COOLDOWN_SECONDS
                log.warning("fast mode rate-limited; using standard speed for %ss", FAST_COOLDOWN_SECONDS)
        return await _stream_once(client(), params, handler)
    except anthropic.AuthenticationError as e:
        log.error("Anthropic rejected the API key (401)")
        raise LLMError("The AI service rejected the API key. Check ANTHROPIC_API_KEY.", status=401) from e
    except anthropic.PermissionDeniedError as e:
        raise LLMError("The AI service refused this API key (permission denied).", status=403) from e
    except anthropic.NotFoundError as e:
        raise LLMError(f"Model '{model}' was not found. Pick another model in Settings.", status=404) from e
    except anthropic.BadRequestError as e:
        log.error("Claude rejected the request: %s", e.message)
        raise LLMError("The AI service rejected the request.", status=400) from e
    except anthropic.RateLimitError as e:
        raise LLMError("The AI service is busy right now. Please try again in a moment.", status=429) from e
    except anthropic.APIStatusError as e:
        log.error("Claude API error %s: %s", e.status_code, e.message)
        raise LLMError("The AI service is temporarily unavailable.", status=e.status_code) from e
    except anthropic.APIConnectionError as e:
        raise LLMError("Could not reach the AI service. Check the internet connection.") from e


def content_to_dicts(message) -> list[dict]:
    """The assistant turn exactly as returned, ready to replay (thinking blocks included)."""
    return [block.to_dict(mode="json") for block in message.content]


_MODEL_INTERNAL = {"thinking", "redacted_thinking", "tool_use"}


def sanitize_fallback_turn(content: list[dict]) -> list[dict]:
    """After a mid-output fallback, blocks before the last `fallback` block that belong to
    the declined model (thinking, tool_use, unpaired server tool use, unknown internals)
    must not be echoed back. Text and the fallback block itself stay where they are."""
    positions = [i for i, b in enumerate(content) if b.get("type") == "fallback"]
    if not positions:
        return content
    boundary = positions[-1]
    server_results = {
        b.get("tool_use_id") for b in content[:boundary] if str(b.get("type", "")).endswith("_tool_result")
    }
    kept = []
    for i, b in enumerate(content):
        t = b.get("type")
        if i < boundary:
            if t in _MODEL_INTERNAL:
                continue
            if t == "server_tool_use" and b.get("id") not in server_results:
                continue
            if t not in ("text", "fallback", "server_tool_use") and not str(t).endswith("_tool_result"):
                continue
        kept.append(b)
    return kept


async def structured_call(
    *,
    model: str,
    content: list[dict],
    schema: dict,
    system: str | None = None,
    effort: str = "low",
    max_tokens: int = 16000,
) -> dict:
    """One-shot call constrained to a JSON schema (structured outputs). Returns parsed JSON."""
    params, use_fast = build_params(
        model=model,
        system=system,
        messages=[{"role": "user", "content": content}],
        max_tokens=max_tokens,
        effort=effort,
        output_format={"type": "json_schema", "schema": schema},
    )
    message = await stream_message(params, None, use_fast=use_fast)
    if message.stop_reason == "refusal":
        raise LLMError("The AI declined this request.")
    if message.stop_reason == "max_tokens":
        raise LLMError("The response was too long. Try a smaller file or fewer pages.")
    text = "".join(b.text for b in message.content if b.type == "text")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.error("structured output was not valid JSON: %r", text[:300])
        raise LLMError("The AI returned an unreadable answer. Please try again.") from e
