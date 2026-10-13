"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { ConversationDetail, ConversationItem, Paged } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Alert, Badge, Button, Card, DataTable, Empty, Loading, PageHeader, Pager, Select } from "@/components/ui";

const LIMIT = 20;

function Transcript({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["conversation", id], queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`) });
  const del = useMutation({ mutationFn: () => api(`/api/conversations/${id}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["conversations"] }); onDeleted(); } });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Alert>{(q.error as Error).message}</Alert>;
  const { conversation: c, messages } = q.data!;
  return (
    <Card title="Transcript" action={<Button size="sm" variant="danger" loading={del.isPending} onClick={() => { if (confirm("Permanently delete this conversation?")) del.mutate(); }}>Delete</Button>}>
      <div className="mb-4 space-y-1 text-xs text-slate-500">
        <div>Started {fmtDate(c.created_at)} · {c.channel}</div>
        {c.source_page && <div className="truncate">Page: {c.source_page}</div>}
      </div>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && (
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  {m.was_fallback && <Badge tone="amber">no answer found</Badge>}
                  {m.model && <span>{m.provider}/{m.model}</span>}
                  {m.latency_ms != null && <span>{m.latency_ms} ms</span>}
                </div>)}
            </div>
          </li>))}
      </ol>
    </Card>
  );
}

export default function ConversationsPage() {
  const [offset, setOffset] = useState(0);
  const [channel, setChannel] = useState("widget");
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (channel) params.set("channel", channel);
  if (fallbackOnly) params.set("fallback_only", "true");
  const q = useQuery({ queryKey: ["conversations", channel, fallbackOnly, offset], queryFn: () => api<Paged<ConversationItem>>(`/api/conversations?${params}`) });

  const columns: ColumnDef<ConversationItem>[] = [
    { header: "First question", cell: ({ row: { original: c } }) => <div className="max-w-xs truncate font-medium text-slate-900">{c.preview || "(empty)"}</div> },
    { header: "Messages", accessorKey: "message_count" },
    { header: "Outcome", cell: ({ row }) => row.original.had_fallback ? <Badge tone="amber">unanswered</Badge> : <Badge tone="green">answered</Badge> },
    { header: "Last activity", cell: ({ row }) => fmtDate(row.original.last_activity ?? row.original.created_at) },
  ];
  return (
    <>
      <PageHeader title="Conversations" description="Every chat your visitors have with the assistant." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-44"><Select aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); setOffset(0); setActive(null); }}><option value="widget">Website visitors</option><option value="playground">Playground tests</option><option value="">All</option></Select></div>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={fallbackOnly} onChange={(e) => { setFallbackOnly(e.target.checked); setOffset(0); }} /> Only with unanswered questions</label>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <Alert>{(q.error as Error).message}</Alert> : q.data!.items.length === 0 ? <Empty title="No conversations yet">They'll appear here once visitors start chatting.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div><DataTable columns={columns} data={q.data!.items} onRowClick={(c) => setActive(c.id)} activeId={active} getId={(c) => c.id} />
            <Pager total={q.data!.total} offset={offset} limit={LIMIT} onChange={setOffset} /></div>
          <div>{active ? <Transcript key={active} id={active} onDeleted={() => setActive(null)} /> : <Empty title="Select a conversation" />}</div>
        </div>)}
    </>
  );
}
