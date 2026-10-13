import asyncio

from app.core.errors import ConfigError
from app.providers.vectorstores.base import VectorHit, VectorRecord, VectorStore


class PineconeVectorStore(VectorStore):
    """One Pinecone namespace per workspace => hard tenant isolation at the index level.

    Note: serverless indexes cannot delete by metadata filter; callers delete by ids.
    """

    def __init__(self, api_key: str, index_name: str, client=None):
        if not api_key or not index_name:
            raise ConfigError("PINECONE_API_KEY and PINECONE_INDEX must be set for VECTOR_STORE=pinecone.")
        if client is None:
            from pinecone import Pinecone
            client = Pinecone(api_key=api_key)
        self._pc = client           # injectable for tests
        self._name = index_name
        self._index = self._pc.Index(index_name)

    async def ensure_ready(self, dimensions: int) -> None:
        desc = await asyncio.to_thread(self._pc.describe_index, self._name)
        if int(desc.dimension) != int(dimensions):
            raise ConfigError(f"Pinecone index dimension {desc.dimension} != EMBEDDING_DIMENSIONS {dimensions}.")

    async def healthcheck(self) -> None:
        await asyncio.to_thread(self._pc.describe_index, self._name)

    async def upsert(self, workspace_id: str, records: list[VectorRecord]) -> None:
        def clean(p: dict) -> dict:
            return {k: v for k, v in {**p, "workspace_id": workspace_id}.items() if v is not None}
        vecs = [{"id": r.id, "values": r.vector, "metadata": clean(r.payload)} for r in records]
        for i in range(0, len(vecs), 100):
            await asyncio.to_thread(self._index.upsert, vectors=vecs[i:i + 100], namespace=workspace_id)

    async def search(self, workspace_id, vector, top_k=5, filters=None) -> list[VectorHit]:
        res = await asyncio.to_thread(
            self._index.query, vector=vector, top_k=top_k, namespace=workspace_id,
            filter=filters or None, include_metadata=True)
        return [VectorHit(id=m.id, score=float(m.score), payload=dict(m.metadata or {})) for m in res.matches]

    async def delete(self, workspace_id, ids=None, filters=None) -> None:
        if filters:
            raise NotImplementedError("Pinecone serverless cannot delete by metadata filter; pass ids.")
        if ids:
            for i in range(0, len(ids), 1000):
                await asyncio.to_thread(self._index.delete, ids=ids[i:i + 1000], namespace=workspace_id)
        else:
            await asyncio.to_thread(self._index.delete, delete_all=True, namespace=workspace_id)
