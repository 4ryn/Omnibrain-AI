from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models import Workspace, WidgetConfiguration
from app.schemas.dashboard import WidgetConfigOut, WidgetConfigUpdate
from app.services.plans import get_plan

router = APIRouter(prefix="/api/widget-config", tags=["widget-config"], dependencies=[Depends(require_csrf)])


async def _cfg(db: AsyncSession, ws: Workspace) -> WidgetConfiguration:
    cfg = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == ws.id))
           ).scalar_one_or_none()
    if not cfg:
        cfg = WidgetConfiguration(workspace_id=ws.id, brand_name=ws.name)
        db.add(cfg)
        await db.flush()
    return cfg


def snippet_for(ws: Workspace) -> str:
    return f'<script async src="{settings.backend_url.rstrip("/")}/widget.js" data-workspace="{ws.public_id}"></script>'


def _out(cfg: WidgetConfiguration, ws: Workspace) -> WidgetConfigOut:
    warnings = []
    if not cfg.allowed_origins:
        warnings.append("No allowed websites are configured. The widget is open to any site in development "
                        "and blocked on every site in production until you add your domain(s).")
    return WidgetConfigOut(
        brand_name=cfg.brand_name, welcome_message=cfg.welcome_message, theme=cfg.theme, position=cfg.position,
        logo_url=cfg.logo_url, avatar_url=cfg.avatar_url, primary_color=cfg.primary_color,
        suggested_questions=list(cfg.suggested_questions or []), voice_enabled=cfg.voice_enabled,
        lead_capture_enabled=cfg.lead_capture_enabled, allowed_origins=list(cfg.allowed_origins or []),
        public_id=ws.public_id, snippet=snippet_for(ws), warnings=warnings)


@router.get("", response_model=WidgetConfigOut)
async def get_widget_config(ws: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return _out(await _cfg(db, ws), ws)


@router.put("", response_model=WidgetConfigOut, dependencies=[Depends(require_admin)])
async def update_widget_config(body: WidgetConfigUpdate, ws: Workspace = Depends(get_current_workspace),
                               db: AsyncSession = Depends(get_db)):
    # if body.voice_enabled and not get_plan(ws.plan).voice:
    #     raise HTTPException(403, f"Voice isn't included in the {ws.plan} plan. Upgrade to enable it.")
    cfg = await _cfg(db, ws)
    nullable = {"logo_url", "avatar_url"}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is None and field not in nullable:
            continue  # required columns can't be nulled; ignore explicit nulls
        setattr(cfg, field, value)
    await db.flush()
    return _out(cfg, ws)
