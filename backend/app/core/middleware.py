import json
import logging
import time
import uuid

from app.core import metrics
from app.core.config import settings
from app.core.context import request_id_var

log = logging.getLogger("omnibrain.access")
UPLOAD_PATHS = ("/api/knowledge/documents", "/widget/v1/voice/transcribe")


class RequestTooLarge(BaseException):
    """BaseException on purpose: frameworks wrap `except Exception` around body parsing and would turn it into a 400."""


class ObservabilityMiddleware:
    """Pure-ASGI (safe for streaming responses): request id, access log, metrics, body-size guard, security headers."""

    def __init__(self, app):
        self.app = app

    @staticmethod
    def _limit(path: str) -> int:
        if path.startswith(UPLOAD_PATHS):
            return (max(settings.max_upload_mb, settings.max_voice_upload_mb) + 1) * 1024 * 1024
        return settings.max_json_body_kb * 1024

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode("latin-1") for k, v in scope["headers"]}
        rid = headers.get("x-request-id", "")
        rid = rid if rid.replace("-", "").isalnum() and 8 <= len(rid) <= 64 else uuid.uuid4().hex
        token = request_id_var.set(rid)
        path, method = scope["path"], scope["method"]
        limit = self._limit(path)
        started, status_holder, sent = time.perf_counter(), {"status": 500}, {"n": 0}
        embeddable = path.startswith("/widget/frame")

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                extra = [(b"x-request-id", rid.encode()), (b"x-content-type-options", b"nosniff")]
                if not embeddable:
                    extra += [(b"x-frame-options", b"DENY"), (b"referrer-policy", b"no-referrer")]
                if path.startswith("/api/"):
                    extra.append((b"cache-control", b"no-store"))
                if settings.is_production:
                    extra.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
                message = {**message, "headers": [*message.get("headers", []), *extra]}
            await send(message)

        async def counting_receive():
            msg = await receive()
            if msg["type"] == "http.request":
                sent["n"] += len(msg.get("body", b""))
                if sent["n"] > limit:
                    raise RequestTooLarge()
            return msg

        async def reject():
            status_holder["status"] = 413
            body = json.dumps({"detail": "Request body is too large."}).encode()
            await send_wrapper({"type": "http.response.start", "status": 413,
                                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send_wrapper({"type": "http.response.body", "body": body})

        try:
            declared = int(headers.get("content-length", "0") or 0)
            if declared > limit:
                await reject()
            else:
                try:
                    await self.app(scope, counting_receive, send_wrapper)
                except RequestTooLarge:
                    await reject()
        finally:
            route = getattr(scope.get("route"), "path", None) or ("unmatched" if status_holder["status"] == 404 else path)
            elapsed = time.perf_counter() - started
            if not path.startswith(("/health", "/metrics")):
                metrics.HTTP_REQUESTS.labels(method, route, str(status_holder["status"])).inc()
                metrics.HTTP_LATENCY.labels(method, route).observe(elapsed)
                log.info("%s %s -> %s", method, route, status_holder["status"],
                         extra={"method": method, "route": route, "status": status_holder["status"],
                                "duration_ms": int(elapsed * 1000)})
            request_id_var.reset(token)
