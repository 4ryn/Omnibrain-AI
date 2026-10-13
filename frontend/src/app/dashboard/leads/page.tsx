"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { Lead, Paged } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Alert, Button, DataTable, Empty, Input, Loading, PageHeader, Pager } from "@/components/ui";

const LIMIT = 25;

export default function LeadsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ["leads", term, offset], queryFn: () => api<Paged<Lead>>(`/api/leads?limit=${LIMIT}&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ""}`) });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/leads/${id}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["overview"] }); } });
  const columns: ColumnDef<Lead>[] = [
    { header: "Contact", cell: ({ row: { original: l } }) => <div><div className="font-medium text-slate-900">{l.name || "Anonymous"}</div>{l.email && <a className="block text-brand-600 hover:underline" href={`mailto:${l.email}`}>{l.email}</a>}{l.phone && <a className="block text-slate-600" href={`tel:${l.phone}`}>{l.phone}</a>}</div> },
    { header: "Question", cell: ({ row }) => <div className="max-w-sm text-slate-700">{row.original.question || "–"}</div> },
    { header: "Page", cell: ({ row }) => <div className="max-w-[12rem] truncate text-xs text-slate-500">{row.original.source_page || "–"}</div> },
    { header: "Received", cell: ({ row }) => fmtDate(row.original.created_at) },
    { header: "", id: "a", cell: ({ row: { original: l } }) => <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete this lead?")) del.mutate(l.id); }}>Delete</Button> },
  ];
  return (
    <>
      <PageHeader title="Leads" description="Visitors who left their contact details when the assistant couldn't answer."
        action={<a href="/api/leads/export.csv" className="inline-flex rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export CSV</a>} />
      <form className="mb-4 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); setOffset(0); }}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone, question" aria-label="Search leads" maxLength={100} />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {del.isError && <div className="mb-3"><Alert>{(del.error as Error).message}</Alert></div>}
      {q.isLoading ? <Loading /> : q.isError ? <Alert>{(q.error as Error).message}</Alert> : q.data!.items.length === 0 ? <Empty title={term ? "No matching leads" : "No leads yet"}>{!term && "Make sure lead capture is enabled in Widget settings."}</Empty> : (
        <><DataTable columns={columns} data={q.data!.items} /><Pager total={q.data!.total} offset={offset} limit={LIMIT} onChange={setOffset} /></>)}
    </>
  );
}
