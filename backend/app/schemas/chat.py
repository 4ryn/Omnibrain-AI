import uuid
from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    provider: str | None = Field(default=None, max_length=32)   # playground overrides
    model: str | None = Field(default=None, max_length=128)


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    answer: str
    fallback: bool
    confidence: str
    sources: list[dict[str, Any]]
    provider: str | None
    model: str | None
    latency_ms: int
    retrieval_ms: int


class WidgetChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    source_page: str | None = Field(default=None, max_length=2048)


class WidgetChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    answer: str
    fallback: bool
    sources: list[dict[str, Any]]


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
