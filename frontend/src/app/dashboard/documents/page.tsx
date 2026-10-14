
"use client";

import { useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { fmtBytes, fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  DataTable,
  Empty,
  Loading,
  PageHeader,
  Pager,
  StatusBadge,
} from "@/components/ui";

const LIMIT = 25;

export default function DocumentsPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const list = useQuery({
    queryKey: ["documents", offset],
    queryFn: () =>
      api<DocumentItem[]>(
        `/api/knowledge/documents?limit=${LIMIT}&offset=${offset}`
      ),
    refetchInterval: (q) =>
      q.state.data?.some(
        (d) => d.status === "queued" || d.status === "processing"
      )
        ? 3000
        : false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];

      for (const f of files) {
        const form = new FormData();
        form.append("file", f);

        try {
          await api("/api/knowledge/documents", { form });
        } catch (e) {
          failed.push(`${f.name}: ${(e as Error).message}`);
        }
      }

      return failed;
    },
    onSuccess: (failed) => {
      setErrors(failed);
      refresh();
    },
  });

  const reindex = useMutation({
    mutationFn: (id: string) =>
      api(`/api/knowledge/documents/${id}/reindex`, {
        method: "POST",
      }),
    onSuccess: refresh,
    onError: (e) => setErrors([(e as Error).message]),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/knowledge/documents/${id}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
    onError: (e) => setErrors([(e as Error).message]),
  });

  const pick = (files: FileList | null) => {
    if (files?.length) {
      setErrors([]);
      upload.mutate(Array.from(files));
    }
  };

  const columns: ColumnDef<DocumentItem>[] = [
    {
      header: "File",
      cell: ({ row: { original: d } }) => (
        <div className="min-w-0">
          <div className="break-words font-medium text-slate-100">
            {d.filename}
          </div>

          {d.error && (
            <div className="mt-1 text-xs leading-5 text-red-400">
              {d.error}
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
      header: "Size",
      cell: ({ row }) => fmtBytes(row.original.size_bytes),
    },
    {
      header: "Added",
      cell: ({ row }) => fmtDate(row.original.created_at),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row: { original: d } }) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={
              d.status === "processing" ||
              reindex.isPending
            }
            loading={reindex.isPending && reindex.variables === d.id}
            onClick={() => reindex.mutate(d.id)}
          >
            Re-index
          </Button>

          <Button
            size="sm"
            variant="danger"
            loading={remove.isPending && remove.variables === d.id}
            disabled={remove.isPending}
            onClick={() => {
              if (
                confirm(
                  `Delete "${d.filename}" and its indexed content?`
                )
              ) {
                remove.mutate(d.id);
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
        title="Documents"
        description="PDF, Word (.docx), TXT, Markdown and CSV files. Processing happens in the background."
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        aria-busy={upload.isPending}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDrag(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
        className={`mb-6 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          upload.isPending
            ? "cursor-wait border-violet-400/30 bg-violet-500/[0.04]"
            : drag
              ? "cursor-pointer border-violet-400 bg-violet-500/10"
              : "cursor-pointer border-white/10 bg-white/[0.02] hover:border-violet-400/60 hover:bg-violet-500/[0.04]"
        }`}
      >
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".pdf,.txt,.md,.markdown,.docx,.csv"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10">
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
              d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"
            />
          </svg>
        </div>

        {upload.isPending ? (
          <>
            <p className="text-sm font-medium text-slate-200">
              Uploading documents…
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Please keep this page open while the upload finishes.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-200">
              Drop files here or{" "}
              <span className="text-violet-300">browse files</span>
            </p>
            <p className="mt-2 text-xs text-slate-400">
              PDF, DOCX, TXT, Markdown or CSV · Up to 25 MB each
            </p>
          </>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mb-5 space-y-2">
          {errors.map((e, i) => (
            <Alert key={`${i}-${e}`}>{e}</Alert>
          ))}
        </div>
      )}

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <Alert>{(list.error as Error).message}</Alert>
      ) : list.data!.length === 0 ? (
        <Empty title="No documents yet">
          Upload your FAQs, brochures, price lists or policies to get started.
        </Empty>
      ) : (
        <>
          <DataTable columns={columns} data={list.data!} />

          <Pager
            total={
              list.data!.length < LIMIT
                ? offset + list.data!.length
                : offset + LIMIT + 1
            }
            offset={offset}
            limit={LIMIT}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
