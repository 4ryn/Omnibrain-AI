"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { WidgetConfig } from "@/lib/types";
import { Alert, Button, Card, CopyButton, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";

interface Draft {
  brand_name: string; welcome_message: string; theme: WidgetConfig["theme"]; position: WidgetConfig["position"];
  logo_url: string; avatar_url: string; primary_color: string; questions: string; origins: string;
  voice_enabled: boolean; lead_capture_enabled: boolean;
}
const toDraft = (c: WidgetConfig): Draft => ({
  brand_name: c.brand_name, welcome_message: c.welcome_message, theme: c.theme, position: c.position,
  logo_url: c.logo_url ?? "", avatar_url: c.avatar_url ?? "", primary_color: c.primary_color,
  questions: c.suggested_questions.join("\n"), origins: c.allowed_origins.join("\n"),
  voice_enabled: c.voice_enabled, lead_capture_enabled: c.lead_capture_enabled,
});
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function Preview({ d }: { d: Draft }) {
  const dark = d.theme === "dark";
  const color = /^#[0-9a-fA-F]{6}$/.test(d.primary_color) ? d.primary_color : "#4f46e5";
  return (
    <div className={`relative h-80 overflow-hidden rounded-lg border ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-100"}`} aria-label="Widget preview">
      <div className={`absolute bottom-3 ${d.position === "bottom-left" ? "left-3" : "right-3"} w-64 overflow-hidden rounded-xl shadow-lg ${dark ? "bg-slate-800 text-slate-100" : "bg-white text-slate-800"}`}>
        <div className="px-3 py-2 text-sm font-semibold text-white" style={{ background: color }}>{d.brand_name || "Assistant"}</div>
        <div className="space-y-2 p-3 text-xs">
          <div className={`inline-block rounded-lg px-2.5 py-1.5 ${dark ? "bg-slate-700" : "bg-slate-100"}`}>{d.welcome_message}</div>
          <div className="flex flex-wrap gap-1">{lines(d.questions).slice(0, 3).map((q) => <span key={q} className={`rounded-full border px-2 py-0.5 ${dark ? "border-slate-600" : "border-slate-300"}`}>{q}</span>)}</div>
        </div>
        <div className={`flex items-center justify-between border-t px-3 py-2 text-xs ${dark ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-400"}`}><span>Type your question…</span><span className="rounded px-2 py-0.5 text-white" style={{ background: color }}>Send</span></div>
      </div>
    </div>
  );
}

export default function WidgetPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["widget-config"], queryFn: () => api<WidgetConfig>("/api/widget-config") });
  const [d, setD] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data && !d) setD(toDraft(q.data)); }, [q.data, d]);
  const save = useMutation({
    mutationFn: (x: Draft) => api<WidgetConfig>("/api/widget-config", { method: "PUT", json: {
      brand_name: x.brand_name, welcome_message: x.welcome_message, theme: x.theme, position: x.position,
      logo_url: x.logo_url.trim() || null, avatar_url: x.avatar_url.trim() || null, primary_color: x.primary_color,
      suggested_questions: lines(x.questions), allowed_origins: lines(x.origins),
      voice_enabled: x.voice_enabled, lead_capture_enabled: x.lead_capture_enabled } }),
    onSuccess: (c) => { qc.setQueryData(["widget-config"], c); qc.invalidateQueries({ queryKey: ["overview"] }); setD(toDraft(c)); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  if (q.isLoading || !d) return q.isError ? <Alert>{(q.error as Error).message}</Alert> : <Loading />;
  const c = q.data!;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD({ ...d, [k]: v }); setSaved(false); };

  return (
    <>
      <PageHeader title="Widget" description="Customize the chat widget and copy the one-line snippet for your website. Changes go live immediately, with no need to replace the snippet." />
      <div className="mb-6"><Card title="Your website snippet" action={<CopyButton text={c.snippet} />}>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{c.snippet}</pre>
        <p className="mt-2 text-xs text-slate-500">Paste it before the closing &lt;/body&gt; tag of your site (or into your site builder&apos;s custom-code / footer-scripts area).</p>
      </Card></div>
      {c.warnings.map((w) => <div key={w} className="mb-4"><Alert tone="warning">{w}</Alert></div>)}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(d); }}>
          <Card title="Appearance">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand name"><Input value={d.brand_name} onChange={(e) => set("brand_name", e.target.value)} maxLength={120} required /></Field>
              <Field label="Primary color"><div className="flex gap-2"><input type="color" aria-label="Pick color" value={/^#[0-9a-fA-F]{6}$/.test(d.primary_color) ? d.primary_color : "#4f46e5"} onChange={(e) => set("primary_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" /><Input value={d.primary_color} onChange={(e) => set("primary_color", e.target.value)} maxLength={7} /></div></Field>
              <Field label="Theme"><Select value={d.theme} onChange={(e) => set("theme", e.target.value as Draft["theme"])}><option value="light">Light</option><option value="dark">Dark</option><option value="auto">Match visitor&apos;s device</option></Select></Field>
              <Field label="Position"><Select value={d.position} onChange={(e) => set("position", e.target.value as Draft["position"])}><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></Select></Field>
              <Field label="Logo URL" hint="Optional. https image."><Input type="url" value={d.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Avatar URL" hint="Shown in the chat header. Falls back to the logo."><Input type="url" value={d.avatar_url} onChange={(e) => set("avatar_url", e.target.value)} placeholder="https://…" /></Field>
            </div>
          </Card>
          <Card title="Messages">
            <div className="space-y-4">
              <Field label="Welcome message"><Textarea rows={2} value={d.welcome_message} onChange={(e) => set("welcome_message", e.target.value)} maxLength={500} required /></Field>
              <Field label="Suggested questions" hint="One per line, up to 6."><Textarea rows={4} value={d.questions} onChange={(e) => set("questions", e.target.value)} placeholder={"What services do you offer?\nWhat are your opening hours?"} /></Field>
            </div>
          </Card>
          <Card title="Features">
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.lead_capture_enabled} onChange={(e) => set("lead_capture_enabled", e.target.checked)} /><span><span className="font-medium">Lead capture</span><span className="block text-xs text-slate-500">When the assistant can&apos;t answer, offer to take the visitor&apos;s contact details.</span></span></label>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.voice_enabled} onChange={(e) => set("voice_enabled", e.target.checked)} /><span><span className="font-medium">Voice</span><span className="block text-xs text-slate-500">Let visitors speak their question and hear answers. Requires speech models to be configured on the server.</span></span></label>
            </div>
          </Card>
          <Card title="Allowed websites">
            <Field label="Domains where the widget may appear" hint="One per line, e.g. https://www.example.com or https://*.example.com. Include the scheme. Required in production.">
              <Textarea rows={3} value={d.origins} onChange={(e) => set("origins", e.target.value)} placeholder="https://www.example.com" spellCheck={false} /></Field>
          </Card>
          {save.isError && <Alert>{(save.error as Error).message}</Alert>}
          <div className="flex items-center gap-3"><Button type="submit" loading={save.isPending}>Save changes</Button>{saved && <span className="text-sm text-emerald-700">Saved. Live on your site now.</span>}</div>
        </form>
        <div className="lg:sticky lg:top-6 lg:self-start"><h2 className="mb-2 text-sm font-semibold text-slate-700">Preview</h2><Preview d={d} /></div>
      </div>
    </>
  );
}
