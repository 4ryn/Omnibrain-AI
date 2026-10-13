from abc import ABC, abstractmethod


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio: bytes, mime_type: str) -> str: ...


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> tuple[bytes, str]:
        """Returns (audio bytes, mime type)."""


class RealtimeVoiceProvider(ABC):
    """Interface for low-latency speech-to-speech sessions (e.g. WebRTC/WebSocket vendors).
    No implementation ships yet: add one by subclassing and registering it in voice/factory.py."""

    @abstractmethod
    async def create_client_session(self, instructions: str) -> dict:
        """Return short-lived client credentials/session info. Must never expose long-lived API keys."""
