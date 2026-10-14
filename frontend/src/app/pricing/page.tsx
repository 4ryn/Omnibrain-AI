
"use client";

import Link from "next/link";
import { useState } from "react";

const plans = [
  {
    id: "starter",
    name: "Starter",
    monthly: 49,
    annual: 539,
    description: "For individuals and small websites.",
    features: [
      "500 AI messages per month",
      "10 knowledge sources",
      "50 MB storage",
      "Text AI chatbot",
      "Website chatbot widget",
    ],
  },
  {
    id: "business",
    name: "Business",
    monthly: 69,
    annual: 759,
    description: "For growing businesses automating support.",
    features: [
      "5,000 AI messages per month",
      "100 knowledge sources",
      "500 MB storage",
      "Text and voice AI",
      "Website chatbot widget",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 99,
    annual: 1089,
    description: "For larger knowledge bases and higher usage.",
    features: [
      "25,000 AI messages per month",
      "500 knowledge sources",
      "2 GB storage",
      "Text and voice AI",
      "Website chatbot widget",
    ],
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  return (
    <main className="min-h-screen bg-[#090b12] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-xl font-bold">
            OmniBrain<span className="text-violet-400"> AI</span>
          </Link>

          <nav className="flex items-center gap-5 text-sm">
            <Link href="/" className="text-slate-300 hover:text-white">
              Home
            </Link>
            <Link href="/login" className="text-slate-300 hover:text-white">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="px-6 pb-10 pt-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-violet-300">
          Plans and pricing
        </p>

        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          Choose the right plan for your business
        </h1>

        <p className="mx-auto mt-5 max-w-2xl leading-7 text-slate-400">
          Create an account and explore your dashboard before subscribing.
          An active plan is required to use paid services.
        </p>

        <div className="mt-8 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setBilling("monthly")}
            aria-pressed={billing === "monthly"}
            className={`rounded-lg px-5 py-3 text-sm font-medium ${
              billing === "monthly"
                ? "bg-violet-400 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            Monthly
          </button>

          <button
            type="button"
            onClick={() => setBilling("annual")}
            aria-pressed={billing === "annual"}
            className={`rounded-lg px-5 py-3 text-sm font-medium ${
              billing === "annual"
                ? "bg-violet-400 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            Annual · 1 month free
          </button>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-20 lg:grid-cols-3">
        {plans.map((plan) => {
          const price = billing === "annual" ? plan.annual : plan.monthly;
          const period = billing === "annual" ? "year" : "month";
          const checkoutUrl =
            `/login?plan=${plan.id}&billing=${billing}`;

          return (
            <article
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-7 ${
                plan.id === "business"
                  ? "border-violet-400 bg-violet-500/[0.08]"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              {plan.id === "business" && (
                <span className="mb-4 w-fit rounded-full bg-violet-400 px-3 py-1 text-xs font-semibold text-slate-950">
                  Most popular
                </span>
              )}

              <h2 className="text-2xl font-semibold">{plan.name}</h2>
              <p className="mt-3 min-h-12 text-sm leading-6 text-slate-400">
                {plan.description}
              </p>

              <div className="mt-6">
                <p className="text-5xl font-bold">
                  ${price.toLocaleString("en-US")}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Billed per {period}
                </p>

                {billing === "annual" && (
                  <p className="mt-2 text-sm text-emerald-300">
                    Equivalent to ${(plan.annual / 12).toFixed(2)}/month
                  </p>
                )}
              </div>

              <Link
                href={checkoutUrl}
                className={`mt-7 rounded-xl px-5 py-3 text-center text-sm font-semibold transition ${
                  plan.id === "business"
                    ? "bg-violet-400 text-slate-950 hover:bg-violet-300"
                    : "border border-white/20 hover:bg-white/10"
                }`}
              >
                Choose {plan.name}
              </Link>

              <p className="mt-3 text-center text-xs text-slate-500">
                You can explore your dashboard before subscribing.
              </p>

              <div className="my-7 border-t border-white/10" />

              <p className="text-sm font-semibold">Included in this plan</p>
              <ul className="mt-4 space-y-4 text-sm text-slate-300">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <span className="text-violet-300">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <footer className="border-t border-white/10 px-6 py-7 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} OmniBrain AI
      </footer>
    </main>
  );
}
