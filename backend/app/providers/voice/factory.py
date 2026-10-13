from app.core.config import settings
from app.core.errors import ConfigError
from app.providers.voice.base import STTProvider, TTSProvider


def build_stt(api_key: str) -> STTProvider:
    if settings.stt_provider == "openai":
        from app.providers.voice.openai_voice import OpenAISTT
        return OpenAISTT(api_key, settings.stt_model)
    raise ConfigError(f"Unknown STT_PROVIDER '{settings.stt_provider}'.")


def build_tts(api_key: str) -> TTSProvider:
    if settings.tts_provider == "openai":
        from app.providers.voice.openai_voice import OpenAITTS
        return OpenAITTS(api_key, settings.tts_model, settings.tts_voice)
    raise ConfigError(f"Unknown TTS_PROVIDER '{settings.tts_provider}'.")
