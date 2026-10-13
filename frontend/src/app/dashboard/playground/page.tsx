"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AIConfig, ChatResult } from "@/lib/types";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";

interface Turn { question: string; result?: ChatResult; error?: string }

export default function PlaygroundPage() {
  const cfg = useQuery({ queryKey: ["ai-config"], queryFn: () => api<AIConfig>("/api/ai-config") });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);

  const ask = useMutation({
    mutationFn: (question: string) => api<ChatResult>("/api/chat", { json: { message: question, conversation_id: conversationId, provider: provider || null, model: model || null } }),
    onMutate: (question) => setTurns((t) => [...t, { question }]),
    onSuccess: (result) => { setConversationId(result.conversation_id); setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x))); },
    onError: (e) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x))),
  });
  const send = () => { const q = message.trim(); if (!q || ask.isPending) return; setMessage(""); ask.mutate(q); };

  return (
    <>
      <PageHeader title="Playground" description="Test your assistant before you put it on your website. Answers here use exactly the same knowledge and rules as the live widget."
        action={<Button variant="secondary" onClick={() => { setTurns([]); setConversationId(null); }}>New conversation</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-[28rem] flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite">
            {turns.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Ask something your customers might ask, like “What services do you provide?”</p>}
            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-end"><div className="max-w-[80%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">{t.question}</div></div>
                {t.error ? <Alert>{t.error}</Alert> : !t.result ? <div className="text-sm text-slate-400">Thinking…</div> : (
                  <div className="max-w-[90%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
                    <p className="whitespace-pre-wrap">{t.result.answer}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                      <Badge tone={t.result.fallback ? "amber" : t.result.confidence === "known" ? "green" : "blue"}>{t.result.fallback ? "fallback (no knowledge found)" : t.result.confidence}</Badge>
                      {t.result.provider && <span>{t.result.provider} / {t.result.model}</span>}
                      <span>{t.result.latency_ms} ms total · {t.result.retrieval_ms} ms retrieval</span>
                    </div>
                    {t.result.sources.length > 0 && (
                      <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-slate-600">{t.result.sources.length} source{t.result.sources.length > 1 ? "s" : ""} used</summary>
                        <ul className="mt-1 space-y-1">{t.result.sources.map((s) => <li key={s.index}>[{s.index}] {s.url ? <a className="text-brand-600 hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.source_name}</a> : s.source_name} <span className="text-slate-400">· score {s.score}</span></li>)}</ul></details>)}
                  </div>)}
              </div>))}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <Textarea rows={1} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} aria-label="Your question" placeholder="Type a question…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <Button type="submit" loading={ask.isPending}>Ask</Button>
          </form>
        </div>
        <Card title="Model for this test">
          {cfg.data && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Workspace default: <span className="font-medium text-slate-700">{cfg.data.effective_provider}{cfg.data.effective_model ? ` / ${cfg.data.effective_model}` : " (no model set)"}</span>. Overrides below apply only to this playground.</p>
              <Field label="Provider"><Select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Default</option>{cfg.data.available_providers.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
              <Field label="Model"><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Default" maxLength={128} /></Field>
            </div>)}
        </Card>
      </div>
    </>
  );
}
