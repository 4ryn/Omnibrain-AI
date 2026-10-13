import json
from collections.abc import AsyncIterator

import httpx

from app.providers.llm.base import (ChatMessage, LLMProvider, LLMRequest, LLMResult, ProviderError,
                                    StreamChunk, map_http_error)

API = "https://api.anthropic.com/v1"
VERSION = "2023-06-01"


def split_messages(messages: list[ChatMessage]) -> tuple[str, list[dict]]:
    """Anthropic takes `system` separately and requires alternating roles starting with 'user'."""
    system = "\n\n".join(m.content for m in messages if m.role == "system")
    turns: list[dict] = []
    for m in messages:
        if m.role == "system":
            continue
        if turns and turns[-1]["role"] == m.role:
            turns[-1]["content"] += "\n\n" + m.content
        else:
            turns.append({"role": m.role, "content": m.content})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return system, turns


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def _headers(self) -> dict:
        return {"x-api-key": self._api_key, "anthropic-version": VERSION, "content-type": "application/json"}

    def _body(self, req: LLMRequest, stream: bool) -> dict:
        system, turns = split_messages(req.messages)
        body = {"model": req.model, "max_tokens": req.max_tokens, "temperature": req.temperature,
                "messages": turns, **req.extra}
        if system:
            body["system"] = system
        if stream:
            body["stream"] = True
        return body

    async def generate(self, request: LLMRequest) -> LLMResult:
        data = await self._post_json(f"{API}/messages", self._headers(), self._body(request, False))
        try:
            text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
            u = data.get("usage") or {}
            return LLMResult(text=text, tokens_in=u.get("input_tokens", 0), tokens_out=u.get("output_tokens", 0),
                             model=data.get("model", request.model), raw_finish_reason=data.get("stop_reason"))
        except (KeyError, TypeError) as exc:
            raise ProviderError("The AI provider returned an unexpected response.", repr(exc)) from exc

    async def stream(self, request: LLMRequest) -> AsyncIterator[StreamChunk]:
        async for _, data in self._stream_sse(f"{API}/messages", self._headers(), self._body(request, True)):
            try:
                obj = json.loads(data)
            except ValueError:
                continue
            kind = obj.get("type")
            if kind == "message_start":
                yield StreamChunk(tokens_in=(obj.get("message", {}).get("usage") or {}).get("input_tokens"))
            elif kind == "content_block_delta" and (obj.get("delta") or {}).get("type") == "text_delta":
                yield StreamChunk(text=obj["delta"].get("text", ""))
            elif kind == "message_delta":
                yield StreamChunk(tokens_out=(obj.get("usage") or {}).get("output_tokens"),
                                  finish_reason=(obj.get("delta") or {}).get("stop_reason"))
            elif kind == "error":
                raise ProviderError("The AI provider interrupted the response.", str(obj.get("error"))[:300], True)

    async def validate_credentials(self) -> bool:
        try:
            async with self._client() as client:
                r = await client.get(f"{API}/models", headers=self._headers())
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach the AI provider to verify the key.", str(exc), True) from exc
        if r.status_code in (401, 403):
            return False
        if r.status_code >= 400:
            raise map_http_error(self.name, r.status_code, r.text)
        return True
