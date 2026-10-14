
"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type {
  ConversationDetail,
  ConversationItem,
  Paged,
} from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  Loading,
  PageHeader,
  Pager,
  Select,
} from "@/components/ui";

const LIMIT = 20;

function Transcript({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`),
  });

  const del = useMutation({
    mutationFn: () =>
      api(`/api/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onDeleted();
    },
  });

  if (q.isLoading) return <Loading />;

  if (q.isError) {
    return <Alert>{(q.error as Error).message}</Alert>;
  }

  const { conversation: c, messages } = q.data!;

  return (
    <Card
      title="Transcript"
      action={
        <Button
          size="sm"
          variant="danger"
          loading={del.isPending}
          onClick={() => {
            if (confirm("Permanently delete this conversation?")) {
              del.mutate();
            }
          }}
        >
          Delete
        </Button>
      }
    >
      <div className="mb-5 space-y-1.5 text-xs text-slate-400">
        <div>
          Started {fmtDate(c.created_at)} · {c.channel}
        </div>

        {c.source_page && (
          <div className="truncate">
            Page: <span className="text-slate-300">{c.source_page}</span>
          </div>
        )}
      </div>

      {messages.length === 0 ? (
        <Empty title="No messages">This conversation has no messages.</Empty>
      ) : (
        <ol className="space-y-4">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-xl border px-4 py-3 text-sm leading-6 ${
                  m.role === "user"
                    ? "border-violet-400/20 bg-violet-600/20 text-violet-50"
                    : "border-white/[0.08] bg-white/[0.04] text-slate-200"
                }`}
              >
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {m.role === "user" ? "Visitor" : "Assistant"}
                </div>

                <p className="whitespace-pre-wrap break-words">
                  {m.content}
                </p>

                {m.role === "assistant" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-2 text-[11px] text-slate-400">
                    {m.was_fallback && (
                      <Badge tone="amber">No answer found</Badge>
                    )}

                    {m.model && (
                      <span>
                        {m.provider}/{m.model}
                      </span>
                    )}

                    {m.latency_ms != null && (
                      <span>{m.latency_ms} ms</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function ConversationsPage() {
  const [offset, setOffset] = useState(0);
  const [channel, setChannel] = useState("widget");
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const params = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
  });

  if (channel) params.set("channel", channel);
  if (fallbackOnly) params.set("fallback_only", "true");

  const q = useQuery({
    queryKey: ["conversations", channel, fallbackOnly, offset],
    queryFn: () =>
      api<Paged<ConversationItem>>(`/api/conversations?${params}`),
  });

  const columns: ColumnDef<ConversationItem>[] = [
    {
      header: "First question",
      cell: ({ row: { original: c } }) => (
        <div className="max-w-xs truncate font-medium text-slate-100">
          {c.preview || "(empty)"}
        </div>
      ),
    },
    {
      header: "Messages",
      accessorKey: "message_count",
    },
    {
      header: "Outcome",
      cell: ({ row }) =>
        row.original.had_fallback ? (
          <Badge tone="amber">Unanswered</Badge>
        ) : (
          <Badge tone="green">Answered</Badge>
        ),
    },
    {
      header: "Last activity",
      cell: ({ row }) =>
        fmtDate(row.original.last_activity ?? row.original.created_at),
    },
  ];

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every chat your visitors have with the assistant."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <div className="w-full sm:w-52">
          <Select
            aria-label="Channel"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setOffset(0);
              setActive(null);
            }}
          >
            <option value="widget">Website visitors</option>
            <option value="playground">Playground tests</option>
            <option value="">All channels</option>
          </Select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="accent-violet-500"
            checked={fallbackOnly}
            onChange={(e) => {
              setFallbackOnly(e.target.checked);
              setOffset(0);
            }}
          />
          Only with unanswered questions
        </label>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Alert>{(q.error as Error).message}</Alert>
      ) : q.data!.items.length === 0 ? (
        <Empty title="No conversations yet">
          They&apos;ll appear here once visitors start chatting.
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <DataTable
              columns={columns}
              data={q.data!.items}
              onRowClick={(c) => setActive(c.id)}
              activeId={active}
              getId={(c) => c.id}
            />

            <Pager
              total={q.data!.total}
              offset={offset}
              limit={LIMIT}
              onChange={setOffset}
            />
          </div>

          <div className="min-w-0">
            {active ? (
              <Transcript
                key={active}
                id={active}
                onDeleted={() => setActive(null)}
              />
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] p-6">
                <Empty title="Select a conversation">
                  Choose a conversation from the table to view its transcript.
                </Empty>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
