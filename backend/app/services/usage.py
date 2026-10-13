import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UsageRecord


def record_usage(db: AsyncSession, workspace_id: uuid.UUID, metric: str, quantity: int = 1,
                 cost_usd: float = 0, **meta) -> None:
    """Append-only usage ledger; the basis for plan limits and billing."""
    if quantity or cost_usd:
        db.add(UsageRecord(workspace_id=workspace_id, metric=metric, quantity=quantity, cost_usd=cost_usd, meta=meta))
