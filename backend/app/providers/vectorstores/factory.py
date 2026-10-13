from functools import lru_cache

from app.core.config import settings
from app.core.errors import ConfigError
from app.providers.vectorstores.base import VectorStore


def build_vector_store() -> VectorStore:
    name = settings.vector_store.lower()
    if name == "qdrant":
        from app.providers.vectorstores.qdrant_store import QdrantVectorStore
        return QdrantVectorStore(settings.qdrant_url, settings.qdrant_api_key)
    if name == "pgvector":
        from app.providers.vectorstores.pgvector_store import PgVectorStore
        return PgVectorStore(settings.database_url)
    if name == "pinecone":
        from app.providers.vectorstores.pinecone_store import PineconeVectorStore
        return PineconeVectorStore(settings.pinecone_api_key, settings.pinecone_index)
    raise ConfigError(f"Unknown VECTOR_STORE '{settings.vector_store}'.")


@lru_cache
def get_vector_store() -> VectorStore:
    """Process-wide instance for the API. Workers call build_vector_store() per task (new event loop)."""
    return build_vector_store()
