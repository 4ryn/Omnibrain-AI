import hashlib
import logging
import time
import uuid

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.errors import ConfigError
from app.models import (
    Conversation,
    Message,
    UnansweredQuestion,
    WidgetConfiguration,
    Workspace,
)
from app.providers.embeddings.base import EmbeddingProvider
from app.providers.llm.base import ChatMessage, LLMRequest, ProviderError
from app.providers.vectorstores.base import VectorStore
from app.rag.guardrails import (
    FALLBACK_MESSAGE,
    LEAK_REPLACEMENT,
    detect_injection,
    leaks_system_prompt,
    sanitize_question,
)
from app.rag.service import RAGService
from app.rag.types import Confidence
from app.security.crypto import CryptoError
from app.services.ai_config import ResolvedAI, resolve_ai
from app.services.plans import message_quota_exceeded
from app.services.pricing import estimate_cost
from app.services.usage import record_usage


log = logging.getLogger(__name__)


GENERIC_ERROR = (
    "The assistant is temporarily unavailable. "
    "Please try again shortly."
)


# ============================================================================
# FAST CONVERSATIONAL RESPONSES
# ============================================================================

FAST_RESPONSES = {
    "hi": "Hi! How can I help you today?",
    "hello": "Hello! How can I help you today?",
    "hey": "Hey! How can I help you today?",
    "hi there": "Hi! How can I help you today?",
    "hello there": "Hello! How can I help you today?",
    "hey there": "Hey! How can I help you today?",
    "good morning": "Good morning! How can I help you today?",
    "good afternoon": "Good afternoon! How can I help you today?",
    "good evening": "Good evening! How can I help you today?",
    "thanks": "You're welcome! Let me know if you need anything else.",
    "thank you": "You're welcome! Let me know if you need anything else.",
    "thanks a lot": "You're welcome! Let me know if you need anything else.",
    "thank you so much": "You're welcome! Let me know if you need anything else.",
    "bye": "Goodbye! Feel free to come back if you need anything else.",
    "goodbye": "Goodbye! Have a great day!",
    "see you": "See you! Have a great day!",
}


# ============================================================================
# COMPANY-SPECIFIC TERMS
#
# These help prevent questions such as:
#
# "What are your prices?"
# "What is your refund policy?"
#
# from being incorrectly treated as general knowledge.
# ============================================================================

COMPANY_TERMS = (
    "your",
    "our",
    "company",
    "business",
    "product",
    "products",
    "service",
    "services",
    "pricing",
    "price",
    "prices",
    "cost",
    "costs",
    "plan",
    "plans",
    "subscription",
    "subscriptions",
    "refund",
    "refunds",
    "return",
    "returns",
    "warranty",
    "support",
    "customer support",
    "account",
    "accounts",
    "order",
    "orders",
    "delivery",
    "shipping",
    "website",
    "contact",
    "contact us",
    "feature",
    "features",
    "availability",
    "available",
    "opening hours",
    "hours",
    "policy",
    "policies",
    "terms",
    "documentation",
    "dashboard",
    "login",
    "log in",
    "sign up",
    "signup",
    "password",
    "workspace",
)


# ============================================================================
# GENERAL-KNOWLEDGE QUESTION PATTERNS
#
# These are intentionally conservative.
#
# We only bypass RAG when the question looks clearly general AND does not
# contain company-specific language.
# ============================================================================

GENERAL_PREFIXES = (
    "what is ",
    "what are ",
    "who is ",
    "who was ",
    "where is ",
    "where was ",
    "when was ",
    "when did ",
    "why is ",
    "why are ",
    "why does ",
    "why do ",
    "how does ",
    "how do ",
    "how is ",
    "how are ",
    "how can ",
    "explain ",
    "define ",
    "tell me about ",
)

GENERAL_PATTERNS = (
    "capital of ",
    "meaning of ",
    "difference between ",
    "history of ",
    "population of ",
    "formula for ",
    "syntax for ",
    "example of ",
    "examples of ",
)


