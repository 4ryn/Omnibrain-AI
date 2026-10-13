"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Overview, SearchResponse } from "@/lib/types";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader } from "@/components/ui";

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/overview") });
  const search = useMutation({ mutationFn: (q: string) => api<SearchResponse>("/api/knowledge/search", { json: { query: q, top_k: 8 } }) });
  const o = overview.data;
  const tone = { known: "green", partial: "amber", unknown: "red" } as const;
  return (
    <>
      <PageHeader title="Knowledge" description="Search what your assistant knows. This runs the same retrieval your visitors' questions use, without calling the AI model." />
      {o && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/dashboard/documents"><Badge tone="indigo">{o.documents.ready} documents</Badge></Link>
          <Link href="/dashboard/urls"><Badge tone="indigo">{o.urls.ready} web pages</Badge></Link>
          {o.documents.failed + o.urls.failed > 0 && <Badge tone="red">{o.documents.failed + o.urls.failed} failed</Badge>}
        </div>)}
      <Card>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()); }}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. What services do we provide?" maxLength={2000} aria-label="Search your knowledge" />
          <Button type="submit" loading={search.isPending}>Search</Button>
        </form>
      </Card>
      <div className="mt-6 space-y-3">
        {search.isError && <Alert>{(search.error as Error).message}</Alert>}
        {search.data && (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-600">Coverage: <Badge tone={tone[search.data.confidence]}>{search.data.confidence}</Badge>
              {search.data.confidence === "unknown" && <span>Nothing relevant found. Your assistant would answer with its fallback message.</span>}</div>
            {search.data.hits.length === 0 ? <Empty title="No matching content" /> : search.data.hits.map((h, i) => (
              <Card key={i}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{h.url ? <a className="text-brand-600 hover:underline" href={h.url} target="_blank" rel="noopener noreferrer">{h.source_name}</a> : h.source_name}</span>
                  <span>similarity {h.score.toFixed(3)}</span></div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{h.content.length > 600 ? h.content.slice(0, 600) + "…" : h.content}</p>
              </Card>))}
          </>)}
      </div>
    </>
  );
}
