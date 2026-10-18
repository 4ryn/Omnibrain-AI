
import Link from "next/link";

const ERRORS: Record<string, string> = {
  oauth_not_configured: "Google sign-in isn't configured on this server yet.",
  oauth_denied: "Sign-in was cancelled. Please try again.",
  invalid_state: "Your sign-in session expired. Please try again.",
  invalid_token: "We couldn't verify your Google sign-in. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again.",
  email_not_verified: "Your Google account's email address isn't verified.",
};

const PLANS = {
  starter: "Starter",
  business: "Business",
  pro: "Pro",
} as const;

type PlanId = keyof typeof PLANS;
type Billing = "monthly" | "annual";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    plan?: string;
    billing?: string;
  }>;
};

const BACKEND_URL = "https://omnibrain-ai.onrender.com";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  const error = params.error
    ? ERRORS[params.error] ?? "Sign-in failed. Please try again."
    : null;

  const plan =
    params.plan && Object.hasOwn(PLANS, params.plan)
      ? (params.plan as PlanId)
      : null;

  const billing: Billing =
    params.billing === "annual" ? "annual" : "monthly";

  const loginUrl = new URL("/api/auth/google/login", BACKEND_URL);

  if (plan) {
    loginUrl.searchParams.set("plan", plan);
    loginUrl.searchParams.set("billing", billing);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-xl">
        <Link href="/" className="text-xl font-bold">
          OmniBrain <span className="text-violet-400">AI</span>
        </Link>

        <h1 className="mt-7 text-2xl font-semibold">
          Welcome to OmniBrain AI
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-400">
          Sign in to access your dashboard and explore your workspace.
          A subscription is required to use paid services.
        </p>

        {plan && (
          <div className="mt-6 rounded-xl border border-violet-400/30 bg-violet-400/10 p-4 text-left">
            <p className="text-xs text-violet-200">Your selected plan</p>
            <p className="mt-1 text-lg font-semibold">{PLANS[plan]}</p>
            <p className="text-sm text-slate-300">
              {billing === "annual" ? "Annual billing" : "Monthly billing"}
            </p>
            <Link
              href="/pricing"
              className="mt-2 inline-block text-xs text-violet-300 underline"
            >
              Change plan
            </Link>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        <a
          href={loginUrl.toString()}
          className="mt-7 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
        >
          Continue with Google
        </a>

        <p className="mt-5 text-xs text-slate-500">
          You can explore your dashboard before subscribing. Choosing a plan
          does not charge you.
        </p>
      </div>
    </main>
  );
}
