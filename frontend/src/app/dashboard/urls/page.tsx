
"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { UrlItem } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  Card,
  DataTable,
  Empty,
  Input,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/ui";

export default function UrlsPage() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["urls"],
    queryFn: () => api<UrlItem[]>("/api/knowledge/urls?limit=100"),
    refetchInterval: (q) =>
      q.state.data?.some(
        (d) => d.status === "queued" || d.status === "processing"
      )
        ? 3000
        : false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["urls"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };

  const add = useMutation({
    mutationFn: (u: string) =>
      api("/api/knowledge/urls", { json: { url: u } }),
    onSuccess: () => {
      setUrl("");
      setError(null);
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });

  const reindex = useMutation({
    mutationFn: (id: string) =>
      api(`/api/knowledge/urls/${id}/reindex`, { method: "POST" }),
    onSuccess: refresh,
    onError: (e) => setError((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/knowledge/urls/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => setError((e as Error).message),
  });

  const columns: ColumnDef<UrlItem>[] = [
    {
      header: "Page",
      cell: ({ row: { original: u } }) => (
        <div className="max-w-md min-w-0">
          <div className="truncate font-medium text-slate-100">
            {u.title || u.url}
          </div>

          <a
            className="mt-1 block truncate text-xs text-violet-300 transition-colors hover:text-violet-200 hover:underline"
            href={u.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {u.url}
          </a>

          {u.error && (
            <div className="mt-2 break-words text-xs leading-5 text-red-400">
              {u.error}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} />
      ),
    },
    {
      header: "Chunks",
      accessorKey: "chunk_count",
    },
    {
      header: "Last crawled",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-slate-400">
          {fmtDate(row.original.last_crawled_at)}
        </span>
      ),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row: { original: u } }) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={u.status === "processing" || reindex.isPending}
            loading={reindex.isPending && reindex.variables === u.id}
            onClick={() => reindex.mutate(u.id)}
          >
            Re-crawl
          </Button>

          <Button
            size="sm"
            variant="danger"
            disabled={remove.isPending}
            loading={remove.isPending && remove.variables === u.id}
            onClick={() => {
              if (confirm("Delete this page and its indexed content?")) {
                remove.mutate(u.id);
              }
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Web pages"
        description="Add public pages from your website. We extract the main content and ignore menus, headers and footers. Each URL is one page (no site crawling)."
      />

      <Card title="Add a web page" className="mb-6">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              setError(null);
              add.mutate(url.trim());
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/services"
              aria-label="Page URL"
              maxLength={2048}
            />
          </div>

          <Button
            type="submit"
            loading={add.isPending}
            disabled={!url.trim() || add.isPending}
          >
            Add page
          </Button>
        </form>

        <p className="mt-3 text-xs leading-5 text-slate-400">
          Add publicly accessible pages such as your services, pricing, about,
          and contact pages.
        </p>

        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
      </Card>

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <Alert>{(list.error as Error).message}</Alert>
      ) : list.data!.length === 0 ? (
        <Empty title="No pages added yet">
          Add your services, pricing, about and contact pages.
        </Empty>
      ) : (
        <DataTable columns={columns} data={list.data!} />
      )}
    </>
  );
}