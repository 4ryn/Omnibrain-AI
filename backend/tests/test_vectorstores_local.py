"""Qdrant (embedded local mode) and Pinecone (fake client) behind the same VectorStore contract."""
import uuid

import pytest

from app.providers.vectorstores.base import VectorRecord
from app.providers.vectorstores.pinecone_store import PineconeVectorStore
from app.providers.vectorstores.qdrant_store import QdrantVectorStore

WS_A, WS_B = str(uuid.uuid4()), str(uuid.uuid4())
DIM = 4


def rec(vec, **payload):
    return VectorRecord(id=str(uuid.uuid4()), vector=vec, payload=payload)


async def contract(store):
    """Behaviour every backend must satisfy, whatever the vendor."""
    a1, a2, b1 = rec([1, 0, 0, 0], k="a1", source_id="s1"), rec([0, 1, 0, 0], k="a2", source_id="s2"), rec([1, 0, 0, 0], k="b1", source_id="s1")
    await store.ensure_ready(DIM)
    await store.upsert(WS_A, [a1, a2])
    await store.upsert(WS_B, [b1])
    hits = await store.search(WS_A, [1, 0, 0, 0], top_k=5)
    assert [h.payload["k"] for h in hits][0] == "a1" and {h.payload["k"] for h in hits} == {"a1", "a2"}   # never b1
    assert hits[0].score > hits[1].score and all(h.payload["workspace_id"] == WS_A for h in hits)
    assert [h.payload["k"] for h in await store.search(WS_B, [1, 0, 0, 0])] == ["b1"]
    # a record can never be written into (or overwrite) another tenant's space
    await store.upsert(WS_B, [VectorRecord(id=a1.id, vector=[0, 0, 1, 0], payload={"k": "hijack"})])
    assert {h.payload["k"] for h in await store.search(WS_A, [1, 0, 0, 0])} >= {"a1"}
    # deletes are workspace-scoped: deleting A's id through B's workspace removes nothing of A's
    await store.delete(WS_B, ids=[a2.id])
    assert "a2" in {h.payload["k"] for h in await store.search(WS_A, [0, 1, 0, 0])}
    await store.delete(WS_A, ids=[a2.id])
    assert "a2" not in {h.payload["k"] for h in await store.search(WS_A, [0, 1, 0, 0])}
    assert [h.payload["k"] for h in await store.search(WS_B, [1, 0, 0, 0])]      # B untouched
    await store.healthcheck()


async def test_qdrant_embedded_mode_honours_the_contract():
    store = QdrantVectorStore(":memory:")
    try:
        await store.ensure_ready(DIM)
        a1, b1 = rec([1, 0, 0, 0], k="a1", source_id="s1"), rec([1, 0, 0, 0], k="b1", source_id="s1")
        a2 = rec([0, 1, 0, 0], k="a2", source_id="s2")
        await store.upsert(WS_A, [a1, a2]); await store.upsert(WS_B, [b1])
        hits = await store.search(WS_A, [1, 0, 0, 0], top_k=5)
        assert [h.payload["k"] for h in hits][0] == "a1" and {h.payload["k"] for h in hits} == {"a1", "a2"}
        assert [h.payload["k"] for h in await store.search(WS_B, [1, 0, 0, 0])] == ["b1"]
        assert [h.payload["k"] for h in await store.search(WS_A, [1, 0, 0, 0], filters={"source_id": "s2"})] == ["a2"]
        await store.delete(WS_B, ids=[a2.id])                                   # wrong workspace: no effect on A
        assert "a2" in {h.payload["k"] for h in await store.search(WS_A, [0, 1, 0, 0])}
        await store.delete(WS_A, ids=[a2.id])
        assert "a2" not in {h.payload["k"] for h in await store.search(WS_A, [0, 1, 0, 0])}
        await store.delete(WS_A, filters={"source_id": "s1"})
        assert await store.search(WS_A, [1, 0, 0, 0]) == [] and len(await store.search(WS_B, [1, 0, 0, 0])) == 1
        await store.healthcheck()
    finally:
        await store.close()


class FakePineconeIndex:
    def __init__(self): self.ns: dict[str, dict] = {}
    def upsert(self, vectors, namespace):
        for v in vectors: self.ns.setdefault(namespace, {})[v["id"]] = v
    def query(self, vector, top_k, namespace, filter=None, include_metadata=True):
        import types
        def cos(a, b):
            na, nb = sum(x * x for x in a) ** .5, sum(x * x for x in b) ** .5
            return sum(x * y for x, y in zip(a, b)) / (na * nb) if na and nb else 0
        rows = sorted(self.ns.get(namespace, {}).values(), key=lambda v: -cos(vector, v["values"]))[:top_k]
        return types.SimpleNamespace(matches=[types.SimpleNamespace(id=r["id"], score=cos(vector, r["values"]), metadata=r["metadata"]) for r in rows])
    def delete(self, ids=None, namespace=None, delete_all=False):
        if delete_all: self.ns.pop(namespace, None)
        for i in ids or []: self.ns.get(namespace, {}).pop(i, None)


class FakePinecone:
    def __init__(self): self.index = FakePineconeIndex()
    def Index(self, name): return self.index
    def describe_index(self, name):
        import types
        return types.SimpleNamespace(dimension=DIM)


async def test_pinecone_store_uses_one_namespace_per_workspace_and_cleans_metadata():
    client = FakePinecone()
    store = PineconeVectorStore("key", "idx", client=client)
    await store.ensure_ready(DIM)
    a1, a2, b1 = rec([1, 0, 0, 0], k="a1", url=None), rec([0, 1, 0, 0], k="a2"), rec([1, 0, 0, 0], k="b1")
    await store.upsert(WS_A, [a1, a2]); await store.upsert(WS_B, [b1])
    assert set(client.index.ns) == {WS_A, WS_B} and "url" not in client.index.ns[WS_A][a1.id]["metadata"]   # None dropped
    assert {h.payload["k"] for h in await store.search(WS_A, [1, 0, 0, 0])} == {"a1", "a2"}
    assert [h.payload["k"] for h in await store.search(WS_B, [1, 0, 0, 0])] == ["b1"]
    await store.delete(WS_B, ids=[a2.id])
    assert a2.id in client.index.ns[WS_A]
    await store.delete(WS_A, ids=[a2.id])
    assert a2.id not in client.index.ns[WS_A]
    with pytest.raises(NotImplementedError):
        await store.delete(WS_A, filters={"source_id": "s1"})
    await store.healthcheck()
    client.describe_index = lambda n: __import__("types").SimpleNamespace(dimension=999)
    from app.core.errors import ConfigError
    with pytest.raises(ConfigError):
        await store.ensure_ready(DIM)
