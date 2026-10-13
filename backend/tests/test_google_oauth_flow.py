"""The real /api/auth/google/* code path, with only Google's two network calls faked."""
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models import AuthSession, User, Workspace, WidgetConfiguration, APIConfiguration
from app.security.sessions import OAUTH_COOKIE, read_oauth_payload


class FakeGoogleHttp:
    """Stands in for httpx.AsyncClient inside app.api.auth (the token endpoint)."""
    fail = False

    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False

    async def post(self, url, data=None, **kw):
        assert url == "https://oauth2.googleapis.com/token" and data["grant_type"] == "authorization_code"
        assert data["redirect_uri"] == settings.google_redirect_uri and data["client_secret"] == "test-secret"
        outer = self

        class R:
            def raise_for_status(self_inner):
                if outer.fail: raise RuntimeError("google said no")
            def json(self_inner): return {"id_token": "fake-id-token"}
        return R()


@pytest.fixture
def google(monkeypatch, client):
    monkeypatch.setattr(settings, "google_client_id", "test-client-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr("app.api.auth.httpx.AsyncClient", FakeGoogleHttp)
    FakeGoogleHttp.fail = False
    claims = {"iss": "https://accounts.google.com", "sub": "google-sub-1", "email": "owner@acme.com", "email_verified": True,
              "name": "Olive Owner", "picture": "https://lh3.example/p.png", "aud": "test-client-id"}
    state = {"claims": claims, "echo_nonce": True}

    def verify(token, request, audience):
        assert token == "fake-id-token" and audience == "test-client-id"
        out = dict(state["claims"])
        if state["echo_nonce"]:
            out["nonce"] = read_oauth_payload(client.cookies[OAUTH_COOKIE])["nonce"]
        return out
    monkeypatch.setattr("app.api.auth.g_id_token.verify_oauth2_token", verify)
    return state


async def start(client):
    r = await client.get("/api/auth/google/login")
    assert r.status_code == 302
    loc = urlparse(r.headers["location"])
    q = parse_qs(loc.query)
    return loc, q


async def test_login_redirects_to_google_with_state_nonce_and_fixed_redirect_uri(client, google):
    loc, q = await start(client)
    assert loc.netloc == "accounts.google.com" and q["client_id"] == ["test-client-id"]
    assert q["redirect_uri"] == [settings.google_redirect_uri] and q["scope"] == ["openid email profile"]
    assert len(q["state"][0]) >= 24 and len(q["nonce"][0]) >= 24
    cookie = [c for c in client.cookies.jar if c.name == OAUTH_COOKIE][0]
    assert cookie.has_nonstandard_attr("HttpOnly") and read_oauth_payload(cookie.value)["state"] == q["state"][0]


async def test_not_configured_shows_a_friendly_error(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    r = await client.get("/api/auth/google/login")
    assert r.status_code == 302 and "error=oauth_not_configured" in r.headers["location"]


async def test_full_signup_creates_user_workspace_defaults_and_secure_session(client, env, google):
    _, q = await start(client)
    r = await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert r.status_code == 302 and r.headers["location"] == f"{settings.frontend_url}/dashboard"
    set_cookies = r.headers.get_list("set-cookie")
    session_cookie = next(c for c in set_cookies if c.startswith("omnibrain_session="))
    assert "HttpOnly" in session_cookie and "SameSite=lax" in session_cookie.replace("Lax", "lax")
    csrf_cookie = next(c for c in set_cookies if c.startswith("omnibrain_csrf="))
    assert "HttpOnly" not in csrf_cookie                       # readable by the dashboard JS on purpose
    me = (await client.get("/api/auth/me")).json()
    assert me["user"]["email"] == "owner@acme.com" and me["user"]["name"] == "Olive Owner" and me["role"] == "owner"
    assert len(me["workspaces"]) == 1 and me["workspaces"][0]["public_id"].startswith("wk_")
    async with env.sm() as db:
        assert (await db.execute(select(func.count()).select_from(User))).scalar() == 1
        ws = (await db.execute(select(Workspace))).scalar_one()
        for model in (WidgetConfiguration, APIConfiguration):
            assert (await db.execute(select(model).where(model.workspace_id == ws.id))).scalar_one()
        sess = (await db.execute(select(AuthSession))).scalar_one()
        assert sess.token_hash != client.cookies["omnibrain_session"] and len(sess.token_hash) == 64   # hashed at rest
    csrf = client.cookies["omnibrain_csrf"]
    assert (await client.patch("/api/workspace", json={"name": "Acme"})).status_code == 403            # CSRF enforced
    assert (await client.patch("/api/workspace", json={"name": "Acme"}, headers={"X-CSRF-Token": csrf})).status_code == 200


async def test_returning_user_logs_in_without_a_second_workspace_and_profile_updates(client, env, google):
    for name in ("Olive Owner", "Olive Renamed"):
        google["claims"]["name"] = name
        _, q = await start(client)
        await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    async with env.sm() as db:
        assert (await db.execute(select(func.count()).select_from(User))).scalar() == 1
        assert (await db.execute(select(func.count()).select_from(Workspace))).scalar() == 1
        assert (await db.execute(select(User))).scalar_one().name == "Olive Renamed"
        assert (await db.execute(select(func.count()).select_from(AuthSession))).scalar() == 2


@pytest.mark.parametrize("mutate,error", [
    (lambda c: c.update(email_verified=False), "email_not_verified"),
    (lambda c: c.update(iss="https://evil.example"), "invalid_token"),
])
async def test_unverified_email_or_wrong_issuer_is_refused(client, google, mutate, error):
    mutate(google["claims"])
    _, q = await start(client)
    r = await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert error in r.headers["location"] and "omnibrain_session" not in client.cookies
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_tampered_state_replayed_cookie_and_nonce_mismatch_are_refused(client, google):
    _, q = await start(client)
    bad = await client.get("/api/auth/google/callback", params={"code": "abc", "state": "forged-state-value"})
    assert "error=invalid_state" in bad.headers["location"]
    google["echo_nonce"] = False                                   # id_token carries a different nonce (replay)
    google["claims"]["nonce"] = "someone-elses-nonce"
    _, q = await start(client)
    r = await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert "error=invalid_token" in r.headers["location"] and "omnibrain_session" not in client.cookies
    client.cookies.clear()                                         # no oauth cookie at all (e.g. CSRF'd callback)
    assert "error=invalid_state" in (await client.get("/api/auth/google/callback", params={"code": "x", "state": "y"})).headers["location"]


async def test_google_failures_and_denials_never_leak_details(client, google):
    _, q = await start(client)
    FakeGoogleHttp.fail = True
    r = await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert "error=oauth_failed" in r.headers["location"] and "google said no" not in r.headers["location"]
    denied = await client.get("/api/auth/google/callback", params={"error": "access_denied"})
    assert "error=oauth_denied" in denied.headers["location"]


async def test_logout_invalidates_the_server_side_session(client, env, google):
    _, q = await start(client)
    await client.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
    token = client.cookies["omnibrain_session"]; csrf = client.cookies["omnibrain_csrf"]
    assert (await client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})).status_code == 200
    client.cookies.set("omnibrain_session", token)               # a stolen copy of the old cookie is now worthless
    assert (await client.get("/api/auth/me")).status_code == 401
    async with env.sm() as db:
        assert (await db.execute(select(func.count()).select_from(AuthSession))).scalar() == 0
