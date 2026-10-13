import hashlib
import math
import re

from app.providers.embeddings.base import EmbeddingProvider
from app.providers.llm.base import LLMProvider, LLMRequest, LLMResult, StreamChunk

DIM = 128


class FakeEmbedder(EmbeddingProvider):
    """Deterministic bag-of-words hashing embedder: similar wording => high cosine."""
    name, dimensions = "fake", DIM

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * DIM
        for tok in re.findall(r"[a-z0-9]+", text.lower()):
            v[int(hashlib.md5(tok.encode()).hexdigest(), 16) % DIM] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    async def embed_documents(self, texts): return [self._vec(t) for t in texts]
    async def embed_query(self, text): return self._vec(text)


class FakeLLM(LLMProvider):
    name = "fake"

    def __init__(self):
        super().__init__("test-key")
        self.calls: list[LLMRequest] = []

    async def generate(self, request):
        self.calls.append(request)
        return LLMResult(text="Answer [1]", tokens_in=10, tokens_out=3, model=request.model)

    async def stream(self, request):
        self.calls.append(request)
        for piece in ("Ans", "wer [1]"):
            yield StreamChunk(text=piece)
        yield StreamChunk(tokens_in=10, tokens_out=3, finish_reason="stop")

    async def validate_credentials(self): return True
