
import logging

import httpx

from app.core.errors import ConfigError, EmbeddingError
from app.providers.embeddings.base import EmbeddingProvider

log = logging.getLogger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
BATCH_SIZE = 8


class GeminiEmbeddings(EmbeddingProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, dimensions: int):
        if not api_key:
            raise ConfigError("GEMINI_API_KEY is not configured.")
        if not model:
            raise ConfigError("EMBEDDING_MODEL is not configured.")
        if dimensions <= 0:
            raise ConfigError("EMBEDDING_DIMENSIONS must be positive.")

        self.api_key = api_key
        self.model = model.removeprefix("models/")
        self.dimensions = dimensions

    async def _embed_batch(
        self,
        client: httpx.AsyncClient,
        texts: list[str],
        task_type: str,
    ) -> list[list[float]]:
        if not texts:
            return []

        requests = [
            {
                "model": f"models/{self.model}",
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": self.dimensions,
                "taskType": task_type,
            }
            for text in texts
        ]

        try:
            response = await client.post(
                f"{API_URL}/{self.model}:batchEmbedContents",
                headers={
                    "x-goog-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json={"requests": requests},
            )

            if response.status_code in (401, 403):
                raise EmbeddingError(
                    "Gemini rejected the configured API credentials."
                )

            if response.status_code == 429 or response.status_code >= 500:
                raise EmbeddingError(
                    f"Gemini embedding service returned HTTP "
                    f"{response.status_code}."
                )

            response.raise_for_status()
            rows = response.json()["embeddings"]
            vectors = [row["values"] for row in rows]

        except EmbeddingError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            log.exception("Gemini embedding request failed")
            raise EmbeddingError(
                "Could not generate embeddings with Gemini. Please retry."
            ) from exc

        if len(vectors) != len(texts):
            raise EmbeddingError("Gemini returned an unexpected vector count.")

        if any(len(v) != self.dimensions for v in vectors):
            raise EmbeddingError(
                "Gemini returned vectors with unexpected dimensions."
            )

        return vectors

    async def embed_documents(
        self, texts: list[str]
    ) -> list[list[float]]:
        output = []

        async with httpx.AsyncClient(timeout=60) as client:
            for start in range(0, len(texts), BATCH_SIZE):
                batch = texts[start:start + BATCH_SIZE]
                output.extend(
                    await self._embed_batch(
                        client, batch, "RETRIEVAL_DOCUMENT"
                    )
                )

        return output

    async def embed_query(self, text: str) -> list[float]:
        async with httpx.AsyncClient(timeout=60) as client:
            vectors = await self._embed_batch(
                client, [text], "RETRIEVAL_QUERY"
            )

        return vectors[0]
