import asyncio
import ipaddress
import logging
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.errors import FetchError

log = logging.getLogger(__name__)
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
ALLOWED_PORTS = {None, 80, 443}
_NOISE_TAGS = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form",
               "iframe", "button", "template"]


@dataclass
class FetchedPage:
    url: str
    title: str | None
    text: str


def _parse(url: str):
    try:
        parsed = urlparse(url.strip())
        port = parsed.port
    except ValueError as exc:
        raise FetchError("That URL is not valid.") from exc
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise FetchError("Only http(s) URLs are supported.")
    if parsed.username or parsed.password:
        raise FetchError("URLs with embedded credentials are not allowed.")
    if port not in ALLOWED_PORTS:
        raise FetchError("Only standard web ports (80/443) are allowed.")
    return parsed, port


async def resolve_public(hostname: str, port: int | None, scheme: str = "https") -> list[str]:
    """Resolve a host and require EVERY address to be public. Returns the validated IPs."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            hostname, port or (80 if scheme == "http" else 443), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchError("That website's address could not be resolved.") from exc
    ips: list[str] = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise FetchError("That URL points to a private or internal address and cannot be fetched.")
        if str(ip) not in ips:
            ips.append(str(ip))
    return ips


async def validate_public_url(url: str) -> str:
    """SSRF guard: http(s) only, no credentials, standard ports, and every resolved IP must be public."""
    parsed, port = _parse(url)
    await resolve_public(parsed.hostname, port, parsed.scheme)
    return parsed.geturl()


def pin_request(url: str, ip: str) -> tuple[str, dict, dict]:
    """Rewrite the URL to connect to the already-validated IP (defeats DNS rebinding between check and use),
    while keeping the original Host header and TLS server name so certificates still verify."""
    p = urlparse(url)
    host = p.hostname or ""
    try:
        ipaddress.ip_address(host)
        return url, {}, {}                                  # already an IP literal: nothing to pin
    except ValueError:
        pass
    netloc_ip = f"[{ip}]" if ":" in ip else ip
    pinned = p._replace(netloc=netloc_ip + (f":{p.port}" if p.port else "")).geturl()
    host_header = host + (f":{p.port}" if p.port else "")
    return pinned, {"Host": host_header}, {"sni_hostname": host}


def html_to_text(html: str) -> tuple[str | None, str]:
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else None
    for tag in soup(_NOISE_TAGS):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.find(attrs={"role": "main"}) or soup.body or soup
    lines = []
    for raw in root.get_text("\n").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            lines.append("")
        elif len(line) >= 25 or len(line.split()) >= 4:  # drop menu-like fragments
            lines.append(line)
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    # Treat each non-empty line as its own paragraph so chunking has structure.
    return title, re.sub(r"\n(?=\S)", "\n\n", text)


async def fetch_page(url: str, transport: httpx.AsyncBaseTransport | None = None) -> FetchedPage:
    current = await validate_public_url(url)
    headers = {"User-Agent": "OmniBrainBot/1.0 (+knowledge ingestion)", "Accept": "text/html,text/plain"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=False, headers=headers,
                                     transport=transport) as client:
            for _ in range(MAX_REDIRECTS + 1):
                parsed, port = _parse(current)
                ips = await resolve_public(parsed.hostname, port, parsed.scheme)   # re-validated on every hop
                pinned, extra_headers, extensions = pin_request(current, ips[0])
                async with client.stream("GET", pinned, headers=extra_headers, extensions=extensions) as resp:
                    if resp.is_redirect:
                        location = resp.headers.get("location")
                        if not location:
                            raise FetchError("The website redirected without a destination.")
                        current = await validate_public_url(urljoin(current, location))
                        continue
                    if resp.status_code >= 400:
                        raise FetchError(f"The website responded with HTTP {resp.status_code}.")
                    ctype = resp.headers.get("content-type", "").lower()
                    if not any(t in ctype for t in ("text/html", "text/plain", "application/xhtml")):
                        raise FetchError("That URL is not a web page (HTML or text).")
                    buf = bytearray()
                    async for part in resp.aiter_bytes():
                        buf.extend(part)
                        if len(buf) > MAX_BYTES:
                            raise FetchError("That page is too large to ingest.")
                    html = bytes(buf).decode(resp.encoding or "utf-8", errors="replace")
                    if "text/plain" in ctype:
                        return FetchedPage(current, None, html)
                    title, text = await asyncio.to_thread(html_to_text, html)
                    if len(text) < 80:
                        raise FetchError("No meaningful text found. The page may require JavaScript to render.")
                    return FetchedPage(current, title, text)
            raise FetchError("Too many redirects.")
    except FetchError:
        raise
    except httpx.TimeoutException as exc:
        raise FetchError("The website took too long to respond.") from exc
    except httpx.HTTPError as exc:
        log.warning("URL fetch failed for %s: %s", url, exc)
        raise FetchError("The website could not be reached.") from exc
