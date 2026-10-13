import time

import pytest
from fastapi import HTTPException

from app.core import ratelimit
from app.core.config import settings
from app.security import widget_auth as wa


def test_token_roundtrip_tamper_and_expiry(monkeypatch):
    t = wa.mint_token("ws-1", "https://shop.example.com")
    assert wa.verify_token(t) == {"w": "ws-1", "o": "https://shop.example.com"}
    assert wa.verify_token(t[:-3] + "abc") is None and wa.verify_token("junk") is None
    monkeypatch.setattr(settings, "widget_token_ttl_hours", 0)
    time.sleep(1.1)
    assert wa.verify_token(t) is None


def test_origin_matching(monkeypatch):
    allowed = ["https://shop.example.com", "https://*.example.org"]
    assert wa.origin_allowed("https://shop.example.com", allowed)
    assert wa.origin_allowed("https://a.b.example.org", allowed)
    assert not wa.origin_allowed("http://shop.example.com", allowed)           # scheme matters
    assert not wa.origin_allowed("https://shop.example.com:8443", allowed)     # port matters
    assert not wa.origin_allowed("https://evil.com/.example.org", allowed)
    assert not wa.origin_allowed("https://example.org", allowed)               # wildcard needs a subdomain
    assert not wa.origin_allowed(None, allowed)


def test_empty_allowlist_open_in_dev_closed_in_production(monkeypatch):
    assert wa.origin_allowed("https://any.com", [])
    monkeypatch.setattr(settings, "app_env", "production")
    assert not wa.origin_allowed("https://any.com", [])
    assert wa.frame_ancestors([]) == "'none'"


def test_frame_ancestors_lists_only_valid_origins():
    assert wa.frame_ancestors(["https://a.com", "bad value; script-src *"]) == "https://a.com"


def test_origin_from_referer():
    assert wa.origin_from_url("https://a.com/page?x=1") == "https://a.com"
    assert wa.origin_from_url("javascript:alert(1)") is None and wa.origin_from_url(None) is None


async def test_rate_limiter_blocks_after_limit_and_sets_retry_after(monkeypatch):
    lim = ratelimit.RateLimiter(ratelimit.MemoryBackend())
    monkeypatch.setattr(ratelimit, "get_limiter", lambda: lim)
    for _ in range(3):
        await ratelimit.enforce("k", 3)
    with pytest.raises(HTTPException) as e:
        await ratelimit.enforce("k", 3)
    assert e.value.status_code == 429 and int(e.value.headers["Retry-After"]) >= 1
    await ratelimit.enforce("other-key", 3)


async def test_rate_limiter_falls_back_when_redis_is_down():
    class Down:
        async def hit(self, *a): raise ConnectionError("redis down")
    lim = ratelimit.RateLimiter(Down())
    assert (await lim.hit("x", 60))[0] == 1 and (await lim.hit("x", 60))[0] == 2
