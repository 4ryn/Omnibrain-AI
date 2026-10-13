import json
import logging
import re

from app.core.config import settings
from app.core.context import request_id_var

_SECRET_PATTERNS = [
    re.compile(r"(sk-[A-Za-z0-9_\-]{8,})"),
    re.compile(r"(xai-[A-Za-z0-9_\-]{8,})"),
    re.compile(r"(Bearer\s+[A-Za-z0-9_\-\.]{8,})", re.I),
]


class RedactingFilter(logging.Filter):
    """Last line of defence: scrub anything that looks like an API key from log output."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for pat in _SECRET_PATTERNS:
            msg = pat.sub("[REDACTED]", msg)
        record.msg, record.args = msg, ()
        return True


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"), "level": record.levelname,
               "logger": record.name, "msg": record.getMessage(), "request_id": getattr(record, "request_id", "-")}
        for key in ("method", "route", "status", "duration_ms", "workspace_id"):
            if hasattr(record, key):
                out[key] = getattr(record, key)
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def configure_logging() -> None:
    fmt = settings.log_format or ("json" if settings.is_production else "text")
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    handler.addFilter(RedactingFilter())
    handler.setFormatter(JsonFormatter() if fmt == "json" else
                         logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)   # request URLs of upstream calls aren't needed at INFO
