
import ipaddress
import re
from urllib.parse import urlsplit

from itsdangerous import (
    BadSignature,
    SignatureExpired,
    URLSafeTimedSerializer,
)

from app.core.config import settings


_signer = URLSafeTimedSerializer(
    settings.secret_key,
    salt="widget-token",
)

VISITOR_RE = re.compile(r"[A-Za-z0-9_-]{16,64}")
_LABEL_RE = re.compile(
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
)


def _valid_hostname(host: str, allow_wildcard: bool = False) -> bool:
    if allow_wildcard and host.startswith("*."):
        host = host[2:]

    if not host or "*" in host:
        return False

    # Accept IP addresses, including IPv6.
    try:
        ipaddress.ip_address(host)
        return not host.startswith("*.") 
    except ValueError:
        pass

    # Accept DNS names and localhost.
    if host == "localhost":
        return True

    if len(host) > 253:
        return False

    labels = host.rstrip(".").split(".")
    return all(_LABEL_RE.fullmatch(label) for label in labels)


def normalize_origin(value: str) -> str:
    """
    Normalize an HTTP(S) origin or full page URL.

    Examples:
      http://localhost:3000/about -> http://localhost:3000
      https://EXAMPLE.com/page    -> https://example.com
      https://*.example.com       -> https://*.example.com
    """
    value = (value or "").strip()
    if not value:
        raise ValueError("Website origin cannot be empty.")

    try:
        parsed = urlsplit(value)

        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https"):
            raise ValueError("Only HTTP and HTTPS websites are supported.")

        if not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("Enter a valid website URL.")

        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port  # Raises ValueError for an invalid port.

        if not _valid_hostname(host, allow_wildcard=True):
            raise ValueError("Enter a valid website hostname.")

        if host.startswith("*.") and port is not None:
            raise ValueError(
                "Wildcard domains cannot specify a port. "
                "Add individual origins when using non-default ports."
            )

        # Browsers treat the default HTTP/HTTPS ports as implicit.
        if (scheme, port) in (("http", 80), ("https", 443)):
            port = None

        # Preserve IPv6 brackets when constructing the canonical origin.
        host_for_url = f"[{host}]" if ":" in host else host
        netloc = host_for_url if port is None else f"{host_for_url}:{port}"

        return f"{scheme}://{netloc}"

    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Enter a valid HTTP or HTTPS website URL.") from exc


def origin_from_url(url: str | None) -> str | None:
    """Extract a canonical origin from a browser URL or Referer."""
    if not url:
        return None

    try:
        origin = normalize_origin(url)
        parsed = urlsplit(origin)

        # A browser origin must never contain a wildcard hostname.
        if "*" in (parsed.hostname or ""):
            return None

        return origin
    except (ValueError, TypeError):
        return None


def origin_allowed(origin: str | None, allowed: list[str]) -> bool:
    """
    Exact origin matching by default.
    https://*.example.com matches subdomains, not example.com itself.
    An empty allow-list remains open only in development.
    """
    if not origin:
        return False

    if not allowed:
        return not settings.is_production

    try:
        actual = normalize_origin(origin)
        actual_parts = urlsplit(actual)
        actual_host = (actual_parts.hostname or "").lower()
        actual_port = actual_parts.port
        actual_scheme = actual_parts.scheme
    except ValueError:
        return False

    for entry in allowed:
        try:
            pattern = normalize_origin(entry)
            parts = urlsplit(pattern)
            host = (parts.hostname or "").lower()

            if parts.scheme != actual_scheme:
                continue

            if parts.port != actual_port:
                continue

            if host.startswith("*."):
                suffix = host[1:]  # ".example.com"
                if actual_host.endswith(suffix):
                    subdomain = actual_host[: -len(suffix)]
                    if subdomain and not subdomain.endswith("."):
                        return True
            elif actual_host == host:
                return True

        except (ValueError, TypeError):
            # Invalid saved entries must not accidentally grant access.
            continue

    return False


def frame_ancestors(allowed: list[str]) -> str:
    """Generate the CSP allow-list using canonical HTTP(S) origins."""
    clean: list[str] = []

    for entry in allowed:
        try:
            clean.append(normalize_origin(entry))
        except (ValueError, TypeError):
            continue

    if clean:
        return " ".join(dict.fromkeys(clean))

    return "*" if not settings.is_production else "'none'"


def mint_token(workspace_id: str, origin: str) -> str:
    """Create a short-lived token for the selected workspace and origin."""
    return _signer.dumps({
        "w": workspace_id,
        "o": origin,
    })


def verify_token(token: str) -> dict | None:
    try:
        data = _signer.loads(
            token,
            max_age=settings.widget_token_ttl_hours * 3600,
        )
        if (
            isinstance(data, dict)
            and isinstance(data.get("w"), str)
            and data.get("w")
            and isinstance(data.get("o"), str)
        ):
            return data
        return None
    except (BadSignature, SignatureExpired):
        return None
