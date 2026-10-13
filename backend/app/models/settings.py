import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk
from sqlalchemy import DateTime, func
from datetime import datetime


class APIConfiguration(TimestampMixin, Base):
    """Per-workspace AI settings. Null provider/model => fall back to platform defaults from env."""
    __tablename__ = "api_configurations"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True)
    credential_mode: Mapped[str] = mapped_column(String(16), default="platform")  # platform | byok
    llm_provider: Mapped[str | None] = mapped_column(String(32))
    llm_model: Mapped[str | None] = mapped_column(String(128))
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_tokens: Mapped[int] = mapped_column(Integer, default=800)
    system_instructions: Mapped[str | None] = mapped_column(Text)


class ProviderCredential(TimestampMixin, Base):
    """Customer-supplied API key, Fernet-encrypted. Never returned by any API."""
    __tablename__ = "provider_credentials"
    __table_args__ = (UniqueConstraint("workspace_id", "provider"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    encrypted_key: Mapped[str] = mapped_column(Text)
    key_hint: Mapped[str] = mapped_column(String(16))


class WidgetConfiguration(TimestampMixin, Base):
    __tablename__ = "widget_configurations"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True)
    brand_name: Mapped[str] = mapped_column(String(120), default="Assistant")
    welcome_message: Mapped[str] = mapped_column(Text, default="Hi! How can I help you today?")
    theme: Mapped[str] = mapped_column(String(16), default="light")
    position: Mapped[str] = mapped_column(String(16), default="bottom-right")
    logo_url: Mapped[str | None] = mapped_column(String(1024))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    primary_color: Mapped[str] = mapped_column(String(9), default="#4f46e5")
    suggested_questions: Mapped[list] = mapped_column(JSONB, default=list)
    voice_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    lead_capture_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    allowed_origins: Mapped[list] = mapped_column(JSONB, default=list)


class UsageRecord(Base):
    __tablename__ = "usage_records"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(32), index=True)  # message | tokens_in | tokens_out | document | storage_bytes | voice_seconds
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
