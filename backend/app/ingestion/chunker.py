import re
from dataclasses import dataclass

_SENT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Chunk:
    index: int
    text: str

    @property
    def token_estimate(self) -> int:
        return max(1, len(self.text) // 4)


def _split_long(paragraph: str, size: int) -> list[str]:
    out, cur = [], ""
    for sent in _SENT.split(paragraph):
        while len(sent) > size:  # no sentence boundary: hard split on whitespace where possible
            cut = sent.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            if cur:
                out.append(cur)
                cur = ""
            out.append(sent[:cut].strip())
            sent = sent[cut:].strip()
        if cur and len(cur) + 1 + len(sent) > size:
            out.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        out.append(cur)
    return [o for o in out if o]


def chunk_text(text: str, size: int = 1000, overlap: int = 150) -> list[Chunk]:
    """Paragraph-aware chunking with character overlap. Never splits mid-word when avoidable."""
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    pieces: list[str] = []
    for p in paragraphs:
        pieces.extend([p] if len(p) <= size else _split_long(p, size))

    chunks: list[str] = []
    cur = ""
    for piece in pieces:
        if cur and len(cur) + 2 + len(piece) > size:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap else ""
            if " " in tail:
                tail = tail[tail.index(" ") + 1:]
            cur = f"{tail}\n\n{piece}" if tail else piece
        else:
            cur = f"{cur}\n\n{piece}" if cur else piece
    if cur:
        chunks.append(cur)
    return [Chunk(i, c) for i, c in enumerate(chunks)]
