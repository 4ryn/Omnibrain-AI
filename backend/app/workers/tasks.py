import asyncio
import logging
import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.errors import UserFacingError
from app.ingestion import pipeline
from app.models import Document, IngestionStatus, URLSource
from app.providers.embeddings.factory import build_embedder
from app.providers.storage.local import LocalStorage
from app.providers.vectorstores.factory import build_vector_store
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


def _run(model, source_id: str, handler) -> None:
    """Each task gets its own event loop, engine and providers (nothing shared across loops).
    Setup failures (bad config, vector DB down) mark the source failed instead of leaving it stuck."""
    async def go():
        engine = create_async_engine(settings.database_url, poolclass=NullPool)
        sm = async_sessionmaker(engine, expire_on_commit=False)
        store = None
        try:
            try:
                store = build_vector_store()
                await store.ensure_ready(settings.embedding_dimensions)
                embedder = build_embedder()
            except Exception as exc:
                msg = exc.user_message if isinstance(exc, UserFacingError) else \
                    "The knowledge index is temporarily unavailable. Please retry."
                log.exception("Ingestion setup failed for %s", source_id)
                await pipeline._set_status(sm, model, uuid.UUID(source_id), IngestionStatus.failed.value, msg)
                return
            await handler(sm, embedder, store)
        finally:
            if store:
                await store.close()
            await engine.dispose()
    asyncio.run(go())


@celery_app.task(name="ingest.document")
def ingest_document(document_id: str) -> None:
    _run(Document, document_id, lambda sm, emb, store: pipeline.process_document(
        sm, uuid.UUID(document_id), embedder=emb, store=store, storage=LocalStorage(settings.storage_dir)))


@celery_app.task(name="ingest.url")
def ingest_url(url_id: str) -> None:
    _run(URLSource, url_id, lambda sm, emb, store: pipeline.process_url(
        sm, uuid.UUID(url_id), embedder=emb, store=store))
