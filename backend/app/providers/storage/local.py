import asyncio
import uuid
from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.providers.storage.base import StorageProvider


class LocalStorage(StorageProvider):
    def __init__(self, base_dir: str):
        self.base = Path(base_dir).resolve()

    def _safe(self, rel: str) -> Path:
        p = (self.base / rel).resolve()
        if self.base not in p.parents:
            raise ValueError("Path escapes storage root")
        return p

    async def save(self, workspace_id: str, name: str, data: bytes) -> str:
        rel = f"{workspace_id}/{uuid.uuid4().hex}{Path(name).suffix.lower()}"
        path = self._safe(rel)

        def _w():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        await asyncio.to_thread(_w)
        return rel

    async def read(self, path: str) -> bytes:
        return await asyncio.to_thread(self._safe(path).read_bytes)

    async def delete(self, path: str) -> None:
        await asyncio.to_thread(self._safe(path).unlink, True)


@lru_cache
def get_storage() -> StorageProvider:
    return LocalStorage(settings.storage_dir)
