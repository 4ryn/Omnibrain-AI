from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf
from app.api.widget_config import snippet_for
from app.core.database import get_db
from app.models import (Conversation, Document, IngestionStatus, Lead, Message, UnansweredQuestion, URLSource,
                        UsageRecord, WidgetConfiguration, Workspace)
from app.services.ai_config import effective_provider_model, get_or_create_config
from app.services.plans import get_plan, messages_this_month, source_counts
from app.services.pricing import pricing_configured

router = APIRouter(prefix="/api", tags=["insights"], dependencies=[Depends(require_csrf)])


def _since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def _count(db: AsyncSession, stmt) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()


@router.get("/overview")
async def overview(ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    since = _since(30)
    done = IngestionStatus.completed.value
    docs_ready = await _count(db, select(Document.id).where(Document.workspace_id == ws.id, Document.status == done))
    docs_failed = await _count(db, select(Document.id).where(Document.workspace_id == ws.id, Document.status == "failed"))
    urls_ready = await _count(db, select(URLSource.id).where(URLSource.workspace_id == ws.id, URLSource.status == done))
    urls_failed = await _count(db, select(URLSource.id).where(URLSource.workspace_id == ws.id, URLSource.status == "failed"))
    convs = await _count(db, select(Conversation.id).where(Conversation.workspace_id == ws.id,
                                                           Conversation.channel == "widget", Conversation.created_at >= since))
    tests = await _count(db, select(Conversation.id).where(Conversation.workspace_id == ws.id, Conversation.channel == "playground"))
    answers = (await db.execute(
        select(func.count(), func.coalesce(func.sum(cast(Message.was_fallback, Integer)), 0))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.workspace_id == ws.id, Message.role == "assistant", Conversation.channel == "widget",
               Message.created_at >= since))).one()
    leads = await _count(db, select(Lead.id).where(Lead.workspace_id == ws.id, Lead.created_at >= since))
    leads_total = await _count(db, select(Lead.id).where(Lead.workspace_id == ws.id))
    open_gaps = await _count(db, select(UnansweredQuestion.id).where(UnansweredQuestion.workspace_id == ws.id,
                                                                     UnansweredQuestion.status == "open"))
    wcfg = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == ws.id))).scalar_one_or_none()
    cfg = await get_or_create_config(db, ws.id)
    provider, model = effective_provider_model(cfg)
    total_answers, fallbacks = answers[0], int(answers[1] or 0)
    return {
        "workspace": {"name": ws.name, "plan": ws.plan, "public_id": ws.public_id},
        "documents": {"ready": docs_ready, "failed": docs_failed},
        "urls": {"ready": urls_ready, "failed": urls_failed},
        "conversations_30d": convs, "answers_30d": total_answers,
        "fallback_rate_30d": round(fallbacks / total_answers, 3) if total_answers else None,
        "leads_30d": leads, "leads_total": leads_total, "open_unanswered": open_gaps,
        "snippet": snippet_for(ws),
        "setup": {
            "knowledge_added": docs_ready + urls_ready > 0,
            "ai_selected": bool(model),
            "tested_in_playground": tests > 0,
            "origins_configured": bool(wcfg and wcfg.allowed_origins),
            "widget_used": convs > 0,
        },
        "ai": {"provider": provider, "model": model, "credential_mode": cfg.credential_mode},
        "quota": {"messages_per_month": get_plan(ws.plan).messages_per_month,
                  "messages_this_month": await messages_this_month(db, ws.id)},
    }


@router.get("/usage")
async def usage(days: int = Query(30, ge=1, le=90), ws: Workspace = Depends(get_current_workspace),
                db: AsyncSession = Depends(get_db)):
    since = _since(days)
    day = func.date(UsageRecord.created_at)
    rows = (await db.execute(select(day, UsageRecord.metric, func.sum(UsageRecord.quantity))
                             .where(UsageRecord.workspace_id == ws.id, UsageRecord.created_at >= since)
                             .group_by(day, UsageRecord.metric))).all()
    daily: dict[str, dict] = {}
    totals: dict[str, int] = {}
    for d, metric, qty in rows:
        daily.setdefault(str(d), {"date": str(d)})[metric] = int(qty or 0)
        totals[metric] = totals.get(metric, 0) + int(qty or 0)
    by_model = (await db.execute(
        select(Message.provider, Message.model, func.count(), func.coalesce(func.sum(Message.tokens_in), 0),
               func.coalesce(func.sum(Message.tokens_out), 0), func.avg(Message.latency_ms))
        .where(Message.workspace_id == ws.id, Message.role == "assistant", Message.provider.is_not(None),
               Message.created_at >= since).group_by(Message.provider, Message.model))).all()
    docs = (await db.execute(select(func.count(), func.coalesce(func.sum(Document.size_bytes), 0))
                             .where(Document.workspace_id == ws.id))).one()
    plan = get_plan(ws.plan)
    sources_used, _ = await source_counts(db, ws.id)
    costs = {k[len("ai_cost_"):]: float(v) for k, v in (await db.execute(
        select(UsageRecord.metric, func.coalesce(func.sum(UsageRecord.cost_usd), 0))
        .where(UsageRecord.workspace_id == ws.id, UsageRecord.created_at >= since,
               UsageRecord.metric.like("ai\\_cost\\_%", escape="\\")).group_by(UsageRecord.metric))).all()}
    return {
        "limits": {"plan": plan.name, "messages_per_month": plan.messages_per_month,
                   "messages_this_month": await messages_this_month(db, ws.id), "sources": plan.sources,
                   "sources_used": sources_used, "storage_mb": plan.storage_mb, "voice": plan.voice},
        "ai_cost_usd": {"platform": round(costs.get("platform", 0.0), 4), "byok_estimate": round(costs.get("byok", 0.0), 4),
                        "pricing_configured": pricing_configured()},
        "days": days, "plan": ws.plan,
        "totals": {"messages": totals.get("message", 0), "tokens_in": totals.get("tokens_in", 0),
                   "tokens_out": totals.get("tokens_out", 0), "voice_stt": totals.get("voice_stt", 0),
                   "voice_tts_chars": totals.get("voice_tts", 0), "documents": int(docs[0]),
                   "storage_bytes": int(docs[1])},
        "daily": [daily[k] for k in sorted(daily)],
        "by_model": [{"provider": p, "model": m, "answers": n, "tokens_in": int(ti), "tokens_out": int(to),
                      "avg_latency_ms": int(lat) if lat is not None else None} for p, m, n, ti, to, lat in by_model],
    }
