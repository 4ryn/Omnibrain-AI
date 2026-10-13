import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

from app.core.logging import _SECRET_PATTERNS
from app.providers.llm.sse import iter_sse

log = logging.getLogger(__name__)


class ProviderError(Exception):
    """Normalised provider failure. `user_message` is safe to show; `detail` is for server logs only."""
    def __init__(self, user_message: str, detail: str = "", retryable: bool = False):
        super().__init__(user_message)
        self.user_message, self.detail, self.retryable = user_message, detail, retryable


@dataclass
class ChatMessage:
    role: str  # system | user | assistant
    content: str


@dataclass
class LLMResult:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""
    raw_finish_reason: str | None = None


@dataclass
class StreamChunk:
    text: str = ""
    tokens_in: int | None = None
    tokens_out: int | None = None
    finish_reason: str | None = None


@dataclass
class LLMRequest:
    messages: list[ChatMessage]
    model: str
    temperature: float = 0.2
    max_tokens: int = 800
    extra: dict = field(default_factory=dict)


def _redact(text: str) -> str:
    for pat in _SECRET_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def map_http_error(provider: str, status: int, body: str) -> ProviderError:
    detail = f"{provider} HTTP {status}: {_redact(body[:500])}"
    lowered = body.lower()
    if status in (401, 403):
        return ProviderError("The AI provider rejected the API credentials. Check your AI Configuration.", detail)
    if status == 404 or (status in (400, 422) and "model" in lowered):
        return ProviderError("The selected model isn't available for this API key. Check your AI Configuration.", detail)
    if status == 429:
        return ProviderError("The AI provider is busy or a usage limit was reached. Please try again shortly.",
                             detail, retryable=True)
    if status >= 500:
        return ProviderError("The AI provider is temporarily unavailable.", detail, retryable=True)
    return ProviderError("The AI provider could not process this request.", detail)


class LLMProvider(ABC):
    name: str

    def __init__(self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None, timeout: float = 60.0):
        self._api_key = api_key  # never log or serialise
        self._transport, self._timeout = transport, timeout

    def __repr__(self) -> str:
        return f"<{type(self).__name__}>"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=httpx.Timeout(self._timeout, connect=10.0), transport=self._transport)

    async def _post_json(self, url: str, headers: dict, body: dict) -> dict:
        last: ProviderError | None = None
        for attempt in range(2):
            try:
                async with self._client() as client:
                    r = await client.post(url, headers=headers, json=body)
                if r.status_code >= 400:
                    raise map_http_error(self.name, r.status_code, r.text)
                return r.json()
            except ProviderError as exc:
                last = exc
                if not exc.retryable:
                    raise
            except httpx.TimeoutException as exc:
                last = ProviderError("The AI provider took too long to respond.", str(exc), retryable=True)
            except httpx.TransportError as exc:
                last = ProviderError("The AI provider could not be reached.", str(exc), retryable=True)
            except ValueError as exc:
                raise ProviderError("The AI provider returned an unexpected response.", str(exc)) from exc
            if attempt == 0:
                await asyncio.sleep(1)
        assert last is not None
        raise last

    async def _stream_sse(self, url: str, headers: dict, body: dict) -> AsyncIterator[tuple[str, str]]:
        try:
            async with self._client() as client:
                async with client.stream("POST", url, headers=headers, json=body) as r:
                    if r.status_code >= 400:
                        await r.aread()
                        raise map_http_error(self.name, r.status_code, r.text)
                    async for event in iter_sse(r):
                        yield event
        except ProviderError:
            raise
        except httpx.TimeoutException as exc:
            raise ProviderError("The AI provider took too long to respond.", str(exc), retryable=True) from exc
        except httpx.TransportError as exc:
            raise ProviderError("The connection to the AI provider was interrupted.", str(exc), retryable=True) from exc

    @abstractmethod
    async def generate(self, request: LLMRequest) -> LLMResult: ...

    @abstractmethod
    def stream(self, request: LLMRequest) -> AsyncIterator[StreamChunk]: ...

    @abstractmethod
    async def validate_credentials(self) -> bool:
        """True if the key is accepted, False if rejected; raises ProviderError if undeterminable."""
