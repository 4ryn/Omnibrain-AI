from typing import Literal

from pydantic import BaseModel, Field


class CredentialOut(BaseModel):
    provider: str
    key_hint: str


class AIConfigOut(BaseModel):
    credential_mode: str
    llm_provider: str | None
    llm_model: str | None
    temperature: float
    max_tokens: int
    system_instructions: str | None
    effective_provider: str
    effective_model: str | None
    available_providers: list[str]
    platform_providers: list[str]
    credentials: list[CredentialOut]


class AIConfigUpdate(BaseModel):
    credential_mode: Literal["platform", "byok"] | None = None
    llm_provider: str | None = Field(default=None, max_length=32)
    llm_model: str | None = Field(default=None, max_length=128)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=4096)
    system_instructions: str | None = Field(default=None, max_length=2000)


class CredentialIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)
