import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models import UnansweredQuestion, Workspace
from app.providers.embeddings.factory import get_embedder
from app.providers.vectorstores.factory import get_vector_store
from app.rag.service import RAGService
from app.schemas.dashboard import ClosestHit, UnansweredList, UnansweredOut, UnansweredUpdate

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/unanswered", tags=["unanswered"], dependencies=[Depends(require_csrf)])

# (label, keywords, suggested action). Heuristic hints only: they never claim to know the answer.
CATEGORIES = [
    ("Pricing & fees", ("price", "pricing", "cost", "fee", "how much", "quote", "discount", "plan", "subscription"),
     "Add a pricing or fees page/document with current rates."),
    ("Opening hours", ("hours", "open", "close", "closed", "holiday", "weekend", "appointment", "available"),
     "Add opening hours, holiday closures and booking information."),
    ("Contact & location", ("contact", "phone", "email", "address", "location", "where", "directions", "call"),
     "Add contact details and location/directions."),
    ("Policies", ("refund", "return", "shipping", "delivery", "warranty", "policy", "cancel", "guarantee"),
     "Add the relevant policy (shipping, returns, refunds, cancellation)."),
    ("Products & services", ("product", "service", "offer", "feature", "support", "include", "do you"),
     "Add or expand product/service descriptions covering this topic."),
]


def classify(question: str, frequency: int) -> tuple[str, str, str]:
    q = question.lower()
    label, action = "General knowledge gap", "Add or update a document that answers this question."
    for name, words, act in CATEGORIES:
        if any(w in q for w in words):
            label, action = name, act
            break
    priority = "high" if frequency >= 5 else "medium" if frequency >= 2 else "low"
    return label, action, priority


def _out(row: UnansweredQuestion) -> UnansweredOut:
    gap, action, priority = classify(row.question, row.frequency)
    return UnansweredOut(id=row.id, question=row.question, frequency=row.frequency, last_asked_at=row.last_asked_at,
                         status=row.status, knowledge_gap=gap, potential_action=action, priority=priority)


@router.get("", response_model=UnansweredList)
async def list_unanswered(status_filter: str = Query("open", alias="status", pattern="^(open|resolved|ignored|all)$"),
                          sort: str = Query("frequency", pattern="^(frequency|recent)$"),
                          limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                          ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    stmt = select(UnansweredQuestion).where(UnansweredQuestion.workspace_id == ws.id)
    if status_filter != "all":
        stmt = stmt.where(UnansweredQuestion.status == status_filter)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    order = (UnansweredQuestion.frequency.desc(), UnansweredQuestion.last_asked_at.desc()) if sort == "frequency" \
        else (UnansweredQuestion.last_asked_at.desc(),)
    rows = (await db.execute(stmt.order_by(*order).limit(limit).offset(offset))).scalars().all()
    return UnansweredList(total=total, items=[_out(r) for r in rows])


async def _owned(db: AsyncSession, ws: Workspace, qid: uuid.UUID) -> UnansweredQuestion:
    row = (await db.execute(select(UnansweredQuestion).where(UnansweredQuestion.id == qid,
                                                             UnansweredQuestion.workspace_id == ws.id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Not found")
    return row


@router.patch("/{question_id}", response_model=UnansweredOut, dependencies=[Depends(require_admin)])
async def update_unanswered(question_id: uuid.UUID, body: UnansweredUpdate, ws: Workspace = Depends(get_current_workspace),
                            db: AsyncSession = Depends(get_db)):
    row = await _owned(db, ws, question_id)
    row.status = body.status
    await db.flush()
    return _out(row)


@router.post("/{question_id}/closest", response_model=list[ClosestHit])
async def closest_content(question_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                          db: AsyncSession = Depends(get_db)):
    """Shows what the knowledge base *does* contain nearest to this question (helps decide what to add)."""
    row = await _owned(db, ws, question_id)
    try:
        res = await RAGService(get_embedder(), get_vector_store()).retrieve(str(ws.id), row.question, top_k=3, min_score=0.0)
    except Exception as exc:
        log.exception("Closest-content lookup failed")
        raise HTTPException(503, getattr(exc, "user_message", None) or "Search is temporarily unavailable.")
    return [ClosestHit(source_name=c.source_name, url=c.url, score=round(c.score, 3),
                       excerpt=" ".join(c.content.split())[:240]) for c in res.chunks]
