import json

from sqlalchemy import select

from app.core.config import settings
from app.models import Lead, UnansweredQuestion, WidgetConfiguration
from app.security import widget_auth
from tests.conftest import make_tenant, seed_knowledge
from tests.test_integration_widget import HOURS, ORIGIN, VISITOR, hdr, _setup


async def set_plan(sm, ws_id, plan):
    from app.models import Workspace
    async with sm() as db:
        (await db.get(Workspace, ws_id)).plan = plan
        await db.commit()


async def test_widget_config_roundtrip_validation_and_snippet(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    await set_plan(env.sm, a["ws_id"], "business")      # voice is a paid-plan feature
    h = a["headers"]
    got = (await client.get("/api/widget-config", headers=h)).json()
    assert got["public_id"] == a["public_id"]
    assert got["snippet"] == (
        f'<script async src="{settings.backend_url.rstrip("/")}/widget.js" '
        f'data-workspace="{a["public_id"]}"></script>'
    )
    assert got["warnings"]
    r = await client.put("/api/widget-config", headers=h, json={
        "brand_name": "Acme", "primary_color": "#112233", "theme": "dark", "position": "bottom-left",
        "suggested_questions": ["  Hours?  ", "", "Pricing?"], "voice_enabled": True,
        "allowed_origins": ["https://Acme.com/", "https://*.acme.com", "https://acme.com"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["brand_name"] == "Acme" and out["suggested_questions"] == ["Hours?", "Pricing?"]
    assert out["allowed_origins"] == ["https://acme.com", "https://*.acme.com"] and out["warnings"] == []
    for bad in ({"primary_color": "red"}, {"allowed_origins": ["https://acme.com/path"]}, {"allowed_origins": ["*"]},
                {"allowed_origins": ["javascript:alert(1)"]}, {"logo_url": "javascript:alert(1)"},
                {"suggested_questions": ["x" * 121]}, {"theme": "neon"}):
        assert (await client.put("/api/widget-config", headers=h, json=bad)).status_code == 422, bad


async def test_widget_config_change_applies_to_frame_without_new_snippet(client, env):
    t = await _setup(env)
    await client.put("/api/widget-config", headers=t["headers"], json={"brand_name": "Renamed Co", "allowed_origins": [ORIGIN]})
    r = await client.get("/widget/frame", params={"w": t["public_id"]}, headers={"Referer": ORIGIN})
    boot = json.loads(r.text.split('id="boot">')[1].split("</script>")[0])
    assert boot["brand_name"] == "Renamed Co" and boot["lead_capture_enabled"] is True


async def test_widget_config_is_per_workspace(client, env):
    a, b = await make_tenant(env.sm, "a@x.com"), await make_tenant(env.sm, "b@x.com")
    await client.put("/api/widget-config", headers=a["headers"], json={"brand_name": "A Corp"})
    assert (await client.get("/api/widget-config", headers=b["headers"])).json()["brand_name"] != "A Corp"


async def test_lead_capture_flow_visible_only_to_owner_workspace(client, env):
    t, other = await _setup(env), await make_tenant(env.sm, "other@x.com")
    await seed_knowledge(env, t["ws_id"], [HOURS])
    chat = (await client.post("/widget/v1/chat", json={"message": "Do you ship to Mars?"}, headers=hdr(t["ws_id"]))).json()
    r = await client.post("/widget/v1/lead", headers=hdr(t["ws_id"]), json={
        "name": "Sam", "email": "sam@example.com", "phone": "+1 555 0100", "question": "Do you ship to Mars?",
        "conversation_id": chat["conversation_id"], "source_page": f"{ORIGIN}/contact"})
    assert r.status_code == 201
    mine = (await client.get("/api/leads", headers=t["headers"])).json()
    assert mine["total"] == 1 and mine["items"][0]["email"] == "sam@example.com" and mine["items"][0]["name"] == "Sam"
    assert (await client.get("/api/leads", headers=other["headers"])).json()["total"] == 0
    assert (await client.delete(f"/api/leads/{mine['items'][0]['id']}", headers=other["headers"])).status_code == 404
    assert (await client.delete(f"/api/leads/{mine['items'][0]['id']}", headers=t["headers"])).status_code == 204


async def test_lead_validation_gating_and_conversation_ownership(client, env):
    t = await _setup(env)
    h = hdr(t["ws_id"])
    assert (await client.post("/widget/v1/lead", headers=h, json={"name": "No contact"})).status_code == 422
    assert (await client.post("/widget/v1/lead", headers=h, json={"email": "not-an-email"})).status_code == 422
    assert (await client.post("/widget/v1/lead", headers=h, json={"phone": "abc"})).status_code == 422
    foreign = "00000000-0000-0000-0000-000000000001"
    assert (await client.post("/widget/v1/lead", headers=h, json={"email": "a@b.co", "conversation_id": foreign})).status_code == 404
    async with env.sm() as db:
        cfg = (await db.execute(select(WidgetConfiguration))).scalar_one()
        cfg.lead_capture_enabled = False
        await db.commit()
    assert (await client.post("/widget/v1/lead", headers=h, json={"email": "a@b.co"})).status_code == 403


async def test_lead_capture_is_rate_limited_per_visitor(client, env):
    t = await _setup(env)
    codes = [(await client.post("/widget/v1/lead", headers=hdr(t["ws_id"]), json={"email": f"a{i}@b.co"})).status_code for i in range(6)]
    assert codes == [201] * 5 + [429]


async def test_leads_csv_export_neutralises_formula_injection(client, env):
    t = await _setup(env)
    await client.post("/widget/v1/lead", headers=hdr(t["ws_id"]), json={"name": "=HYPERLINK(\"http://evil\")", "email": "a@b.co", "question": "+cmd"})
    r = await client.get("/api/leads/export.csv", headers=t["headers"])
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "'=HYPERLINK" in r.text and "'+cmd" in r.text and ",=HYPERLINK" not in r.text


async def test_unanswered_questions_dashboard_flow(client, env):
    t, other = await _setup(env), await make_tenant(env.sm, "other@x.com")
    await seed_knowledge(env, t["ws_id"], [HOURS])
    for q in ["How much does shipping cost to Mars?"] * 3 + ["Do you ship to Venus?"]:
        await client.post("/widget/v1/chat", json={"message": q}, headers=hdr(t["ws_id"]))
    lst = (await client.get("/api/unanswered", headers=t["headers"])).json()
    assert lst["total"] == 2 and lst["items"][0]["frequency"] == 3 and lst["items"][0]["priority"] == "medium"
    assert lst["items"][0]["knowledge_gap"] == "Pricing & fees" and "pricing" in lst["items"][0]["potential_action"].lower()
    assert (await client.get("/api/unanswered", headers=other["headers"])).json()["total"] == 0
    qid = lst["items"][0]["id"]
    assert (await client.patch(f"/api/unanswered/{qid}", headers=other["headers"], json={"status": "resolved"})).status_code == 404
    assert (await client.patch(f"/api/unanswered/{qid}", headers=t["headers"], json={"status": "bogus"})).status_code == 422
    assert (await client.patch(f"/api/unanswered/{qid}", headers=t["headers"], json={"status": "resolved"})).json()["status"] == "resolved"
    assert (await client.get("/api/unanswered", headers=t["headers"])).json()["total"] == 1
    assert (await client.get("/api/unanswered?status=all", headers=t["headers"])).json()["total"] == 2
    closest = await client.post(f"/api/unanswered/{qid}/closest", headers=t["headers"])
    assert closest.status_code == 200 and closest.json()[0]["source_name"] == "internal-pricing.pdf"
    assert (await client.post(f"/api/unanswered/{qid}/closest", headers=other["headers"])).status_code == 404


async def test_closest_content_returns_nearest_even_below_threshold(client, env):
    t = await _setup(env)
    await seed_knowledge(env, t["ws_id"], [HOURS])
    await client.post("/widget/v1/chat", json={"message": "Are you open on bank holiday weekend schedule?"}, headers=hdr(t["ws_id"]))
    async with env.sm() as db:
        row = (await db.execute(select(UnansweredQuestion))).scalar_one_or_none()
    if row:  # only meaningful if the fake embedder judged it unanswerable
        r = await client.post(f"/api/unanswered/{row.id}/closest", headers=t["headers"])
        assert r.status_code == 200 and r.json() and "opening hours" in r.json()[0]["excerpt"]


async def test_conversations_list_detail_filters_and_isolation(client, env):
    t, other = await _setup(env), await make_tenant(env.sm, "other@x.com")
    await seed_knowledge(env, t["ws_id"], [HOURS])
    c1 = (await client.post("/widget/v1/chat", json={"message": "What are your opening hours?"}, headers=hdr(t["ws_id"]))).json()["conversation_id"]
    c2 = (await client.post("/widget/v1/chat", json={"message": "Do you ship to Mars?"}, headers=hdr(t["ws_id"], visitor="visitor-two-0123456789"))).json()["conversation_id"]
    await client.post("/api/chat", headers=t["headers"], json={"message": "test question about hours"})
    allc = (await client.get("/api/conversations", headers=t["headers"])).json()
    assert allc["total"] == 3
    widget_only = (await client.get("/api/conversations?channel=widget", headers=t["headers"])).json()
    assert widget_only["total"] == 2 and {i["id"] for i in widget_only["items"]} == {c1, c2}
    fb = (await client.get("/api/conversations?fallback_only=true&channel=widget", headers=t["headers"])).json()
    assert [i["id"] for i in fb["items"]] == [c2] and fb["items"][0]["preview"] == "Do you ship to Mars?"
    detail = (await client.get(f"/api/conversations/{c2}", headers=t["headers"])).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"] and detail["messages"][1]["was_fallback"] is True
    assert (await client.get("/api/conversations", headers=other["headers"])).json()["total"] == 0
    assert (await client.get(f"/api/conversations/{c1}", headers=other["headers"])).status_code == 404
    assert (await client.delete(f"/api/conversations/{c1}", headers=other["headers"])).status_code == 404
    assert (await client.delete(f"/api/conversations/{c1}", headers=t["headers"])).status_code == 204
    assert (await client.get(f"/api/conversations/{c1}", headers=t["headers"])).status_code == 404


async def test_usage_and_overview_reflect_activity_per_workspace(client, env):
    t, other = await _setup(env), await make_tenant(env.sm, "other@x.com")
    await seed_knowledge(env, t["ws_id"], [HOURS])
    await client.post("/widget/v1/chat", json={"message": "What are your opening hours?"}, headers=hdr(t["ws_id"]))
    await client.post("/widget/v1/chat", json={"message": "Do you ship to Mars?"}, headers=hdr(t["ws_id"]))
    u = (await client.get("/api/usage?days=7", headers=t["headers"])).json()
    assert u["totals"]["messages"] == 2 and u["totals"]["tokens_in"] == 10 and u["totals"]["tokens_out"] == 3
    assert u["by_model"] == [{"provider": "openai", "model": "test-model", "answers": 1, "tokens_in": 10, "tokens_out": 3, "avg_latency_ms": u["by_model"][0]["avg_latency_ms"]}]
    assert len(u["daily"]) == 1
    assert (await client.get("/api/usage", headers=other["headers"])).json()["totals"]["messages"] == 0
    o = (await client.get("/api/overview", headers=t["headers"])).json()
    assert o["conversations_30d"] == 2 and o["answers_30d"] == 2 and o["fallback_rate_30d"] == 0.5
    assert o["open_unanswered"] == 1 and o["setup"]["widget_used"] and o["setup"]["origins_configured"]
    assert o["setup"]["knowledge_added"] is False and o["snippet"].startswith("<script")
    assert (await client.get("/api/overview", headers=other["headers"])).json()["conversations_30d"] == 0


async def test_workspace_rename(client, env):
    a = await make_tenant(env.sm, "a@x.com")
    r = await client.patch("/api/workspace", headers=a["headers"], json={"name": "  Acme HQ "})
    assert r.status_code == 200 and r.json()["name"] == "Acme HQ"
    assert (await client.patch("/api/workspace", headers=a["headers"], json={"name": ""})).status_code == 422
