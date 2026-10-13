from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class VectorRecord:
    id: str
    vector: list[float]
    payload: dict = field(default_factory=dict)  # must include workspace_id


@dataclass
class VectorHit:
    id: str
    score: float  # higher = more similar, normalised across backends
    payload: dict


class VectorStore(ABC):
    """Every operation takes workspace_id and MUST enforce it server-side in the backend query."""

    @abstractmethod
    async def ensure_ready(self, dimensions: int) -> None: ...

    @abstractmethod
    async def upsert(self, workspace_id: str, records: list[VectorRecord]) -> None: ...

    @abstractmethod
    async def search(self, workspace_id: str, vector: list[float], top_k: int = 5,
                     filters: dict | None = None) -> list[VectorHit]: ...

    @abstractmethod
    async def delete(self, workspace_id: str, ids: list[str] | None = None,
                     filters: dict | None = None) -> None: ...

    async def healthcheck(self) -> None:
        """Raise if the backend is unreachable. Default: assume healthy."""
        return None

    async def close(self) -> None:
        return None
