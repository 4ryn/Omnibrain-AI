# OmniBrain AI

Multi-tenant B2B SaaS: a business uploads documents / adds web pages, OmniBrain indexes them, and an AI assistant that
answers **only from that knowledge** appears on the business's existing website through one `<script>` tag.

```html
<script async src="https://YOUR-API-DOMAIN/widget.js" data-workspace="wk_xxxxxxxx"></script>
```

Docs: [architecture](docs/architecture.md) · [security](docs/security.md) · [operations / runbook](docs/operations.md)

## Quick start
```bash
cp .env.example .env     # GOOGLE_*, SECRET_KEY, ENCRYPTION_KEY, provider key(s), LLM_MODEL, EMBEDDING_MODEL
docker compose up --build
# Dashboard http://localhost:3000   API http://localhost:8000
# Google Cloud console -> authorised redirect URI: http://localhost:3000/api/auth/google/callback
```
`.env.example` documents every setting. No model name is hard-coded anywhere: you choose them.

## What is built
**Phase 1: foundation & knowledge.** Google-only auth (state/nonce, hashed server-side sessions, CSRF), workspaces & roles,
16-table schema with Alembic, ingestion for PDF/TXT/MD/DOCX/CSV/URLs (SSRF-safe), Celery pipeline with
queued→processing→completed/failed and idempotent re-index, RAG (thresholds, known/partial/unknown, guardrail prompt,
fallback without an LLM call). Vector stores: Qdrant, pgvector, Pinecone behind one interface.

**Phase 2: assistant & widget.** OpenAI, Grok, Anthropic providers (retries, streaming, normalised errors); per-workspace
model routing; platform keys or customer keys (BYOK, encrypted, never returned); `/api/chat[/stream]` for the dashboard and
`/widget/v1/chat[/stream]` for visitors; iframe-isolated widget with streaming, mobile layout, lead form and optional voice
(STT/TTS abstractions); origin validation (Referer + CSP `frame-ancestors`), signed tokens, rate limits.

**Phase 3: dashboard.** Next.js dashboard: Overview + setup checklist, Knowledge search, Documents, URLs, Playground
(answer, sources, provider, model, latency), Conversations, Unanswered questions (frequency, gap, suggested action, closest
content), Leads (+CSV), Widget editor with preview, AI Configuration, Usage, Settings.

**Phase 4: hardening.** DNS-pinned outbound fetches, role-based authorization, plans/quotas, approximate cost tracking,
request IDs + JSON logs + Prometheus metrics (`/metrics`, token-gated) + liveness/readiness probes, body-size limits,
security headers, prompt-injection heuristics and system-prompt leak filter, encryption-key rotation, zip-bomb guard,
graceful handling of LLM / embedding / vector-store / queue failures, real Alembic migration, CI definition.

## Verification status: please read
| Check | Result |
|---|---|
| Backend tests, fast mode (SQLite, fakes, embedded Qdrant) | ✅ 152 passed, 4 skipped (Postgres-only) |
| Backend tests on **real PostgreSQL 16 + pgvector**, schema built by the Alembic migration | ✅ 156 passed |
| Alembic: upgrade → drift check → downgrade → upgrade on real Postgres | ✅ no drift |
| **30-step acceptance flow** (sign-in → upload/URL → index → configure → playground → snippet → widget → stream → fallback → lead → dashboards → usage → no keys exposed → tenant isolation) | ✅ passes on in-memory, embedded Qdrant **and pgvector** stores |
| Concurrent multi-tenant load (30 simultaneous chats, 3 tenants) | ✅ no context mixing, usage attributed correctly |
| Real Google OAuth *code path* (callback, state, nonce, issuer, verified email, logout) | ✅ with Google's two network calls faked |
| Widget loader + chat UI in jsdom (23 tests: streaming, XSS, mobile, lead form, errors, readiness diagnostics) | ✅ |
| Dashboard `tsc` + production `next build`; built dashboard proxying to a live API (cookies, CSRF, frame CSP) | ✅ |
| Real `uvicorn` smoke (readiness, metrics gate, headers, body limits, SSE) | ✅ (found and fixed 2 bugs) |
| **Not verified** | Real Google sign-in · real OpenAI/Grok/Anthropic/embedding/voice calls · Pinecone live (fake client tested) · Qdrant *server* (embedded tested) · Redis + Celery workers running together · dashboard/widget in a real browser (jsdom only) · load/soak testing · third-party security review · `.github/workflows/ci.yml` |

### Run the tests
```bash
cd backend && pip install -r requirements-dev.txt
pytest                      # fast
TEST_DB=postgres pytest     # real Postgres + pgvector (embedded via pgserver)
cd ../widget && npm install && npm test
cd ../frontend && npm install && npm test && npx tsc --noEmit && npm run build
```

## Honest limitations
- **Calibrate retrieval.** `RAG_MIN_SCORE` / `RAG_STRONG_SCORE` are cosine cut-offs that depend on your embedding model. Test on your own documents (Knowledge → Search shows raw similarity).
- **Plans/limits in `services/plans.py` are placeholders**, and there is no payment integration. The usage ledger and quotas are ready for one.
- **Origin checks aren't authentication**; rate limits and quotas are the real protection against abuse of a public widget.
- Scanned (image-only) PDFs aren't OCR'd; legacy `.doc` isn't supported; URL ingestion is one page per URL (no crawling).
- Embedding keys for ingestion are platform-level (customers' own keys are used for chat and voice).
- No audit log, no malware scanning of uploads, no automatic expired-session cleanup. See [security](docs/security.md).
- A realtime speech-to-speech provider is an interface only.
- "Production-ready" is a claim only your own staging, load testing and review can support. This is a solid, tested baseline, not a guarantee.
