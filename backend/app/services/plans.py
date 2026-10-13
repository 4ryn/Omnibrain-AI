"""Plans and quotas. These numbers are placeholders: tune them (or load from your billing system) before launch.
`None` means unlimited. Enforcement points: chat (messages), knowledge upload (sources, storage), voice."""
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, URLSource, UsageRecord


@dataclass(frozen=True)
class Plan:
    name: str
    messages_per_month: int | None
    sources: int | None          # documents + URLs
    storage_mb: int | None
    voice: bool


PLANS: dict[str, Plan] = {
    "starter": Plan("starter", 500, 10, 50, False),
    "business": Plan("business", 5_000, 100, 500, True),
    "pro": Plan("pro", 25_000, 500, 2_048, True),
    "enterprise": Plan("enterprise", None, None, None, True),
}


def get_plan(name: str) -> Plan:
    return PLANS.get(name, PLANS["starter"])


def month_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def messages_this_month(db: AsyncSession, workspace_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(
        UsageRecord.workspace_id == workspace_id, UsageRecord.metric == "message",
        UsageRecord.created_at >= month_start()))).scalar_one())


async def source_counts(db: AsyncSession, workspace_id: uuid.UUID) -> tuple[int, int]:
    """(number of documents + URLs, stored bytes)."""
    docs, size = (await db.execute(select(func.count(), func.coalesce(func.sum(Document.size_bytes), 0)).where(
        Document.workspace_id == workspace_id))).one()
    urls = (await db.execute(select(func.count()).select_from(URLSource).where(
        URLSource.workspace_id == workspace_id))).scalar_one()
    return int(docs) + int(urls), int(size)


async def message_quota_exceeded(db: AsyncSession, workspace_id: uuid.UUID, plan_name: str) -> bool:
    limit = get_plan(plan_name).messages_per_month
    return limit is not None and await messages_this_month(db, workspace_id) >= limit


async def upload_quota_error(db: AsyncSession, workspace_id: uuid.UUID, plan_name: str, new_bytes: int = 0) -> str | None:
    plan = get_plan(plan_name)
    count, size = await source_counts(db, workspace_id)
    if plan.sources is not None and count >= plan.sources:
        return f"Your {plan.name} plan allows {plan.sources} knowledge sources. Delete some or upgrade your plan."
    if plan.storage_mb is not None and size + new_bytes > plan.storage_mb * 1024 * 1024:
        return f"This upload would exceed the {plan.storage_mb} MB storage included in your {plan.name} plan."
    return None
