from app.core.config import settings
from app.core.errors import ConfigError
from app.providers.llm.anthropic_provider import AnthropicProvider
from app.providers.llm.base import LLMProvider
from app.providers.llm.openai_compat import GroqProvider, OpenAIProvider

# Adding a provider = one class + one registry entry (+ an optional <NAME>_API_KEY setting).
PROVIDERS: dict[str, type[LLMProvider]] = {
    "openai": OpenAIProvider,
    "groq": GroqProvider,
    "anthropic": AnthropicProvider,
}


def register_provider(name: str, cls: type[LLMProvider]) -> None:
    PROVIDERS[name] = cls


def build_llm(name: str, api_key: str, **kwargs) -> LLMProvider:
    try:
        return PROVIDERS[name](api_key, **kwargs)
    except KeyError:
        raise ConfigError(f"Unsupported AI provider '{name}'.") from None


def platform_api_key(name: str) -> str:
    return getattr(settings, f"{name}_api_key", "") or ""
