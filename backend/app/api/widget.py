import json
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, PlainTextResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.chat import SSE_HEADERS, sse
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.errors import UserFacingError
from app.core.ratelimit import client_ip, enforce
from app.models import Lead, Workspace, WidgetConfiguration
from app.providers.embeddings.factory import get_embedder
from app.providers.llm.base import ProviderError
from app.providers.vectorstores.factory import get_vector_store
from app.providers.voice.factory import build_stt, build_tts
from app.schemas.chat import SpeakRequest, WidgetChatRequest, WidgetChatResponse
from app.schemas.dashboard import LeadCreate
from app.security import widget_auth
from app.services.ai_config import get_or_create_config, resolve_api_key
from app.core import metrics
from app.services.plans import get_plan
from app.services.chat_service import GENERIC_ERROR, ChatContext, ChatError, ChatService, check_conversation
from app.services.usage import record_usage

log = logging.getLogger(__name__)
router = APIRouter(tags=["widget"])

ASSETS = {"frame.js": "application/javascript", "frame.css": "text/css"}


def widget_dir() -> Path:
    return Path(settings.widget_dir) if settings.widget_dir else Path(__file__).resolve().parents[3] / "widget" / "src"


def _read(name: str) -> str:
    return (widget_dir() / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------- static delivery
@router.get("/widget.js")
async def loader() -> Response:
    return Response(_read("widget.js"), media_type="application/javascript",
                    headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@router.get("/widget/assets/{name}")
async def asset(name: str) -> Response:
    if name not in ASSETS:
        raise HTTPException(404, "Not found")
    return Response(_read(name), media_type=ASSETS[name],
                    headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@router.get("/widget/frame")
async def frame(request: Request, w: str, p: str = "", o: str = "", db: AsyncSession = Depends(get_db)):
    """The chat UI document that the loader embeds in an iframe. The embedding site is verified here
    (Referer, set by the loader's referrerpolicy=origin) and again by the browser via CSP frame-ancestors."""
    await enforce(f"frame:ip:{client_ip(request)}", settings.rl_frame_ip_per_min)
    ws = (await db.execute(select(Workspace).where(Workspace.public_id == w, Workspace.is_active.is_(True)))
          ).scalar_one_or_none()
    cfg = None if not ws else (await db.execute(select(WidgetConfiguration).where(
        WidgetConfiguration.workspace_id == ws.id))).scalar_one_or_none()
    if not ws or not cfg:
        metrics.WIDGET_EVENTS.labels("frame_not_found").inc()
        raise HTTPException(404, "Assistant not found")

    allowed = list(cfg.allowed_origins or [])

    # Prefer the browser-provided Referer when available.
    referer_origin = widget_auth.origin_from_url(
        request.headers.get("referer")
    )

    # The loader supplies the embedding origin explicitly.
    # Use it only when Referer is absent, and validate it against
    # the same allow-list. Never use it to override a rejected Referer.
    query_origin = widget_auth.origin_from_url(o)

    parent = referer_origin or query_origin

    if not widget_auth.origin_allowed(parent, allowed):
        metrics.WIDGET_EVENTS.labels("frame_denied_origin").inc()
        return PlainTextResponse(
            "This assistant is not enabled for this website. "
            "Check the Allowed websites setting and try again.",
            status_code=403,
        )

    boot = {
        "workspace": ws.public_id,
        "token": widget_auth.mint_token(str(ws.id), parent),
        "brand_name": cfg.brand_name,
        "welcome_message": cfg.welcome_message,
        "theme": cfg.theme,
        "position": cfg.position,
        "logo_url": cfg.logo_url,
        "avatar_url": cfg.avatar_url,
        "primary_color": cfg.primary_color,
        "suggested_questions": (cfg.suggested_questions or [])[:6],
        "voice_enabled": bool(cfg.voice_enabled),
        "lead_capture_enabled": bool(cfg.lead_capture_enabled),
        "source_page": p[:2048],
    }
    payload = json.dumps(boot).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    metrics.WIDGET_EVENTS.labels("frame_loaded").inc()
    html = _read("frame.html").replace("__BOOT__", payload)
    csp = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; "
           "connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'; "
           f"frame-ancestors {widget_auth.frame_ancestors(allowed)}")
    return HTMLResponse(html, headers={"Content-Security-Policy": csp, "Cache-Control": "no-store",
                                       "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"})


# ---------------------------------------------------------------- authenticated widget API
@dataclass
class WidgetCtx:
    workspace_id: uuid.UUID
    visitor_id: str


async def widget_ctx(request: Request, authorization: str | None = Header(default=None),
                     x_visitor_id: str | None = Header(default=None),
                     db: AsyncSession = Depends(get_db)) -> WidgetCtx:
    await enforce(f"w:ip:{client_ip(request)}", settings.rl_widget_ip_per_min)
    token = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else ""
    claims = widget_auth.verify_token(token) if token else None
    if not claims:
        raise HTTPException(401, "Session expired")
    if not x_visitor_id or not widget_auth.VISITOR_RE.fullmatch(x_visitor_id):
        raise HTTPException(400, "Invalid visitor id")
    try:
        ws_id = uuid.UUID(claims["w"])
    except ValueError:
        raise HTTPException(401, "Session expired")
    ws = await db.get(Workspace, ws_id)
    if not ws or not ws.is_active:
        raise HTTPException(401, "Session expired")
    await enforce(f"w:visitor:{ws_id}:{x_visitor_id}", settings.rl_widget_visitor_per_min)
    await enforce(f"w:ws:{ws_id}", settings.rl_widget_workspace_per_min)
    return WidgetCtx(ws_id, x_visitor_id)


def _service() -> ChatService:
    return ChatService(lambda: get_embedder(), lambda: get_vector_store())   # resolved lazily, inside error handling


def _chat_ctx(wc: WidgetCtx, page: str | None) -> ChatContext:
    return ChatContext(workspace_id=wc.workspace_id, channel="widget", visitor_id=wc.visitor_id, source_page=page)


@router.post("/widget/v1/chat", response_model=WidgetChatResponse)
async def widget_chat(body: WidgetChatRequest, wc: WidgetCtx = Depends(widget_ctx), db: AsyncSession = Depends(get_db)):
    svc, ctx = _service(), _chat_ctx(wc, body.source_page)
    try:
        prep = await svc.prepare(db, ctx, body.message, body.conversation_id)
    except ChatError as exc:
        raise HTTPException(exc.status_code, exc.message)
    metrics.WIDGET_EVENTS.labels("chat").inc()
    text, done = [], None
    async for ev in svc.events(db, prep, stream=False):
        if ev["type"] == "delta":
            text.append(ev["text"])
        elif ev["type"] == "error":
            raise HTTPException(503, ev["message"])
        elif ev["type"] == "done":
            done = ev
    return WidgetChatResponse(conversation_id=done["conversation_id"], message_id=done["message_id"],
                              answer="".join(text), fallback=done["fallback"], sources=done["sources"])


@router.post("/widget/v1/chat/stream")
async def widget_chat_stream(body: WidgetChatRequest, wc: WidgetCtx = Depends(widget_ctx),
                             db: AsyncSession = Depends(get_db)):
    svc, ctx = _service(), _chat_ctx(wc, body.source_page)
    if body.conversation_id:
        try:
            await svc.check_conversation(db, ctx, body.conversation_id)
        except ChatError as exc:
            raise HTTPException(exc.status_code, exc.message)

    async def gen():
        async with SessionLocal() as sdb:
            try:
                prep = await svc.prepare(sdb, ctx, body.message, body.conversation_id)
                await sdb.commit()          # keep the visitor's question even if they disconnect mid-answer
                metrics.WIDGET_EVENTS.labels("chat_stream").inc()
                async for ev in svc.events(sdb, prep, stream=True):
                    yield sse(ev)
            except ChatError as exc:
                yield sse({"type": "error", "message": exc.message})
            except Exception:
                log.exception("Widget stream crashed")
                await sdb.rollback()
                yield sse({"type": "error", "message": GENERIC_ERROR})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/widget/v1/lead", status_code=201)
async def capture_lead(body: LeadCreate, wc: WidgetCtx = Depends(widget_ctx), db: AsyncSession = Depends(get_db)):
    cfg = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == wc.workspace_id))
           ).scalar_one_or_none()
    if not cfg or not cfg.lead_capture_enabled:
        raise HTTPException(403, "Lead capture is not enabled for this assistant.")
    await enforce(f"lead:{wc.workspace_id}:{wc.visitor_id}", 5, 3600)
    if body.conversation_id:
        try:
            await check_conversation(db, _chat_ctx(wc, None), body.conversation_id)
        except ChatError as exc:
            raise HTTPException(exc.status_code, exc.message)
    metrics.WIDGET_EVENTS.labels("lead_captured").inc()
    db.add(Lead(workspace_id=wc.workspace_id, conversation_id=body.conversation_id, name=body.name, email=body.email,
                phone=body.phone, question=body.question, source_page=body.source_page))
    return {"ok": True}


