import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from app.api import (ai_config, auth, chat, conversations, insights, knowledge, leads, unanswered, widget,
                     widget_config, workspace)
from app.core import metrics
from app.core.config import settings
from app.core.database import engine
from app.core.logging import configure_logging
from app.core.middleware import ObservabilityMiddleware

configure_logging()
log = logging.getLogger("omnibrain")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:  # the API must still boot if the vector store is down; /health/ready reports it, ingestion reports errors
        from app.providers.vectorstores.factory import get_vector_store
        await get_vector_store().ensure_ready(settings.embedding_dimensions)
    except Exception:
        log.exception("Vector store not ready at startup")
    yield
    await engine.dispose()


app = FastAPI(title="OmniBrain AI", version="1.0.0", lifespan=lifespan,
              docs_url=None if settings.is_production else "/docs", redoc_url=None,
              openapi_url=None if settings.is_production else "/openapi.json")

# Dashboard origin only (credentialed). The dashboard normally reaches the API through its own /api proxy,
# so this is just a safety net. Public widget routes are same-origin from the iframe and need no CORS.
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_url], allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Content-Type", "X-CSRF-Token", "X-Workspace-Id"])
app.add_middleware(ObservabilityMiddleware)   # outermost: request ids, access log, metrics, size limits, headers

for module in (auth, knowledge, ai_config, chat, widget, widget_config, conversations, leads, unanswered,
               insights, workspace):
    app.include_router(module.router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    """Return field errors without echoing submitted values (which may contain API keys or personal data)."""
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


@app.get("/health")
async def health():
    """Liveness: the process is up."""
    return {"status": "ok"}


@app.get("/health/ready")
async def ready():
    """Readiness: dependencies. 503 only when the database is down (the app can't serve anything without it);
    other failures are reported as 'degraded' so one flaky dependency doesn't take every instance out of rotation."""
    checks: dict[str, str] = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        log.exception("Readiness: database check failed")
        return JSONResponse({"status": "unavailable", "checks": {"database": "down"}}, status_code=503)
    try:
        import redis.asyncio as redis
        client = redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        await client.ping()
        await client.aclose()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "down"
    try:
        from app.providers.vectorstores.factory import get_vector_store
        await get_vector_store().healthcheck()
        checks["vector_store"] = "ok"
    except Exception:
        checks["vector_store"] = "down"
    return {"status": "ok" if all(v == "ok" for v in checks.values()) else "degraded", "checks": checks}


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics(request: Request):
    """Disabled (404) unless METRICS_TOKEN is set; then requires `Authorization: Bearer <token>`."""
    if not settings.metrics_token:
        return Response(status_code=404)
    supplied = request.headers.get("authorization", "")[7:]
    if not hmac.compare_digest(supplied, settings.metrics_token):
        return Response(status_code=401)
    return Response(metrics.render(), media_type="text/plain; version=0.0.4")
