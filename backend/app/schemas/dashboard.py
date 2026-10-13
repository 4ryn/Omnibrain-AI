import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ORIGIN_RE = re.compile(r"^https?://(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$")
URL_RE = re.compile(r"^https?://[^\s'\"<>]{3,1020}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
PHONE_RE = re.compile(r"^[0-9+()\-.\s]{6,40}$")


class WidgetConfigOut(BaseModel):
    brand_name: str
    welcome_message: str
    theme: str
    position: str
    logo_url: str | None
    avatar_url: str | None
    primary_color: str
    suggested_questions: list[str]
    voice_enabled: bool
    lead_capture_enabled: bool
    allowed_origins: list[str]
    public_id: str
    snippet: str
    warnings: list[str]


class WidgetConfigUpdate(BaseModel):
    brand_name: str | None = Field(default=None, min_length=1, max_length=120)
    welcome_message: str | None = Field(default=None, min_length=1, max_length=500)
    theme: Literal["light", "dark", "auto"] | None = None
    position: Literal["bottom-right", "bottom-left"] | None = None
    logo_url: str | None = None
    avatar_url: str | None = None
    primary_color: str | None = None
    suggested_questions: list[str] | None = Field(default=None, max_length=6)
    voice_enabled: bool | None = None
    lead_capture_enabled: bool | None = None
    allowed_origins: list[str] | None = Field(default=None, max_length=20)

    @field_validator("logo_url", "avatar_url")
    @classmethod
    def _url(cls, v):
        v = (v or "").strip()
        if v and not URL_RE.match(v):
            raise ValueError("Must be a valid http(s) URL")
        return v or None

    @field_validator("primary_color")
    @classmethod
    def _color(cls, v):
        if v is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            raise ValueError("Use a 6-digit hex colour like #4f46e5")
        return v

    @field_validator("suggested_questions")
    @classmethod
    def _questions(cls, v):
        if v is None:
            return v
        out = [q.strip() for q in v if q and q.strip()]
        if any(len(q) > 120 for q in out):
            raise ValueError("Each suggested question must be 120 characters or fewer")
        return out

    @field_validator("allowed_origins")
    @classmethod
    def _origins(cls, v):
        if v is None:
            return v
        out = []
        for o in v:
            o = o.strip().rstrip("/").lower()
            if not ORIGIN_RE.match(o):
                raise ValueError(f"'{o}' is not a valid origin. Use e.g. https://example.com or https://*.example.com")
            if o not in out:
                out.append(o)
        return out


class ConversationOut(BaseModel):
    id: uuid.UUID
    channel: str
    visitor_id: str | None
    source_page: str | None
    created_at: datetime
    last_activity: datetime | None
    message_count: int
    had_fallback: bool
    preview: str | None


class ConversationList(BaseModel):
    total: int
    items: list[ConversationOut]


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    was_fallback: bool
    provider: str | None
    model: str | None
    tokens_in: int
    tokens_out: int
    latency_ms: int | None
    created_at: datetime


class ConversationDetail(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]


class LeadOut(BaseModel):
    id: uuid.UUID
    name: str | None
    email: str | None
    phone: str | None
    question: str | None
    source_page: str | None
    conversation_id: uuid.UUID | None
    created_at: datetime


class LeadList(BaseModel):
    total: int
    items: list[LeadOut]


class LeadCreate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=40)
    question: str | None = Field(default=None, max_length=1000)
    conversation_id: uuid.UUID | None = None
    source_page: str | None = Field(default=None, max_length=2048)

    @field_validator("name", "email", "phone", "question")
    @classmethod
    def _strip(cls, v):
        v = (v or "").strip()
        return v or None

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        if v and not EMAIL_RE.match(v):
            raise ValueError("Please enter a valid email address")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        if v and not PHONE_RE.match(v):
            raise ValueError("Please enter a valid phone number")
        return v

    @model_validator(mode="after")
    def _need_contact(self):
        if not self.email and not self.phone:
            raise ValueError("Please provide an email address or phone number")
        return self


class UnansweredOut(BaseModel):
    id: uuid.UUID
    question: str
    frequency: int
    last_asked_at: datetime
    status: str
    knowledge_gap: str
    potential_action: str
    priority: Literal["high", "medium", "low"]


class UnansweredList(BaseModel):
    total: int
    items: list[UnansweredOut]


class UnansweredUpdate(BaseModel):
    status: Literal["open", "resolved", "ignored"]


class ClosestHit(BaseModel):
    source_name: str
    url: str | None
    score: float
    excerpt: str


class WorkspaceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
