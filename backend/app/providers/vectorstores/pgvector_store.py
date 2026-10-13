import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.providers.vectorstores.base import VectorHit, VectorRecord, VectorStore


def _lit(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


class PgVectorStore(VectorStore):
    """Vectors in Postgres (pgvector extension). Tenant filter is part of every WHERE clause."""

    def __init__(self, database_url: str):
        self.engine = create_async_engine(database_url, pool_pre_ping=True)

    async def ensure_ready(self, dimensions: int) -> None:
        dim = int(dimensions)
        async with self.engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.execute(text(
                f"CREATE TABLE IF NOT EXISTS vector_chunks (id uuid PRIMARY KEY, workspace_id text NOT NULL, "
                f"payload jsonb NOT NULL DEFAULT '{{}}', embedding vector({dim}) NOT NULL)"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_vector_chunks_workspace ON vector_chunks (workspace_id)"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_vector_chunks_embedding ON vector_chunks "
                "USING hnsw (embedding vector_cosine_ops)"))

    async def upsert(self, workspace_id: str, records: list[VectorRecord]) -> None:
        if not records:
            return
        rows = [{"id": r.id, "ws": workspace_id, "p": json.dumps({**r.payload, "workspace_id": workspace_id}),
                 "v": _lit(r.vector)} for r in records]
        async with self.engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO vector_chunks (id, workspace_id, payload, embedding) "
                "VALUES (CAST(:id AS uuid), :ws, CAST(:p AS jsonb), CAST(:v AS vector)) "
                "ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, embedding = EXCLUDED.embedding "
                "WHERE vector_chunks.workspace_id = EXCLUDED.workspace_id"), rows)

    async def search(self, workspace_id, vector, top_k=5, filters=None) -> list[VectorHit]:
        async with self.engine.connect() as conn:
            res = await conn.execute(text(
                "SELECT id::text AS id, payload, 1 - (embedding <=> CAST(:v AS vector)) AS score "
                "FROM vector_chunks WHERE workspace_id = :ws AND payload @> CAST(:f AS jsonb) "
                "ORDER BY embedding <=> CAST(:v AS vector) LIMIT :k"),
                {"v": _lit(vector), "ws": workspace_id, "f": json.dumps(filters or {}), "k": top_k})
            return [VectorHit(id=r.id, score=float(r.score), payload=r.payload) for r in res]

    async def delete(self, workspace_id, ids=None, filters=None) -> None:
        sql = "DELETE FROM vector_chunks WHERE workspace_id = :ws AND payload @> CAST(:f AS jsonb)"
        params: dict = {"ws": workspace_id, "f": json.dumps(filters or {})}
        if ids:
            sql += " AND id = ANY(CAST(:ids AS uuid[]))"
            params["ids"] = ids
        async with self.engine.begin() as conn:
            await conn.execute(text(sql), params)

    async def healthcheck(self) -> None:
        async with self.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    async def close(self) -> None:
        await self.engine.dispose()
