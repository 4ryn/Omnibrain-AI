import io

from sqlalchemy import func, select

from app.models import (APIConfiguration, Conversation, Document, Message, ProviderCredential, UnansweredQuestion, UsageRecord)
from tests.conftest import make_tenant, seed_knowledge

HOURS = "Our opening hours are 9am to 5pm Monday to Friday and we are closed on weekends."


async def test_unauthenticated_and_missing_csrf_are_rejected(client, env):
    assert (await client.get("/api/knowledge/documents")).status_code == 401
    a = await make_tenant(env.sm, "a@x.com")
    r = await client.post("/api/chat", json={"message": "hi"}, headers={"Cookie": a["headers"]["Cookie"]})
    assert r.status_code == 403


async def test_documents_are_isolated_between_workspaces(client, env):
    a, b = await make_tenant(env.sm, "a@x.com"), await make_tenant(env.sm, "b@x.com")
    up = await client.post("/api/knowledge/documents", headers=a["headers"],
                           files={"file": ("faq.txt", io.BytesIO(b"We sell widgets."), "text/plain")})
    assert up.status_code == 202, up.text
    doc_id = up.json()["id"]
    assert len((await client.get("/api/knowledge/documents", headers=a["headers"])).json()) == 1
    assert (await client.get("/api/knowledge/documents", headers=b["headers"])).json() == []
    for method, path in (("delete", f"/api/knowledge/documents/{doc_id}"), ("post", f"/api/knowledge/documents/{doc_id}/reindex")):
        r = await getattr(client, method)(path, headers=b["headers"])
        assert r.status_code == 404, (method, r.status_code)       # same answer as "doesn't exist"
    assert (await client.delete(f"/api/knowledge/documents/{doc_id}", headers=a["headers"])).status_code == 204


