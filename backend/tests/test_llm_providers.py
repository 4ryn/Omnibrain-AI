import json

import httpx
import pytest

from app.providers.llm.anthropic_provider import AnthropicProvider, split_messages
from app.providers.llm.base import ChatMessage, LLMRequest, ProviderError
from app.providers.llm.factory import PROVIDERS, build_llm
from app.providers.llm.openai_compat import GroqProvider, OpenAIProvider

KEY = "sk-secret-key-value-123456"
REQ = LLMRequest(messages=[ChatMessage("system", "rules"), ChatMessage("user", "hi")], model="m1", max_tokens=50)


def transport(handler):
    return httpx.MockTransport(handler)


def sse(*events: tuple[str, dict | str]) -> bytes:
    out = ""
    for name, data in events:
        out += (f"event: {name}\n" if name else "") + "data: " + (data if isinstance(data, str) else json.dumps(data)) + "\n\n"
    return out.encode()


async def test_registry_supports_three_providers_and_factory():
    assert {"openai", "groq", "anthropic"} <= set(PROVIDERS)
    assert isinstance(build_llm("groq", "k"), GroqProvider)


async def test_openai_generate_parses_text_and_usage():
    seen = {}

    def handler(request):
        seen["auth"], seen["body"] = request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json={"model": "m1", "choices": [{"message": {"content": "Hello"}, "finish_reason": "stop"}],
                                         "usage": {"prompt_tokens": 7, "completion_tokens": 2}})
    out = await OpenAIProvider(KEY, transport=transport(handler)).generate(REQ)
    assert (out.text, out.tokens_in, out.tokens_out) == ("Hello", 7, 2)
    assert seen["auth"] == f"Bearer {KEY}" and seen["body"]["max_completion_tokens"] == 50


async def test_groq_uses_groq_endpoint_and_max_tokens_field():
    seen = {}

    def handler(request):
        seen["url"], seen["body"] = str(request.url), json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    await GroqProvider(KEY, transport=transport(handler)).generate(REQ)
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions" and seen["body"]["max_tokens"] == 50


async def test_openai_stream_yields_deltas_and_usage():
    body = sse(("", {"choices": [{"delta": {"content": "Hel"}}]}), ("", {"choices": [{"delta": {"content": "lo"}}]}),
               ("", {"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 2}}), ("", "[DONE]"))
    prov = OpenAIProvider(KEY, transport=transport(lambda r: httpx.Response(200, content=body)))
    chunks = [c async for c in prov.stream(REQ)]
    assert "".join(c.text for c in chunks) == "Hello"
    assert any(c.tokens_in == 5 and c.tokens_out == 2 for c in chunks)


async def test_anthropic_generate_extracts_system_and_merges_roles():
    seen = {}

    def handler(request):
        seen["h"], seen["b"] = request.headers, json.loads(request.content)
        return httpx.Response(200, json={"model": "m1", "content": [{"type": "text", "text": "Hi there"}],
                                         "usage": {"input_tokens": 9, "output_tokens": 4}, "stop_reason": "end_turn"})
    req = LLMRequest(messages=[ChatMessage("system", "rules"), ChatMessage("assistant", "stale"),
                               ChatMessage("user", "a"), ChatMessage("user", "b")], model="m1")
    out = await AnthropicProvider(KEY, transport=transport(handler)).generate(req)
    assert out.text == "Hi there" and (out.tokens_in, out.tokens_out) == (9, 4)
    assert seen["h"]["x-api-key"] == KEY and seen["h"]["anthropic-version"]
    assert seen["b"]["system"] == "rules" and seen["b"]["messages"] == [{"role": "user", "content": "a\n\nb"}]


def test_split_messages_never_starts_with_assistant():
    _, turns = split_messages([ChatMessage("assistant", "x"), ChatMessage("user", "y")])
    assert turns == [{"role": "user", "content": "y"}]


async def test_anthropic_stream_events():
    body = sse(("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": 11}}}),
               ("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}}),
               ("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "!"}}),
               ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}}),
               ("message_stop", {"type": "message_stop"}))
    prov = AnthropicProvider(KEY, transport=transport(lambda r: httpx.Response(200, content=body)))
    chunks = [c async for c in prov.stream(REQ)]
    assert "".join(c.text for c in chunks) == "Hi!"
    assert chunks[0].tokens_in == 11 and chunks[-1].tokens_out == 3


async def test_anthropic_stream_error_event_becomes_provider_error():
    body = sse(("error", {"type": "error", "error": {"type": "overloaded_error"}}))
    prov = AnthropicProvider(KEY, transport=transport(lambda r: httpx.Response(200, content=body)))
    with pytest.raises(ProviderError):
        _ = [c async for c in prov.stream(REQ)]


@pytest.mark.parametrize("cls", [OpenAIProvider, GroqProvider, AnthropicProvider])
async def test_invalid_credentials_error_is_safe_and_validate_returns_false(cls):
    prov = cls(KEY, transport=transport(lambda r: httpx.Response(401, json={"error": f"bad key {KEY}"})))
    with pytest.raises(ProviderError) as e:
        await prov.generate(REQ)
    assert "credentials" in e.value.user_message and KEY not in e.value.user_message
    assert KEY not in e.value.detail and not e.value.retryable
    assert await prov.validate_credentials() is False


async def test_unknown_model_is_reported_clearly():
    prov = OpenAIProvider(KEY, transport=transport(lambda r: httpx.Response(404, json={"error": "model not found"})))
    with pytest.raises(ProviderError) as e:
        await prov.generate(REQ)
    assert "model" in e.value.user_message.lower()


async def test_rate_limit_and_server_errors_retry_once_then_fail(monkeypatch):
    async def no_sleep(_): return None
    monkeypatch.setattr("app.providers.llm.base.asyncio.sleep", no_sleep)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429 if calls["n"] == 1 else 503)
    with pytest.raises(ProviderError) as e:
        await OpenAIProvider(KEY, transport=transport(handler)).generate(REQ)
    assert calls["n"] == 2 and e.value.retryable


async def test_transient_error_then_success(monkeypatch):
    async def no_sleep(_): return None
    monkeypatch.setattr("app.providers.llm.base.asyncio.sleep", no_sleep)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    assert (await OpenAIProvider(KEY, transport=transport(handler)).generate(REQ)).text == "ok"


async def test_malformed_provider_response():
    prov = OpenAIProvider(KEY, transport=transport(lambda r: httpx.Response(200, json={"nope": 1})))
    with pytest.raises(ProviderError):
        await prov.generate(REQ)


def test_provider_repr_never_leaks_key():
    assert KEY not in repr(OpenAIProvider(KEY))
