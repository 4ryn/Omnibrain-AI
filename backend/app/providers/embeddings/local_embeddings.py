import asyncio

from app.core.errors import ConfigError
from app.providers.embeddings.base import EmbeddingProvider


class LocalEmbeddings(EmbeddingProvider):
    """sentence-transformers model running in-process (no API key needed)."""
    name = "local"

    def __init__(self, model: str, dimensions: int):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise ConfigError("Install sentence-transformers to use EMBEDDING_PROVIDER=local.") from exc
        if not model:
            raise ConfigError("EMBEDDING_MODEL is not configured.")
        self._model = SentenceTransformer(model)
        self.dimensions = dimensions
        actual = self._model.get_sentence_embedding_dimension()
        if actual != dimensions:
            raise ConfigError(f"EMBEDDING_DIMENSIONS={dimensions} but model outputs {actual}.")

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        arr = await asyncio.to_thread(self._model.encode, texts, normalize_embeddings=True)
        return [list(map(float, v)) for v in arr]

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_documents([text]))[0]
