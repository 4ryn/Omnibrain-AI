"""Encryption of customer-supplied credentials (BYOK). Decrypt only server-side, only when needed."""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings


class CryptoError(Exception):
    pass


def _fernet() -> MultiFernet:
    """ENCRYPTION_KEY may list several comma-separated keys: the first encrypts, all can decrypt (rotation)."""
    keys = [k.strip() for k in settings.encryption_key.split(",") if k.strip()]
    if not keys:
        raise CryptoError("ENCRYPTION_KEY is not configured")
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except (ValueError, TypeError) as exc:
        raise CryptoError("ENCRYPTION_KEY is invalid") from exc


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise CryptoError("Stored credential could not be decrypted") from exc


def key_hint(plaintext: str) -> str:
    """Safe-to-display hint, e.g. '…a1b2'."""
    return "…" + plaintext[-4:] if len(plaintext) >= 8 else "…"