def _normalize_for_intent(text: str) -> str:
    """
    Normalize a message for lightweight intent detection.
    """
    return " ".join(text.lower().strip().split())


def _fast_conversation_response(question: str) -> str | None:
    """
    Return an instant response for obvious conversational messages.

    This function deliberately does not call:
      - embeddings
      - Qdrant
      - Groq
      - any external service
    """
    normalized = _normalize_for_intent(question)

    # Remove simple trailing punctuation.
    normalized = normalized.rstrip("!?.,:;")

    return FAST_RESPONSES.get(normalized)


def _looks_company_specific(question: str, brand: str = "") -> bool:
    """
    Conservative check for company-specific questions.

    Company-specific language always takes priority over the general
    knowledge shortcut.
    """
    normalized = _normalize_for_intent(question)

    for term in COMPANY_TERMS:
        if term in normalized:
            return True

    if brand:
        brand_normalized = _normalize_for_intent(brand)

        if brand_normalized and brand_normalized in normalized:
            return True

    return False


def _looks_general_question(question: str, brand: str = "") -> bool:
    """
    Detect obvious general-knowledge questions without using an LLM.

    This is intentionally conservative.

    Example:

        "What is Python?"
            -> True

        "What is your pricing?"
            -> False

        "What are your plans?"
            -> False

        "Who is Albert Einstein?"
            -> True
    """
    normalized = _normalize_for_intent(question)

    if not normalized:
        return False

    # Company-specific questions must always go through RAG.
    if _looks_company_specific(normalized, brand):
        return False

    # Question-style general knowledge.
    if normalized.startswith(GENERAL_PREFIXES):
        return True

    for pattern in GENERAL_PATTERNS:
        if pattern in normalized:
            return True

    # Basic arithmetic / mathematical expressions.
    if any(char.isdigit() for char in normalized):
        math_chars = set("0123456789+-*/%=(). ")

        if all(
            char in math_chars
            for char in normalized
        ):
            return True

    return False


# ============================================================================
# CHAT ERRORS
# ============================================================================


class ChatError(Exception):

    def __init__(
        self,
        message: str,
        status_code: int = 400,
    ):
        super().__init__(message)

        self.message = message
        self.status_code = status_code


# ============================================================================
# CONTEXT
# ============================================================================


@dataclass
class ChatContext:
    workspace_id: uuid.UUID
    channel: str  # widget | playground
    visitor_id: str | None = None
    source_page: str | None = None
    override_provider: str | None = None
    override_model: str | None = None


# ============================================================================
# PREPARED REQUEST
# ============================================================================


@dataclass
class Prepared:
    ctx: ChatContext
    conv: Conversation
    question: str
    history: list[ChatMessage]
    brand: str
    ai: ResolvedAI | None
    ai_error: str | None
    suspected_injection: bool = False


# ============================================================================
# PUBLIC SOURCE FILTER
# ============================================================================


def public_sources(
    sources: list[dict],
) -> list[dict]:
    """
    Visitors only see web-page sources.

    Internal filenames are never exposed.
    """
    return []
        # {
        #     "index": s["index"],
        #     "name": s.get("source_name") or s["url"],
        #     "url": s["url"],
        # }
        # for s in sources
        # if (s.get("url") or "").startswith(
        #     ("http://", "https://")
        # )
    


# ============================================================================
# CONVERSATION LOOKUP
# ============================================================================


async def check_conversation(
    db: AsyncSession,
    ctx: ChatContext,
    conversation_id: uuid.UUID,
) -> Conversation:

    q = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.workspace_id == ctx.workspace_id,
        Conversation.channel == ctx.channel,
    )

    if ctx.channel == "widget":
        q = q.where(
            Conversation.visitor_id == ctx.visitor_id
        )

    conv = (
        await db.execute(q)
    ).scalar_one_or_none()

    if not conv:
        raise ChatError(
            "Conversation not found.",
            404,
        )

    return conv


# ============================================================================
# CHAT SERVICE
# ============================================================================


