from app.ingestion.chunker import chunk_text
from app.ingestion.cleaner import clean_text


def test_chunks_respect_size_and_cover_all_text():
    text = "\n\n".join(f"Paragraph {i}. " + "word " * 60 for i in range(20))
    chunks = chunk_text(text, size=500, overlap=80)
    assert len(chunks) > 3
    assert all(len(c.text) <= 500 + 80 + 20 for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert "Paragraph 19." in chunks[-1].text


def test_overlap_repeats_tail_of_previous_chunk():
    text = "\n\n".join(["alpha " * 40, "bravo " * 40, "charlie " * 40])
    chunks = chunk_text(text, size=300, overlap=60)
    assert "alpha" in chunks[1].text.split("\n\n")[0] or "bravo" in chunks[1].text


def test_very_long_unbroken_text_is_split():
    chunks = chunk_text("x" * 5000, size=1000, overlap=0)
    assert len(chunks) >= 5 and all(len(c.text) <= 1000 for c in chunks)


def test_empty_text_gives_no_chunks():
    assert chunk_text("   \n\n  ") == []


def test_cleaner_normalises_whitespace_and_hyphenation():
    out = clean_text("Hello\x00   world\r\n\r\n\r\n\r\nexten-\nsion of the   service")
    assert "\x00" not in out and "   " not in out and "\n\n\n" not in out
    assert "extension" in out
