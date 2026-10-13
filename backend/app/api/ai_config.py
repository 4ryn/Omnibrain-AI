import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models import ProviderCredential, Workspace
from app.providers.llm.base import ProviderError
from app.providers.llm.factory import PROVIDERS, build_llm, platform_api_key
from app.schemas.ai_config import AIConfigOut, AIConfigUpdate, CredentialIn, CredentialOut
from app.security.crypto import CryptoError, encrypt_secret, key_hint
from app.services.ai_config import effective_provider_model, get_or_create_config

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai-config", tags=["ai-config"], dependencies=[Depends(require_csrf)])


async def _out(db: AsyncSession, ws: Workspace) -> AIConfigOut:
    cfg = await get_or_create_config(db, ws.id)
    creds = (await db.execute(select(ProviderCredential).where(ProviderCredential.workspace_id == ws.id)
                              .order_by(ProviderCredential.provider))).scalars().all()
    provider, model = effective_provider_model(cfg)
    return AIConfigOut(
        credential_mode=cfg.credential_mode, llm_provider=cfg.llm_provider, llm_model=cfg.llm_model,
        temperature=cfg.temperature, max_tokens=cfg.max_tokens, system_instructions=cfg.system_instructions,
        effective_provider=provider, effective_model=model, available_providers=sorted(PROVIDERS),
        platform_providers=sorted(p for p in PROVIDERS if platform_api_key(p)),
        credentials=[CredentialOut(provider=c.provider, key_hint=c.key_hint) for c in creds])  # never the key


@router.get("", response_model=AIConfigOut)
async def get_config(ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return await _out(db, ws)


@router.put("", response_model=AIConfigOut, dependencies=[Depends(require_admin)])
async def update_config(body: AIConfigUpdate, ws: Workspace = Depends(get_current_workspace),
                        db: AsyncSession = Depends(get_db)):
    cfg = await get_or_create_config(db, ws.id)
    changes = {k: getattr(body, k) for k in body.model_fields_set}
    if changes.get("llm_provider") and changes["llm_provider"] not in PROVIDERS:
        raise HTTPException(400, f"Unsupported provider. Available: {', '.join(sorted(PROVIDERS))}")
    if "llm_provider" in changes and changes["llm_provider"] != cfg.llm_provider and "llm_model" not in changes:
        changes["llm_model"] = None  # a model name is only meaningful for its own provider
    for field in ("temperature", "max_tokens"):
        if field in changes and changes[field] is None:
            changes.pop(field)
    for k, v in changes.items():
        setattr(cfg, k, v)
    await db.flush()
    return await _out(db, ws)


@router.put("/credentials/{provider}", response_model=CredentialOut, dependencies=[Depends(require_admin)])
async def save_credential(provider: str, body: CredentialIn, ws: Workspace = Depends(get_current_workspace),
                          db: AsyncSession = Depends(get_db)):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    key = body.api_key.strip()
    try:
        accepted = await build_llm(provider, key).validate_credentials()
    except ProviderError as exc:
        log.warning("Credential validation could not complete: %s", exc.detail)
        raise HTTPException(502, exc.user_message)
    if not accepted:
        raise HTTPException(400, "The provider rejected this API key.")
    try:
        encrypted = encrypt_secret(key)
    except CryptoError:
        raise HTTPException(503, "Secure credential storage is not configured on this server.")
    row = (await db.execute(select(ProviderCredential).where(
        ProviderCredential.workspace_id == ws.id, ProviderCredential.provider == provider))).scalar_one_or_none()
    if row:
        row.encrypted_key, row.key_hint = encrypted, key_hint(key)
    else:
        row = ProviderCredential(workspace_id=ws.id, provider=provider, encrypted_key=encrypted, key_hint=key_hint(key))
        db.add(row)
    await db.flush()
    return CredentialOut(provider=provider, key_hint=row.key_hint)


@router.delete("/credentials/{provider}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_credential(provider: str, ws: Workspace = Depends(get_current_workspace),
                            db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ProviderCredential).where(
        ProviderCredential.workspace_id == ws.id, ProviderCredential.provider == provider))
