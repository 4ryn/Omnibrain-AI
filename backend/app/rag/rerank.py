from typing import Protocol

from app.rag.types import RetrievedChunk


class Reranker(Protocol):
    async def rerank(self, query: str, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]: ...


class NoopReranker:
    async def rerank(self, query: str, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        return chunks
