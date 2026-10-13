import asyncio
import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as g_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_session, require_csrf
from app.core.config import settings
from app.core.database import get_db
from app.core.ratelimit import client_ip, enforce
from app.models import AuthSession, Workspace, WorkspaceMember
from app.schemas.auth import MeOut, UserOut, WorkspaceOut
from app.security.sessions import (CSRF_COOKIE, OAUTH_COOKIE, OAUTH_MAX_AGE, SESSION_COOKIE,
                                   csrf_for, read_oauth_payload, sign_oauth_payload)
from app.services import auth_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _login_error(code: str) -> RedirectResponse:
    resp = RedirectResponse(f"{settings.frontend_url}/login?error={code}", status_code=302)
    resp.delete_cookie(OAUTH_COOKIE)
    return resp


@router.get("/google/login")
async def google_login(request: Request) -> RedirectResponse:
    await enforce(f"auth:{client_ip(request)}", 20)
    if not (settings.google_client_id and settings.google_client_secret):
        return _login_error("oauth_not_configured")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,  # fixed server-side, never from the request
        "response_type": "code", "scope": "openid email profile",
        "state": state, "nonce": nonce, "access_type": "online", "prompt": "select_account",
    }
    resp = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)
    resp.set_cookie(OAUTH_COOKIE, sign_oauth_payload(state, nonce), max_age=OAUTH_MAX_AGE,
                    httponly=True, secure=settings.cookie_secure, samesite="lax", path="/api/auth")
    return resp


@router.get("/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None,
                          error: str | None = None, db: AsyncSession = Depends(get_db)):
    await enforce(f"auth:{client_ip(request)}", 20)
    if error or not code or not state:
        return _login_error("oauth_denied")
    payload = read_oauth_payload(request.cookies.get(OAUTH_COOKIE, ""))
    if not payload or not secrets.compare_digest(payload["state"], state):
        return _login_error("invalid_state")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(GOOGLE_TOKEN_URL, data={
                "code": code, "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri, "grant_type": "authorization_code"})
        r.raise_for_status()
        raw_id_token = r.json()["id_token"]
        claims = await asyncio.to_thread(
            g_id_token.verify_oauth2_token, raw_id_token, g_requests.Request(), settings.google_client_id)
    except Exception:  # network, bad code, bad signature/audience: log detail, show generic error
        log.exception("Google OAuth token exchange/verification failed")
        return _login_error("oauth_failed")

    if (claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
            or not secrets.compare_digest(str(claims.get("nonce", "")), payload["nonce"])):
        return _login_error("invalid_token")
    if not claims.get("email_verified") or not claims.get("email"):
        return _login_error("email_not_verified")

    user = await auth_service.upsert_google_user(
        db, sub=claims["sub"], email=claims["email"], name=claims.get("name"), picture=claims.get("picture"))
    await auth_service.ensure_workspace(db, user)
    token = await auth_service.create_session(
        db, user.id, request.headers.get("user-agent"), request.client.host if request.client else None)

    max_age = settings.session_ttl_hours * 3600
    resp = RedirectResponse(f"{settings.frontend_url}/dashboard", status_code=302)
    resp.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True,
                    secure=settings.cookie_secure, samesite="lax", path="/")
    resp.set_cookie(CSRF_COOKIE, csrf_for(token), max_age=max_age, httponly=False,
                    secure=settings.cookie_secure, samesite="lax", path="/")
    resp.delete_cookie(OAUTH_COOKIE, path="/api/auth")
    return resp


@router.get("/me", response_model=MeOut)
async def me(request: Request, session: AuthSession = Depends(get_current_session),
             db: AsyncSession = Depends(get_db)) -> MeOut:
    workspaces = (await db.execute(
        select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == session.user_id)
        .order_by(WorkspaceMember.created_at))).scalars().all()
    return MeOut(user=UserOut.model_validate(session.user),
                 workspaces=[WorkspaceOut.model_validate(w) for w in workspaces],
                 csrf_token=csrf_for(request.cookies[SESSION_COOKIE]),
                 role=(await db.execute(select(WorkspaceMember.role).where(
                     WorkspaceMember.user_id == session.user_id).order_by(WorkspaceMember.created_at).limit(1))
                 ).scalar_one_or_none() or "member")


@router.post("/logout", dependencies=[Depends(require_csrf)])
async def logout(session: AuthSession = Depends(get_current_session), db: AsyncSession = Depends(get_db)):
    await db.delete(session)
    from fastapi.responses import JSONResponse
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    resp.delete_cookie(CSRF_COOKIE, path="/")
    return resp
