"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Alert, Button, Card, CopyButton, Field, Input, Loading, PageHeader } from "@/components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (me.data) setName(me.data.workspaces[0]?.name ?? ""); }, [me.data]);
  const rename = useMutation({
    mutationFn: () => api("/api/workspace", { method: "PATCH", json: { name } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["overview"] }); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  if (!me.data) return <Loading />;
  const { user, workspaces } = me.data, ws = workspaces[0];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-xl space-y-6">
        <Card title="Workspace">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(); }}>
            <Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></Field>
            <Field label="Workspace ID (used in your widget snippet)"><div className="flex items-center gap-2"><code className="rounded bg-slate-100 px-2 py-1 text-sm">{ws.public_id}</code><CopyButton text={ws.public_id} /></div></Field>
            <div className="text-sm text-slate-500">Plan: <span className="font-medium capitalize text-slate-700">{ws.plan}</span></div>
            {rename.isError && <Alert>{(rename.error as Error).message}</Alert>}
            <div className="flex items-center gap-3"><Button type="submit" loading={rename.isPending}>Save</Button>{saved && <span className="text-sm text-emerald-700">Saved.</span>}</div>
          </form>
        </Card>
        <Card title="Account">
          <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd>{user.name || "–"}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd>{user.email}</dd></div></dl>
          <p className="mt-3 text-xs text-slate-500">You sign in with Google. OmniBrain never sees or stores a password.</p>
          <Button className="mt-4" variant="secondary" onClick={async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); router.push("/login"); }}>Sign out</Button>
        </Card>
      </div>
    </>
  );
}
