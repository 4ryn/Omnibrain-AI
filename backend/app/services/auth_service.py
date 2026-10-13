import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import (APIConfiguration, AuthSession, Role, User, WidgetConfiguration,
                        Workspace, WorkspaceMember)
from app.security.sessions import hash_token, new_token


def _slugify(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "workspace"
    return f"{base[:60]}-{secrets.token_hex(3)}"


async def upsert_google_user(db: AsyncSession, *, sub: str, email: str,
                             name: str | None, picture: str | None) -> User:
    user = (await db.execute(select(User).where(User.google_user_id == sub))).scalar_one_or_none()
    if user:
        user.email, user.name, user.avatar_url = email, name, picture
    else:
        user = User(google_user_id=sub, email=email, name=name, avatar_url=picture)
        db.add(user)
        await db.flush()
    return user


async def ensure_workspace(db: AsyncSession, user: User) -> Workspace:
    """Return the user's first workspace, creating one (with default configs) on first login."""
    ws = (await db.execute(
        select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.created_at).limit(1))).scalar_one_or_none()
    if ws:
        return ws
    display = user.name or user.email.split("@")[0]
    ws = Workspace(name=f"{display}'s Workspace", slug=_slugify(display),
                   public_id="wk_" + secrets.token_urlsafe(12))
    db.add(ws)
    await db.flush()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=Role.owner.value),
        APIConfiguration(workspace_id=ws.id),
        WidgetConfiguration(workspace_id=ws.id, brand_name=ws.name),
    ])
    await db.flush()
    return ws


async def create_session(db: AsyncSession, user_id: uuid.UUID, user_agent: str | None,
                         ip: str | None) -> str:
    token = new_token()
    db.add(AuthSession(
        user_id=user_id, token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.session_ttl_hours),
        user_agent=(user_agent or "")[:512] or None, ip_address=ip))
    await db.flush()
    return token
