"use client";
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClosestHit, Paged, Unanswered } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Alert, Badge, Button, Empty, Loading, PageHeader, Pager, Select, StatusBadge } from "@/components/ui";

const LIMIT = 20;
const PRIORITY = { high: "red", medium: "amber", low: "gray" } as const;

function Closest({ id }: { id: string }) {
  const m = useMutation({ mutationFn: () => api<ClosestHit[]>(`/api/unanswered/${id}/closest`, { method: "POST" }) });
  return (
    <div className="mt-2">
      {!m.data && <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate()}>Find closest content</Button>}
      {m.isError && <div className="mt-2"><Alert>{(m.error as Error).message}</Alert></div>}
      {m.data && (m.data.length === 0 ? <p className="text-xs text-slate-500">Nothing in your knowledge base is related to this question.</p> : (
        <ul className="mt-1 space-y-2">{m.data.map((h, i) => <li key={i} className="rounded-md bg-slate-50 p-2 text-xs"><div className="font-medium text-slate-700">{h.source_name} <span className="font-normal text-slate-400">· similarity {h.score}</span></div><p className="mt-0.5 text-slate-600">{h.excerpt}…</p></li>)}</ul>))}
    </div>
  );
}

export default function UnansweredPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [sort, setSort] = useState("frequency");
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ["unanswered", status, sort, offset], queryFn: () => api<Paged<Unanswered>>(`/api/unanswered?status=${status}&sort=${sort}&limit=${LIMIT}&offset=${offset}`) });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/unanswered/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["unanswered"] }); qc.invalidateQueries({ queryKey: ["overview"] }); },
  });
  return (
    <>
      <PageHeader title="Unanswered questions" description="Questions your visitors asked that your knowledge couldn't answer. Each one is a chance to improve your assistant." />
      <div className="mb-4 flex gap-3">
        <div className="w-40"><Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="open">Open</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option><option value="all">All</option></Select></div>
        <div className="w-44"><Select aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}><option value="frequency">Most asked</option><option value="recent">Most recent</option></Select></div>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <Alert>{(q.error as Error).message}</Alert> : q.data!.items.length === 0 ? <Empty title="No unanswered questions">Great! Nothing to fix right now.</Empty> : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50"><tr>{["Question", "Asked", "Last asked", "Knowledge gap", "Suggested action", ""].map((h) => <th key={h} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.items.map((u) => (
                  <Fragment key={u.id}>
                    <tr>
                      <td className="max-w-xs px-4 py-3 align-top"><div className="font-medium text-slate-900">{u.question}</div>{status === "all" && <StatusBadge status={u.status} />}</td>
                      <td className="px-4 py-3 align-top"><Badge tone={PRIORITY[u.priority]}>{u.frequency}×</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-600">{fmtDate(u.last_asked_at)}</td>
                      <td className="px-4 py-3 align-top text-slate-700">{u.knowledge_gap}</td>
                      <td className="max-w-xs px-4 py-3 align-top text-slate-600">{u.potential_action}<Closest id={u.id} /></td>
                      <td className="px-4 py-3 align-top"><div className="flex justify-end gap-2">
                        {u.status === "open" ? (<><Button size="sm" variant="secondary" onClick={() => update.mutate({ id: u.id, status: "resolved" })}>Resolved</Button><Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, status: "ignored" })}>Ignore</Button></>)
                          : <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: u.id, status: "open" })}>Reopen</Button>}
                      </div></td>
                    </tr>
                  </Fragment>))}
              </tbody>
            </table>
          </div>
          <Pager total={q.data!.total} offset={offset} limit={LIMIT} onChange={setOffset} />
        </>)}
    </>
  );
}
