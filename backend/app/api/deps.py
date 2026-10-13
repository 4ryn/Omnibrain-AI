import hmac
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import AuthSession, User, Workspace, WorkspaceMember
from app.security.sessions import CSRF_COOKIE, SESSION_COOKIE, csrf_for, hash_token

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


async def get_current_session(request: Request, db: AsyncSession = Depends(get_db)) -> AuthSession:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    session = (await db.execute(
        select(AuthSession).options(selectinload(AuthSession.user))
        .where(AuthSession.token_hash == hash_token(token)))).scalar_one_or_none()
    expires = session.expires_at if session else None
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not session or expires < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return session


async def get_current_user(session: AuthSession = Depends(get_current_session)) -> User:
    return session.user


async def require_csrf(request: Request) -> None:
    """Double-submit CSRF check for cookie-authenticated, state-changing requests."""
    if request.method in SAFE_METHODS:
        return
    token = request.cookies.get(SESSION_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    expected = csrf_for(token)
    if not (header and token and hmac.compare_digest(header, expected)
            and hmac.compare_digest(cookie, expected)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF validation failed")


async def get_current_workspace(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_workspace_id: str | None = Header(default=None),
) -> Workspace:
    """Resolve the active workspace and verify membership. Every tenant route depends on this."""
    q = select(Workspace).join(WorkspaceMember).where(
        WorkspaceMember.user_id == user.id, Workspace.is_active.is_(True))
    if x_workspace_id:
        try:
            q = q.where(Workspace.id == uuid.UUID(x_workspace_id))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid workspace id")
    ws = (await db.execute(q.order_by(WorkspaceMember.created_at).limit(1))).scalar_one_or_none()
    if not ws:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this workspace")
    return ws


async def get_role(ws: Workspace = Depends(get_current_workspace), user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> str:
    role = (await db.execute(select(WorkspaceMember.role).where(
        WorkspaceMember.workspace_id == ws.id, WorkspaceMember.user_id == user.id))).scalar_one_or_none()
    if role is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this workspace")
    return role


async def require_admin(role: str = Depends(get_role)) -> None:
    """Owners and admins may change settings/knowledge; members are read-only (they can still use the playground)."""
    if role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You don't have permission to do that. Ask a workspace owner or admin.")
