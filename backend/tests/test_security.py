import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from starlette.requests import Request

from app.api.deps import require_csrf
from app.core.config import settings
from app.core.logging import RedactingFilter
from app.security import crypto
from app.security.sessions import (CSRF_COOKIE, SESSION_COOKIE, csrf_for, hash_token, new_token,
                                   read_oauth_payload, sign_oauth_payload)


def _req(method, cookies=None, headers=None):
    h = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    if cookies:
        h.append((b"cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()).encode()))
    return Request({"type": "http", "method": method, "headers": h, "path": "/", "query_string": b""})


async def test_csrf_blocks_mutations_without_token():
    tok = new_token()
    with pytest.raises(HTTPException) as e:
        await require_csrf(_req("POST", {SESSION_COOKIE: tok}))
    assert e.value.status_code == 403


async def test_csrf_rejects_wrong_token_and_accepts_right_one():
    tok = new_token()
    good = csrf_for(tok)
    with pytest.raises(HTTPException):
        await require_csrf(_req("POST", {SESSION_COOKIE: tok, CSRF_COOKIE: good}, {"X-CSRF-Token": "bad"}))
    await require_csrf(_req("POST", {SESSION_COOKIE: tok, CSRF_COOKIE: good}, {"X-CSRF-Token": good}))
    await require_csrf(_req("GET"))  # safe methods pass


def test_csrf_token_is_bound_to_session():
    assert csrf_for("session-a") != csrf_for("session-b")


def test_session_token_is_stored_hashed():
    t = new_token()
    assert hash_token(t) != t and len(hash_token(t)) == 64


def test_oauth_state_roundtrip_and_tamper_detection():
    value = sign_oauth_payload("state123", "nonce456")
    assert read_oauth_payload(value) == {"state": "state123", "nonce": "nonce456"}
    assert read_oauth_payload(value[:-2] + "xx") is None
    assert read_oauth_payload("garbage") is None


def test_byok_encryption_roundtrip(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", Fernet.generate_key().decode())
    enc = crypto.encrypt_secret("sk-live-secret-value")
    assert "sk-live" not in enc and crypto.decrypt_secret(enc) == "sk-live-secret-value"
    assert crypto.key_hint("sk-live-secret-value") == "…alue"
    monkeypatch.setattr(settings, "encryption_key", Fernet.generate_key().decode())
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt_secret(enc)


def test_log_filter_redacts_api_keys():
    import logging
    rec = logging.LogRecord("x", logging.INFO, "", 0, "calling with sk-abcdef1234567890 and Bearer abcdefgh12345", (), None)
    RedactingFilter().filter(rec)
    assert "sk-abcdef" not in rec.msg and "abcdefgh12345" not in rec.msg