# ---------------------------------------------------------------- voice (only when enabled for the workspace)
async def _voice_key(db: AsyncSession, wc: WidgetCtx) -> str:
    cfg = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == wc.workspace_id))
           ).scalar_one_or_none()
    ws = await db.get(Workspace, wc.workspace_id)
    if not cfg or not cfg.voice_enabled or not ws or not get_plan(ws.plan).voice:
        raise HTTPException(403, "Voice is not enabled for this assistant.")
    try:
        key, _ = await resolve_api_key(db, await get_or_create_config(db, wc.workspace_id), "openai")
    except UserFacingError:
        raise HTTPException(503, "Voice is temporarily unavailable.")
    return key


@router.post("/widget/v1/voice/transcribe")
async def transcribe(audio: UploadFile = File(...), wc: WidgetCtx = Depends(widget_ctx),
                     db: AsyncSession = Depends(get_db)):
    key = await _voice_key(db, wc)
    mime = (audio.content_type or "").split(";")[0].strip().lower()
    if not mime.startswith(("audio/", "video/webm")):
        raise HTTPException(415, "Unsupported audio type.")
    limit = settings.max_voice_upload_mb * 1024 * 1024
    data = await audio.read(limit + 1)
    if not data or len(data) > limit:
        raise HTTPException(413 if data else 400, "Audio is empty or too large.")
    try:
        text = await build_stt(key).transcribe(data, mime)
    except (ProviderError, UserFacingError) as exc:
        log.warning("STT failed: %s", getattr(exc, "detail", exc))
        raise HTTPException(503, "Voice input is temporarily unavailable.")
    record_usage(db, wc.workspace_id, "voice_stt", 1, bytes=len(data))
    return {"text": text[:2000]}


@router.post("/widget/v1/voice/speak")
async def speak(body: SpeakRequest, wc: WidgetCtx = Depends(widget_ctx), db: AsyncSession = Depends(get_db)):
    key = await _voice_key(db, wc)
    try:
        audio, mime = await build_tts(key).synthesize(body.text)
    except (ProviderError, UserFacingError) as exc:
        log.warning("TTS failed: %s", getattr(exc, "detail", exc))
        raise HTTPException(503, "Voice output is temporarily unavailable.")
    record_usage(db, wc.workspace_id, "voice_tts", len(body.text))
    return Response(audio, media_type=mime, headers={"Cache-Control": "no-store"})
