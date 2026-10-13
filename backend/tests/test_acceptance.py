"""The 30-step acceptance flow from the product brief, driven through the real HTTP API.

Real: FastAPI app, auth/OAuth code, sessions+CSRF, models, ingestion pipeline (extract/clean/chunk/embed/index), RAG,
guardrails, vector store (in-memory | embedded Qdrant | pgvector on real Postgres), widget frame/token/streaming, BYOK
encryption, usage ledger. Faked: Google's two network calls, the LLM, the embedding model (deterministic)."""
import io
import json
import os
import re
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.core.config import settings
from app.ingestion import pipeline
from app.ingestion.url_fetcher import FetchedPage
from app.models import Document, ProviderCredential, URLSource
from app.providers.storage.local import LocalStorage
from app.providers.vectorstores.memory_store import InMemoryVectorStore
from app.security.sessions import OAUTH_COOKIE, read_oauth_payload
from tests.conftest import make_tenant, TEST_DB
from tests.helpers import DIM
from tests.test_google_oauth_flow import FakeGoogleHttp
from tests.test_integration_widget import parse_sse

CUSTOMER_KEY = "sk-customer-owned-key-0123456789"
PLATFORM_KEY = "sk-platform-test-key"
SITE = "https://www.acme-plumbing.example"
SERVICES_DOC = (b"Acme Plumbing services\n\nWe provide emergency plumbing repairs, boiler installation and servicing, "
                b"drain cleaning and bathroom renovation for homes and small businesses across the city.\n\n"
                b"Our opening hours are 8am to 6pm Monday to Saturday.")
PAGE_TEXT = ("Welcome to Acme Plumbing. Our services include emergency plumbing repairs, boiler installation and "
             "servicing, drain cleaning and bathroom renovation. Call-outs are available 24 hours a day.")


@pytest.fixture(params=["memory", "qdrant", "pgvector"])
async def store(request, env, monkeypatch):
    if request.param == "memory":
        s = InMemoryVectorStore()
    elif request.param == "qdrant":
        from app.providers.vectorstores.qdrant_store import QdrantVectorStore
        s = QdrantVectorStore(":memory:")
    else:
        if TEST_DB != "postgres":
            pytest.skip("pgvector needs TEST_DB=postgres")
        from app.providers.vectorstores.pgvector_store import PgVectorStore
        s = PgVectorStore(request.getfixturevalue("pg_url"))
    await s.ensure_ready(DIM)
    for mod in ("app.api.chat", "app.api.widget", "app.api.knowledge", "app.api.unanswered"):
        monkeypatch.setattr(f"{mod}.get_vector_store", lambda s=s: s)
    yield s
    await s.close()


