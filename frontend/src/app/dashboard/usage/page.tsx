"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import type { Usage } from "@/lib/types";
import { fmtBytes, fmtNum } from "@/lib/format";
import { Alert, Card, DataTable, Empty, Loading, PageHeader, Select, Stat } from "@/components/ui";

function Meter({ label, used, limit, unit = "" }: { label: string; used: number; limit: number | null; unit?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span className="font-medium text-slate-700">{label}</span><span className="text-slate-500">{fmtNum(used)}{unit} / {limit == null ? "unlimited" : `${fmtNum(limit)}${unit}`}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div className={`h-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["usage", days], queryFn: () => api<Usage>(`/api/usage?days=${days}`) });
  const u = q.data;
  const max = u ? Math.max(1, ...u.daily.map((d) => d.message ?? 0)) : 1;
  const columns: ColumnDef<Usage["by_model"][number]>[] = [
    { header: "Provider", accessorKey: "provider" }, { header: "Model", accessorKey: "model" },
    { header: "Answers", cell: ({ row }) => fmtNum(row.original.answers) },
    { header: "Tokens in", cell: ({ row }) => fmtNum(row.original.tokens_in) }, { header: "Tokens out", cell: ({ row }) => fmtNum(row.original.tokens_out) },
    { header: "Avg latency", cell: ({ row }) => (row.original.avg_latency_ms != null ? `${fmtNum(row.original.avg_latency_ms)} ms` : "–") },
  ];
  return (
    <>
      <PageHeader title="Usage" description="Messages, tokens and storage for your workspace." action={<div className="w-36"><Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select></div>} />
      {q.isLoading ? <Loading /> : q.isError ? <Alert>{(q.error as Error).message}</Alert> : u && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Messages" value={fmtNum(u.totals.messages)} sub={`${u.plan} plan`} />
            <Stat label="Tokens in / out" value={`${fmtNum(u.totals.tokens_in)} / ${fmtNum(u.totals.tokens_out)}`} />
            <Stat label="Documents" value={fmtNum(u.totals.documents)} sub={fmtBytes(u.totals.storage_bytes)} />
            <Stat label="Voice" value={fmtNum(u.totals.voice_stt)} sub={`${fmtNum(u.totals.voice_tts_chars)} characters spoken`} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title={`Your ${u.limits.plan} plan`}>
              <div className="space-y-4">
                <Meter label="Messages this month" used={u.limits.messages_this_month} limit={u.limits.messages_per_month} />
                <Meter label="Knowledge sources" used={u.limits.sources_used} limit={u.limits.sources} />
                <Meter label="Storage" used={Math.round(u.totals.storage_bytes / 1024 / 1024)} limit={u.limits.storage_mb} unit=" MB" />
              </div>
              {u.limits.messages_per_month != null && u.limits.messages_this_month >= u.limits.messages_per_month && <div className="mt-4"><Alert tone="warning">Monthly message limit reached. Your assistant is paused for visitors until next month or an upgrade.</Alert></div>}
            </Card>
            <Card title="Approximate AI cost">
              {u.ai_cost_usd.pricing_configured ? (
                <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Platform-paid</dt><dd className="font-medium">${u.ai_cost_usd.platform.toFixed(4)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Your own keys (estimate)</dt><dd className="font-medium">${u.ai_cost_usd.byok_estimate.toFixed(4)}</dd></div></dl>
              ) : <p className="text-sm text-slate-500">Cost estimates are off because model prices aren&apos;t configured on this server (MODEL_PRICING_JSON). Token counts are always tracked.</p>}
            </Card>
          </div>
          <div className="mt-6"><Card title="Messages per day">
            {u.daily.length === 0 ? <p className="text-sm text-slate-500">No activity in this period.</p> : (
              <div className="flex h-40 items-end gap-1" role="img" aria-label="Bar chart of messages per day">
                {u.daily.map((d) => <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.message ?? 0} messages`}><div className="w-full rounded-t bg-brand-500 group-hover:bg-brand-700" style={{ height: `${Math.max(3, ((d.message ?? 0) / max) * 100)}%` }} /></div>)}
              </div>)}
            {u.daily.length > 0 && <div className="mt-2 flex justify-between text-xs text-slate-400"><span>{u.daily[0].date}</span><span>{u.daily[u.daily.length - 1].date}</span></div>}
          </Card></div>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">By model</h2>
          {u.by_model.length === 0 ? <Empty title="No AI answers yet" /> : <DataTable columns={columns} data={u.by_model} />}
        </>)}
    </>
  );
}
