import uuid

import pytest
from sqlalchemy import func, select

from app.core.errors import EmbeddingError
from app.ingestion import pipeline
from app.ingestion.url_fetcher import FetchedPage
from app.models import Document, DocumentChunk, URLSource
from app.providers.storage.local import LocalStorage
from tests.conftest import make_tenant
from tests.helpers import FakeEmbedder

TEXT = ("Acme Plumbing provides emergency repairs, boiler installation and drain cleaning. " * 30 + "\n\n"
        "Opening hours are 9am to 5pm Monday to Friday. " * 30)


async def _doc(env, tmp_path, ws_id, name="faq.txt", data=TEXT.encode()):
    storage = LocalStorage(str(tmp_path))
    path = await storage.save(str(ws_id), name, data)
    async with env.sm() as db:
        doc = Document(workspace_id=ws_id, filename=name, content_type="text/plain", size_bytes=len(data),
                       sha256=uuid.uuid4().hex * 2, storage_path=path, status="queued")
        db.add(doc)
        await db.commit()
        return doc.id, storage


async def _chunks(env, doc_id):
    async with env.sm() as db:
        return (await db.execute(select(DocumentChunk).where(DocumentChunk.document_id == doc_id))).scalars().all()


async def test_document_pipeline_indexes_chunks_and_vectors_per_workspace(env, tmp_path):
    t = await make_tenant(env.sm, "a@x.com")
    doc_id, storage = await _doc(env, tmp_path, t["ws_id"])
    await pipeline.process_document(env.sm, doc_id, embedder=env.embedder, store=env.store, storage=storage)
    async with env.sm() as db:
        doc = await db.get(Document, doc_id)
    chunks = await _chunks(env, doc_id)
    assert doc.status == "completed" and doc.error is None and doc.chunk_count == len(chunks) > 1
    assert len(env.store._rows) == len(chunks)
    assert all(ws == str(t["ws_id"]) and p["workspace_id"] == str(t["ws_id"]) and p["source_name"] == "faq.txt"
               for ws, _, p in env.store._rows.values())
    assert {c.vector_id for c in chunks} == set(env.store._rows)


async def test_reindex_is_idempotent_and_removes_stale_vectors(env, tmp_path):
    t = await make_tenant(env.sm, "a@x.com")
    doc_id, storage = await _doc(env, tmp_path, t["ws_id"])
    for _ in range(3):
        await pipeline.process_document(env.sm, doc_id, embedder=env.embedder, store=env.store, storage=storage)
    chunks = await _chunks(env, doc_id)
    assert len(env.store._rows) == len(chunks)          # no accumulation of duplicates


async def test_embedding_failure_marks_failed_with_safe_message_and_leaves_nothing_behind(env, tmp_path):
    class Broken(FakeEmbedder):
        async def embed_documents(self, texts): raise EmbeddingError("The embedding service is temporarily unavailable. Please retry.")
    t = await make_tenant(env.sm, "a@x.com")
    doc_id, storage = await _doc(env, tmp_path, t["ws_id"])
    await pipeline.process_document(env.sm, doc_id, embedder=Broken(), store=env.store, storage=storage)
    async with env.sm() as db:
        doc = await db.get(Document, doc_id)
    assert doc.status == "failed" and "embedding service" in doc.error and doc.chunk_count == 0
    assert env.store._rows == {} and await _chunks(env, doc_id) == []


async def test_vector_store_failure_does_not_leak_internal_errors(env, tmp_path):
    async def boom(*a, **k): raise ConnectionError("10.1.2.3:6333 refused")
    env.store.upsert = boom
    t = await make_tenant(env.sm, "a@x.com")
    doc_id, storage = await _doc(env, tmp_path, t["ws_id"])
    await pipeline.process_document(env.sm, doc_id, embedder=env.embedder, store=env.store, storage=storage)
    async with env.sm() as db:
        doc = await db.get(Document, doc_id)
    assert doc.status == "failed" and "10.1.2.3" not in doc.error and "retry" in doc.error.lower()


async def test_unreadable_and_empty_files_fail_cleanly(env, tmp_path):
    t = await make_tenant(env.sm, "a@x.com")
    for name, data, expect in (("bad.pdf", b"%PDF-1.4 garbage", "could not be read"), ("empty.txt", b"   \n\n  ", "No usable text")):
        doc_id, storage = await _doc(env, tmp_path, t["ws_id"], name, data)
        await pipeline.process_document(env.sm, doc_id, embedder=env.embedder, store=env.store, storage=storage)
        async with env.sm() as db:
            doc = await db.get(Document, doc_id)
        assert doc.status == "failed" and expect in doc.error


async def test_url_pipeline_and_failure_modes(env, monkeypatch):
    from app.core.errors import FetchError
    t = await make_tenant(env.sm, "a@x.com")
    async with env.sm() as db:
        ok, bad = (URLSource(workspace_id=t["ws_id"], url=u, status="queued") for u in ("https://acme.example/services", "https://acme.example/down"))
        db.add_all([ok, bad]); await db.commit()
    async def fake_fetch(url):
        if url.endswith("/down"):
            raise FetchError("The website responded with HTTP 503.")
        return FetchedPage(url, "Acme Services", TEXT)
    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    await pipeline.process_url(env.sm, ok.id, embedder=env.embedder, store=env.store)
    await pipeline.process_url(env.sm, bad.id, embedder=env.embedder, store=env.store)
    async with env.sm() as db:
        a, b = await db.get(URLSource, ok.id), await db.get(URLSource, bad.id)
    assert (a.status, a.title, a.last_crawled_at is not None) == ("completed", "Acme Services", True) and a.chunk_count > 0
    assert b.status == "failed" and b.error == "The website responded with HTTP 503."
    assert all(p["source_type"] == "url" and p["url"] == "https://acme.example/services" for _, _, p in env.store._rows.values())


async def test_oversized_source_is_rejected(env, tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "MAX_CHUNKS_PER_SOURCE", 2)
    t = await make_tenant(env.sm, "a@x.com")
    doc_id, storage = await _doc(env, tmp_path, t["ws_id"])
    await pipeline.process_document(env.sm, doc_id, embedder=env.embedder, store=env.store, storage=storage)
    async with env.sm() as db:
        assert "too large" in (await db.get(Document, doc_id)).error
