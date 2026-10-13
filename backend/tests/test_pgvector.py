"""PgVectorStore against real PostgreSQL + pgvector (TEST_DB=postgres)."""
import uuid

from app.providers.vectorstores.base import VectorRecord
from app.providers.vectorstores.pgvector_store import PgVectorStore
from tests.test_vectorstores_local import DIM, WS_A, WS_B, contract, rec


async def test_pgvector_honours_the_contract_including_cross_tenant_overwrite_protection(sm, pg_url):
    store = PgVectorStore(pg_url)
    try:
        await contract(store)
    finally:
        await store.close()


async def test_pgvector_filters_ordering_and_hnsw_index(sm, pg_url):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    store = PgVectorStore(pg_url)
    try:
        await store.ensure_ready(DIM)
        await store.ensure_ready(DIM)                     # idempotent
        rows = [rec([1, 0, 0, 0], source_id="s1", n=1), rec([0.9, 0.1, 0, 0], source_id="s1", n=2), rec([0.1, 0.9, 0, 0], source_id="s2", n=3)]
        await store.upsert(WS_A, rows)
        hits = await store.search(WS_A, [1, 0, 0, 0], top_k=3)
        assert [h.payload["n"] for h in hits] == [1, 2, 3] and hits[0].score == 1.0 or abs(hits[0].score - 1.0) < 1e-6
        assert [h.payload["n"] for h in await store.search(WS_A, [1, 0, 0, 0], filters={"source_id": "s2"})] == [3]
        await store.delete(WS_A, filters={"source_id": "s1"})
        assert [h.payload["n"] for h in await store.search(WS_A, [1, 0, 0, 0])] == [3]
        engine = create_async_engine(pg_url)
        async with engine.connect() as c:
            idx = (await c.execute(text("select indexdef from pg_indexes where tablename='vector_chunks'"))).scalars().all()
        await engine.dispose()
        assert any("hnsw" in i and "vector_cosine_ops" in i for i in idx) and any("workspace_id" in i for i in idx)
    finally:
        await store.close()
