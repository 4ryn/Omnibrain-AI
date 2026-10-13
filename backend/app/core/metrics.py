"""Prometheus metrics. Exposed at /metrics (bearer-token protected, disabled unless METRICS_TOKEN is set).
Note: Celery workers are separate processes; ingestion outcomes are also persisted in the database."""
from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest

REGISTRY = CollectorRegistry()
_LAT = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60)

HTTP_REQUESTS = Counter("omnibrain_http_requests_total", "HTTP requests", ["method", "route", "status"], registry=REGISTRY)
HTTP_LATENCY = Histogram("omnibrain_http_request_seconds", "HTTP request latency", ["method", "route"], buckets=_LAT, registry=REGISTRY)
RETRIEVAL_LATENCY = Histogram("omnibrain_retrieval_seconds", "RAG retrieval latency", buckets=_LAT, registry=REGISTRY)
LLM_LATENCY = Histogram("omnibrain_llm_seconds", "LLM generation latency", ["provider"], buckets=_LAT, registry=REGISTRY)
LLM_TOKENS = Counter("omnibrain_llm_tokens_total", "LLM tokens", ["provider", "model", "direction"], registry=REGISTRY)
PROVIDER_ERRORS = Counter("omnibrain_provider_errors_total", "LLM provider failures", ["provider"], registry=REGISTRY)
DEPENDENCY_ERRORS = Counter("omnibrain_dependency_errors_total", "Dependency failures", ["dependency"], registry=REGISTRY)
CHAT_MESSAGES = Counter("omnibrain_chat_messages_total", "Chat turns", ["channel", "outcome"], registry=REGISTRY)
INGESTION_JOBS = Counter("omnibrain_ingestion_jobs_total", "Ingestion jobs", ["kind", "status"], registry=REGISTRY)
WIDGET_EVENTS = Counter("omnibrain_widget_events_total", "Widget events", ["event"], registry=REGISTRY)
RATE_LIMITED = Counter("omnibrain_rate_limited_total", "Rate-limited requests", ["scope"], registry=REGISTRY)
PROMPT_INJECTION = Counter("omnibrain_prompt_injection_suspected_total", "Suspected prompt-injection attempts", registry=REGISTRY)
AI_COST = Counter("omnibrain_ai_cost_usd_total", "Approximate AI cost", ["source"], registry=REGISTRY)


def render() -> bytes:
    return generate_latest(REGISTRY)
