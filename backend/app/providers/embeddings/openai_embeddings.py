import asyncio
import logging

import httpx

from app.core.errors import ConfigError, EmbeddingError
from app.providers.embeddings.base import EmbeddingProvider

log = logging.getLogger(__name__)
BATCH = 64


class OpenAIEmbeddings(EmbeddingProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, dimensions: int, base_url: str = "https://api.openai.com/v1"):
        if not api_key:
            raise ConfigError("Embedding provider is not configured (missing API key).")
        if not model:
            raise ConfigError("EMBEDDING_MODEL is not configured.")
        self._key, self.model, self.dimensions, self._base = api_key, model, dimensions, base_url

    async def _call(self, inputs: list[str]) -> list[list[float]]:
        last: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    r = await client.post(f"{self._base}/embeddings",
                                          headers={"Authorization": f"Bearer {self._key}"},
                                          json={"model": self.model, "input": inputs})
                if r.status_code in (429, 500, 502, 503, 504):
                    last = RuntimeError(f"embedding HTTP {r.status_code}")
                    await asyncio.sleep(2 ** attempt)
                    continue
                if r.status_code in (401, 403):
                    raise EmbeddingError("The embedding provider rejected the configured credentials.")
                r.raise_for_status()
                rows = sorted(r.json()["data"], key=lambda d: d["index"])
                vectors = [d["embedding"] for d in rows]
                if vectors and len(vectors[0]) != self.dimensions:
                    raise ConfigError(
                        f"EMBEDDING_DIMENSIONS={self.dimensions} but the model returned {len(vectors[0])}.")
                return vectors
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                last = exc
                await asyncio.sleep(2 ** attempt)
        log.error("Embedding request failed: %s", last)
        raise EmbeddingError("The embedding service is temporarily unavailable. Please retry.")

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), BATCH):
            out.extend(await self._call(texts[i:i + BATCH]))
        return out

    async def embed_query(self, text: str) -> list[float]:
        return (await self._call([text]))[0]
