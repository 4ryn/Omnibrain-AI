"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AuthStatus = "checking" | "authenticated" | "anonymous";

const features = [
  {
    number: "01",
    title: "Answers grounded in your documents",
    description:
      "Give your AI assistant company documentation, FAQs, and knowledge sources to help answer customer questions.",
  },
  {
    number: "02",
    title: "One widget for your website",
    description:
      "Embed your assistant into your website and give visitors a direct way to find information.",
  },
  {
    number: "03",
    title: "Understand customer conversations",
    description:
      "Review conversations, discover unanswered questions, and identify opportunities to improve your support content.",
  },
];

export default function HomePage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (active) {
          setAuthStatus(response.ok ? "authenticated" : "anonymous");
        }
      } catch {
        if (active) {
          setAuthStatus("anonymous");
        }
      }
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  const signedIn = authStatus === "authenticated";
  const checking = authStatus === "checking";

  const primaryHref = signedIn ? "/dashboard" : "/login";
  const primaryLabel = signedIn
    ? "Open dashboard"
    : checking
      ? "Checking session…"
      : "Get started";

  return (
    <main className="min-h-screen overflow-hidden bg-[#090b12] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-xl font-bold tracking-tight">
            OmniBrain<span className="text-violet-400"> AI</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm sm:gap-6">
            <Link
              href="#features"
              className="hidden text-slate-300 hover:text-white sm:block"
            >
              Features
            </Link>

            <Link
              href="/pricing"
              className="text-slate-300 hover:text-white"
            >
              Pricing
            </Link>

            {checking ? (
              <span className="rounded-lg border border-white/10 px-4 py-2 text-slate-400">
                Checking session…
              </span>
            ) : (
              <Link
                href={signedIn ? "/dashboard" : "/login"}
                className="rounded-lg border border-white/20 px-4 py-2 transition hover:bg-white/10"
              >
                {signedIn ? "Dashboard" : "Sign in"}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <section className="relative mx-auto max-w-7xl px-6 pb-24 pt-24 sm:pb-32 sm:pt-32">
        <div className="pointer-events-none absolute left-1/2 top-16 -z-0 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-600/20 blur-[100px]" />

        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-flex rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-sm text-violet-200">
            Document-aware AI for your business
          </span>

          <h1 className="mt-7 text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
            Your knowledge.
            <span className="block text-violet-400">
              Your AI assistant.
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-slate-400 sm:text-lg">
            Turn your business documents into a website assistant that helps
            customers find answers, understand your services, and get support
            without waiting for a human response.
          </p>

          <div className="mt-9 flex flex-col justify-center gap-4 sm:flex-row">
            {checking ? (
              <span className="rounded-xl bg-violet-400 px-7 py-3.5 font-semibold text-slate-950 opacity-70">
                Checking session…
              </span>
            ) : (
              <Link
                href={primaryHref}
                className="rounded-xl bg-violet-400 px-7 py-3.5 font-semibold text-slate-950 transition hover:bg-violet-300"
              >
                {primaryLabel}
              </Link>
            )}

            <Link
              href="/pricing"
              className="rounded-xl border border-white/20 px-7 py-3.5 font-semibold transition hover:bg-white/10"
            >
              Explore plans
            </Link>
          </div>

          <p className="mt-5 text-sm text-slate-500">
            {signedIn
              ? "You're signed in. Continue to your dashboard whenever you're ready."
              : "Create an account to explore your dashboard. A paid plan is required to use subscription features."}
          </p>
        </div>

        <div className="relative mx-auto mt-20 max-w-5xl rounded-2xl border border-white/10 bg-[#111521] p-3 shadow-2xl shadow-violet-950/20 sm:p-6">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 pb-4">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
            <span className="ml-3 text-xs text-slate-500">
              Example customer conversation
            </span>
          </div>

          <div className="mx-auto max-w-2xl space-y-5 px-2 py-8 sm:px-8 sm:py-10">
            <div className="ml-auto max-w-md rounded-2xl rounded-br-sm bg-violet-500/20 p-4 text-sm leading-6 text-slate-100">
              How can I find information about your product and support
              policies?
            </div>

            <div className="max-w-lg rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300">
              Hi! I can help you find answers from the business's connected
              knowledge sources. Ask me about a product, policy, or common
              support question.
              <p className="mt-3 text-xs text-violet-300">
                Illustrative preview — connect your own knowledge sources
                after setup.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="features"
        className="border-t border-white/10 bg-white/[0.02] px-6 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-violet-300">
              Built for practical support
            </p>

            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              From business knowledge to customer answers
            </h2>

            <p className="mt-4 leading-7 text-slate-400">
              Bring your information together, make it easier to discover, and
              review the questions your customers are asking.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {features.map((feature) => (
              <article
                key={feature.number}
                className="rounded-2xl border border-white/10 bg-[#111521] p-7"
              >
                <p className="text-sm font-semibold text-violet-300">
                  {feature.number}
                </p>

                <h3 className="mt-5 text-xl font-semibold">
                  {feature.title}
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 text-center sm:py-24">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Give your business knowledge a voice.
        </h2>

        <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-400">
          Start by exploring the dashboard, then choose a plan when you're
          ready to activate paid services.
        </p>

        <Link
          href={signedIn ? "/dashboard" : "/pricing"}
          className="mt-7 inline-flex rounded-xl bg-violet-400 px-7 py-3.5 font-semibold text-slate-950 transition hover:bg-violet-300"
        >
          {signedIn ? "Open dashboard" : "View pricing"}
        </Link>
      </section>

      <footer className="border-t border-white/10 px-6 py-7">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} OmniBrain AI</p>
          <p>Document-aware AI for customer support</p>
        </div>
      </footer>
    </main>
  );
}