import math

from app.providers.vectorstores.base import VectorHit, VectorRecord, VectorStore


class InMemoryVectorStore(VectorStore):
    """Reference implementation used in tests and offline experiments."""

    def __init__(self):
        self._rows: dict[str, tuple[str, list[float], dict]] = {}

    async def ensure_ready(self, dimensions: int) -> None:
        return None

    async def upsert(self, workspace_id, records: list[VectorRecord]) -> None:
        for r in records:
            self._rows[r.id] = (workspace_id, r.vector, {**r.payload, "workspace_id": workspace_id})

    async def search(self, workspace_id, vector, top_k=5, filters=None) -> list[VectorHit]:
        def cos(a, b):
            na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(x * x for x in b))
            return sum(x * y for x, y in zip(a, b)) / (na * nb) if na and nb else 0.0
        hits = [VectorHit(id=i, score=cos(vector, v), payload=p)
                for i, (ws, v, p) in self._rows.items()
                if ws == workspace_id and all(p.get(k) == val for k, val in (filters or {}).items())]
        return sorted(hits, key=lambda h: h.score, reverse=True)[:top_k]

    async def delete(self, workspace_id, ids=None, filters=None) -> None:
        for i, (ws, _, p) in list(self._rows.items()):
            if ws != workspace_id or (ids and i not in ids):
                continue
            if all(p.get(k) == v for k, v in (filters or {}).items()):
                del self._rows[i]
