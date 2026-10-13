import pytest

from app.core.errors import FetchError
from app.ingestion.url_fetcher import html_to_text, validate_public_url


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://10.0.0.5/",
    "http://169.254.169.254/latest/meta-data/", "http://192.168.1.1/", "http://2130706433/",
    "http://[::ffff:127.0.0.1]/", "file:///etc/passwd", "ftp://example.com/",
    "http://user:pw@8.8.8.8/", "http://8.8.8.8:6379/",
])
async def test_private_or_unsafe_urls_rejected(url):
    with pytest.raises(FetchError):
        await validate_public_url(url)


async def test_public_ip_allowed():
    assert await validate_public_url("https://8.8.8.8/page") == "https://8.8.8.8/page"


def test_html_extraction_drops_navigation_and_scripts():
    html = """<html><head><title>Acme Plumbing</title><script>evil()</script></head><body>
    <nav><a>Home</a><a>About</a></nav><header>Site header banner</header>
    <main><h1>Our Services</h1><p>We provide emergency plumbing repairs, boiler installation and drain cleaning
    across the whole city, 24 hours a day.</p></main><footer>Copyright 2025 Acme</footer></body></html>"""
    title, text = html_to_text(html)
    assert title == "Acme Plumbing"
    assert "emergency plumbing repairs" in text
    assert "evil()" not in text and "Copyright" not in text and "Site header" not in text
