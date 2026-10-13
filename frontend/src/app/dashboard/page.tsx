"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Overview } from "@/lib/types";
import { fmtNum, fmtPct } from "@/lib/format";
import { Alert, Badge, Card, CopyButton, Loading, PageHeader, Stat } from "@/components/ui";

export default function OverviewPage() {
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/overview") });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Alert>{(q.error as Error).message}</Alert>;
  const o = q.data!;
  const steps = [
    { done: o.setup.knowledge_added, label: "Add your knowledge", hint: "Upload documents or add website URLs.", href: "/dashboard/documents" },
    { done: o.setup.ai_selected, label: "Choose your AI model", hint: "Pick a provider and model, or bring your own key.", href: "/dashboard/ai-config" },
    { done: o.setup.tested_in_playground, label: "Test in the Playground", hint: "Ask questions and check the sources.", href: "/dashboard/playground" },
    { done: o.setup.origins_configured, label: "Allow your website", hint: "Add the domain(s) where the widget may appear.", href: "/dashboard/widget" },
    { done: o.setup.widget_used, label: "Paste the snippet", hint: "One script tag on your site, then you're live.", href: "/dashboard/widget" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  const failed = o.documents.failed + o.urls.failed;
  const quota = o.quota;
  const quotaPct = quota.messages_per_month ? quota.messages_this_month / quota.messages_per_month : 0;
  return (
    <>
      <PageHeader title="Overview" description={`${o.workspace.name} · ${o.workspace.plan} plan · last 30 days`} />
      {quotaPct >= 0.8 && <div className="mb-4"><Alert tone={quotaPct >= 1 ? "error" : "warning"}>{quotaPct >= 1 ? "You've reached your monthly message limit. Visitors can't get answers until next month or an upgrade." : `You've used ${Math.round(quotaPct * 100)}% of this month's messages.`} <Link className="font-medium underline" href="/dashboard/usage">Usage</Link></Alert></div>}
      {failed > 0 && <div className="mb-4"><Alert tone="warning">{failed} knowledge source{failed > 1 ? "s" : ""} failed to process. <Link className="font-medium underline" href="/dashboard/documents">Review</Link></Alert></div>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Conversations" value={fmtNum(o.conversations_30d)} sub="from your website" />
        <Stat label="Unanswered rate" value={fmtPct(o.fallback_rate_30d)} sub={`${fmtNum(o.answers_30d)} answers`} />
        <Stat label="Leads" value={fmtNum(o.leads_30d)} sub={`${fmtNum(o.leads_total)} all time`} />
        <Stat label="Open knowledge gaps" value={fmtNum(o.open_unanswered)} sub={<Link href="/dashboard/unanswered" className="text-brand-600 hover:underline">Review</Link>} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={remaining ? `Setup checklist · ${remaining} step${remaining > 1 ? "s" : ""} left` : "Setup complete"}>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-start gap-3">
                <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-transparent"}`}>✓</span>
                <div><Link href={s.href} className={`text-sm font-medium ${s.done ? "text-slate-500 line-through" : "text-slate-900 hover:text-brand-600"}`}>{s.label}</Link>
                  {!s.done && <p className="text-xs text-slate-500">{s.hint}</p>}</div>
              </li>))}
          </ol>
        </Card>
        <div className="space-y-6">
          <Card title="Knowledge">
            <div className="flex flex-wrap gap-2 text-sm"><Badge tone="green">{o.documents.ready} documents ready</Badge><Badge tone="green">{o.urls.ready} URLs ready</Badge>{failed > 0 && <Badge tone="red">{failed} failed</Badge>}</div>
            <p className="mt-3 text-sm text-slate-500">Answering with <span className="font-medium text-slate-700">{o.ai.provider}{o.ai.model ? ` / ${o.ai.model}` : " (no model selected)"}</span> using {o.ai.credential_mode === "byok" ? "your own API key" : "platform credentials"}.</p>
          </Card>
          <Card title="Your website snippet" action={<CopyButton text={o.snippet} />}>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{o.snippet}</pre>
            <p className="mt-2 text-xs text-slate-500">Paste before the closing &lt;/body&gt; tag. Works with plain HTML, WordPress, Webflow, Shopify, React and more.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
