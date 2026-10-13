from functools import lru_cache

from app.core.config import settings
from app.core.errors import ConfigError
from app.providers.embeddings.base import EmbeddingProvider


def build_embedder() -> EmbeddingProvider:
    name = settings.embedding_provider.lower()
    if name == "openai":
        from app.providers.embeddings.openai_embeddings import OpenAIEmbeddings
        return OpenAIEmbeddings(settings.openai_api_key, settings.embedding_model, settings.embedding_dimensions)
    if name == "local":
        from app.providers.embeddings.local_embeddings import LocalEmbeddings
        return LocalEmbeddings(settings.embedding_model, settings.embedding_dimensions)
    raise ConfigError(f"Unknown EMBEDDING_PROVIDER '{settings.embedding_provider}'.")


@lru_cache
def get_embedder() -> EmbeddingProvider:
    return build_embedder()
