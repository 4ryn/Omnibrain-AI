import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Integer, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.core.database import get_db
from app.models import Conversation, Lead, Message, Workspace
from app.schemas.dashboard import ConversationDetail, ConversationList, ConversationOut, MessageOut

router = APIRouter(prefix="/api/conversations", tags=["conversations"], dependencies=[Depends(require_csrf)])


def _agg():
    return (select(Message.conversation_id.label("cid"), func.count().label("n"),
                   func.max(Message.created_at).label("last"),
                   func.max(cast(Message.was_fallback, Integer)).label("fb"))
            .group_by(Message.conversation_id).subquery())


def _to_out(conv: Conversation, n, last, fb, preview) -> ConversationOut:
    return ConversationOut(id=conv.id, channel=conv.channel, visitor_id=conv.visitor_id, source_page=conv.source_page,
                           created_at=conv.created_at, last_activity=last, message_count=n or 0,
                           had_fallback=bool(fb), preview=(preview or "")[:160] or None)


@router.get("", response_model=ConversationList)
async def list_conversations(channel: str | None = Query(None, pattern="^(widget|playground)$"),
                             fallback_only: bool = False, limit: int = Query(25, ge=1, le=100),
                             offset: int = Query(0, ge=0), ws: Workspace = Depends(get_current_workspace),
                             db: AsyncSession = Depends(get_db)):
    agg = _agg()
    base = select(Conversation, agg.c.n, agg.c.last, agg.c.fb).join(agg, agg.c.cid == Conversation.id, isouter=True
                                                                      ).where(Conversation.workspace_id == ws.id)
    if channel:
        base = base.where(Conversation.channel == channel)
    if fallback_only:
        base = base.where(agg.c.fb == 1)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(func.coalesce(agg.c.last, Conversation.created_at).desc())
                             .limit(limit).offset(offset))).all()
    ids = [r[0].id for r in rows]
    previews: dict[uuid.UUID, str] = {}
    if ids:
        for m in (await db.execute(select(Message).where(Message.conversation_id.in_(ids), Message.role == "user")
                                   .order_by(Message.created_at))).scalars():
            previews.setdefault(m.conversation_id, m.content)
    return ConversationList(total=total, items=[_to_out(c, n, last, fb, previews.get(c.id)) for c, n, last, fb in rows])


async def _owned(db: AsyncSession, ws: Workspace, conversation_id: uuid.UUID) -> Conversation:
    conv = (await db.execute(select(Conversation).where(Conversation.id == conversation_id,
                                                        Conversation.workspace_id == ws.id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return conv


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(conversation_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                           db: AsyncSession = Depends(get_db)):
    conv = await _owned(db, ws, conversation_id)
    msgs = (await db.execute(select(Message).where(Message.conversation_id == conv.id, Message.workspace_id == ws.id)
                             .order_by(Message.created_at))).scalars().all()
    first_user = next((m.content for m in msgs if m.role == "user"), None)
    return ConversationDetail(
        conversation=_to_out(conv, len(msgs), msgs[-1].created_at if msgs else None,
                             any(m.was_fallback for m in msgs), first_user),
        messages=[MessageOut.model_validate(m, from_attributes=True) for m in msgs])


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_conversation(conversation_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                              db: AsyncSession = Depends(get_db)):
    conv = await _owned(db, ws, conversation_id)
    await db.execute(delete(Message).where(Message.conversation_id == conv.id))
    await db.execute(Lead.__table__.update().where(Lead.conversation_id == conv.id).values(conversation_id=None))
    await db.delete(conv)
