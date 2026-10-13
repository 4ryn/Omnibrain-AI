import json

from sqlalchemy import select

from app.core.config import settings
from app.models import Message, UnansweredQuestion, WidgetConfiguration
from app.security import widget_auth
from tests.conftest import make_tenant, seed_knowledge

HOURS = "Our opening hours are 9am to 5pm Monday to Friday and we are closed on weekends."
VISITOR = "visitor-abcdefghij-123456"
ORIGIN = "https://customer.example.com"


async def _setup(env, allowed=None, **cfg):
    t = await make_tenant(env.sm, "owner@x.com")
    async with env.sm() as db:
        wc = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == t["ws_id"]))).scalar_one()
        wc.allowed_origins = allowed if allowed is not None else [ORIGIN]
        for k, v in cfg.items():
            setattr(wc, k, v)
        await db.commit()
    return t


def hdr(t_ws, origin=ORIGIN, visitor=VISITOR):
    return {"Authorization": f"Bearer {widget_auth.mint_token(str(t_ws), origin)}", "X-Visitor-Id": visitor}


def parse_sse(text: str) -> list[dict]:
    return [json.loads(b[6:]) for b in text.split("\n\n") if b.startswith("data: ")]


async def test_loader_and_assets_are_served(client, env):
    js = await client.get("/widget.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"] and "data-workspace" in js.text
    assert (await client.get("/widget/assets/frame.js")).status_code == 200
    assert (await client.get("/widget/assets/../../app/main.py")).status_code in (404, 422)
    assert (await client.get("/widget/assets/secret.txt")).status_code == 404


async def test_frame_served_to_allowed_origin_with_csp_and_no_secrets(client, env):
    t = await _setup(env, brand_name="Acme", suggested_questions=["Hours?"])
    r = await client.get("/widget/frame", params={"w": t["public_id"]}, headers={"Referer": f"{ORIGIN}/pricing"})
    assert r.status_code == 200
    csp = r.headers["content-security-policy"]
    assert f"frame-ancestors {ORIGIN}" in csp and "script-src 'self'" in csp and "'unsafe-inline'" not in csp
    boot = json.loads(r.text.split('id="boot">')[1].split("</script>")[0])
    assert boot["brand_name"] == "Acme" and widget_auth.verify_token(boot["token"])["o"] == ORIGIN
    assert "sk-platform-test-key" not in r.text and r.headers["cache-control"] == "no-store"


async def test_frame_refused_for_other_origins_and_unknown_workspace(client, env):
    t = await _setup(env)
    bad = await client.get("/widget/frame", params={"w": t["public_id"]}, headers={"Referer": "https://evil.example.net/"})
    none = await client.get("/widget/frame", params={"w": t["public_id"]})
    unknown = await client.get("/widget/frame", params={"w": "wk_doesnotexist"}, headers={"Referer": ORIGIN})
    assert bad.status_code == 403 and unknown.status_code == 404
    assert none.status_code == 403 or none.status_code == 200  # dev mode may fall back to ?o=
    spoof = await client.get("/widget/frame", params={"w": t["public_id"], "o": "https://evil.example.net"})
    assert spoof.status_code == 403


async def test_frame_closed_in_production_until_origins_configured(client, env, monkeypatch):
    t = await _setup(env, allowed=[])
    monkeypatch.setattr(settings, "app_env", "production")
    r = await client.get("/widget/frame", params={"w": t["public_id"]}, headers={"Referer": ORIGIN})
    assert r.status_code == 403


async def test_widget_chat_requires_valid_token_and_visitor(client, env):
    t = await _setup(env)
    body = {"message": "hi"}
    assert (await client.post("/widget/v1/chat", json=body)).status_code == 401
    assert (await client.post("/widget/v1/chat", json=body, headers={"Authorization": "Bearer junk", "X-Visitor-Id": VISITOR})).status_code == 401
    assert (await client.post("/widget/v1/chat", json=body, headers={"Authorization": hdr(t["ws_id"])["Authorization"]})).status_code == 400
    assert (await client.post("/widget/v1/chat", json=body, headers=hdr(t["ws_id"], visitor="short"))).status_code == 400


async def test_widget_chat_grounded_answer_hides_internal_file_sources(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    r = await client.post("/widget/v1/chat", json={"message": "What are your opening hours?", "source_page": f"{ORIGIN}/contact"}, headers=hdr(t["ws_id"]))
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == "Answer [1]" and r.json()["sources"] == []   # file source => not shown to visitors
    assert "internal-pricing" not in r.text and "provider" not in r.json()


async def test_widget_chat_exposes_only_url_sources(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS], url="https://customer.example.com/hours")
    r = await client.post("/widget/v1/chat", json={"message": "What are your opening hours?"}, headers=hdr(t["ws_id"]))
    assert r.json()["sources"] == [{"index": 1, "name": "Services page", "url": "https://customer.example.com/hours"}]


