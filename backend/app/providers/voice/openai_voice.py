import httpx

from app.core.errors import ConfigError
from app.providers.llm.base import ProviderError, map_http_error
from app.providers.voice.base import STTProvider, TTSProvider

BASE = "https://api.openai.com/v1"


class OpenAISTT(STTProvider):
    def __init__(self, api_key: str, model: str, transport: httpx.AsyncBaseTransport | None = None):
        if not model:
            raise ConfigError("Voice input is not configured (STT_MODEL).")
        self._key, self._model, self._transport = api_key, model, transport

    async def transcribe(self, audio: bytes, mime_type: str) -> str:
        ext = "webm" if "webm" in mime_type else "mp4" if "mp4" in mime_type else "ogg" if "ogg" in mime_type else "wav"
        try:
            async with httpx.AsyncClient(timeout=60, transport=self._transport) as c:
                r = await c.post(f"{BASE}/audio/transcriptions", headers={"Authorization": f"Bearer {self._key}"},
                                 data={"model": self._model}, files={"file": (f"audio.{ext}", audio, mime_type)})
        except httpx.HTTPError as exc:
            raise ProviderError("Voice input is temporarily unavailable.", str(exc), True) from exc
        if r.status_code >= 400:
            raise map_http_error("openai-stt", r.status_code, r.text)
        return (r.json().get("text") or "").strip()


class OpenAITTS(TTSProvider):
    def __init__(self, api_key: str, model: str, voice: str, transport: httpx.AsyncBaseTransport | None = None):
        if not model:
            raise ConfigError("Voice output is not configured (TTS_MODEL).")
        self._key, self._model, self._voice, self._transport = api_key, model, voice, transport

    async def synthesize(self, text: str) -> tuple[bytes, str]:
        try:
            async with httpx.AsyncClient(timeout=60, transport=self._transport) as c:
                r = await c.post(f"{BASE}/audio/speech", headers={"Authorization": f"Bearer {self._key}"},
                                 json={"model": self._model, "input": text, "voice": self._voice,
                                       "response_format": "mp3"})
        except httpx.HTTPError as exc:
            raise ProviderError("Voice output is temporarily unavailable.", str(exc), True) from exc
        if r.status_code >= 400:
            raise map_http_error("openai-tts", r.status_code, r.text)
        return r.content, "audio/mpeg"
