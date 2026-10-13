from dataclasses import dataclass, field
from enum import Enum


class Confidence(str, Enum):
    known = "known"
    partial = "partial"
    unknown = "unknown"


@dataclass
class RetrievedChunk:
    chunk_id: str
    content: str
    score: float
    source_type: str
    source_id: str
    source_name: str
    url: str | None = None
    chunk_index: int = 0


@dataclass
class RetrievalResult:
    question: str
    chunks: list[RetrievedChunk] = field(default_factory=list)
    confidence: Confidence = Confidence.unknown
    top_score: float = 0.0


@dataclass
class AnswerResult:
    text: str
    confidence: Confidence
    fallback: bool
    sources: list[dict]
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""
