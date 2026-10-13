"""Approximate AI cost. Prices are NOT bundled (they change); set MODEL_PRICING_JSON, e.g.
{"openai:my-model": [0.15, 0.60]}  ->  [USD per 1M input tokens, USD per 1M output tokens]."""
import json
import logging
from functools import lru_cache

from app.core.config import settings

log = logging.getLogger(__name__)


@lru_cache
def _table() -> dict[str, tuple[float, float]]:
    if not settings.model_pricing_json:
        return {}
    try:
        return {k: (float(v[0]), float(v[1])) for k, v in json.loads(settings.model_pricing_json).items()}
    except (ValueError, TypeError, IndexError, AttributeError):
        log.error("MODEL_PRICING_JSON is invalid; cost estimates disabled")
        return {}


def pricing_configured() -> bool:
    return bool(_table())


def estimate_cost(provider: str, model: str, tokens_in: int, tokens_out: int) -> float | None:
    price = _table().get(f"{provider}:{model}")
    return None if price is None else round(tokens_in / 1e6 * price[0] + tokens_out / 1e6 * price[1], 6)
