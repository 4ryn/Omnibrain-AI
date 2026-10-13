# Architecture

```
 Customer website                      OmniBrain
 ┌──────────────────┐   <script>   ┌──────────────────────────────────────────────────────────┐
 │ widget.js loader │─────────────▶│ FastAPI                                                   │
 │  └ iframe (UI)   │◀── SSE ─────▶│  /widget/frame  (origin check + CSP + signed token)       │
 └──────────────────┘              │  /widget/v1/chat[/stream] /lead /voice/*  (token + limits) │
                                   │  /api/*  dashboard (Google session + CSRF + roles)         │
 Dashboard (Next.js) ── /api proxy▶│                                                            │
                                   │  ChatService → RAGService → [Embedding][VectorStore][LLM]  │
                                   └───────┬───────────────┬───────────────┬────────────────────┘
                                           │               │               │
                                      PostgreSQL        Redis/Celery    Vector DB (Qdrant | pgvector | Pinecone)
                                      (tenants, chat,   (queue, rate    LLM (OpenAI | Grok | Anthropic)
                                       usage, leads)     limits)        Embeddings (OpenAI | local)
```

## Request flows
**Ingestion**: upload/URL → validate (type, size, magic bytes, quota) → store → Celery task → extract → clean → chunk →
embed → upsert vectors (payload carries `workspace_id`) → chunk rows → status `completed|failed` (re-index is idempotent).

**Chat**: question → quota check → conversation (workspace + visitor scoped) → retrieval (workspace-filtered, threshold,
defence-in-depth tenant check) → `unknown` ⇒ fallback (no LLM call, gap recorded) ; else guarded prompt → provider
(`generate`/`stream`) → leak filter → persist + usage + metrics → response.

## Abstractions (the only places vendors appear)
| Concern | Interface | Implementations |
|---|---|---|
| LLM | `providers/llm/base.LLMProvider` | OpenAI, Grok, Anthropic (`factory.PROVIDERS` registry) |
| Embeddings | `providers/embeddings/base` | OpenAI (HTTP), local sentence-transformers |
| Vector store | `providers/vectorstores/base.VectorStore` | Qdrant, pgvector, Pinecone, in-memory (tests) |
| Storage | `providers/storage/base` | local disk |
| Voice | `providers/voice/base` | OpenAI STT/TTS; realtime = interface only |

Adding a provider = one class + one registry line. Business logic never imports a vendor SDK/URL.

## Credentials
Platform keys come from env. BYOK keys are validated with the provider, Fernet-encrypted (`ENCRYPTION_KEY`, rotation via
comma-separated keys), stored per workspace/provider, decrypted only server-side per request, never returned by any API.
BYOK mode never falls back to the platform key.

## Data model (16 tables, Alembic `0001`)
users · workspaces · workspace_members(role) · auth_sessions(hashed token) · api_configurations · provider_credentials ·
knowledge_sources · documents · url_sources · document_chunks · conversations · messages · leads · unanswered_questions ·
widget_configurations · usage_records. Every tenant table carries `workspace_id`; the pgvector table is created by the store.

## Billing readiness
`usage_records` is an append-only ledger (messages, tokens in/out, voice, optional cost per credential source).
`services/plans.py` defines plans/limits (placeholders) and is enforced for messages, sources, storage and voice.
No payment integration: set `workspaces.plan` from your billing system.
