# Operations

## Run locally
```bash
cp .env.example .env     # set GOOGLE_*, SECRET_KEY, ENCRYPTION_KEY, provider keys, LLM_MODEL, EMBEDDING_MODEL
docker compose up --build        # postgres(pgvector) redis qdrant backend worker frontend
```
Dashboard http://localhost:3000 · API http://localhost:8000 · Google redirect URI to register:
`http://localhost:3000/api/auth/google/callback` (the dashboard proxies `/api/*`, so cookies stay first-party).

## Database migrations
`alembic upgrade head` runs on backend start (compose). New changes: `alembic revision --autogenerate -m "..."`, review, commit.
CI/dev check for drift: `alembic check`. The pgvector table is managed by the store (`ensure_ready`), not Alembic.
Changing `EMBEDDING_DIMENSIONS` requires a new collection/table and re-indexing every source.

## Tests
```bash
cd backend && pip install -r requirements-dev.txt
pytest                          # fast: SQLite + fakes + embedded Qdrant
TEST_DB=postgres pytest         # real PostgreSQL 16 + pgvector, schema built by the Alembic migration
cd ../widget && npm install && npm test        # jsdom: loader + chat UI
cd ../frontend && npm install && npm test && npx tsc --noEmit && npm run build
```

## Production checklist
- [ ] `APP_ENV=production`, strong `SECRET_KEY` (32+), `ENCRYPTION_KEY` (Fernet), `COOKIE_SECURE=true`, HTTPS everywhere
- [ ] `BACKEND_URL` = public API URL (goes into customer snippets); `FRONTEND_URL`, `GOOGLE_REDIRECT_URI` match your domains
- [ ] Set `METRICS_TOKEN` and scrape `/metrics`; point the orchestrator at `/health` (liveness) and `/health/ready` (readiness)
- [ ] `TRUSTED_PROXIES` = number of proxies in front of the API (otherwise rate limits key on the proxy's IP)
- [ ] Customers must add their domains under Widget → Allowed websites (empty = blocked in production); the site's CSP must permit the public API origin in `script-src` and `frame-src`
- [ ] Tune `services/plans.py`; set `MODEL_PRICING_JSON` if you want cost estimates
- [ ] Back up PostgreSQL (all business data + pgvector); Qdrant/Pinecone can be rebuilt by re-indexing
- [ ] Add a job to purge expired `auth_sessions`; run ≥2 Celery workers; set Redis persistence as needed
- [ ] Choose real model names (`LLM_MODEL`, `EMBEDDING_MODEL`, `STT_MODEL`, `TTS_MODEL`): none are hard-coded

## Key rotation
`ENCRYPTION_KEY=newkey,oldkey` → deploy → customers' saved keys still decrypt; any key saved from now on uses `newkey`;
re-save (or script a re-encrypt) then drop `oldkey`. Rotating `SECRET_KEY` logs everyone out and invalidates widget tokens (they refresh on reload).

## Metrics (Prometheus, prefix `omnibrain_`)
`http_requests_total`, `http_request_seconds`, `retrieval_seconds`, `llm_seconds`, `llm_tokens_total`, `provider_errors_total`,
`dependency_errors_total`, `chat_messages_total{outcome=answered|fallback|blocked|error|misconfigured|quota_exceeded}`,
`ingestion_jobs_total`, `widget_events_total`, `rate_limited_total`, `prompt_injection_suspected_total`, `ai_cost_usd_total`.
Suggested alerts: provider error ratio, `chat_messages_total{outcome="error"}` rate, p95 `llm_seconds`, `/health/ready` degraded > 5 min.

## Runbook
| Symptom | Look at |
|---|---|
| Visitors see "temporarily unavailable" | `outcome="misconfigured"` (missing key/model in AI Configuration), `provider_errors_total`, `dependency_errors_total{dependency="retrieval"}`; logs by request ID |
| Document stuck "failed" | the error text on the Documents page; worker logs; re-index after fixing |
| Loader does not appear on a customer site | Use the exact dashboard-generated snippet; in the customer page's Network panel, confirm the server-provided `/widget.js` URL returns JavaScript. For Next.js App Router, install it with `next/script` inside the root layout's `<body>`; check the site's `script-src` policy. |
| Widget iframe is blocked | Inspect `/widget/frame`: HTTP 403 means the page origin was rejected, so compare its exact scheme, hostname, and port with Widget → Allowed websites. Inspect the response's CSP `frame-ancestors` and check `/widget/assets/frame.js` and `frame.css`; the host site's `frame-src` must allow the public API origin. |
| Loader reports no ready signal | The loader ran, but the cross-origin frame did not send its readiness message within 15 seconds. The parent cannot reliably determine whether HTTP, origin, or CSP caused the failure; use the customer browser's Network and Console panels. |
| Next.js hydration warning only outside Incognito | Compare with a clean browser profile with extensions disabled. Extension-injected DOM can trigger host-page hydration warnings; this is separate from a verified loader or iframe request. |
| Unexpected 429s | `rate_limited_total{scope}`; plan quota on Usage page |
| Retrieval returns nothing for good content | `RAG_MIN_SCORE`/`RAG_STRONG_SCORE` vs your embedding model; Knowledge → Search shows raw similarity |

## What has and hasn't been verified (see README for the exact list)
Verified by automated tests: everything above marked in README as ✅. **Never run here:** real Google sign-in, real LLM/embedding/voice
provider calls, Pinecone and a Qdrant *server* (embedded Qdrant is tested), Redis/Celery workers end-to-end, the dashboard and widget in a
real browser, load/soak testing, security review by a third party.
