import hashlib
import hmac
import secrets

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings

SESSION_COOKIE = "omnibrain_session"   # httpOnly
CSRF_COOKIE = "omnibrain_csrf"         # readable by JS, echoed in X-CSRF-Token
OAUTH_COOKIE = "omnibrain_oauth"       # httpOnly, short-lived (state + nonce)
OAUTH_MAX_AGE = 600

_oauth_signer = URLSafeTimedSerializer(settings.secret_key, salt="oauth-state")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_for(session_token: str) -> str:
    return hmac.new(settings.secret_key.encode(), session_token.encode(), hashlib.sha256).hexdigest()


def sign_oauth_payload(state: str, nonce: str) -> str:
    return _oauth_signer.dumps({"state": state, "nonce": nonce})


def read_oauth_payload(value: str) -> dict | None:
    try:
        return _oauth_signer.loads(value, max_age=OAUTH_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
