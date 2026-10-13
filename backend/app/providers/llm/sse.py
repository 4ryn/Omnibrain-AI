from collections.abc import AsyncIterator

import httpx


async def iter_sse(resp: httpx.Response) -> AsyncIterator[tuple[str, str]]:
    """Minimal Server-Sent-Events parser yielding (event, data)."""
    event, data = "message", []
    async for line in resp.aiter_lines():
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = "message", []
        elif line.startswith(":"):
            continue
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        yield event, "\n".join(data)
