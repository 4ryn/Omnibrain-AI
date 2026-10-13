import csv
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.core.database import get_db
from app.models import Lead, Workspace
from app.schemas.dashboard import LeadList, LeadOut

router = APIRouter(prefix="/api/leads", tags=["leads"], dependencies=[Depends(require_csrf)])


def _filtered(ws: Workspace, q: str | None):
    stmt = select(Lead).where(Lead.workspace_id == ws.id)
    if q:
        like = f"%{q.strip()[:100]}%"
        stmt = stmt.where(or_(Lead.name.ilike(like), Lead.email.ilike(like), Lead.phone.ilike(like), Lead.question.ilike(like)))
    return stmt


@router.get("", response_model=LeadList)
async def list_leads(q: str | None = None, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                     ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    stmt = _filtered(ws, q)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Lead.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return LeadList(total=total, items=[LeadOut.model_validate(r, from_attributes=True) for r in rows])


def _safe_cell(value) -> str:
    """Neutralise spreadsheet formula injection (=, +, -, @, tab, CR) in exported visitor-supplied text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/export.csv", dependencies=[Depends(require_admin)])
async def export_leads(ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(_filtered(ws, None).order_by(Lead.created_at.desc()).limit(10000))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "name", "email", "phone", "question", "source_page"])
    for r in rows:
        w.writerow([r.created_at.isoformat(), *map(_safe_cell, (r.name, r.email, r.phone, r.question, r.source_page))])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="leads.csv"'})


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_lead(lead_id: uuid.UUID, ws: Workspace = Depends(get_current_workspace),
                      db: AsyncSession = Depends(get_db)):
    lead = (await db.execute(select(Lead).where(Lead.id == lead_id, Lead.workspace_id == ws.id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await db.delete(lead)
