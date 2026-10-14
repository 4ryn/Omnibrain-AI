
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Field,
  Input,
  Loading,
  PageHeader,
} from "@/components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/auth/me"),
  });

  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data) {
      setName(me.data.workspaces[0]?.name ?? "");
    }
  }, [me.data]);

  const rename = useMutation({
    mutationFn: () =>
      api("/api/workspace", {
        method: "PATCH",
        json: { name },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (me.isLoading) return <Loading />;

  if (me.isError) {
    return <Alert>{(me.error as Error).message}</Alert>;
  }

  if (!me.data) return <Loading />;

  const { user, workspaces } = me.data;
  const ws = workspaces[0];

  if (!ws) {
    return <Alert>No workspace was found for this account.</Alert>;
  }

  const currentPlan = (ws.plan || "starter").toLowerCase();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your workspace, subscription information, and account."
      />

      <div className="max-w-2xl space-y-6">
        <Card title="Subscription & Plan">
          <div className="space-y-5">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Current plan
              </p>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-2xl font-semibold capitalize text-slate-100">
                  {currentPlan}
                </p>

                <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-3 py-1 text-xs font-medium text-amber-300">
                  Payment unverified
                </span>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-200">
                Subscription status
              </p>

              <p className="mt-1 text-sm text-slate-400">
                Billing has not been connected yet. A plan name alone does
                not confirm an active paid subscription.
              </p>
            </div>

            <Button
              onClick={() => router.push("/pricing")}
              className="w-full"
            >
              Upgrade / Change Plan
            </Button>

            <p className="text-xs leading-5 text-slate-500">
              Choose a plan on the pricing page. Paid access requires verified
              payment before activation.
            </p>
          </div>
        </Card>

        <Card title="Workspace">
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();

              if (name.trim()) {
                rename.mutate();
              }
            }}
          >
            <Field label="Workspace name">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                maxLength={120}
                required
              />
            </Field>

            <Field label="Workspace ID">
              <p className="mb-2 text-xs text-slate-400">
                Used to identify your workspace in the website widget.
              </p>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-black/10 p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-violet-300">
                  {ws.public_id}
                </code>

                <CopyButton text={ws.public_id} />
              </div>
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
              <span className="text-sm text-slate-400">
                Workspace plan
              </span>

              <span className="rounded-md bg-violet-500/10 px-2.5 py-1 text-sm font-medium capitalize text-violet-300">
                {currentPlan}
              </span>
            </div>

            {rename.isError && (
              <Alert>{(rename.error as Error).message}</Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                loading={rename.isPending}
                disabled={!name.trim()}
              >
                Save changes
              </Button>

              {saved && (
                <span className="text-sm font-medium text-emerald-400">
                  Workspace saved.
                </span>
              )}
            </div>
          </form>
        </Card>

        <Card title="Account">
          <dl className="space-y-4 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <dt className="text-slate-400">Name</dt>
              <dd className="break-words font-medium text-slate-200 sm:text-right">
                {user.name || "—"}
              </dd>
            </div>

            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <dt className="text-slate-400">Email</dt>
              <dd className="break-all font-medium text-slate-200 sm:text-right">
                {user.email}
              </dd>
            </div>
          </dl>

          <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-xs leading-5 text-slate-400">
              You sign in with Google. OmniBrain never sees or stores a
              password.
            </p>
          </div>

          <Button
            className="mt-5"
            variant="secondary"
            onClick={async () => {
              await api("/api/auth/logout", {
                method: "POST",
              }).catch(() => undefined);

              qc.clear();
              router.push("/login");
            }}
          >
            Sign out
          </Button>
        </Card>
      </div>
    </>
  );
}
