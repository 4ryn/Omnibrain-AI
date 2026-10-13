export interface Workspace { id: string; name: string; slug: string; public_id: string; plan: string }
export interface Me { role: string; user: { id: string; email: string; name: string | null; avatar_url: string | null }; workspaces: Workspace[]; csrf_token: string }

export type IngestionStatus = "queued" | "processing" | "completed" | "failed";
export interface DocumentItem { id: string; filename: string; content_type: string; size_bytes: number; status: IngestionStatus; error: string | null; chunk_count: number; created_at: string }
export interface UrlItem { id: string; url: string; title: string | null; status: IngestionStatus; error: string | null; chunk_count: number; last_crawled_at: string | null; created_at: string }
export interface SearchHit { content: string; score: number; source_id: string; source_name: string; source_type: string; url: string | null }
export interface SearchResponse { confidence: "known" | "partial" | "unknown"; hits: SearchHit[] }

export interface ChatSource { index: number; source_id: string; source_name: string; source_type: string; url: string | null; score: number }
export interface ChatResult { conversation_id: string; message_id: string; answer: string; fallback: boolean; confidence: string; sources: ChatSource[]; provider: string | null; model: string | null; latency_ms: number; retrieval_ms: number }

export interface Credential { provider: string; key_hint: string }
export interface AIConfig { credential_mode: "platform" | "byok"; llm_provider: string | null; llm_model: string | null; temperature: number; max_tokens: number; system_instructions: string | null; effective_provider: string; effective_model: string | null; available_providers: string[]; platform_providers: string[]; credentials: Credential[] }

export interface WidgetConfig { brand_name: string; welcome_message: string; theme: "light" | "dark" | "auto"; position: "bottom-right" | "bottom-left"; logo_url: string | null; avatar_url: string | null; primary_color: string; suggested_questions: string[]; voice_enabled: boolean; lead_capture_enabled: boolean; allowed_origins: string[]; public_id: string; snippet: string; warnings: string[] }

export interface ConversationItem { id: string; channel: string; visitor_id: string | null; source_page: string | null; created_at: string; last_activity: string | null; message_count: number; had_fallback: boolean; preview: string | null }
export interface MessageItem { id: string; role: string; content: string; was_fallback: boolean; provider: string | null; model: string | null; tokens_in: number; tokens_out: number; latency_ms: number | null; created_at: string }
export interface Paged<T> { total: number; items: T[] }
export interface ConversationDetail { conversation: ConversationItem; messages: MessageItem[] }

export interface Lead { id: string; name: string | null; email: string | null; phone: string | null; question: string | null; source_page: string | null; conversation_id: string | null; created_at: string }
export interface Unanswered { id: string; question: string; frequency: number; last_asked_at: string; status: "open" | "resolved" | "ignored"; knowledge_gap: string; potential_action: string; priority: "high" | "medium" | "low" }
export interface ClosestHit { source_name: string; url: string | null; score: number; excerpt: string }

export interface Usage {
  days: number; plan: string;
  limits: { plan: string; messages_per_month: number | null; messages_this_month: number; sources: number | null; sources_used: number; storage_mb: number | null; voice: boolean };
  ai_cost_usd: { platform: number; byok_estimate: number; pricing_configured: boolean };
  totals: { messages: number; tokens_in: number; tokens_out: number; voice_stt: number; voice_tts_chars: number; documents: number; storage_bytes: number };
  daily: { date: string; message?: number; tokens_in?: number; tokens_out?: number }[];
  by_model: { provider: string; model: string; answers: number; tokens_in: number; tokens_out: number; avg_latency_ms: number | null }[];
}
export interface Overview {
  workspace: { name: string; plan: string; public_id: string };
  documents: { ready: number; failed: number }; urls: { ready: number; failed: number };
  conversations_30d: number; answers_30d: number; fallback_rate_30d: number | null;
  leads_30d: number; leads_total: number; open_unanswered: number; snippet: string;
  setup: { knowledge_added: boolean; ai_selected: boolean; tested_in_playground: boolean; origins_configured: boolean; widget_used: boolean };
  ai: { provider: string; model: string | null; credential_mode: string };
  quota: { messages_per_month: number | null; messages_this_month: number };
}
