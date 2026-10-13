import logging
import time
from functools import lru_cache

from fastapi import HTTPException, Request

from app.core import metrics
from app.core.config import settings

log = logging.getLogger(__name__)


class MemoryBackend:
    def __init__(self) -> None:
        self._d: dict[str, tuple[int, float]] = {}

    async def hit(self, key: str, window: int) -> tuple[int, int]:
        now = time.monotonic()
        count, reset = self._d.get(key, (0, 0.0))
        if now >= reset:
            count, reset = 0, now + window
        count += 1
        self._d[key] = (count, reset)
        if len(self._d) > 50_000:
            self._d = {k: v for k, v in self._d.items() if v[1] > now}
        return count, max(1, int(reset - now))


class RedisBackend:
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis
        self._r = redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)

    async def hit(self, key: str, window: int) -> tuple[int, int]:
        count = await self._r.incr(key)
        if count == 1:
            await self._r.expire(key, window)
        ttl = await self._r.ttl(key)
        if ttl < 0:
            await self._r.expire(key, window)
            ttl = window
        return int(count), int(ttl)


class RateLimiter:
    """Redis-backed fixed window; if Redis is down, degrade to a per-process limiter (never fail open)."""

    def __init__(self, backend, fallback: MemoryBackend | None = None) -> None:
        self.backend, self.fallback = backend, fallback or MemoryBackend()

    async def hit(self, key: str, window: int) -> tuple[int, int]:
        try:
            return await self.backend.hit(key, window)
        except Exception as exc:
            log.warning("Rate-limit backend unavailable (%s); using in-process fallback", type(exc).__name__)
            return await self.fallback.hit(key, window)


@lru_cache
def get_limiter() -> RateLimiter:
    return RateLimiter(RedisBackend(settings.redis_url))


async def enforce(key: str, limit: int, window: int = 60) -> None:
    count, ttl = await get_limiter().hit(f"rl:{key}", window)
    if count > limit:
        metrics.RATE_LIMITED.labels(key.split(":")[0]).inc()
        raise HTTPException(429, "Too many requests. Please slow down.", headers={"Retry-After": str(ttl)})


def client_ip(request: Request) -> str:
    n = settings.trusted_proxies
    if n > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= n:
            return parts[-n]
    return request.client.host if request.client else "unknown"