class ChatService:

    def __init__(
        self,
        embedder: EmbeddingProvider
        | Callable[[], EmbeddingProvider],
        store: VectorStore
        | Callable[[], VectorStore],
    ):
        """
        Embedder/store may be factories.

        Building them can fail on misconfiguration, and that failure must
        be handled like any other retrieval failure.
        """
        self._embedder = embedder
        self._store = store
        self._rag: RAGService | None = None

    # ------------------------------------------------------------------
    # RAG SERVICE
    # ------------------------------------------------------------------

    @property
    def rag(self) -> RAGService:

        if self._rag is None:

            embedder = (
                self._embedder()
                if callable(self._embedder)
                else self._embedder
            )

            store = (
                self._store()
                if callable(self._store)
                else self._store
            )

            self._rag = RAGService(
                embedder,
                store,
            )

        return self._rag

    # ------------------------------------------------------------------
    # CONVERSATION
    # ------------------------------------------------------------------

    async def check_conversation(
        self,
        db: AsyncSession,
        ctx: ChatContext,
        conversation_id: uuid.UUID,
    ) -> Conversation:

        return await check_conversation(
            db,
            ctx,
            conversation_id,
        )

    # ------------------------------------------------------------------
    # PREPARE
    # ------------------------------------------------------------------

    async def prepare(
        self,
        db: AsyncSession,
        ctx: ChatContext,
        message: str,
        conversation_id: uuid.UUID | None = None,
    ) -> Prepared:

        question = sanitize_question(message)

        if not question:
            raise ChatError(
                "Please enter a message.",
                400,
            )

        # Visitors can never override provider/model.
        if ctx.channel == "widget":
            ctx.override_provider = None
            ctx.override_model = None

        ws = await db.get(
            Workspace,
            ctx.workspace_id,
        )

        if ws is None or not ws.is_active:
            raise ChatError(
                "Not found.",
                404,
            )

        if await message_quota_exceeded(
            db,
            ctx.workspace_id,
            ws.plan,
        ):

            metrics.CHAT_MESSAGES.labels(
                ctx.channel,
                "quota_exceeded",
            ).inc()

            raise ChatError(
                GENERIC_ERROR
                if ctx.channel == "widget"
                else (
                    "Your plan's monthly message limit "
                    "has been reached. Upgrade to continue."
                ),
                429,
            )

        suspected = detect_injection(question)

        if suspected:
            metrics.PROMPT_INJECTION.inc()

            log.warning(
                "Suspected prompt injection "
                "(workspace %s, channel %s)",
                ctx.workspace_id,
                ctx.channel,
            )

        # --------------------------------------------------------------
        # Conversation
        # --------------------------------------------------------------

        if conversation_id:

            conv = await self.check_conversation(
                db,
                ctx,
                conversation_id,
            )

        else:

            conv = Conversation(
                workspace_id=ctx.workspace_id,
                visitor_id=ctx.visitor_id,
                channel=ctx.channel,
                source_page=(
                    (ctx.source_page or "")[:2048]
                    or None
                ),
            )

            db.add(conv)

            await db.flush()

        # --------------------------------------------------------------
        # History
        # --------------------------------------------------------------

        rows = (
            await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conv.id
                )
                .order_by(
                    Message.created_at.desc()
                )
                .limit(10)
            )
        ).scalars().all()

        history = [
            ChatMessage(
                m.role,
                m.content,
            )
            for m in reversed(rows)
            if m.role in (
                "user",
                "assistant",
            )
        ]

        # --------------------------------------------------------------
        # Brand
        # --------------------------------------------------------------

        brand = (
            await db.execute(
                select(
                    WidgetConfiguration.brand_name
                ).where(
                    WidgetConfiguration.workspace_id
                    == ctx.workspace_id
                )
            )
        ).scalar_one_or_none() or ""

        # --------------------------------------------------------------
        # AI configuration
        # --------------------------------------------------------------

        ai = None
        err = None

        try:

            ai = await resolve_ai(
                db,
                ctx.workspace_id,
                ctx.override_provider,
                ctx.override_model,
            )

        except ConfigError as exc:

            err = exc.user_message

        except CryptoError:

            err = (
                "Credential storage is not configured "
                "on this server."
            )

        # --------------------------------------------------------------
        # Persist visitor question immediately.
        # --------------------------------------------------------------

        db.add(
            Message(
                workspace_id=ctx.workspace_id,
                conversation_id=conv.id,
                role="user",
                content=question,
                created_at=datetime.now(timezone.utc),
            )
        )

        await db.flush()

        return Prepared(
            ctx,
            conv,
            question,
            history,
            brand,
            ai,
            err,
            suspected,
        )

    # ==================================================================
    # EVENTS
    # ==================================================================

    async def events(
        self,
        db: AsyncSession,
        prep: Prepared,
        *,
        stream: bool,
    ) -> AsyncIterator[dict]:

        """
        Yields:

            meta
            delta*
            [replace]
            done | error

        Commits before the final event.
        """

        ctx = prep.ctx
        conv = prep.conv
        t0 = time.perf_counter()

        widget = ctx.channel == "widget"

        yield {
            "type": "meta",
            "conversation_id": str(conv.id),
        }

        # --------------------------------------------------------------
        # Failure helper
        # --------------------------------------------------------------

        async def fail(
            message: str,
            outcome: str = "error",
        ) -> dict:

            metrics.CHAT_MESSAGES.labels(
                ctx.channel,
                outcome,
            ).inc()

            await db.commit()

            return {
                "type": "error",
                "message": (
                    GENERIC_ERROR
                    if widget
                    else message
                ),
            }

        # --------------------------------------------------------------
        # AI availability
        # --------------------------------------------------------------

        if prep.ai is None:

            log.warning(
                "AI not usable for workspace %s: %s",
                ctx.workspace_id,
                prep.ai_error,
            )

            yield await fail(
                prep.ai_error or GENERIC_ERROR,
                "misconfigured",
            )

            return

        # ==============================================================
        # FAST PATH #1
        #
        # Simple human interaction.
        #
        # NO:
        #   - embeddings
        #   - Qdrant
        #   - Groq
        # ==============================================================

        fast_response = _fast_conversation_response(
            prep.question
        )

        if (
            fast_response is not None
            and not prep.suspected_injection
        ):

            answer = fast_response

            fallback = False
            blocked = False

            sources: list[dict] = []

            tin = 0
            tout = 0

            retrieval_ms = 0

            # ----------------------------------------------------------
            # Stream the instant response through the same interface.
            # ----------------------------------------------------------

            yield {
                "type": "delta",
                "text": answer,
            }

            # ----------------------------------------------------------
            # Persist answer
            # ----------------------------------------------------------

            latency_ms = int(
                (time.perf_counter() - t0)
                * 1000
            )

            msg = Message(
                workspace_id=ctx.workspace_id,
                conversation_id=conv.id,
                role="assistant",
                content=answer,
                sources=[],
                provider=None,
                model=None,
                tokens_in=0,
                tokens_out=0,
                latency_ms=latency_ms,
                was_fallback=False,
                created_at=datetime.now(timezone.utc),
            )

            db.add(msg)

            record_usage(
                db,
                ctx.workspace_id,
                "message",
                1,
                channel=ctx.channel,
                fallback=False,
            )

            metrics.CHAT_MESSAGES.labels(
                ctx.channel,
                "answered",
            ).inc()

            await db.flush()

            done = {
                "type": "done",
                "conversation_id": str(conv.id),
                "message_id": str(msg.id),
                "fallback": False,
                "sources": (
                    public_sources(sources)
                    if widget
                    else sources
                ),
            }

            if not widget:

                done.update(
                    confidence=Confidence.known.value,
                    provider=None,
                    model=None,
                    latency_ms=latency_ms,
                    retrieval_ms=0,
                    credential_source=None,
                )

            await db.commit()

            yield done

            return

        # ==============================================================
        # FAST PATH #2
        #
        # Obvious general-knowledge questions.
        #
        # Example:
        #
        #   What is Python?
        #   Who was Albert Einstein?
        #   What is the capital of France?
        #
        # We skip Qdrant entirely.
        #
        # IMPORTANT:
        # Company-specific questions are excluded by
        # _looks_general_question().
        # ==============================================================

        general_question = (
            _looks_general_question(
                prep.question,
                prep.brand,
            )
            and not prep.suspected_injection
        )

        # ==============================================================
        # COMMON VARIABLES
        # ==============================================================

        sources: list[dict] = []

        tin = None
        tout = None

        blocked = False
        fallback = False

        retrieval_ms = 0

        answer = ""

        result = None

        req = None

        # ==============================================================
        # GENERAL QUESTION
        # ==============================================================

        if general_question:

            log.debug(
                "General question bypassing RAG "
                "(workspace=%s)",
                ctx.workspace_id,
            )

            prompt = self.rag.build_general_prompt(
                prep.question,
                brand=prep.brand,
                suspected_injection=prep.suspected_injection,
            )

            req = LLMRequest(
                messages=[
                    ChatMessage(
                        "system",
                        prompt.system,
                    ),
                    *prep.history,
                    ChatMessage(
                        "user",
                        prompt.user,
                    ),
                ],
                model=prep.ai.model,
                temperature=prep.ai.temperature,
                max_tokens=prep.ai.max_tokens,
            )

        # ==============================================================
        # COMPANY / UNKNOWN QUESTION
        #
        # Normal RAG path.
        # ==============================================================

        else:

            try:

                tr = time.perf_counter()

                result = await self.rag.retrieve(
                    str(ctx.workspace_id),
                    prep.question,
                )

                elapsed = (
                    time.perf_counter() - tr
                )

                retrieval_ms = int(
                    elapsed * 1000
                )

                metrics.RETRIEVAL_LATENCY.observe(
                    elapsed
                )

            except Exception as exc:

                metrics.DEPENDENCY_ERRORS.labels(
                    "retrieval"
                ).inc()

                log.exception(
                    "Retrieval failed for workspace %s",
                    ctx.workspace_id,
                )

                yield await fail(
                    getattr(
                        exc,
                        "user_message",
                        None,
                    )
                    or "Knowledge search is temporarily unavailable."
                )

                return

            # ----------------------------------------------------------
            # NO COMPANY INFORMATION FOUND
            #
            # Do NOT immediately return FALLBACK_MESSAGE.
            #
            # Instead, use the controlled general prompt. This allows:
            #
            #   "How are you?"
            #   "What is Python?"
            #
            # while preventing:
            #
            #   "What is your pricing?"
            #
            # from being invented.
            # ----------------------------------------------------------

            if result.confidence == Confidence.unknown:

                log.debug(
                    "No relevant company context found; "
                    "using controlled general-answer path "
                    "(workspace=%s)",
                    ctx.workspace_id,
                )

                if widget:
                    await self._record_unanswered(
                        db,
                        ctx.workspace_id,
                        prep.question,
                    )

                prompt = self.rag.build_general_prompt(
                    prep.question,
                    brand=prep.brand,
                    suspected_injection=prep.suspected_injection,
                )

                req = LLMRequest(
                    messages=[
                        ChatMessage(
                            "system",
                            prompt.system,
                        ),
                        *prep.history,
                        ChatMessage(
                            "user",
                            prompt.user,
                        ),
                    ],
                    model=prep.ai.model,
                    temperature=prep.ai.temperature,
                    max_tokens=prep.ai.max_tokens,
                )

            # ----------------------------------------------------------
            # COMPANY CONTEXT FOUND
            # ----------------------------------------------------------

            else:

                context, used = self.rag.build_context(
                    result.chunks
                )

                sources = self.rag.sources_payload(
                    used
                )

                prompt = self.rag.build_prompt(
                    result.question,
                    context,
                    brand=prep.brand,
                    confidence=result.confidence,
                    business_instructions=prep.ai.instructions,
                    suspected_injection=prep.suspected_injection,
                )

                req = LLMRequest(
                    messages=[
                        ChatMessage(
                            "system",
                            prompt.system,
                        ),
                        *prep.history,
                        ChatMessage(
                            "user",
                            prompt.user,
                        ),
                    ],
                    model=prep.ai.model,
                    temperature=prep.ai.temperature,
                    max_tokens=prep.ai.max_tokens,
                )

        # ==============================================================
        # LLM GENERATION
        #
        # This is used for:
        #
        #   - general questions
        #   - unknown questions
        #   - company questions with retrieved context
        #
        # Streaming is preserved.
        # ==============================================================

        parts: list[str] = []

        tl = time.perf_counter()

        try:

            if stream:

                async for ch in prep.ai.provider.stream(req):

                    if ch.text:

                        parts.append(ch.text)

                        yield {
                            "type": "delta",
                            "text": ch.text,
                        }

                    if (
                        ch.tokens_in
                        is not None
                    ):
                        tin = ch.tokens_in

                    if (
                        ch.tokens_out
                        is not None
                    ):
                        tout = ch.tokens_out

                answer = "".join(parts).strip()

            else:

                out = await prep.ai.provider.generate(
                    req
                )

                answer = out.text.strip()

                tin = out.tokens_in
                tout = out.tokens_out

        except ProviderError as exc:

            metrics.PROVIDER_ERRORS.labels(
                prep.ai.provider_name
            ).inc()

            log.error(
                "Provider %s failed for workspace %s: %s",
                prep.ai.provider_name,
                ctx.workspace_id,
                exc.detail,
            )

            yield await fail(
                exc.user_message
            )

            return

        except Exception:

            metrics.PROVIDER_ERRORS.labels(
                prep.ai.provider_name
            ).inc()

            log.exception(
                "Unexpected generation failure "
                "for workspace %s",
                ctx.workspace_id,
            )

            yield await fail(
                GENERIC_ERROR
            )

            return

        # --------------------------------------------------------------
        # LLM latency
        # --------------------------------------------------------------

        metrics.LLM_LATENCY.labels(
            prep.ai.provider_name
        ).observe(
            time.perf_counter() - tl
        )

        # --------------------------------------------------------------
        # Empty answer
        # --------------------------------------------------------------

        if not answer:

            yield await fail(
                GENERIC_ERROR
            )

            return

        # --------------------------------------------------------------
        # System prompt leak protection
        # --------------------------------------------------------------

        if leaks_system_prompt(answer):

            log.warning(
                "System-prompt leak blocked "
                "(workspace %s)",
                ctx.workspace_id,
            )

            answer = LEAK_REPLACEMENT
            blocked = True
            sources = []

            if stream:

                yield {
                    "type": "replace",
                    "text": answer,
                }

        # Non-streaming requests need one delta so the caller receives
        # the generated answer.
        if not stream:

            yield {
                "type": "delta",
                "text": answer,
            }

        # ==============================================================
        # PERSIST RESPONSE
        # ==============================================================

        latency_ms = int(
            (time.perf_counter() - t0)
            * 1000
        )

        # --------------------------------------------------------------
        # Token fallback estimates
        # --------------------------------------------------------------

        tin = (
            tin
            if tin is not None
            else (
                0
                if fallback
                else sum(
                    len(m.content)
                    for m in req.messages
                )
                // 4
            )
        )

        tout = (
            tout
            if tout is not None
            else (
                0
                if fallback
                else len(answer)
                // 4
            )
        )

        # --------------------------------------------------------------
        # Confidence
        # --------------------------------------------------------------

        if result is not None:
            confidence = result.confidence
        else:
            confidence = Confidence.unknown

        # --------------------------------------------------------------
        # Save assistant message
        # --------------------------------------------------------------

        msg = Message(
            workspace_id=ctx.workspace_id,
            conversation_id=conv.id,
            role="assistant",
            content=answer,
            sources=sources,
            provider=(
                None
                if fallback
                else prep.ai.provider_name
            ),
            model=(
                None
                if fallback
                else prep.ai.model
            ),
            tokens_in=tin,
            tokens_out=tout,
            latency_ms=latency_ms,
            was_fallback=fallback,
            created_at=datetime.now(timezone.utc),
        )

        db.add(msg)

        # --------------------------------------------------------------
        # Usage
        # --------------------------------------------------------------

        record_usage(
            db,
            ctx.workspace_id,
            "message",
            1,
            channel=ctx.channel,
            fallback=fallback,
        )

        # --------------------------------------------------------------
        # Provider/token/cost metrics
        # --------------------------------------------------------------

        if not fallback:

            ai = prep.ai

            meta = {
                "provider": ai.provider_name,
                "model": ai.model,
                "source": ai.credential_source,
            }

            record_usage(
                db,
                ctx.workspace_id,
                "tokens_in",
                tin,
                **meta,
            )

            record_usage(
                db,
                ctx.workspace_id,
                "tokens_out",
                tout,
                **meta,
            )

            metrics.LLM_TOKENS.labels(
                ai.provider_name,
                ai.model,
                "in",
            ).inc(tin)

            metrics.LLM_TOKENS.labels(
                ai.provider_name,
                ai.model,
                "out",
            ).inc(tout)

            cost = estimate_cost(
                ai.provider_name,
                ai.model,
                tin,
                tout,
            )

            if cost:

                record_usage(
                    db,
                    ctx.workspace_id,
                    f"ai_cost_{ai.credential_source}",
                    0,
                    cost_usd=cost,
                    **meta,
                )

                metrics.AI_COST.labels(
                    ai.credential_source
                ).inc(cost)

        # --------------------------------------------------------------
        # Chat metrics
        # --------------------------------------------------------------

        metrics.CHAT_MESSAGES.labels(
            ctx.channel,
            (
                "blocked"
                if blocked
                else (
                    "fallback"
                    if fallback
                    else "answered"
                )
            ),
        ).inc()

        await db.flush()

        # ==============================================================
        # FINAL DONE EVENT
        # ==============================================================

        done = {
            "type": "done",
            "conversation_id": str(conv.id),
            "message_id": str(msg.id),
            "fallback": fallback,
            "sources": (
                public_sources(sources)
                if widget
                else sources
            ),
        }

        # Playground gets diagnostic information.
        # Widget gets only customer-safe source information.
        if not widget:

            done.update(
                confidence=confidence.value,
                provider=msg.provider,
                model=msg.model,
                latency_ms=latency_ms,
                retrieval_ms=retrieval_ms,
                credential_source=(
                    None
                    if fallback
                    else prep.ai.credential_source
                ),
            )

        await db.commit()

        yield done

    # ==================================================================
    # UNANSWERED QUESTIONS
    # ==================================================================

    async def _record_unanswered(
        self,
        db: AsyncSession,
        workspace_id: uuid.UUID,
        question: str,
    ) -> None:

        qhash = hashlib.sha256(
            " ".join(
                question.lower().split()
            ).encode()
        ).hexdigest()

        now = datetime.now(timezone.utc)

        row = (
            await db.execute(
                select(UnansweredQuestion).where(
                    UnansweredQuestion.workspace_id
                    == workspace_id,
                    UnansweredQuestion.question_hash
                    == qhash,
                )
            )
        ).scalar_one_or_none()

        if row:

            row.frequency = row.frequency + 1
            row.last_asked_at = now

        else:

            try:

                async with db.begin_nested():

                    db.add(
                        UnansweredQuestion(
                            workspace_id=workspace_id,
                            question=question[:1000],
                            question_hash=qhash,
                            last_asked_at=now,
                        )
                    )

            except IntegrityError:

                # Concurrent insert of the same question.
                # The count is best-effort.
                pass