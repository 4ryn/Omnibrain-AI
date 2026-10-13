# Security

| Area | Control | Where |
|---|---|---|
| Authentication | Google OAuth only; state+nonce in a signed, short-lived HttpOnly cookie; fixed server-side redirect URI; ID-token audience/issuer/nonce/`email_verified` checks | `api/auth.py` |
| Sessions | Random token; only its SHA-256 stored; HttpOnly, SameSite=Lax, Secure in production; server-side revocation on logout | `security/sessions.py` |
| CSRF | Double-submit HMAC token bound to the session on every mutating dashboard route | `api/deps.require_csrf` |
| Authorization | Workspace membership on every tenant route; `owner/admin` required for changes; members read-only (+ playground) | `api/deps.py` |
| Tenant isolation | `workspace_id` on every query; vector queries filtered server-side per backend (Pinecone: namespace); retrieval re-checks each hit's tenant; foreign IDs return the same 404 as missing ones | everywhere; tests in `test_acceptance`, `test_concurrency` |
| Widget | Signed 6h token (no secrets); embedding origin checked via Referer **and** browser-enforced CSP `frame-ancestors`; per-IP / visitor / workspace rate limits; visitors can't choose provider/model; only web-page sources shown | `api/widget.py`, `security/widget_auth.py` |
| Secrets | BYOK keys encrypted at rest (rotation supported); logs redact key-shaped strings; validation errors never echo submitted values; production refuses weak `SECRET_KEY`/missing `ENCRYPTION_KEY`/insecure cookies | `security/crypto.py`, `core/logging.py`, `core/config.py` |
| SSRF | http(s) only, standard ports, no credentials, **all** resolved IPs must be public, connection **pinned to the validated IP** (Host/SNI preserved), redirects re-validated per hop, size/time limits | `ingestion/url_fetcher.py` |
| Uploads | Extension allow-list, magic-byte check, size cap (streamed), duplicate detection, generated storage names, PDF page cap, DOCX zip-bomb guard, plan quotas | `api/knowledge.py`, `ingestion/extractors.py` |
| Prompt injection | Untrusted-data delimiters + stripping of forged tags, fixed rules the context can't override, injection heuristic (extra reminder + metric), system-prompt **leak filter** (also for streams via `replace` event), business instructions are style-only | `rag/guardrails.py`, `services/chat_service.py` |
| Abuse | Rate limits (Redis, degrades to in-process if Redis is down), request body limits (also chunked), login rate limit, lead rate limit, monthly quotas | `core/ratelimit.py`, `core/middleware.py` |
| Hardening | Security headers, `no-store` on API, HSTS in production, docs/OpenAPI disabled in production, CSV export neutralises formula injection | `core/middleware.py`, `api/leads.py` |
| Errors | Customers get generic messages; technical detail only in server logs with a request ID | `services/chat_service.py`, `main.py` |

## Known limits / not covered
- **Origin checks are not authentication.** A non-browser client can spoof `Referer`; the token + rate limits + quotas are the real brake. A determined attacker can still spend a tenant's monthly quota.
- Prompt-injection defences reduce, not eliminate, risk. The assistant can only reveal what is in the tenant's own knowledge base, and that is by design.
- No account lockout/anomaly detection, no audit log, no 2FA beyond Google's own, no WAF, no malware scanning of uploads.
- Sessions are not purged automatically (add a periodic job deleting expired `auth_sessions`).
- Celery worker metrics live in the worker process (not scraped); ingestion outcomes are in the database.
- **No third-party penetration test has been done.** Treat this as a strong baseline, not a certification.
