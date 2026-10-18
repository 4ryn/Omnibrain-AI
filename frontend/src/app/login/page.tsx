// const ERRORS: Record<string, string> = {
//   oauth_not_configured: "Google sign-in isn't configured on this server yet.",
//   oauth_denied: "Sign-in was cancelled. Please try again.",
//   invalid_state: "Your sign-in session expired. Please try again.",
//   invalid_token: "We couldn't verify your Google sign-in. Please try again.",
//   oauth_failed: "Google sign-in failed. Please try again.",
//   email_not_verified: "Your Google account's email address isn't verified.",
// };

// type LoginPageProps = {
//   searchParams: Promise<{ error?: string }>;
// };

// export default async function LoginPage({ searchParams }: LoginPageProps) {
//   const params = await searchParams;
//   const error = params.error
//     ? ERRORS[params.error] ?? "Sign-in failed. Please try again."
//     : null;
//   return (
//     <main className="flex min-h-screen items-center justify-center p-6">
//       <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
//         <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">🧠</div>
//         <h1 className="text-xl font-semibold">OmniBrain AI</h1>
//         <p className="mt-1 text-sm text-slate-500">An assistant that answers your website visitors using your own knowledge.</p>
//         {error && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
//         {/* Full-page navigation on purpose: this starts the server-side Google OAuth flow. */}
//         <a href="/api/auth/google/login" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
//           <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.3 5.7c4.3-4 6.9-9.9 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
//           Continue with Google
//         </a>
//         <p className="mt-4 text-xs text-slate-400">We only receive your name, email and profile picture. No passwords.</p>
//       </div>
//     </main>
//   );
// }



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

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  const error = params.error
    ? ERRORS[params.error] ?? "Sign-in failed. Please try again."
    : null;

  const plan = params.plan && params.plan in PLANS
    ? (params.plan as PlanId)
    : null;

  const billing: Billing = params.billing === "annual" ? "annual" : "monthly";
  
  const BACKEND_URL = "https://omnibrain-ai.onrender.com";

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
