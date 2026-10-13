import re
import unicodedata

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _CTRL.sub("", text)
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)          # de-hyphenate PDF line wraps
    text = re.sub(r"(?<![\n.!?:])\n(?!\n)(?=[a-z])", " ", text)  # re-join mid-sentence wraps
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
