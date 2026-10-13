import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_csrf
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.ratelimit import enforce
from app.models import User, Workspace
from app.providers.embeddings.factory import get_embedder
from app.providers.llm.factory import PROVIDERS
from app.providers.vectorstores.factory import get_vector_store
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatContext, ChatError, ChatService

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"], dependencies=[Depends(require_csrf)])

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n"


def _service() -> ChatService:
    return ChatService(lambda: get_embedder(), lambda: get_vector_store())   # resolved lazily, inside error handling


def _ctx(ws: Workspace, body: ChatRequest) -> ChatContext:
    if body.provider and body.provider not in PROVIDERS:
        raise HTTPException(400, f"Unsupported provider '{body.provider}'.")
    return ChatContext(workspace_id=ws.id, channel="playground",
                       override_provider=body.provider, override_model=body.model)


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await enforce(f"dash:{user.id}", settings.rl_dashboard_chat_per_min)

    svc, ctx = _service(), _ctx(ws, body)

    try:
        prep = await svc.prepare(
            db,
            ctx,
            body.message,
            body.conversation_id,
        )
    except ChatError as exc:
        raise HTTPException(exc.status_code, exc.message)

    done = None
    text = []

    try:
        async for ev in svc.events(db, prep, stream=False):
            event_type = ev.get("type")

            if event_type == "delta":
                text.append(ev.get("text", ""))

            elif event_type == "error":
                log.error(
                    "Chat service error for workspace %s: %s",
                    ws.id,
                    ev.get("message"),
                )
                raise HTTPException(
                    status_code=503,
                    detail=ev.get(
                        "message",
                        "Something went wrong. Please try again.",
                    ),
                )

            elif event_type == "done":
                done = ev

    except HTTPException:
        raise

    except Exception:
        log.exception(
            "Non-streaming chat failed for workspace %s",
            ws.id,
        )
        raise HTTPException(
            status_code=500,
            detail="Something went wrong. Please try again.",
        )

    if done is None:
        log.error(
            "Chat completed without a done event for workspace %s",
            ws.id,
        )
        raise HTTPException(
            status_code=500,
            detail="Chat did not produce a final response.",
        )

    return ChatResponse(
        conversation_id=done["conversation_id"],
        message_id=done["message_id"],
        answer="".join(text),
        fallback=done["fallback"],
        confidence=done["confidence"],
        sources=done["sources"],
        provider=done["provider"],
        model=done["model"],
        latency_ms=done["latency_ms"],
        retrieval_ms=done["retrieval_ms"],
    )

@router.post("/stream")
async def chat_stream(body: ChatRequest, ws: Workspace = Depends(get_current_workspace),
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await enforce(f"dash:{user.id}", settings.rl_dashboard_chat_per_min)
    svc, ctx = _service(), _ctx(ws, body)
    if body.conversation_id:  # fail with a real 404 before the stream starts
        try:
            await svc.check_conversation(db, ctx, body.conversation_id)
        except ChatError as exc:
            raise HTTPException(exc.status_code, exc.message)

    async def gen():
        async with SessionLocal() as sdb:  # own session: the request-scoped one may be closed mid-stream
            try:
                prep = await svc.prepare(sdb, ctx, body.message, body.conversation_id)
                await sdb.commit()
                async for ev in svc.events(sdb, prep, stream=True):
                    yield sse(ev)
            except ChatError as exc:
                yield sse({"type": "error", "message": exc.message})
            except Exception:
                log.exception("Chat stream crashed")
                await sdb.rollback()
                yield sse({"type": "error", "message": "Something went wrong. Please try again."})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)
