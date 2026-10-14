
"use client";

import { Fragment, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ClosestHit,
  Paged,
  Unanswered,
} from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Empty,
  Loading,
  PageHeader,
  Pager,
  Select,
  StatusBadge,
} from "@/components/ui";

const LIMIT = 20;

const PRIORITY = {
  high: "red",
  medium: "amber",
  low: "gray",
} as const;

function Closest({ id }: { id: string }) {
  const m = useMutation({
    mutationFn: () =>
      api<ClosestHit[]>(`/api/unanswered/${id}/closest`, {
        method: "POST",
      }),
  });

  return (
    <div className="mt-3">
      {!m.data && (
        <Button
          size="sm"
          variant="secondary"
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          Find closest content
        </Button>
      )}

      {m.isError && (
        <div className="mt-2">
          <Alert>{(m.error as Error).message}</Alert>
        </div>
      )}

      {m.data &&
        (m.data.length === 0 ? (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Nothing in your knowledge base is related to this question.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {m.data.map((h, i) => (
              <li
                key={i}
                className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3"
              >
                <div className="break-words text-xs font-medium text-slate-200">
                  {h.source_name}
                  <span className="ml-1 font-normal text-slate-400">
                    · similarity {h.score}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">
                  {h.excerpt}…
                </p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

export default function UnansweredPage() {
  const qc = useQueryClient();

  const [status, setStatus] = useState("open");
  const [sort, setSort] = useState("frequency");
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ["unanswered", status, sort, offset],
    queryFn: () =>
      api<Paged<Unanswered>>(
        `/api/unanswered?status=${status}&sort=${sort}&limit=${LIMIT}&offset=${offset}`
      ),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: string;
    }) =>
      api(`/api/unanswered/${id}`, {
        method: "PATCH",
        json: { status },
      }),

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unanswered"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <>
      <PageHeader
        title="Unanswered questions"
        description="Questions your visitors asked that your knowledge couldn't answer. Each one is a chance to improve your assistant."
      />

      <div className="mb-5 flex flex-wrap gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="w-full sm:w-44">
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
            <option value="all">All</option>
          </Select>
        </div>

        <div className="w-full sm:w-48">
          <Select
            aria-label="Sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setOffset(0);
            }}
          >
            <option value="frequency">Most asked</option>
            <option value="recent">Most recent</option>
          </Select>
        </div>
      </div>

      {update.isError && (
        <div className="mb-4">
          <Alert>{(update.error as Error).message}</Alert>
        </div>
      )}

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Alert>{(q.error as Error).message}</Alert>
      ) : q.data!.items.length === 0 ? (
        <Empty title="No unanswered questions">
          Great! Nothing to fix right now.
        </Empty>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-white/[0.09] bg-[#11131d] shadow-sm shadow-black/10">
            <table className="min-w-full divide-y divide-white/[0.08] text-sm">
              <thead className="bg-white/[0.025]">
                <tr>
                  {[
                    "Question",
                    "Asked",
                    "Last asked",
                    "Knowledge gap",
                    "Suggested action",
                    "",
                  ].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      scope="col"
                      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-white/[0.07]">
                {q.data!.items.map((u) => (
                  <Fragment key={u.id}>
                    <tr className="transition-colors hover:bg-white/[0.02]">
                      <td className="max-w-xs px-4 py-4 align-top">
                        <div className="whitespace-pre-wrap break-words font-medium leading-5 text-slate-100">
                          {u.question}
                        </div>

                        {status === "all" && (
                          <div className="mt-2">
                            <StatusBadge status={u.status} />
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 align-top">
                        <Badge tone={PRIORITY[u.priority]}>
                          {u.frequency}×
                        </Badge>
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 align-top text-xs text-slate-400">
                        {fmtDate(u.last_asked_at)}
                      </td>

                      <td className="max-w-xs px-4 py-4 align-top">
                        <p className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-300">
                          {u.knowledge_gap}
                        </p>
                      </td>

                      <td className="max-w-sm px-4 py-4 align-top">
                        <p className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-300">
                          {u.potential_action}
                        </p>

                        <Closest id={u.id} />
                      </td>

                      <td className="px-4 py-4 align-top">
                        <div className="flex min-w-24 flex-col items-stretch gap-2">
                          {u.status === "open" ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={
                                  update.isPending &&
                                  update.variables?.id === u.id
                                }
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({
                                    id: u.id,
                                    status: "resolved",
                                  })
                                }
                              >
                                Resolve
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({
                                    id: u.id,
                                    status: "ignored",
                                  })
                                }
                              >
                                Ignore
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={
                                update.isPending &&
                                update.variables?.id === u.id
                              }
                              disabled={update.isPending}
                              onClick={() =>
                                update.mutate({
                                  id: u.id,
                                  status: "open",
                                })
                              }
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

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
