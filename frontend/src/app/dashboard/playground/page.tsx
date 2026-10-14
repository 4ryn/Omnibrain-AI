
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AIConfig, ChatResult } from "@/lib/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

interface Turn {
  question: string;
  result?: ChatResult;
  error?: string;
}

export default function PlaygroundPage() {
  const cfg = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => api<AIConfig>("/api/ai-config"),
  });

  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");

  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (question: string) =>
      api<ChatResult>("/api/chat", {
        json: {
          message: question,
          conversation_id: conversationId,
          provider: provider || null,
          model: model || null,
        },
      }),

    onMutate: (question) =>
      setTurns((t) => [...t, { question }]),

    onSuccess: (result) => {
      setConversationId(result.conversation_id);

      setTurns((t) =>
        t.map((x, i) =>
          i === t.length - 1 ? { ...x, result } : x
        )
      );
    },

    onError: (e) =>
      setTurns((t) =>
        t.map((x, i) =>
          i === t.length - 1
            ? { ...x, error: (e as Error).message }
            : x
        )
      ),
  });

  const send = () => {
    const q = message.trim();

    if (!q || ask.isPending) return;

    setMessage("");
    ask.mutate(q);
  };

  const newConversation = () => {
    setTurns([]);
    setConversationId(null);
    setMessage("");
  };

  return (
    <>
      <PageHeader
        title="Playground"
        description="Test your assistant before you put it on your website. Answers here use exactly the same knowledge and rules as the live widget."
        action={
          <Button variant="secondary" onClick={newConversation}>
            New conversation
          </Button>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#11131d] shadow-sm shadow-black/10">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Test conversation
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Preview your assistant&apos;s responses
              </p>
            </div>

            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              Test mode
            </span>
          </div>

          <div
            className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5"
            aria-live="polite"
            aria-relevant="additions"
          >
            {turns.length === 0 && (
              <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    className="h-6 w-6 text-violet-300"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 10h8M8 14h5m-8 6 3.5-3H17a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v11a3 3 0 0 0 1 3Z"
                    />
                  </svg>
                </div>

                <h3 className="text-sm font-semibold text-slate-200">
                  Start a conversation
                </h3>

                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                  Ask something your customers might ask, like
                  &ldquo;What services do you provide?&rdquo;
                </p>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-violet-400/20 bg-violet-600/20 px-4 py-3 text-sm leading-6 text-violet-50">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                      You
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {t.question}
                    </p>
                  </div>
                </div>

                {t.error ? (
                  <Alert>{t.error}</Alert>
                ) : !t.result ? (
                  <div className="flex justify-start">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                        Thinking…
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[95%] rounded-2xl rounded-bl-sm border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-slate-200">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      OmniBrain assistant
                    </p>

                    <p className="whitespace-pre-wrap break-words leading-6">
                      {t.result.answer}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3 text-[11px] text-slate-400">
                      <Badge
                        tone={
                          t.result.fallback
                            ? "amber"
                            : t.result.confidence === "known"
                              ? "green"
                              : "blue"
                        }
                      >
                        {t.result.fallback
                          ? "Fallback · no knowledge found"
                          : t.result.confidence}
                      </Badge>

                      {t.result.provider && (
                        <span>
                          {t.result.provider} / {t.result.model}
                        </span>
                      )}

                      <span>
                        {t.result.latency_ms} ms total ·{" "}
                        {t.result.retrieval_ms} ms retrieval
                      </span>
                    </div>

                    {t.result.sources.length > 0 && (
                      <details className="mt-3 border-t border-white/[0.08] pt-3 text-xs">
                        <summary className="cursor-pointer font-medium text-slate-300 transition-colors hover:text-violet-300">
                          {t.result.sources.length} source
                          {t.result.sources.length > 1 ? "s" : ""} used
                        </summary>

                        <ul className="mt-3 space-y-2">
                          {t.result.sources.map((s) => (
                            <li
                              key={s.index}
                              className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5"
                            >
                              <div className="break-words text-slate-300">
                                [{s.index}]{" "}
                                {s.url ? (
                                  <a
                                    className="text-violet-300 hover:text-violet-200 hover:underline"
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {s.source_name}
                                  </a>
                                ) : (
                                  s.source_name
                                )}
                              </div>

                              <div className="mt-1 text-slate-500">
                                Similarity score: {s.score}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div ref={end} />
          </div>

          <form
            className="border-t border-white/[0.08] bg-black/10 p-3 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Textarea
                  rows={1}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  aria-label="Your question"
                  placeholder="Type a question…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
              </div>

              <Button
                type="submit"
                loading={ask.isPending}
                disabled={!message.trim() || ask.isPending}
              >
                Ask
              </Button>
            </div>

            <p className="mt-2 px-1 text-[11px] text-slate-500">
              Press Enter to send · Shift + Enter for a new line
            </p>
          </form>
        </section>

        <div className="space-y-4">
          <Card title="Model for this test">
            {cfg.isLoading ? (
              <p className="text-sm text-slate-400">Loading configuration…</p>
            ) : cfg.isError ? (
              <Alert>{(cfg.error as Error).message}</Alert>
            ) : cfg.data ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Workspace default
                  </p>

                  <p className="mt-2 break-words text-sm font-medium text-slate-200">
                    {cfg.data.effective_provider}
                    {cfg.data.effective_model
                      ? ` / ${cfg.data.effective_model}`
                      : " (no model set)"}
                  </p>
                </div>

                <p className="text-xs leading-5 text-slate-400">
                  Overrides below apply only to this playground. Leave them
                  blank to use the workspace default.
                </p>

                <Field label="Provider">
                  <Select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    <option value="">Default</option>
                    {cfg.data.available_providers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Model">
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Default"
                    maxLength={128}
                  />
                </Field>
              </div>
            ) : null}
          </Card>

          <div className="rounded-xl border border-violet-400/15 bg-violet-500/[0.04] p-4">
            <h3 className="text-sm font-semibold text-slate-200">
              Testing tip
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Test questions covered by your uploaded documents and website
              content. Check the retrieved sources to understand what
              information supports each answer.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
