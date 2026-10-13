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
cd ../frontend && npm install && npx tsc --noEmit && npm run build
```

## Production checklist
- [ ] `APP_ENV=production`, strong `SECRET_KEY` (32+), `ENCRYPTION_KEY` (Fernet), `COOKIE_SECURE=true`, HTTPS everywhere
- [ ] `BACKEND_URL` = public API URL (goes into customer snippets); `FRONTEND_URL`, `GOOGLE_REDIRECT_URI` match your domains
- [ ] Set `METRICS_TOKEN` and scrape `/metrics`; point the orchestrator at `/health` (liveness) and `/health/ready` (readiness)
- [ ] `TRUSTED_PROXIES` = number of proxies in front of the API (otherwise rate limits key on the proxy's IP)
- [ ] Customers must add their domains under Widget → Allowed websites (empty = blocked in production)
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
| Widget blank on a customer site | Widget → Allowed websites includes that exact origin (scheme+host+port); browser console CSP `frame-ancestors` message |
| Unexpected 429s | `rate_limited_total{scope}`; plan quota on Usage page |
| Retrieval returns nothing for good content | `RAG_MIN_SCORE`/`RAG_STRONG_SCORE` vs your embedding model; Knowledge → Search shows raw similarity |

## What has and hasn't been verified (see README for the exact list)
Verified by automated tests: everything above marked in README as ✅. **Never run here:** real Google sign-in, real LLM/embedding/voice
provider calls, Pinecone and a Qdrant *server* (embedded Qdrant is tested), Redis/Celery workers end-to-end, the dashboard and widget in a
real browser, load/soak testing, security review by a third party.
