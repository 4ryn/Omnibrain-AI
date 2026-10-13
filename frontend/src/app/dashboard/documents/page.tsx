"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { fmtBytes, fmtDate } from "@/lib/format";
import { Alert, Button, DataTable, Empty, Loading, PageHeader, Pager, StatusBadge } from "@/components/ui";

const LIMIT = 25;

export default function DocumentsPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const list = useQuery({
    queryKey: ["documents", offset],
    queryFn: () => api<DocumentItem[]>(`/api/knowledge/documents?limit=${LIMIT}&offset=${offset}`),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "queued" || d.status === "processing") ? 3000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["documents"] }); qc.invalidateQueries({ queryKey: ["overview"] }); };
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      for (const f of files) {
        const form = new FormData(); form.append("file", f);
        try { await api("/api/knowledge/documents", { form }); } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`); }
      }
      return failed;
    },
    onSuccess: (failed) => { setErrors(failed); refresh(); },
  });
  const reindex = useMutation({ mutationFn: (id: string) => api(`/api/knowledge/documents/${id}/reindex`, { method: "POST" }), onSuccess: refresh, onError: (e) => setErrors([(e as Error).message]) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/knowledge/documents/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: (e) => setErrors([(e as Error).message]) });

  const pick = (files: FileList | null) => { if (files?.length) upload.mutate(Array.from(files)); };
  const columns: ColumnDef<DocumentItem>[] = [
    { header: "File", cell: ({ row: { original: d } }) => <div><div className="font-medium text-slate-900">{d.filename}</div>{d.error && <div className="mt-1 text-xs text-red-700">{d.error}</div>}</div> },
    { header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { header: "Chunks", accessorKey: "chunk_count" },
    { header: "Size", cell: ({ row }) => fmtBytes(row.original.size_bytes) },
    { header: "Added", cell: ({ row }) => fmtDate(row.original.created_at) },
    { header: "", id: "actions", cell: ({ row: { original: d } }) => (
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={d.status === "processing"} onClick={() => reindex.mutate(d.id)}>Re-index</Button>
        <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete "${d.filename}" and its indexed content?`)) remove.mutate(d.id); }}>Delete</Button>
      </div>) },
  ];

  return (
    <>
      <PageHeader title="Documents" description="PDF, Word (.docx), TXT, Markdown and CSV files. Processing happens in the background." />
      <div role="button" tabIndex={0} aria-label="Upload documents"
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        className={`mb-6 cursor-pointer rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white hover:border-slate-400"}`}>
        <input ref={input} type="file" multiple hidden accept=".pdf,.txt,.md,.markdown,.docx,.csv" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        {upload.isPending ? <span className="text-sm text-slate-600">Uploading…</span> : <><p className="text-sm font-medium text-slate-700">Drop files here or click to browse</p><p className="mt-1 text-xs text-slate-500">Up to 25 MB each</p></>}
      </div>
      {errors.length > 0 && <div className="mb-4 space-y-2">{errors.map((e, i) => <Alert key={i}>{e}</Alert>)}</div>}
      {list.isLoading ? <Loading /> : list.isError ? <Alert>{(list.error as Error).message}</Alert> :
        list.data!.length === 0 ? <Empty title="No documents yet">Upload your FAQs, brochures, price lists or policies to get started.</Empty> : (
          <><DataTable columns={columns} data={list.data!} />
            <Pager total={list.data!.length < LIMIT ? offset + list.data!.length : offset + LIMIT + 1} offset={offset} limit={LIMIT} onChange={setOffset} /></>)}
    </>
  );
}