async def test_widget_stream_emits_ordered_sse_events_and_persists(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    async with client.stream("POST", "/widget/v1/chat/stream", json={"message": "What are your opening hours?"}, headers=hdr(t["ws_id"])) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        raw = "".join([c async for c in r.aiter_text()])
    events = parse_sse(raw)
    assert [e["type"] for e in events] == ["meta", "delta", "delta", "done"]
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Answer [1]"
    assert "provider" not in events[-1] and "latency_ms" not in events[-1]
    async with env.sm() as db:
        assert [m.role for m in (await db.execute(select(Message).order_by(Message.created_at))).scalars()] == ["user", "assistant"]


async def test_unknown_widget_question_falls_back_and_is_tracked_as_knowledge_gap(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    for _ in range(2):
        r = await client.post("/widget/v1/chat", json={"message": "Do you ship to Mars?"}, headers=hdr(t["ws_id"]))
        assert r.json()["fallback"] is True and "don't have enough information" in r.json()["answer"]
    assert env.llm.calls == []
    async with env.sm() as db:
        row = (await db.execute(select(UnansweredQuestion))).scalar_one()
        assert row.frequency == 2 and row.workspace_id == t["ws_id"]


async def test_visitors_cannot_read_or_continue_each_others_conversations(client, env):
    t, other = await _setup(env), await make_tenant(env.sm, "other@x.com")
    await seed_knowledge(env, t["ws_id"], [HOURS])
    conv = (await client.post("/widget/v1/chat", json={"message": "opening hours?"}, headers=hdr(t["ws_id"]))).json()["conversation_id"]
    same = await client.post("/widget/v1/chat", json={"message": "and weekends?", "conversation_id": conv}, headers=hdr(t["ws_id"]))
    other_visitor = await client.post("/widget/v1/chat", json={"message": "x", "conversation_id": conv}, headers=hdr(t["ws_id"], visitor="another-visitor-1234567"))
    other_ws = await client.post("/widget/v1/chat", json={"message": "x", "conversation_id": conv}, headers=hdr(other["ws_id"]))
    assert same.status_code == 200 and other_visitor.status_code == 404 and other_ws.status_code == 404


async def test_widget_never_leaks_config_errors_or_provider_details(client, env, monkeypatch):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    monkeypatch.setattr(settings, "openai_api_key", "")               # platform key missing
    r = await client.post("/widget/v1/chat", json={"message": "opening hours?"}, headers=hdr(t["ws_id"]))
    assert r.status_code == 503 and r.json()["detail"] == "The assistant is temporarily unavailable. Please try again shortly."
    async with client.stream("POST", "/widget/v1/chat/stream", json={"message": "opening hours?"}, headers=hdr(t["ws_id"])) as s:
        events = parse_sse("".join([c async for c in s.aiter_text()]))
    assert events[-1] == {"type": "error", "message": "The assistant is temporarily unavailable. Please try again shortly."}


async def test_widget_ignores_provider_override_attempts(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    await client.post("/widget/v1/chat", json={"message": "opening hours?", "provider": "anthropic", "model": "hacked"}, headers=hdr(t["ws_id"]))
    assert env.llm.calls[0].model == "test-model"


async def test_widget_rate_limits_per_visitor_and_per_ip(client, env, monkeypatch):
    t = await _setup(env)
    monkeypatch.setattr(settings, "rl_widget_visitor_per_min", 2)
    codes = [(await client.post("/widget/v1/chat", json={"message": "quantum chromodynamics"}, headers=hdr(t["ws_id"]))).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    other_visitor = await client.post("/widget/v1/chat", json={"message": "quantum chromodynamics"}, headers=hdr(t["ws_id"], visitor="second-visitor-0123456"))
    assert other_visitor.status_code == 200
    monkeypatch.setattr(settings, "rl_widget_ip_per_min", 1)
    r = await client.post("/widget/v1/chat", json={"message": "x"}, headers=hdr(t["ws_id"], visitor="third-visitor-01234567"))
    assert r.status_code == 429 and "retry-after" in r.headers


async def test_message_validation(client, env):
    t = await _setup(env)
    assert (await client.post("/widget/v1/chat", json={"message": ""}, headers=hdr(t["ws_id"]))).status_code == 422
    assert (await client.post("/widget/v1/chat", json={"message": "x" * 2001}, headers=hdr(t["ws_id"]))).status_code == 422
    assert (await client.post("/widget/v1/chat", json={"message": "hi", "conversation_id": "not-a-uuid"}, headers=hdr(t["ws_id"]))).status_code == 422


async def test_voice_endpoints_are_gated_by_workspace_setting(client, env):
    t = await _setup(env, voice_enabled=False)
    r = await client.post("/widget/v1/voice/speak", json={"text": "hello"}, headers=hdr(t["ws_id"]))
    assert r.status_code == 403
    r = await client.post("/widget/v1/voice/transcribe", files={"audio": ("a.webm", b"123", "audio/webm")}, headers=hdr(t["ws_id"]))
    assert r.status_code == 403
