import json
from collections.abc import AsyncIterator

import httpx

from app.providers.llm.base import (LLMProvider, LLMRequest, LLMResult, ProviderError, StreamChunk,
                                    map_http_error)


class OpenAICompatibleProvider(LLMProvider):
    """Chat Completions wire format shared by OpenAI and xAI (Groq)."""
    base_url: str
    max_tokens_field = "max_completion_tokens"
    send_stream_usage = True

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    def _body(self, req: LLMRequest, stream: bool) -> dict:
        body = {"model": req.model, "temperature": req.temperature, self.max_tokens_field: req.max_tokens,
                "messages": [{"role": m.role, "content": m.content} for m in req.messages], **req.extra}
        if stream:
            body["stream"] = True
            if self.send_stream_usage:
                body["stream_options"] = {"include_usage": True}
        return body

    async def generate(self, request: LLMRequest) -> LLMResult:
        data = await self._post_json(f"{self.base_url}/chat/completions", self._headers(), self._body(request, False))
        try:
            choice = data["choices"][0]
            usage = data.get("usage") or {}
            return LLMResult(text=choice["message"].get("content") or "",
                             tokens_in=usage.get("prompt_tokens", 0), tokens_out=usage.get("completion_tokens", 0),
                             model=data.get("model", request.model), raw_finish_reason=choice.get("finish_reason"))
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("The AI provider returned an unexpected response.", repr(exc)) from exc

    async def stream(self, request: LLMRequest) -> AsyncIterator[StreamChunk]:
        async for _, data in self._stream_sse(f"{self.base_url}/chat/completions", self._headers(),
                                              self._body(request, True)):
            if data.strip() == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except ValueError:
                continue
            if obj.get("error"):
                raise ProviderError("The AI provider interrupted the response.", str(obj["error"])[:300], True)
            if obj.get("usage"):
                u = obj["usage"]
                yield StreamChunk(tokens_in=u.get("prompt_tokens"), tokens_out=u.get("completion_tokens"))
            for ch in obj.get("choices") or []:
                piece = (ch.get("delta") or {}).get("content")
                if piece:
                    yield StreamChunk(text=piece)
                if ch.get("finish_reason"):
                    yield StreamChunk(finish_reason=ch["finish_reason"])

    async def validate_credentials(self) -> bool:
        try:
            async with self._client() as client:
                r = await client.get(f"{self.base_url}/models", headers=self._headers())
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach the AI provider to verify the key.", str(exc), True) from exc
        if r.status_code in (401, 403):
            return False
        if r.status_code >= 400:
            raise map_http_error(self.name, r.status_code, r.text)
        return True


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"
    base_url = "https://api.openai.com/v1"


class GroqProvider(OpenAICompatibleProvider):
    name = "groq"
    base_url = "https://api.groq.com/openai/v1"
    max_tokens_field = "max_tokens"
    send_stream_usage = False
