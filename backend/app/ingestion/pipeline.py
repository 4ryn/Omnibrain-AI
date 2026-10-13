import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core import metrics
from app.core.errors import ExtractionError, UserFacingError
from app.ingestion.chunker import chunk_text
from app.ingestion.cleaner import clean_text
from app.ingestion.extractors import extract_text
from app.ingestion.url_fetcher import fetch_page
from app.models import Document, DocumentChunk, IngestionStatus, URLSource
from app.providers.embeddings.base import EmbeddingProvider
from app.providers.storage.base import StorageProvider
from app.providers.vectorstores.base import VectorRecord, VectorStore

log = logging.getLogger(__name__)
MAX_CHUNKS_PER_SOURCE = 3000
EMBED_BATCH = 64


async def _set_status(sm: async_sessionmaker, model, source_id: uuid.UUID, status: str,
                      error: str | None = None, **fields) -> None:
    async with sm() as db:
        obj = await db.get(model, source_id)
        if obj:
            obj.status, obj.error = status, error
            for k, v in fields.items():
                setattr(obj, k, v)
            await db.commit()


async def _purge(sm, workspace_id: str, kind: str, source_id: uuid.UUID, store: VectorStore) -> None:
    col = DocumentChunk.document_id if kind == "document" else DocumentChunk.url_source_id
    async with sm() as db:
        ids = [r[0] for r in (await db.execute(
            select(DocumentChunk.vector_id).where(
                DocumentChunk.workspace_id == uuid.UUID(workspace_id), col == source_id))).all() if r[0]]
        if ids:
            await store.delete(workspace_id, ids=ids)
        await db.execute(delete(DocumentChunk).where(
            DocumentChunk.workspace_id == uuid.UUID(workspace_id), col == source_id))
        await db.commit()


async def index_source(sm, *, workspace_id: str, kind: str, source_id: uuid.UUID, name: str,
                       url: str | None, text: str, embedder: EmbeddingProvider, store: VectorStore) -> int:
    chunks = chunk_text(clean_text(text))
    if not chunks:
        raise ExtractionError("No usable text was found in this source.")
    if len(chunks) > MAX_CHUNKS_PER_SOURCE:
        raise ExtractionError("This source is too large. Split it into smaller documents.")

    await _purge(sm, workspace_id, kind, source_id, store)  # makes re-indexing idempotent

    vectors: list[list[float]] = []
    for i in range(0, len(chunks), EMBED_BATCH):
        vectors.extend(await embedder.embed_documents([c.text for c in chunks[i:i + EMBED_BATCH]]))

    chunk_ids = [uuid.uuid4() for _ in chunks]
    records = [VectorRecord(id=str(cid), vector=vec, payload={
        "workspace_id": workspace_id, "source_type": kind, "source_id": str(source_id),
        "source_name": name, "url": url, "chunk_index": c.index, "content": c.text})
        for cid, vec, c in zip(chunk_ids, vectors, chunks)]
    await store.upsert(workspace_id, records)
    try:
        async with sm() as db:
            db.add_all([DocumentChunk(
                id=cid, workspace_id=uuid.UUID(workspace_id),
                document_id=source_id if kind == "document" else None,
                url_source_id=source_id if kind == "url" else None,
                chunk_index=c.index, content=c.text, token_count=c.token_estimate, vector_id=str(cid),
                chunk_metadata={"source_name": name, "url": url}) for cid, c in zip(chunk_ids, chunks)])
            await db.commit()
    except Exception:
        try:
            await store.delete(workspace_id, ids=[str(c) for c in chunk_ids])
        except Exception:
            log.exception("Failed to roll back vectors for source %s", source_id)
        raise
    return len(chunks)


def _failure(exc: Exception, what: str) -> str:
    if isinstance(exc, UserFacingError):
        return exc.user_message
    log.exception("Unexpected failure while processing %s", what)
    return "Processing failed unexpectedly. Please retry; contact support if it persists."


async def process_document(sm, document_id: uuid.UUID, *, embedder: EmbeddingProvider,
                           store: VectorStore, storage: StorageProvider) -> None:
    async with sm() as db:
        doc = await db.get(Document, document_id)
        if not doc:
            return
        ws_id, filename, path = str(doc.workspace_id), doc.filename, doc.storage_path
        doc.status, doc.error = IngestionStatus.processing.value, None
        await db.commit()
    try:
        data = await storage.read(path)
        text = await asyncio.to_thread(extract_text, filename, data)
        count = await index_source(sm, workspace_id=ws_id, kind="document", source_id=document_id,
                                   name=filename, url=None, text=text, embedder=embedder, store=store)
        await _set_status(sm, Document, document_id, IngestionStatus.completed.value, chunk_count=count)
        metrics.INGESTION_JOBS.labels("document", "completed").inc()
    except Exception as exc:
        metrics.INGESTION_JOBS.labels("document", "failed").inc()
        await _set_status(sm, Document, document_id, IngestionStatus.failed.value,
                          _failure(exc, f"document {document_id}"), chunk_count=0)


async def process_url(sm, url_id: uuid.UUID, *, embedder: EmbeddingProvider, store: VectorStore) -> None:
    async with sm() as db:
        src = await db.get(URLSource, url_id)
        if not src:
            return
        ws_id, url = str(src.workspace_id), src.url
        src.status, src.error = IngestionStatus.processing.value, None
        await db.commit()
    try:
        page = await fetch_page(url)
        count = await index_source(sm, workspace_id=ws_id, kind="url", source_id=url_id,
                                   name=page.title or url, url=page.url, text=page.text,
                                   embedder=embedder, store=store)
        await _set_status(sm, URLSource, url_id, IngestionStatus.completed.value, title=page.title,
                          chunk_count=count, last_crawled_at=datetime.now(timezone.utc))
        metrics.INGESTION_JOBS.labels("url", "completed").inc()
    except Exception as exc:
        metrics.INGESTION_JOBS.labels("url", "failed").inc()
        await _set_status(sm, URLSource, url_id, IngestionStatus.failed.value,
                          _failure(exc, f"url {url_id}"), chunk_count=0)