async def test_upload_validation(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    h = a["headers"]
    bad_ext = await client.post("/api/knowledge/documents", headers=h, files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")})
    fake_pdf = await client.post("/api/knowledge/documents", headers=h, files={"file": ("x.pdf", io.BytesIO(b"not a pdf"), "application/pdf")})
    empty = await client.post("/api/knowledge/documents", headers=h, files={"file": ("x.txt", io.BytesIO(b""), "text/plain")})
    ok = await client.post("/api/knowledge/documents", headers=h, files={"file": ("../../etc/passwd.txt", io.BytesIO(b"hello"), "text/plain")})
    dup = await client.post("/api/knowledge/documents", headers=h, files={"file": ("again.txt", io.BytesIO(b"hello"), "text/plain")})
    assert [bad_ext.status_code, fake_pdf.status_code, empty.status_code, ok.status_code, dup.status_code] == [415, 415, 400, 202, 409]
    assert "/" not in ok.json()["filename"]


async def test_url_ingestion_rejects_internal_addresses(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    r = await client.post("/api/knowledge/urls", headers=a["headers"], json={"url": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 400


async def test_ai_config_byok_key_is_encrypted_and_never_returned(client, env, monkeypatch):
    from cryptography.fernet import Fernet
    from app.core.config import settings
    monkeypatch.setattr(settings, "encryption_key", Fernet.generate_key().decode())
    a = await make_tenant(env.sm, "a@x.com")
    r = await client.put("/api/ai-config/credentials/anthropic", headers=a["headers"], json={"api_key": "sk-ant-customer-secret-9999"})
    assert r.status_code == 200 and r.json() == {"provider": "anthropic", "key_hint": "…9999"}
    cfg = await client.put("/api/ai-config", headers=a["headers"], json={"credential_mode": "byok", "llm_provider": "anthropic", "llm_model": "m-x", "temperature": 0.1})
    got = await client.get("/api/ai-config", headers=a["headers"])
    for resp in (cfg, got):
        assert "customer-secret" not in resp.text and resp.json()["credentials"][0]["key_hint"] == "…9999"
    assert got.json()["effective_provider"] == "anthropic" and got.json()["effective_model"] == "m-x"
    async with env.sm() as db:
        stored = (await db.execute(select(ProviderCredential))).scalar_one()
        assert "customer-secret" not in stored.encrypted_key
    other = await make_tenant(env.sm, "b@x.com")
    assert (await client.get("/api/ai-config", headers=other["headers"])).json()["credentials"] == []


async def test_byok_mode_without_key_never_uses_platform_key(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    await client.put("/api/ai-config", headers=a["headers"], json={"credential_mode": "byok"})
    r = await client.post("/api/chat", headers=a["headers"], json={"message": "What are your opening hours?"})
    assert r.status_code == 503 and "No API key" in r.json()["detail"] and env.llm.calls == []


async def test_rejected_key_is_not_saved(client, env, monkeypatch):
    async def reject(): return False
    monkeypatch.setattr(env.llm, "validate_credentials", reject)
    a = await make_tenant(env.sm, "a@x.com")
    r = await client.put("/api/ai-config/credentials/openai", headers=a["headers"], json={"api_key": "sk-wrong-key-123456"})
    assert r.status_code == 400
    async with env.sm() as db:
        assert (await db.execute(select(func.count()).select_from(ProviderCredential))).scalar() == 0


async def test_playground_chat_grounded_answer_persisted_with_usage(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    r = await client.post("/api/chat", headers=a["headers"], json={"message": "What are your opening hours?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "Answer [1]" and not body["fallback"] and body["provider"] == "openai" and body["model"] == "test-model"
    assert body["sources"][0]["source_name"] == "internal-pricing.pdf" and body["latency_ms"] >= 0
    assert "<context>" in env.llm.calls[0].messages[-1].content
    async with env.sm() as db:
        msgs = (await db.execute(select(Message).order_by(Message.created_at))).scalars().all()
        assert [m.role for m in msgs] == ["user", "assistant"]
        metrics = {u.metric: u.quantity for u in (await db.execute(select(UsageRecord))).scalars()}
        assert metrics == {"message": 1, "tokens_in": 10, "tokens_out": 3}


async def test_playground_unknown_question_falls_back_without_llm_call(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    r = await client.post("/api/chat", headers=a["headers"], json={"message": "quantum chromodynamics lattice gauge"})
    assert r.json()["fallback"] is True and env.llm.calls == []


async def test_conversation_cannot_be_continued_by_another_workspace(client, env):
    a, b = await make_tenant(env.sm, "a@x.com"), await make_tenant(env.sm, "b@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    conv = (await client.post("/api/chat", headers=a["headers"], json={"message": "opening hours?"})).json()["conversation_id"]
    r = await client.post("/api/chat", headers=b["headers"], json={"message": "hi", "conversation_id": conv})
    assert r.status_code == 404
    r = await client.post("/api/chat/stream", headers=b["headers"], json={"message": "hi", "conversation_id": conv})
    assert r.status_code == 404


async def test_workspace_b_never_retrieves_workspace_a_knowledge(client, env):
    a, b = await make_tenant(env.sm, "a@x.com"), await make_tenant(env.sm, "b@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    r = await client.post("/api/chat", headers=b["headers"], json={"message": "What are your opening hours?"})
    assert r.json()["fallback"] is True and env.llm.calls == []
    s = await client.post("/api/knowledge/search", headers=b["headers"], json={"query": "opening hours"})
    assert s.json()["hits"] == []


async def test_provider_failure_returns_clean_error_and_logs_nothing_sensitive(client, env, monkeypatch):
    from app.providers.llm.base import ProviderError

    async def boom(req): raise ProviderError("The AI provider is temporarily unavailable.", "HTTP 503 raw upstream body", True)
    monkeypatch.setattr(env.llm, "generate", boom)
    a = await make_tenant(env.sm, "a@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    r = await client.post("/api/chat", headers=a["headers"], json={"message": "What are your opening hours?"})
    assert r.status_code == 503 and r.json()["detail"] == "The AI provider is temporarily unavailable."
    assert "raw upstream" not in r.text


async def test_dashboard_chat_is_rate_limited(client, env, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "rl_dashboard_chat_per_min", 2)
    a = await make_tenant(env.sm, "a@x.com")
    codes = [(await client.post("/api/chat", headers=a["headers"], json={"message": "quantum chromodynamics"})).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


async def test_model_override_is_honoured_in_playground(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    await seed_knowledge(env, a["ws_id"], [HOURS])
    r = await client.post("/api/chat", headers=a["headers"], json={"message": "opening hours?", "provider": "openai", "model": "other-model"})
    assert r.json()["model"] == "other-model" and env.llm.calls[0].model == "other-model"
    bad = await client.post("/api/chat", headers=a["headers"], json={"message": "x", "provider": "nope"})
    assert bad.status_code == 400
