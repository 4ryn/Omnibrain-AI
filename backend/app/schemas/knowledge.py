import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime


class URLSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    url: str
    title: str | None
    status: str
    error: str | None
    chunk_count: int
    last_crawled_at: datetime | None
    created_at: datetime


class URLCreate(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)


class SearchHitOut(BaseModel):
    content: str
    score: float
    source_id: str
    source_name: str
    source_type: str
    url: str | None


class SearchResponse(BaseModel):
    confidence: str
    hits: list[SearchHitOut]
