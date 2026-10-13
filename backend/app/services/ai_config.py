import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import ConfigError
from app.models import APIConfiguration, ProviderCredential
from app.providers.llm.base import LLMProvider
from app.providers.llm.factory import PROVIDERS, build_llm, platform_api_key
from app.security.crypto import CryptoError, decrypt_secret


@dataclass
class ResolvedAI:
    provider: LLMProvider
    provider_name: str
    model: str
    temperature: float
    max_tokens: int
    instructions: str | None
    credential_source: str  # platform | byok


async def get_or_create_config(db: AsyncSession, workspace_id: uuid.UUID) -> APIConfiguration:
    cfg = (await db.execute(select(APIConfiguration).where(APIConfiguration.workspace_id == workspace_id))
           ).scalar_one_or_none()
    if not cfg:
        cfg = APIConfiguration(workspace_id=workspace_id)
        db.add(cfg)
        await db.flush()
    return cfg


def effective_provider_model(cfg: APIConfiguration, provider: str | None = None,
                             model: str | None = None) -> tuple[str, str | None]:
    name = provider or cfg.llm_provider or settings.llm_provider
    chosen = model or (cfg.llm_model if (cfg.llm_provider or settings.llm_provider) == name else None)
    if not chosen and name == settings.llm_provider:
        chosen = settings.llm_model or None  # env default only applies to the env default provider
    return name, chosen


async def resolve_api_key(db: AsyncSession, cfg: APIConfiguration, provider: str) -> tuple[str, str]:
    """Returns (key, source). BYOK never silently falls back to the platform key."""
    if cfg.credential_mode == "byok":
        cred = (await db.execute(select(ProviderCredential).where(
            ProviderCredential.workspace_id == cfg.workspace_id,
            ProviderCredential.provider == provider))).scalar_one_or_none()
        if not cred:
            raise ConfigError(f"No API key is saved for '{provider}'. Add one in AI Configuration.")
        try:
            return decrypt_secret(cred.encrypted_key), "byok"
        except CryptoError:
            raise ConfigError("The saved API key could not be decrypted. Please re-enter it.") from None
    key = platform_api_key(provider)
    if not key:
        raise ConfigError(f"The platform has no API key configured for '{provider}'.")
    return key, "platform"


async def resolve_ai(db: AsyncSession, workspace_id: uuid.UUID, override_provider: str | None = None,
                     override_model: str | None = None) -> ResolvedAI:
    cfg = await get_or_create_config(db, workspace_id)
    provider, model = effective_provider_model(cfg, override_provider, override_model)
    if provider not in PROVIDERS:
        raise ConfigError(f"Unsupported AI provider '{provider}'.")
    if not model:
        raise ConfigError("No model is selected. Choose one in AI Configuration.")
    key, source = await resolve_api_key(db, cfg, provider)
    return ResolvedAI(provider=build_llm(provider, key), provider_name=provider, model=model,
                      temperature=cfg.temperature, max_tokens=cfg.max_tokens,
                      instructions=cfg.system_instructions, credential_source=source)
