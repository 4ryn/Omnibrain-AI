
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AIConfig } from "@/lib/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

interface Draft {
  mode: "platform" | "byok";
  provider: string;
  model: string;
  temperature: string;
  max_tokens: string;
  instructions: string;
}

function KeyRow({
  provider,
  hint,
  onChanged,
}: {
  provider: string;
  hint?: string;
  onChanged: () => void;
}) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/ai-config/credentials/${provider}`, {
        method: "PUT",
        json: { api_key: key },
      }),
    onSuccess: () => {
      setKey("");
      setMsg({ ok: true, text: "Key verified and saved." });
      onChanged();
    },
    onError: (e) =>
      setMsg({ ok: false, text: (e as Error).message }),
  });

  const remove = useMutation({
    mutationFn: () =>
      api(`/api/ai-config/credentials/${provider}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setMsg(null);
      onChanged();
    },
  });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/[0.15]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold capitalize text-slate-100">
          {provider}
        </span>

        <div className="flex items-center gap-2">
          {hint ? (
            <>
              <Badge tone="green">Saved {hint}</Badge>
              <Button
                size="sm"
                variant="danger"
                type="button"
                loading={remove.isPending}
                onClick={() => {
                  if (confirm(`Remove your ${provider} key?`)) {
                    remove.mutate();
                  }
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Badge> No key </Badge>
          )}
        </div>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim().length >= 8) save.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              hint ? "Paste a new key to replace" : "Paste API key"
            }
            aria-label={`${provider} API key`}
            maxLength={512}
          />
        </div>

        <Button
          type="submit"
          variant="secondary"
          loading={save.isPending}
          disabled={key.trim().length < 8}
        >
          Verify &amp; save
        </Button>
      </form>

      {msg && (
        <div className="mt-3">
          <Alert tone={msg.ok ? "success" : "error"}>
            {msg.text}
          </Alert>
        </div>
      )}
    </div>
  );
}

export default function AIConfigPage() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => api<AIConfig>("/api/ai-config"),
  });

  const [d, setD] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  const load = (c: AIConfig): Draft => ({
    mode: c.credential_mode,
    provider: c.llm_provider ?? "",
    model: c.llm_model ?? "",
    temperature: String(c.temperature),
    max_tokens: String(c.max_tokens),
    instructions: c.system_instructions ?? "",
  });

  useEffect(() => {
    if (q.data && !d) setD(load(q.data));
  }, [q.data, d]);

  const save = useMutation({
    mutationFn: (x: Draft) =>
      api<AIConfig>("/api/ai-config", {
        method: "PUT",
        json: {
          credential_mode: x.mode,
          llm_provider: x.provider || null,
          llm_model: x.model.trim() || null,
          temperature: Number(x.temperature),
          max_tokens: Number(x.max_tokens),
          system_instructions: x.instructions.trim() || null,
        },
      }),
    onSuccess: (c) => {
      qc.setQueryData(["ai-config"], c);
      qc.invalidateQueries({ queryKey: ["overview"] });
      setD(load(c));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (q.isLoading || !d) {
    return q.isError ? (
      <Alert>{(q.error as Error).message}</Alert>
    ) : (
      <Loading />
    );
  }

  const c = q.data!;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD({ ...d, [k]: v });
    setSaved(false);
  };

  const hints = Object.fromEntries(
    c.credentials.map((x) => [x.provider, x.key_hint])
  );

  const activeProvider = d.provider || c.effective_provider;
  const missingKey = d.mode === "byok" && !hints[activeProvider];

  return (
    <>
      <PageHeader
        title="AI configuration"
        description="Choose which AI model answers your visitors, and whose API key pays for it."
      />

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(d);
        }}
      >
        <Card title="Credentials">
          <div className="space-y-4 text-sm">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.07] p-3 transition-colors hover:bg-white/[0.025]">
              <input
                type="radio"
                name="mode"
                className="mt-1 accent-violet-500"
                checked={d.mode === "platform"}
                onChange={() => set("mode", "platform")}
              />
              <span>
                <span className="font-medium text-slate-100">
                  Use OmniBrain&apos;s keys
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  Available for:{" "}
                  {c.platform_providers.length
                    ? c.platform_providers.join(", ")
                    : "no providers configured on this server"}
                  .
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.07] p-3 transition-colors hover:bg-white/[0.025]">
              <input
                type="radio"
                name="mode"
                className="mt-1 accent-violet-500"
                checked={d.mode === "byok"}
                onChange={() => set("mode", "byok")}
              />
              <span>
                <span className="font-medium text-slate-100">
                  Bring your own key
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  Usage is billed to your own provider account. Keys are
                  encrypted at rest and never shown again.
                </span>
              </span>
            </label>
          </div>
        </Card>

        <Card title="Model">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Provider"
              hint={`Currently answering with ${c.effective_provider}${
                c.effective_model ? ` / ${c.effective_model}` : ""
              }.`}
            >
              <Select
                value={d.provider}
                onChange={(e) => {
                  const provider = e.target.value;
                  setD((x) =>
                    x ? { ...x, provider, model: "" } : x
                  );
                  setSaved(false);
                }}
              >
                <option value="">
                  Platform default ({c.effective_provider})
                </option>
                {c.available_providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Model"
              hint="Use the exact model name from your provider."
            >
              <Input
                value={d.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="e.g. a model your account can use"
                maxLength={128}
              />
            </Field>

            <Field
              label="Temperature"
              hint="Lower = more consistent, higher = more varied (0–2)."
            >
              <Input
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={d.temperature}
                onChange={(e) => set("temperature", e.target.value)}
              />
            </Field>

            <Field label="Max answer length (tokens)">
              <Input
                type="number"
                min={1}
                max={4096}
                value={d.max_tokens}
                onChange={(e) => set("max_tokens", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field
              label="Style instructions"
              hint="Tone and formatting only, such as “Be friendly and brief.” These can't override the rule to answer only from your knowledge."
            >
              <Textarea
                rows={3}
                value={d.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                maxLength={2000}
              />
            </Field>
          </div>
        </Card>

        {missingKey && (
          <Alert tone="warning">
            Bring-your-own-key is selected but no key is saved for{" "}
            <strong>{activeProvider}</strong>. Your assistant won&apos;t answer
            until you add one below.
          </Alert>
        )}

        {save.isError && (
          <Alert>{(save.error as Error).message}</Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            Save settings
          </Button>

          {saved && (
            <span className="text-sm font-medium text-emerald-400">
              Settings saved successfully.
            </span>
          )}
        </div>
      </form>

      <div className="mt-8">
        <Card title="Your API keys">
          <p className="mb-4 text-xs leading-5 text-slate-400">
            Each key is checked with the provider before it is saved. Only the
            last four characters are displayed afterwards.
          </p>

          <div className="space-y-3">
            {c.available_providers.map((p) => (
              <KeyRow
                key={p}
                provider={p}
                hint={hints[p]}
                onChanged={() =>
                  qc.invalidateQueries({ queryKey: ["ai-config"] })
                }
              />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
