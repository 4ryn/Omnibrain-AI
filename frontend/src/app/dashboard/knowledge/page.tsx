
"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Overview, SearchResponse } from "@/lib/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  PageHeader,
} from "@/components/ui";

export default function KnowledgePage() {
  const [query, setQuery] = useState("");

  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/api/overview"),
  });

  const search = useMutation({
    mutationFn: (q: string) =>
      api<SearchResponse>("/api/knowledge/search", {
        json: { query: q, top_k: 8 },
      }),
  });

  const o = overview.data;

  const tone = {
    known: "green",
    partial: "amber",
    unknown: "red",
  } as const;

  const submitSearch = () => {
    const trimmed = query.trim();
    if (trimmed) search.mutate(trimmed);
  };

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Search what your assistant knows. This runs the same retrieval your visitors' questions use, without calling the AI model."
      />

      {o && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/documents"
            className="rounded-lg transition-opacity hover:opacity-80"
          >
            <Badge tone="indigo">
              {o.documents.ready} documents
            </Badge>
          </Link>

          <Link
            href="/dashboard/urls"
            className="rounded-lg transition-opacity hover:opacity-80"
          >
            <Badge tone="indigo">
              {o.urls.ready} web pages
            </Badge>
          </Link>

          {o.documents.failed + o.urls.failed > 0 && (
            <Badge tone="red">
              {o.documents.failed + o.urls.failed} failed
            </Badge>
          )}
        </div>
      )}

      <Card title="Search your knowledge">
        <p className="mb-4 text-sm leading-6 text-slate-400">
          Enter a question to see which indexed content your assistant can
          retrieve. Results show matching content without generating an AI
          response.
        </p>

        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. What services do we provide?"
              maxLength={2000}
              aria-label="Search your knowledge"
            />
          </div>

          <Button
            type="submit"
            loading={search.isPending}
            disabled={!query.trim() || search.isPending}
          >
            Search knowledge
          </Button>
        </form>
      </Card>

      <div className="mt-6 space-y-4">
        {search.isError && (
          <Alert>{(search.error as Error).message}</Alert>
        )}

        {search.data && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <span className="text-sm font-medium text-slate-300">
                Retrieval coverage
              </span>

              <Badge tone={tone[search.data.confidence]}>
                {search.data.confidence}
              </Badge>

              {search.data.confidence === "unknown" && (
                <p className="text-sm text-slate-400">
                  Nothing relevant found. Your assistant would answer with
                  its fallback message.
                </p>
              )}

              {search.data.confidence === "known" && (
                <p className="text-sm text-slate-400">
                  Relevant content was found in your knowledge base.
                </p>
              )}

              {search.data.confidence === "partial" && (
                <p className="text-sm text-slate-400">
                  Some relevant content was found, but coverage may be
                  incomplete.
                </p>
              )}
            </div>

            {search.data.hits.length === 0 ? (
              <Empty title="No matching content">
                Try a different question or add more documents and web pages
                to your knowledge base.
              </Empty>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Retrieved sources
                  </h2>

                  <span className="text-xs text-slate-400">
                    {search.data.hits.length} results
                  </span>
                </div>

                {search.data.hits.map((h, i) => (
                  <Card key={`${h.source_name}-${i}`}>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Source {i + 1}
                        </p>

                        <div className="break-words text-sm font-medium text-slate-200">
                          {h.url ? (
                            <a
                              className="text-violet-300 transition-colors hover:text-violet-200 hover:underline"
                              href={h.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {h.source_name}
                            </a>
                          ) : (
                            h.source_name
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          Similarity
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-medium text-violet-300">
                          {h.score.toFixed(3)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/[0.06] bg-black/10 p-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                        {h.content.length > 600
                          ? h.content.slice(0, 600) + "…"
                          : h.content}
                      </p>

                      {h.content.length > 600 && (
                        <p className="mt-2 text-xs text-slate-500">
                          Preview limited to 600 characters.
                        </p>
                      )}
                    </div>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