async def test_full_product_flow(client, env, store, tmp_path, monkeypatch):
    browser_bodies: list[str] = []          # everything a website visitor's browser can ever receive

    def seen(resp):
        browser_bodies.append(resp.text + json.dumps(dict(resp.headers)))
        return resp

    # the customer's own key is used (BYOK); capture which key each LLM instance is built with
    used_keys: list[str] = []
    monkeypatch.setattr("app.services.ai_config.build_llm", lambda name, key, **kw: (used_keys.append(key), env.llm)[1])
    monkeypatch.setattr("app.api.ai_config.build_llm", lambda name, key, **kw: env.llm)
    monkeypatch.setattr(settings, "encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    monkeypatch.setattr("app.api.knowledge.get_storage", lambda: LocalStorage(str(tmp_path)))
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr("app.api.auth.httpx.AsyncClient", FakeGoogleHttp)
    FakeGoogleHttp.fail = False
    claims = {"iss": "accounts.google.com", "sub": "sub-owner", "email": "owner@acme-plumbing.example",
              "email_verified": True, "name": "Olive Owner"}
    monkeypatch.setattr("app.api.auth.g_id_token.verify_oauth2_token", lambda t, r, a: {
        **claims, "nonce": read_oauth_payload(client.cookies[OAUTH_COOKIE])["nonce"]})

    # 1-3. open OmniBrain, "Continue with Google", account + workspace are created
    login = await client.get("/api/auth/google/login")
    assert urlparse(login.headers["location"]).netloc == "accounts.google.com"
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    cb = await client.get("/api/auth/google/callback", params={"code": "c", "state": state})
    assert cb.headers["location"].endswith("/dashboard")
    me = (await client.get("/api/auth/me")).json()
    ws_public_id, role = me["workspaces"][0]["public_id"], me["role"]
    assert role == "owner" and me["user"]["email"] == "owner@acme-plumbing.example"
    H = {"X-CSRF-Token": client.cookies["omnibrain_csrf"]}

    # 4-5. upload a company document and add a company URL
    up = await client.post("/api/knowledge/documents", headers=H, files={"file": ("services.txt", io.BytesIO(SERVICES_DOC), "text/plain")})
    assert up.status_code == 202 and up.json()["status"] == "queued"
    url = await client.post("/api/knowledge/urls", headers=H, json={"url": "https://8.8.8.8/services"})
    assert url.status_code == 202

    # 6-8. background processing: extract -> chunk -> embed -> store vectors -> mark ready
    async def fake_fetch(u): return FetchedPage("https://www.acme-plumbing.example/services", "Our services", PAGE_TEXT)
    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    storage = LocalStorage(str(tmp_path))
    await pipeline.process_document(env.sm, __import__("uuid").UUID(up.json()["id"]), embedder=env.embedder, store=store_obj(store), storage=storage)
    await pipeline.process_url(env.sm, __import__("uuid").UUID(url.json()["id"]), embedder=env.embedder, store=store_obj(store))
    docs = (await client.get("/api/knowledge/documents")).json()
    urls = (await client.get("/api/knowledge/urls")).json()
    assert docs[0]["status"] == "completed" and docs[0]["chunk_count"] >= 1
    assert urls[0]["status"] == "completed" and urls[0]["title"] == "Our services"
    kb = (await client.post("/api/knowledge/search", headers=H, json={"query": "emergency plumbing repairs"})).json()
    assert kb["confidence"] in ("known", "partial") and kb["hits"]

    # 9. select/configure the AI provider with the customer's own key (encrypted at rest, never echoed back)
    saved = await client.put("/api/ai-config/credentials/openai", headers=H, json={"api_key": CUSTOMER_KEY})
    assert saved.status_code == 200 and CUSTOMER_KEY not in saved.text
    cfg = await client.put("/api/ai-config", headers=H, json={"credential_mode": "byok", "llm_provider": "openai", "llm_model": "customer-model", "temperature": 0.1})
    assert cfg.json()["effective_model"] == "customer-model" and CUSTOMER_KEY not in cfg.text
    async with env.sm() as db:
        assert CUSTOMER_KEY not in (await db.execute(select(ProviderCredential))).scalar_one().encrypted_key

    # 10-14. Playground: "What services do we provide?" -> retrieved company knowledge -> grounded answer from the LLM
    pg = await client.post("/api/chat", headers=H, json={"message": "What services do we provide?"})
    assert pg.status_code == 200, pg.text
    body = pg.json()
    assert not body["fallback"] and body["answer"] == "Answer [1]" and body["provider"] == "openai" and body["model"] == "customer-model"
    assert {s["source_type"] for s in body["sources"]} <= {"document", "url"} and body["sources"]
    sent_context = env.llm.calls[-1].messages[-1].content
    assert "emergency plumbing repairs" in sent_context and "<context>" in sent_context
    assert used_keys[-1] == CUSTOMER_KEY and PLATFORM_KEY not in used_keys

    # 15-17. copy the snippet, allow the website, "paste" it: the loader and the chat frame load for that site only
    wc = await client.put("/api/widget-config", headers=H, json={"brand_name": "Acme Plumbing", "allowed_origins": [SITE], "suggested_questions": ["What services do you offer?"]})
    snippet = wc.json()["snippet"]
    assert re.fullmatch(r'<script async src="[^"]+/widget\.js" data-workspace="' + ws_public_id + '"></script>', snippet)
    assert "javascript" in seen(await client.get("/widget.js")).headers["content-type"]
    seen(await client.get("/widget/assets/frame.js")); seen(await client.get("/widget/assets/frame.css"))
    blocked = seen(await client.get("/widget/frame", params={"w": ws_public_id}, headers={"Referer": "https://evil.example/"}))
    assert blocked.status_code == 403
    frame = seen(await client.get("/widget/frame", params={"w": ws_public_id}, headers={"Referer": SITE + "/contact"}))
    assert frame.status_code == 200 and f"frame-ancestors {SITE}" in frame.headers["content-security-policy"]
    boot = json.loads(frame.text.split('id="boot">')[1].split("</script>")[0])
    assert boot["brand_name"] == "Acme Plumbing" and boot["suggested_questions"] == ["What services do you offer?"]
    V = {"Authorization": f"Bearer {boot['token']}", "X-Visitor-Id": "visitor-acme-0123456789"}

    # 18-23. a visitor asks; workspace is identified from the signed token; knowledge retrieved; LLM via configured
    #        provider; the answer streams back
    async with client.stream("POST", "/widget/v1/chat/stream", headers=V, json={"message": "Which plumbing repairs, boiler installation and drain cleaning services do you provide?", "source_page": SITE + "/contact"}) as r:
        raw = "".join([c async for c in r.aiter_text()])
    browser_bodies.append(raw)
    events = parse_sse(raw)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "meta" and kinds[-1] == "done" and "delta" in kinds and not events[-1]["fallback"]
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Answer [1]"
    assert used_keys[-1] == CUSTOMER_KEY and env.llm.calls[-1].model == "customer-model"
    assert events[-1]["sources"] == [{"index": 1, "name": "Our services", "url": "https://www.acme-plumbing.example/services"}] \
        or all(s["url"].startswith("https://") for s in events[-1]["sources"])          # only web sources are exposed
    conv_id = events[0]["conversation_id"]

    # 24-26. conversation stored; unknown question -> safe fallback; optional lead capture
    follow = seen(await client.post("/widget/v1/chat", headers=V, json={"message": "Do you repair spaceships on Mars?", "conversation_id": conv_id}))
    assert follow.json()["fallback"] is True and "don't have enough information" in follow.json()["answer"]
    lead = seen(await client.post("/widget/v1/lead", headers=V, json={"name": "Vera Visitor", "email": "vera@example.com", "question": "Do you repair spaceships on Mars?", "conversation_id": conv_id, "source_page": SITE + "/contact"}))
    assert lead.status_code == 201

    # 27. the business owner sees the conversation, the lead and the unanswered question
    convs = (await client.get("/api/conversations?channel=widget")).json()
    assert convs["total"] == 1 and convs["items"][0]["had_fallback"] and convs["items"][0]["message_count"] == 4
    detail = (await client.get(f"/api/conversations/{conv_id}")).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant", "user", "assistant"]
    leads = (await client.get("/api/leads")).json()
    assert leads["total"] == 1 and leads["items"][0]["email"] == "vera@example.com" and leads["items"][0]["conversation_id"] == conv_id
    gaps = (await client.get("/api/unanswered")).json()
    assert gaps["total"] == 1 and "spaceships" in gaps["items"][0]["question"] and gaps["items"][0]["frequency"] == 1

    # 28. usage is recorded (messages, tokens, per model) and visible
    usage = (await client.get("/api/usage?days=7")).json()
    assert usage["totals"]["messages"] == 3 and usage["totals"]["tokens_in"] > 0 and usage["totals"]["tokens_out"] > 0
    assert usage["by_model"][0]["model"] == "customer-model"
    overview = (await client.get("/api/overview")).json()
    assert overview["conversations_30d"] == 1 and overview["leads_30d"] == 1 and overview["open_unanswered"] == 1
    assert overview["setup"] == {"knowledge_added": True, "ai_selected": True, "tested_in_playground": True, "origins_configured": True, "widget_used": True}

    # 29. no API key (customer's or platform's) was ever sent to the browser side
    everything = "\n".join(browser_bodies)
    assert CUSTOMER_KEY not in everything and PLATFORM_KEY not in everything and "sk-" not in everything
    assert "encrypted_key" not in everything and "api_key" not in everything.lower().replace("x-visitor-id", "")

    # 30. a different tenant can never reach any of it
    other = await make_tenant(env.sm, "intruder@evil.example")
    oh = other["headers"]
    assert (await client.get("/api/conversations", headers=oh)).json()["total"] == 0
    assert (await client.get(f"/api/conversations/{conv_id}", headers=oh)).status_code == 404
    assert (await client.get("/api/leads", headers=oh)).json()["total"] == 0
    assert (await client.get("/api/unanswered", headers=oh)).json()["total"] == 0
    assert (await client.get("/api/knowledge/documents", headers=oh)).json() == []
    assert (await client.delete(f"/api/knowledge/documents/{docs[0]['id']}", headers=oh)).status_code == 404
    assert (await client.get("/api/ai-config", headers=oh)).json()["credentials"] == []
    steal = await client.post("/api/knowledge/search", headers=oh, json={"query": "emergency plumbing repairs boiler"})
    assert steal.json()["hits"] == []
    ask = await client.post("/api/chat", headers=oh, json={"message": "What services do you provide? plumbing repairs boiler"})
    assert ask.status_code in (200, 503) and "plumbing" not in ask.text.lower().replace("plumbing repairs boiler", "")
    other_ws = await make_tenant(env.sm, "intruder2@evil.example")
    from app.security import widget_auth
    foreign = {"Authorization": f"Bearer {widget_auth.mint_token(str(other_ws['ws_id']), SITE)}", "X-Visitor-Id": "visitor-acme-0123456789"}
    reuse = await client.post("/widget/v1/chat", headers=foreign, json={"message": "continue", "conversation_id": conv_id})
    assert reuse.status_code == 404


def store_obj(store):
    return store
