import asyncio
import hashlib
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_csrf, require_admin
from app.core.config import settings
from app.core.database import get_db
from app.core.errors import UserFacingError
from app.ingestion.extractors import SUPPORTED_EXTENSIONS
from app.ingestion.url_fetcher import validate_public_url
from app.models import Document, DocumentChunk, IngestionStatus, URLSource, User, Workspace
from app.providers.embeddings.factory import get_embedder
from app.providers.storage.local import get_storage
from app.providers.vectorstores.factory import get_vector_store
from app.rag.service import RAGService
from app.services.plans import upload_quota_error
from app.schemas.knowledge import (DocumentOut, SearchHitOut, SearchRequest, SearchResponse,
                                   URLCreate, URLSourceOut)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"], dependencies=[Depends(require_csrf)])

CONTENT_TYPES = {".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
                 ".markdown": "text/markdown", ".csv": "text/csv",
                 ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def _safe_name(name: str) -> str:
    base = Path(name.replace("\\", "/")).name
    return (re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .") or "upload")[:200]


def _check_magic(ext: str, data: bytes) -> None:
    ok = (data.startswith(b"%PDF") if ext == ".pdf" else
          data.startswith(b"PK\x03\x04") if ext == ".docx" else
          b"\x00" not in data[:8192])
    if not ok:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "File content does not match its extension.")


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while chunk := await file.read(1024 * 1024):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(413,
                                f"File exceeds the {settings.max_upload_mb} MB limit.")
    return bytes(buf)


async def _enqueue(task_name: str, source_id: uuid.UUID, db: AsyncSession, model) -> None:
    from app.workers import tasks
    task = tasks.ingest_document if task_name == "document" else tasks.ingest_url
    try:
        await asyncio.to_thread(task.delay, str(source_id))
    except Exception:
        log.exception("Could not enqueue %s %s", task_name, source_id)
        obj = await db.get(model, source_id)
        obj.status = IngestionStatus.failed.value
        obj.error = "Processing queue is unavailable. Please retry in a moment."
        await db.commit()


async def _get_owned(db: AsyncSession, model, source_id: uuid.UUID, ws: Workspace):
    obj = (await db.execute(select(model).where(model.id == source_id, model.workspace_id == ws.id))
           ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")  # same response for foreign tenants
    return obj


async def _delete_vectors(db: AsyncSession, ws: Workspace, col, source_id: uuid.UUID) -> None:
    ids = [r[0] for r in (await db.execute(select(DocumentChunk.vector_id).where(
        DocumentChunk.workspace_id == ws.id, col == source_id))).all() if r[0]]
    if ids:
        try:
            await get_vector_store().delete(str(ws.id), ids=ids)
        except Exception:
            log.exception("Vector delete failed for source %s", source_id)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The knowledge index is unavailable. Nothing was deleted; please retry.")


# ---------- documents ----------
@router.post("/documents", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin)])
async def upload_document(file: UploadFile = File(...), ws: Workspace = Depends(get_current_workspace),
                          user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    name = _safe_name(file.filename or "upload")
    ext = Path(name).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Unsupported file type. Supported: PDF, TXT, MD, DOCX, CSV.")
    data = await _read_limited(file, settings.max_upload_mb * 1024 * 1024)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.")
    _check_magic(ext, data)
    quota_error = await upload_quota_error(db, ws.id, ws.plan, len(data))
    if quota_error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, quota_error)
    digest = hashlib.sha256(data).hexdigest()
    dup = (await db.execute(select(Document.id).where(
        Document.workspace_id == ws.id, Document.sha256 == digest))).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "This file has already been uploaded.")

    path = await get_storage().save(str(ws.id), name, data)
    doc = Document(workspace_id=ws.id, filename=name, content_type=CONTENT_TYPES[ext], size_bytes=len(data),
                   sha256=digest, storage_path=path, status=IngestionStatus.queued.value, created_by=user.id)
    db.add(doc)
    await db.commit()  # worker must be able to see the row
    await _enqueue("document", doc.id, db, Document)
    await db.refresh(doc)
    return doc


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                         ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    q = select(Document).where(Document.workspace_id == ws.id).order_by(Document.created_at.desc())
    return (await db.execute(q.limit(limit).offset(offset))).scalars().all()


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_document(document_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                          db: AsyncSession = Depends(get_db)):
    doc = await _get_owned(db, Document, document_id, ws)
    await _delete_vectors(db, ws, DocumentChunk.document_id, doc.id)
    try:
        await get_storage().delete(doc.storage_path)
    except Exception:
        log.warning("Could not delete stored file %s", doc.storage_path)
    await db.delete(doc)


@router.post("/documents/{document_id}/reindex", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin)])
async def reindex_document(document_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                           db: AsyncSession = Depends(get_db)):
    doc = await _get_owned(db, Document, document_id, ws)
    if doc.status == IngestionStatus.processing.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "This document is already being processed.")
    doc.status, doc.error = IngestionStatus.queued.value, None
    await db.commit()
    await _enqueue("document", doc.id, db, Document)
    await db.refresh(doc)
    return doc


# ---------- URLs ----------
@router.post("/urls", response_model=URLSourceOut, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin)])
async def add_url(body: URLCreate, ws: Workspace = Depends(get_current_workspace),
                  user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        url = await validate_public_url(body.url)
    except UserFacingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, exc.user_message)
    quota_error = await upload_quota_error(db, ws.id, ws.plan)
    if quota_error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, quota_error)
    if (await db.execute(select(URLSource.id).where(URLSource.workspace_id == ws.id, URLSource.url == url))).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "This URL has already been added.")
    src = URLSource(workspace_id=ws.id, url=url, status=IngestionStatus.queued.value, created_by=user.id)
    db.add(src)
    await db.commit()
    await _enqueue("url", src.id, db, URLSource)
    await db.refresh(src)
    return src


@router.get("/urls", response_model=list[URLSourceOut])
async def list_urls(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                    ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    q = select(URLSource).where(URLSource.workspace_id == ws.id).order_by(URLSource.created_at.desc())
    return (await db.execute(q.limit(limit).offset(offset))).scalars().all()


@router.delete("/urls/{url_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_url(url_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                     db: AsyncSession = Depends(get_db)):
    src = await _get_owned(db, URLSource, url_id, ws)
    await _delete_vectors(db, ws, DocumentChunk.url_source_id, src.id)
    await db.delete(src)


@router.post("/urls/{url_id}/reindex", response_model=URLSourceOut, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin)])
async def reindex_url(url_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                      db: AsyncSession = Depends(get_db)):
    src = await _get_owned(db, URLSource, url_id, ws)
    if src.status == IngestionStatus.processing.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "This URL is already being processed.")
    src.status, src.error = IngestionStatus.queued.value, None
    await db.commit()
    await _enqueue("url", src.id, db, URLSource)
    await db.refresh(src)
    return src


# ---------- search ----------
@router.post("/search", response_model=SearchResponse)
async def search_knowledge(body: SearchRequest, ws: Workspace = Depends(get_current_workspace)):
    try:
        rag = RAGService(get_embedder(), get_vector_store())
        res = await rag.retrieve(str(ws.id), body.query, top_k=body.top_k)
    except UserFacingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, exc.user_message)
    except Exception:
        log.exception("Knowledge search failed")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Search is temporarily unavailable.")
    return SearchResponse(confidence=res.confidence.value, hits=[
        SearchHitOut(content=c.content, score=round(c.score, 4), source_id=c.source_id,
                     source_name=c.source_name, source_type=c.source_type, url=c.url) for c in res.chunks])
