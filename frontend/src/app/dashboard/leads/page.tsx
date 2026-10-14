
"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { Lead, Paged } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  DataTable,
  Empty,
  Input,
  Loading,
  PageHeader,
  Pager,
} from "@/components/ui";

const LIMIT = 25;

export default function LeadsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ["leads", term, offset],
    queryFn: () =>
      api<Paged<Lead>>(
        `/api/leads?limit=${LIMIT}&offset=${offset}${
          term ? `&q=${encodeURIComponent(term)}` : ""
        }`
      ),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/api/leads/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const columns: ColumnDef<Lead>[] = [
    {
      header: "Contact",
      cell: ({ row: { original: l } }) => (
        <div className="min-w-0 space-y-1">
          <div className="break-words font-medium text-slate-100">
            {l.name || "Anonymous"}
          </div>

          {l.email && (
            <a
              className="block break-all text-sm text-violet-300 transition-colors hover:text-violet-200 hover:underline"
              href={`mailto:${l.email}`}
            >
              {l.email}
            </a>
          )}

          {l.phone && (
            <a
              className="block text-sm text-slate-400 transition-colors hover:text-slate-200"
              href={`tel:${l.phone}`}
            >
              {l.phone}
            </a>
          )}
        </div>
      ),
    },
    {
      header: "Question",
      cell: ({ row }) => (
        <div className="max-w-sm whitespace-pre-wrap break-words text-slate-300">
          {row.original.question || "—"}
        </div>
      ),
    },
    {
      header: "Page",
      cell: ({ row }) => (
        <div
          className="max-w-[12rem] truncate text-xs text-slate-400"
          title={row.original.source_page || undefined}
        >
          {row.original.source_page || "—"}
        </div>
      ),
    },
    {
      header: "Received",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-slate-400">
          {fmtDate(row.original.created_at)}
        </span>
      ),
    },
    {
      header: "",
      id: "a",
      cell: ({ row: { original: l } }) => (
        <Button
          size="sm"
          variant="danger"
          loading={del.isPending && del.variables === l.id}
          disabled={del.isPending}
          onClick={() => {
            if (confirm("Delete this lead?")) {
              del.mutate(l.id);
            }
          }}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        description="Visitors who left their contact details when the assistant couldn't answer."
        action={
          <a
            href="/api/leads/export.csv"
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-white"
          >
            Export CSV
          </a>
        }
      />

      <div className="mb-5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <form
          className="flex flex-col gap-3 sm:max-w-xl sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(search.trim());
            setOffset(0);
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, question"
              aria-label="Search leads"
              maxLength={100}
            />
          </div>

          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {del.isError && (
        <div className="mb-4">
          <Alert>{(del.error as Error).message}</Alert>
        </div>
      )}

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Alert>{(q.error as Error).message}</Alert>
      ) : q.data!.items.length === 0 ? (
        <Empty title={term ? "No matching leads" : "No leads yet"}>
          {!term
            ? "Make sure lead capture is enabled in Widget settings."
            : "Try another search term."}
        </Empty>
      ) : (
        <>
          <DataTable columns={columns} data={q.data!.items} />

          <Pager
            total={q.data!.total}
            offset={offset}
            limit={LIMIT}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
