
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { Usage } from "@/lib/types";
import { fmtBytes, fmtNum } from "@/lib/format";
import {
  Alert,
  Card,
  DataTable,
  Empty,
  Loading,
  PageHeader,
  Select,
  Stat,
} from "@/components/ui";

function Meter({
  label,
  used,
  limit,
  unit = "",
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const pct =
    limit != null && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : 0;

  const barColor =
    pct >= 90
      ? "bg-red-400"
      : pct >= 70
        ? "bg-amber-400"
        : "bg-violet-400";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-200">{label}</span>

        <span className="text-xs tabular-nums text-slate-400">
          {fmtNum(used)}
          {unit} /{" "}
          {limit == null ? "unlimited" : `${fmtNum(limit)}${unit}`}
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [days, setDays] = useState(30);

  const q = useQuery({
    queryKey: ["usage", days],
    queryFn: () => api<Usage>(`/api/usage?days=${days}`),
  });

  const u = q.data;

  const max = u
    ? Math.max(1, ...u.daily.map((d) => d.message ?? 0))
    : 1;

  const columns: ColumnDef<Usage["by_model"][number]>[] = [
    {
      header: "Provider",
      accessorKey: "provider",
    },
    {
      header: "Model",
      accessorKey: "model",
    },
    {
      header: "Answers",
      cell: ({ row }) => fmtNum(row.original.answers),
    },
    {
      header: "Tokens in",
      cell: ({ row }) => fmtNum(row.original.tokens_in),
    },
    {
      header: "Tokens out",
      cell: ({ row }) => fmtNum(row.original.tokens_out),
    },
    {
      header: "Avg latency",
      cell: ({ row }) =>
        row.original.avg_latency_ms != null
          ? `${fmtNum(row.original.avg_latency_ms)} ms`
          : "—",
    },
  ];

  return (
    <>
      <PageHeader
        title="Usage"
        description="Messages, tokens and storage for your workspace."
        action={
          <div className="w-full sm:w-40">
            <Select
              aria-label="Period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
          </div>
        }
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Alert>{(q.error as Error).message}</Alert>
      ) : u ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Messages"
              value={fmtNum(u.totals.messages)}
              sub={`${u.plan} plan`}
            />

            <Stat
              label="Tokens in / out"
              value={`${fmtNum(u.totals.tokens_in)} / ${fmtNum(
                u.totals.tokens_out
              )}`}
            />

            <Stat
              label="Documents"
              value={fmtNum(u.totals.documents)}
              sub={fmtBytes(u.totals.storage_bytes)}
            />

            <Stat
              label="Voice"
              value={fmtNum(u.totals.voice_stt)}
              sub={`${fmtNum(u.totals.voice_tts_chars)} characters spoken`}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title={`Your ${u.limits.plan} plan`}>
              <div className="space-y-5">
                <Meter
                  label="Messages this month"
                  used={u.limits.messages_this_month}
                  limit={u.limits.messages_per_month}
                />

                <Meter
                  label="Knowledge sources"
                  used={u.limits.sources_used}
                  limit={u.limits.sources}
                />

                <Meter
                  label="Storage"
                  used={Math.round(u.totals.storage_bytes / 1024 / 1024)}
                  limit={u.limits.storage_mb}
                  unit=" MB"
                />
              </div>

              {u.limits.messages_per_month != null &&
                u.limits.messages_this_month >=
                  u.limits.messages_per_month && (
                  <div className="mt-5">
                    <Alert tone="warning">
                      Monthly message limit reached. Your assistant is paused
                      for visitors until next month or an upgrade.
                    </Alert>
                  </div>
                )}
            </Card>

            <Card title="Approximate AI cost">
              {u.ai_cost_usd.pricing_configured ? (
                <dl className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-slate-400">
                      Platform-paid
                    </dt>
                    <dd className="font-mono text-sm font-medium text-slate-100">
                      ${u.ai_cost_usd.platform.toFixed(4)}
                    </dd>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-slate-400">
                      Your own keys (estimate)
                    </dt>
                    <dd className="font-mono text-sm font-medium text-slate-100">
                      ${u.ai_cost_usd.byok_estimate.toFixed(4)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm leading-6 text-slate-400">
                  Cost estimates are off because model prices aren&apos;t
                  configured on this server (MODEL_PRICING_JSON). Token counts
                  are always tracked.
                </p>
              )}
            </Card>
          </div>

          <div className="mt-6">
            <Card title="Messages per day">
              {u.daily.length === 0 ? (
                <p className="py-6 text-sm text-slate-400">
                  No activity in this period.
                </p>
              ) : (
                <>
                  <div
                    className="flex h-44 items-end gap-1 rounded-lg border border-white/[0.06] bg-black/10 p-3"
                    role="img"
                    aria-label="Bar chart of messages per day"
                  >
                    {u.daily.map((d) => {
                      const count = d.message ?? 0;
                      const height =
                        count === 0
                          ? 2
                          : Math.max(5, (count / max) * 100);

                      return (
                        <div
                          key={d.date}
                          className="group relative flex h-full min-w-0 flex-1 items-end"
                          title={`${d.date}: ${count} messages`}
                        >
                          <div
                            className="w-full rounded-t-sm bg-violet-500/80 transition-colors group-hover:bg-violet-400"
                            style={{ height: `${height}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex justify-between gap-3 text-xs text-slate-400">
                    <span>{u.daily[0].date}</span>
                    <span>{u.daily[u.daily.length - 1].date}</span>
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="mb-3 mt-7 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Usage by model
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Answer counts, token consumption and response latency.
              </p>
            </div>
          </div>

          {u.by_model.length === 0 ? (
            <Empty title="No AI answers yet">
              Model usage will appear here after your assistant processes
              questions.
            </Empty>
          ) : (
            <DataTable columns={columns} data={u.by_model} />
          )}
        </>
      ) : null}
    </>
  );
}
