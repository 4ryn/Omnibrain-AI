from qdrant_client import AsyncQdrantClient
from qdrant_client import models as qm

from app.providers.vectorstores.base import VectorHit, VectorRecord, VectorStore

COLLECTION = "omnibrain_chunks"


def _filter(workspace_id: str, filters: dict | None = None, ids: list[str] | None = None) -> qm.Filter:
    must: list = [qm.FieldCondition(key="workspace_id", match=qm.MatchValue(value=workspace_id))]
    for k, v in (filters or {}).items():
        must.append(qm.FieldCondition(key=k, match=qm.MatchValue(value=v)))
    if ids:
        must.append(qm.HasIdCondition(has_id=ids))
    return qm.Filter(must=must)


class QdrantVectorStore(VectorStore):
    def __init__(self, url: str, api_key: str = ""):
        # url=":memory:" runs Qdrant's embedded local mode (used by tests)
        self.client = (AsyncQdrantClient(location=":memory:") if url == ":memory:"
                       else AsyncQdrantClient(url=url, api_key=api_key or None))

    async def ensure_ready(self, dimensions: int) -> None:
        if not await self.client.collection_exists(COLLECTION):
            await self.client.create_collection(
                COLLECTION, vectors_config=qm.VectorParams(size=dimensions, distance=qm.Distance.COSINE))
        try:
            await self.client.create_payload_index(COLLECTION, "workspace_id", qm.PayloadSchemaType.KEYWORD)
        except Exception:  # index already exists
            pass

    async def upsert(self, workspace_id: str, records: list[VectorRecord]) -> None:
        for i in range(0, len(records), 128):
            await self.client.upsert(COLLECTION, points=[
                qm.PointStruct(id=r.id, vector=r.vector, payload={**r.payload, "workspace_id": workspace_id})
                for r in records[i:i + 128]])

    async def search(self, workspace_id, vector, top_k=5, filters=None) -> list[VectorHit]:
        res = await self.client.query_points(
            COLLECTION, query=vector, limit=top_k, query_filter=_filter(workspace_id, filters),
            with_payload=True)
        return [VectorHit(id=str(p.id), score=float(p.score), payload=p.payload or {}) for p in res.points]

    async def delete(self, workspace_id, ids=None, filters=None) -> None:
        await self.client.delete(COLLECTION, points_selector=qm.FilterSelector(
            filter=_filter(workspace_id, filters, ids)))

    async def healthcheck(self) -> None:
        await self.client.collection_exists(COLLECTION)

    async def close(self) -> None:
        await self.client.close()
