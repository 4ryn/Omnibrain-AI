"""Integration fixtures: the real FastAPI app + real SQLAlchemy models on in-memory SQLite.
(Postgres-only column types are mapped to SQLite equivalents for tests; providers/vector store are fakes.)"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from app.core import ratelimit
from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.models import AuthSession, Base, Workspace, WidgetConfiguration
from app.providers.vectorstores.base import VectorRecord
from app.providers.vectorstores.memory_store import InMemoryVectorStore
from app.security.sessions import CSRF_COOKIE, SESSION_COOKIE, csrf_for, hash_token, new_token
from app.services import auth_service
from tests.helpers import FakeEmbedder, FakeLLM


@compiles(JSONB, "sqlite")
def _jsonb(t, c, **kw): return "JSON"


@compiles(UUID, "sqlite")
def _uuid(t, c, **kw): return "CHAR(32)"


import os
import tempfile

from sqlalchemy import text

TEST_DB = os.environ.get("TEST_DB", "sqlite")      # sqlite (fast, default) | postgres (real Postgres 16 + pgvector via pgserver)


@pytest.fixture(scope="session")
def pg_url():
    """Real PostgreSQL with pgvector, schema created by the actual Alembic migrations (not create_all)."""
    if TEST_DB != "postgres":
        pytest.skip("set TEST_DB=postgres to run against real Postgres")
    import pgserver
    from alembic import command
    from alembic.config import Config
    server = pgserver.get_server(tempfile.mkdtemp(prefix="omni_pg_"))
    sock = server.get_uri().split("host=")[1]
    server.psql("CREATE DATABASE omni_test;")
    url = f"postgresql+asyncpg://postgres@/omni_test?host={sock}"
    settings.database_url = url
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    # env.py uses asyncio.run(); run it on a worker thread so it never collides with pytest's running event loop
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(1) as pool:
        pool.submit(command.upgrade, cfg, "head").result()
    yield url
    server.cleanup()


@pytest.fixture
async def sm(request):
    if TEST_DB == "postgres":
        url = request.getfixturevalue("pg_url")
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
            await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS vector_chunks"))
    else:
        engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def env(monkeypatch, sm):
    """Wires the app to the test DB, fake embedder/vector store/LLM, in-memory rate limiter."""
    store, embedder, llm = InMemoryVectorStore(), FakeEmbedder(), FakeLLM()

    async def override_db():
        async with sm() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise
    app.dependency_overrides[get_db] = override_db
    for mod in ("app.api.chat", "app.api.widget"):
        monkeypatch.setattr(f"{mod}.SessionLocal", sm)
        monkeypatch.setattr(f"{mod}.get_embedder", lambda: embedder)
        monkeypatch.setattr(f"{mod}.get_vector_store", lambda: store)
    for mod in ("app.api.knowledge", "app.api.unanswered"):
        monkeypatch.setattr(f"{mod}.get_vector_store", lambda: store)
        monkeypatch.setattr(f"{mod}.get_embedder", lambda: embedder)

    from app.api import knowledge as _k
    real_enqueue = _k._enqueue

    async def noop_enqueue(*a, **k): return None
    monkeypatch.setattr("app.api.knowledge._enqueue", noop_enqueue)
    monkeypatch.setattr("app.services.ai_config.build_llm", lambda name, key, **kw: llm)
    monkeypatch.setattr("app.api.ai_config.build_llm", lambda name, key, **kw: llm)  # no real network in tests
    limiter = ratelimit.RateLimiter(ratelimit.MemoryBackend())
    monkeypatch.setattr(ratelimit, "get_limiter", lambda: limiter)
    monkeypatch.setattr(settings, "openai_api_key", "sk-platform-test-key")
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    yield type("Env", (), {"store": store, "embedder": embedder, "llm": llm, "sm": sm, "limiter": limiter, "real_enqueue": staticmethod(real_enqueue)})
    app.dependency_overrides.clear()


@pytest.fixture
async def client(env):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def make_tenant(sm, email: str) -> dict:
    """Creates user + workspace + session; returns request headers for the dashboard API."""
    async with sm() as db:
        user = await auth_service.upsert_google_user(db, sub=f"g-{email}", email=email, name=email.split("@")[0], picture=None)
        ws = await auth_service.ensure_workspace(db, user)
        token = new_token()
        db.add(AuthSession(user_id=user.id, token_hash=hash_token(token), expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
        await db.commit()
        csrf = csrf_for(token)
        return {"ws_id": ws.id, "public_id": ws.public_id,
                "headers": {"Cookie": f"{SESSION_COOKIE}={token}; {CSRF_COOKIE}={csrf}", "X-CSRF-Token": csrf}}


async def seed_knowledge(env, ws_id, texts: list[str], url: str | None = None) -> None:
    vecs = await env.embedder.embed_documents(texts)
    await env.store.upsert(str(ws_id), [VectorRecord(id=str(uuid.uuid4()), vector=v, payload={
        "workspace_id": str(ws_id), "source_type": "url" if url else "document", "source_id": "s1",
        "source_name": "Services page" if url else "internal-pricing.pdf", "url": url, "content": t, "chunk_index": i})
        for i, (v, t) in enumerate(zip(vecs, texts))])


async def make_member(sm, ws_id, email: str, role: str = "member") -> dict:
    """A second user who belongs to an EXISTING workspace with the given role."""
    from app.models import WorkspaceMember
    async with sm() as db:
        user = await auth_service.upsert_google_user(db, sub=f"g-{email}", email=email, name=email, picture=None)
        db.add(WorkspaceMember(workspace_id=ws_id, user_id=user.id, role=role))
        token = new_token()
        db.add(AuthSession(user_id=user.id, token_hash=hash_token(token), expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
        await db.commit()
        csrf = csrf_for(token)
        return {"headers": {"Cookie": f"{SESSION_COOKIE}={token}; {CSRF_COOKIE}={csrf}", "X-CSRF-Token": csrf}}
