from fastapi import APIRouter, Depends

from app.api.deps import get_current_workspace, require_csrf, require_admin
from app.models import Workspace
from app.schemas.auth import WorkspaceOut
from app.schemas.dashboard import WorkspaceUpdate

router = APIRouter(prefix="/api/workspace", tags=["workspace"], dependencies=[Depends(require_csrf)])


@router.patch("", response_model=WorkspaceOut, dependencies=[Depends(require_admin)])
async def rename_workspace(body: WorkspaceUpdate, ws: Workspace = Depends(get_current_workspace)):
    ws.name = body.name.strip()
    return ws
