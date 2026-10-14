"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Overview } from "@/lib/types";
import { fmtNum, fmtPct } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Loading,
  PageHeader,
  Stat,
} from "@/components/ui";

export default function OverviewPage() {
  const searchParams = useSearchParams();
  const selectedPlan = searchParams.get("plan");
  const billing = searchParams.get("billing");

  const validPlan = ["starter", "business", "pro"].includes(
    selectedPlan ?? ""
  );
  const validBilling = ["monthly", "annual"].includes(billing ?? "");
  const showSelection = validPlan && validBilling;

  const q = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/api/overview"),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <Alert>{(q.error as Error).message}</Alert>;

  const o = q.data!;

  const steps = [
    {
      done: o.setup.knowledge_added,
      label: "Add your knowledge",
      hint: "Upload documents or add website URLs.",
      href: "/dashboard/documents",
    },
    {
      done: o.setup.ai_selected,
      label: "Choose your AI model",
      hint: "Pick a provider and model, or bring your own key.",
      href: "/dashboard/ai-config",
    },
    {
      done: o.setup.tested_in_playground,
      label: "Test in the Playground",
      hint: "Ask questions and check the sources.",
      href: "/dashboard/playground",
    },
    {
      done: o.setup.origins_configured,
      label: "Allow your website",
      hint: "Add the domain(s) where the widget may appear.",
      href: "/dashboard/widget",
    },
    {
      done: o.setup.widget_used,
      label: "Paste the snippet",
      hint: "One script tag on your site, then you're live.",
      href: "/dashboard/widget",
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;
  const failed = o.documents.failed + o.urls.failed;
  const quota = o.quota;

  const quotaPct = quota.messages_per_month
    ? quota.messages_this_month / quota.messages_per_month
    : 0;

  return (
    <div className="space-y-6 text-[#f4f4f8]">
      <PageHeader
        title="Overview"
        description={`${o.workspace.name} · ${o.workspace.plan} plan · last 30 days`}
      />

      {showSelection && (
        <Card title="Your selected plan">
          <div className="space-y-3">
            <p className="text-lg font-semibold capitalize text-[#f4f4f8]">
              {selectedPlan} · {billing} billing
            </p>

            <p className="text-sm leading-6 text-[#a1a1b2]">
              Your current workspace plan is{" "}
              <span className="font-medium capitalize text-[#f4f4f8]">
                {o.workspace.plan}
              </span>
              . Selecting a plan does not activate a subscription. Complete
              checkout to activate paid features.
            </p>

            <Button onClick={() => (window.location.href = "/pricing")}>
              Continue to Pricing
            </Button>
          </div>
        </Card>
      )}

      {quotaPct >= 0.8 && (
        <Alert tone={quotaPct >= 1 ? "error" : "warning"}>
          {quotaPct >= 1
            ? "You've reached your monthly message limit. Visitors can't get answers until next month or an upgrade."
            : `You've used ${Math.round(quotaPct * 100)}% of this month's messages.`}{" "}
          <Link
            className="font-medium underline"
            href="/dashboard/usage"
          >
            Usage
          </Link>
        </Alert>
      )}

      {failed > 0 && (
        <Alert tone="warning">
          {failed} knowledge source{failed > 1 ? "s" : ""} failed to process.{" "}
          <Link
            className="font-medium underline"
            href="/dashboard/documents"
          >
            Review
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Conversations"
          value={fmtNum(o.conversations_30d)}
          sub="from your website"
        />

        <Stat
          label="Unanswered rate"
          value={fmtPct(o.fallback_rate_30d)}
          sub={`${fmtNum(o.answers_30d)} answers`}
        />

        <Stat
          label="Leads"
          value={fmtNum(o.leads_30d)}
          sub={`${fmtNum(o.leads_total)} all time`}
        />

        <Stat
          label="Open knowledge gaps"
          value={fmtNum(o.open_unanswered)}
          sub={
            <Link
              href="/dashboard/unanswered"
              className="text-violet-400 hover:text-violet-300 hover:underline"
            >
              Review
            </Link>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={
            remaining
              ? `Setup checklist · ${remaining} step${remaining > 1 ? "s" : ""} left`
              : "Setup complete"
          }
        >
          <ol className="space-y-4">
            {steps.map((s) => (
              <li key={s.label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    s.done
                      ? "bg-emerald-500 text-white"
                      : "border border-[#454052] text-transparent"
                  }`}
                >
                  ✓
                </span>

                <div className="min-w-0">
                  <Link
                    href={s.href}
                    className={`text-sm font-medium transition-colors ${
                      s.done
                        ? "text-[#858599] line-through"
                        : "text-[#e4e4ec] hover:text-violet-400"
                    }`}
                  >
                    {s.label}
                  </Link>

                  {!s.done && (
                    <p className="mt-1 text-xs leading-5 text-[#a1a1b2]">
                      {s.hint}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card title="Knowledge">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="green">
                {o.documents.ready} documents ready
              </Badge>
              <Badge tone="green">{o.urls.ready} URLs ready</Badge>
              {failed > 0 && <Badge tone="red">{failed} failed</Badge>}
            </div>

            <p className="mt-3 text-sm leading-6 text-[#a1a1b2]">
              Answering with{" "}
              <span className="font-medium text-[#e4e4ec]">
                {o.ai.provider}
                {o.ai.model ? ` / ${o.ai.model}` : " (no model selected)"}
              </span>{" "}
              using{" "}
              {o.ai.credential_mode === "byok"
                ? "your own API key"
                : "platform credentials"}
              .
            </p>
          </Card>

          <Card
            title="Your website snippet"
            action={<CopyButton text={o.snippet} />}
          >
            <pre className="overflow-x-auto rounded-lg border border-[#272a38] bg-[#090b12] p-4 text-xs leading-5 text-[#d4d4e0]">
              {o.snippet}
            </pre>

            <p className="mt-3 text-xs leading-5 text-[#a1a1b2]">
              Paste before the closing &lt;/body&gt; tag. Works with plain
              HTML, WordPress, Webflow, Shopify, React and more.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}