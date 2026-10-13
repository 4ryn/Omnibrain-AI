"""Tenant isolation under concurrent load (real Postgres: genuine concurrent connections, FK enforcement)."""
import asyncio
import uuid

import pytest

from tests.conftest import TEST_DB, seed_knowledge
from tests.test_integration_widget import ORIGIN, _setup, hdr
from tests.conftest import make_tenant
from sqlalchemy import select
from app.models import UsageRecord, Message, WidgetConfiguration

pytestmark = pytest.mark.skipif(TEST_DB != "postgres", reason="needs TEST_DB=postgres")


async def test_concurrent_visitors_of_different_tenants_never_see_each_others_knowledge(client, env):
    markers = ["ALPHACORP", "BETACORP", "GAMMACORP"]
    tenants = []
    for i, m in enumerate(markers):
        t = await make_tenant(env.sm, f"t{i}@x.com")
        async with env.sm() as db:
            wc = (await db.execute(select(WidgetConfiguration).where(WidgetConfiguration.workspace_id == t["ws_id"]))).scalar_one()
            wc.allowed_origins = [ORIGIN]
            await db.commit()
        await seed_knowledge(env, t["ws_id"], [f"{m} opening hours are nine to five Monday to Friday every week of the year."])
        tenants.append((m, t))

    async def ask(t, n):
        r = await client.post("/widget/v1/chat", headers=hdr(t["ws_id"], visitor=f"visitor-{uuid.uuid4().hex[:20]}"),
                              json={"message": "What are your opening hours Monday to Friday?"})
        return r.status_code

    jobs = [ask(t, n) for n in range(10) for _, t in tenants]
    codes = await asyncio.gather(*jobs)
    assert codes == [200] * 30
    assert len(env.llm.calls) == 30
    for call in env.llm.calls:
        ctx = call.messages[-1].content
        present = [m for m in markers if m in ctx]
        assert len(present) == 1, f"context mixed tenants: {present}"
    async with env.sm() as db:
        for m, t in tenants:
            n = (await db.execute(select(UsageRecord).where(UsageRecord.workspace_id == t["ws_id"], UsageRecord.metric == "message"))).scalars().all()
            assert sum(u.quantity for u in n) == 10                 # usage attributed to the right tenant, none lost
            msgs = (await db.execute(select(Message).where(Message.workspace_id == t["ws_id"]))).scalars().all()
            assert len(msgs) == 20 and all(m_.workspace_id == t["ws_id"] for m_ in msgs)
